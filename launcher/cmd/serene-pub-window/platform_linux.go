//go:build window && linux

package main

/*
#cgo pkg-config: gtk+-3.0
#include <stdlib.h>
#include <gtk/gtk.h>

static void set_window_icon(void *window, const char *path) {
	gtk_window_set_icon_from_file(GTK_WINDOW(window), path, NULL);
}
*/
import "C"

import (
	"fmt"
	"os"
	"path/filepath"
	"unsafe"
)

// programName becomes the window's WM_CLASS (X11) and app id (Wayland). It
// matches serene-pub.desktop (dist-assets/linux/install-desktop-shortcut.sh.in),
// so the desktop shows the window under the launcher's menu entry and icon
// instead of as an unknown "serene-pub-window".
const programName = "serene-pub"

// preparePlatform runs before the webview — and GTK — start.
func preparePlatform() {
	if cache, err := os.UserCacheDir(); err == nil {
		if _, err := installFontconfigWorkaround(filepath.Join(cache, "serene-pub")); err != nil {
			fmt.Fprintln(os.Stderr, "serene-pub-window: fontconfig workaround not applied:", err)
		}
	}
	name := C.CString(programName)
	defer C.free(unsafe.Pointer(name))
	C.g_set_prgname(name)
}

// decorateWindow gives the GTK window the app's icon, for desktops that show
// the window's own icon (no desktop entry installed, or one that does not
// match).
func decorateWindow(window unsafe.Pointer) {
	icon := bundledIcon()
	if window == nil || icon == "" {
		return
	}
	path := C.CString(icon)
	defer C.free(unsafe.Pointer(path))
	C.set_window_icon(window, path)
}

// bundledIcon is the 256 px icon SvelteKit copies from static/ into
// build/client — the helper lives in app/ beside build/, and the desktop
// entry's Icon= points at the same file. "" when it is missing.
func bundledIcon() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	icon := filepath.Join(filepath.Dir(exe), "build", "client", "icon-x256.png")
	if _, err := os.Stat(icon); err != nil {
		return ""
	}
	return icon
}
