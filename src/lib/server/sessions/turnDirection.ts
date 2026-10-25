/**
 * What the person said to this turn — the run's `input.text` on a reply
 * (lair pass F8, B11).
 *
 * The person's line is a row, read from history like every other row; this is
 * what hands it to the run as *this turn's* text, for a spec that reads the
 * typed line as something other than dialogue — the Lair's planner reads it
 * as the master's direction.
 *
 * The text is the person's rows since the last line that was not theirs, on
 * the turn's channel, oldest first and joined by a blank line: two lines typed
 * before the reply fired are both this turn's. A verb re-driving a reply reads
 * the rows before that reply, so a regenerate answers the same direction the
 * first take did. Hidden rows and rows still generating are not text anybody
 * sent. Empty when the person said nothing (a Continue on an AI turn).
 *
 * 🚧 **A seat's line is no direction** (Lair rewrite L4, 2026-10-21): a line
 * sent from a seat in the scene — a persona (`personaId`) or a card-less
 * player seat (`metadata.speaker: player-seat:<id>`) — is that delver's own
 * turn, never what the person directing the story asked for; it is passed
 * over (it stays a row in history, as it always was). The Lair's planner
 * reads direction as the GM's lines alone; no other core reply reads this
 * text.
 */
import { and, desc, eq, lt } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { channelWhere } from "$lib/server/messages/channels"

/** How far back a run of the person's own lines is looked for. */
const LOOKBACK = 20

export async function turnDirectionText(
	db: Db,
	sessionId: number,
	opts: { channel?: string | null; before?: number | null } = {}
): Promise<string> {
	const rows = await db
		.select({
			role: schema.sessionMessages.role,
			content: schema.sessionMessages.content,
			personaId: schema.sessionMessages.personaId,
			metadata: schema.sessionMessages.metadata
		})
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.isHidden, false),
				eq(schema.sessionMessages.isGenerating, false),
				channelWhere(schema.sessionMessages.channel, opts.channel),
				opts.before != null
					? lt(schema.sessionMessages.id, opts.before)
					: undefined
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(LOOKBACK)
	const mine: string[] = []
	for (const row of rows) {
		if (row.role !== "user") break
		const speaker = (row.metadata as { speaker?: unknown } | null)?.speaker
		if (row.personaId != null || (typeof speaker === "string" && speaker.startsWith("player-seat:"))) continue
		const text = (row.content ?? "").trim()
		if (text) mine.unshift(text)
	}
	return mine.join("\n\n")
}
