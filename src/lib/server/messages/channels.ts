/**
 * Channels — the filter lanes inside one session (20 §7, plan R6 / phase 5b).
 *
 * A session's message history is not one undifferentiated stream. Two
 * characters texting on a phone widget while a scene happens elsewhere are
 * two conversations, and pulling one into the other's prompt mixes them. So a
 * message carries a **channel**, and every read that reaches a model names
 * one.
 *
 * ## The floor: one channel, always
 *
 * `main` is implicit and exists for every session that will ever exist. A
 * genre declares *extra* lanes (`SessionShape.channels`); nothing else creates
 * one. The standard chat declares none, so every message it has ever written
 * is on `main` and every read of it resolves to `main` — which is why this is
 * a data change and not a behaviour change.
 *
 * ## Why an omitted channel is `main` and never a union
 *
 * The rule the design forbids is a read that *silently* spans lanes. There
 * were two ways to satisfy it: refuse an unqualified read, or give it a
 * defined single lane. Refusing would mean every existing call site has to
 * pass a channel on the day the column lands — including the retrieval reads
 * in `bindings.ts` — and an unqualified read would go from correct to fatal
 * on an install whose behaviour did not change. So an omitted channel
 * resolves to the session's default lane, `main`: one named channel, never a
 * mixture, and identical to today's read on every session that exists.
 *
 * A union is still available, but only by asking for it: `ALL_CHANNELS`. It
 * is a deliberate word at the call site, which is the whole point — a reader
 * looking at the call can see that this one spans lanes.
 *
 * ## The mirror
 *
 * `session_messages.channel` is authoritative and `messages.channel` mirrors
 * it (`projectLegacy` carries the value; `upsertProjection` writes it). They
 * were the other way round for exactly as long as the legacy row could not
 * express a channel — see `writeSessionGreetings`, which used to reach past
 * the store and patch `messages` after the fact.
 */

import { eq, type SQL } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { SessionShape } from "@serene-pub/sdk"

type Db = { select: any }

/** The lane every session has, whatever its genre declares. */
export const DEFAULT_CHANNEL = "main"

/**
 * The explicit union. Not a default and not a fallback — a caller that means
 * "every lane in this session" writes this down, and a caller that omits the
 * channel gets `main`.
 */
export const ALL_CHANNELS = "*"

/** A channel name, or `ALL_CHANNELS`. */
export type ChannelSelector = string

/**
 * What a read is actually scoped to.
 *
 * Absent, empty, or non-string means `main` — the session's default lane, not
 * everything. `'*'` is the union, and only because it was asked for.
 */
export function resolveChannel(requested: unknown): ChannelSelector {
	if (typeof requested !== "string") return DEFAULT_CHANNEL
	const trimmed = requested.trim()
	if (!trimmed) return DEFAULT_CHANNEL
	return trimmed
}

export const isAllChannels = (selector: ChannelSelector): boolean =>
	selector === ALL_CHANNELS

/**
 * The predicate for a channel-scoped read, or `undefined` for the union.
 *
 * `undefined` is what drizzle's `and()` drops, so a union reads as "no channel
 * clause" at the query site without a branch around the whole `where`.
 *
 * ⚠ It belongs **inside** the query's `where`, not applied to the rows after
 * a `LIMIT`. Filtering a limited window is how "the last 40 messages on the
 * phone" becomes "however many of the last 40 messages overall happened to be
 * on the phone", which is silently short and looks like a retrieval problem.
 */
export function channelWhere(
	column: any,
	requested: unknown
): SQL | undefined {
	const selector = resolveChannel(requested)
	return isAllChannels(selector) ? undefined : eq(column, selector)
}

/**
 * The channels a genre's shape declares, `main` first.
 *
 * `greeting.channel` counts: a genre that redirects its greetings to a lane
 * has created that lane by naming it, and requiring it to be listed twice
 * would be a validation that exists only to be tripped over.
 */
export function channelsOf(shape: SessionShape | undefined | null): string[] {
	const out = [DEFAULT_CHANNEL]
	const add = (candidate: unknown) => {
		if (typeof candidate !== "string") return
		const name = candidate.trim()
		if (name && !out.includes(name)) out.push(name)
	}
	for (const declared of (shape as any)?.channels ?? []) add(declared)
	add((shape as any)?.greeting?.channel)
	return out
}

/**
 * Which channels this session has. `[main]` for every session whose genre
 * declares none, which today is all of them.
 *
 * The genre module is imported lazily for the same reason `verbs.ts` does it:
 * this module is reached from the message store and the host, and
 * `sessionGenres` reads the type registry.
 */
export async function sessionChannels(
	db: Db,
	sessionId: number
): Promise<string[]> {
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return [DEFAULT_CHANNEL]
	const { getSessionGenre, STANDARD_GENRE_ID } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const genre = await getSessionGenre(
		db as any,
		session.genreId ?? STANDARD_GENRE_ID
	)
	return channelsOf(genre?.shape)
}

/**
 * Why this write may not land on this channel, or `null`.
 *
 * A sentence rather than a boolean (15 §1.3), and a refusal rather than a
 * silent coercion to `main`: a message written to a lane the session does not
 * have is a message nothing will ever render, which is the shape of data loss
 * even though every row is still there.
 */
export async function channelRefusal(
	db: Db,
	sessionId: number,
	channel: unknown
): Promise<string | null> {
	const requested = resolveChannel(channel)
	if (requested === DEFAULT_CHANNEL) return null
	if (isAllChannels(requested))
		return (
			`'${ALL_CHANNELS}' selects every channel for a read — it is not a ` +
			`channel a message can be written to.`
		)
	const available = await sessionChannels(db, sessionId)
	if (available.includes(requested)) return null
	return (
		`this session has no channel '${requested}' — its genre declares ` +
		`${available.map((c) => `'${c}'`).join(", ")}. A channel exists ` +
		`because a genre declares it.`
	)
}
