package proc

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestServerEnvReplacesAndKeepsDataDirPassThrough(t *testing.T) {
	base := []string{"PATH=/bin", "AUTO_OPEN_CLIENT=1", "SERENE_PUB_DATA_DIR=/op", "NODE_ENV=development"}
	got := ServerEnv(base, [][2]string{{"NODE_ENV", "production"}, {"AUTO_OPEN_CLIENT", "0"}})
	want := "PATH=/bin SERENE_PUB_DATA_DIR=/op NODE_ENV=production AUTO_OPEN_CLIENT=0"
	if strings.Join(got, " ") != want {
		t.Fatalf("got %v", got)
	}
}

func TestAliveSelf(t *testing.T) {
	if !Alive(os.Getpid()) {
		t.Error("own pid not alive")
	}
	if Alive(0) || Alive(-3) {
		t.Error("non-positive pid alive")
	}
}

func TestLockIsExclusive(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("LockFileEx is per-handle; covered on POSIX")
	}
	p := filepath.Join(t.TempDir(), "launcher.lock")
	release, err := Lock(p)
	if err != nil {
		t.Fatal(err)
	}
	// flock is per open file description, so a second open in-process conflicts.
	if _, err := Lock(p); !errors.Is(err, ErrLocked) {
		t.Fatalf("second lock: %v", err)
	}
	release()
	r2, err := Lock(p)
	if err != nil {
		t.Fatal(err)
	}
	r2()
}

func TestSpawnServerWritesLogFileAndRotates(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses /bin/sh")
	}
	dir := t.TempDir()
	logp, prev := filepath.Join(dir, "logs", "server.log"), filepath.Join(dir, "logs", "server.1.log")
	os.MkdirAll(filepath.Dir(logp), 0o755)
	os.WriteFile(logp, []byte("old run\n"), 0o600)
	c, err := SpawnServer(ServerSpec{Node: "/bin/sh", IndexJS: "-c", Dir: dir, LogPath: logp, PrevLog: prev,
		Env: []string{"PATH=/bin:/usr/bin"}})
	if err != nil {
		t.Fatal(err)
	}
	<-c.Done()
	// `sh -c` with no command string fails; what matters is it ran detached
	// with output on the file and the old log rotated.
	if b, _ := os.ReadFile(prev); string(b) != "old run\n" {
		t.Errorf("rotation: %q", b)
	}
	if _, err := os.Stat(logp); err != nil {
		t.Error(err)
	}
}
