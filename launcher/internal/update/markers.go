// Package update applies a staged update (§C5 markers, §C8 state machine):
// validate READY.json + APPLY, swap the swap unit through <staging>/previous,
// health-gate the new server, roll back into <staging>/failed on failure,
// replace the launcher itself when the release ships a different one, and
// resume an interrupted swap from the SWAP.json journal.
package update

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/doolijb/serene-pub/launcher/internal/envfile"
	"github.com/doolijb/serene-pub/launcher/internal/paths"
	"github.com/doolijb/serene-pub/launcher/internal/version"
)

// Ready is READY.json (§C5 step 6), written by Node last — the commit point.
type Ready struct {
	Schema          int    `json:"schema"`
	Tag             string `json:"tag"`
	Version         string `json:"version"`
	FromVersion     string `json:"fromVersion"`
	Target          string `json:"target"`
	Channel         string `json:"channel"`
	LauncherVersion string `json:"launcherVersion"`
	Payload         string `json:"payload"`
	StagedAt        string `json:"stagedAt"`
}

// Apply is the APPLY marker (§C5 step 7): the admin's recorded consent.
type Apply struct {
	Schema      int             `json:"schema"`
	Tag         string          `json:"tag"`
	RequestedAt string          `json:"requestedAt"`
	RequestedBy json.RawMessage `json:"requestedBy"`
}

// Swap phases (§C5 SWAP.json).
const (
	PhaseMovedOld   = "moved-old"
	PhaseMovedNew   = "moved-new"
	PhaseHealth     = "health"
	PhaseCommitted  = "committed"
	PhaseRolledBack = "rolled-back"
)

// Journal is SWAP.json, the launcher's own record of an apply in progress.
type Journal struct {
	Schema int    `json:"schema"`
	Tag    string `json:"tag"`
	Phase  string `json:"phase"`
	At     string `json:"at"`
}

// Terminal reports whether the journal records a finished apply.
func (j Journal) Terminal() bool { return j.Phase == PhaseCommitted || j.Phase == PhaseRolledBack }

func readJSON(path string, v any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, v); err != nil {
		return fmt.Errorf("%s: %w", filepath.Base(path), err)
	}
	return nil
}

func writeJSON(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return envfile.WriteAtomic(path, append(data, '\n'), 0o644)
}

// Validation errors — each §C5 mismatch is distinguishable for tests and logs.
var (
	ErrNoReady         = errors.New("APPLY without a readable READY.json")
	ErrBadApply        = errors.New("APPLY unreadable")
	ErrSchema          = errors.New("unsupported marker schema")
	ErrTagMismatch     = errors.New("READY.json tag != APPLY tag")
	ErrBadTag          = errors.New("tag has an invalid shape")
	ErrTargetMismatch  = errors.New("staged target does not match this launcher")
	ErrChannelMismatch = errors.New("staged channel does not match this launcher")
	ErrPrereleaseStage = errors.New("staged version is a pre-release")
	ErrBadPayload      = errors.New("payload directory name is invalid")
	ErrPayloadMissing  = errors.New("staged payload is incomplete")
	ErrPayloadVersion  = errors.New("staged app/package.json version differs from READY.json")
)

// Validate applies every §C5 launcher-side check to the markers.
func Validate(l paths.Layout, ready *Ready, apply *Apply, target, channel string) error {
	if ready.Schema != 1 || apply.Schema != 1 {
		return ErrSchema
	}
	if ready.Tag != apply.Tag {
		return fmt.Errorf("%w: %q vs %q", ErrTagMismatch, ready.Tag, apply.Tag)
	}
	if !version.ValidTag(ready.Tag) {
		return fmt.Errorf("%w: %q", ErrBadTag, ready.Tag)
	}
	if ready.Target != target {
		return fmt.Errorf("%w: %q vs %q", ErrTargetMismatch, ready.Target, target)
	}
	if ready.Channel != channel {
		return fmt.Errorf("%w: %q vs %q", ErrChannelMismatch, ready.Channel, channel)
	}
	if version.IsPrerelease(ready.Version) {
		return fmt.Errorf("%w: %q", ErrPrereleaseStage, ready.Version)
	}
	if ready.Payload == "" || ready.Payload != filepath.Base(ready.Payload) || strings.ContainsAny(ready.Payload, `/\`) ||
		ready.Payload == "." || ready.Payload == ".." || reserved[ready.Payload] {
		return fmt.Errorf("%w: %q", ErrBadPayload, ready.Payload)
	}
	p := l.PayloadPaths(ready.Payload)
	required := []string{p.IndexJS, p.Node, p.Package, p.Launcher}
	for _, f := range required {
		if info, err := os.Stat(f); err != nil || info.IsDir() {
			return fmt.Errorf("%w: %s", ErrPayloadMissing, f)
		}
	}
	var pkg struct {
		Version string `json:"version"`
	}
	if err := readJSON(p.Package, &pkg); err != nil || pkg.Version != ready.Version {
		return fmt.Errorf("%w: %q vs %q", ErrPayloadVersion, pkg.Version, ready.Version)
	}
	return nil
}

// Names inside <staging> a payload may never be.
var reserved = map[string]bool{"previous": true, "failed": true, "READY.json": true, "APPLY": true, "SWAP.json": true}

func now(c func() time.Time) string { return c().UTC().Format(time.RFC3339Nano) }
