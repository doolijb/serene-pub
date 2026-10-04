// Command serene-pub-window is the window helper (§C9): one native webview
// window on a URL. It lives in the swap unit's app/ so it updates with the
// app. Exit 0 on close; 3 = no webview runtime (WebView2 missing, or a build
// without the webview), 2 = bad arguments.
//
//	serene-pub-window --url <url> --title "Serene Pub" [--width 1280 --height 860]
//
// The real window is compiled only with `-tags window` (cgo; needs WebKitGTK
// 4.1 dev headers on Linux, MinGW on Windows, Xcode CLT on macOS). Without
// the tag the helper is a stub that exits 3, so the launcher falls back to
// the browser — `go vet ./...` and `go test ./...` work on any box.
package main

import (
	"flag"
	"fmt"
	"net/url"
	"os"
)

// Exit codes the launcher understands.
const (
	exitOK        = 0
	exitUsage     = 2
	exitNoRuntime = 3
)

type args struct {
	url, title    string
	width, height int
}

func parseArgs() args {
	var a args
	flag.StringVar(&a.url, "url", "", "page to open (http/https)")
	flag.StringVar(&a.title, "title", "Serene Pub", "window title")
	flag.IntVar(&a.width, "width", 1280, "window width")
	flag.IntVar(&a.height, "height", 860, "window height")
	flag.Parse()
	u, err := url.Parse(a.url)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		fmt.Fprintln(os.Stderr, "serene-pub-window: --url must be an http(s) URL")
		os.Exit(exitUsage)
	}
	return a
}

func main() {
	a := parseArgs()
	os.Exit(show(a))
}
