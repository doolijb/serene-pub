//go:build window && !windows

package main

// webviewRuntimePresent: WebKit (macOS) is always there; on Linux a missing
// WebKitGTK fails earlier, in the dynamic loader, which the launcher detects
// as a non-zero exit within 3 s.
func webviewRuntimePresent() bool { return true }
