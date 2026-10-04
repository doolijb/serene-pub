//go:build window

package main

import (
	"fmt"
	"os"
	"reflect"
	"runtime"

	webview "github.com/webview/webview_go"
)

func init() { runtime.LockOSThread() } // GTK/Cocoa/Win32 want the main thread

func show(a args) int {
	if !webviewRuntimePresent() {
		fmt.Fprintln(os.Stderr, "serene-pub-window: no webview runtime")
		return exitNoRuntime
	}
	w := webview.New(false)
	if w == nil || nativeHandle(w) == 0 {
		// webview_create returned NULL: the runtime is missing or unusable.
		fmt.Fprintln(os.Stderr, "serene-pub-window: could not create a webview")
		return exitNoRuntime
	}
	defer w.Destroy()
	w.SetTitle(a.title)
	w.SetSize(a.width, a.height, webview.HintNone)
	w.Navigate(a.url)
	w.Run()
	return exitOK
}

// nativeHandle reads the wrapper's C handle: webview_go never reports a NULL
// from webview_create, and calling into a NULL handle crashes.
func nativeHandle(w webview.WebView) uintptr {
	v := reflect.ValueOf(w)
	if v.Kind() != reflect.Pointer || v.IsNil() {
		return 0
	}
	f := v.Elem().Field(0)
	if f.Kind() != reflect.UnsafePointer {
		return 1 // layout changed upstream: assume valid rather than refuse
	}
	return f.Pointer()
}
