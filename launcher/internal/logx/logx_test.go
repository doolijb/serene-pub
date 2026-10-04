package logx

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRotates(t *testing.T) {
	p := filepath.Join(t.TempDir(), "logs", "launcher.log")
	w, err := Open(p, 64)
	if err != nil {
		t.Fatal(err)
	}
	w.Write([]byte(strings.Repeat("a", 60) + "\n"))
	w.Write([]byte("second\n"))
	w.Close()
	cur, _ := os.ReadFile(p)
	old, _ := os.ReadFile(p + ".1")
	if string(cur) != "second\n" || len(old) != 61 {
		t.Fatalf("cur %q old %d", cur, len(old))
	}
}
