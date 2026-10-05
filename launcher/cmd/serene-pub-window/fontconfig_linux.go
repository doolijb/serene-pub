//go:build linux

package main

import (
	"os"
	"path/filepath"
	"strings"
)

// WebKitGTK 2.52's web process spins forever inside fontconfig when a system
// font directory holds WOFF files, so the window stays empty — not even
// about:blank loads. fonts-opendyslexic installs
// /usr/share/fonts/woff/opendyslexic, and Zorin OS ships it. Reproduced and
// bisected to that one directory on Zorin OS 18 / WebKitGTK 2.52.6
// (2026-10-05); hiding it from fontconfig made the app load in under a second.
//
// The helper hands WebKit a fontconfig file that includes the system
// configuration and rejects WOFF files. Pages' own web fonts are loaded from
// memory, not from fontconfig's font list, so they are unaffected.

// systemFontconfig is fontconfig's default configuration file.
const systemFontconfig = "/etc/fonts/fonts.conf"

// fontconfigFileName is the override written under the user cache directory.
const fontconfigFileName = "webkit-fontconfig.conf"

// fontconfigBase picks the configuration the override (at self) includes:
// the user's own FONTCONFIG_FILE when it is an absolute path other than the
// override itself, else the system default. It returns "" — leave fontconfig
// alone — when that file does not exist (an override including nothing would
// leave WebKit with no fonts at all) or when FONTCONFIG_FILE is relative
// (resolved by fontconfig's own search path).
func fontconfigBase(getenv func(string) string, exists func(string) bool, self string) string {
	base := systemFontconfig
	if own := getenv("FONTCONFIG_FILE"); own != "" && own != self {
		if !filepath.IsAbs(own) {
			return ""
		}
		base = own
	}
	if !exists(base) {
		return ""
	}
	return base
}

// fontconfigXML is the override's contents. The reject globs start with "/":
// fontconfig 2.15 ignores a glob that starts with "*" for fonts it reads from
// its cache, and "*" in a glob also matches "/".
func fontconfigXML(base string) string {
	esc := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;").Replace(base)
	return `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<!-- Written by serene-pub-window: the system configuration minus WOFF fonts,
     which hang WebKitGTK's web process (see fontconfig_linux.go). -->
<fontconfig>
  <include ignore_missing="yes">` + esc + `</include>
  <selectfont>
    <rejectfont>
      <glob>/*.woff</glob>
      <glob>/*.woff2</glob>
    </rejectfont>
  </selectfont>
</fontconfig>
`
}

// installFontconfigWorkaround writes the override into cacheDir and points
// FONTCONFIG_FILE at it for this process and the WebKit processes it starts.
// It must run before the webview is created. Returns the file it set, or ""
// when it left fontconfig alone.
func installFontconfigWorkaround(cacheDir string) (string, error) {
	path := filepath.Join(cacheDir, fontconfigFileName)
	base := fontconfigBase(os.Getenv, func(p string) bool {
		_, err := os.Stat(p)
		return err == nil
	}, path)
	if base == "" {
		return "", nil
	}
	if err := os.MkdirAll(cacheDir, 0o755); err != nil {
		return "", err
	}
	want := fontconfigXML(base)
	if have, err := os.ReadFile(path); err != nil || string(have) != want {
		// Write-then-rename: a second window starting at the same moment must
		// never read a half-written file.
		tmp, err := os.CreateTemp(cacheDir, fontconfigFileName+".*")
		if err != nil {
			return "", err
		}
		_, werr := tmp.WriteString(want)
		cerr := tmp.Close()
		if werr != nil || cerr != nil {
			os.Remove(tmp.Name())
			if werr != nil {
				return "", werr
			}
			return "", cerr
		}
		if err := os.Rename(tmp.Name(), path); err != nil {
			os.Remove(tmp.Name())
			return "", err
		}
	}
	return path, os.Setenv("FONTCONFIG_FILE", path)
}
