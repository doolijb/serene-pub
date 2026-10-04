// Package tray is the launcher's system-tray icon and menu (§C9) on
// fyne.io/systray (D-Bus StatusNotifierItem on Linux — no cgo, no
// libappindicator). It is a thin view over the supervisor.
package tray

import (
	"runtime"
	"sync"
	"time"

	"fyne.io/systray"

	"github.com/doolijb/serene-pub/launcher/assets"
	"github.com/doolijb/serene-pub/launcher/internal/supervisor"
)

// Menu labels (user-facing; recorded for NOMENCLATURE §25 by Lane B).
const (
	LabelOpen          = "Open"
	LabelOpenWindow    = "Open Window"
	LabelOpenBrowser   = "Open Browser"
	LabelOpenOnStart   = "Open on start"
	LabelDefaultWindow = "Default: Window"
	LabelDefaultBrowse = "Default: Browser"
	LabelViewLogs      = "View Logs"
	LabelSettings      = "Settings"
	LabelStart         = "Start"
	LabelRestart       = "Restart"
	LabelRollBack      = "Roll back now"
	LabelQuit          = "Quit"
	TipSetBySystem     = "Set by your system"
)

// Actions is what the menu drives (the supervisor).
type Actions interface {
	OpenDefault(path string)
	OpenWindow(path string)
	OpenBrowser(path string)
	ViewLogs()
	Start()
	RollbackNow()
	Quit()
	Prefs() supervisor.Prefs
	SetAutoOpen(bool) error
	SetDefault(string) error
}

// Tray holds the menu items.
type Tray struct {
	a                                  Actions
	status, notice, start, rollback    *systray.MenuItem
	openOnStart, defWindow, defBrowser *systray.MenuItem
	updates                            chan supervisor.Status
}

// New creates a tray for a.
func New(a Actions) *Tray { return &Tray{a: a, updates: make(chan supervisor.Status, 16)} }

// Publish queues a status change (safe from any goroutine, before or after
// the tray is ready).
func (t *Tray) Publish(st supervisor.Status) {
	select {
	case t.updates <- st:
	default: // never block the supervisor on a slow tray
	}
}

// ReadyTimeout is how long Run waits for the tray before starting without
// it. On Windows a tray that cannot register (no shell notification area —
// seen under headless wine) never signals ready.
const ReadyTimeout = 5 * time.Second

// Hooks are what Run calls as the tray comes up — or doesn't. Every field is
// optional. Ready and Unavailable never run concurrently.
type Hooks struct {
	// Start runs once, on its own goroutine: when the tray is ready, or after
	// the ready timeout if it is not. The server never waits on the tray.
	Start func()
	// Unavailable runs when the tray is not ready within the timeout.
	Unavailable func()
	// Ready runs when the tray exists — also late, after Unavailable.
	Ready func()
}

// Run shows the tray and blocks until Quit (systray.Quit) — or forever when
// the tray never comes up (the caller's exit path ends the process then).
// Must be called on the main goroutine (macOS run loop; the Windows message
// loop is bound to the thread that registered the icon).
func (t *Tray) Run(timeout time.Duration, h Hooks) {
	runGated(func(onReady func()) { systray.Run(onReady, func() {}) }, t.build, timeout, h)
}

// runGated is Run with the tray library factored out: loop runs the tray
// event loop and calls onReady once the tray exists; build fills the menu.
func runGated(loop func(onReady func()), build func(), timeout time.Duration, h Hooks) {
	var (
		mu        sync.Mutex
		up        bool
		startOnce sync.Once
	)
	start := func() {
		startOnce.Do(func() {
			if h.Start != nil {
				go h.Start()
			}
		})
	}
	timer := time.AfterFunc(timeout, func() {
		mu.Lock()
		defer mu.Unlock()
		if up {
			return
		}
		if h.Unavailable != nil {
			h.Unavailable()
		}
		start()
	})
	loop(func() {
		build()
		timer.Stop()
		mu.Lock()
		up = true
		if h.Ready != nil {
			h.Ready()
		}
		mu.Unlock()
		start()
	})
}

// Stop ends Run.
func Stop() { systray.Quit() }

func (t *Tray) build() {
	if runtime.GOOS == "windows" {
		systray.SetIcon(assets.IconICO)
	} else {
		systray.SetIcon(assets.IconPNG)
	}
	systray.SetTitle("")
	systray.SetTooltip("Serene Pub")
	systray.SetOnTapped(func() { t.a.OpenDefault("") })

	open := systray.AddMenuItem(LabelOpen, "Open Serene Pub in your default client")
	openWin := systray.AddMenuItem(LabelOpenWindow, "Open Serene Pub in its own window")
	openBrowser := systray.AddMenuItem(LabelOpenBrowser, "Open Serene Pub in your web browser")
	systray.AddSeparator()
	p := t.a.Prefs()
	t.openOnStart = systray.AddMenuItemCheckbox(LabelOpenOnStart, "Open a client when Serene Pub starts", p.AutoOpen)
	t.defWindow = systray.AddMenuItemCheckbox(LabelDefaultWindow, "Open uses a window", p.Default == "window")
	t.defBrowser = systray.AddMenuItemCheckbox(LabelDefaultBrowse, "Open uses your web browser", p.Default == "browser")
	t.applyLocks(p)
	systray.AddSeparator()
	logs := systray.AddMenuItem(LabelViewLogs, "Open the logs folder")
	settings := systray.AddMenuItem(LabelSettings, "Open Settings")
	systray.AddSeparator()
	t.status = systray.AddMenuItem("Starting…", "")
	t.status.Disable()
	// The last one-off notice (Updated to …, Update discarded, rolled back…)
	// stays visible until the next one: the tray has no toast API.
	t.notice = systray.AddMenuItem("", "")
	t.notice.Disable()
	t.notice.Hide()
	t.start = systray.AddMenuItem(LabelStart, "Start Serene Pub")
	t.start.Hide()
	t.rollback = systray.AddMenuItem(LabelRollBack, "Stop the update and go back to the previous version")
	t.rollback.Hide()
	systray.AddSeparator()
	quit := systray.AddMenuItem(LabelQuit, "Stop Serene Pub and close the tray icon")

	go func() {
		for {
			select {
			case <-open.ClickedCh:
				t.a.OpenDefault("")
			case <-openWin.ClickedCh:
				t.a.OpenWindow("")
			case <-openBrowser.ClickedCh:
				t.a.OpenBrowser("")
			case <-t.openOnStart.ClickedCh:
				t.a.SetAutoOpen(!t.openOnStart.Checked())
				t.refreshPrefs()
			case <-t.defWindow.ClickedCh:
				t.a.SetDefault("window")
				t.refreshPrefs()
			case <-t.defBrowser.ClickedCh:
				t.a.SetDefault("browser")
				t.refreshPrefs()
			case <-logs.ClickedCh:
				t.a.ViewLogs()
			case <-settings.ClickedCh:
				t.a.OpenDefault("/settings")
			case <-t.start.ClickedCh:
				t.start.Hide()
				t.a.Start()
			case <-t.rollback.ClickedCh:
				t.rollback.Hide()
				t.a.RollbackNow()
			case <-quit.ClickedCh:
				quit.Disable()
				t.a.Quit()
			case st := <-t.updates:
				t.show(st)
			}
		}
	}()
}

func (t *Tray) refreshPrefs() {
	p := t.a.Prefs()
	setChecked(t.openOnStart, p.AutoOpen)
	setChecked(t.defWindow, p.Default == "window")
	setChecked(t.defBrowser, p.Default == "browser")
	t.applyLocks(p)
}

func (t *Tray) applyLocks(p supervisor.Prefs) {
	if p.AutoOpenLocked {
		t.openOnStart.Disable()
		t.openOnStart.SetTooltip(TipSetBySystem)
	}
	if p.DefaultLocked {
		for _, it := range []*systray.MenuItem{t.defWindow, t.defBrowser} {
			it.Disable()
			it.SetTooltip(TipSetBySystem)
		}
	}
}

func setChecked(it *systray.MenuItem, on bool) {
	if on {
		it.Check()
	} else {
		it.Uncheck()
	}
}

func (t *Tray) show(st supervisor.Status) {
	text := st.Text
	if text == "" {
		text = string(st.State)
	}
	t.status.SetTitle(text)
	systray.SetTooltip("Serene Pub — " + text)
	if st.Notice != "" {
		t.notice.SetTitle(st.Notice)
		t.notice.Show()
	}
	switch st.State {
	case supervisor.StateStopped:
		t.start.SetTitle(LabelStart)
		t.start.Show()
	case supervisor.StateError:
		t.start.SetTitle(LabelRestart)
		t.start.Show()
	default:
		t.start.Hide()
	}
	if st.CanRollBack {
		t.rollback.Show()
	} else {
		t.rollback.Hide()
	}
}
