// Package envfile reads dotenv files and performs the launcher's one allowed
// kind of write to <dataDir>/.env (§C10): set AUTO_OPEN_CLIENT or
// DEFAULT_CLIENT to an allowed value, in place, keeping every other line.
package envfile

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Keys the launcher may write, with their allowed values (§C10).
var allowed = map[string][]string{
	"AUTO_OPEN_CLIENT": {"0", "1"},
	"DEFAULT_CLIENT":   {"window", "browser"},
}

// ErrNotAllowed is returned for any key or value outside the §C10 allowlist.
var ErrNotAllowed = errors.New("envfile: key or value is not launcher-writable")

// ErrSetBySystem is returned when the real process environment already sets
// the key: the file would be ignored, so the launcher shows it read-only.
var ErrSetBySystem = errors.New("envfile: set by your system")

var lineRe = regexp.MustCompile(`^\s*(?:export\s+)?([\w.-]+)\s*(?:=|:\s)(.*)$`)

// Parse reads dotenv source the way the `dotenv` package does for the
// single-line forms Serene Pub's .env files use: `KEY=value`, optional
// `export `, '#' comments, and single/double/backtick quoting (a double-quoted
// value expands \n). Later assignments win, as in dotenv.parse.
func Parse(src string) map[string]string {
	out := map[string]string{}
	for _, raw := range strings.Split(strings.ReplaceAll(src, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		m := lineRe.FindStringSubmatch(raw)
		if m == nil {
			continue
		}
		out[m[1]] = parseValue(m[2])
	}
	return out
}

func parseValue(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	if q := v[0]; q == '"' || q == '\'' || q == '`' {
		if end := strings.LastIndexByte(v, q); end > 0 {
			inner := v[1:end]
			if q == '"' {
				inner = strings.ReplaceAll(inner, `\n`, "\n")
				inner = strings.ReplaceAll(inner, `\r`, "\r")
			}
			return inner
		}
	}
	if i := strings.Index(v, " #"); i >= 0 {
		v = v[:i]
	} else if strings.HasPrefix(v, "#") {
		return ""
	}
	return strings.TrimSpace(v)
}

// ReadFile parses path; a missing or unreadable file is an empty map.
func ReadFile(path string) map[string]string {
	data, err := os.ReadFile(path)
	if err != nil {
		return map[string]string{}
	}
	return Parse(string(data))
}

// Writable reports whether key=value is inside the §C10 allowlist.
func Writable(key, value string) bool {
	for _, v := range allowed[key] {
		if v == value {
			return true
		}
	}
	return false
}

// Set writes key=value into the dotenv file at path. It edits the last
// uncommented assignment of key in place, else appends one; every other line,
// comment and the order are kept. The write is atomic (tmp + rename), keeps
// the file's mode, and creates the file with 0600 when absent. lookupEnv is
// the launcher's real environment (os.LookupEnv): a key present there is
// refused with ErrSetBySystem.
func Set(path, key, value string, lookupEnv func(string) (string, bool)) error {
	if !Writable(key, value) {
		return fmt.Errorf("%w: %s=%s", ErrNotAllowed, key, value)
	}
	if lookupEnv != nil {
		if _, ok := lookupEnv(key); ok {
			return fmt.Errorf("%w: %s", ErrSetBySystem, key)
		}
	}
	mode := os.FileMode(0o600)
	var src string
	if info, err := os.Stat(path); err == nil {
		mode = info.Mode().Perm()
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		src = string(data)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	eol := "\n"
	if strings.Contains(src, "\r\n") {
		eol = "\r\n"
	}
	lines := strings.Split(src, eol)
	keyRe := regexp.MustCompile(`^(\s*)(export\s+)?` + regexp.QuoteMeta(key) + `\s*(?:=|:\s)`)
	last := -1
	for i, line := range lines {
		if keyRe.MatchString(line) {
			last = i
		}
	}
	if last >= 0 {
		m := keyRe.FindStringSubmatch(lines[last])
		lines[last] = m[1] + m[2] + key + "=" + value
	} else {
		// Append after the last non-empty line, keeping a trailing newline.
		for len(lines) > 0 && lines[len(lines)-1] == "" {
			lines = lines[:len(lines)-1]
		}
		lines = append(lines, key+"="+value)
	}
	out := strings.Join(lines, eol)
	if !strings.HasSuffix(out, eol) {
		out += eol
	}
	return WriteAtomic(path, []byte(out), mode)
}

// WriteAtomic writes data to a temporary sibling and renames it over path.
func WriteAtomic(path string, data []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op after a successful rename
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, mode); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

// IsFalsy is the AUTO_OPEN_CLIENT falsy set, identical to
// scripts/customize-build.js: 0, false, no, off (trimmed, case-insensitive).
func IsFalsy(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "0", "false", "no", "off":
		return true
	}
	return false
}
