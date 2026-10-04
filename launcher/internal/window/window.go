// Package window opens the client: the window helper (serene-pub-window, a
// separate binary in the swap unit's app/, §C9) or the default browser, and
// tracks the helper processes this launcher owns so an update can close them
// before the swap unit is renamed.
package window

import (
	"log"
	"sync"
	"time"

	"github.com/doolijb/serene-pub/launcher/internal/opener"
	"github.com/doolijb/serene-pub/launcher/internal/proc"
)

// Client kinds (DEFAULT_CLIENT values).
const (
	Window  = "window"
	Browser = "browser"
)

// HelperExitNoRuntime is the helper's exit code for "no webview runtime".
const HelperExitNoRuntime = 3

// QuickFail is how soon a non-zero helper exit counts as "window unavailable"
// (a Linux box without WebKitGTK fails in the dynamic loader).
const QuickFail = 3 * time.Second

// Manager opens clients and owns the helper processes.
type Manager struct {
	Helper string // absolute path of serene-pub-window[.exe]
	Log    *log.Logger
	// Unavailable is called once when the helper proves unusable; the caller
	// records windowUnavailable in launcher.json.
	Unavailable func()
	// OpenBrowser defaults to opener.Open.
	OpenBrowser func(url string) error
	// Spawn defaults to proc.SpawnHelper.
	Spawn func(path string, args ...string) (Helper, error)
	// Wait is how long to watch a fresh helper; defaults to QuickFail.
	Wait time.Duration
	// LastClosed, when set, is called when the user closes the last tracked
	// helper window (exit 0, not ended by CloseAll). The trayless launcher
	// quits on it (§C9).
	LastClosed func()

	mu      sync.Mutex
	helpers map[Helper]struct{}
	killed  map[Helper]struct{}
}

// Helper is a running helper process.
type Helper interface {
	Done() <-chan struct{}
	ExitCode() int
	Kill() error
}

func (m *Manager) init() {
	if m.OpenBrowser == nil {
		m.OpenBrowser = opener.Open
	}
	if m.Spawn == nil {
		m.Spawn = func(p string, a ...string) (Helper, error) { return proc.SpawnHelper(p, a...) }
	}
	if m.Wait == 0 {
		m.Wait = QuickFail
	}
	if m.helpers == nil {
		m.helpers = map[Helper]struct{}{}
	}
	if m.killed == nil {
		m.killed = map[Helper]struct{}{}
	}
}

// Browser opens url in the default browser.
func (m *Manager) Browser(url string) {
	m.init()
	if err := m.OpenBrowser(url); err != nil {
		m.Log.Printf("window: open browser: %v", err)
	}
}

// Window opens url in the window helper, falling back to the browser when the
// helper cannot start or exits non-zero within QuickFail. It blocks for at
// most QuickFail and reports whether the window came up.
func (m *Manager) Window(url string) bool {
	m.init()
	h, err := m.Spawn(m.Helper, "--url", url, "--title", "Serene Pub")
	if err != nil {
		m.Log.Printf("window: helper did not start: %v; using the browser", err)
		m.unavailable(url)
		return false
	}
	select {
	case <-h.Done():
		if code := h.ExitCode(); code != 0 {
			m.Log.Printf("window: helper exited %d at once; using the browser", code)
			m.unavailable(url)
			return false
		}
		return true // closed by the user that fast — fine
	case <-time.After(m.Wait):
	}
	m.mu.Lock()
	m.helpers[h] = struct{}{}
	m.mu.Unlock()
	go func() {
		<-h.Done()
		m.mu.Lock()
		delete(m.helpers, h)
		_, killed := m.killed[h]
		delete(m.killed, h)
		last := len(m.helpers) == 0 && !killed && h.ExitCode() == 0
		m.mu.Unlock()
		if last && m.LastClosed != nil {
			m.LastClosed()
		}
	}()
	return true
}

func (m *Manager) unavailable(url string) {
	if m.Unavailable != nil {
		m.Unavailable()
	}
	m.Browser(url)
}

// CloseAll ends every helper this launcher started (§C8 step 2) and waits
// briefly for them to go. Helpers hold no data; force-stopping one is safe.
func (m *Manager) CloseAll() {
	m.init()
	m.mu.Lock()
	hs := make([]Helper, 0, len(m.helpers))
	for h := range m.helpers {
		hs = append(hs, h)
		m.killed[h] = struct{}{}
	}
	m.mu.Unlock()
	for _, h := range hs {
		h.Kill()
		select {
		case <-h.Done():
		case <-time.After(5 * time.Second):
			m.Log.Printf("window: a helper did not exit")
		}
	}
}

// Count is the number of open helper windows.
func (m *Manager) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.helpers)
}
