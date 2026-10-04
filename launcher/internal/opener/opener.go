// Package opener hands a URL or a folder to the operating system: the default
// browser, or the file manager (View Logs).
package opener

import (
	"os/exec"
	"runtime"
)

// Command returns the argv that opens target on goos.
func Command(goos, target string) []string {
	switch goos {
	case "windows":
		// rundll32 opens URLs and folders without a console flash and without
		// cmd.exe re-parsing '&' in a query string.
		return []string{"rundll32", "url.dll,FileProtocolHandler", target}
	case "darwin":
		return []string{"open", target}
	}
	return []string{"xdg-open", target}
}

// Open opens target (URL or directory) with the OS default handler.
func Open(target string) error {
	argv := Command(runtime.GOOS, target)
	cmd := exec.Command(argv[0], argv[1:]...)
	if err := cmd.Start(); err != nil {
		return err
	}
	go cmd.Wait() // reap
	return nil
}
