/**
 * Where Back goes in the connections panel: three places, one trail.
 *
 * The panel has three places and only three — the **index**, a
 * **connection**, and a **model** — and every other thing it does (pick a
 * model for a job, get a model, set up chat, watch downloads) is a dialog or
 * the tray, never a place (design 2026-10-09 C.1). So Back always means up one
 * level, and the trail is never more than two deep below the index:
 *
 * - opening a **connection** starts the trail again at that connection — its
 *   Back is the index, whatever it was opened from (a model's "Open
 *   KoboldCPP" replaces the model rather than stacking on it);
 * - opening a **model** from a connection keeps that connection above it, so
 *   Back lands on THE connection it was opened from (the KoboldCPP image model
 *   opened from the text row returns to the text row); opened from anywhere
 *   else, the model is the trail's first level and Back is the index;
 * - opening anything from the index LIST (`fresh`) starts the trail again: the
 *   list is always one tap away, and a trail that ran through it is not one.
 *
 * An entry is everything a place needs to be drawn again, so landing on one is
 * the whole of going back.
 *
 * Pure: the sidebar owns the view state and applies an entry; this only
 * decides which entry.
 */

export type NavView = "index" | "connection" | "model"

export interface NavEntry {
	view: NavView
	/** The connection the place is about — restored with it, and re-fetched. */
	connectionId: number | null
	modelId: number | null
}

export const INDEX_ENTRY: NavEntry = {
	view: "index",
	connectionId: null,
	modelId: null
}

/** The deepest a place sits below the index: a model under its connection. */
export const MAX_DEPTH = 2

export interface NavStack {
	/**
	 * Go to `to`. `fresh` is a door in the index list, which starts the trail
	 * again whatever was open.
	 */
	go(to: NavEntry, opts?: { fresh?: boolean }): void
	/** Up one level: the entry Back lands on, the index once the trail is spent. */
	back(): NavEntry
	clear(): void
	/** The place on screen. */
	readonly current: NavEntry
	/** How far below the index the place on screen is: 0, 1 or 2. */
	readonly depth: number
}

export function createNavStack(): NavStack {
	/** The places below the index, the one on screen last. */
	let trail: NavEntry[] = []
	return {
		go(to, opts = {}) {
			const entry = { ...to }
			if (entry.view === "index") {
				trail = []
				return
			}
			if (entry.view === "connection" || opts.fresh) {
				trail = [entry]
				return
			}
			// A model: under the connection it was opened from, if any. A model
			// opened from another model replaces it.
			const above = trail.filter((e) => e.view === "connection").at(-1)
			trail = above ? [above, entry] : [entry]
		},
		back() {
			trail = trail.slice(0, -1)
			return { ...(trail.at(-1) ?? INDEX_ENTRY) }
		},
		clear() {
			trail = []
		},
		get current() {
			return { ...(trail.at(-1) ?? INDEX_ENTRY) }
		},
		get depth() {
			return trail.length
		}
	}
}
