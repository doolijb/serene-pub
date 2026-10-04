package tray

import (
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// recorder counts the hooks runGated calls.
type recorder struct {
	mu                     sync.Mutex
	order                  []string
	starts, ready, unavail atomic.Int32
	started                chan struct{}
}

func newRecorder() *recorder { return &recorder{started: make(chan struct{}, 4)} }

func (r *recorder) note(s string) { r.mu.Lock(); r.order = append(r.order, s); r.mu.Unlock() }

func (r *recorder) hooks() Hooks {
	return Hooks{
		Start:       func() { r.starts.Add(1); r.note("start"); r.started <- struct{}{} },
		Ready:       func() { r.ready.Add(1); r.note("ready") },
		Unavailable: func() { r.unavail.Add(1); r.note("unavailable") },
	}
}

func (r *recorder) waitStart(t *testing.T) {
	t.Helper()
	select {
	case <-r.started:
	case <-time.After(2 * time.Second):
		t.Fatal("Start never ran")
	}
}

func TestReadyTrayStartsAtOnce(t *testing.T) {
	r := newRecorder()
	built := false
	runGated(func(onReady func()) { onReady() }, func() { built = true }, time.Hour, r.hooks())
	r.waitStart(t)
	if !built || r.ready.Load() != 1 || r.unavail.Load() != 0 {
		t.Fatalf("built=%v ready=%d unavailable=%d", built, r.ready.Load(), r.unavail.Load())
	}
}

// The Windows failure: the tray never signals ready and its loop blocks for
// ever. The server must start anyway, after the timeout.
func TestDeadTrayStartsAfterTimeout(t *testing.T) {
	r := newRecorder()
	stop := make(chan struct{})
	defer close(stop)
	go runGated(func(func()) { <-stop }, func() { t.Error("built a dead tray") }, 20*time.Millisecond, r.hooks())
	r.waitStart(t)
	if r.unavail.Load() != 1 || r.ready.Load() != 0 || r.starts.Load() != 1 {
		t.Fatalf("unavailable=%d ready=%d starts=%d", r.unavail.Load(), r.ready.Load(), r.starts.Load())
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.order[0] != "unavailable" {
		t.Errorf("order %v: Unavailable must precede Start", r.order)
	}
}

// A tray that comes up after the timeout still gets built and reported, but
// the server is not started twice.
func TestLateTrayDoesNotStartTwice(t *testing.T) {
	r := newRecorder()
	built := false
	runGated(func(onReady func()) {
		time.Sleep(60 * time.Millisecond)
		onReady()
	}, func() { built = true }, 10*time.Millisecond, r.hooks())
	r.waitStart(t)
	time.Sleep(20 * time.Millisecond)
	if !built || r.starts.Load() != 1 || r.unavail.Load() != 1 || r.ready.Load() != 1 {
		t.Fatalf("built=%v starts=%d unavailable=%d ready=%d", built, r.starts.Load(), r.unavail.Load(), r.ready.Load())
	}
}

func TestNilHooksAreFine(t *testing.T) {
	runGated(func(onReady func()) { onReady() }, func() {}, time.Millisecond, Hooks{})
	stop := make(chan struct{})
	go runGated(func(func()) { <-stop }, func() {}, time.Millisecond, Hooks{})
	time.Sleep(10 * time.Millisecond)
	close(stop)
}
