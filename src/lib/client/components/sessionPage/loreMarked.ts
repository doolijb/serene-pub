/**
 * 🚧 The session page hears every change the viewer makes to an entry of THIS
 * session's book — `entries:update`, scoped to the book — and tells its
 * widgets `lore:marked`, so a lore reader showing that entry asks again: a
 * mark set in one widget or tab is never stale in another. Every door that
 * changes an entry sends that row: `entries:setMarks` (a widget's marks, the
 * editor's Teach it) and every save of the entry editor, the cast and the
 * Time lens, so a pin or an Off set there reaches the list too (plan A14).
 * Another book's entries are none of this session's widgets' business, and
 * the scoped key keeps them off the wire. Which widgets hear it is the
 * widget wire's to judge (`widgetEventHeard`).
 *
 * Returns the release; the page declares it again when the session's book
 * changes.
 */
import { declareInterest } from "$lib/client/sockets/interest.svelte"
import { interestKey } from "$lib/shared/sockets/interest"

export function hearLoreMarked(
	/** The session's book. */
	lorebookId: number,
	widgets: { announceLoreMarked(entryId: number): void }
): () => void {
	return declareInterest<"entries:update">(interestKey("entries:update", lorebookId), (res) => {
		const id = res?.entry?.id
		if (typeof id === "number") widgets.announceLoreMarked(id)
	})
}
