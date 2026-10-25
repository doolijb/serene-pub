export type ViewMode = "list" | "cards"

/**
 * A `$state`-backed list/card view-mode toggle, persisted to localStorage
 * under its own key so the characters sidebar and the home page each remember
 * the user's choice independently.
 *
 * `defaultMode` may be a function: the answer until the person picks, read
 * each time so it can follow something reactive — Characters is a list in
 * the 400px dock and cards at Half and Focus (PLAN-0-5-polish-parity L6,
 * 2026-10-24, 0.5's behaviour). A pick is stored and wins at every width.
 */
export function createViewMode(
	storageKey: string,
	defaultMode: ViewMode | (() => ViewMode) = "list"
) {
	const fallback = (): ViewMode =>
		typeof defaultMode === "function" ? defaultMode() : defaultMode

	/**
	 * Every read and write guarded: storage may be absent (SSR), blocked (a
	 * private window), or — on Node 24+ without `--localstorage-file` — a
	 * global `localStorage` with no working `getItem`, which threw during a
	 * server render of the Connections index (2026-10-03). A remembered
	 * view mode is a convenience; failing to read it is the default.
	 */
	function load(): ViewMode | null {
		try {
			const stored = globalThis.localStorage?.getItem(storageKey)
			return stored === "cards" || stored === "list" ? stored : null
		} catch {
			return null
		}
	}

	/** The person's own pick; null until they make one. */
	let picked = $state<ViewMode | null>(load())

	return {
		get value(): ViewMode {
			return picked ?? fallback()
		},
		set value(next: ViewMode) {
			picked = next
			try {
				globalThis.localStorage?.setItem(storageKey, next)
			} catch {
				// Not remembered; still switched for this visit.
			}
		}
	}
}
