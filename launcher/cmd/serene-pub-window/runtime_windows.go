//go:build window && windows

package main

import "golang.org/x/sys/windows/registry"

// webviewRuntimePresent checks the WebView2 Evergreen Runtime the way
// Microsoft documents: a non-empty, non-"0.0.0.0" "pv" under the runtime's
// EdgeUpdate client key, machine-wide (either registry view) or per-user.
func webviewRuntimePresent() bool {
	const client = `Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`
	keys := []struct {
		root registry.Key
		path string
	}{
		{registry.LOCAL_MACHINE, `SOFTWARE\WOW6432Node\` + client},
		{registry.LOCAL_MACHINE, `SOFTWARE\` + client},
		{registry.CURRENT_USER, `Software\` + client},
	}
	for _, k := range keys {
		h, err := registry.OpenKey(k.root, k.path, registry.QUERY_VALUE)
		if err != nil {
			continue
		}
		pv, _, err := h.GetStringValue("pv")
		h.Close()
		if err == nil && pv != "" && pv != "0.0.0.0" {
			return true
		}
	}
	return false
}
