export type ViewMode = "list" | "cards"

/**
 * A `$state`-backed list/card view-mode toggle, persisted to localStorage
 * under its own key so characters sidebar, personas sidebar, and the home
 * page each remember the user's choice independently.
 */
export function createViewMode(
	storageKey: string,
	defaultMode: ViewMode = "list"
) {
	function load(): ViewMode {
		if (typeof localStorage === "undefined") return defaultMode
		const stored = localStorage.getItem(storageKey)
		return stored === "cards" || stored === "list" ? stored : defaultMode
	}

	let mode = $state<ViewMode>(load())

	return {
		get value() {
			return mode
		},
		set value(next: ViewMode) {
			mode = next
			if (typeof localStorage !== "undefined") {
				localStorage.setItem(storageKey, next)
			}
		}
	}
}
