package supervisor

import (
	"errors"

	"github.com/doolijb/serene-pub/launcher/internal/control"
	"github.com/doolijb/serene-pub/launcher/internal/runtimefile"
)

// Decision is the §C6 attach-or-start outcome (after the lock is held).
type Decision int

const (
	// Start: no live server — check markers (§C8), then spawn.
	Start Decision = iota
	// Attach: watch the running server, never spawn.
	Attach
)

func (d Decision) String() string { return [...]string{"start", "attach"}[d] }

// Decide: attach iff runtime.json names a live pid whose health answers with
// the same pid. A server bound to a non-loopback HOST refuses the control
// routes (§C2); for it the launcher falls back to pid liveness alone.
func Decide(rt *runtimefile.Runtime, alive func(int) bool, health func(*runtimefile.Runtime) (control.Health, error)) Decision {
	if rt == nil || !alive(rt.Pid) {
		return Start
	}
	h, err := health(rt)
	if err == nil {
		if h.Pid == rt.Pid {
			return Attach
		}
		return Start
	}
	if errors.Is(err, control.ErrRefused) && !rt.ControlIsLoopback() {
		return Attach
	}
	return Start
}
