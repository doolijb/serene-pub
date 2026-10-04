//go:build !windows

package proc

import (
	"errors"
	"os"
	"syscall"
)

func detachedAttr(newSession bool) *syscall.SysProcAttr {
	// Setsid: Node gets its own session, so neither a terminal hang-up nor the
	// launcher's exit reaches it.
	return &syscall.SysProcAttr{Setsid: true}
}

// Alive reports whether pid names a running process.
func Alive(pid int) bool {
	if pid <= 0 {
		return false
	}
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

// Terminate sends SIGTERM (the POSIX fallback when the control route cannot
// be used). Never SIGKILL.
func Terminate(pid int) error {
	return syscall.Kill(pid, syscall.SIGTERM)
}

// Lock takes an exclusive, non-blocking lock on path for the process lifetime.
func Lock(path string) (func(), error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, ErrLocked
		}
		return nil, err
	}
	return func() { syscall.Flock(int(f.Fd()), syscall.LOCK_UN); f.Close() }, nil
}
