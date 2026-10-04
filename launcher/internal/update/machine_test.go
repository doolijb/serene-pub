package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/doolijb/serene-pub/launcher/internal/control"
	"github.com/doolijb/serene-pub/launcher/internal/paths"
	"github.com/doolijb/serene-pub/launcher/internal/runtimefile"
)

const tok = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// ---- fixtures -------------------------------------------------------------

func write(t *testing.T, p, s string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, []byte(s), 0o755); err != nil {
		t.Fatal(err)
	}
}

func read(p string) string { b, _ := os.ReadFile(p); return string(b) }

// appFiles writes a minimal app dir for version v.
func appFiles(t *testing.T, appDir, goos, v string) {
	node := "node"
	if goos == "windows" {
		node = "node.exe"
	}
	write(t, filepath.Join(appDir, node), "node")
	write(t, filepath.Join(appDir, "build", "index.js"), "// "+v)
	write(t, filepath.Join(appDir, "package.json"), `{"name":"serene-pub","version":"`+v+`"}`)
}

// install builds an install root with the current app at 0.6.0.
func install(t *testing.T, goos string) paths.Layout {
	root := t.TempDir()
	var l paths.Layout
	switch goos {
	case "darwin":
		l = paths.FromExecutable(goos, filepath.Join(root, "Serene Pub.app", "Contents", "MacOS", "serene-pub"))
	case "windows":
		l = paths.FromExecutable(goos, filepath.Join(root, "Serene Pub.exe"))
	default:
		l = paths.FromExecutable(goos, filepath.Join(root, "serene-pub"))
	}
	appFiles(t, l.AppDir, goos, "0.6.0")
	write(t, l.LauncherPath, "launcher 0.6.0")
	return l
}

type stageOpts struct {
	tag, version, launcherVersion, target, channel, applyTag string
	noApply, noReady, noLauncher                             bool
}

func stage(t *testing.T, l paths.Layout, o stageOpts) {
	if o.tag == "" {
		o.tag = "v0.6.1"
	}
	if o.version == "" {
		o.version = strings.TrimPrefix(o.tag, "v")
	}
	if o.launcherVersion == "" {
		o.launcherVersion = "0.6.0"
	}
	if o.target == "" {
		o.target = "linux-x64"
	}
	if o.channel == "" {
		o.channel = "portable"
	}
	if o.applyTag == "" {
		o.applyTag = o.tag
	}
	p := l.PayloadPaths(o.tag)
	appFiles(t, p.AppDir, l.GOOS, o.version)
	if !o.noLauncher {
		write(t, p.Launcher, "launcher "+o.launcherVersion)
	}
	write(t, filepath.Join(p.Root, "README.md"), "readme "+o.version)
	if !o.noReady {
		r := Ready{Schema: 1, Tag: o.tag, Version: o.version, FromVersion: "0.6.0", Target: o.target,
			Channel: o.channel, LauncherVersion: o.launcherVersion, Payload: o.tag}
		b, _ := json.Marshal(r)
		write(t, l.ReadyFile(), string(b))
	}
	if !o.noApply {
		write(t, l.ApplyFile(), `{"schema":1,"tag":"`+o.applyTag+`","requestedAt":"x","requestedBy":1}`)
	}
}

func unitVersion(l paths.Layout, unit string) string {
	appDir := unit
	if l.GOOS == "darwin" {
		appDir = filepath.Join(unit, "Contents", "Resources", "app")
	}
	var pkg struct{ Version string }
	b, err := os.ReadFile(filepath.Join(appDir, "package.json"))
	if err != nil {
		return ""
	}
	json.Unmarshal(b, &pkg)
	return pkg.Version
}

// ---- fake server -----------------------------------------------------------

// behavior scripts one spawned server by the version it was spawned from.
type behavior struct {
	exitAfter int      // health/runtime polls before it exits; 0 = never
	noRuntime bool     // never writes runtime.json
	noAccept  bool     // never accepts TCP
	states    []string // health states per call; the last one repeats
	refuse    bool     // control routes 404
}

type fakeProc struct {
	pid  int
	done chan struct{}
	once sync.Once
}

func (p *fakeProc) Pid() int              { return p.pid }
func (p *fakeProc) Done() <-chan struct{} { return p.done }
func (p *fakeProc) ExitCode() int         { return 1 }
func (p *fakeProc) exit()                 { p.once.Do(func() { close(p.done) }) }

type fakeServer struct {
	l        paths.Layout
	behave   map[string]behavior // by unit version
	spawned  []string            // versions spawned
	stops    int
	cur      *fakeProc
	curB     behavior
	polls    int
	healthN  int
	failSpwn bool
	alive    map[int]bool
}

func newFake(l paths.Layout) *fakeServer {
	return &fakeServer{l: l, behave: map[string]behavior{}, alive: map[int]bool{}}
}

func (f *fakeServer) Spawn() (Proc, error) {
	if f.failSpwn {
		return nil, errors.New("exec failed")
	}
	v := unitVersion(f.l, f.l.SwapUnit)
	f.spawned = append(f.spawned, v)
	f.cur = &fakeProc{pid: 1000 + len(f.spawned), done: make(chan struct{})}
	f.curB = f.behave[v]
	if len(f.curB.states) == 0 {
		f.curB.states = []string{"ready"}
	}
	f.polls, f.healthN = 0, 0
	return f.cur, nil
}

func (f *fakeServer) tick() {
	f.polls++
	if f.curB.exitAfter > 0 && f.polls >= f.curB.exitAfter {
		f.cur.exit()
	}
}

func (f *fakeServer) Runtime() *runtimefile.Runtime {
	if f.cur == nil {
		return nil
	}
	f.tick()
	if f.curB.noRuntime {
		return nil
	}
	return &runtimefile.Runtime{Schema: 1, Pid: f.cur.pid, Port: 3000, ControlURL: "http://127.0.0.1:3000",
		OpenURL: "http://localhost:3000", Token: tok}
}

func (f *fakeServer) Accepts(*runtimefile.Runtime) bool { return !f.curB.noAccept }

func (f *fakeServer) Health(_ context.Context, rt *runtimefile.Runtime) (control.Health, error) {
	if f.curB.refuse {
		return control.Health{}, control.ErrRefused
	}
	s := f.curB.states[min(f.healthN, len(f.curB.states)-1)]
	f.healthN++
	if s == "slow" {
		return control.Health{}, context.DeadlineExceeded
	}
	return control.Health{State: s, Ready: s == "ready", Pid: rt.Pid}, nil
}

func (f *fakeServer) Stop(_ *runtimefile.Runtime, p Proc) error {
	f.stops++
	p.(*fakeProc).exit()
	return nil
}

func (f *fakeServer) Alive(pid int) bool { return f.alive[pid] }

// ---- harness ---------------------------------------------------------------

type harness struct {
	t        *testing.T
	l        paths.Layout
	srv      *fakeServer
	m        *Machine
	notices  []Notice
	spawnedL [][]string
	signed   []string
	clock    time.Time
	cancel   chan struct{}
}

func newHarness(t *testing.T, goos string, mut ...func(*Config)) *harness {
	h := &harness{t: t, l: install(t, goos), clock: time.Unix(1_700_000_000, 0), cancel: make(chan struct{})}
	h.srv = newFake(h.l)
	target := map[string]string{"linux": "linux-x64", "windows": "windows-x64", "darwin": "macos-arm64"}[goos]
	c := Config{
		Layout: h.l, Version: "0.6.0", Channel: "portable", Target: target, Server: h.srv,
		Codesign: func(b string) error { h.signed = append(h.signed, b); return nil },
		SpawnLauncher: func(p string, a []string) error {
			h.spawnedL = append(h.spawnedL, append([]string{p}, a...))
			return nil
		},
		Notify: func(n Notice) { h.notices = append(h.notices, n) },
		Now:    func() time.Time { return h.clock },
		Sleep:  func(d time.Duration) { h.clock = h.clock.Add(d) },
		Gate:   GateOptions{Cancel: h.cancel},
	}
	for _, f := range mut {
		f(&c)
	}
	h.m = New(c)
	return h
}

func (h *harness) noticed(sub string) bool {
	for _, n := range h.notices {
		if strings.Contains(n.Text, sub) {
			return true
		}
	}
	return false
}

func (h *harness) stagingEntries() []string {
	es, _ := os.ReadDir(h.l.Staging)
	var out []string
	for _, e := range es {
		out = append(out, e.Name())
	}
	return out
}

func (h *harness) wantStaging(want ...string) {
	h.t.Helper()
	got := strings.Join(h.stagingEntries(), ",")
	if got != strings.Join(want, ",") {
		h.t.Errorf("staging = [%s], want [%s]", got, strings.Join(want, ","))
	}
}

func (h *harness) wantUnit(v string) {
	h.t.Helper()
	if got := unitVersion(h.l, h.l.SwapUnit); got != v {
		h.t.Errorf("swap unit version = %q, want %q", got, v)
	}
}

// ---- tests -----------------------------------------------------------------

func TestFreshInstallDoesNothing(t *testing.T) {
	h := newHarness(t, "linux")
	if r := h.m.Run(); r.Action != ActNone || r.Proc != nil {
		t.Fatalf("%+v", r)
	}
	h.wantUnit("0.6.0")
}

func TestReadyWithoutApplyIsLeftAlone(t *testing.T) {
	h := newHarness(t, "linux")
	stage(t, h.l, stageOpts{noApply: true})
	if r := h.m.Run(); r.Action != ActNone {
		t.Fatalf("%+v", r)
	}
	h.wantStaging("READY.json", "v0.6.1")
}

func TestInterruptedMidExtractNoReady(t *testing.T) {
	h := newHarness(t, "linux")
	write(t, filepath.Join(h.l.Staging, "v0.6.1.extracting", "serene-pub", "app", "node"), "partial")
	write(t, filepath.Join(h.l.Staging, "download.part"), "zip")
	if r := h.m.Run(); r.Action != ActNone {
		t.Fatalf("no APPLY: %+v", r)
	}
	// An APPLY without READY (cannot happen from Node, but never trust it) is discarded.
	write(t, h.l.ApplyFile(), `{"schema":1,"tag":"v0.6.1"}`)
	write(t, filepath.Join(h.l.FailedDir(), "app", "x"), "old failure")
	if r := h.m.Run(); r.Action != ActDiscarded {
		t.Fatalf("APPLY w/o READY: %+v", r)
	}
	h.wantStaging("failed")
	h.wantUnit("0.6.0")
	if !h.noticed(MsgDiscarded) {
		t.Error("no discard notice")
	}
}

func TestStagedReadyAppliesAndCommits(t *testing.T) {
	h := newHarness(t, "linux")
	stage(t, h.l, stageOpts{})
	write(t, filepath.Join(h.l.InstallRoot, ".env"), "KEEP=1")
	r := h.m.Run()
	if r.Action != ActApplied || r.Proc == nil || r.Exit || r.Tag != "v0.6.1" {
		t.Fatalf("%+v", r)
	}
	h.wantUnit("0.6.1")
	h.wantStaging() // everything cleared, SWAP.json included
	if read(filepath.Join(h.l.InstallRoot, "README.md")) != "readme 0.6.1" {
		t.Error("docs not copied")
	}
	if read(filepath.Join(h.l.InstallRoot, ".env")) != "KEEP=1" {
		t.Error(".env touched")
	}
	if len(h.spawnedL) != 0 {
		t.Errorf("unexpected self-replace %v", h.spawnedL)
	}
	if !h.noticed("Updated to v0.6.1") {
		t.Errorf("notices %v", h.notices)
	}
}

func TestValidationMismatchesDiscard(t *testing.T) {
	cases := map[string]struct {
		o    stageOpts
		prep func(paths.Layout)
		want error
	}{
		"tag":        {o: stageOpts{applyTag: "v0.6.2"}, want: ErrTagMismatch},
		"target":     {o: stageOpts{target: "windows-x64"}, want: ErrTargetMismatch},
		"channel":    {o: stageOpts{channel: "installer"}, want: ErrChannelMismatch},
		"prerelease": {o: stageOpts{tag: "v0.6.1-rc-1"}, want: ErrPrereleaseStage},
		"badtag":     {o: stageOpts{tag: "v0.6.1-RC"}, want: ErrBadTag},
		"launcher":   {o: stageOpts{noLauncher: true}, want: ErrPayloadMissing},
		"node": {prep: func(l paths.Layout) { os.Remove(l.PayloadPaths("v0.6.1").Node) },
			want: ErrPayloadMissing},
		"pkgversion": {prep: func(l paths.Layout) {
			os.WriteFile(l.PayloadPaths("v0.6.1").Package, []byte(`{"version":"0.6.9"}`), 0o644)
		}, want: ErrPayloadVersion},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t, "linux")
			stage(t, h.l, c.o)
			if c.prep != nil {
				c.prep(h.l)
			}
			var a Apply
			var rd Ready
			readJSON(h.l.ApplyFile(), &a)
			readJSON(h.l.ReadyFile(), &rd)
			if err := Validate(h.l, &rd, &a, "linux-x64", "portable"); !errors.Is(err, c.want) {
				t.Fatalf("Validate = %v, want %v", err, c.want)
			}
			if r := h.m.Run(); r.Action != ActDiscarded {
				t.Fatalf("%+v", r)
			}
			h.wantStaging()
			h.wantUnit("0.6.0")
			if len(h.srv.spawned) != 0 {
				t.Error("machine spawned a server on discard")
			}
		})
	}
}

func TestBadPayloadNameRefused(t *testing.T) {
	l := install(t, "linux")
	for _, p := range []string{"", "..", "../x", "a/b", "failed", "previous"} {
		r := &Ready{Schema: 1, Tag: "v0.6.1", Version: "0.6.1", Target: "linux-x64", Channel: "portable", Payload: p}
		if err := Validate(l, r, &Apply{Schema: 1, Tag: "v0.6.1"}, "linux-x64", "portable"); !errors.Is(err, ErrBadPayload) {
			t.Errorf("payload %q: %v", p, err)
		}
	}
}

func TestHealthFailureRollsBack(t *testing.T) {
	for name, b := range map[string]behavior{
		"exits":    {exitAfter: 3, states: []string{"starting"}},
		"recovery": {states: []string{"starting", "recovery"}},
		// Serving, but a startup task it cannot do without failed (pipelines).
		"failed":    {states: []string{"starting", "failed"}},
		"noRuntime": {noRuntime: true},
		"noAccept":  {noAccept: true},
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t, "linux")
			stage(t, h.l, stageOpts{})
			write(t, filepath.Join(h.l.FailedDir(), "app", "older"), "older failure")
			h.srv.behave["0.6.1"] = b
			r := h.m.Run()
			if r.Action != ActRolledBack || r.Proc != nil {
				t.Fatalf("%+v", r)
			}
			h.wantUnit("0.6.0")
			if unitVersion(h.l, h.l.FailedUnit()) != "0.6.1" {
				t.Error("failed/app is not the new unit")
			}
			if _, err := os.Stat(filepath.Join(h.l.FailedUnit(), "older")); err == nil {
				t.Error("older failed unit not replaced")
			}
			h.wantStaging("failed")
			if !h.noticed("failed and was rolled back") || !h.noticed("Admin › Data and backups") {
				t.Errorf("notices %v", h.notices)
			}
		})
	}
}

func TestMigratingDoesNotRollBack(t *testing.T) {
	h := newHarness(t, "linux")
	stage(t, h.l, stageOpts{})
	// 600 polls × 500 ms = 5 minutes of "starting"/slow answers, then ready.
	states := make([]string, 600)
	for i := range states {
		states[i] = "starting"
		if i%3 == 0 {
			states[i] = "slow"
		}
	}
	h.srv.behave["0.6.1"] = behavior{states: append(states, "ready")}
	r := h.m.Run()
	if r.Action != ActApplied {
		t.Fatalf("%+v", r)
	}
	if !h.noticed(MsgFinishing) {
		t.Error("no Finishing update… status")
	}
	h.wantUnit("0.6.1")
}

func TestRollBackNowWhileMigrating(t *testing.T) {
	h := newHarness(t, "linux")
	stage(t, h.l, stageOpts{})
	h.srv.behave["0.6.1"] = behavior{states: []string{"starting"}}
	h.m.c.Gate.OnStarting = nil
	calls := 0
	h.m.c.Sleep = func(d time.Duration) {
		h.clock = h.clock.Add(d)
		if calls++; calls == 50 {
			close(h.cancel)
		}
	}
	h.m.c.Gate.Sleep = h.m.c.Sleep
	r := h.m.Run()
	if r.Action != ActRolledBack || h.srv.stops != 1 {
		t.Fatalf("%+v stops=%d", r, h.srv.stops)
	}
	h.wantUnit("0.6.0")
}

func TestRefusedControlRoutesAcceptedAfterGrace(t *testing.T) {
	h := newHarness(t, "linux")
	stage(t, h.l, stageOpts{})
	h.srv.behave["0.6.1"] = behavior{refuse: true}
	if r := h.m.Run(); r.Action != ActApplied {
		t.Fatalf("%+v", r)
	}
}

func TestSelfReplaceWhenLauncherVersionDiffers(t *testing.T) {
	h := newHarness(t, "linux")
	stage(t, h.l, stageOpts{launcherVersion: "0.6.1"})
	r := h.m.Run()
	if r.Action != ActApplied || !r.Exit || r.Proc == nil {
		t.Fatalf("%+v", r)
	}
	if read(h.l.LauncherPath) != "launcher 0.6.1" {
		t.Error("new launcher not in place")
	}
	if read(h.l.PreviousLauncher()) != "launcher 0.6.0" {
		t.Error("old launcher not parked in previous/")
	}
	if info, _ := os.Stat(h.l.LauncherPath); info.Mode().Perm() != 0o755 {
		t.Errorf("mode %v", info.Mode().Perm())
	}
	want := []string{h.l.LauncherPath, "--attach", "--after-update=v0.6.1"}
	if len(h.spawnedL) != 1 || strings.Join(h.spawnedL[0], "|") != strings.Join(want, "|") {
		t.Fatalf("spawned %v", h.spawnedL)
	}
	// SWAP.json stays committed until the new launcher finishes.
	if j, ok := h.m.Journal(); !ok || j.Phase != PhaseCommitted {
		t.Fatalf("journal %+v", j)
	}
	// The new launcher (--after-update) clears staging.
	h2 := newHarness(t, "linux")
	h2.l, h2.m.c.Layout = h.l, h.l
	h2.m.c.Version = "0.6.1"
	h2.m.Finish("v0.6.1")
	h2.wantStaging()
}

func TestSelfReplaceDecision(t *testing.T) {
	lin := newHarness(t, "linux")
	if lin.m.NeedsSelfReplace("0.6.0", true) || !lin.m.NeedsSelfReplace("0.6.1", true) || lin.m.NeedsSelfReplace("", true) {
		t.Error("linux decision")
	}
	mac := newHarness(t, "darwin")
	if !mac.m.NeedsSelfReplace("0.6.0", true) || mac.m.NeedsSelfReplace("0.6.1", false) {
		t.Error("darwin decision: always after an in-process swap, never after")
	}
}

func TestMacOSResignsAndHandsOver(t *testing.T) {
	h := newHarness(t, "darwin")
	stage(t, h.l, stageOpts{target: "macos-arm64"})
	r := h.m.Run()
	if r.Action != ActApplied || !r.Exit {
		t.Fatalf("%+v", r)
	}
	if len(h.signed) != 1 || h.signed[0] != h.l.SwapUnit {
		t.Errorf("codesign %v", h.signed)
	}
	h.wantUnit("0.6.1")
	if len(h.spawnedL) != 1 || h.spawnedL[0][0] != h.l.LauncherPath {
		t.Errorf("spawned %v", h.spawnedL)
	}
	if read(h.l.LauncherPath) != "launcher 0.6.0" { // payload launcher came in with the bundle
		t.Error("bundle launcher not the payload's")
	}
}

func TestMacOSCodesignFailureRollsBack(t *testing.T) {
	h := newHarness(t, "darwin", func(c *Config) { c.Codesign = func(string) error { return errors.New("codesign: no") } })
	stage(t, h.l, stageOpts{target: "macos-arm64"})
	if r := h.m.Run(); r.Action != ActRolledBack {
		t.Fatalf("%+v", r)
	}
	h.wantUnit("0.6.0")
	if len(h.srv.spawned) != 0 {
		t.Error("spawned an unsigned bundle")
	}
}

func TestAppImageStubRefuses(t *testing.T) {
	h := newHarness(t, "linux", func(c *Config) { c.Channel = "appimage" })
	stage(t, h.l, stageOpts{channel: "appimage"})
	if r := h.m.Run(); r.Action != ActRefused {
		t.Fatalf("%+v", r)
	}
	h.wantStaging("APPLY", "READY.json", "v0.6.1")
	h.wantUnit("0.6.0")
	if !h.noticed("unsupported in this build") {
		t.Error("no notice")
	}
}

func TestPrereleaseAndDevAreInert(t *testing.T) {
	for name, mut := range map[string]func(*Config){
		"channel prerelease": func(c *Config) { c.Channel = "prerelease" },
		"channel dev":        func(c *Config) { c.Channel = "dev" },
		"channel unset":      func(c *Config) { c.Channel = "" },
		"version rc":         func(c *Config) { c.Version = "0.6.0-rc-1" },
		"homebrew":           func(c *Config) { c.Channel = "homebrew" },
	} {
		t.Run(name, func(t *testing.T) {
			h := newHarness(t, "linux", mut)
			stage(t, h.l, stageOpts{})
			if r := h.m.Run(); r.Action != ActRefused {
				t.Fatalf("%+v", r)
			}
			h.wantStaging("APPLY", "READY.json", "v0.6.1")
			h.wantUnit("0.6.0")
			if len(h.srv.spawned) != 0 {
				t.Error("spawned")
			}
		})
	}
}

func TestWindowsSharingViolationAborts(t *testing.T) {
	attempts := 0
	var h *harness
	h = newHarness(t, "windows", func(c *Config) {
		c.Target = "windows-x64"
		c.Rename = func(o, n string) error {
			if o == h.l.SwapUnit {
				attempts++
				return fmt.Errorf("rename %s: The process cannot access the file because it is being used by another process.", o)
			}
			return os.Rename(o, n)
		}
	})
	stage(t, h.l, stageOpts{target: "windows-x64"})
	if r := h.m.Run(); r.Action != ActAborted {
		t.Fatalf("%+v", r)
	}
	if attempts != 10 {
		t.Errorf("attempts = %d, want 10", attempts)
	}
	h.wantUnit("0.6.0")
	h.wantStaging("READY.json", "v0.6.1") // APPLY spent, READY kept
	if !h.noticed("something has Serene Pub's folder open") {
		t.Error("notice")
	}
}

func TestWindowsSharingViolationRetrySucceeds(t *testing.T) {
	attempts := 0
	var h *harness
	h = newHarness(t, "windows", func(c *Config) {
		c.Target = "windows-x64"
		c.Rename = func(o, n string) error {
			if o == h.l.SwapUnit && attempts < 3 {
				attempts++
				return errors.New("sharing violation")
			}
			return os.Rename(o, n)
		}
	})
	stage(t, h.l, stageOpts{target: "windows-x64"})
	if r := h.m.Run(); r.Action != ActApplied {
		t.Fatalf("%+v", r)
	}
	h.wantUnit("0.6.1")
}

func TestServerStillAliveAborts(t *testing.T) {
	h := newHarness(t, "linux")
	stage(t, h.l, stageOpts{})
	h.srv.cur = &fakeProc{pid: 77, done: make(chan struct{})}
	h.srv.curB = behavior{states: []string{"ready"}}
	h.srv.alive[77] = true
	if r := h.m.Run(); r.Action != ActAborted {
		t.Fatalf("%+v", r)
	}
	h.wantUnit("0.6.0")
}

// ---- resume from SWAP.json -------------------------------------------------

func journal(t *testing.T, l paths.Layout, phase string) {
	write(t, l.SwapFile(), `{"schema":1,"tag":"v0.6.1","phase":"`+phase+`","at":"x"}`)
}

func TestResumeMovedOldNothingMoved(t *testing.T) {
	h := newHarness(t, "linux")
	stage(t, h.l, stageOpts{})
	journal(t, h.l, PhaseMovedOld)
	if r := h.m.Run(); r.Action != ActApplied {
		t.Fatalf("%+v", r)
	}
	h.wantUnit("0.6.1")
	h.wantStaging()
}

func TestResumeOldUnitMovedNewMissing(t *testing.T) {
	for _, phase := range []string{PhaseMovedOld, PhaseMovedNew} {
		t.Run(phase, func(t *testing.T) {
			h := newHarness(t, "linux")
			stage(t, h.l, stageOpts{})
			os.MkdirAll(h.l.PreviousDir(), 0o755)
			os.Rename(h.l.SwapUnit, h.l.PreviousUnit())
			journal(t, h.l, phase)
			r := h.m.Run()
			if r.Action != ActApplied {
				t.Fatalf("%+v", r)
			}
			h.wantUnit("0.6.1")
			h.wantStaging()
		})
	}
}

func newUnitInPlace(t *testing.T, h *harness, phase string) {
	stage(t, h.l, stageOpts{})
	os.MkdirAll(h.l.PreviousDir(), 0o755)
	os.Rename(h.l.SwapUnit, h.l.PreviousUnit())
	os.Rename(h.l.PayloadPaths("v0.6.1").Unit, h.l.SwapUnit)
	journal(t, h.l, phase)
}

func TestResumeNewUnitInPlaceRerunsGate(t *testing.T) {
	for _, phase := range []string{PhaseMovedNew, PhaseHealth} {
		t.Run(phase, func(t *testing.T) {
			h := newHarness(t, "linux")
			newUnitInPlace(t, h, phase)
			r := h.m.Run()
			if r.Action != ActApplied || len(h.srv.spawned) != 1 || h.srv.spawned[0] != "0.6.1" {
				t.Fatalf("%+v spawned=%v", r, h.srv.spawned)
			}
			h.wantStaging()
		})
	}
}

func TestResumeHealthPhaseFailsRollsBack(t *testing.T) {
	h := newHarness(t, "linux")
	newUnitInPlace(t, h, PhaseHealth)
	h.srv.behave["0.6.1"] = behavior{exitAfter: 2, states: []string{"starting"}}
	if r := h.m.Run(); r.Action != ActRolledBack {
		t.Fatalf("%+v", r)
	}
	h.wantUnit("0.6.0")
	h.wantStaging("failed")
}

func TestResumeMacOSMovedNewResigns(t *testing.T) {
	h := newHarness(t, "darwin")
	stage(t, h.l, stageOpts{target: "macos-arm64"})
	os.MkdirAll(h.l.PreviousDir(), 0o755)
	os.Rename(h.l.SwapUnit, h.l.PreviousUnit())
	os.Rename(h.l.PayloadPaths("v0.6.1").Unit, h.l.SwapUnit)
	journal(t, h.l, PhaseMovedNew)
	r := h.m.Run()
	if r.Action != ActApplied || len(h.signed) == 0 {
		t.Fatalf("%+v signed=%v", r, h.signed)
	}
}

func TestResumeCommittedFinishesCleanup(t *testing.T) {
	h := newHarness(t, "linux")
	newUnitInPlace(t, h, PhaseCommitted)
	r := h.m.Run()
	if r.Action != ActApplied || r.Proc != nil || r.Exit {
		t.Fatalf("%+v", r)
	}
	h.wantStaging()
	if len(h.srv.spawned) != 0 {
		t.Error("committed resume must not spawn; the caller starts normally")
	}
}

func TestResumeCommittedOldLauncherSelfReplaces(t *testing.T) {
	h := newHarness(t, "linux")
	stage(t, h.l, stageOpts{launcherVersion: "0.6.1"})
	os.MkdirAll(h.l.PreviousDir(), 0o755)
	os.Rename(h.l.SwapUnit, h.l.PreviousUnit())
	os.Rename(h.l.PayloadPaths("v0.6.1").Unit, h.l.SwapUnit)
	journal(t, h.l, PhaseCommitted)
	r := h.m.Run()
	if !r.Exit || len(h.spawnedL) != 1 || strings.Join(h.spawnedL[0][1:], " ") != "--after-update=v0.6.1" {
		t.Fatalf("%+v %v", r, h.spawnedL)
	}
}

func TestResumeRolledBackCleansUp(t *testing.T) {
	h := newHarness(t, "linux")
	stage(t, h.l, stageOpts{})
	write(t, filepath.Join(h.l.FailedUnit(), "x"), "f")
	journal(t, h.l, PhaseRolledBack)
	if r := h.m.Run(); r.Action != ActNone {
		t.Fatalf("%+v", r)
	}
	h.wantStaging("failed")
	h.wantUnit("0.6.0")
}

func TestResumeBothUnitsMissingIsBroken(t *testing.T) {
	h := newHarness(t, "linux")
	stage(t, h.l, stageOpts{})
	os.RemoveAll(h.l.SwapUnit)
	journal(t, h.l, PhaseHealth)
	if r := h.m.Run(); r.Action != ActBroken {
		t.Fatalf("%+v", r)
	}
	if !h.noticed("missing") {
		t.Error("notice")
	}
}

func TestResumeAttachedCommits(t *testing.T) {
	h := newHarness(t, "linux")
	newUnitInPlace(t, h, PhaseHealth)
	p := &fakeProc{pid: 4242, done: make(chan struct{})}
	h.srv.cur, h.srv.curB = p, behavior{states: []string{"starting", "ready"}}
	r, ok := h.m.ResumeAttached(p)
	if !ok || r.Action != ActApplied || len(h.srv.spawned) != 0 {
		t.Fatalf("%+v ok=%v spawned=%v", r, ok, h.srv.spawned)
	}
	h.wantStaging()
}
