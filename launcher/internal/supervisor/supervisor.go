// Package supervisor is the launcher's brain: attach-or-start (§C6), watching
// the server, reacting to its exit codes (§C4), driving the update state
// machine (§C8), opening clients, and graceful Quit. The tray is a thin view
// over it.
package supervisor

import (
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/doolijb/serene-pub/launcher/internal/control"
	"github.com/doolijb/serene-pub/launcher/internal/envfile"
	"github.com/doolijb/serene-pub/launcher/internal/launcherstate"
	"github.com/doolijb/serene-pub/launcher/internal/opener"
	"github.com/doolijb/serene-pub/launcher/internal/paths"
	"github.com/doolijb/serene-pub/launcher/internal/proc"
	"github.com/doolijb/serene-pub/launcher/internal/runtimefile"
	"github.com/doolijb/serene-pub/launcher/internal/update"
	"github.com/doolijb/serene-pub/launcher/internal/window"
)

// State is the server's state as the tray shows it.
type State string

const (
	StateStarting State = "starting"
	StateRunning  State = "running"
	StateUpdating State = "updating" // swap in progress / finishing update
	StateStopped  State = "stopped"  // exit 0: Start offered
	StateError    State = "error"    // crash / never came up: Restart + View Logs
	StateStopping State = "stopping"
)

// Status is published to the tray on every change.
type Status struct {
	State State
	Text  string // the status line
	// CanRollBack: "Roll back now" is offered (finishing an update).
	CanRollBack bool
	// Notice is a one-off message (update applied/discarded/rolled back…).
	Notice string
}

// Options configure a supervisor.
type Options struct {
	Layout      paths.Layout
	Files       paths.DataFiles
	Version     string
	Channel     string
	Target      string
	Attach      bool   // --attach: never spawn
	AfterUpdate string // --after-update=<tag>
	NoOpen      bool   // --no-open
	Log         *log.Logger
	OnStatus    func(Status)
	// Exit ends the launcher process (tray quit + os.Exit) with code.
	Exit func(code int)
	// Codesign / SpawnLauncher are injectable for tests; nil → real.
	Codesign      func(bundle string) error
	SpawnLauncher func(path string, args []string) error
}

// Supervisor owns one server at a time.
type Supervisor struct {
	o       Options
	srv     *realServer
	machine *update.Machine
	win     *window.Manager

	mu       sync.Mutex
	status   Status
	proc     update.Proc
	rt       *runtimefile.Runtime
	quitting bool
	// trayless: the tray never came up (§C9). Nothing can restart a stopped
	// server from here, so a stop ends the launcher, and closing its last
	// window quits.
	trayless atomic.Bool

	cmds        chan func()
	rollbackNow chan struct{}
	gateCancel  chan struct{}
}

// New wires a supervisor to the real world.
func New(o Options) *Supervisor {
	s := &Supervisor{o: o, cmds: make(chan func(), 16)}
	s.srv = &realServer{
		layout: o.Layout, files: o.Files, log: o.Log, stopMax: 30 * time.Second,
		env: ChildEnv(os.Environ(), o.Layout, o.Version, o.Channel, o.Target),
	}
	s.win = &window.Manager{
		Helper: o.Layout.WindowHelper, Log: o.Log,
		Unavailable: func() {
			st := launcherstate.Load(o.Files.State)
			st.WindowUnavailable = o.Version
			if err := launcherstate.Save(o.Files.State, st); err != nil {
				o.Log.Printf("launcher.json: %v", err)
			}
		},
		LastClosed: s.onLastWindowClosed,
	}
	if o.Codesign == nil {
		o.Codesign = codesign
	}
	if o.SpawnLauncher == nil {
		o.SpawnLauncher = func(p string, args []string) error {
			return proc.SpawnDetached(p, o.Layout.InstallRoot, args...)
		}
	}
	s.o = o
	s.machine = s.newMachine()
	return s
}

func (s *Supervisor) newMachine() *update.Machine {
	var carry []string
	if s.o.NoOpen {
		carry = append(carry, "--no-open")
	}
	cancel := make(chan struct{})
	s.mu.Lock()
	s.rollbackNow = cancel
	s.mu.Unlock()
	return update.New(update.Config{
		Layout: s.o.Layout, Version: s.o.Version, Channel: s.o.Channel, Target: s.o.Target,
		Server: s.srv, Codesign: s.o.Codesign, SpawnLauncher: s.o.SpawnLauncher, LauncherArgs: carry,
		CloseWindows: s.win.CloseAll, Log: s.o.Log, Notify: s.onNotice,
		Gate: update.GateOptions{Cancel: cancel},
	})
}

// runMachine runs the update state machine, with a fresh "Roll back now"
// channel when the last one was used.
func (s *Supervisor) runMachine() update.Result {
	s.mu.Lock()
	used := false
	select {
	case <-s.rollbackNow:
		used = true
	default:
	}
	s.mu.Unlock()
	if used {
		s.machine = s.newMachine()
	}
	return s.machine.Run()
}

func (s *Supervisor) logf(format string, args ...any) { s.o.Log.Printf(format, args...) }

func (s *Supervisor) setStatus(st Status) {
	s.mu.Lock()
	s.status = st
	f := s.o.OnStatus
	idle := s.proc == nil && (st.State == StateStopped || st.State == StateError)
	s.mu.Unlock()
	if f != nil {
		f(st)
	}
	if idle && s.trayless.Load() {
		// No tray to offer Start / Restart / View Logs: staying would leave
		// a launcher nothing can drive (a second launch only opens a client).
		code := 0
		if st.State == StateError {
			code = 1
		}
		s.logf("no tray: %q with no server; exiting", st.Text)
		s.o.Exit(code)
	}
}

// SetTrayAvailable records whether the tray came up (§C9). Without one the
// launcher keeps running: quit is the app's shutdown, a signal, or closing
// the last window it opened. Recorded as trayUnavailable in launcher.json.
func (s *Supervisor) SetTrayAvailable(ok bool) {
	s.trayless.Store(!ok)
	st := launcherstate.Load(s.o.Files.State)
	switch {
	case !ok && st.TrayUnavailable != s.o.Version:
		st.TrayUnavailable = s.o.Version
	case ok && st.TrayUnavailable != "":
		st.TrayUnavailable = ""
	default:
		return
	}
	if err := launcherstate.Save(s.o.Files.State, st); err != nil {
		s.logf("launcher.json: %v", err)
	}
}

// onLastWindowClosed: the user closed the last window this launcher opened.
// With a tray that is nothing; without one the window was the only way in,
// so closing it quits.
func (s *Supervisor) onLastWindowClosed() {
	if s.trayless.Load() {
		s.logf("no tray: last window closed; quitting")
		s.Quit()
	}
}

func (s *Supervisor) onNotice(n update.Notice) {
	s.mu.Lock()
	st := s.status
	s.mu.Unlock()
	switch n.Kind {
	case update.Progress:
		st.State, st.Text, st.Notice = StateUpdating, n.Text, ""
		st.CanRollBack = n.Text == update.MsgFinishing
	default:
		st.Notice = n.Text
	}
	s.setStatus(st)
}

// Status returns the current status.
func (s *Supervisor) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.status
}

// Runtime is the runtime file of the server being watched (nil if none).
func (s *Supervisor) Runtime() *runtimefile.Runtime {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.rt
}

// ---- main loop -------------------------------------------------------------

// Run is the supervisor goroutine. It returns only via Options.Exit.
func (s *Supervisor) Run() {
	if s.o.AfterUpdate != "" {
		s.machine.Finish(s.o.AfterUpdate)
	}
	rt := s.srv.Runtime()
	switch {
	case Decide(rt, proc.Alive, s.healthRetry) == Attach:
		s.logf("attach: server pid %d (%s)", rt.Pid, rt.Version)
		p := attach(rt.Pid, proc.Alive, time.Second)
		s.own(p, rt)
		if res, ok := s.machine.ResumeAttached(p); ok {
			s.handleResult(res)
		} else {
			s.setStatus(Status{State: StateRunning, Text: runningText(rt)})
		}
		// --attach alone is a launcher handing over to itself mid-update
		// without one: nothing to open. Otherwise the open-after rules.
		if !s.o.Attach || s.o.AfterUpdate != "" {
			go s.openAfter(rt, "attach")
		}
	case s.o.Attach:
		s.logf("attach: no live server; --attach never spawns")
		s.setStatus(Status{State: StateStopped, Text: "Stopped"})
	default:
		s.startFlow(true)
	}
	s.loop()
}

func (s *Supervisor) healthRetry(rt *runtimefile.Runtime) (control.Health, error) {
	var h control.Health
	var err error
	for i := 0; i < 3; i++ {
		h, err = s.srv.Health(ctxTimeout(5*time.Second), rt)
		if err == nil || errors.Is(err, control.ErrRefused) {
			return h, err
		}
		time.Sleep(time.Second)
	}
	return h, err
}

func (s *Supervisor) loop() {
	for {
		s.mu.Lock()
		p := s.proc
		s.mu.Unlock()
		if p == nil {
			(<-s.cmds)()
			continue
		}
		select {
		case <-p.Done():
			s.onExit(p.ExitCode())
		case c := <-s.cmds:
			c()
		}
	}
}

func (s *Supervisor) own(p update.Proc, rt *runtimefile.Runtime) {
	s.mu.Lock()
	s.proc, s.rt = p, rt
	s.mu.Unlock()
}

// startFlow: markers first (§C8 at-start case), then a plain spawn.
func (s *Supervisor) startFlow(initial bool) {
	res := s.runMachine()
	if s.handleResult(res) {
		return
	}
	mode := openNever
	if initial {
		mode = openIfAuto
	}
	if res.Action != update.ActNone {
		// An update attempt closed the launcher's windows: reopen by the
		// open-after rules (setting on, nobody connected).
		mode = openAfterUpdate
	}
	s.spawnPlain(mode)
}

type openMode int

const (
	openNever openMode = iota
	// openIfAuto: AUTO_OPEN_CLIENT decides (a plain start).
	openIfAuto
	// openAfterUpdate: AUTO_OPEN_CLIENT decides, and not while a client is
	// connected (shouldOpenAfter).
	openAfterUpdate
)

// handleResult applies an update.Result; true when nothing more is needed.
func (s *Supervisor) handleResult(res update.Result) bool {
	if res.Action != update.ActNone {
		s.logf("update: %s %s", res.Action, res.Tag)
	}
	if res.Exit {
		s.logf("exiting for the new launcher")
		s.o.Exit(0)
		return true
	}
	switch res.Action {
	case update.ActApplied:
		if res.Proc != nil {
			s.own(res.Proc, res.Runtime)
			s.setStatus(Status{State: StateRunning, Text: runningText(res.Runtime),
				Notice: fmt.Sprintf("Updated to %s", res.Tag)})
			go s.openAfter(res.Runtime, "update applied")
			return true
		}
	case update.ActBroken:
		s.setStatus(Status{State: StateError, Text: update.MsgAppMissing})
		return true
	}
	s.mu.Lock()
	quitting := s.quitting
	s.mu.Unlock()
	if quitting {
		s.o.Exit(0)
		return true
	}
	return false
}

// spawnPlain starts the current app and gates it (normal-start rules, §C8 end).
func (s *Supervisor) spawnPlain(mode openMode) {
	s.mu.Lock()
	quitting := s.quitting
	s.mu.Unlock()
	if quitting {
		s.o.Exit(0)
		return
	}
	s.setStatus(Status{State: StateStarting, Text: "Starting…"})
	p, err := s.srv.Spawn()
	if err != nil {
		s.logf("spawn: %v", err)
		s.setStatus(Status{State: StateError, Text: "Serene Pub couldn't start — see View Logs"})
		return
	}
	s.own(p, nil)
	s.mu.Lock()
	s.gateCancel = make(chan struct{})
	cancel := s.gateCancel
	s.mu.Unlock()
	g := update.Gate(s.srv, p, update.GateOptions{
		Cancel:     cancel,
		OnStarting: func() { s.setStatus(Status{State: StateStarting, Text: "Starting… (preparing your data)"}) },
	})
	s.logf("start gate: %s %s", g.Outcome, g.Reason)
	s.mu.Lock()
	s.rt, s.gateCancel = g.Runtime, nil
	s.mu.Unlock()
	switch g.Outcome {
	case update.Healthy:
		s.setStatus(Status{State: StateRunning, Text: runningText(g.Runtime)})
		switch mode {
		case openIfAuto:
			if !s.o.NoOpen && s.prefs().AutoOpen {
				s.OpenDefault("")
			}
		case openAfterUpdate:
			go s.openAfter(g.Runtime, "after update")
		}
	case update.Recovery:
		s.setStatus(Status{State: StateRunning, Text: "Running in recovery mode"})
		if !s.o.NoOpen {
			s.OpenDefault("/recovery")
		}
	case update.Cancelled:
		// Quit during start: the quit command is queued.
	case update.Failed:
		select {
		case <-p.Done():
			// onExit reports it from the loop.
		default:
			if g.Health.State == control.StateFailed {
				// Running, but a startup task it cannot do without failed.
				// Left running: Quit and Restart still work, and the log
				// says what broke.
				s.setStatus(Status{State: StateError, Text: "Serene Pub started with errors — see View Logs"})
			} else {
				s.setStatus(Status{State: StateError, Text: "Serene Pub didn't start within 60 seconds — see View Logs"})
			}
		}
	}
}

// onExit is §C4: markers decide first; then the exit code.
func (s *Supervisor) onExit(code int) {
	s.mu.Lock()
	s.proc, s.rt = nil, nil
	quitting := s.quitting
	s.mu.Unlock()
	s.logf("server exited (code %d)", code)
	if quitting {
		s.o.Exit(0)
		return
	}
	if code == 75 {
		s.logf("exit 75: update requested")
	}
	res := s.runMachine()
	if res.Action != update.ActNone {
		if !s.handleResult(res) {
			s.spawnPlain(openAfterUpdate)
		}
		return
	}
	switch code {
	case 0, -1:
		s.setStatus(Status{State: StateStopped, Text: "Stopped"})
	case 76:
		s.spawnPlain(openNever)
	case 75:
		s.setStatus(Status{State: StateStopped, Text: "Stopped"})
	default:
		s.setStatus(Status{State: StateError, Text: fmt.Sprintf("Stopped unexpectedly (exit %d)", code)})
	}
}

// ---- tray actions ----------------------------------------------------------

func (s *Supervisor) prefs() Prefs {
	l := s.o.Layout
	return LoadPrefs(os.LookupEnv, []string{
		s.o.Files.Env, l.InstallRoot + string(os.PathSeparator) + ".env", l.AppDir + string(os.PathSeparator) + ".env",
	})
}

// Prefs for the tray.
func (s *Supervisor) Prefs() Prefs { return s.prefs() }

// SetAutoOpen writes AUTO_OPEN_CLIENT to <dataDir>/.env.
func (s *Supervisor) SetAutoOpen(on bool) error {
	v := "0"
	if on {
		v = "1"
	}
	return envfile.Set(s.o.Files.Env, "AUTO_OPEN_CLIENT", v, os.LookupEnv)
}

// SetDefault writes DEFAULT_CLIENT to <dataDir>/.env.
func (s *Supervisor) SetDefault(client string) error {
	return envfile.Set(s.o.Files.Env, "DEFAULT_CLIENT", client, os.LookupEnv)
}

func (s *Supervisor) openURL(path string) (string, bool) {
	rt := s.Runtime()
	if rt == nil {
		rt = s.srv.Runtime()
	}
	if rt == nil {
		return "", false
	}
	return strings.TrimRight(rt.OpenURL, "/") + path, true
}

// OpenDefault opens the default client at path ("" or "/recovery"…).
func (s *Supervisor) OpenDefault(path string) { s.openDefault(path, false) }

// OpenDefaultAndWait is OpenDefault for a process about to exit (the second
// launcher instance): it waits out the window helper's quick-fail window.
func (s *Supervisor) OpenDefaultAndWait(path string) { s.openDefault(path, true) }

func (s *Supervisor) openDefault(path string, wait bool) {
	if s.prefs().Default == window.Browser ||
		launcherstate.Load(s.o.Files.State).WindowUnavailable == s.o.Version {
		s.OpenBrowser(path)
		return
	}
	s.openWindow(path, wait)
}

// OpenWindow opens the window helper (browser fallback).
func (s *Supervisor) OpenWindow(path string) { s.openWindow(path, false) }

func (s *Supervisor) openWindow(path string, wait bool) {
	u, ok := s.openURL(path)
	if !ok {
		s.logf("open: no running server to open")
		return
	}
	if wait {
		s.win.Window(u)
	} else {
		go s.win.Window(u)
	}
}

// WaitForRuntime polls for a runtime file naming a live process (the second
// instance, while the first launcher is still starting the server).
func (s *Supervisor) WaitForRuntime(d time.Duration) bool {
	deadline := time.Now().Add(d)
	for {
		if rt := s.srv.Runtime(); rt != nil && proc.Alive(rt.Pid) {
			return true
		}
		if time.Now().After(deadline) {
			return false
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// OpenBrowser opens the default browser.
func (s *Supervisor) OpenBrowser(path string) {
	if u, ok := s.openURL(path); ok {
		s.win.Browser(u)
	} else {
		s.logf("open: no running server to open")
	}
}

// ViewLogs opens <dataDir>/logs in the file manager.
func (s *Supervisor) ViewLogs() {
	os.MkdirAll(s.o.Files.Logs, 0o755)
	if err := opener.Open(s.o.Files.Logs); err != nil {
		s.logf("view logs: %v", err)
	}
}

// Start (or Restart) a stopped server. Restart also covers a server that is
// still running but in error (it never answered ready, or started with
// errors): it is stopped gracefully first.
func (s *Supervisor) Start() {
	s.cmds <- func() {
		s.mu.Lock()
		p, rt, state := s.proc, s.rt, s.status.State
		s.mu.Unlock()
		if p != nil {
			if state != StateError {
				return
			}
			s.setStatus(Status{State: StateStopping, Text: "Stopping…"})
			if err := s.srv.Stop(rt, p); err != nil {
				s.logf("restart: %v — leaving the server running", err)
				s.setStatus(Status{State: StateError, Text: "Couldn't stop Serene Pub to restart it — see View Logs"})
				return
			}
			s.own(nil, nil)
		}
		s.startFlow(false)
	}
}

// RollbackNow ends a "Finishing update…" health gate with a rollback.
func (s *Supervisor) RollbackNow() {
	s.mu.Lock()
	defer s.mu.Unlock()
	select {
	case <-s.rollbackNow:
	default:
		close(s.rollbackNow)
	}
}

// Quit asks the server to stop gracefully (≤ 30 s; POSIX SIGTERM fallback;
// never SIGKILL), closes the windows, and exits. During an update it waits
// for the update to finish first.
func (s *Supervisor) Quit() {
	s.mu.Lock()
	s.quitting = true
	if s.gateCancel != nil {
		close(s.gateCancel)
		s.gateCancel = nil
	}
	updating := s.status.State == StateUpdating
	s.mu.Unlock()
	if updating {
		s.setStatus(Status{State: StateUpdating, Text: "Will quit when the update finishes"})
	}
	s.cmds <- func() {
		s.mu.Lock()
		p, rt := s.proc, s.rt
		s.mu.Unlock()
		s.win.CloseAll()
		if p != nil {
			s.setStatus(Status{State: StateStopping, Text: "Stopping…"})
			if err := s.srv.Stop(rt, p); err != nil {
				s.logf("quit: %v — leaving the server running", err)
			}
		}
		s.o.Exit(0)
	}
}

func runningText(rt *runtimefile.Runtime) string {
	if rt == nil {
		return "Running"
	}
	return "Running at " + rt.OpenURL
}

// SetOnStatus sets the status callback (the tray is built after the supervisor).
func (s *Supervisor) SetOnStatus(f func(Status)) {
	s.mu.Lock()
	s.o.OnStatus = f
	s.mu.Unlock()
}
