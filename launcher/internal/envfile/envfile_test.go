package envfile

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func noEnv(string) (string, bool) { return "", false }

func TestParse(t *testing.T) {
	got := Parse("# c\nA=1\nexport B = two # note\nC=\"x\\ny\"\nD='q # not comment'\nE=\nA=3\n  # F=9\n")
	want := map[string]string{"A": "3", "B": "two", "C": "x\ny", "D": "q # not comment", "E": ""}
	if len(got) != len(want) {
		t.Fatalf("got %v", got)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
}

func TestSetEditsLastAssignmentInPlace(t *testing.T) {
	p := filepath.Join(t.TempDir(), ".env")
	src := "# top comment\nPORT=4000\nAUTO_OPEN_CLIENT=1\n# AUTO_OPEN_CLIENT=9\nexport AUTO_OPEN_CLIENT=1\nZ=last\n"
	if err := os.WriteFile(p, []byte(src), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := Set(p, "AUTO_OPEN_CLIENT", "0", noEnv); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(p)
	want := "# top comment\nPORT=4000\nAUTO_OPEN_CLIENT=1\n# AUTO_OPEN_CLIENT=9\nexport AUTO_OPEN_CLIENT=0\nZ=last\n"
	if string(data) != want {
		t.Fatalf("got:\n%s\nwant:\n%s", data, want)
	}
	if runtime.GOOS != "windows" {
		info, _ := os.Stat(p)
		if info.Mode().Perm() != 0o640 {
			t.Errorf("mode %v, want 0640 kept", info.Mode().Perm())
		}
	}
}

func TestSetAppendsAndCreates0600(t *testing.T) {
	p := filepath.Join(t.TempDir(), "sub", ".env")
	if err := Set(p, "DEFAULT_CLIENT", "browser", noEnv); err != nil {
		t.Fatal(err)
	}
	if err := Set(p, "AUTO_OPEN_CLIENT", "1", noEnv); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(p)
	if string(data) != "DEFAULT_CLIENT=browser\nAUTO_OPEN_CLIENT=1\n" {
		t.Fatalf("got %q", data)
	}
	if runtime.GOOS != "windows" {
		info, _ := os.Stat(p)
		if info.Mode().Perm() != 0o600 {
			t.Errorf("mode %v, want 0600", info.Mode().Perm())
		}
	}
}

func TestSetAppendsWithoutTrailingNewlineAndKeepsCRLF(t *testing.T) {
	p := filepath.Join(t.TempDir(), ".env")
	os.WriteFile(p, []byte("A=1\r\nB=2"), 0o600)
	if err := Set(p, "DEFAULT_CLIENT", "window", noEnv); err != nil {
		t.Fatal(err)
	}
	data, _ := os.ReadFile(p)
	if string(data) != "A=1\r\nB=2\r\nDEFAULT_CLIENT=window\r\n" {
		t.Fatalf("got %q", data)
	}
}

func TestSetAllowlist(t *testing.T) {
	p := filepath.Join(t.TempDir(), ".env")
	for _, kv := range [][2]string{
		{"SERENE_PUB_DATA_DIR", "/x"}, {"PORT", "1"}, {"AUTO_OPEN_CLIENT", "true"},
		{"DEFAULT_CLIENT", "tab"}, {"HOST", "0.0.0.0"},
	} {
		if err := Set(p, kv[0], kv[1], noEnv); !errors.Is(err, ErrNotAllowed) {
			t.Errorf("Set(%s=%s) err = %v, want ErrNotAllowed", kv[0], kv[1], err)
		}
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Error("refused write still created the file")
	}
}

func TestSetRefusesKeyFromRealEnvironment(t *testing.T) {
	p := filepath.Join(t.TempDir(), ".env")
	env := func(k string) (string, bool) { return "0", k == "AUTO_OPEN_CLIENT" }
	if err := Set(p, "AUTO_OPEN_CLIENT", "1", env); !errors.Is(err, ErrSetBySystem) {
		t.Fatalf("err = %v", err)
	}
	if err := Set(p, "DEFAULT_CLIENT", "window", env); err != nil {
		t.Fatal(err)
	}
}

func TestIsFalsy(t *testing.T) {
	for _, v := range []string{"0", "false", "NO", " off "} {
		if !IsFalsy(v) {
			t.Errorf("%q should be falsy", v)
		}
	}
	for _, v := range []string{"1", "true", "", "yes"} {
		if IsFalsy(v) {
			t.Errorf("%q should not be falsy", v)
		}
	}
}
