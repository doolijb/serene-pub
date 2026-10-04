package runtimefile

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const tok = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func doc(over string) string {
	base := `{"schema":1,"pid":12345,"port":3000,"host":"0.0.0.0","controlUrl":"http://127.0.0.1:3000",` +
		`"openUrl":"http://localhost:3000","version":"0.6.1","isPrerelease":false,"token":"` + tok + `",` +
		`"startedAt":"2026-10-01T12:00:00.000Z","dataDir":"/d","installRoot":null,"launcherVersion":"0.6.1",` +
		`"channel":"portable","futureKey":{"x":1}` + over + `}`
	return base
}

func TestParseValid(t *testing.T) {
	rt, err := Parse([]byte(doc("")))
	if err != nil {
		t.Fatal(err)
	}
	if rt.Pid != 12345 || rt.Port != 3000 || rt.InstallRoot != nil || *rt.LauncherVersion != "0.6.1" ||
		*rt.Channel != "portable" || !rt.ControlIsLoopback() || rt.ControlAddr() != "127.0.0.1:3000" {
		t.Errorf("%+v", rt)
	}
}

func TestParseRejects(t *testing.T) {
	bad := map[string]string{
		"schema":  `,"schema":2`,
		"pid":     `,"pid":0`,
		"port":    `,"port":70000`,
		"token":   `,"token":"ABC"`,
		"control": `,"controlUrl":"not a url"`,
		"open":    `,"openUrl":"ftp://x"`,
	}
	for name, over := range bad {
		// A later duplicate key wins in encoding/json.
		if _, err := Parse([]byte(doc(over))); !errors.Is(err, ErrInvalid) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if _, err := Parse([]byte("{")); !errors.Is(err, ErrInvalid) {
		t.Error("truncated JSON accepted")
	}
}

func TestReadMissing(t *testing.T) {
	_, err := Read(filepath.Join(t.TempDir(), "runtime.json"))
	if !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("err = %v", err)
	}
}

func TestNonLoopbackControl(t *testing.T) {
	rt, err := Parse([]byte(strings.Replace(doc(""), "http://127.0.0.1:3000", "http://192.168.1.5:3000", 1)))
	if err != nil {
		t.Fatal(err)
	}
	if rt.ControlIsLoopback() {
		t.Error("LAN host reported as loopback")
	}
}
