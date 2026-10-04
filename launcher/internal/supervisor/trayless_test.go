package supervisor

import (
	"io"
	"log"
	"testing"

	"github.com/doolijb/serene-pub/launcher/internal/launcherstate"
	"github.com/doolijb/serene-pub/launcher/internal/paths"
)

type liveProc struct{ done chan struct{} }

func (p liveProc) Pid() int              { return 42 }
func (p liveProc) Done() <-chan struct{} { return p.done }
func (p liveProc) ExitCode() int         { return 0 }

func traylessSup(t *testing.T) (*Supervisor, *[]int) {
	t.Helper()
	var exits []int
	s := &Supervisor{o: Options{
		Files: paths.Files(t.TempDir()), Version: "0.6.0-pr-1",
		Log: log.New(io.Discard, "", 0), Exit: func(c int) { exits = append(exits, c) },
	}, cmds: make(chan func(), 16)}
	return s, &exits
}

func TestTrayAvailabilityIsRecorded(t *testing.T) {
	s, _ := traylessSup(t)
	s.SetTrayAvailable(false)
	if got := launcherstate.Load(s.o.Files.State).TrayUnavailable; got != "0.6.0-pr-1" {
		t.Fatalf("trayUnavailable %q", got)
	}
	s.SetTrayAvailable(true) // a late tray clears it
	if got := launcherstate.Load(s.o.Files.State).TrayUnavailable; got != "" || s.trayless.Load() {
		t.Fatalf("trayUnavailable %q trayless %v", got, s.trayless.Load())
	}
}

// With a tray, a stopped server waits for the tray's Start; without one,
// nothing could restart it, so the launcher exits (0 stopped, 1 error).
func TestTraylessStopEndsTheLauncher(t *testing.T) {
	s, exits := traylessSup(t)
	s.setStatus(Status{State: StateStopped, Text: "Stopped"})
	if len(*exits) != 0 {
		t.Fatalf("exited with a tray: %v", *exits)
	}
	s.SetTrayAvailable(false)
	s.setStatus(Status{State: StateRunning})
	s.setStatus(Status{State: StateStopped, Text: "Stopped"})
	s.setStatus(Status{State: StateError, Text: "Stopped unexpectedly (exit 1)"})
	if len(*exits) != 2 || (*exits)[0] != 0 || (*exits)[1] != 1 {
		t.Fatalf("exits %v", *exits)
	}
}

// A server that is up but in error (started with errors) stays: the app
// still works and its shutdown still ends everything.
func TestTraylessErrorWithLiveServerStays(t *testing.T) {
	s, exits := traylessSup(t)
	s.SetTrayAvailable(false)
	s.own(liveProc{done: make(chan struct{})}, nil)
	s.setStatus(Status{State: StateError, Text: "Serene Pub started with errors — see View Logs"})
	if len(*exits) != 0 {
		t.Fatalf("exits %v", *exits)
	}
}

func TestTraylessLastWindowClosedQuits(t *testing.T) {
	s, _ := traylessSup(t)
	s.onLastWindowClosed()
	if len(s.cmds) != 0 || s.quitting {
		t.Fatal("quit with a tray")
	}
	s.SetTrayAvailable(false)
	s.onLastWindowClosed()
	if len(s.cmds) != 1 || !s.quitting {
		t.Fatal("did not quit")
	}
}
