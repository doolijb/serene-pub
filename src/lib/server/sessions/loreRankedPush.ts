/**
 * The `sessions:loreRanked` push (R81): a turn in this session ranked its
 * lore, and what the rankings made of each entry has been written — the
 * rollup `entries:sessionEntries` reads moved. The session page hands it to
 * its widgets as `lore:ranked`, so the Lore entries widget asks again
 * exactly then, and never on a turn that ranked nothing.
 *
 * `{ sessionId }` and nothing else: the facts are the owner's to read
 * (R58), through the request that already holds that line; the push only
 * says there is something new. Sent after the ranking store's transaction
 * committed (`recordRankings`), never inside it.
 *
 * A no-op with no socket server, like every other session push: a run
 * started by a test or a CLI has nobody to tell.
 */

import type { SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import { broadcastToSessionUsers } from "$lib/server/sockets/utils/broadcastHelpers"

export async function pushLoreRanked(
	io: SessionIo,
	sessionId: number
): Promise<void> {
	if (!io) return
	await broadcastToSessionUsers(io, sessionId, "sessions:loreRanked", {
		sessionId
	})
}
