/**
 * The **waiting row**: what the Story shows while a reply is on its way but
 * its own row is not open yet (owner 2026-10-15, Dungeon Crawler: "I'm not
 * seeing the visual feedback that a message is being processed, like in the
 * chat genre").
 *
 * Chat's reply opens its row first — a generating placeholder — so the row,
 * its status (*Jasmine is typing*) and the composer's Stop are there from the
 * first moment. A Dungeon Crawler story turn cannot: the Planner's JSON call
 * and the dice come first, and the roll line must land ABOVE the Narrator's
 * row (rows are ordered by id, and law F7 refuses a second message beside a
 * live row on its channel). So until that row opens, the page draws one of
 * its own, out of what the run already tells every user of the session:
 * its `sessions:runStatus` frames — a reply's carry its channel (`reply`) —
 * and so its declared step statuses: *The Planner is thinking*, *Rolling the
 * dice*. Those frames reach every member, and an auto-advanced turn's too
 * (a turn order fires it with no caller to send `pipelines:*` frames to).
 *
 * A waiting row is drawn for a reply run when
 *  - it has said a status (a reply that opens its row first — Chat — never
 *    says one before the row exists, so it never gets a waiting row and
 *    nothing flickers);
 *  - its row has not opened: no row on its channel is generating, and none
 *    has been while the run was in flight (`opened`, kept by the page — so
 *    a run still filing its books after the Narrator's row finished does not
 *    draw one again).
 *
 * The row is the page's alone: a negative id no server row has, never sent
 * anywhere. Stop on it is the session's Stop (`sessionMessages:cancel`),
 * which also stops a reply run that has no row yet (`runRegistry.cancelSession`).
 */
import { isSameChannel, type StatusText } from "@serene-pub/sdk"

/**
 * A reply run in flight, as its `sessions:runStatus` frames left it — keyed
 * by run, dropped on its `null` frame.
 */
export interface ReplyRunStatus {
	runId: string
	/** The run's current status, filled. */
	status: StatusText
	/** The channel the reply lands on. */
	channel: string
}

/** The few columns a row needs here — every session row has them. */
export interface PendingReplyRowLike {
	id: number
	channel?: string | null
	isGenerating?: boolean | null
}

/** The metadata key a waiting row carries: the run it stands for. */
export const PENDING_REPLY_KEY = "pendingReplyRun"

const channelOf = (c: string | null | undefined) => c || "main"

/** Whether a row is one of the page's waiting rows. */
export function isPendingReplyRow(row: {
	id: number
	metadata?: unknown
}): boolean {
	return (
		row.id < 0 &&
		!!row.metadata &&
		typeof row.metadata === "object" &&
		PENDING_REPLY_KEY in (row.metadata as object)
	)
}

/**
 * The reply runs whose row is open now — a generating row on the run's
 * channel. The page adds them to `opened`, once and for good.
 */
export function openedReplyRuns(
	runs: readonly ReplyRunStatus[],
	rows: readonly PendingReplyRowLike[]
): string[] {
	const out: string[] = []
	for (const r of runs) {
		const channel = channelOf(r.channel)
		if (
			rows.some(
				(m) => m.isGenerating && isSameChannel(channelOf(m.channel), channel)
			)
		)
			out.push(r.runId)
	}
	return out
}

/**
 * The waiting rows to draw after the session's own: one per channel at
 * most, for the reply runs described above, in the order the runs started.
 */
export function pendingReplyRows(
	sessionId: number,
	runs: readonly ReplyRunStatus[],
	rows: readonly PendingReplyRowLike[],
	opened: ReadonlySet<string>
): Array<Record<string, unknown> & { id: number }> {
	const out: Array<Record<string, unknown> & { id: number }> = []
	const taken: string[] = []
	for (const r of runs) {
		if (!r.status || opened.has(r.runId)) continue
		const channel = channelOf(r.channel)
		if (taken.some((c) => isSameChannel(c, channel))) continue
		if (
			rows.some(
				(m) => m.isGenerating && isSameChannel(channelOf(m.channel), channel)
			)
		)
			continue
		taken.push(channel)
		out.push({
			id: -taken.length,
			sessionId,
			userId: null,
			characterId: null,
			personaId: null,
			role: "assistant",
			content: "",
			channel: r.channel,
			isGenerating: true,
			generationStatus: r.status,
			isNarratorResponse: true,
			isHidden: false,
			metadata: { [PENDING_REPLY_KEY]: r.runId }
		})
	}
	return out
}
