package supervisor

import (
	"strings"

	"github.com/doolijb/serene-pub/launcher/internal/envfile"
)

// Prefs are the two client preferences (§C10) and whether the real
// environment pins them ("set by your system" — read-only in the tray).
type Prefs struct {
	AutoOpen       bool
	AutoOpenLocked bool
	Default        string // "window" | "browser"
	DefaultLocked  bool
}

// LoadPrefs resolves the preferences the way the server would see them: real
// environment → <dataDir>/.env → the legacy .env files → defaults
// (AUTO_OPEN_CLIENT=1, DEFAULT_CLIENT=window). SERENE_AUTO_OPEN (inverted:
// "1"/"true" = don't open) still counts when AUTO_OPEN_CLIENT is unset
// everywhere, as in scripts/customize-build.js.
func LoadPrefs(lookupEnv func(string) (string, bool), envFiles []string) Prefs {
	parsed := make([]map[string]string, 0, len(envFiles))
	for _, f := range envFiles {
		parsed = append(parsed, envfile.ReadFile(f))
	}
	get := func(key string) (string, bool, bool) {
		if v, ok := lookupEnv(key); ok {
			return v, true, true
		}
		for _, m := range parsed {
			if v, ok := m[key]; ok {
				return v, false, true
			}
		}
		return "", false, false
	}
	p := Prefs{AutoOpen: true, Default: "window"}
	if v, locked, ok := get("AUTO_OPEN_CLIENT"); ok && strings.TrimSpace(v) != "" {
		p.AutoOpen, p.AutoOpenLocked = !envfile.IsFalsy(v), locked
	} else if v, _, ok := get("SERENE_AUTO_OPEN"); ok {
		p.AutoOpen = v != "1" && v != "true"
	}
	if v, locked, ok := get("DEFAULT_CLIENT"); ok {
		p.DefaultLocked = locked
		if s := strings.ToLower(strings.TrimSpace(v)); s == "browser" {
			p.Default = "browser"
		}
	}
	return p
}
