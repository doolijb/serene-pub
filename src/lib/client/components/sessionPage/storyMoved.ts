/**
 * 🚧 The session page tells its widgets `story:moved` (Chronicle, W3) when a
 * history entry of the session's book was added, changed or removed —
 * `entries:create`, `entries:iterateNext`, `entries:update` and
 * `entries:delete`, scoped to the book, for the history entry type only —
 * so the Chronicle asks again rather than drawing a story that moved on in
 * the lorebook. Its other two causes, the session's own (its clock or line
 * moved: `state:changed`; a scene captured, changed or removed:
 * `scenes:list`), are heard where the page already hears them
 * (`sessionPageInbox.svelte.ts`). Which widgets hear it is the widget
 * wire's to judge (`widgetEventHeard`: scoped like `lore:ranked`).
 *
 * The book's OWNER only: these replies reach no one else, and another
 * book's entries are none of this session's widgets' business — the scoped
 * keys keep them off the wire. Returns the release; the page declares it
 * again when the session's book changes.
 */
import { declareInterest } from "$lib/client/sockets/interest.svelte"
import { interestKey } from "$lib/shared/sockets/interest"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"

export function hearStoryMoved(
	/** The session's book, while the viewer owns it. */
	lorebookId: number,
	widgets: { announceStoryMoved(): void }
): () => void {
	const ifHistory = (typeId: unknown) => {
		if (typeId === HISTORY_TYPE_ID) widgets.announceStoryMoved()
	}
	const releases = [
		declareInterest<"entries:create">(
			interestKey("entries:create", lorebookId),
			(res) => ifHistory(res?.entry?.typeId)
		),
		declareInterest<"entries:iterateNext">(
			interestKey("entries:iterateNext", lorebookId),
			(res) => ifHistory(res?.entry?.typeId)
		),
		declareInterest<"entries:update">(
			interestKey("entries:update", lorebookId),
			(res) => ifHistory(res?.entry?.typeId)
		),
		declareInterest<"entries:delete">(
			interestKey("entries:delete", lorebookId),
			(res) => ifHistory(res?.typeId)
		)
	]
	return () => {
		for (const release of releases) release()
	}
}
