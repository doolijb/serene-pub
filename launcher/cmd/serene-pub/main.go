// Command serene-pub is the Serene Pub desktop launcher: a tray process that
// starts (or attaches to) the server, opens the client, and applies staged
// updates. See launcher/README.md and the contract in the distribution plan.
package main

import (
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/doolijb/serene-pub/launcher/internal/launcherstate"
	"github.com/doolijb/serene-pub/launcher/internal/logx"
	"github.com/doolijb/serene-pub/launcher/internal/paths"
	"github.com/doolijb/serene-pub/launcher/internal/proc"
	"github.com/doolijb/serene-pub/launcher/internal/supervisor"
	"github.com/doolijb/serene-pub/launcher/internal/tray"
)

// Baked with -ldflags -X (§C7).
var (
	version = "0.0.0-dev" // package.json version
	channel = ""          // portable | installer | dmg | appimage | homebrew | prerelease | dev
	target  = ""          // linux-x64 | windows-x64 | macos-x64 | macos-arm64
	commit  = ""
)

// The tray (and the macOS run loop) must own the main thread.
func init() { runtime.LockOSThread() }

func main() { os.Exit(run()) }

func defaultTarget() string {
	arch := map[string]string{"amd64": "x64", "arm64": "arm64"}[runtime.GOARCH]
	osName := map[string]string{"linux": "linux", "windows": "windows", "darwin": "macos"}[runtime.GOOS]
	return osName + "-" + arch
}

func run() (code int) {
	attachOnly := flag.Bool("attach", false, "never start the server; attach to a running one")
	afterUpdate := flag.String("after-update", "", "finish an update to `tag` (set by the previous launcher)")
	noOpen := flag.Bool("no-open", false, "do not open a client")
	showVersion := flag.Bool("version", false, "print version, channel and target")
	flag.Parse()
	if channel == "" {
		channel = "dev"
	}
	if target == "" {
		target = defaultTarget()
	}
	if *showVersion {
		fmt.Println(version, channel, target)
		return 0
	}

	exe, err := os.Executable()
	if err == nil {
		exe, err = filepath.EvalSymlinks(exe)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "serene-pub: cannot locate own executable:", err)
		return 1
	}
	layout := paths.FromExecutable(runtime.GOOS, exe)
	home, _ := os.UserHomeDir()
	dataDir, source := paths.ResolveDataDir(layout, os.Getenv, home, func(p string) (string, bool) {
		b, err := os.ReadFile(p)
		return string(b), err == nil
	})
	files := paths.Files(dataDir)
	if err := os.MkdirAll(files.Logs, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "serene-pub: cannot create", files.Logs, err)
		return 1
	}
	logw, err := logx.Open(files.LauncherLog, logx.MaxBytes)
	if err != nil {
		fmt.Fprintln(os.Stderr, "serene-pub: cannot open launcher.log:", err)
		return 1
	}
	defer logw.Close()
	logger := logx.New(logw)
	log.SetOutput(logw) // the tray library logs through the standard logger
	logger.Printf("launcher %s channel=%s target=%s commit=%s pid=%d", version, channel, target, commit, os.Getpid())
	logger.Printf("install root %s; swap unit %s; staging %s", layout.InstallRoot, layout.SwapUnit, layout.Staging)
	logger.Printf("data dir %s (%s)", dataDir, source)

	opts := supervisor.Options{
		Layout: layout, Files: files, Version: version, Channel: channel, Target: target,
		Attach: *attachOnly, AfterUpdate: *afterUpdate, NoOpen: *noOpen, Log: logger,
	}

	release, err := proc.Lock(files.Lock)
	if errors.Is(err, proc.ErrLocked) {
		// Another launcher owns this data dir: open its client and leave.
		logger.Printf("another launcher is running; opening its client")
		s := supervisor.New(opts)
		if !*noOpen && s.WaitForRuntime(30*time.Second) {
			s.OpenDefaultAndWait("")
		}
		return 0
	}
	if err != nil {
		logger.Printf("launcher.lock: %v", err)
		return 1
	}
	defer release()
	if st := launcherstate.Load(files.State); st.LastSeenVersion != version {
		st.LastSeenVersion = version
		if err := launcherstate.Save(files.State, st); err != nil {
			logger.Printf("launcher.json: %v", err)
		}
	}

	var (
		exitOnce sync.Once
		exitCode int
		exiting  = make(chan struct{})
		trayUp   atomic.Bool
	)
	opts.Exit = func(c int) {
		exitOnce.Do(func() {
			logger.Printf("launcher exiting (%d)", c)
			exitCode = c
			close(exiting)
			if !trayUp.Load() {
				// No tray to remove; its loop may never return (§C9).
				release()
				os.Exit(c)
			}
			// Removing the icon cleanly matters on Windows (a stale icon
			// lingers until hovered). Never wait on it for long.
			time.AfterFunc(3*time.Second, func() { release(); os.Exit(c) })
			tray.Stop()
		})
	}
	sup := supervisor.New(opts)
	t := tray.New(sup)
	sup.SetOnStatus(t.Publish)

	// A logout / Ctrl+C / kill is a Quit: stop the server gracefully.
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM)
	go func() {
		s := <-sigs
		logger.Printf("signal %v: quitting", s)
		sup.Quit()
	}()

	defer func() {
		if r := recover(); r != nil {
			// e.g. the tray library tearing down without a D-Bus session.
			logger.Printf("tray: %v", r)
			code = exitCode
		}
	}()
	// The server never waits on the tray (§C9): a tray that cannot register
	// (Windows with no notification area — headless wine) never signals
	// ready, so after tray.ReadyTimeout the launcher runs without one.
	t.Run(tray.ReadyTimeout, tray.Hooks{
		Start: sup.Run,
		Ready: func() {
			trayUp.Store(true)
			sup.SetTrayAvailable(true)
			t.Publish(sup.Status()) // a late tray shows the current state
		},
		Unavailable: func() {
			logger.Printf("tray unavailable (not ready within %s); running without it — it ends when the server stops, on a signal, or when its window is closed", tray.ReadyTimeout)
			sup.SetTrayAvailable(false)
		},
	})
	select {
	case <-exiting:
	default:
		// The tray loop ended without a Quit (e.g. a Windows message-loop
		// failure). Keep serving without a tray until something quits.
		logger.Printf("tray: event loop ended; running without a tray")
		trayUp.Store(false)
		sup.SetTrayAvailable(false)
		<-exiting
	}
	return exitCode
}
