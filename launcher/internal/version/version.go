// Package version holds the launcher's version rules: the pre-release rule
// shared with the server (§C11) and the update tag shape (§C5).
package version

import (
	"regexp"
	"strings"
)

var coreRe = regexp.MustCompile(`^\d+\.\d+\.\d+$`)

// IsPrerelease mirrors isPrereleaseVersion() in
// src/lib/shared/utils/releaseChannel.ts — any suffix except exactly "beta" is
// a pre-release; build metadata (+…) is ignored; a leading "v" is tolerated —
// with one deliberate tightening: a string that is not a version at all is a
// pre-release here (contract §C11 vector "garbage → yes"), because the
// launcher must fail closed — an unparseable version never enables updates.
func IsPrerelease(v string) bool {
	core := strings.TrimSpace(v)
	core = strings.TrimPrefix(strings.TrimPrefix(core, "v"), "V")
	if i := strings.IndexByte(core, '+'); i >= 0 {
		core = core[:i]
	}
	base, suffix, hasSuffix := strings.Cut(core, "-")
	if !coreRe.MatchString(base) {
		return true
	}
	if !hasSuffix {
		return false
	}
	return strings.ToLower(suffix) != "beta"
}

var tagRe = regexp.MustCompile(`^v?\d+\.\d+\.\d+(-[a-z0-9]+(-\d+)?)?$`)

// ValidTag reports whether tag has the shape §C5 accepts. Anything else is
// refused — it also becomes a directory name under the update staging dir.
func ValidTag(tag string) bool { return tagRe.MatchString(tag) }
