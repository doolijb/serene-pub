/**
 * 🚧 The session page hears `sessions:genreFieldsChanged` for its own session
 * (2026-10-03) and tells its widgets `genreFields:changed`, so the Author's
 * note shows a note saved in Edit Session or in another tab without waiting
 * for the next reply. The server pushes it to the session owner's tabs only —
 * the one person who may change the fields — so another session's push is
 * dropped here by its `sessionId`.
 *
 * Returns the release, for the page's per-session interest list.
 */
import { declareInterest } from "$lib/client/sockets/interest.svelte"

export function hearGenreFieldsChanged(
	sessionId: number,
	widgets: { announceGenreFieldsChanged(): void }
): () => void {
	return declareInterest<"sessions:genreFieldsChanged">("sessions:genreFieldsChanged", (res) => {
		if (res?.sessionId === sessionId) widgets.announceGenreFieldsChanged()
	})
}
