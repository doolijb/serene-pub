package window

import (
	"errors"
	"io"
	"log"
	"testing"
	"time"
)

type fakeHelper struct {
	done   chan struct{}
	code   int
	killed bool
}

func (f *fakeHelper) Done() <-chan struct{} { return f.done }
func (f *fakeHelper) ExitCode() int         { return f.code }
func (f *fakeHelper) Kill() error           { f.killed = true; close(f.done); return nil }

func mgr(spawn func(string, ...string) (Helper, error)) (*Manager, *[]string, *int) {
	var opened []string
	unavailable := 0
	return &Manager{
		Helper: "/x/serene-pub-window", Log: log.New(io.Discard, "", 0), Wait: 20 * time.Millisecond,
		OpenBrowser: func(u string) error { opened = append(opened, u); return nil },
		Unavailable: func() { unavailable++ }, Spawn: spawn,
	}, &opened, &unavailable
}

func TestExecFailureFallsBackToBrowser(t *testing.T) {
	m, opened, un := mgr(func(string, ...string) (Helper, error) { return nil, errors.New("no such file") })
	if m.Window("http://localhost:3000") || len(*opened) != 1 || *un != 1 {
		t.Fatalf("opened %v unavailable %d", *opened, *un)
	}
}

func TestQuickNonZeroExitFallsBack(t *testing.T) {
	m, opened, un := mgr(func(string, ...string) (Helper, error) {
		h := &fakeHelper{done: make(chan struct{}), code: HelperExitNoRuntime}
		close(h.done)
		return h, nil
	})
	if m.Window("u") || len(*opened) != 1 || *un != 1 {
		t.Fatal("no fallback")
	}
}

func TestRunningHelperIsTrackedAndClosed(t *testing.T) {
	h := &fakeHelper{done: make(chan struct{})}
	var args []string
	m, opened, _ := mgr(func(p string, a ...string) (Helper, error) { args = a; return h, nil })
	if !m.Window("http://localhost:3000") || len(*opened) != 0 || m.Count() != 1 {
		t.Fatal("helper not tracked")
	}
	if len(args) != 4 || args[0] != "--url" || args[1] != "http://localhost:3000" || args[3] != "Serene Pub" {
		t.Errorf("args %v", args)
	}
	m.CloseAll()
	if !h.killed {
		t.Error("not closed")
	}
}

func TestUserClosingLastWindowReportsIt(t *testing.T) {
	h := &fakeHelper{done: make(chan struct{})}
	m, _, _ := mgr(func(string, ...string) (Helper, error) { return h, nil })
	closed := make(chan struct{}, 1)
	m.LastClosed = func() { closed <- struct{}{} }
	if !m.Window("u") {
		t.Fatal("no window")
	}
	close(h.done) // the user closed it: exit 0
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("LastClosed not called")
	}
}

func TestCloseAllAndCrashesAreNotUserCloses(t *testing.T) {
	h := &fakeHelper{done: make(chan struct{})}
	m, _, _ := mgr(func(string, ...string) (Helper, error) { return h, nil })
	called := make(chan struct{}, 2)
	m.LastClosed = func() { called <- struct{}{} }
	m.Window("u")
	m.CloseAll() // an update closing windows must not quit a trayless launcher
	crash := &fakeHelper{done: make(chan struct{}), code: 2}
	m.Spawn = func(string, ...string) (Helper, error) { return crash, nil }
	m.Window("u")
	close(crash.done)
	select {
	case <-called:
		t.Fatal("LastClosed called for a killed or crashed helper")
	case <-time.After(50 * time.Millisecond):
	}
}
