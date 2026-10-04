// Package paths derives every location the launcher touches (§C1): the
// install root, swap unit, app dir, update staging, payload paths, and the
// data dir — which must equal env-paths("SerenePub",{suffix:""}).data and the
// server's planEnvLoad() override precedence exactly.
//
// Every function takes the OS as an argument so the rules for all three
// platforms are testable on one machine.
package paths

import (
	"path/filepath"
	"strings"

	"github.com/doolijb/serene-pub/launcher/internal/envfile"
)

const (
	// AppName is the env-paths name the server uses.
	AppName = "SerenePub"
	// BundleName is the macOS swap unit's name as shipped.
	BundleName = "Serene Pub.app"
	// PayloadTop is the single top-level directory of every release zip (§C12).
	PayloadTop = "serene-pub"
)

// Layout is the install the running launcher belongs to.
type Layout struct {
	GOOS         string
	InstallRoot  string // the extracted serene-pub/ (Win/Linux) or the dir containing the .app (macOS)
	SwapUnit     string // <root>/app or <root>/Serene Pub.app
	UnitName     string // "app" or the bundle's base name
	AppDir       string // the payload app/ dir: Node's cwd
	Node         string // bundled node binary
	IndexJS      string // app/build/index.js
	WindowHelper string // app/serene-pub-window[.exe]
	Staging      string // update staging dir (§C1)
	LauncherPath string // this launcher's executable (inside the bundle on macOS)
	// LauncherFile is the launcher's file name in the install root
	// (Win/Linux), the name it is parked under in <staging>/previous/.
	// Empty on macOS, where the launcher lives inside the swap unit.
	LauncherFile string
}

// CanonicalLauncherFile is the launcher's shipped file name (§C7).
func CanonicalLauncherFile(goos string) string {
	switch goos {
	case "windows":
		return "Serene Pub.exe"
	case "darwin":
		return ""
	}
	return "serene-pub"
}

func exeSuffix(goos string) string {
	if goos == "windows" {
		return ".exe"
	}
	return ""
}

// FromExecutable derives the layout from the launcher's own absolute path.
//
//	Windows/Linux: <root>/<launcher>          → swap unit <root>/app
//	macOS:         <root>/X.app/Contents/MacOS/serene-pub → swap unit <root>/X.app
func FromExecutable(goos, exe string) Layout {
	exe = filepath.Clean(exe)
	l := Layout{GOOS: goos, LauncherPath: exe}
	if goos == "darwin" {
		unit := filepath.Dir(filepath.Dir(filepath.Dir(exe))) // MacOS → Contents → X.app
		l.SwapUnit = unit
		l.UnitName = filepath.Base(unit)
		l.InstallRoot = filepath.Dir(unit)
		l.AppDir = filepath.Join(unit, "Contents", "Resources", "app")
		l.Staging = filepath.Join(l.InstallRoot, ".serene-pub-staging")
	} else {
		l.InstallRoot = filepath.Dir(exe)
		l.UnitName = "app"
		l.SwapUnit = filepath.Join(l.InstallRoot, "app")
		l.AppDir = l.SwapUnit
		l.Staging = filepath.Join(l.InstallRoot, "staging")
		l.LauncherFile = filepath.Base(exe)
	}
	l.Node = filepath.Join(l.AppDir, "node"+exeSuffix(goos))
	l.IndexJS = filepath.Join(l.AppDir, "build", "index.js")
	l.WindowHelper = filepath.Join(l.AppDir, "serene-pub-window"+exeSuffix(goos))
	return l
}

// Payload describes a staged release under <staging>/<payload>/serene-pub/.
type Payload struct {
	Root     string // <staging>/<payload>/serene-pub
	Unit     string // the swap unit to move into place
	AppDir   string
	Node     string
	IndexJS  string
	Package  string // app/package.json
	Launcher string // the new launcher (Win/Linux) — or inside the bundle on macOS
}

// PayloadPaths is where §C5 step 4 says each payload file lives.
func (l Layout) PayloadPaths(payloadDir string) Payload {
	root := filepath.Join(l.Staging, payloadDir, PayloadTop)
	p := Payload{Root: root}
	if l.GOOS == "darwin" {
		p.Unit = filepath.Join(root, BundleName)
		p.AppDir = filepath.Join(p.Unit, "Contents", "Resources", "app")
		p.Launcher = filepath.Join(p.Unit, "Contents", "MacOS", "serene-pub")
	} else {
		p.Unit = filepath.Join(root, "app")
		p.AppDir = p.Unit
		p.Launcher = filepath.Join(root, CanonicalLauncherFile(l.GOOS))
	}
	p.Node = filepath.Join(p.AppDir, "node"+exeSuffix(l.GOOS))
	p.IndexJS = filepath.Join(p.AppDir, "build", "index.js")
	p.Package = filepath.Join(p.AppDir, "package.json")
	return p
}

// Staging file names (§C1, §C5).
func (l Layout) ReadyFile() string    { return filepath.Join(l.Staging, "READY.json") }
func (l Layout) ApplyFile() string    { return filepath.Join(l.Staging, "APPLY") }
func (l Layout) SwapFile() string     { return filepath.Join(l.Staging, "SWAP.json") }
func (l Layout) PreviousDir() string  { return filepath.Join(l.Staging, "previous") }
func (l Layout) FailedDir() string    { return filepath.Join(l.Staging, "failed") }
func (l Layout) PreviousUnit() string { return filepath.Join(l.PreviousDir(), l.UnitName) }
func (l Layout) FailedUnit() string   { return filepath.Join(l.FailedDir(), l.UnitName) }

// PreviousLauncher is where a self-replacing launcher parks its old binary.
func (l Layout) PreviousLauncher() string {
	return filepath.Join(l.PreviousDir(), l.LauncherFile)
}

// DefaultDataDir is env-paths("SerenePub", {suffix: ""}).data.
func DefaultDataDir(goos string, getenv func(string) string, home string) string {
	switch goos {
	case "windows":
		local := getenv("LOCALAPPDATA")
		if local == "" {
			local = filepath.Join(home, "AppData", "Local")
		}
		return filepath.Join(local, AppName, "Data")
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", AppName)
	}
	data := getenv("XDG_DATA_HOME")
	if data == "" {
		data = filepath.Join(home, ".local", "share")
	}
	return filepath.Join(data, AppName)
}

// DataDirSource names which rule decided the data dir.
type DataDirSource string

const (
	SourceEnvironment DataDirSource = "environment"
	SourceInstallEnv  DataDirSource = "install-env"
	SourceDefault     DataDirSource = "default"
)

// ResolveDataDir mirrors planEnvLoad() in src/lib/server/config/preloadEnv.js:
// real env SERENE_PUB_DATA_DIR → SERENE_PUB_DATA_DIR in the legacy .env (the
// install root's, else Node's cwd app/ — first existing file wins, never
// merged) → the OS default. A relative value is anchored to the install root.
func ResolveDataDir(l Layout, getenv func(string) string, home string, readFile func(string) (string, bool)) (string, DataDirSource) {
	raw, source := DefaultDataDir(l.GOOS, getenv, home), SourceDefault
	if v := getenv("SERENE_PUB_DATA_DIR"); v != "" {
		raw, source = v, SourceEnvironment
	} else {
		candidates := []string{filepath.Join(l.InstallRoot, ".env")}
		if cwdEnv := filepath.Join(l.AppDir, ".env"); cwdEnv != candidates[0] {
			candidates = append(candidates, cwdEnv)
		}
		for _, c := range candidates {
			src, ok := readFile(c)
			if !ok {
				continue
			}
			if v := envfile.Parse(src)["SERENE_PUB_DATA_DIR"]; v != "" {
				raw, source = v, SourceInstallEnv
			}
			break // the first existing legacy file is the one in effect
		}
	}
	if !isAbs(l.GOOS, raw) {
		raw = filepath.Join(l.InstallRoot, raw)
	}
	return filepath.Clean(raw), source
}

func isAbs(goos, p string) bool {
	if goos == "windows" {
		// filepath.IsAbs is host-specific; accept drive and UNC forms explicitly.
		if len(p) >= 3 && p[1] == ':' && (p[2] == '\\' || p[2] == '/') {
			return true
		}
		return strings.HasPrefix(p, `\\`) || filepath.IsAbs(p)
	}
	return strings.HasPrefix(p, "/")
}

// DataFiles are the launcher-relevant files inside <dataDir> (§C1).
type DataFiles struct {
	Dir, Runtime, Lock, State, Env, Logs, LauncherLog, ServerLog, ServerLogPrev string
}

// Files lists the files under dataDir.
func Files(dataDir string) DataFiles {
	logs := filepath.Join(dataDir, "logs")
	return DataFiles{
		Dir:           dataDir,
		Runtime:       filepath.Join(dataDir, "runtime.json"),
		Lock:          filepath.Join(dataDir, "launcher.lock"),
		State:         filepath.Join(dataDir, "launcher.json"),
		Env:           filepath.Join(dataDir, ".env"),
		Logs:          logs,
		LauncherLog:   filepath.Join(logs, "launcher.log"),
		ServerLog:     filepath.Join(logs, "server.log"),
		ServerLogPrev: filepath.Join(logs, "server.1.log"),
	}
}
