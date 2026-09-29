/**
 * 🚧 The session page hears `sessions:loreRanked` for its own session (R81)
 * and tells its widgets `lore:ranked`, so core's Lore entries refetch
 * exactly when a turn has written the rankings they read. Which widgets hear
 * it is the widget wire's to judge (`widgetEventHeard`), not this.
 *
 * Returns the release, for the page's per-session interest list.
 */
import { declareInterest } from "$lib/client/sockets/interest.svelte"
import { interestKey } from "$lib/shared/sockets/interest"

export function hearLoreRanked(sessionId: number, widgets: { announceLoreRanked(): void }): () => void {
	return declareInterest<"sessions:loreRanked">(interestKey("sessions:loreRanked", sessionId), () =>
		widgets.announceLoreRanked()
	)
}
