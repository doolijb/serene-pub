/**
 * 🚧 The session page hears every `entries:setMarks` reply the viewer gets —
 * the server sends it to all of their tabs — and tells its widgets
 * `lore:marked` for a mark in THIS session's book, so a lore reader showing
 * that entry asks again: a mark set in one widget or tab is never stale in
 * another. A mark in any other book is none of this session's widgets'
 * business, and a refusal changed nothing: neither tells anybody. Which
 * widgets hear it is the widget wire's to judge (`widgetEventHeard`).
 *
 * Returns the release, for the page's per-session interest list.
 */
import { declareInterest } from "$lib/client/sockets/interest.svelte"

export function hearLoreMarked(
	/** The session's book, read when a reply lands; `null` when it reads none. */
	sessionBook: () => number | null | undefined,
	widgets: { announceLoreMarked(entryId: number): void }
): () => void {
	return declareInterest<"entries:setMarks">("entries:setMarks", (res) => {
		if (res.error || typeof res.entryId !== "number") return
		const book = sessionBook()
		if (book == null || res.lorebookId !== book) return
		widgets.announceLoreMarked(res.entryId)
	})
}
