//go:build window && !linux

package main

import "unsafe"

// preparePlatform: nothing to do before the webview starts.
func preparePlatform() {}

// decorateWindow: the window's icon comes from the platform.
func decorateWindow(unsafe.Pointer) {}
