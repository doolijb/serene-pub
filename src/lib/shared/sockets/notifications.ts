/**
 * The `notifications:` socket family — types shared by the server handlers
 * (`server/sockets/notifications.ts`) and the client's typed-socket map. Kept
 * out of the big `Sockets` namespace, the placement `sockets/jump.ts` uses.
 *
 * - `notifications:list` — the asking user's open rows plus recent cleared ones.
 * - `notifications:read` `{ ids }` — mark rows read (auto-read on view, or a
 *   click). A `view`-cleared kind is cleared as `viewed` in the same write.
 * - `notifications:dismiss` `{ ids }` — clear rows as `dismissed`.
 * - `notifications:changed` — pushed to every socket of the user that declared
 *   it, after any raise, read, dismiss or clear: the same shape as `list`.
 * - `notifications:viewing` `{ viewing }` — what this tab has on screen, or
 *   null while it is hidden or unfocused. Kept on the socket and read at raise
 *   time (`server/notifications/viewing.ts`); nothing is sent back, so it is
 *   not gated.
 *
 * Every write is scoped to the asking user: ids are guessable integers.
 */
import type { NotificationRow } from "$lib/shared/notifications/kinds"
import type { ViewingSnapshot } from "$lib/shared/notifications/covers"

export interface NotificationsListParams {}

export interface NotificationsListResponse {
	/** Open rows, newest raise first. */
	open: NotificationRow[]
	/** Cleared rows from the retention window, newest first, capped. */
	cleared: NotificationRow[]
}

export interface NotificationsIdsParams {
	ids: number[]
}

/** `read` and `dismiss` answer with the fresh list. */
export type NotificationsChanged = NotificationsListResponse

export interface NotificationsViewingParams {
	/** What this tab shows; null while it is hidden or unfocused. */
	viewing: ViewingSnapshot | null
}
