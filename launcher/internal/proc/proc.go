// Package proc spawns and watches processes the way §C6 requires: Node is
// started directly, detached (it must outlive a launcher exit or
// self-replace), with stdout+stderr on an opened file handle — never a pipe —
// and stdin on the null device.
package proc

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"sync"
)

// ErrLocked is returned by Lock when another launcher holds the lock.
var ErrLocked = errors.New("launcher.lock is held by another launcher")

// ErrUnsupported is returned by Terminate where no graceful signal exists.
var ErrUnsupported = errors.New("not supported on this OS")

// Child is a process this launcher started and can Wait on.
type Child struct {
	cmd  *exec.Cmd
	done chan struct{}
	code int
	mu   sync.Mutex
}

// Pid of the child.
func (c *Child) Pid() int { return c.cmd.Process.Pid }

// Done is closed when the child has exited.
func (c *Child) Done() <-chan struct{} { return c.done }

// ExitCode is valid after Done is closed (-1 when killed by a signal).
func (c *Child) ExitCode() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.code
}

// Kill force-stops the child. Used ONLY for window-helper processes — never
// for Node (PGlite WAL; §C3 "Nothing ever SIGKILLs Node").
func (c *Child) Kill() error { return c.cmd.Process.Kill() }

func watch(cmd *exec.Cmd) *Child {
	c := &Child{cmd: cmd, done: make(chan struct{})}
	go func() {
		err := cmd.Wait()
		c.mu.Lock()
		c.code = 0
		if err != nil {
			var ee *exec.ExitError
			if errors.As(err, &ee) {
				c.code = ee.ExitCode()
			} else {
				c.code = -1
			}
		}
		c.mu.Unlock()
		close(c.done)
	}()
	return c
}

// ServerSpec is everything §C6 needs to start Node.
type ServerSpec struct {
	Node, IndexJS, Dir string
	LogPath, PrevLog   string // <dataDir>/logs/server.log and server.1.log
	Env                []string
}

// SpawnServer rotates server.log → server.1.log, opens a fresh server.log and
// starts Node detached with both output streams on that file handle.
func SpawnServer(s ServerSpec) (*Child, error) {
	if err := os.MkdirAll(dirOf(s.LogPath), 0o755); err != nil {
		return nil, err
	}
	if _, err := os.Stat(s.LogPath); err == nil {
		os.Remove(s.PrevLog)
		os.Rename(s.LogPath, s.PrevLog)
	}
	logf, err := os.OpenFile(s.LogPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open server log: %w", err)
	}
	defer logf.Close() // the child holds its own duplicate
	cmd := exec.Command(s.Node, s.IndexJS)
	cmd.Dir = s.Dir
	cmd.Env = s.Env
	cmd.Stdin = nil // exec opens the null device
	cmd.Stdout = logf
	cmd.Stderr = logf
	cmd.SysProcAttr = detachedAttr(true)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return watch(cmd), nil
}

// SpawnHelper starts a GUI helper (the window helper) as a watched child.
func SpawnHelper(path string, args ...string) (*Child, error) {
	cmd := exec.Command(path, args...)
	cmd.SysProcAttr = detachedAttr(false)
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return watch(cmd), nil
}

// SpawnDetached starts path detached and forgets it (the new launcher after a
// self-replace). Its working directory is dir.
func SpawnDetached(path, dir string, args ...string) error {
	cmd := exec.Command(path, args...)
	cmd.Dir = dir
	cmd.SysProcAttr = detachedAttr(false)
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

// ServerEnv is base plus exactly the given variables (§C6), each replacing any
// same-named entry in base. Keys compare case-insensitively on Windows.
func ServerEnv(base []string, set [][2]string) []string {
	fold := func(s string) string {
		if runtime.GOOS == "windows" {
			return strings.ToUpper(s)
		}
		return s
	}
	drop := map[string]bool{}
	for _, kv := range set {
		drop[fold(kv[0])] = true
	}
	out := make([]string, 0, len(base)+len(set))
	for _, e := range base {
		k, _, _ := strings.Cut(e, "=")
		if !drop[fold(k)] {
			out = append(out, e)
		}
	}
	for _, kv := range set {
		out = append(out, kv[0]+"="+kv[1])
	}
	return out
}

func dirOf(p string) string {
	i := strings.LastIndexAny(p, `/\`)
	if i < 0 {
		return "."
	}
	return p[:i]
}
