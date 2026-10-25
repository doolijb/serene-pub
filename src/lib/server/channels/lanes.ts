/**
 * 🚧 **Personal channel lanes** — the session's lane register (owner ruling
 * 2026-10-17, lanes by person on the server; SDK INTEGRATING §1h).
 *
 * A channel a genre declares `lanes: 'personal'` (`ChannelDecl.lanes`) has
 * one lane per **person**, and core — not the genre — keeps which is whose:
 * one `channel_lanes` row per lane, allocated on the person's first
 * `core:query/channel-lane@1` or first send (`laneFor`). A **shared** channel
 * (the default) keeps the genre's own lanes and has no row here.
 *
 * Privacy is the server's. A personal lane's rows go to its person and the
 * session's owner alone — history reads, pushes and the layout's claim
 * (`laneViewFor` → `laneViewWhere` / `laneViewAllows` / `filterRowsForView`).
 * Pipelines read the whole session as before: the filter is a reader's, at
 * the socket, never the store's.
 *
 * Replaces the Dungeon Crawler's `dungeon-crawler-lanes` annex map, which
 * hid lanes on the client while every member received every row (AUDIT C8).
 */

import { and, eq, not, or, sql, type SQL } from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"
import { channelAudience, channelDecls, formatChannel, parseChannel } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { rawRows } from "$lib/server/db/rawRows"
import { channelPrefixWhere, DEFAULT_CHANNEL, nextLane } from "$lib/server/messages/channels"

/** Whose a channel's lanes are — the SDK's `ChannelLaneMode`. */
export type LaneMode = "shared" | "personal"

/** A refusal with the sentence a person reads (15 §1.3). */
export class LaneRefusal extends Error {
	constructor(message: string) {
		super(message)
		this.name = "LaneRefusal"
	}
}

/** The slugs a genre's shape declares with personal lanes. */
export function personalSlugsOf(shape: unknown): string[] {
	return channelDecls(shape)
		.filter((d) => d.lanes === "personal")
		.map((d) => parseChannel(d.slug).slug)
}

/**
 * Whether `slug` (a slug or any lane of it) is a channel of personal lanes
 * in this shape. `main` never is: the channel every session talks in is
 * everyone's.
 */
export function isPersonalChannel(shape: unknown, slug: string): boolean {
	const bare = parseChannel(slug).slug
	if (!bare || bare === DEFAULT_CHANNEL) return false
	return personalSlugsOf(shape).includes(bare)
}

/**
 * 🚧 The slugs a genre's shape declares for its **owner alone** (Lair
 * rewrite D6, 2026-10-21; `ChannelDecl.audience: 'owner'`) — the Lair's
 * Sanctum. Its rows, its pushes, its place in the channel list and the
 * composer's switch are the session owner's; every other member is told
 * nothing of it. Pipelines still read it: the filter is a reader's, at the
 * socket, never the store's. `main` never is (the SDK refuses one).
 */
export function ownerOnlySlugsOf(shape: unknown): string[] {
	return channelDecls(shape)
		.map((d) => parseChannel(d.slug).slug)
		.filter((slug) => slug !== DEFAULT_CHANNEL && channelAudience(shape, slug) === "owner")
}

/** Whether `slug` (any lane of it) is a channel only the session's owner reads. */
export function isOwnerOnlyChannel(shape: unknown, slug: string): boolean {
	const bare = parseChannel(slug).slug
	if (!bare || bare === DEFAULT_CHANNEL) return false
	return ownerOnlySlugsOf(shape).includes(bare)
}

/** Every channel of the shape with its lane mode, `main` first. */
export function laneModesOf(shape: unknown): Array<{ slug: string; lanes: LaneMode }> {
	return channelDecls(shape).map((d) => ({
		slug: parseChannel(d.slug).slug,
		lanes: d.lanes === "personal" && d.slug !== DEFAULT_CHANNEL ? "personal" : "shared"
	}))
}

/**
 * The genre's shape per genre id, briefly remembered: the broadcast path asks
 * on every streamed chunk of a non-`main` row, and a genre's declaration
 * changes only when a genre is installed or edited. Five seconds is the
 * longest a newly installed genre's personal channel could read as shared to
 * a push — never to a history read, which asks the same cache but is
 * followed by the next push within the window.
 */
const SHAPE_TTL_MS = 5_000
const shapeCache = new Map<string, { at: number; shape: unknown }>()

/** Drop the remembered shapes — a test, or a genre install, that must see a new declaration at once. */
export function forgetLaneShapes(): void {
	shapeCache.clear()
}

async function shapeOfGenre(db: Db, genreId: string): Promise<unknown> {
	const hit = shapeCache.get(genreId)
	if (hit && Date.now() - hit.at < SHAPE_TTL_MS) return hit.shape
	const { getSessionGenre } = await import("$lib/server/pipelines/entities/sessionGenres")
	const shape = (await getSessionGenre(db, genreId))?.shape ?? null
	shapeCache.set(genreId, { at: Date.now(), shape })
	return shape
}

/** A session's owner and its genre's shape, or null for no such session. */
export async function sessionLaneFacts(
	db: Db,
	sessionId: number
): Promise<{ ownerUserId: number; shape: unknown } | null> {
	const [row] = await db
		.select({ userId: schema.sessions.userId, genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!row) return null
	const { STANDARD_GENRE_ID } = await import("$lib/server/pipelines/entities/sessionGenres")
	return { ownerUserId: row.userId, shape: await shapeOfGenre(db, row.genreId ?? STANDARD_GENRE_ID) }
}

async function isMember(db: Db, sessionId: number, userId: number, ownerUserId: number): Promise<boolean> {
	if (userId === ownerUserId) return true
	const [guest] = await db
		.select({ userId: schema.sessionGuests.userId })
		.from(schema.sessionGuests)
		.where(and(eq(schema.sessionGuests.sessionId, sessionId), eq(schema.sessionGuests.userId, userId)))
		.limit(1)
	return !!guest
}

/** The register row for one person on one channel, if any. */
async function registeredLane(db: Db, sessionId: number, slug: string, userId: number): Promise<number | null> {
	const [row] = await db
		.select({ lane: schema.channelLanes.lane })
		.from(schema.channelLanes)
		.where(
			and(
				eq(schema.channelLanes.sessionId, sessionId),
				eq(schema.channelLanes.slug, slug),
				eq(schema.channelLanes.userId, userId)
			)
		)
		.limit(1)
	return row ? row.lane : null
}

/**
 * **The person's lane on a personal channel** — the register's row, or a new
 * one. Answers the canonical channel string (`parley` for lane 1, `parley:2`
 * after), the lane number and whether this call opened it.
 *
 * Allocation runs under the same session-scoped advisory xact lock
 * `nextLane` takes, and the number is one past the greater of the register's
 * highest lane AND the highest lane any row was written on — so a lane a
 * pipeline wrote to before the register knew it is never handed to somebody
 * else. Runs in a transaction of its own on `handle` (a savepoint when
 * `handle` is already a transaction, whose commit then releases the lock).
 *
 * Refused (`LaneRefusal`): a shared channel (its lanes are the genre's to
 * allocate), a person who is not a member of the session, no such session.
 */
export async function laneFor(
	handle: Db,
	sessionId: number,
	slug: string,
	userId: number
): Promise<{ channel: string; lane: number; opened: boolean }> {
	const bare = parseChannel(slug).slug
	const facts = await sessionLaneFacts(handle, sessionId)
	if (!facts) throw new LaneRefusal("There is no such session.")
	if (!isPersonalChannel(facts.shape, bare))
		throw new LaneRefusal(
			`'${bare}' is not a channel of personal lanes in this session's genre — its lanes are the genre's to allocate.`
		)
	if (!Number.isInteger(userId) || !(await isMember(handle, sessionId, userId, facts.ownerUserId)))
		throw new LaneRefusal("Only the session's owner and its guests have a lane here.")
	const known = await registeredLane(handle, sessionId, bare, userId)
	if (known !== null) return { channel: formatChannel({ slug: bare, lane: known }), lane: known, opened: false }
	return handle.transaction(async (tx) => {
		// `nextLane` takes the lock and reads the messages' highest lane; the
		// lock is re-entrant within one transaction, so the register read and
		// the insert below sit under the same hold.
		const fromRows = await nextLane(tx as unknown as Db, sessionId, bare)
		const again = await registeredLane(tx as unknown as Db, sessionId, bare, userId)
		if (again !== null) return { channel: formatChannel({ slug: bare, lane: again }), lane: again, opened: false }
		const [reg] = rawRows<{ max_lane: number | string | null }>(
			await tx.execute(sql`
				select coalesce(max(${schema.channelLanes.lane}), 0) as max_lane
				from ${schema.channelLanes}
				where ${schema.channelLanes.sessionId} = ${sessionId}
				  and ${schema.channelLanes.slug} = ${bare}
			`)
		)
		const lane = Math.max(fromRows, Number(reg?.max_lane ?? 0) + 1)
		await tx.insert(schema.channelLanes).values({ sessionId, slug: bare, lane, userId })
		return { channel: formatChannel({ slug: bare, lane }), lane, opened: true }
	})
}

/**
 * Whose lane `channel` is (`parley:2` → user id), or null — a shared
 * channel, a bare whole-channel read, or a lane nobody's register row names.
 * A bare slug here is lane 1 (the stored form), as every write reads it.
 */
export async function laneOwner(db: Db, sessionId: number, channel: string): Promise<number | null> {
	const ref = parseChannel(channel)
	if (!ref.slug) return null
	const [row] = await db
		.select({ userId: schema.channelLanes.userId })
		.from(schema.channelLanes)
		.where(
			and(
				eq(schema.channelLanes.sessionId, sessionId),
				eq(schema.channelLanes.slug, ref.slug),
				eq(schema.channelLanes.lane, ref.lane)
			)
		)
		.limit(1)
	return row ? row.userId : null
}

/**
 * One viewer's reach into a session's channels: which personal channels
 * there are, and the viewer's own lane on each. `all` — the session's owner,
 * or a session with no personal channel — reads every row.
 */
export interface LaneView {
	sessionId: number
	userId: number
	ownerUserId: number
	/** True for the session's owner. */
	isOwner: boolean
	/**
	 * Every channel this viewer has, with its lane mode, `main` first — a
	 * channel for the owner alone (`audience: 'owner'`) is listed for the
	 * owner only.
	 */
	channels: Array<{ slug: string; lanes: LaneMode }>
	/** 🚧 The owner-alone slugs this viewer may NOT read — empty for the owner. */
	hidden: Set<string>
	/** Personal slug → the viewer's lane (canonical), null while they have none. */
	mine: Map<string, string | null>
	/** True when nothing is hidden from this viewer. */
	all: boolean
}

/**
 * `visibleChannelsFor` by session id — the view every filtering reader asks
 * for. Null for no such session.
 */
export async function laneViewFor(db: Db, sessionId: number, userId: number): Promise<LaneView | null> {
	const facts = await sessionLaneFacts(db, sessionId)
	if (!facts) return null
	return visibleChannelsFor(db, { id: sessionId, userId: facts.ownerUserId, shape: facts.shape }, userId)
}

/**
 * **What this person may read**: every shared channel, and on each personal
 * channel their own lane — every lane for the session's owner. One register
 * read; no lane is allocated here.
 */
export async function visibleChannelsFor(
	db: Db,
	session: { id: number; userId: number; shape: unknown },
	userId: number
): Promise<LaneView> {
	const isOwner = userId === session.userId
	// 🚧 A channel for the owner alone is no part of anybody else's session (D6).
	const hidden = new Set(isOwner ? [] : ownerOnlySlugsOf(session.shape))
	const channels = laneModesOf(session.shape).filter((c) => !hidden.has(c.slug))
	const personal = channels.filter((c) => c.lanes === "personal").map((c) => c.slug)
	const mine = new Map<string, string | null>(personal.map((slug) => [slug, null]))
	if (personal.length) {
		const rows = await db
			.select({ slug: schema.channelLanes.slug, lane: schema.channelLanes.lane })
			.from(schema.channelLanes)
			.where(and(eq(schema.channelLanes.sessionId, session.id), eq(schema.channelLanes.userId, userId)))
		for (const r of rows) if (mine.has(r.slug)) mine.set(r.slug, formatChannel({ slug: r.slug, lane: r.lane }))
	}
	return {
		sessionId: session.id,
		userId,
		ownerUserId: session.userId,
		isOwner,
		channels,
		hidden,
		mine,
		all: isOwner || (personal.length === 0 && hidden.size === 0)
	}
}

/** Whether the viewer may read a row on `channel` (any spelling). */
export function laneViewAllows(view: LaneView | null, channel: string | null | undefined): boolean {
	if (!view || view.all) return true
	const ref = parseChannel(channel ?? DEFAULT_CHANNEL)
	if (view.hidden?.has(ref.slug)) return false
	if (!view.mine.has(ref.slug)) return true
	const own = view.mine.get(ref.slug)
	return own !== null && own !== undefined && own === formatChannel(ref)
}

/**
 * The SQL predicate for "rows this viewer may read", or `undefined` (drizzle's
 * `and()` drops it) when nothing is hidden. Belongs inside the read's `where`,
 * before any `LIMIT` — a page filtered after its limit is silently short.
 */
export function laneViewWhere(column: PgColumn, view: LaneView | null): SQL | undefined {
	if (!view || view.all) return undefined
	const clauses: SQL[] = []
	for (const slug of view.hidden ?? []) clauses.push(not(channelPrefixWhere(column, slug)))
	for (const [slug, own] of view.mine) {
		const whole = channelPrefixWhere(column, slug)
		clauses.push(own ? or(not(whole), eq(column, own))! : not(whole))
	}
	return clauses.length ? and(...clauses) : undefined
}

/** Rows the viewer may read, in their order. */
export function filterRowsForView<T extends { channel?: string | null }>(view: LaneView | null, rows: T[]): T[] {
	if (!view || view.all) return rows
	return rows.filter((r) => laneViewAllows(view, r.channel))
}

/**
 * Who may read a row on `channel` among `recipients`: everyone for a shared
 * channel; the lane's person and the session's owner for a personal lane.
 * For the push path, which has the row and the member list in hand and asks
 * once per row rather than once per member. Null = everyone.
 */
export async function laneReadersOf(db: Db, sessionId: number, channel: string | null | undefined): Promise<Set<number> | null> {
	const ref = parseChannel(channel ?? DEFAULT_CHANNEL)
	if (!ref.slug || ref.slug === DEFAULT_CHANNEL) return null
	const facts = await sessionLaneFacts(db, sessionId)
	if (!facts) return null
	// 🚧 The owner's alone (D6): nobody else is pushed a row of it.
	if (isOwnerOnlyChannel(facts.shape, ref.slug)) return new Set([facts.ownerUserId])
	if (!isPersonalChannel(facts.shape, ref.slug)) return null
	const owner = await laneOwner(db, sessionId, formatChannel(ref))
	const readers = new Set<number>([facts.ownerUserId])
	if (owner !== null) readers.add(owner)
	return readers
}
