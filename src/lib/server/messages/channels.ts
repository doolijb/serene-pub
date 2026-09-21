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

import { and, desc, eq, like, or, sql, type SQL } from "drizzle-orm"
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
 * The **channel head** (plans/29 R-15 *Staleness and order*; 30 §U5f): the
 * greatest `session_messages.id` on ONE channel of a session — the exact
 * `channel` string, lane-scoped (`main:2` is not `main`), never the union —
 * or null when nothing has been written there.
 *
 * The newest-row definition: the published-values `item.isNewest` is "this
 * row IS the head". The forms' head is `stalenessHead` below — the same
 * greatest-id read, minus the row's own answers — which the host's block
 * write stamps as `head` and the fire door compares against. Deleted rows
 * are gone and do not count; hidden rows still exist on the channel and do.
 * Reads the legacy table because that column is authoritative for `channel`
 * (see the mirror note at the top of this file).
 */
export async function channelHead(
	db: Db,
	sessionId: number,
	channel: string
): Promise<number | null> {
	const [row] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.channel, channel)
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	return row?.id ?? null
}

/**
 * The **staleness head** for the forms on row `rowId` (U5f): the greatest
 * id on the row's channel among rows that are NOT answers to a form on that
 * row — a row whose `metadata.answersForm.messageId` names `rowId` is the
 * answer to one of its questions, and an answer does not move the
 * conversation on from the row it answers. So three questions on one row
 * can each be answered in turn, while any other line on the channel stales
 * every open form on the row. `channelHead` stays the newest-row
 * definition (`item.isNewest`); this is the one the block write stamps as
 * `head` and the fire door compares against.
 */
export async function stalenessHead(
	db: Db,
	sessionId: number,
	channel: string,
	rowId: number
): Promise<number | null> {
	const [row] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				eq(schema.sessionMessages.channel, channel),
				sql`coalesce(${schema.sessionMessages.metadata}->'answersForm'->>'messageId', '') <> ${String(rowId)}`
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	return row?.id ?? null
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
		// A declaration is a slug OR the long form `{ slug, role?, voice?,
		// messageVerbs? }` (R-C, 2026-09-17). Both name one channel, and this
		// function answers *which channels exist* — so both reduce to a slug
		// here, and the long form's extra answers are `channelDeclsOf`'s.
		const raw =
			candidate && typeof candidate === "object"
				? (candidate as { slug?: unknown }).slug
				: candidate
		if (typeof raw !== "string") return
		const name = raw.trim() ? parseChannel(raw).slug : ""
		if (name && !out.includes(name)) out.push(name)
	}
	for (const declared of shape?.channels ?? []) add(declared)
	add(shape?.greeting?.channel)
	return out
}

/**
 * How this channel's messages enter a prompt (R-C). `conversation` — the
 * default, and what every channel was before the long form existed — is turns
 * with speakers; `folio` is one block of text in time order, no speaker
 * names, placed before the conversation.
 */
export type ChannelRole = "conversation" | "folio"

/**
 * Whose name a turn triggered on this channel seeds under. Absent inherits the
 * genre's `voice`; `none` writes no seed row at all.
 */
export type ChannelVoice = "character" | "narrator" | "none"

/** One channel as this app reads it — the long form, defaults resolved. */
export interface ChannelDecl {
	slug: string
	role: ChannelRole
	voice?: ChannelVoice
	messageVerbs?: Record<string, boolean>
}

const CHANNEL_ROLES: readonly string[] = ["conversation", "folio"]
const CHANNEL_VOICES: readonly string[] = ["character", "narrator", "none"]

/**
 * The genre's channels as full declarations, `main` first — the app-side
 * mirror of the SDK's `channelDecls` (R-C, 2026-09-17).
 *
 * ⚠ Resolved here rather than imported from `@serene-pub/sdk`, for the same
 * reason `messages/writes.ts` resolves its policy locally: what arrives is a
 * stored registry row's JSON, read as `unknown`, and a reader that imported a
 * brand-new SDK symbol would tie core's compile to an SDK rebuild. The SDK
 * refuses a malformed declaration *at the declaration*; this side degrades —
 * an entry it cannot read is skipped, never guessed at.
 *
 * Per entry: `role` is always present; `voice` is the channel's, else the
 * genre's; `messageVerbs` is the genre's with the channel's declared keys over
 * the top. So what is read off an entry is the effective answer.
 */
export function channelDeclsOf(
	shape: SessionShape | undefined | null
): ChannelDecl[] {
	const s = (shape ?? {}) as {
		channels?: unknown
		voice?: unknown
		messageVerbs?: Record<string, boolean>
	}
	const genreVoice =
		typeof s.voice === "string" && CHANNEL_VOICES.includes(s.voice)
			? (s.voice as ChannelVoice)
			: undefined
	const genreVerbs = s.messageVerbs
	const resolve = (raw: unknown): ChannelDecl | undefined => {
		const decl = (
			typeof raw === "string"
				? { slug: raw }
				: raw && typeof raw === "object" && !Array.isArray(raw)
					? raw
					: {}
		) as Partial<ChannelDecl>
		const slug =
			typeof decl.slug === "string" && decl.slug.trim()
				? parseChannel(decl.slug).slug
				: ""
		if (!slug) return undefined
		const role =
			typeof decl.role === "string" && CHANNEL_ROLES.includes(decl.role)
				? decl.role
				: "conversation"
		const voice =
			typeof decl.voice === "string" && CHANNEL_VOICES.includes(decl.voice)
				? decl.voice
				: genreVoice
		const verbs =
			decl.messageVerbs || genreVerbs
				? { ...genreVerbs, ...decl.messageVerbs }
				: undefined
		return {
			slug,
			// `main` is the channel every session talks in; a declaration
			// that made it a folio would leave nowhere to talk, and the
			// SDK refuses one. Held here too, because this side reads stored
			// JSON that may predate or sidestep that refusal.
			role: slug === DEFAULT_CHANNEL ? "conversation" : role,
			...(voice ? { voice } : {}),
			...(verbs ? { messageVerbs: verbs } : {})
		}
	}
	const declared = (Array.isArray(s.channels) ? s.channels : [])
		.map(resolve)
		.filter((d): d is ChannelDecl => d !== undefined)
	const main = declared.find((d) => d.slug === DEFAULT_CHANNEL)
	return [
		main ?? resolve(DEFAULT_CHANNEL)!,
		...declared.filter((d) => d !== main)
	]
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
 * How a channel shapes a prompt, for the channels whose genre says anything
 * about it — or `null` when the genre says nothing.
 *
 * ⚠ **`null` is the whole point.** Every genre written before R-C, and every
 * genre that lists only bare slugs, gets `null` here, and the readers then do
 * *nothing at all* rather than something that happens to be equivalent. That
 * is what makes "the assembled prompt is byte-identical when no channel
 * declares a role" a structural fact instead of a hope.
 *
 * A channel is "shaping" when it reads as a `folio`, or when its voice is
 * not the genre's — the two answers that change what the prompt looks like.
 * A per-channel `messageVerbs` is not here: it changes what a person may do to
 * a row, not how the row is assembled (see `messages/verbs.ts`).
 */
export function channelShapingOf(
	shape: SessionShape | undefined | null
): Map<string, { role: ChannelRole; voice?: ChannelVoice }> | null {
	const raw = (shape as { voice?: unknown } | undefined)?.voice
	// Read through the same validity filter `channelDeclsOf` applies, so a
	// genre with an unreadable `voice` is not mistaken for one that shapes.
	const genreVoice =
		typeof raw === "string" && CHANNEL_VOICES.includes(raw)
			? (raw as ChannelVoice)
			: undefined
	const decls = channelDeclsOf(shape)
	const shapes = decls.some(
		(d) => d.role === "folio" || (d.voice ?? genreVoice) !== genreVoice
	)
	if (!shapes) return null
	return new Map(
		decls.map((d) => [
			d.slug,
			{ role: d.role, ...(d.voice ? { voice: d.voice } : {}) }
		])
	)
}

/**
 * This session's channel declarations, defaults resolved — `sessionChannels`
 * with the long form's answers kept (R-C).
 *
 * `[main]` for every session whose genre declares none, and for a session
 * whose genre this build no longer knows: an unknown genre is one whose
 * vocabulary cannot be stated, and inventing a folio channel for it would
 * reshape a prompt nobody asked to reshape.
 */
export async function sessionChannelDecls(
	db: Db,
	sessionId: number
): Promise<ChannelDecl[]> {
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return channelDeclsOf(undefined)
	const { getSessionGenre, STANDARD_GENRE_ID } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const genre = await getSessionGenre(
		db,
		session.genreId ?? STANDARD_GENRE_ID
	)
	return channelDeclsOf(genre?.shape)
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

/**
 * This session's per-channel prompt shaping, or `null` when its genre declares
 * none — `channelShapingOf` over the session's genre. Read once per run by the
 * host rather than per query: it is a fact about the genre, and the genre does
 * not change under a run.
 */
export async function sessionChannelShaping(
	db: Db,
	sessionId: number
): Promise<Map<string, { role: ChannelRole; voice?: ChannelVoice }> | null> {
	const [session] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return null
	const { getSessionGenre, STANDARD_GENRE_ID } = await import(
		"$lib/server/pipelines/entities/sessionGenres"
	)
	const genre = await getSessionGenre(
		db,
		session.genreId ?? STANDARD_GENRE_ID
	)
	return channelShapingOf(genre?.shape)
}
