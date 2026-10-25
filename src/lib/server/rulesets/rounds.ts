/**
 * 🚧 What a "turn" is to the ruleset handler (audit A6, 2026-10-17): a
 * **round** — one reply from the story's side (an assistant row: a
 * character's or the narrator's) on the session's default channel. Not a
 * message: a player's line, a Planner note on a side channel or a table line
 * would each have moved the count, so a condition lasting 3 turns ended
 * after about one and a half exchanges. A swipe is a revision of the same
 * row, so it moves nothing.
 *
 * One definition, read by `read.ts` (the session's present round) and the
 * engine (how many rounds a timed piece has run).
 */

import { and, count, eq, sql } from "drizzle-orm"
import { liveMessageWhere } from "$lib/server/messages/store"
import * as schema from "$lib/server/db/schema"
import { DEFAULT_CHANNEL } from "$lib/server/messages/channels"

/** Whether a message row counts as a round. */
export const countsAsRound = (row: { role: string; channel?: string | null }): boolean =>
	row.role === "assistant" && (row.channel ?? DEFAULT_CHANNEL) === DEFAULT_CHANNEL

/** The session's present round: how many rows `countsAsRound` admits. */
export async function roundOf(db: any, sessionId: number): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(schema.messages)
		.where(
			and(
				eq(schema.messages.sessionId, sessionId),
				eq(schema.messages.role, "assistant"),
				eq(schema.messages.channel, DEFAULT_CHANNEL),
				// 🚧 The live history (RF fix 5): a rewound reply is no round.
				liveMessageWhere(schema.messages.rewindOrdinal)
			)
		)
	return Number(row?.n ?? 0)
}

/** Rounds run since `started` (a timed piece's `startedAt.turn`), at round `now`; null when it never recorded one. */
export const roundsSince = (started: number | undefined, now: number): number | null =>
	typeof started === "number" && Number.isFinite(started) ? Math.max(0, now - started) : null
