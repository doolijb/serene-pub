package update

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/doolijb/serene-pub/launcher/internal/control"
	"github.com/doolijb/serene-pub/launcher/internal/runtimefile"
)

// Proc is a running server process the launcher watches.
type Proc interface {
	Pid() int
	Done() <-chan struct{}
	ExitCode() int // valid after Done; -1 when unknown (attached)
}

// Server is everything the state machine and the health gate need from the
// outside world. The real one spawns Node (§C6) and calls the control routes
// (§C3); tests use a fake.
type Server interface {
	// Spawn starts Node from the current swap unit.
	Spawn() (Proc, error)
	// Runtime returns the current runtime file, or nil when absent/invalid.
	Runtime() *runtimefile.Runtime
	// Health calls GET /api/launcher/health.
	Health(ctx context.Context, rt *runtimefile.Runtime) (control.Health, error)
	// Accepts reports whether the server's port accepts TCP.
	Accepts(rt *runtimefile.Runtime) bool
	// Stop asks a live server to exit gracefully and waits up to 30 s:
	// POST /shutdown, POSIX fallback SIGTERM. Never SIGKILL.
	Stop(rt *runtimefile.Runtime, p Proc) error
	// Alive reports pid liveness.
	Alive(pid int) bool
}

// Outcome of a health gate.
type Outcome int

const (
	// Healthy: health state "ready".
	Healthy Outcome = iota
	// Recovery: health state "recovery" (database unopenable).
	Recovery
	// Failed: exited before ready, no runtime file / TCP accept within the
	// accept timeout, or health state "failed" (a startup task the instance
	// cannot do without failed; the server may still be running).
	Failed
	// Cancelled: the user chose "Roll back now" while it was still migrating.
	Cancelled
)

func (o Outcome) String() string {
	return [...]string{"healthy", "recovery", "failed", "cancelled"}[o]
}

// GateOptions tune the gate; zero values take the §C8 defaults.
type GateOptions struct {
	AcceptTimeout time.Duration // 60 s: runtime file + TCP accept
	Poll          time.Duration // 500 ms
	// RefusedGrace: a server whose control routes refuse (non-loopback HOST,
	// §C2) but which accepts TCP and stays up this long is taken as running —
	// it cannot be verified further. 10 s.
	RefusedGrace time.Duration
	Now          func() time.Time
	Sleep        func(time.Duration)
	// OnStarting is called once when the server reports "starting" after it
	// accepted TCP (migrating — the tray says "Finishing update…").
	OnStarting func()
	// Cancel, when it delivers, ends the gate with Cancelled (Roll back now).
	Cancel <-chan struct{}
}

func (o GateOptions) withDefaults() GateOptions {
	if o.AcceptTimeout == 0 {
		o.AcceptTimeout = 60 * time.Second
	}
	if o.Poll == 0 {
		o.Poll = 500 * time.Millisecond
	}
	if o.RefusedGrace == 0 {
		o.RefusedGrace = 10 * time.Second
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.Sleep == nil {
		o.Sleep = time.Sleep
	}
	return o
}

// GateResult is what the gate saw last.
type GateResult struct {
	Outcome Outcome
	Runtime *runtimefile.Runtime
	Health  control.Health
	Reason  string
}

// Gate waits for the server p to become ready (§C8 step 6):
//   - healthy  = health state "ready";
//   - failed   = p exits first, or no runtime file (pid == p) / no TCP accept
//     within AcceptTimeout of the call, or state "failed"; state "recovery"
//     ends it as Recovery;
//   - a server that accepts TCP but answers slowly or says "starting" is
//     migrating, not failed: wait with no cap.
func Gate(srv Server, p Proc, o GateOptions) GateResult {
	o = o.withDefaults()
	start := o.Now()
	accepted := false
	var refusedSince time.Time
	notified := false
	var last GateResult
	for {
		select {
		case <-p.Done():
			last.Outcome, last.Reason = Failed, "the server exited before it was ready"
			return last
		case <-o.Cancel:
			last.Outcome, last.Reason = Cancelled, "rolled back by request"
			return last
		default:
		}
		elapsed := o.Now().Sub(start)
		rt := srv.Runtime()
		if rt != nil && rt.Pid != p.Pid() {
			rt = nil // a stale file from an earlier process
		}
		last.Runtime = rt
		if rt != nil && !accepted && srv.Accepts(rt) {
			accepted = true
		}
		if !accepted && elapsed >= o.AcceptTimeout {
			last.Outcome = Failed
			if rt == nil {
				last.Reason = "the server wrote no runtime file within 60 s"
			} else {
				last.Reason = "the server did not accept connections within 60 s"
			}
			return last
		}
		if accepted {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			h, err := srv.Health(ctx, rt)
			cancel()
			switch {
			case err == nil:
				refusedSince = time.Time{}
				last.Health = h
				switch h.State {
				case "ready":
					last.Outcome = Healthy
					return last
				case "recovery":
					last.Outcome, last.Reason = Recovery, "the server started in recovery mode"
					return last
				case control.StateFailed:
					last.Outcome, last.Reason = Failed, "the server started, but its startup failed"
					if len(h.FailedTasks) > 0 {
						last.Reason += " (" + strings.Join(h.FailedTasks, ", ") + ")"
					}
					return last
				default: // "starting": migrating
					if !notified && o.OnStarting != nil {
						notified = true
						o.OnStarting()
					}
				}
			case errors.Is(err, control.ErrRefused):
				if refusedSince.IsZero() {
					refusedSince = o.Now()
				} else if o.Now().Sub(refusedSince) >= o.RefusedGrace {
					last.Outcome, last.Reason = Healthy, "unverified: control routes refused (non-loopback HOST)"
					return last
				}
			default:
				// Slow or busy: still migrating. Keep waiting.
			}
		}
		o.Sleep(o.Poll)
	}
}
