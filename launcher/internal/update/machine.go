package update

import (
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/doolijb/serene-pub/launcher/internal/paths"
	"github.com/doolijb/serene-pub/launcher/internal/runtimefile"
	"github.com/doolijb/serene-pub/launcher/internal/version"
)

// NoticeKind classifies a tray notice.
type NoticeKind int

const (
	Info NoticeKind = iota
	Problem
	// Progress is a status-line change, not a notification.
	Progress
)

// Notice is something the tray should show.
type Notice struct {
	Kind NoticeKind
	Text string
}

// User-facing strings (§C8, §C13).
const (
	MsgUpdatesOff      = "Updates are off in this build"
	MsgUnsupported     = "Updates are unsupported in this build"
	MsgDiscarded       = "Update discarded"
	MsgFolderBusy      = "Update couldn't be applied — something has Serene Pub's folder open"
	MsgFinishing       = "Finishing update…"
	MsgAppMissing      = "Serene Pub's app folder is missing — reinstall from the release page"
	MsgRollbackFailed  = "Update failed and could not be rolled back — see View Logs"
	msgUpdatedTo       = "Updated to %s"
	msgRolledBack      = "Update to %s failed and was rolled back — a backup from before the update is in Admin › Data and backups"
	msgApplying        = "Updating to %s…"
	SelfReplaceArgsTag = "--after-update="
)

// Action summarises what Run did.
type Action string

const (
	ActNone       Action = "none"        // nothing staged / nothing to resume
	ActRefused    Action = "refused"     // updates off in this build; markers left
	ActDiscarded  Action = "discarded"   // markers failed validation and were deleted
	ActAborted    Action = "aborted"     // the swap unit could not be moved; nothing changed
	ActApplied    Action = "applied"     // committed; Result.Proc is the new server
	ActRolledBack Action = "rolled-back" // the old unit is back; caller starts it
	ActBroken     Action = "broken"      // no swap unit and no backup: cannot start
)

// Result tells the supervisor what to do next.
type Result struct {
	Action Action
	Tag    string
	// Proc is a running server the machine started (applied). nil → the
	// caller starts the current app normally (unless Action is ActBroken).
	Proc    Proc
	Runtime *runtimefile.Runtime
	// Exit: a new launcher was spawned; the caller must exit(0) now.
	Exit bool
}

// Config wires the machine to the outside world.
type Config struct {
	Layout  paths.Layout
	Version string // main.version
	Channel string // main.channel
	Target  string // main.target
	Server  Server
	// Rename defaults to os.Rename. Moves of the swap unit retry a failure
	// 10× at 500 ms on Windows (sharing violation, §C8 step 3).
	Rename func(oldpath, newpath string) error
	// Codesign re-signs the macOS bundle ad hoc (§C8 step 5).
	Codesign func(bundle string) error
	// SpawnLauncher starts the (new) launcher detached (§C8 step 9).
	SpawnLauncher func(path string, args []string) error
	// LauncherArgs are carried over to the new launcher (e.g. --no-open).
	LauncherArgs []string
	// CloseWindows closes every window-helper process this launcher owns.
	CloseWindows func()
	Notify       func(Notice)
	Log          *log.Logger
	Gate         GateOptions
	Sleep        func(time.Duration)
	Now          func() time.Time
}

// Machine is the §C8 state machine. Not safe for concurrent use.
type Machine struct{ c Config }

// New fills defaults.
func New(c Config) *Machine {
	if c.Rename == nil {
		c.Rename = os.Rename
	}
	if c.Log == nil {
		c.Log = log.New(io.Discard, "", 0)
	}
	if c.Notify == nil {
		c.Notify = func(Notice) {}
	}
	if c.CloseWindows == nil {
		c.CloseWindows = func() {}
	}
	if c.Sleep == nil {
		c.Sleep = time.Sleep
	}
	if c.Now == nil {
		c.Now = time.Now
	}
	if c.Gate.Now == nil {
		c.Gate.Now = c.Now
	}
	if c.Gate.Sleep == nil {
		c.Gate.Sleep = c.Sleep
	}
	return &Machine{c: c}
}

func (m *Machine) l() paths.Layout { return m.c.Layout }

func (m *Machine) logf(format string, args ...any) { m.c.Log.Printf("update: "+format, args...) }

// UpdatesOff is §C8 step 1 / §C11: dev, prerelease and unset channels, and
// any pre-release launcher version, never apply anything.
func UpdatesOff(channel, launcherVersion string) bool {
	switch channel {
	case "", "dev", "prerelease":
		return true
	}
	return version.IsPrerelease(launcherVersion)
}

// folderSwapChannel: channels whose update is a folder swap (§C11).
func folderSwapChannel(channel string) bool {
	return channel == "portable" || channel == "installer" || channel == "dmg"
}

func exists(p string) bool { _, err := os.Lstat(p); return err == nil }

// Journal reads SWAP.json; ok is false when absent or unreadable.
func (m *Machine) Journal() (Journal, bool) {
	var j Journal
	if err := readJSON(m.l().SwapFile(), &j); err != nil {
		return j, false
	}
	return j, true
}

func (m *Machine) journal(tag, phase string) {
	j := Journal{Schema: 1, Tag: tag, Phase: phase, At: now(m.c.Now)}
	if err := writeJSON(m.l().SwapFile(), j); err != nil {
		m.logf("could not write SWAP.json phase=%s: %v", phase, err)
	} else {
		m.logf("SWAP.json phase=%s tag=%s", phase, tag)
	}
}

func (m *Machine) ready() (*Ready, error) {
	var r Ready
	if err := readJSON(m.l().ReadyFile(), &r); err != nil {
		return nil, err
	}
	return &r, nil
}

// Run is called when no server is alive: at launcher start and after the
// server exited (any exit code — markers, not codes, decide). It resumes an
// interrupted swap from SWAP.json, then applies a staged update if APPLY is
// present. It never starts the current app itself: Result.Proc == nil means
// the caller does.
func (m *Machine) Run() Result {
	if j, ok := m.Journal(); ok {
		res, done := m.resume(j)
		if done {
			return res
		}
	} else if exists(m.l().SwapFile()) {
		m.logf("SWAP.json unreadable; treating the swap as not started")
		m.recoverUnreadableJournal()
	}
	return m.apply()
}

// recoverUnreadableJournal handles a SWAP.json that cannot be parsed: put the
// old unit back if it was moved, then forget the journal.
func (m *Machine) recoverUnreadableJournal() {
	l := m.l()
	if !exists(l.SwapUnit) && exists(l.PreviousUnit()) {
		if err := m.c.Rename(l.PreviousUnit(), l.SwapUnit); err != nil {
			m.logf("restore previous unit: %v", err)
			return
		}
	}
	os.Remove(l.SwapFile())
}

// apply is §C8 steps 1–10 for a fresh APPLY.
func (m *Machine) apply() Result {
	l := m.l()
	if !exists(l.ApplyFile()) {
		return Result{Action: ActNone}
	}
	if UpdatesOff(m.c.Channel, m.c.Version) {
		m.logf("APPLY present but updates are off (channel %q, version %q); markers left", m.c.Channel, m.c.Version)
		m.c.Notify(Notice{Info, MsgUpdatesOff})
		return Result{Action: ActRefused}
	}
	if m.c.Channel == "appimage" {
		return m.applyAppImage()
	}
	if !folderSwapChannel(m.c.Channel) {
		m.logf("APPLY present but channel %q does not update in-app; markers left", m.c.Channel)
		m.c.Notify(Notice{Info, MsgUpdatesOff})
		return Result{Action: ActRefused}
	}
	var a Apply
	if err := readJSON(l.ApplyFile(), &a); err != nil {
		return m.discard(fmt.Errorf("%w: %v", ErrBadApply, err))
	}
	r, err := m.ready()
	if err != nil {
		return m.discard(fmt.Errorf("%w: %v", ErrNoReady, err))
	}
	if err := Validate(l, r, &a, m.c.Target, m.c.Channel); err != nil {
		return m.discard(err)
	}

	m.logf("applying %s (from %s)", r.Tag, r.FromVersion)
	m.c.Notify(Notice{Progress, fmt.Sprintf(msgApplying, r.Tag)})
	// Step 2: nothing of ours may hold the swap unit open.
	m.c.CloseWindows()
	if rt := m.c.Server.Runtime(); rt != nil {
		for i := 0; i < 20 && m.c.Server.Alive(rt.Pid); i++ {
			m.c.Sleep(500 * time.Millisecond)
		}
		if m.c.Server.Alive(rt.Pid) {
			m.logf("server pid %d still alive; not swapping", rt.Pid)
			m.c.Notify(Notice{Problem, MsgFolderBusy})
			return Result{Action: ActAborted, Tag: r.Tag}
		}
	}

	// Step 3: old unit → previous/.
	os.RemoveAll(l.PreviousUnit()) // a stale backup from an interrupted cleanup
	if err := os.MkdirAll(l.PreviousDir(), 0o755); err != nil {
		m.logf("create previous/: %v", err)
		m.c.Notify(Notice{Problem, MsgFolderBusy})
		return Result{Action: ActAborted, Tag: r.Tag}
	}
	m.journal(r.Tag, PhaseMovedOld)
	if err := m.renameUnit(l.SwapUnit, l.PreviousUnit()); err != nil {
		m.logf("move current unit aside: %v — aborting, nothing changed", err)
		os.Remove(l.SwapFile())
		os.Remove(l.PreviousDir()) // only if empty
		// Consent is spent; READY stays so Admin › Updates can offer Apply again.
		os.Remove(l.ApplyFile())
		m.c.Notify(Notice{Problem, MsgFolderBusy})
		return Result{Action: ActAborted, Tag: r.Tag}
	}

	// Step 4: payload unit → swap unit.
	m.journal(r.Tag, PhaseMovedNew)
	p := l.PayloadPaths(r.Payload)
	if err := m.renameUnit(p.Unit, l.SwapUnit); err != nil {
		m.logf("move new unit into place: %v", err)
		return m.rollback(r.Tag, nil, nil)
	}
	return m.healthAndCommit(r, nil)
}

// healthAndCommit is §C8 steps 5–9 with the new unit in place. attached is a
// server already running from it (resume while attached); nil spawns one.
func (m *Machine) healthAndCommit(r *Ready, attached Proc) Result {
	l := m.l()
	if l.GOOS == "darwin" && attached == nil && m.c.Codesign != nil {
		if err := m.c.Codesign(l.SwapUnit); err != nil {
			m.logf("codesign: %v", err)
			return m.rollback(r.Tag, nil, nil)
		}
	}
	m.journal(r.Tag, PhaseHealth)
	proc := attached
	if proc == nil {
		var err error
		proc, err = m.c.Server.Spawn()
		if err != nil {
			m.logf("spawn new server: %v", err)
			return m.rollback(r.Tag, nil, nil)
		}
	}
	opts := m.c.Gate
	opts.OnStarting = func() { m.c.Notify(Notice{Progress, MsgFinishing}) }
	g := Gate(m.c.Server, proc, opts)
	m.logf("health gate: %s %s", g.Outcome, g.Reason)
	if g.Outcome != Healthy {
		return m.rollback(r.Tag, proc, g.Runtime)
	}
	m.journal(r.Tag, PhaseCommitted)
	m.copyDocs(l.PayloadPaths(r.Payload).Root)
	return m.postCommit(r, proc, g.Runtime, true)
}

// postCommit is §C8 steps 9–10. inProcess: this launcher ran the swap (on
// macOS that means the launcher binary on disk is now the new one).
func (m *Machine) postCommit(r *Ready, proc Proc, rt *runtimefile.Runtime, inProcess bool) Result {
	res := Result{Action: ActApplied, Tag: r.Tag, Proc: proc, Runtime: rt}
	if m.NeedsSelfReplace(r.LauncherVersion, inProcess) {
		if err := m.selfReplace(r); err != nil {
			m.logf("self-replace: %v — continuing with this launcher", err)
		} else {
			args := []string{SelfReplaceArgsTag + r.Tag}
			if proc != nil {
				args = append([]string{"--attach"}, args...)
			}
			args = append(args, m.c.LauncherArgs...)
			if err := m.c.SpawnLauncher(m.l().LauncherPath, args); err != nil {
				m.logf("spawn new launcher: %v — continuing with this launcher", err)
			} else {
				m.logf("new launcher spawned %v; exiting", args)
				res.Exit = true
				return res
			}
		}
	}
	m.Finish(r.Tag)
	return res
}

// NeedsSelfReplace is the §C8 step 9 decision. On macOS the launcher lives
// inside the swapped bundle, so a launcher that ran the swap always hands
// over to the new binary; a launcher started after the swap already is it.
func (m *Machine) NeedsSelfReplace(readyLauncherVersion string, inProcess bool) bool {
	if m.c.SpawnLauncher == nil {
		return false
	}
	if m.l().GOOS == "darwin" {
		return inProcess
	}
	return readyLauncherVersion != "" && readyLauncherVersion != m.c.Version
}

// selfReplace moves the payload's launcher over this one (Win/Linux): own
// executable → previous/<launcher file>, new one into place, chmod 0755.
// A running executable can be renamed on every target.
func (m *Machine) selfReplace(r *Ready) error {
	l := m.l()
	if l.GOOS == "darwin" {
		return nil // nothing to move: the new launcher came with the bundle
	}
	src := l.PayloadPaths(r.Payload).Launcher
	if !exists(src) {
		return fmt.Errorf("payload launcher missing: %s", src)
	}
	if err := os.MkdirAll(l.PreviousDir(), 0o755); err != nil {
		return err
	}
	os.Remove(l.PreviousLauncher())
	if err := m.c.Rename(l.LauncherPath, l.PreviousLauncher()); err != nil {
		return fmt.Errorf("park own executable: %w", err)
	}
	if err := m.c.Rename(src, l.LauncherPath); err != nil {
		if back := m.c.Rename(l.PreviousLauncher(), l.LauncherPath); back != nil {
			m.logf("CRITICAL: could not restore own executable: %v", back)
		}
		return fmt.Errorf("move new launcher in: %w", err)
	}
	if l.GOOS != "windows" {
		os.Chmod(l.LauncherPath, 0o755)
	}
	return nil
}

// Finish is §C8 step 10: clear <staging> except failed/ (SWAP.json last),
// then tell the user. Called in-process after a commit, or by the new
// launcher started with --after-update=<tag>.
func (m *Machine) Finish(tag string) {
	l := m.l()
	if l.GOOS == "windows" && l.LauncherFile != "" {
		// The old launcher may still be exiting; its parked binary stays
		// locked until then.
		for i := 0; i < 20 && exists(l.PreviousLauncher()); i++ {
			if os.Remove(l.PreviousLauncher()) == nil {
				break
			}
			m.c.Sleep(500 * time.Millisecond)
		}
	}
	m.clearStaging()
	m.logf("update to %s finished", tag)
	m.c.Notify(Notice{Info, fmt.Sprintf(msgUpdatedTo, tag)})
}

// rollback is §C8 step 7.
func (m *Machine) rollback(tag string, proc Proc, rt *runtimefile.Runtime) Result {
	l := m.l()
	if proc != nil {
		select {
		case <-proc.Done():
		default:
			if rt == nil {
				rt = m.c.Server.Runtime()
			}
			if err := m.c.Server.Stop(rt, proc); err != nil {
				m.logf("stop new server: %v", err)
			}
		}
	}
	if exists(l.SwapUnit) && exists(l.PreviousUnit()) {
		os.RemoveAll(l.FailedUnit()) // only the latest failed unit is kept
		if err := os.MkdirAll(l.FailedDir(), 0o755); err == nil {
			if err := m.renameUnit(l.SwapUnit, l.FailedUnit()); err != nil {
				m.logf("move failed unit aside: %v", err)
			}
		}
	}
	if !exists(l.SwapUnit) && exists(l.PreviousUnit()) {
		if err := m.renameUnit(l.PreviousUnit(), l.SwapUnit); err != nil {
			m.logf("CRITICAL: restore previous unit: %v", err)
			m.c.Notify(Notice{Problem, MsgRollbackFailed})
			return Result{Action: ActBroken, Tag: tag}
		}
	}
	if !exists(l.SwapUnit) {
		m.c.Notify(Notice{Problem, MsgRollbackFailed})
		return Result{Action: ActBroken, Tag: tag}
	}
	m.journal(tag, PhaseRolledBack)
	m.clearStaging()
	m.logf("rolled back %s", tag)
	m.c.Notify(Notice{Problem, fmt.Sprintf(msgRolledBack, tag)})
	return Result{Action: ActRolledBack, Tag: tag}
}

// resume handles a SWAP.json left by an interrupted apply. done=false means
// "continue with a normal apply()".
func (m *Machine) resume(j Journal) (Result, bool) {
	l := m.l()
	m.logf("found SWAP.json phase=%s tag=%s", j.Phase, j.Tag)
	switch j.Phase {
	case PhaseRolledBack:
		m.clearStaging()
		return Result{Action: ActNone}, true
	case PhaseCommitted:
		r, err := m.ready()
		if err != nil {
			m.Finish(j.Tag)
			return Result{Action: ActApplied, Tag: j.Tag}, true
		}
		return m.postCommit(r, nil, nil, false), true
	}
	unit, prev := exists(l.SwapUnit), exists(l.PreviousUnit())
	switch {
	case !unit && prev:
		// The old unit was moved aside and the new one never landed: put it
		// back, forget the journal, and let apply() retry from scratch.
		if err := m.renameUnit(l.PreviousUnit(), l.SwapUnit); err != nil {
			m.logf("CRITICAL: restore previous unit: %v", err)
			m.c.Notify(Notice{Problem, MsgRollbackFailed})
			return Result{Action: ActBroken, Tag: j.Tag}, true
		}
		os.Remove(l.SwapFile())
		return Result{}, false
	case unit && j.Phase == PhaseMovedOld:
		// The old unit never moved. Start over.
		os.Remove(l.SwapFile())
		return Result{}, false
	case unit && (j.Phase == PhaseMovedNew || j.Phase == PhaseHealth):
		r, err := m.ready()
		if err != nil {
			r = &Ready{Tag: j.Tag}
		}
		if l.GOOS == "darwin" && j.Phase == PhaseMovedNew && m.c.Codesign != nil {
			// Re-signing is idempotent; it may not have happened.
			if err := m.c.Codesign(l.SwapUnit); err != nil {
				m.logf("codesign: %v", err)
				return m.rollback(r.Tag, nil, nil), true
			}
		}
		res := m.healthAndCommit(r, nil)
		return res, true
	case !unit && !prev:
		m.logf("CRITICAL: neither %s nor %s exists", l.SwapUnit, l.PreviousUnit())
		m.c.Notify(Notice{Problem, MsgAppMissing})
		return Result{Action: ActBroken, Tag: j.Tag}, true
	}
	m.logf("unknown SWAP.json phase %q; ignoring it", j.Phase)
	os.Remove(l.SwapFile())
	return Result{}, false
}

// ResumeAttached is called when the launcher attaches to a live server while
// SWAP.json says the new unit is in place but uncommitted (the previous
// launcher died during the health gate): gate the running server, then commit
// or roll back.
func (m *Machine) ResumeAttached(p Proc) (Result, bool) {
	j, ok := m.Journal()
	if !ok || j.Terminal() || (j.Phase != PhaseMovedNew && j.Phase != PhaseHealth) || !exists(m.l().SwapUnit) {
		return Result{}, false
	}
	r, err := m.ready()
	if err != nil {
		r = &Ready{Tag: j.Tag}
	}
	return m.healthAndCommit(r, p), true
}

// discard deletes everything in <staging> except failed/ (§C5).
func (m *Machine) discard(reason error) Result {
	m.logf("staged update discarded: %v", reason)
	m.clearStaging()
	m.c.Notify(Notice{Info, MsgDiscarded})
	return Result{Action: ActDiscarded}
}

// clearStaging removes every entry of <staging> except failed/, SWAP.json last.
func (m *Machine) clearStaging() {
	l := m.l()
	entries, err := os.ReadDir(l.Staging)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		if name == "failed" || name == "SWAP.json" {
			continue
		}
		if err := os.RemoveAll(filepath.Join(l.Staging, name)); err != nil {
			m.logf("clear staging %s: %v", name, err)
		}
	}
	os.Remove(l.SwapFile())
}

// renameUnit moves a swap unit, retrying on Windows (§C8 step 3).
func (m *Machine) renameUnit(from, to string) error {
	err := m.c.Rename(from, to)
	if err == nil || m.l().GOOS != "windows" {
		return err
	}
	for i := 1; i < 10 && err != nil; i++ {
		m.c.Sleep(500 * time.Millisecond)
		err = m.c.Rename(from, to)
	}
	return err
}

// copyDocs is §C8 step 8: best-effort top-level docs into the install root.
// Never .env.
func (m *Machine) copyDocs(payloadRoot string) {
	l := m.l()
	names := []string{"LICENSE", "README.md", "NOTICE.md", "INSTRUCTIONS.txt", ".env.example"}
	if l.GOOS == "linux" {
		names = append(names, "install-desktop-shortcut.sh")
	}
	for _, n := range names {
		if err := copyFile(filepath.Join(payloadRoot, n), filepath.Join(l.InstallRoot, n)); err != nil && !errors.Is(err, os.ErrNotExist) {
			m.logf("copy %s: %v", n, err)
		}
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	info, err := in.Stat()
	if err != nil {
		return err
	}
	tmp := dst + ".tmp-update"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, info.Mode().Perm())
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}
