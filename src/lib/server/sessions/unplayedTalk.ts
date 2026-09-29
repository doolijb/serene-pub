/**
 * **The unplayed talk** (lair re-plan R13, owner F3/QB 2026-09-28): what was
 * said on a side channel since the story's last line — the read behind
 * `core:query/session-history@1`'s `unplayedOnly`, and so behind the Lair's
 * _Sanctum talk steers the story_.
 *
 * Deterministic, and keyed on recorded facts only:
 *
 * - **The bound** is the story's newest generated line: the newest visible,
 *   finished `main` row whose role is not `user` (a delver's line, a
 *   narration, a knock, a trap). Talk before it has been played. A session
 *   whose story has no such row yet bounds nothing.
 * - **After the bound**, on the channel read, visible and finished rows are
 *   kept when they are **talk**:
 *   - a person's own line (`role: 'user'`);
 *   - a reply a run fired **on this channel** wrote here — the creating run's
 *     inlet published this channel (`pipeline_run_artifacts`, `created`, the
 *     run's receipt), which is the Castellan answering in the Sanctum.
 * - Everything else is left out: a row a **create** run wrote (the
 *   greeting — its inlet names no channel), a row a **story turn** wrote
 *   (the beats row — its inlet's channel is `main`), and a generated row no
 *   run recorded. Never a row's metadata, never a speaker.
 * - **Capped** at `limit`, newest kept, returned oldest first.
 *
 * Not *played* in any other sense: a row is "unplayed" only relative to this
 * bound.
 *
 * The same talk rule without the bound is `sideTalkOnly` — `session-history@1`'s
 * `talkOnly` (R10's fold-in): the Lair's room check reads every channel, and a
 * beats row on the Sanctum is not a description of a room.
 */
import { and, asc, desc, eq, gt, inArray, ne, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	DEFAULT_CHANNEL,
	channelWhere,
	parseChannel
} from "$lib/server/messages/channels"

/** How many rows past the bound are ever looked at — a runaway brainstorm stays a bounded read. */
const SCAN_CEILING = 500

type MessageRow = typeof schema.sessionMessages.$inferSelect

/**
 * The story's newest generated line on `main`, or null when it has none —
 * the bound the unplayed talk is read after.
 */
export async function storyBoundOf(db: Db, sessionId: number): Promise<number | null> {
	const [row] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.isHidden, false),
				eq(schema.sessionMessages.isGenerating, false),
				ne(schema.sessionMessages.role, "user"),
				channelWhere(schema.sessionMessages.channel, DEFAULT_CHANNEL)
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	return row?.id ?? null
}

/**
 * The inlet channel of the run that CREATED each message, by message id —
 * read off the receipt's inlet node in SQL, so no receipt is loaded whole.
 * A preview never counts; a message no run created is absent.
 */
async function creatingInletChannels(
	db: Db,
	messageIds: readonly number[]
): Promise<Map<number, string | null>> {
	const out = new Map<number, string | null>()
	if (!messageIds.length) return out
	const rows = await db
		.select({
			messageId: schema.pipelineRunArtifacts.entityId,
			runId: schema.pipelineRuns.id,
			channel: sql<string | null>`jsonb_path_query_first(${schema.pipelineRuns.receipt}::jsonb, '$.nodes[*] ? (@.kind == "inlet").output.channel') #>> '{}'`
		})
		.from(schema.pipelineRunArtifacts)
		.innerJoin(
			schema.pipelineRuns,
			eq(schema.pipelineRuns.id, schema.pipelineRunArtifacts.runId)
		)
		.where(
			and(
				eq(schema.pipelineRunArtifacts.kind, "message"),
				eq(schema.pipelineRunArtifacts.action, "created"),
				inArray(schema.pipelineRunArtifacts.entityId, [...messageIds]),
				eq(schema.pipelineRuns.isPreview, false)
			)
		)
		.orderBy(asc(schema.pipelineRuns.id))
	// The earliest non-preview run that created it is its creator.
	for (const r of rows) if (!out.has(r.messageId)) out.set(r.messageId, r.channel ?? null)
	return out
}

/**
 * The unplayed talk on `channel` for this session, oldest first, at most
 * `limit` rows (newest kept). See the module note for what counts.
 */
export async function unplayedTalkRows(
	db: Db,
	sessionId: number,
	channel: string,
	limit: number
): Promise<MessageRow[]> {
	if (limit <= 0) return []
	const bound = await storyBoundOf(db, sessionId)
	const candidates = await db
		.select()
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.isHidden, false),
				eq(schema.sessionMessages.isGenerating, false),
				channelWhere(schema.sessionMessages.channel, channel),
				...(bound !== null ? [gt(schema.sessionMessages.id, bound)] : [])
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(SCAN_CEILING)

	const talk = await talkOf(db, candidates)
	return talk.slice(0, limit).reverse()
}

/**
 * The rows of `rows` that are **talk** on their own channel, in the order
 * given: a person's own line, or a reply whose creating run fired on that
 * channel (see the module note). The one rule behind `unplayedOnly` and
 * `talkOnly`.
 */
async function talkOf<R extends Pick<MessageRow, "id" | "role" | "channel">>(
	db: Db,
	rows: readonly R[]
): Promise<R[]> {
	const generated = rows.filter((r) => r.role !== "user").map((r) => r.id)
	const inletOf = await creatingInletChannels(db, generated)
	return rows.filter((r) => {
		if (r.role === "user") return true
		const inlet = inletOf.get(r.id)
		return (
			typeof inlet === "string" &&
			parseChannel(inlet).slug === parseChannel(r.channel).slug
		)
	})
}

/**
 * **Side channels as talk** (`session-history@1`'s `talkOnly`, lair re-plan
 * R10's fold-in of the R9 follow-up): `rows` with every non-`main` row that
 * is not talk dropped — the greeting a create run wrote, a story turn's
 * beats row — and every `main` row kept, in the order given. What the
 * Lair's room check reads, so the Castellan's own beats list is never taken
 * for a description of a room.
 */
export async function sideTalkOnly<R extends Pick<MessageRow, "id" | "role" | "channel">>(
	db: Db,
	rows: readonly R[]
): Promise<R[]> {
	const side = rows.filter((r) => parseChannel(r.channel).slug !== DEFAULT_CHANNEL)
	if (!side.length) return [...rows]
	const kept = new Set((await talkOf(db, side)).map((r) => r.id))
	return rows.filter(
		(r) => parseChannel(r.channel).slug === DEFAULT_CHANNEL || kept.has(r.id)
	)
}
