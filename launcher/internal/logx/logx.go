// Package logx writes <dataDir>/logs/launcher.log, rotating to launcher.log.1
// at a size cap. A windowless process has no console, so this file is the
// launcher's only diagnostic surface (View Logs opens its folder).
package logx

import (
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
)

// MaxBytes is the size at which launcher.log rolls over to launcher.log.1.
const MaxBytes = 1 << 20

// Writer is a size-capped, rotating log file.
type Writer struct {
	mu   sync.Mutex
	path string
	f    *os.File
	size int64
	max  int64
}

// Open opens (creating) path, rotating first when it is already over max.
func Open(path string, max int64) (*Writer, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	w := &Writer{path: path, max: max}
	if info, err := os.Stat(path); err == nil && info.Size() >= max {
		w.rotate()
	}
	return w, w.open()
}

func (w *Writer) open() error {
	f, err := os.OpenFile(w.path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	info, _ := f.Stat()
	w.f, w.size = f, 0
	if info != nil {
		w.size = info.Size()
	}
	return nil
}

func (w *Writer) rotate() {
	if w.f != nil {
		w.f.Close()
		w.f = nil
	}
	os.Remove(w.path + ".1")
	os.Rename(w.path, w.path+".1")
}

// Write implements io.Writer.
func (w *Writer) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.f != nil && w.size+int64(len(p)) > w.max {
		w.rotate()
		if err := w.open(); err != nil {
			return 0, err
		}
	}
	if w.f == nil {
		return 0, os.ErrClosed
	}
	n, err := w.f.Write(p)
	w.size += int64(n)
	return n, err
}

// Close closes the file.
func (w *Writer) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.f == nil {
		return nil
	}
	err := w.f.Close()
	w.f = nil
	return err
}

// New returns a logger on w (and also on extra writers, e.g. stderr in a terminal).
func New(w io.Writer, extra ...io.Writer) *log.Logger {
	if len(extra) > 0 {
		w = io.MultiWriter(append([]io.Writer{w}, extra...)...)
	}
	return log.New(w, "", log.LstdFlags|log.Lmicroseconds)
}
