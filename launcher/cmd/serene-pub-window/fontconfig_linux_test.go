//go:build linux

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
func existsIn(paths ...string) func(string) bool {
	return func(p string) bool {
		for _, q := range paths {
			if p == q {
				return true
			}
		}
		return false
	}
}

func TestFontconfigBase(t *testing.T) {
	cases := []struct {
		name   string
		env    map[string]string
		exists []string
		want   string
	}{
		{"system default", nil, []string{systemFontconfig}, systemFontconfig},
		{"no system config: leave fontconfig alone", nil, nil, ""},
		{"the user's own absolute FONTCONFIG_FILE", map[string]string{"FONTCONFIG_FILE": "/home/u/fonts.conf"}, []string{"/home/u/fonts.conf", systemFontconfig}, "/home/u/fonts.conf"},
		{"a relative FONTCONFIG_FILE is fontconfig's to resolve", map[string]string{"FONTCONFIG_FILE": "fonts.conf"}, []string{systemFontconfig}, ""},
		{"a missing FONTCONFIG_FILE", map[string]string{"FONTCONFIG_FILE": "/gone.conf"}, []string{systemFontconfig}, ""},
		{"FONTCONFIG_FILE already names the override", map[string]string{"FONTCONFIG_FILE": "/cache/" + fontconfigFileName}, []string{"/cache/" + fontconfigFileName, systemFontconfig}, systemFontconfig},
	}
	for _, c := range cases {
		if got := fontconfigBase(env(c.env), existsIn(c.exists...), "/cache/"+fontconfigFileName); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestFontconfigXML(t *testing.T) {
	x := fontconfigXML(`/odd/a&b<"c">.conf`)
	for _, want := range []string{
		`<include ignore_missing="yes">/odd/a&amp;b&lt;&quot;c&quot;&gt;.conf</include>`,
		"<glob>/*.woff</glob>",
		"<glob>/*.woff2</glob>",
	} {
		if !strings.Contains(x, want) {
			t.Errorf("missing %q in:\n%s", want, x)
		}
	}
}

func TestInstallFontconfigWorkaround(t *testing.T) {
	if _, err := os.Stat(systemFontconfig); err != nil {
		t.Skip("no " + systemFontconfig + " on this box")
	}
	t.Setenv("FONTCONFIG_FILE", "")
	dir := t.TempDir()
	path, err := installFontconfigWorkaround(dir)
	if err != nil {
		t.Fatal(err)
	}
	if path != filepath.Join(dir, fontconfigFileName) || os.Getenv("FONTCONFIG_FILE") != path {
		t.Fatalf("path %q, FONTCONFIG_FILE %q", path, os.Getenv("FONTCONFIG_FILE"))
	}
	body, _ := os.ReadFile(path)
	if string(body) != fontconfigXML(systemFontconfig) {
		t.Fatalf("unexpected contents:\n%s", body)
	}
	// Second start: FONTCONFIG_FILE now names the override itself, which must
	// not include itself.
	if _, err := installFontconfigWorkaround(dir); err != nil {
		t.Fatal(err)
	}
	body, _ = os.ReadFile(path)
	if strings.Contains(string(body), fontconfigFileName+"</include>") {
		t.Fatalf("the override includes itself:\n%s", body)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("left temp files behind: %v", entries)
	}
}
