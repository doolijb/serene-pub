// Package register is the phase-2 app registration (prompted once: Start Menu
// .lnk on Windows, ~/.local/share/applications entry on Linux, move to
// /Applications on macOS). Not built in phase 1: Available reports false and
// the tray shows no registration item.
package register

// Available reports whether app registration is built in this launcher.
func Available() bool { return false }
