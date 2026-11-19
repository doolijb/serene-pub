/**
 * 🚧 `open-lore` (anyone may ask): open the lorebooks panel on a lorebook,
 * an entry, a scene or (W4) a place. A field of the wrong shape is dropped,
 * and any scope but `'scenes'` or `'places'` is `'history'`. One thing is
 * refused: a viewer who is not the session's owner asking for the session's
 * own notes (a guest neither opens nor edits them, owner ruling G2); an
 * attached lorebook opens for anyone, its own sharing rules deciding.
 */

/** 🚧 Why a non-owner is refused the session's notes (shown as *Not done: …*). */
export const NOTES_ARE_THE_OWNERS = "the session's notes are the session owner's"

/** Where the lorebooks panel opens. */
export interface LoreTarget {
	lorebookId: number | undefined
	scope: "history" | "scenes" | "places"
	entryId: number | undefined
	sceneId: number | undefined
}

/** What this answer needs of the page's panels. */
export interface OpenLoreDeps {
	/** Point the lorebooks panel at `target`. */
	showLore(target: LoreTarget): void
	/** Open the lorebooks panel (never toggling it shut). */
	openLorebooksPanel(): void
	/** The viewer owns this session. */
	isSessionOwner(): boolean
	/** The session's own notes (its own book), null when it has none. */
	ownBookId(): number | null
	/** The book the session reads: its attached lorebook, else its notes. */
	sessionBookId(): number | null
}

/** Answer one `open-lore`. */
export function answerOpenLore(params: unknown, deps: OpenLoreDeps): void {
	const p = params as Record<string, unknown>
	const lorebookId = typeof p.lorebookId === "number" ? p.lorebookId : undefined
	const notes = deps.ownBookId()
	if (notes != null && !deps.isSessionOwner() && (lorebookId ?? deps.sessionBookId()) === notes)
		throw new Error(NOTES_ARE_THE_OWNERS)
	deps.showLore({
		lorebookId,
		scope:
			p.scope === "scenes" ? "scenes" : p.scope === "places" ? "places" : "history",
		entryId: typeof p.entryId === "number" ? p.entryId : undefined,
		sceneId: typeof p.sceneId === "number" ? p.sceneId : undefined
	})
	deps.openLorebooksPanel()
}
