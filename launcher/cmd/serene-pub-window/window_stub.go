//go:build !window

package main

import (
	"fmt"
	"os"
)

// show in a build without the webview: report "no webview runtime".
func show(args) int {
	fmt.Fprintln(os.Stderr, "serene-pub-window: built without the webview (-tags window)")
	return exitNoRuntime
}
