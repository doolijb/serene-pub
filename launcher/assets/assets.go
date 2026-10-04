// Package assets holds the launcher's embedded icons.
package assets

import _ "embed"

//go:generate go run ./gen/main.go

// IconICO is the Windows icon (tray on Windows; goversioninfo resource).
//
//go:embed icon.ico
var IconICO []byte

// IconPNG is the tray icon on Linux and macOS.
//
//go:embed icon.png
var IconPNG []byte
