package paths

import (
	"path/filepath"
	"testing"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func files(m map[string]string) func(string) (string, bool) {
	return func(p string) (string, bool) { s, ok := m[p]; return s, ok }
}

func TestDefaultDataDirMatchesEnvPaths(t *testing.T) {
	home := "/home/u"
	cases := []struct {
		goos string
		env  map[string]string
		want string
	}{
		{"linux", nil, filepath.Join(home, ".local", "share", "SerenePub")},
		{"linux", map[string]string{"XDG_DATA_HOME": "/xdg"}, filepath.Join("/xdg", "SerenePub")},
		{"darwin", nil, filepath.Join(home, "Library", "Application Support", "SerenePub")},
		{"windows", map[string]string{"LOCALAPPDATA": "/lad"}, filepath.Join("/lad", "SerenePub", "Data")},
		{"windows", nil, filepath.Join(home, "AppData", "Local", "SerenePub", "Data")},
	}
	for _, c := range cases {
		if got := DefaultDataDir(c.goos, env(c.env), home); got != c.want {
			t.Errorf("%s %v: got %q want %q", c.goos, c.env, got, c.want)
		}
	}
}

func TestFromExecutable(t *testing.T) {
	l := FromExecutable("linux", "/opt/serene-pub/serene-pub")
	if l.InstallRoot != "/opt/serene-pub" || l.SwapUnit != "/opt/serene-pub/app" ||
		l.Staging != "/opt/serene-pub/staging" || l.Node != "/opt/serene-pub/app/node" ||
		l.IndexJS != "/opt/serene-pub/app/build/index.js" || l.LauncherFile != "serene-pub" ||
		l.WindowHelper != "/opt/serene-pub/app/serene-pub-window" {
		t.Errorf("linux layout %+v", l)
	}
	w := FromExecutable("windows", "/c/serene-pub/Serene Pub.exe")
	if w.Node != "/c/serene-pub/app/node.exe" || w.LauncherFile != "Serene Pub.exe" ||
		w.WindowHelper != "/c/serene-pub/app/serene-pub-window.exe" {
		t.Errorf("windows layout %+v", w)
	}
	m := FromExecutable("darwin", "/Applications/Serene Pub.app/Contents/MacOS/serene-pub")
	if m.InstallRoot != "/Applications" || m.SwapUnit != "/Applications/Serene Pub.app" ||
		m.UnitName != "Serene Pub.app" || m.Staging != "/Applications/.serene-pub-staging" ||
		m.AppDir != "/Applications/Serene Pub.app/Contents/Resources/app" || m.LauncherFile != "" {
		t.Errorf("darwin layout %+v", m)
	}
	p := m.PayloadPaths("v0.6.1")
	if p.Unit != "/Applications/.serene-pub-staging/v0.6.1/serene-pub/Serene Pub.app" ||
		p.Launcher != p.Unit+"/Contents/MacOS/serene-pub" {
		t.Errorf("darwin payload %+v", p)
	}
	lp := l.PayloadPaths("v0.6.1")
	if lp.Launcher != "/opt/serene-pub/staging/v0.6.1/serene-pub/serene-pub" ||
		lp.Package != "/opt/serene-pub/staging/v0.6.1/serene-pub/app/package.json" {
		t.Errorf("linux payload %+v", lp)
	}
}

func TestResolveDataDirPrecedence(t *testing.T) {
	l := FromExecutable("linux", "/opt/sp/serene-pub")
	home := "/home/u"
	def := filepath.Join(home, ".local", "share", "SerenePub")

	got, src := ResolveDataDir(l, env(nil), home, files(nil))
	if got != def || src != SourceDefault {
		t.Errorf("default: %q %s", got, src)
	}
	// Real env wins over the install .env.
	got, src = ResolveDataDir(l, env(map[string]string{"SERENE_PUB_DATA_DIR": "/env"}), home,
		files(map[string]string{"/opt/sp/.env": "SERENE_PUB_DATA_DIR=/file"}))
	if got != "/env" || src != SourceEnvironment {
		t.Errorf("env: %q %s", got, src)
	}
	// Legacy install-root .env pointer, relative → anchored to the install root (not app/).
	got, src = ResolveDataDir(l, env(nil), home,
		files(map[string]string{"/opt/sp/.env": "# portable\nSERENE_PUB_DATA_DIR=./data\n"}))
	if got != "/opt/sp/data" || src != SourceInstallEnv {
		t.Errorf("legacy relative: %q %s", got, src)
	}
	// Install root file wins over app/.env; the two are never merged.
	got, _ = ResolveDataDir(l, env(nil), home, files(map[string]string{
		"/opt/sp/.env":     "PORT=1\n",
		"/opt/sp/app/.env": "SERENE_PUB_DATA_DIR=/from-app",
	}))
	if got != def {
		t.Errorf("root file without pointer must shadow app/.env: %q", got)
	}
	// app/.env used when the root has none.
	got, _ = ResolveDataDir(l, env(nil), home, files(map[string]string{"/opt/sp/app/.env": "SERENE_PUB_DATA_DIR=rel"}))
	if got != "/opt/sp/rel" {
		t.Errorf("app/.env: %q", got)
	}
	// Relative env value is also anchored to the install root.
	got, _ = ResolveDataDir(l, env(map[string]string{"SERENE_PUB_DATA_DIR": "d"}), home, files(nil))
	if got != "/opt/sp/d" {
		t.Errorf("relative env: %q", got)
	}
	// macOS: install root is the directory containing the .app.
	m := FromExecutable("darwin", "/x/serene-pub/Serene Pub.app/Contents/MacOS/serene-pub")
	got, _ = ResolveDataDir(m, env(nil), home, files(map[string]string{"/x/serene-pub/.env": "SERENE_PUB_DATA_DIR=./data"}))
	if got != "/x/serene-pub/data" {
		t.Errorf("darwin relative: %q", got)
	}
}
