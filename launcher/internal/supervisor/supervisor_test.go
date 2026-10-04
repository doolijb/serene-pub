package supervisor

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/doolijb/serene-pub/launcher/internal/control"
	"github.com/doolijb/serene-pub/launcher/internal/paths"
	"github.com/doolijb/serene-pub/launcher/internal/runtimefile"
)

func TestDecide(t *testing.T) {
	rt := &runtimefile.Runtime{Pid: 50, ControlURL: "http://127.0.0.1:3000"}
	lan := &runtimefile.Runtime{Pid: 50, ControlURL: "http://192.168.1.2:3000"}
	alive := func(pid int) bool { return pid == 50 }
	dead := func(int) bool { return false }
	ok := func(*runtimefile.Runtime) (control.Health, error) {
		return control.Health{Pid: 50, State: "starting"}, nil
	}
	other := func(*runtimefile.Runtime) (control.Health, error) { return control.Health{Pid: 51}, nil }
	refused := func(*runtimefile.Runtime) (control.Health, error) { return control.Health{}, control.ErrRefused }
	down := func(*runtimefile.Runtime) (control.Health, error) {
		return control.Health{}, errors.New("connection refused")
	}

	cases := []struct {
		name string
		rt   *runtimefile.Runtime
		al   func(int) bool
		h    func(*runtimefile.Runtime) (control.Health, error)
		want Decision
	}{
		{"no runtime file", nil, alive, ok, Start},
		{"stale pid", rt, dead, ok, Start},
		{"live + same pid (even while starting)", rt, alive, ok, Attach},
		{"pid reused by another server", rt, alive, other, Start},
		{"loopback but wrong token/no routes", rt, alive, refused, Start},
		{"live pid, not answering", rt, alive, down, Start},
		{"non-loopback HOST: pid liveness", lan, alive, refused, Attach},
	}
	for _, c := range cases {
		if got := Decide(c.rt, c.al, c.h); got != c.want {
			t.Errorf("%s: %s, want %s", c.name, got, c.want)
		}
	}
}

func TestChildEnv(t *testing.T) {
	l := paths.FromExecutable("linux", "/opt/sp/serene-pub")
	base := []string{"PATH=/bin", "NODE_ENV=development", "AUTO_OPEN_CLIENT=1", "HOME=/h"}
	env := strings.Join(ChildEnv(base, l, "0.6.1", "portable", "linux-x64"), "\n")
	for _, want := range []string{"PATH=/bin", "HOME=/h", "NODE_ENV=production", "SERENE_PUB_INSTALL_ROOT=/opt/sp",
		"AUTO_OPEN_CLIENT=0", "SERENE_PUB_LAUNCHER_VERSION=0.6.1", "SERENE_PUB_UPDATE_CHANNEL=portable",
		"SERENE_PUB_TARGET=linux-x64", "SERENE_PUB_UPDATE_DIR=/opt/sp/staging"} {
		if !strings.Contains(env+"\n", want+"\n") {
			t.Errorf("missing %s", want)
		}
	}
	if strings.Contains(env, "development") || strings.Contains(env, "AUTO_OPEN_CLIENT=1") {
		t.Error("base value not replaced")
	}
	if strings.Contains(env, "SERENE_PUB_DATA_DIR") {
		t.Error("launcher must never set SERENE_PUB_DATA_DIR")
	}
	// Passed through when the launcher's own environment has it.
	env2 := ChildEnv(append(base, "SERENE_PUB_DATA_DIR=/op"), l, "0.6.1", "portable", "linux-x64")
	if !strings.Contains(strings.Join(env2, "\n"), "SERENE_PUB_DATA_DIR=/op") {
		t.Error("SERENE_PUB_DATA_DIR not passed through")
	}
}

func TestLoadPrefs(t *testing.T) {
	dir := t.TempDir()
	data, legacy := filepath.Join(dir, "data.env"), filepath.Join(dir, "legacy.env")
	none := func(string) (string, bool) { return "", false }

	p := LoadPrefs(none, []string{data, legacy})
	if !p.AutoOpen || p.Default != "window" || p.AutoOpenLocked || p.DefaultLocked {
		t.Errorf("defaults %+v", p)
	}
	os.WriteFile(legacy, []byte("AUTO_OPEN_CLIENT=1\nDEFAULT_CLIENT=window\n"), 0o600)
	os.WriteFile(data, []byte("AUTO_OPEN_CLIENT=off\nDEFAULT_CLIENT=browser\n"), 0o600)
	p = LoadPrefs(none, []string{data, legacy})
	if p.AutoOpen || p.Default != "browser" {
		t.Errorf("data .env must win over legacy: %+v", p)
	}
	env := func(k string) (string, bool) {
		if k == "AUTO_OPEN_CLIENT" {
			return "1", true
		}
		return "", false
	}
	p = LoadPrefs(env, []string{data, legacy})
	if !p.AutoOpen || !p.AutoOpenLocked || p.DefaultLocked {
		t.Errorf("real env must win and lock: %+v", p)
	}
	os.WriteFile(data, []byte("SERENE_AUTO_OPEN=1\n"), 0o600)
	os.Remove(legacy)
	if p = LoadPrefs(none, []string{data}); p.AutoOpen {
		t.Errorf("SERENE_AUTO_OPEN=1 means don't open: %+v", p)
	}
}

func TestShouldOpenAfter(t *testing.T) {
	n := func(v int) *int { return &v }
	// A fake clock: Sleep advances it, so the grace costs no wall time.
	type script struct {
		noOpen, autoOpen bool
		counts           []*int // per poll; the last one repeats
		want             bool
		wantPolls        int
	}
	cases := map[string]script{
		"AUTO_OPEN_CLIENT off: never, without asking":    {autoOpen: false, counts: []*int{n(0)}, want: false, wantPolls: 0},
		"--no-open: never":                               {noOpen: true, autoOpen: true, counts: []*int{n(0)}, want: false, wantPolls: 0},
		"a client is connected: not a second one":        {autoOpen: true, counts: []*int{n(1)}, want: false, wantPolls: 1},
		"an open tab reconnects within the grace":        {autoOpen: true, counts: []*int{n(0), n(0), nil, n(1)}, want: false, wantPolls: 4},
		"nobody reconnects: open once the grace is over": {autoOpen: true, counts: []*int{n(0)}, want: true, wantPolls: 17},
		"an older server that never says: open":          {autoOpen: true, counts: []*int{nil}, want: true, wantPolls: 17},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			now := time.Unix(0, 0)
			polls := 0
			got := shouldOpenAfter(c.noOpen, c.autoOpen, openAfterChecks{
				Clients: func() *int {
					v := c.counts[min(polls, len(c.counts)-1)]
					polls++
					return v
				},
				Grace: 8 * time.Second,
				Every: 500 * time.Millisecond,
				Now:   func() time.Time { return now },
				Sleep: func(d time.Duration) { now = now.Add(d) },
			})
			if got != c.want || polls != c.wantPolls {
				t.Errorf("open=%v after %d polls, want %v after %d", got, polls, c.want, c.wantPolls)
			}
		})
	}
}
