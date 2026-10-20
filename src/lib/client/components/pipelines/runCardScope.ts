/**
 * Which runs a channel's progress card shows (Dungeon Crawler walkthrough,
 * 2026-10-15): a conversation copy pinned to the Planner lane drew the
 * Story's receipts, and the Story drew the Planner's ("Answer finished").
 *
 * A run says its channel when the server knows it (`RunProgress.channel`).
 * A run that does not — an action placed on every channel, pressed with no
 * subject row — is shown on the main channel's copy only, so it is drawn
 * once. A card told no channel (the page's own) shows every run.
 */
import { isSameChannel } from "@serene-pub/sdk"
import type { RunProgress } from "$lib/shared/sockets/progress"
import { outcomeOf } from "./runOutcome"

export function runIsOnChannel(
	run: Pick<RunProgress, "channel">,
	channel: string | undefined
): boolean {
	if (channel === undefined) return true
	return isSameChannel(run.channel ?? "main", channel)
}

/** The newest row's id on `channel` (every row when `undefined`), or 0. */
export function newestRowIdOn(
	rows: ReadonlyArray<{ id: number; channel?: string | null }> | null | undefined,
	channel: string | undefined
): number {
	let newest = 0
	for (const r of rows ?? [])
		if (r.id > newest && (channel === undefined || isSameChannel(r.channel || "main", channel)))
			newest = r.id
	return newest
}

/**
 * Whether a finished run's receipt still stands (walkthrough round 2,
 * 2026-10-15: "Answer finished" / "Respond finished" lingered over the next
 * turn).
 *
 * - A run that ended `ok` has no receipt to stand: its output row has
 *   already landed (a row is committed before the terminal frame) or it
 *   wrote none — either way the row list is the answer.
 * - A run this card never saw in flight has none either: what ended before
 *   the card drew (a first paint, a reload, coming back to the page) is
 *   history, read in the runs panel.
 * - A failure, halt or cancel stands until a row newer than the newest one
 *   there when the card first drew it lands on the card's channel. `seen` is
 *   that first sighting — the run and the newest row id then.
 */
export function receiptStands(
	ended: Pick<RunProgress, "runId" | "outcome" | "cancelled" | "error">,
	seen: { runId: string; newestRowId: number } | null,
	newestRowId: number,
	sawInFlight = true
): boolean {
	if (outcomeOf(ended) === "ok" || !sawInFlight) return false
	if (!seen || seen.runId !== ended.runId) return true
	return newestRowId <= seen.newestRowId
}
