/**
 * 🚧 Whether a person may press Continue — the client's reading of the
 * server's door (`sessions:fireTurn`, `sessions/fireTurn.ts`'s
 * `sentSinceReply`), so a guest's chip is present and greys on the same
 * rule the press is judged by (Dungeon Crawler walk round 2, 2026-10-15:
 * a guest had no Continue at all).
 *
 * The owner always may. A member may when something is prepared on the
 * channel pressed (the order's entry there), or — on `main` — when a
 * visible line of theirs sits after main's newest visible reply (any row
 * that is not a person's; narration is a side note and does not count).
 */
import { isSameChannel, type TurnOrderV1 } from "@serene-pub/sdk"

export interface CarryOnRow {
	role?: string | null
	userId?: number | null
	channel?: string | null
	isHidden?: boolean | null
	isNarratorResponse?: boolean | null
}

/** A line of `userId`'s on `main` since main's newest reply — `sentSinceReply`, over loaded rows. */
export function sentSinceReplyIn(
	rows: ReadonlyArray<CarryOnRow> | null | undefined,
	userId: number | null | undefined
): boolean {
	if (userId == null) return false
	const list = rows ?? []
	for (let i = list.length - 1; i >= 0; i--) {
		const row = list[i]!
		if (!isSameChannel(row.channel || "main", "main")) continue
		if (row.isHidden || row.isNarratorResponse) continue
		if (row.role !== "user") return false
		if (row.userId === userId) return true
	}
	return false
}

/** Whether this viewer's Continue on `channel` (absent: `main`) would be taken. */
export function mayContinue(opts: {
	isOwner: boolean
	userId: number | null | undefined
	channel?: string
	rows: ReadonlyArray<CarryOnRow> | null | undefined
	/** 🚧 The session's turn order as the page holds it (`sessions:turnOrder` / `sessions:view`); the row's `metadata` carries none. */
	turnOrder: Pick<TurnOrderV1, "order">
}): boolean {
	if (opts.isOwner) return true
	const channel = opts.channel ?? "main"
	if (opts.turnOrder.order.some((e) => isSameChannel(e.channel, channel)))
		return true
	return isSameChannel(channel, "main") && sentSinceReplyIn(opts.rows, opts.userId)
}
