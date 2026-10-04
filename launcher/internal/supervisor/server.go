package supervisor

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/doolijb/serene-pub/launcher/internal/control"
	"github.com/doolijb/serene-pub/launcher/internal/paths"
	"github.com/doolijb/serene-pub/launcher/internal/proc"
	"github.com/doolijb/serene-pub/launcher/internal/runtimefile"
	"github.com/doolijb/serene-pub/launcher/internal/update"
)

// realServer implements update.Server against the real world (§C3, §C6).
type realServer struct {
	layout  paths.Layout
	files   paths.DataFiles
	env     []string
	log     *log.Logger
	stopMax time.Duration
}

// ChildEnv is the §C6 environment: the launcher's own, plus exactly these.
// SERENE_PUB_DATA_DIR is never set (only passed through), and no .env value
// is injected — preloadEnv resolves .env itself with the right precedence.
func ChildEnv(base []string, l paths.Layout, version, channel, target string) []string {
	return proc.ServerEnv(base, [][2]string{
		{"NODE_ENV", "production"},
		{"SERENE_PUB_INSTALL_ROOT", l.InstallRoot},
		{"AUTO_OPEN_CLIENT", "0"},
		{"SERENE_PUB_LAUNCHER_VERSION", version},
		{"SERENE_PUB_UPDATE_CHANNEL", channel},
		{"SERENE_PUB_TARGET", target},
		{"SERENE_PUB_UPDATE_DIR", l.Staging},
	})
}

func (s *realServer) Spawn() (update.Proc, error) {
	s.log.Printf("spawn: %s %s (cwd %s)", s.layout.Node, s.layout.IndexJS, s.layout.AppDir)
	c, err := proc.SpawnServer(proc.ServerSpec{
		Node: s.layout.Node, IndexJS: s.layout.IndexJS, Dir: s.layout.AppDir,
		LogPath: s.files.ServerLog, PrevLog: s.files.ServerLogPrev, Env: s.env,
	})
	if err != nil {
		return nil, err
	}
	s.log.Printf("spawn: server pid %d", c.Pid())
	return c, nil
}

func (s *realServer) Runtime() *runtimefile.Runtime {
	rt, err := runtimefile.Read(s.files.Runtime)
	if err != nil {
		return nil
	}
	return rt
}

func (s *realServer) Health(ctx context.Context, rt *runtimefile.Runtime) (control.Health, error) {
	return control.New(rt).Health(ctx)
}

func (s *realServer) Accepts(rt *runtimefile.Runtime) bool {
	return control.Accepts(rt.ControlAddr(), time.Second)
}

func (s *realServer) Alive(pid int) bool { return proc.Alive(pid) }

// Stop asks the server to exit — POST /shutdown, wait ≤ 30 s; POSIX fallback
// SIGTERM. Never SIGKILL: PGlite's WAL must be closed by the server itself.
func (s *realServer) Stop(rt *runtimefile.Runtime, p update.Proc) error {
	if rt == nil {
		rt = s.Runtime()
	}
	if rt != nil && rt.Pid == p.Pid() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := control.New(rt).Shutdown(ctx)
		cancel()
		if err != nil {
			s.log.Printf("stop: /shutdown: %v", err)
		} else if waitDone(p, s.stopMax) {
			return nil
		}
	}
	select {
	case <-p.Done():
		return nil
	default:
	}
	if err := proc.Terminate(p.Pid()); err != nil {
		if errors.Is(err, proc.ErrUnsupported) {
			return errors.New("the server did not stop and this OS has no graceful signal")
		}
		return err
	}
	s.log.Printf("stop: sent SIGTERM to %d", p.Pid())
	if waitDone(p, s.stopMax) {
		return nil
	}
	return errors.New("the server did not stop")
}

func waitDone(p update.Proc, d time.Duration) bool {
	select {
	case <-p.Done():
		return true
	case <-time.After(d):
		return false
	}
}

// attachedProc watches a server this launcher did not start (pid polling).
type attachedProc struct {
	pid  int
	done chan struct{}
}

func attach(pid int, alive func(int) bool, every time.Duration) *attachedProc {
	a := &attachedProc{pid: pid, done: make(chan struct{})}
	go func() {
		for alive(pid) {
			time.Sleep(every)
		}
		close(a.done)
	}()
	return a
}

func (a *attachedProc) Pid() int              { return a.pid }
func (a *attachedProc) Done() <-chan struct{} { return a.done }
func (a *attachedProc) ExitCode() int         { return -1 }

var _ update.Proc = (*attachedProc)(nil)
