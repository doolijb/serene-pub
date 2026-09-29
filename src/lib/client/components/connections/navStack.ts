/**
 * Where Back goes in the connections panel: one stack, not one variable per view.
 *
 * Every door pushes where it was opened from; Back pops it. A per-view
 * "return view" cannot remember a trail two deep — a model opened from a
 * capability opened from the index — and a hard-coded index skips whatever
 * opened the view (plan 2026-09-24 B1/B3).
 *
 * An entry is everything a view needs to be drawn again, so popping one is the
 * whole of going back. Opening from the index list starts a fresh stack: the
 * list is always one tap away, and a trail that ran through it is not a trail.
 *
 * Pure: the sidebar owns the state and applies an entry; this only decides
 * which entry.
 */

export type NavView =
	| "index"
	| "connection"
	| "model"
	| "capability"
	| "finder"
	| "downloads"
	| "setup-chat"

export interface NavEntry {
	view: NavView
	/** The connection the view is about — restored with it, and re-fetched. */
	connectionId: number | null
	modelId: number | null
	capability: string | null
	finderScope: { capability?: string; connectionId?: number }
}

export const INDEX_ENTRY: NavEntry = {
	view: "index",
	connectionId: null,
	modelId: null,
	capability: null,
	finderScope: {}
}

export interface NavStack {
	/** Remember `from` and go on. An index entry is never remembered. */
	push(from: NavEntry): void
	/** The entry Back lands on — the index once the trail is spent. */
	pop(): NavEntry
	clear(): void
	readonly size: number
}

/** Deep enough for any real trail; a cap so a loop cannot grow it forever. */
const LIMIT = 20

export function createNavStack(): NavStack {
	let entries: NavEntry[] = []
	return {
		push(from) {
			if (from.view === "index") return
			entries.push({ ...from, finderScope: { ...from.finderScope } })
			if (entries.length > LIMIT) entries = entries.slice(-LIMIT)
		},
		pop() {
			return entries.pop() ?? INDEX_ENTRY
		},
		clear() {
			entries = []
		},
		get size() {
			return entries.length
		}
	}
}
