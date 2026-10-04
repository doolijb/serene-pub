//go:build windows

package proc

import (
	"errors"
	"os"
	"syscall"

	"golang.org/x/sys/windows"
)

const (
	createNoWindow        = 0x08000000
	createNewProcessGroup = 0x00000200
)

func detachedAttr(server bool) *syscall.SysProcAttr {
	// No console window, own process group; no job object, so closing the
	// launcher never takes Node with it.
	if server {
		return &syscall.SysProcAttr{CreationFlags: createNoWindow | createNewProcessGroup, HideWindow: true}
	}
	return &syscall.SysProcAttr{CreationFlags: createNewProcessGroup}
}

// Alive reports whether pid names a running process.
func Alive(pid int) bool {
	if pid <= 0 {
		return false
	}
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		// Access denied still means the process exists.
		return errors.Is(err, windows.ERROR_ACCESS_DENIED)
	}
	defer windows.CloseHandle(h)
	var code uint32
	if err := windows.GetExitCodeProcess(h, &code); err != nil {
		return false
	}
	return code == 259 // STILL_ACTIVE
}

// Terminate has no graceful equivalent on Windows; the control route is the
// only graceful stop there (§C3).
func Terminate(pid int) error { return ErrUnsupported }

// Lock takes an exclusive, non-blocking lock on path for the process lifetime.
func Lock(path string) (func(), error) {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	ol := new(windows.Overlapped)
	err = windows.LockFileEx(windows.Handle(f.Fd()),
		windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, ol)
	if err != nil {
		f.Close()
		if errors.Is(err, windows.ERROR_LOCK_VIOLATION) {
			return nil, ErrLocked
		}
		return nil, err
	}
	return func() { windows.UnlockFileEx(windows.Handle(f.Fd()), 0, 1, 0, ol); f.Close() }, nil
}
