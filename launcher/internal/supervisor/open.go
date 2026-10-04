package supervisor

import (
	"time"

	"github.com/doolijb/serene-pub/launcher/internal/runtimefile"
)

// ClientGrace is how long, after an update or an attach, the launcher waits
// for a tab that was already open to reconnect before it opens a client of its
// own. Socket.IO's reconnect backoff tops out at 5 s ± 50 %, so a tab left open
// across the restart is back within it.
const ClientGrace = 8 * time.Second

// openAfterChecks are the knobs of shouldOpenAfter, injectable for tests.
type openAfterChecks struct {
	// Clients asks the server how many clients are connected; nil = unknown.
	Clients func() *int
	Grace   time.Duration
	Every   time.Duration
	Sleep   func(time.Duration)
	Now     func() time.Time
}

// shouldOpenAfter decides whether to open the default client after an update
// was applied or the launcher attached to a running server (§C8 step 10):
// never with --no-open or AUTO_OPEN_CLIENT off, and never while a client is
// already connected. A tab that was open before the restart needs a moment to
// reconnect, so "nobody is connected" is only believed after c.Grace; a
// server that never reports a count (an older one) is taken as nobody.
func shouldOpenAfter(noOpen, autoOpen bool, c openAfterChecks) bool {
	if noOpen || !autoOpen {
		return false
	}
	if c.Now == nil {
		c.Now = time.Now
	}
	if c.Sleep == nil {
		c.Sleep = time.Sleep
	}
	deadline := c.Now().Add(c.Grace)
	for {
		if n := c.Clients(); n != nil && *n > 0 {
			return false
		}
		if !c.Now().Before(deadline) {
			return true
		}
		c.Sleep(c.Every)
	}
}

// openAfter is the supervisor's use of shouldOpenAfter. It polls for up to
// ClientGrace, so callers run it on its own goroutine.
func (s *Supervisor) openAfter(rt *runtimefile.Runtime, why string) {
	open := shouldOpenAfter(s.o.NoOpen, s.prefs().AutoOpen, openAfterChecks{
		Clients: func() *int {
			if rt == nil {
				return nil
			}
			h, err := s.srv.Health(ctxTimeout(5*time.Second), rt)
			if err != nil {
				return nil
			}
			return h.Clients
		},
		Grace: ClientGrace,
		Every: 500 * time.Millisecond,
	})
	if !open {
		s.logf("%s: not opening a client (--no-open, AUTO_OPEN_CLIENT off, or one is connected)", why)
		return
	}
	s.OpenDefault("")
}
