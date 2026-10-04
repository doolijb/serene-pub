export type ViewMode = "list" | "cards"

/**
 * A `$state`-backed list/card view-mode toggle, persisted to localStorage
 * under its own key so the characters sidebar and the home page each remember
 * the user's choice independently.
 */
export function createViewMode(
	storageKey: string,
	defaultMode: ViewMode = "list"
) {
	/**
	 * Every read and write guarded: storage may be absent (SSR), blocked (a
	 * private window), or — on Node 24+ without `--localstorage-file` — a
	 * global `localStorage` with no working `getItem`, which threw during a
	 * server render of the Connections index (2026-10-03). A remembered
	 * view mode is a convenience; failing to read it is the default.
	 */
	function load(): ViewMode {
		try {
			const stored = globalThis.localStorage?.getItem(storageKey)
			return stored === "cards" || stored === "list" ? stored : defaultMode
		} catch {
			return defaultMode
		}
	}

	let mode = $state<ViewMode>(load())

	return {
		get value() {
			return mode
		},
		set value(next: ViewMode) {
			mode = next
			try {
				globalThis.localStorage?.setItem(storageKey, next)
			} catch {
				// Not remembered; still switched for this visit.
			}
		}
	}
}
