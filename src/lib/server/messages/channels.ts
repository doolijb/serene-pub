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
 * ## Channels are declared; lanes are not (ruling 2026-09-09)
 *
 * A channel is a **slug** the genre declares. The **lanes** under a slug are
 * runtime and open-ended: a lane exists because a pipeline wrote to it, and the
 * genre's pipelines allocate (`nextLane`) and manage them — one lane per agent,
 * or five ongoing private conversations under `text-messages` with a sixth
 * later. No lane count is declared anywhere, so validation on a write checks the
 * **slug** and says nothing about the number.
 *
 * Lane 1 is stored as the **bare slug** (`main`, not `main:1`), which is why
 * every row written before lanes existed is already canonical and why this
 * shipped without a migration. Lanes from 2 up store `slug:n`.
 *
 * The reading rule follows from that: a **bare slug is the whole channel**
 * (every lane, ordered lane then time) and **`slug:n` is one lane**. `main` is
 * therefore all of main and `main:1` is its default lane alone — the one place
 * the two spellings differ, and what `ChannelRef.explicit` carries.
 *
 * The parse/format rules themselves live in the SDK (`@serene-pub/sdk`) and are
 * re-exported below rather than restated: a plugin frame reading
 * `text-messages:3` off the port and the host writing the row have to agree, and
 * an agreement maintained by two implementations is not one.
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

import { eq, like, or, sql, type SQL } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import {
	DEFAULT_CHANNEL as SDK_DEFAULT_CHANNEL,
	formatChannel,
	parseChannel,
	type ChannelRef,
	type SessionShape
} from "@serene-pub/sdk"

export {
	DEFAULT_LANE,
	formatChannel,
	isSameChannel,
	parseChannel,
	type ChannelRef
} from "@serene-pub/sdk"

/**
 * The channel every session has, whatever its genre declares.
 *
 * Re-exported from the SDK rather than declared here: it is the one value a
 * plugin and the host must agree on without checking.
 */
export const DEFAULT_CHANNEL = SDK_DEFAULT_CHANNEL

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
 *
 * ⚠ Deliberately **not** canonicalising: `main` and `main:1` are the same lane
 * but not the same read, and `formatChannel(parseChannel(x))` collapses them.
 * Writes canonicalise (`canonicalChannel`); reads keep the caller's phrasing and
 * let `channelWhere` interpret it.
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
 * Log why a channel string was not taken at face value.
 *
 * The SDK's parser is pure and hands the reason back as a value; somebody has to
 * be the one that says it out loud, and on the server that is here. A read never
 * fails on it — a malformed lane degrades to the default lane, because a turn
 * that dies over a lane number is worse than a turn that reads the wrong one and
 * says so.
 */
function warnChannel(ref: ChannelRef): ChannelRef {
	if (ref.warning) console.warn(`[channels] ${ref.warning}`)
	return ref
}

/**
 * The form a channel is stored in. **Every write goes through this.**
 *
 * Two spellings of one lane (`main` and `main:1`) in the column would be one
 * conversation wearing two names, and every whole-channel read would then have
 * to know both.
 */
export function canonicalChannel(raw: unknown): string {
	return formatChannel(warnChannel(parseChannel(raw)))
}

/**
 * Whether a read of this selector may return more than one lane — i.e. it named
 * a channel without naming a lane.
 *
 * The caller needs to know because a multi-lane result is ordered **lane then
 * time**: five private conversations under one slug read as five conversations,
 * not as one interleaved transcript nobody had. False for the union sentinel,
 * which spans *channels* and keeps its existing chronological order.
 */
export function channelSpansLanes(requested: unknown): boolean {
	const selector = resolveChannel(requested)
	if (isAllChannels(selector)) return false
	return !parseChannel(selector).explicit
}

/** Escape a value that is about to be interpolated into a SQL `LIKE` pattern. */
const likeEscape = (value: string): string =>
	value.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * The predicate for "this channel, every lane of it".
 *
 * Lane 1 is the bare slug and the rest are `slug:n`, so the whole channel is one
 * equality plus one prefix. The pattern is escaped because `_` is a
 * single-character wildcard: unescaped, a channel called `text_messages` would
 * sweep up `textXmessages:2` — a different genre's conversation, in this one's
 * prompt.
 */
export function channelPrefixWhere(column: PgColumn, slug: string): SQL {
	const bare = formatChannel({ slug })
	return or(eq(column, bare), like(column, `${likeEscape(bare)}:%`))!
}

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
 *
 * Three cases, and the middle one is the new one: the union clears the clause, a
 * **bare slug is the whole channel** (`channelPrefixWhere`), and `slug:n` is one
 * lane. On a session that has only ever had lane 1 — which is every session that
 * existed before lanes did — the prefix predicate matches exactly the rows the
 * old equality matched, which is why this is not a behaviour change.
 */
export function channelWhere(
	column: PgColumn,
	requested: unknown
): SQL | undefined {
	const selector = resolveChannel(requested)
	if (isAllChannels(selector)) return undefined
	const ref = warnChannel(parseChannel(selector))
	return ref.explicit
		? eq(column, formatChannel(ref))
		: channelPrefixWhere(column, ref.slug)
}

/**
 * Re-order a run of rows already in time order into **lane then time** order.
 *
 * Only for a whole-channel read (`channelSpansLanes`). Five private
 * conversations under one slug are five conversations; interleaving them by
 * timestamp produces a transcript nobody had, and a model asked to continue it
 * answers all five at once.
 *
 * The sort is on the lane alone and relies on `Array.prototype.sort` being
 * stable (spec-guaranteed), so rows within a lane keep the order they arrived
 * in. It is deliberately **not** applied to `ALL_CHANNELS`, which spans channels
 * rather than lanes and keeps its existing chronological order.
 */
export function byLaneThenTime<T extends { channel?: string | null }>(
	rows: T[]
): T[] {
	return rows
		.map((row, index) => ({ row, index, lane: parseChannel(row.channel).lane }))
		.sort((a, b) => a.lane - b.lane || a.index - b.index)
		.map((entry) => entry.row)
}

/**
 * The next free lane under `slug` in this session — max written + 1, so the
 * first is 1.
 *
 * Gaps count as taken. The number is order, and handing a new conversation the
 * number a closed one used would make the genre's own agent↔lane map point at
 * two different things.
 *
 * ⚠ **Call this inside the transaction that does the insert.** It takes a
 * session-scoped `pg_advisory_xact_lock`, and an advisory *xact* lock is
 * released when its transaction commits — so on its own handle the lock is gone
 * before the caller writes, and two allocators read the same maximum. Same shape
 * and same reason as `allocatePosition` in `sockets/entries.ts`:
 *
 * ```ts
 * const lane = await db.transaction(async (tx) => {
 *   const lane = await nextLane(tx, sessionId, "text-messages")
 *   await insertLegacy(tx, { …, channel: formatChannel({ slug: "text-messages", lane }) })
 *   return lane
 * })
 * ```
 *
 * The maximum is computed in SQL rather than by reading the channels back,
 * because a channel with five thousand messages should cost one aggregate and
 * not five thousand rows over the wire.
 */
export async function nextLane(
	db: Db,
	sessionId: number,
	slug: string
): Promise<number> {
	const bare = formatChannel({ slug })
	await db.execute(
		sql`select pg_advisory_xact_lock(hashtext('channelLane'), ${sessionId})`
	)
	// A row on lane 1 stores the bare slug and has no `:n` to read, so the
	// substring is NULL there and coalesces to 1. `max` over no rows at all is
	// NULL, which coalesces to 0 — hence the first lane handed out is 1.
	const [row] = rawRows<{ max_lane: number | string | null }>(
		await db.execute(sql`
		select coalesce(max(coalesce(nullif(substring(${schema.sessionMessages.channel} from ':([0-9]+)$'), '')::int, 1)), 0) as max_lane
		from ${schema.sessionMessages}
		where ${schema.sessionMessages.sessionId} = ${sessionId}
		  and ${channelPrefixWhere(schema.sessionMessages.channel, bare)}
	`)
	)
	return Number(row?.max_lane ?? 0) + 1
}

/**
 * The channels a genre's shape declares, `main` first.
 *
 * `greeting.channel` counts: a genre that redirects its greetings to a lane
 * has created that lane by naming it, and requiring it to be listed twice
 * would be a validation that exists only to be tripped over.
 *
 * **Slugs out, whatever went in.** A declaration is a channel, and a channel is
 * a slug; a genre that writes `phone:2` here has declared `phone` and picked a
 * lane that was never anyone's to pick, since lanes are allocated at runtime.
 */
export function channelsOf(shape: SessionShape | undefined | null): string[] {
	const out = [DEFAULT_CHANNEL]
	const add = (candidate: unknown) => {
		if (typeof candidate !== "string") return
		const name = candidate.trim() ? parseChannel(candidate).slug : ""
		if (name && !out.includes(name)) out.push(name)
	}
	for (const declared of shape?.channels ?? []) add(declared)
	add(shape?.greeting?.channel)
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
		db,
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
	if (isAllChannels(requested))
		return (
			`'${ALL_CHANNELS}' selects every channel for a read — it is not a ` +
			`channel a message can be written to.`
		)
	/**
	 * The **slug**, never the whole string (ruling 2026-09-09). A genre declares
	 * channels; the lanes under one are runtime and open-ended — a lane exists
	 * because a pipeline wrote to it — so `text-messages:6` is refused exactly
	 * when `text-messages` is, and the number is never mentioned. Refusing an
	 * undeclared *lane* would be a validation against a count nobody declares.
	 */
	const { slug } = parseChannel(requested)
	if (slug === DEFAULT_CHANNEL) return null
	const available = await sessionChannels(db, sessionId)
	if (available.includes(slug)) return null
	return (
		`this session has no channel '${slug}' — its genre declares ` +
		`${available.map((c) => `'${c}'`).join(", ")}. A channel exists ` +
		`because a genre declares it; the lanes under a declared channel ` +
		`('${DEFAULT_CHANNEL}:2') do not need declaring.`
	)
}
