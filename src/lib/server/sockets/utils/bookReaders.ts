/**
 * Relay a lorebook's read-only pushes to the people it is **shared** with
 * (lane A3; PLAN-private-messages §6.7).
 *
 * A write's cascade re-sends its lists through the writer's own `emitToUser`,
 * which reaches only the writer's room. A share recipient with the book open
 * would otherwise never hear the owner's edits. This fans the SAME event out
 * to each recipient's room, each payload BUILT AS THAT RECIPIENT (`build`
 * takes their id), so nothing owner-only — the `sharedWith` roster, say —
 * can ride a payload meant for the owner into a reader's tab.
 *
 * Lazy, through `emitToUserRedacted`: a recipient with no socket wanting the
 * event pays no query. Soft-deleted recipients are already left out by
 * `listSharedWith`.
 *
 * ⚠ Never throws: a relay is a courtesy beside the writer's reply, and a
 * failure is logged, never surfaced to the writer.
 */

import { db } from "$lib/server/db"
import { listSharedWith } from "$lib/server/utils/shares"
import { emitToUserRedacted } from "$lib/server/sockets/utils/broadcastHelpers"

export async function relayToBookReaders(
	socket: { io?: unknown; user?: { id: number } | null },
	lorebookId: number,
	event: string,
	build: (readerId: number) => Promise<unknown>
): Promise<void> {
	const io = socket?.io as Parameters<typeof emitToUserRedacted>[0] | undefined
	if (!io || !Number.isSafeInteger(lorebookId)) return
	try {
		const readers = await listSharedWith(
			db as unknown as Db,
			"lorebook",
			lorebookId
		)
		for (const reader of readers) {
			if (reader.id === socket.user?.id) continue
			await emitToUserRedacted(io, reader.id, event, () => build(reader.id))
		}
	} catch (e) {
		console.error(`${event}: relaying to the book's readers failed:`, e)
	}
}
