// Package launcherstate is <dataDir>/launcher.json — launcher-only state that
// must never live in .env (§C10): the window- and tray-unavailable records,
// the registration answer (phase 2) and the last version seen.
package launcherstate

import (
	"encoding/json"
	"os"

	"github.com/doolijb/serene-pub/launcher/internal/envfile"
)

// State is the launcher.json document. Unknown keys are dropped on save.
type State struct {
	Schema int `json:"schema"`
	// WindowUnavailable is the launcher version for which the window helper
	// failed to start; the default client falls back to the browser for
	// that version only, so an update gets a fresh try.
	WindowUnavailable string `json:"windowUnavailable,omitempty"`
	// TrayUnavailable is the launcher version whose last start found no
	// tray within the ready timeout (§C9): the launcher ran without one.
	// Cleared when the tray comes up. Diagnostic only — every start tries
	// the tray again.
	TrayUnavailable string `json:"trayUnavailable,omitempty"`
	// Registration is the answer to the phase-2 "Add to your applications?"
	// prompt: "", "yes", "never".
	Registration    string `json:"registration,omitempty"`
	LastSeenVersion string `json:"lastSeenVersion,omitempty"`
}

// Load reads path; a missing or corrupt file is an empty state.
func Load(path string) State {
	var s State
	if data, err := os.ReadFile(path); err == nil {
		json.Unmarshal(data, &s)
	}
	s.Schema = 1
	return s
}

// Save writes path atomically with mode 0600.
func Save(path string, s State) error {
	s.Schema = 1
	data, err := json.MarshalIndent(s, "", "  ")
	if err != nil {
		return err
	}
	return envfile.WriteAtomic(path, append(data, '\n'), 0o600)
}
