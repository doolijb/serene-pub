/**
 * 🚧 **A session's own book** — the lorebook every session owns from the
 * moment it exists (pr-6, audit pass 11, 2026-10-24): "Every session has a
 * lorebook from the moment it exists: its own book, created at
 * `sessions:create` (not lazily), named after the session, owned by its owner,
 * taking its ruleset and a default calendar." A person meets it as **Session
 * notes** (`$lib/shared/lorebooks/sessionNotes`) and as one action, **Share as
 * a lorebook**. Formerly `phantom.ts`; the word retired with the mode, 2026-10-24.
 *
 * ## A real lorebook row, not JSON
 *
 * The own book is a `lorebooks` row with `session_id` set, on the same tables
 * and the same lorebook API as any book — entries, links, amendments, dated
 * history, stats on their owners — so every reader that takes a book id
 * reads it unchanged. It is:
 *
 * - **made at the session's birth** (`insertOwnBook`, inside `sessions:create`,
 *   the chat imports and a branch), named after the session and taking its
 *   ruleset; born Gregorian (`OWN_BOOK_CALENDAR`) with its clock unset.
 *   `ownBookFor` is the get-or-create safety net for a session a path skipped,
 *   and `ensureOwnBooks` the boot pass that gave older sessions theirs;
 * - **out of the pickers**: the shared lists and search filter
 *   `session_id IS NULL`; `lorebooks:sessionNotes` lists the asker's own, and
 *   the access check lets the session's members in and nobody else
 *   (`ownBookAccessFor`);
 * - **the session's**, with no permission or approval ever asked — managed by
 *   the session alone, and deleted with it (`purgeOwnBookOf`) — or, while a
 *   branch rides it, with the last branch (`purgeKeptOwnBooks`);
 * - **an overlay** (`overlay_of`) while the session reads a real lorebook it
 *   may not write: the own book then holds the session's diff, and a
 *   session's reading is the union (`lorebooksReadBy`).
 *
 * ## Where a session's world write lands
 *
 * `loreWriteTargetFor` is the one routing rule: the attached book when the
 * session's owner owns it and their lore write mode is **Full**; otherwise —
 * no book, Review changes, Off, or a book someone else owns — the own book,
 * each row stamped with the message that wrote it (`source_message_id`), so
 * the timeline (§29) retracts it with its message and a branch knows whether
 * it came across.
 *
 * ## Branches
 *
 * A session branch is a new session; its own book is a copy of the parent's as
 * of the fork (`copyOwnBookToBranch`): every row anchored at or before the
 * fork message, anchors remapped onto the copied messages. Deliberately a
 * copy rather than a `lorebook_branches` line on the parent's book: the
 * parent's book goes with the parent, and a branch session that outlives
 * its parent must not lose its world with it.
 */

import { and, eq, gt, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm"
import { randomUUID } from "node:crypto"
import { liveMessageWhere } from "$lib/server/messages/store"
import * as schema from "$lib/server/db/schema"
import { sessionLoreWriteMode } from "$lib/server/state/loreWriteMode"
import { ensureSessionLine } from "$lib/server/lorebooks/sessionLine"
import type { LoreWriteMode } from "$lib/shared/lorebooks/loreWriteMode"
import { SHARE_REFUSALS, SURFACED_BOOK_REFUSAL } from "$lib/shared/lorebooks/sessionNotes"
import { STORY_CALENDAR_PRESETS, parseStoryCalendar, type StoryCalendar } from "@serene-pub/sdk"
import { getSessionGenre } from "$lib/server/pipelines/entities/sessionGenres"

/** What a session's own book is named when the session has no name. */
const UNNAMED = "Untitled session"

export type OwnBookRow = typeof schema.lorebooks.$inferSelect

/** 🚧 R-e: the calendar every own book is born with — the SDK preset "Twelve months, 365 days". Its clock is unset. */
export const OWN_BOOK_CALENDAR: StoryCalendar = STORY_CALENDAR_PRESETS.find(
	(p) => p.id === "twelve-months"
)!.calendar

/** The session's own book, when it has one. Never creates. */
export async function ownBookOf(
	db: Db,
	sessionId: number
): Promise<OwnBookRow | null> {
	const [row] = await db
		.select()
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.sessionId, sessionId))
		.limit(1)
	return row ?? null
}

/**
 * The session's own book, made on first ask (the safety net — `insertOwnBook` makes it at birth): named after the session,
 * owned by its owner, taking its ruleset, and overlaying its attached lorebook when it
 * has one. An existing row's `overlay_of` follows the session's book, so a
 * session that attaches or drops a book reads its notes the right way round.
 *
 * Race-safe: the partial unique index on `session_id` lets two first writes
 * both insert and one win (`ON CONFLICT DO NOTHING`), and both read the winner.
 */
export async function ownBookFor(
	db: Db,
	sessionId: number
): Promise<OwnBookRow> {
	const [session] = await db
		.select({
			id: schema.sessions.id,
			name: schema.sessions.name,
			userId: schema.sessions.userId,
			lorebookId: schema.sessions.lorebookId,
			primaryRuleset: schema.sessions.primaryRuleset,
			rulesetVersion: schema.sessions.rulesetVersion
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) throw new Error(`Session ${sessionId} not found`)
	const overlayOf = session.lorebookId ?? null

	const existing = await ownBookOf(db, sessionId)
	if (existing) {
		// The notes follow the session on every resync — its book AND its
		// ruleset (A19): a session that changes ruleset otherwise keeps notes
		// stamped with the one it left, and their pieces read as a stranger's.
		const rulesetVersion = session.rulesetVersion ?? null
		if (existing.overlayOf !== overlayOf) {
			// The book lock (PLAN-lorebook-kinds §A) keeps a session from
			// changing books once its notes hold anything; notes moved with
			// content in them were written against another book.
			const [held] = await db
				.select({ id: schema.lorebookEntries.id })
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.lorebookId, existing.id))
				.limit(1)
			if (held)
				console.warn(
					`[own-book] session ${sessionId}'s notes moved from book ${existing.overlayOf} to ${overlayOf} with entries in them`
				)
		}
		if (
			existing.overlayOf !== overlayOf ||
			existing.primaryRuleset !== session.primaryRuleset ||
			(existing.rulesetVersion ?? null) !== rulesetVersion
		) {
			const [moved] = await db
				.update(schema.lorebooks)
				.set({ overlayOf, primaryRuleset: session.primaryRuleset, rulesetVersion })
				.where(eq(schema.lorebooks.id, existing.id))
				.returning()
			return moved ?? existing
		}
		return existing
	}

	return insertOwnBook(db, {
		sessionId,
		userId: session.userId,
		name: session.name,
		overlayOf,
		primaryRuleset: session.primaryRuleset,
		rulesetVersion: session.rulesetVersion ?? null
	})
}

/**
 * The calendar an own book starts with when the caller names none: the session
 * genre's declared `shape.calendar` — with `months`, the declaration IS the
 * calendar; without, core's own-book calendar with the declared `periods` and
 * `seasons` laid on it. No declaration, or one that does not parse: core's.
 */
async function genreCalendarOf(tx: Db, sessionId: number): Promise<StoryCalendar> {
	const [session] = await tx
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return OWN_BOOK_CALENDAR
	const decl = (await getSessionGenre(tx, session.genreId))?.shape.calendar
	if (!decl) return OWN_BOOK_CALENDAR
	try {
		if (decl.months) return parseStoryCalendar(decl) ?? OWN_BOOK_CALENDAR
		return (
			parseStoryCalendar({
				...OWN_BOOK_CALENDAR,
				...(decl.periods !== undefined ? { periods: decl.periods } : {}),
				...(decl.seasons !== undefined ? { seasons: decl.seasons } : {})
			}) ?? OWN_BOOK_CALENDAR
		)
	} catch {
		return OWN_BOOK_CALENDAR
	}
}

/**
 * 🚧 The one insert of an own book: `kind` 'book', `story_calendar`
 * the genre's declared calendar (else `OWN_BOOK_CALENDAR`), every `story_clock_*` NULL; a blank name reads
 * "Untitled session". `ON CONFLICT DO NOTHING` on the `session_id` index, then
 * a read on the same handle — two first writes both insert and one wins.
 * Inside a transaction, pass its `tx`.
 */
export async function insertOwnBook(
	tx: Db,
	row: {
		sessionId: number
		userId: number
		name: string | null
		overlayOf: number | null
		primaryRuleset: string
		rulesetVersion: string | null
		/** The book's calendar; absent, the session's genre declares it (`shape.calendar`), else core's. */
		calendar?: StoryCalendar | null
	}
): Promise<OwnBookRow> {
	const calendar = row.calendar !== undefined ? row.calendar : await genreCalendarOf(tx, row.sessionId)
	await tx
		.insert(schema.lorebooks)
		.values({
			name: row.name?.trim() || UNNAMED,
			userId: row.userId,
			sessionId: row.sessionId,
			kind: "book",
			overlayOf: row.overlayOf,
			primaryRuleset: row.primaryRuleset,
			rulesetVersion: row.rulesetVersion,
			storyCalendar: calendar,
			storyClockYear: null,
			storyClockMonth: null,
			storyClockDay: null,
			storyClockHour: null,
			storyClockMinute: null
		})
		.onConflictDoNothing()
	const made = await ownBookOf(tx, row.sessionId)
	if (!made) throw new Error(`The own book of session ${row.sessionId} could not be made`)
	return made
}

/**
 * The book a session's clock, scenes, summaries and vocabulary live in: its
 * attached lorebook, else its own book (made if missing). Null only when the
 * session row is gone.
 */
export async function attachedOrOwnBookOf(db: Db, sessionId: number): Promise<number | null> {
	const [session] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return null
	if (session.lorebookId != null) return session.lorebookId
	return (await ownBookFor(db, sessionId)).id
}

/**
 * ⏳ The boot pass (pr-6, B §B-3): one transaction, `tx` only. Every session
 * with no own book gets one (`insertOwnBook`'s row, `overlay_of` = its
 * lorebook); every own book whose `overlay_of` differs from its session's
 * `lorebook_id` is set to it. An existing own book keeps its calendar, clock
 * and contents. Idempotent.
 */
export async function ensureOwnBooks(db: Db): Promise<{ made: number; overlaysSet: number }> {
	return db.transaction(async (tx) => {
		const t = tx as unknown as Db
		const sessions = await t
			.select({
				id: schema.sessions.id,
				userId: schema.sessions.userId,
				name: schema.sessions.name,
				lorebookId: schema.sessions.lorebookId,
				primaryRuleset: schema.sessions.primaryRuleset,
				rulesetVersion: schema.sessions.rulesetVersion
			})
			.from(schema.sessions)
			.where(
				sql`not exists (select 1 from ${schema.lorebooks} where ${schema.lorebooks.sessionId} = ${schema.sessions.id})`
			)
		let made = 0
		for (const s of sessions) {
			await insertOwnBook(t, {
				sessionId: s.id,
				userId: s.userId,
				name: s.name,
				overlayOf: s.lorebookId ?? null,
				primaryRuleset: s.primaryRuleset,
				rulesetVersion: s.rulesetVersion ?? null
			})
			made++
		}
		const moved = await t.execute(sql`
			update ${schema.lorebooks} as l
			set overlay_of = s.lorebook_id
			from ${schema.sessions} as s
			where l.session_id = s.id and l.overlay_of is distinct from s.lorebook_id
			returning l.id
		`)
		const rows = (moved as unknown as { rows?: unknown[] }).rows ?? (moved as unknown as unknown[])
		return { made, overlaysSet: Array.isArray(rows) ? rows.length : 0 }
	})
}

/**
 * The books a session reads (§26 "reads are the union"): its attached
 * lorebook, then its own notes — each only when it exists. `ids` is the two
 * in that order, for a reader that loops; a row read from `ownBookId` is
 * "this session only" on the wire (`sessionOnly: true`).
 */
export interface BooksReadBy {
	attachedId: number | null
	ownBookId: number | null
	ids: number[]
}

export async function lorebooksReadBy(
	db: Db,
	session: number | { id: number; lorebookId: number | null }
): Promise<BooksReadBy> {
	let row: { id: number; lorebookId: number | null } | undefined
	if (typeof session === "number") {
		;[row] = await db
			.select({ id: schema.sessions.id, lorebookId: schema.sessions.lorebookId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, session))
			.limit(1)
	} else row = session
	if (!row) return { attachedId: null, ownBookId: null, ids: [] }
	const ownBook = await ownBookOf(db, row.id)
	return booksReadBy(row.lorebookId ?? null, ownBook?.id ?? null)
}

/** The pure half of `lorebooksReadBy`: the two ids, in reading order. */
export function booksReadBy(attachedId: number | null, ownBookId: number | null): BooksReadBy {
	const ids: number[] = []
	if (attachedId != null) ids.push(attachedId)
	if (ownBookId != null && ownBookId !== attachedId) ids.push(ownBookId)
	return { attachedId, ownBookId: ownBookId === attachedId ? null : ownBookId, ids }
}

/**
 * Where a session's world write lands (§15, §26; the brief's routing rule):
 *
 * - `book` — the attached lorebook: the session's owner owns it and the
 *   owner's lore write mode is **Full**;
 * - `own-book` — the session's own notes: no book, Review changes, Off, or a
 *   book someone else owns (a shared book is read and copied, never written).
 *
 * Pure: the caller reads the facts. `reason: "delete"` is the delete
 * safeguard, whose notes go with the session it records — it never routes to
 * them (see `durable.ts`).
 */
export type LoreWriteRoute = "book" | "own-book"

export function loreWriteRoute(facts: {
	attachedId: number | null
	bookOwnerId: number | null
	sessionOwnerId: number
	mode: LoreWriteMode
}): LoreWriteRoute {
	if (facts.attachedId == null) return "own-book"
	if (facts.bookOwnerId !== facts.sessionOwnerId) return "own-book"
	return facts.mode === "full" ? "book" : "own-book"
}

export interface LoreWriteTarget {
	route: LoreWriteRoute
	/** The book the row lands in: the attached one, or the notes (made on demand). */
	lorebookId: number
	/** The attached lorebook, when the session reads one. */
	attachedId: number | null
	/** The book owner's mode the route followed. */
	mode: LoreWriteMode
	/**
	 * The anchor a row written to the notes carries (`source_message_id`): the
	 * turn's message when the writer names one (`anchorMessageId`, a message
	 * of this session), else the session's newest message. Null for a write
	 * to the real book, and for a session with no messages yet.
	 */
	sourceMessageId: number | null
}

/**
 * `loreWriteRoute` with its facts read, the notes made when the route needs
 * them. `anchorMessageId` is the turn's message (a run's live row): a row a
 * turn writes retracts with that turn, whatever was posted since. One that
 * is not this session's message is ignored for the newest. `fork: false`
 * routes without forking the session's line.
 */
export async function loreWriteTargetFor(
	db: Db,
	sessionId: number,
	opts: { anchorMessageId?: number | null; fork?: boolean } = {}
): Promise<LoreWriteTarget> {
	const [session] = await db
		.select({ userId: schema.sessions.userId, lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) throw new Error(`Session ${sessionId} not found`)
	const attachedId = session.lorebookId ?? null
	const [book] =
		attachedId == null
			? []
			: await db
					.select({ userId: schema.lorebooks.userId })
					.from(schema.lorebooks)
					.where(eq(schema.lorebooks.id, attachedId))
					.limit(1)
	const mode = await sessionLoreWriteMode(db, sessionId)
	const route = loreWriteRoute({
		attachedId,
		bookOwnerId: book?.userId ?? null,
		sessionOwnerId: session.userId,
		mode
	})
	if (route === "book") {
		// 🚧 The session's first write to the attached book forks its line,
		// unless the caller forks it itself, inside its own transaction and
		// after its checks (`opts.fork: false`; `recordToTimeline`).
		if (opts.fork !== false) await ensureSessionLine(db, sessionId)
		return { route, lorebookId: attachedId!, attachedId, mode, sourceMessageId: null }
	}
	const ownBook = await ownBookFor(db, sessionId)
	return {
		route,
		lorebookId: ownBook.id,
		attachedId,
		mode,
		sourceMessageId: await turnAnchorOf(db, sessionId, opts.anchorMessageId)
	}
}

/**
 * 🚧 (sense-b4, 2026-11-12) Whether a session's scenes end by themselves, so
 * that a pipeline's new entry, place, history day or link goes to its own book
 * whatever the lorebook's write setting, and reaches the lorebook only by
 * Apply, which runs by itself as scenes close. True only when all hold: the
 * session reads an attached lorebook; it runs the scenes routine
 * (`scenesRoutineOn`: an effective `core:spec/scene-boundaries` registration
 * that is not Off); its scene mode is Automatic; and it may place a scene at
 * all (`sessionSceneContext(…).mayPlace`: its genre writes scenes and lore
 * writes are not Off). Every other session writes as it did before this build
 * lane. Read once per write; a fault refuses the write (it never falls
 * back to the lorebook).
 */
export async function scenesEndByThemselves(db: Db, sessionId: number): Promise<boolean> {
	try {
		const [session] = await db
			.select({ lorebookId: schema.sessions.lorebookId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (session?.lorebookId == null) return false
		const { scenesRoutineOn } = await import("$lib/server/scenes/boundaryWatcher")
		if (!(await scenesRoutineOn(db, sessionId))) return false
		const { sessionSceneContext } = await import("$lib/server/sessions/sceneSettings")
		const ctx = await sessionSceneContext(db, sessionId)
		return !!ctx && ctx.mayPlace && ctx.settings.mode === "automatic"
	} catch (err) {
		// A fault here must not quietly send a write into the shared lorebook:
		// the write fails where a person can see it.
		throw new Error(
			`Could not tell where session ${sessionId} keeps what it writes, so nothing was written.`,
			{ cause: err }
		)
	}
}

/**
 * 🚧 (M2b) The book a session's lore write would land on, read only: the
 * attached book when `loreWriteRoute` sends the write there, else the
 * session's own book when it has one — never made here (null: none yet, or
 * no session). What `lorebook-annex`'s `version` reads for a compare-and-set.
 */
export async function loreWriteBookIdOf(db: Db, sessionId: number): Promise<number | null> {
	const [session] = await db
		.select({ userId: schema.sessions.userId, lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return null
	const attachedId = session.lorebookId ?? null
	const [book] =
		attachedId == null
			? []
			: await db
					.select({ userId: schema.lorebooks.userId })
					.from(schema.lorebooks)
					.where(eq(schema.lorebooks.id, attachedId))
					.limit(1)
	const mode = await sessionLoreWriteMode(db, sessionId)
	const route = loreWriteRoute({
		attachedId,
		bookOwnerId: book?.userId ?? null,
		sessionOwnerId: session.userId,
		mode
	})
	if (route === "book") return attachedId
	return (await ownBookOf(db, sessionId))?.id ?? null
}

/**
 * 🚧 (m3b-V2, ★M3b-W-1, owner 2026-11-05) Whether a session keeps its
 * world-scope attribute values in its own notes: it reads no book, or a book
 * its owner does not own (a member's session on a pub-wide/provided or shared
 * book). `loreWriteRoute`'s ownership rule with the write mode set aside — the
 * mode never moves values (the owner's own book keeps them under its mode).
 */
export async function keepsValuesInOwnBook(db: Db, sessionId: number): Promise<boolean> {
	const [session] = await db
		.select({ userId: schema.sessions.userId, lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return false
	const attachedId = session.lorebookId ?? null
	const [book] =
		attachedId == null
			? []
			: await db
					.select({ userId: schema.lorebooks.userId })
					.from(schema.lorebooks)
					.where(eq(schema.lorebooks.id, attachedId))
					.limit(1)
	return (
		loreWriteRoute({
			attachedId,
			bookOwnerId: book?.userId ?? null,
			sessionOwnerId: session.userId,
			mode: "full"
		}) === "own-book"
	)
}

/**
 * The message a session write anchors to: `anchorMessageId` when it is a
 * message of this session, else the session's newest (null with none).
 */
export async function turnAnchorOf(
	db: Db,
	sessionId: number,
	anchorMessageId?: number | null
): Promise<number | null> {
	if (anchorMessageId != null && Number.isSafeInteger(anchorMessageId)) {
		const [own] = await db
			.select({ id: schema.messages.id })
			.from(schema.messages)
			.where(
				and(
					eq(schema.messages.id, anchorMessageId),
					eq(schema.messages.sessionId, sessionId),
					liveMessageWhere(schema.messages.rewindOrdinal)
				)
			)
			.limit(1)
		if (own) return own.id
	}
	const { newestMessageId } = await import("$lib/server/state/write")
	return await newestMessageId(db, sessionId)
}

/**
 * Whether `userId` may read and write book `lorebookId` as a session's notes:
 * `undefined` when the book is not anyone's notes (ask the ordinary check),
 * else whether they are one of the session's members — its owner or a guest.
 * Nobody else: no share, no administrator exception — the notes are the
 * session's and nothing else's (ruled 2026-10-16).
 */
export async function ownBookAccessFor(
	db: Db,
	lorebookId: number,
	userId: number
): Promise<boolean | undefined> {
	const [book] = await db
		.select({ sessionId: schema.lorebooks.sessionId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	if (book?.sessionId == null) return undefined
	return isSessionMember(db, book.sessionId, userId)
}

async function isSessionMember(db: Db, sessionId: number, userId: number): Promise<boolean> {
	const [session] = await db
		.select({ userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return false
	if (session.userId === userId) return true
	const [guest] = await db
		.select({ userId: schema.sessionGuests.userId })
		.from(schema.sessionGuests)
		.where(
			and(
				eq(schema.sessionGuests.sessionId, sessionId),
				eq(schema.sessionGuests.userId, userId)
			)
		)
		.limit(1)
	return !!guest
}

/** One own book: what on it carries no key goes (`purgeLorebook`), then the row and its entries, in one transaction. */
async function purgeBook(db: Db, lorebookId: number): Promise<void> {
	const { purgeLorebook } = await import("$lib/server/lorebooks/tableRegistry")
	await db.transaction(async (tx) => {
		await purgeLorebook(tx as unknown as Db, lorebookId)
		await tx.delete(schema.lorebooks).where(eq(schema.lorebooks.id, lorebookId))
	})
}

/**
 * Called after a session row is deleted: its own book goes — what it holds that
 * carries no key (the stat rows on its owners, pending changes, ranking
 * evidence) by `purgeLorebook`, then the row and its entries — **unless a live
 * session's branch ancestry names it**: a branch still reads those notes, so
 * they outlive the parent and go with the last branch (`purgeKeptOwnBooks`,
 * plan §33.3). `session_id` has no foreign key, so nothing cascades, and a
 * live session's book is never touched. Returns whether the book was purged.
 */
export async function purgeOwnBookOf(db: Db, sessionId: number): Promise<boolean> {
	return (await purgeKeptOwnBooks(db, [sessionId])) > 0
}

/**
 * 🚧 Own books kept past their session (plan §33.3): purges each own book
 * whose session row is gone and that no live session's branch ancestry names.
 * Given `sessionIds` (a deleted session or a deleted branch's ancestors) it
 * looks only at those; without, at every own book whose session is gone (the
 * boot backstop, `kept-own-books`). Returns how many it purged.
 */
export async function purgeKeptOwnBooks(
	db: Db,
	sessionIds?: readonly number[]
): Promise<number> {
	if (sessionIds && !sessionIds.length) return 0
	const kept = await db
		.select({ id: schema.lorebooks.id })
		.from(schema.lorebooks)
		.where(
			and(
				sessionIds
					? inArray(schema.lorebooks.sessionId, [...sessionIds])
					: sql`${schema.lorebooks.sessionId} IS NOT NULL`,
				sql`NOT EXISTS (SELECT 1 FROM ${schema.sessions} WHERE ${schema.sessions.id} = ${schema.lorebooks.sessionId})`,
				sql`NOT EXISTS (SELECT 1 FROM sessions r WHERE r.branch_ancestry @> jsonb_build_array(jsonb_build_object('sessionId', ${schema.lorebooks.sessionId})))`
			)
		)
	let purged = 0
	for (const book of kept) {
		await purgeBook(db, book.id)
		purged++
	}
	return purged
}

/**
 * A revision that overwrites (§28 `overwrite`): the notes' rows anchored to
 * the deleted messages go with them. Their `source_message_id` is a plain
 * int, so the message cascade cannot take them; this is that cascade, called
 * inside the delete's own transaction. Returns the entry ids removed.
 */
export async function retractOwnBookEntriesAnchoredTo(
	tx: Db,
	sessionId: number,
	messageIds: readonly number[]
): Promise<number[]> {
	return (await takeOwnBookEntriesAnchoredTo(tx, sessionId, messageIds)).map((r) => r.id)
}

/**
 * 🚧 The same retraction, handing back the rows as they were (RF fix 4) — so
 * a swipe whose replacement run fails can put them back
 * (`restoreRetractedState`). Called for every swipe, regenerate and delete
 * (`retractLoreAnchoredTo`), after the lore imprints: a row a run filed with
 * an imprint is already taken back by it, and this takes what carries only
 * its anchor.
 */
export async function takeOwnBookEntriesAnchoredTo(
	tx: Db,
	sessionId: number,
	messageIds: readonly number[]
): Promise<(typeof schema.lorebookEntries.$inferSelect)[]> {
	if (!messageIds.length) return []
	const [ownBook] = await tx
		.select({ id: schema.lorebooks.id })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.sessionId, sessionId))
		.limit(1)
	if (!ownBook) return []
	return tx
		.delete(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, ownBook.id),
				inArray(schema.lorebookEntries.sourceMessageId, [...messageIds])
			)
		)
		.returning()
}

/**
 * A session branch's notes (§28 "the own book branches with it"): a copy of
 * the parent's as of the fork, inside the branch's own transaction. An entry
 * anchored after the fork stays behind; one with no anchor (written before
 * the session had a message) comes across; every anchor moves onto its
 * copied message. Entries are copied; so, when the parent reads its notes
 * alone (no attached book), are the notes' durable stat rows, sheets and
 * entry–entry links standing on main or on the copied line (a row dated after
 * the fork stays behind). Members ride: the branch reads its parent's people
 * through its overlay chain, so none is copied, and member links stay with
 * the parent's notes for now.
 *
 * A branch of a session that reads an attached lorebook also carries the
 * parent's links 🚧 as of the fork (`copyAttachedNotesLinks`: each cut at the
 * message of its made-row imprint, a lorebook entry or member at an end kept as
 * is, the branch's own turn owning the copy), and an entry filed under a
 * lorebook member keeps that binding; the notes' own members stay unfiled.
 *
 * A branch of a session that reads an attached lorebook also carries the
 * parent's held amendments 🚧 on that lorebook's entries, cut at the fork
 * message like the entries are, each moved onto its copied turn.
 *
 * 🚧 A parent that reads its notes alone on a line (it folded an attached
 * book into them, `foldInParent`) carries that line: the branch's copy gets
 * the line and every line it forked through (root first, forks mapped), the
 * notes' entries on that chain with their entry amendments, and the branch
 * stands on the copy of the line (`lineId`). Anything else is main's rows
 * alone, as before, and `lineId` is null.
 */
export async function copyOwnBookToBranch(
	tx: Db,
	input: {
		sessionId: number
		created: { id: number; name: string | null; userId: number; lorebookId: number | null; primaryRuleset: string; rulesetVersion: string | null }
		forkMessageId: number
		remap: Map<number, number>
	}
): Promise<{ lorebookId: number; entryRemap: Map<number, number>; lineId: number | null }> {
	const [parent] = await tx
		.select()
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.sessionId, input.sessionId))
		.limit(1)
	if (!parent) {
		// A parent with no own book (a session a path skipped): the branch
		// still owns one, born as every own book is.
		const fresh = await insertOwnBook(tx, {
			sessionId: input.created.id,
			userId: input.created.userId,
			name: input.created.name,
			overlayOf: input.created.lorebookId,
			primaryRuleset: input.created.primaryRuleset,
			rulesetVersion: input.created.rulesetVersion
		})
		return { lorebookId: fresh.id, entryRemap: new Map(), lineId: null }
	}
	const [made] = await tx
		.insert(schema.lorebooks)
		.values({
			name: input.created.name?.trim() || parent.name,
			description: parent.description,
			userId: input.created.userId,
			sessionId: input.created.id,
			overlayOf: input.created.lorebookId ?? null,
			primaryRuleset: input.created.primaryRuleset,
			rulesetVersion: input.created.rulesetVersion,
			storyCalendar: parent.storyCalendar,
			storyClockYear: parent.storyClockYear,
			storyClockMonth: parent.storyClockMonth,
			storyClockDay: parent.storyClockDay,
			storyClockHour: parent.storyClockHour,
			storyClockMinute: parent.storyClockMinute
		})
		.returning({ id: schema.lorebooks.id })
	const chain = await copyParentLineChain(tx, input, parent.id, made!.id)
	const entries = await tx
		.select()
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, parent.id),
				// Main's rows, and — on a line — the rows of the line's chain.
				chain.lineMap.size
					? or(
							isNull(schema.lorebookEntries.branchId),
							inArray(schema.lorebookEntries.branchId, [...chain.lineMap.keys()])
						)
					: isNull(schema.lorebookEntries.branchId)
			)
		)
		.orderBy(schema.lorebookEntries.id)
	// A lorebook's member keeps its binding on an own-book entry filed under it;
	// the notes' own members are not copied, so their entries stay unfiled.
	const lorebookMembers = new Set(
		input.created.lorebookId != null
			? (
					await tx
						.select({ id: schema.lorebookBindings.id })
						.from(schema.lorebookBindings)
						.where(eq(schema.lorebookBindings.lorebookId, input.created.lorebookId))
				).map((b) => b.id)
			: []
	)
	// Children after their parents: an anchor entry is remapped as it lands.
	const entryRemap = new Map<number, number>()
	for (const entry of entries) {
		const source = entry.sourceMessageId
		let anchor: number | null = null
		if (source != null) {
			if (source > input.forkMessageId) continue
			const moved = input.remap.get(source)
			if (moved === undefined) continue
			anchor = moved
		}
		const {
			id: oldId,
			createdAt: _c,
			updatedAt: _u,
			embedTextHash: _e,
			annotationTextHash: _a,
			...rest
		} = entry as typeof entry & { embedTextHash?: unknown; annotationTextHash?: unknown }
		const [copy] = await tx
			.insert(schema.lorebookEntries)
			.values({
				...(rest as typeof schema.lorebookEntries.$inferInsert),
				lorebookId: made!.id,
				anchorEntryId:
					entry.anchorEntryId != null ? (entryRemap.get(entry.anchorEntryId) ?? null) : null,
				// The cast of the notes is not copied: no binding to anchor to;
				// a lorebook member's binding is the same row in the branch.
				anchorBindingId:
					entry.anchorBindingId != null && lorebookMembers.has(entry.anchorBindingId)
						? entry.anchorBindingId
						: null,
				sourceMessageId: anchor,
				branchId: entry.branchId != null ? (chain.lineMap.get(entry.branchId) ?? null) : null
			})
			.returning({ id: schema.lorebookEntries.id })
		entryRemap.set(oldId, copy!.id)
	}
	if (chain.lineMap.size) {
		// The amendments of the copied entries, on main and on the chain:
		// entry, line and history entry moved onto their copies (a history
		// entry that did not come across is let go, as its delete would).
		// An amendment carries no source message of its own: it follows its entry.
		const amendments = await tx
			.select()
			.from(schema.entryAmendments)
			.where(
				and(
					eq(schema.entryAmendments.lorebookId, parent.id),
					inArray(schema.entryAmendments.entryId, [...entryRemap.keys()]),
					or(
						isNull(schema.entryAmendments.branchId),
						inArray(schema.entryAmendments.branchId, [...chain.lineMap.keys()])
					)
				)
			)
			.orderBy(schema.entryAmendments.id)
		for (const a of amendments) {
			const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = a
			await tx.insert(schema.entryAmendments).values({
				...rest,
				lorebookId: made!.id,
				entryId: entryRemap.get(a.entryId)!,
				branchId: a.branchId != null ? (chain.lineMap.get(a.branchId) ?? null) : null,
				historyEntryId: a.historyEntryId != null ? (entryRemap.get(a.historyEntryId) ?? null) : null
			})
		}
	}
	if (input.created.lorebookId != null) {
		// A branch reading an attached lorebook carries its parent's held
		// amendments as of the fork, on the lorebook's own entries (`entryId`
		// stays); each moves onto its copied turn, and one whose turn did not
		// come across stays behind. An unanchored one comes across.
		const held = await tx
			.select()
			.from(schema.entryAmendments)
			.where(and(eq(schema.entryAmendments.lorebookId, parent.id), isNotNull(schema.entryAmendments.base)))
			.orderBy(schema.entryAmendments.id)
		for (const a of held) {
			let anchor: number | null = null
			if (a.sourceMessageId != null) {
				if (a.sourceMessageId > input.forkMessageId) continue
				const moved = input.remap.get(a.sourceMessageId)
				if (moved === undefined) continue
				anchor = moved
			}
			const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = a
			await tx.insert(schema.entryAmendments).values({
				...rest,
				lorebookId: made!.id,
				branchId: null,
				sourceMessageId: anchor
			})
		}
	}
	if (input.created.lorebookId == null)
		await copyNotesStatsAndLinks(tx, input, parent.id, made!.id, chain.lineMap, entryRemap)
	else await copyAttachedNotesLinks(tx, input, parent.id, made!.id, entryRemap)
	// Each copied entry's id by its original's: the branch's state rows name
	// the copies (`copyStateRows` — a place owner, a location ref).
	return { lorebookId: made!.id, entryRemap, lineId: chain.lineId }
}

/**
 * The links of a parent's notes beside an attached lorebook, as of the fork.
 * A link has no message column: its cut point is the message of its made-row
 * imprint (the newest standing or kept one). After the fork, or on a message
 * that did not come across, it stays behind; with no imprint it comes across.
 * An end in the notes goes through `entryRemap` (skipped if it did not come
 * across); an end in the lorebook, and any member, is kept as is. A day of the
 * notes goes through the remap, a day of the lorebook is kept. A ruleset tie's
 * copy (`rules_run_id` set) is not this path's. Each copy that had a cut point
 * is filed as made for the branch, on the copied message, so the branch's own
 * turn owns it.
 */
async function copyAttachedNotesLinks(
	tx: Db,
	input: {
		created: { id: number }
		forkMessageId: number
		remap: Map<number, number>
	},
	parentId: number,
	madeId: number,
	entryRemap: Map<number, number>
): Promise<void> {
	const r = schema.narrativeRelationships
	const I = schema.loreImprints
	const links = await tx
		.select()
		.from(r)
		.where(and(eq(r.lorebookId, parentId), isNull(r.branchId), isNull(r.rulesRunId)))
		.orderBy(r.id)
	if (!links.length) return
	const ownEntries = new Set(
		(
			await tx
				.select({ id: schema.lorebookEntries.id })
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.lorebookId, parentId))
		).map((e) => e.id)
	)
	const imprints = await tx
		.select()
		.from(I)
		.where(
			and(
				eq(I.lorebookId, parentId),
				eq(I.subjectKind, "relationship"),
				isNull(I.field),
				inArray(I.status, ["standing", "kept"]),
				inArray(I.subjectId, links.map((l) => l.id))
			)
		)
		.orderBy(I.id)
	const cutOf = new Map<number, number | null>()
	for (const i of imprints) cutOf.set(i.subjectId, i.messageId)
	const { imprintMade } = await import("$lib/server/lorebooks/imprints")
	const end = (id: number | null): number | null | undefined =>
		id == null ? null : ownEntries.has(id) ? entryRemap.get(id) : id
	for (const { id: oldId, createdAt: _c, updatedAt: _u, ...row } of links) {
		let message: number | null = null
		const cut = cutOf.get(oldId)
		if (cut != null) {
			if (cut > input.forkMessageId) continue
			const moved = input.remap.get(cut)
			if (moved === undefined) continue
			message = moved
		}
		const from = end(row.fromEntryId)
		const to = end(row.toEntryId)
		const day = end(row.historyEntryId)
		if (from === undefined || to === undefined || day === undefined) continue
		const [copy] = await tx
			.insert(r)
			.values({
				...row,
				lorebookId: madeId,
				fromEntryId: from,
				toEntryId: to,
				historyEntryId: day,
				branchId: null
			})
			.returning({ id: r.id })
		if (cutOf.has(oldId))
			await imprintMade(
				tx,
				{ sessionId: input.created.id, messageId: message, runId: null },
				{ lorebookId: madeId, subject: "relationship", subjectId: copy!.id }
			)
	}
}

/**
 * The notes' durable layer, copied into the branch's notes when the parent
 * reads them alone: stat values and configs of the notes and of their places
 * (main and the copied line chain), a member's values on the chain only (main's
 * are read by both sessions — dated in the branch by the parent's notes
 * (`loadEntryDates`) — a second row would stand for the parent too),
 * sheets of the notes and places, entry–entry links, and member–entry links
 * (the entry end through `entryRemap`, the member end kept: members are shared,
 * not copied; member–member links stay with the parent's notes). A row tied to a turn
 * after the fork, or to an entry that did not come across, stays behind. Only
 * inserts into the branch's book; the parent's notes are never written.
 */
async function copyNotesStatsAndLinks(
	tx: Db,
	input: { forkMessageId: number; remap: Map<number, number> },
	parentId: number,
	madeId: number,
	lineMap: Map<number, number>,
	entryRemap: Map<number, number>
): Promise<void> {
	const { remapEntryRefs } = await import("$lib/server/sessions/branch")
	const lineIds = [...lineMap.keys()]
	const onMainOrChain = (col: any) =>
		lineIds.length ? or(isNull(col), inArray(col, lineIds)) : isNull(col)
	const turnTie = (id: number | null): { ok: boolean; id: number | null } => {
		if (id == null) return { ok: true, id: null }
		if (id > input.forkMessageId) return { ok: false, id: null }
		const moved = input.remap.get(id)
		return moved === undefined ? { ok: false, id: null } : { ok: true, id: moved }
	}
	const line = (id: number | null) => (id == null ? null : (lineMap.get(id) ?? null))
	const members = (
		await tx
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, parentId))
	).map((r) => r.id)
	const places = [...entryRemap.keys()]

	for (const table of [schema.attributeValues, schema.attributeConfigs] as const) {
		const t = table as any
		const owners = [
			and(eq(t.ownerKind, "lorebook"), eq(t.ownerId, parentId), onMainOrChain(t.branchId)),
			places.length
				? and(eq(t.ownerKind, "location"), inArray(t.ownerId, places), onMainOrChain(t.branchId))
				: undefined,
			members.length && lineIds.length
				? and(eq(t.ownerKind, "cast_member"), inArray(t.ownerId, members), inArray(t.branchId, lineIds))
				: undefined
		].filter((x) => x !== undefined)
		const rows: any[] = await tx
			.select()
			.from(t)
			.where(and(isNull(t.sessionId), or(...owners)))
			.orderBy(t.id)
		for (const { id: _id, createdAt: _c, ...row } of rows) {
			const tie = turnTie(row.validFromMessageId)
			if (!tie.ok) continue
			if (row.historyEntryId != null && !entryRemap.has(row.historyEntryId)) continue
			const ownerId =
				row.ownerKind === "lorebook"
					? madeId
					: row.ownerKind === "location"
						? entryRemap.get(row.ownerId)
						: row.ownerId
			if (ownerId === undefined) continue
			await tx.insert(t).values({
				...row,
				ownerId,
				validFromMessageId: tie.id,
				branchId: line(row.branchId),
				historyEntryId: row.historyEntryId != null ? entryRemap.get(row.historyEntryId)! : null,
				...(table === schema.attributeValues
					? { value: remapEntryRefs(row.value, entryRemap) }
					: {})
			})
		}
	}

	// Sheets: the notes' and the places', not a member's (shared).
	const sheetOwners = [
		and(eq(schema.ownerSheets.ownerKind, "lorebook"), eq(schema.ownerSheets.ownerId, parentId)),
		places.length
			? and(
					eq(schema.ownerSheets.ownerKind, "location"),
					inArray(schema.ownerSheets.ownerId, places)
				)
			: undefined
	].filter((x) => x !== undefined)
	const sheets = await tx
		.select()
		.from(schema.ownerSheets)
		.where(and(isNull(schema.ownerSheets.sessionId), or(...sheetOwners)))
		.orderBy(schema.ownerSheets.id)
	for (const { id: _id, createdAt: _c, ...row } of sheets) {
		const ownerId = row.ownerKind === "lorebook" ? madeId : entryRemap.get(row.ownerId)
		if (ownerId === undefined) continue
		await tx.insert(schema.ownerSheets).values({ ...row, ownerId })
	}

	// Entry–entry links, and links with an entry at one end and a member at the
	// other; a link with a member at both ends stays with the parent's notes.
	const r = schema.narrativeRelationships
	const links = await tx
		.select()
		.from(r)
		.where(
			and(
				eq(r.lorebookId, parentId),
				or(
					and(
						isNotNull(r.fromEntryId),
						isNotNull(r.toEntryId),
						isNull(r.fromNodeId),
						isNull(r.toNodeId)
					),
					and(
						isNotNull(r.fromEntryId),
						isNull(r.toEntryId),
						isNull(r.fromNodeId),
						isNotNull(r.toNodeId)
					),
					and(
						isNull(r.fromEntryId),
						isNotNull(r.toEntryId),
						isNotNull(r.fromNodeId),
						isNull(r.toNodeId)
					)
				),
				onMainOrChain(r.branchId)
			)
		)
		.orderBy(r.id)
	for (const { id: _id, createdAt: _c, updatedAt: _u, ...row } of links) {
		// An entry end goes through the remap (skipped if it did not come
		// across); a member end is kept as is.
		const from = row.fromEntryId != null ? entryRemap.get(row.fromEntryId) : null
		const to = row.toEntryId != null ? entryRemap.get(row.toEntryId) : null
		if (from === undefined || to === undefined) continue
		if (row.historyEntryId != null && !entryRemap.has(row.historyEntryId)) continue
		await tx.insert(r).values({
			...row,
			lorebookId: madeId,
			fromEntryId: from,
			toEntryId: to,
			historyEntryId: row.historyEntryId != null ? entryRemap.get(row.historyEntryId)! : null,
			branchId: line(row.branchId)
		})
	}
}

/**
 * The line a branch session's parent reads its notes on, copied into the
 * branch's notes: each line of the chain, root first, with every column kept
 * but its ids (`lorebook_id` → the copy's book, `forked_from_branch_id` →
 * the copy of the line it left). Empty when the parent reads an attached book
 * or its notes' main.
 */
async function copyParentLineChain(
	tx: Db,
	input: { sessionId: number; created: { lorebookId: number | null } },
	parentBookId: number,
	madeBookId: number
): Promise<{ lineMap: Map<number, number>; lineId: number | null }> {
	const none = { lineMap: new Map<number, number>(), lineId: null }
	if (input.created.lorebookId != null) return none
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const reading = await sessionReadingOf(tx, input.sessionId)
	if (!reading?.onOwnBook || reading.branchId == null || reading.lorebookId !== parentBookId)
		return none
	const ids = reading.line.steps.flatMap((s) => (s.branchId != null ? [s.branchId] : [])).reverse()
	const rows = await tx
		.select()
		.from(schema.lorebookBranches)
		.where(inArray(schema.lorebookBranches.id, ids))
	const byId = new Map(rows.map((r) => [r.id, r]))
	const lineMap = new Map<number, number>()
	for (const id of ids) {
		const row = byId.get(id)
		if (!row) continue
		const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = row
		const [copy] = await tx
			.insert(schema.lorebookBranches)
			.values({
				...rest,
				lorebookId: madeBookId,
				forkedFromBranchId:
					row.forkedFromBranchId != null ? (lineMap.get(row.forkedFromBranchId) ?? null) : null
			})
			.returning({ id: schema.lorebookBranches.id })
		lineMap.set(id, copy!.id)
	}
	return { lineMap, lineId: lineMap.get(reading.branchId) ?? null }
}

/**
 * **Share as a lorebook** (pass 11: "Create lorebook from session becomes
 * Share as a lorebook (clears `session_id`, as today)"; R-f: it moves the
 * book from "Session notes" to the main list): the session's own book becomes
 * an ordinary lorebook — named, `session_id` and `overlay_of` cleared — and
 * the session reads it from then on. In the same transaction the session gets
 * a fresh own book overlaying the promoted one, so every session keeps owning
 * one. Owner-only; refused for a session that already reads a lorebook (its
 * own book is a diff on that book: the other Share verbs carry it).
 */
export async function shareAsLorebook(
	db: Db,
	input: { sessionId: number; userId: number; name?: string | null }
): Promise<{ lorebookId: number; name: string; ownBookId: number }> {
	const [session] = await db
		.select({
			userId: schema.sessions.userId,
			name: schema.sessions.name,
			lorebookId: schema.sessions.lorebookId,
			primaryRuleset: schema.sessions.primaryRuleset,
			rulesetVersion: schema.sessions.rulesetVersion
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, input.sessionId))
		.limit(1)
	if (!session) throw new OwnBookRefusal(SHARE_REFUSALS.missing)
	if (session.userId !== input.userId) throw new OwnBookRefusal(SHARE_REFUSALS.notOwner)
	if (session.lorebookId != null) throw new OwnBookRefusal(SHARE_REFUSALS.attached)
	const ownBook = await ownBookFor(db, input.sessionId)
	const name = input.name?.trim() || session.name?.trim() || ownBook.name
	const ownBookId = await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(${ownBook.id})`)
		await tx
			.update(schema.lorebooks)
			// The session's ruleset carries over: the book is what the
			// session is.
			.set({
				name,
				sessionId: null,
				overlayOf: null,
				// 🚧 Whose story this is (★B-3): see `surfacedBookRefusal`.
				surfacedFromSessionId: input.sessionId,
				primaryRuleset: session.primaryRuleset,
				rulesetVersion: session.rulesetVersion
			})
			.where(eq(schema.lorebooks.id, ownBook.id))
		await tx
			.update(schema.sessions)
			.set({ lorebookId: ownBook.id, lorebookBranchId: null, updatedAt: new Date() })
			.where(eq(schema.sessions.id, input.sessionId))
		const fresh = await insertOwnBook(tx as unknown as Db, {
			sessionId: input.sessionId,
			userId: session.userId,
			name: session.name,
			overlayOf: ownBook.id,
			primaryRuleset: session.primaryRuleset,
			rulesetVersion: session.rulesetVersion ?? null
		})
		return fresh.id
	})
	return { lorebookId: ownBook.id, name, ownBookId }
}

/**
 * 🚧 The read rule for a **surfaced book** (owner ★B-3, 2026-11-08): a book
 * `shareAsLorebook` made is read directly by its owner (owner 2026-11-09,
 * "Own: start on; shared: copy"), its session's branches (inserted with their
 * parent's book, never through here) and next chapters; anyone else starts on
 * a copy.
 * `null` when the book is ordinary, the start is a next chapter or the start
 * copies the book (`new-world`); otherwise the sentence to refuse with.
 */
export async function surfacedBookRefusal(
	db: Db,
	input: { lorebookId: number; creationMode: string; userId: number }
): Promise<string | null> {
	if (input.creationMode === "next-chapter" || input.creationMode === "new-world") return null
	const [book] = await db
		.select({
			surfacedFromSessionId: schema.lorebooks.surfacedFromSessionId,
			userId: schema.lorebooks.userId
		})
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, input.lorebookId))
		.limit(1)
	if (book?.userId === input.userId) return null
	return book?.surfacedFromSessionId != null ? SURFACED_BOOK_REFUSAL : null
}

/** A refusal of a notes action, as a sentence a person can read. */
export class OwnBookRefusal extends Error {}

/** The refusals "Apply to the lorebook" gives. */
export const APPLY_OVERLAY_REFUSALS = Object.freeze({
	missing: "Session not found.",
	// Wording (owner 2026-11-05, "There's always a lorebook"): the session's lorebook is its own notes here.
	noBook: "This session's lorebook is its own notes, so there is no other lorebook to apply them to.",
	notOwner: "Only the lorebook's owner can apply changes to it."
})

/**
 * One item of an overlay (§26 overlay role) as the review queue lists it.
 * Two kinds: an entry the session wrote to its own notes while it read a book
 * it could not write, and 🚧 a **change to an entry of the attached lorebook**
 * (a held amendment). Links travel with their ends (`applyOverlayItems`).
 */
interface OverlayEntryItem {
	kind: "entry"
	entryId: number
	typeId: string
	title: string
	/** The message that wrote it. */
	sourceMessageId: number | null
}

/** One field a held amendment changes, as the card says it. */
interface OverlayChange {
	/** The wire key (`name`, `content`, a declared field). */
	field: string
	/** The field's name as a person reads it. */
	label: string
	/** What the session read when it changed it. */
	before: unknown
	after: unknown
}

interface OverlayEntryChangeItem {
	kind: "entry-change"
	/** A held change's id; absent on a held history paragraph (`notesEntryId`). */
	amendmentId?: number
	/** 🚧 A held history paragraph: the own-book day that carries it (what Apply selects through `entryIds`); `amendmentId` absent. */
	notesEntryId?: number
	entryId: number
	typeId: string
	/** The entry's name as the session reads it. */
	title: string
	/** The turn's anchor message. */
	sourceMessageId: number | null
	changes: OverlayChange[]
	/** Why Apply would not take it now; null when clean. */
	conflict: string | null
}

/** 🚧 A link between the lorebook's own entries or members that the session drew: it moves to the lorebook on its own. */
interface OverlayLinkItem {
	kind: "link"
	linkId: number
	/** The entry at the link's `from` end, else its `to` end (a lore link always has an entry end). */
	entryId: number
	/** That entry's type. */
	typeId: string
	/** "‹From› ‹wording› ‹To›" — each end named as the session reads it (amended, held included); a member by its shown name. */
	title: string
	/** The made-row imprint's message (the turn that wrote it); null when none. */
	sourceMessageId: number | null
}

export type OverlayItem = OverlayEntryItem | OverlayEntryChangeItem | OverlayLinkItem

/** 🚧 Provisional copy: the owner has not seen these sentences. */
const HELD_CHANGE_CONFLICTS = Object.freeze({
	changed: (label: string) => `${label} has changed in the lorebook since this session changed it.`,
	shadowed: (label: string) =>
		`A dated change in the lorebook decides ${lowerFirst(label)} here, so this change would not show.`,
	earlier: (label: string) =>
		`An earlier change from this session to ${lowerFirst(label)} is still waiting; apply it first.`
})

/** 🚧 Provisional copy: the owner has not seen these sentences. */
const TAKE_BACK_REFUSALS = Object.freeze({
	nothing: "Nothing to take back.",
	entryGone: (entry: string) => `${entry} is no longer in the lorebook, so this can't be taken back.`,
	fieldChanged: (entry: string, label: string) =>
		`${entry}'s ${lowerFirst(label)} has changed in the lorebook since it was applied, so this can't be taken back.`,
	datedEdited: (entry: string) =>
		`The dated change to ${entry} was edited in the lorebook since it was applied, so this can't be taken back.`,
	turnGone: (entry: string) =>
		`The turn that changed ${entry} is no longer in the session, so this can't be taken back.`,
	place: (entry: string) => `${entry} is a place, and a place applied to the lorebook can't be taken back yet.`,
	linked: (entry: string) => `Something else in the lorebook now links to ${entry}, so this can't be taken back.`,
	linkedFromNotes: (entry: string) => `${entry} is linked from another session's notes, so this can't be taken back.`,
	amended: (entry: string) => `${entry} has a change of its own in the lorebook now, so this can't be taken back.`,
	named: (entry: string) => `A history day now names ${entry}, so this can't be taken back.`,
	edited: (entry: string) => `${entry} was edited in the lorebook since it was applied, so this can't be taken back.`,
	namedElsewhere: (entry: string) => `Another session's story names ${entry}, so this can't be taken back.`,
	valuesElsewhere: (entry: string) => `Another session keeps values on ${entry}, so this can't be taken back.`,
	filedUnder: (entry: string) => `An entry in the lorebook is filed under ${entry} now, so this can't be taken back.`,
	linkGone: (link: string) => `The link ${link} is no longer in the lorebook, so this can't be taken back.`,
	paragraphBuried: (day: string) =>
		`Something was written after this session's paragraph on ${day}, so this can't be taken back.`
})

/** 🚧 Provisional copy: the owner has not seen this sentence. */
const MERGE_HELD_REASONS = Object.freeze({
	twin: (day: string) =>
		`A link dated by ${day} in this session's notes would say the same thing twice on the lorebook's day, so the paragraph waits.`,
	filedUnder: (day: string) =>
		`Entries or links in this session's notes are filed under ${day}, so its paragraph waits.`
})

/**
 * Every table with a `history_entry_id` column (`db/schema.ts`): what a merged own-book day's date is
 * written on, so each is pointed at the lorebook's day before the own day goes. Only
 * `narrative_relationships` has a unique index that holds the column.
 */
const DATED_BY_HISTORY_DAY = [
	["lorebook_bindings", schema.lorebookBindings],
	["scenes", schema.scenes],
	["narrative_relationships", schema.narrativeRelationships],
	["entry_amendments", schema.entryAmendments],
	["cast_amendments", schema.castAmendments],
	["character_versions", schema.characterVersions],
	["attribute_configs", schema.attributeConfigs],
	["attribute_values", schema.attributeValues],
	["state_proposals", schema.stateProposals]
] as unknown as [string, any][]

/** A label in running text: "Name" → "name", but "HP" stays. */
function lowerFirst(label: string): string {
	return label.length > 1 && label[1] === label[1]!.toUpperCase() && label[1] !== label[1]!.toLowerCase()
		? label
		: label.charAt(0).toLowerCase() + label.slice(1)
}

type EntryRow = typeof schema.lorebookEntries.$inferSelect
type HeldRow = typeof schema.entryAmendments.$inferSelect

/** Where a wire key is stored: a column (`title`, `content`…) or `fields.<key>` — the address a change record names. */
async function storedAddressOf(typeId: string, key: string): Promise<string | null> {
	const { splitUpdate } = await import("$lib/server/utils/lorebookEntries")
	const { entryFieldAddress } = await import("$lib/server/lorebooks/imprints")
	const { columns, fields } = splitUpdate(typeId, { [key]: null })
	const column = Object.keys(columns)[0]
	if (column) return column
	return Object.keys(fields)[0] ? entryFieldAddress(key) : null
}

/** A wire key's name as a person reads it — the label a kept change record shows. */
async function labelOfKey(typeId: string, key: string): Promise<string> {
	const { fieldLabel } = await import("$lib/server/lorebooks/imprints")
	const { entryDeclaration } = await import("$lib/server/entries/declarations")
	const decl = entryDeclaration(typeId) as { fields?: Record<string, { label?: unknown }> } | undefined
	return fieldLabel((await storedAddressOf(typeId, key)) ?? key, decl)
}

/** What the conflict check says of one held change: the keys the lorebook already agrees with, and why the rest would not apply. */
interface HeldVerdict {
	/** Keys whose value in the lorebook already is what the change says: nothing to write for them. */
	agreeing: string[]
	/** Why Apply would not take the rest now; null when clean. */
	conflict: string | null
	/** Every key agrees: the change is done, and neither listed nor applied. */
	done: boolean
}

/**
 * **The conflict check** (F6), one function for the list and for Apply: the
 * lorebook's entry re-read as the LORE BOOK has it on the session's line — the
 * session's reading without its holder, at the held row's date when it has
 * one, else at the reading's moment. Per key: it **agrees** when the lorebook
 * already holds the change's value (`after`); it **conflicts** when it holds
 * neither what the session read when it wrote (`base`) nor `after`. A row whose
 * every key agrees is **done**. A conflict whose `base` is an earlier waiting
 * change's value says so (`earlier`: that session row on the same entry). So
 * is an undated change whose key a dated line amendment decides (folding it
 * into the row would be shadowed).
 */
async function heldChangeVerdict(
	t: Db,
	reading: import("$lib/server/state/reading").LineReading,
	held: HeldRow,
	stored: EntryRow,
	earlier: readonly HeldRow[] = []
): Promise<HeldVerdict> {
	const { entryOverlaysFor, entryAt, amendmentDeciding } = await import("$lib/server/state/entriesOnReading")
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	const { sameValue, unwrap } = await import("$lib/server/lorebooks/imprints")
	const { holderBookId: _holder, ...own } = reading
	const dated = held.year != null
	const lorebookReading = {
		...own,
		moment: dated
			? { year: held.year!, month: held.month ?? null, day: held.month != null ? (held.day ?? null) : null }
			: reading.moment
	}
	const overlays = await entryOverlaysFor(t, stored.lorebookId, lorebookReading, [stored.id])
	const read = entryAt(toEntryRow(stored), overlays, lorebookReading) as unknown as Record<string, unknown>
	const base = (held.base ?? {}) as Record<string, { v: unknown } | null>
	const fields = (held.fields ?? {}) as Record<string, unknown>
	const keys = Object.keys(fields)
	// The lorebook already reads this value — unless an earlier held change of this
	// session touches the key too: then this row is the session's last word on it
	// (a change back to what the lorebook holds), never one that is already done.
	const agreeing = keys.filter(
		(key) =>
			sameValue(read[key], fields[key]) &&
			!earlier.some((h) => key in ((h.fields ?? {}) as Record<string, unknown>))
	)
	const rest = keys.filter((key) => !agreeing.includes(key))
	const verdict = (conflict: string | null): HeldVerdict => ({ agreeing, conflict, done: rest.length === 0 })
	for (const key of rest)
		if (!sameValue(read[key], unwrap(base[key])))
			return verdict(
				(earlier.some((h) => key in ((h.fields ?? {}) as Record<string, unknown>) && sameValue((h.fields as Record<string, unknown>)[key], unwrap(base[key])))
					? HELD_CHANGE_CONFLICTS.earlier
					: HELD_CHANGE_CONFLICTS.changed)(await labelOfKey(stored.typeId, key))
			)
	if (!dated)
		for (const key of rest)
			if (amendmentDeciding(overlays, stored.id, key, lorebookReading))
				return verdict(HELD_CHANGE_CONFLICTS.shadowed(await labelOfKey(stored.typeId, key)))
	return verdict(null)
}

/** Held changes in anchor order: no anchor first, then the amendment's id. */
const byAnchor = (x: { sourceMessageId: number | null; id: number }, y: typeof x) =>
	(x.sourceMessageId ?? -1) - (y.sourceMessageId ?? -1) || x.id - y.id

type LinkRow = typeof schema.narrativeRelationships.$inferSelect

/** The history-day paragraph join `create-lore-entry@1` files with: after what the day holds, a blank line between; a blank side adds nothing. */
function joinParagraph(held: string, paragraph: string): string {
	if (!paragraph.trim()) return held
	return !held.trim() ? paragraph : `${held.trimEnd()}\n\n${paragraph}`
}

/** The entries and cast members the ends of some links name. */
interface LinkEndFacts {
	entries: Map<number, EntryRow>
	nodes: Map<number, { id: number; lorebookId: number; name: string }>
}

async function linkEndFactsOf(t: Db, links: readonly LinkRow[]): Promise<LinkEndFacts> {
	const num = (n: number | null): n is number => n != null
	const entryIds = [...new Set(links.flatMap((l) => [l.fromEntryId, l.toEntryId]).filter(num))]
	const nodeIds = [...new Set(links.flatMap((l) => [l.fromNodeId, l.toNodeId]).filter(num))]
	const e = schema.lorebookEntries
	const b = schema.lorebookBindings
	return {
		entries: new Map(
			(entryIds.length ? await t.select().from(e).where(inArray(e.id, entryIds)) : []).map((r) => [r.id, r])
		),
		nodes: new Map(
			(nodeIds.length
				? await t.select({ id: b.id, lorebookId: b.lorebookId, name: b.name }).from(b).where(inArray(b.id, nodeIds))
				: []
			).map((r) => [r.id, r])
		)
	}
}

/** Whether one end of a link is the lorebook's: an entry or a cast member of it. */
const endIsBooks = (facts: LinkEndFacts, bookId: number, entryId: number | null, nodeId: number | null): boolean =>
	entryId != null
		? facts.entries.get(entryId)?.lorebookId === bookId
		: nodeId != null && facts.nodes.get(nodeId)?.lorebookId === bookId

/**
 * 🚧 The notes' links that are the lorebook's alone to take: no end in the
 * notes (two lorebook entries, or a lorebook entry and a member of the
 * lorebook's cast), at least one end an entry, not a ruleset's tie row
 * (`rules_run_id`). Oldest first. Use only `t`.
 */
async function standaloneLinksOf(
	t: Db,
	ownBookId: number,
	bookId: number
): Promise<{ rows: LinkRow[]; facts: LinkEndFacts }> {
	const r = schema.narrativeRelationships
	const all = await t
		.select()
		.from(r)
		.where(and(eq(r.lorebookId, ownBookId), isNull(r.branchId), isNull(r.rulesRunId)))
		.orderBy(r.id)
	const facts = await linkEndFactsOf(t, all)
	const rows = all.filter(
		(l) =>
			(l.fromEntryId != null || l.toEntryId != null) &&
			endIsBooks(facts, bookId, l.fromEntryId, l.fromNodeId) &&
			endIsBooks(facts, bookId, l.toEntryId, l.toNodeId)
	)
	return { rows, facts }
}

/** Each link as a line a person reads: "‹From› ‹wording› ‹To›", the entries as the session reads them (held changes laid on), a member by its name. */
async function linkTitlesOf(
	db: Db,
	sessionId: number,
	links: readonly LinkRow[],
	facts: LinkEndFacts
): Promise<Map<number, string>> {
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const { entryOverlaysFor, entryAt } = await import("$lib/server/state/entriesOnReading")
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	const reading = await sessionReadingOf(db, sessionId)
	const readable = [...facts.entries.values()].filter((x) => reading && x.lorebookId === reading.lorebookId)
	const overlays =
		reading && readable.length ? await entryOverlaysFor(db, reading.lorebookId, reading, readable.map((x) => x.id)) : null
	const entryName = (id: number): string => {
		const row = facts.entries.get(id)
		if (!row) return ""
		if (!overlays || !reading || row.lorebookId !== reading.lorebookId) return row.title ?? ""
		return String(entryAt(toEntryRow(row), overlays, reading).name ?? row.title ?? "")
	}
	const end = (entryId: number | null, nodeId: number | null) =>
		entryId != null ? entryName(entryId) : (facts.nodes.get(nodeId!)?.name ?? "")
	return new Map(
		links.map((l) => [
			l.id,
			`${end(l.fromEntryId, l.fromNodeId)} ${l.relationshipType} ${end(l.toEntryId, l.toNodeId)}`
		])
	)
}

/** The turn that wrote each link: its made-row imprint's message (the oldest such record). */
async function madeLinkMessagesOf(
	t: Db,
	ownBookId: number,
	linkIds: readonly number[]
): Promise<Map<number, number | null>> {
	const out = new Map<number, number | null>()
	if (!linkIds.length) return out
	const I = schema.loreImprints
	const rows = await t
		.select({ subjectId: I.subjectId, messageId: I.messageId })
		.from(I)
		.where(
			and(
				eq(I.subjectKind, "relationship"),
				inArray(I.subjectId, [...linkIds]),
				isNull(I.field),
				eq(I.lorebookId, ownBookId),
				ne(I.origin, "apply")
			)
		)
		.orderBy(I.id)
	for (const r of rows) if (!out.has(r.subjectId)) out.set(r.subjectId, r.messageId ?? null)
	return out
}

/**
 * The overlay's items: the notes' entries, oldest first, while the session
 * reads an attached lorebook (empty when the notes are the world store) —
 * a history day of a date the lorebook holds on the session's line
 * (`lorebookDayOfDate`) is 🚧 listed as the change it is: a paragraph on the
 * lorebook's day (`notesEntryId`) — then 🚧 each link of the notes that is the
 * lorebook's alone, oldest first, then each held change to an entry of that
 * lorebook, oldest anchor first, with the conflict check's answer.
 */
export async function overlayItemsOf(db: Db, sessionId: number): Promise<OverlayItem[]> {
	const ownBook = await ownBookOf(db, sessionId)
	if (!ownBook) return []
	const [session] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (session?.lorebookId == null) return []
	const e = schema.lorebookEntries
	const items: OverlayItem[] = []
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const { entryOverlaysFor, entryAt } = await import("$lib/server/state/entriesOnReading")
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	const { unwrap } = await import("$lib/server/lorebooks/imprints")
	const reading = await sessionReadingOf(db, sessionId)
	if (ownBook.overlayOf != null) {
		const { HISTORY_TYPE_ID } = await import("$lib/shared/entries/types")
		const { historyEntryDate } = await import("$lib/server/state/reading")
		const { lorebookDayOfDate } = await import("$lib/server/scenes/historyEntryOfDate")
		const rows = await db
			.select({
				id: e.id,
				typeId: e.typeId,
				title: e.title,
				content: e.content,
				fields: e.fields,
				sourceMessageId: e.sourceMessageId
			})
			.from(e)
			.where(and(eq(e.lorebookId, ownBook.id), isNull(e.branchId)))
			.orderBy(e.id)
		// Each own day whose date the lorebook holds on the session's line: own day → the lorebook's.
		const held = new Map<number, number>()
		if (reading)
			for (const r of rows) {
				if (r.typeId !== HISTORY_TYPE_ID) continue
				const date = historyEntryDate(r.fields)
				if (!date) continue
				const found = await lorebookDayOfDate(db, {
					lorebookId: session.lorebookId,
					branchId: reading.branchId ?? null,
					date
				})
				if (found) held.set(r.id, found.historyEntryId)
			}
		const days = held.size
			? new Map(
					(
						await db
							.select()
							.from(e)
							.where(and(inArray(e.id, [...new Set(held.values())]), eq(e.lorebookId, session.lorebookId)))
					).map((d) => [d.id, d])
				)
			: new Map<number, EntryRow>()
		const dayOverlays = days.size ? await entryOverlaysFor(db, session.lorebookId, reading!, [...days.keys()]) : null
		const contentLabel = days.size ? await labelOfKey(HISTORY_TYPE_ID, "content") : ""
		for (const r of rows) {
			const day = days.get(held.get(r.id) ?? -1)
			if (!day) {
				items.push({
					kind: "entry",
					entryId: r.id,
					typeId: r.typeId,
					title: r.title ?? "",
					sourceMessageId: r.sourceMessageId ?? null
				})
				continue
			}
			const read = entryAt(toEntryRow(day), dayOverlays!, reading!) as unknown as Record<string, unknown>
			const before = typeof read.content === "string" ? read.content : (day.content ?? "")
			items.push({
				kind: "entry-change",
				notesEntryId: r.id,
				entryId: day.id,
				typeId: day.typeId,
				title: String(read.name ?? day.title ?? ""),
				sourceMessageId: r.sourceMessageId ?? null,
				changes: [
					{ field: "content", label: contentLabel, before, after: joinParagraph(before, r.content ?? "") }
				],
				conflict: null
			})
		}
		const alone = await standaloneLinksOf(db, ownBook.id, session.lorebookId)
		if (alone.rows.length) {
			const titles = await linkTitlesOf(db, sessionId, alone.rows, alone.facts)
			const made = await madeLinkMessagesOf(db, ownBook.id, alone.rows.map((l) => l.id))
			for (const l of alone.rows) {
				const entry = alone.facts.entries.get((l.fromEntryId ?? l.toEntryId)!)!
				items.push({
					kind: "link",
					linkId: l.id,
					entryId: entry.id,
					typeId: entry.typeId,
					title: titles.get(l.id) ?? "",
					sourceMessageId: made.get(l.id) ?? null
				})
			}
		}
	}
	const a = schema.entryAmendments
	const held = (
		await db
			.select({ amendment: a, entry: e })
			.from(a)
			.innerJoin(e, eq(e.id, a.entryId))
			.where(and(eq(a.lorebookId, ownBook.id), isNotNull(a.base), eq(e.lorebookId, session.lorebookId)))
	).sort((x, y) => byAnchor(x.amendment, y.amendment))
	if (!held.length) return items
	const overlays = await entryOverlaysFor(db, session.lorebookId, reading!, [
		...new Set(held.map((h) => h.entry.id))
	])
	for (const { amendment, entry } of held) {
		const fields = (amendment.fields ?? {}) as Record<string, unknown>
		const base = (amendment.base ?? {}) as Record<string, { v: unknown } | null>
		const verdict = await heldChangeVerdict(
			db,
			reading!,
			amendment,
			entry,
			held.filter((h) => h.entry.id === entry.id && byAnchor(h.amendment, amendment) < 0).map((h) => h.amendment)
		)
		// A change the lorebook already agrees with is done: not listed (a read writes nothing; Apply drops it).
		if (verdict.done) continue
		const changes: OverlayChange[] = []
		for (const key of Object.keys(fields).filter((k) => !verdict.agreeing.includes(k)))
			changes.push({
				field: key,
				label: await labelOfKey(entry.typeId, key),
				before: unwrap(base[key]),
				after: fields[key]
			})
		const read = entryAt(toEntryRow(entry), overlays, reading!)
		items.push({
			kind: "entry-change",
			amendmentId: amendment.id,
			entryId: entry.id,
			typeId: entry.typeId,
			title: String(read.name ?? entry.title ?? ""),
			sourceMessageId: amendment.sourceMessageId ?? null,
			changes,
			conflict: verdict.conflict
		})
	}
	return items
}

/** The update a wire-key change makes to an entry row, as the host's write makes it (the default vector goes stale with a name or content). Use only `t`. */
async function writeEntryKeys(t: Db, entry: { id: number; typeId: string }, data: Record<string, unknown>): Promise<void> {
	const { splitUpdate, mergeFields, DEFAULT_VECTOR_NAME } = await import("$lib/server/utils/lorebookEntries")
	const { columns, fields } = splitUpdate(entry.typeId, data)
	const set = {
		...columns,
		...(Object.keys(fields).length ? { fields: mergeFields(fields) } : {})
	}
	if (!Object.keys(set).length) return
	const e = schema.lorebookEntries
	await t
		.update(e)
		.set({ ...set, updatedAt: new Date() })
		.where(eq(e.id, entry.id))
	if ("title" in columns || "content" in columns)
		await t
			.delete(schema.lorebookEntryVectors)
			.where(
				and(
					eq(schema.lorebookEntryVectors.entryId, entry.id),
					eq(schema.lorebookEntryVectors.vectorName, DEFAULT_VECTOR_NAME)
				)
			)
}

/** Who an Apply's records name: the person who pressed, or the cause that applied them by itself (P1: the record shows why). */
type ApplyWho = { by: { userId: number } } | { automatic: AutomaticApplyCause; sceneId?: number }

/** 🚧 Why a lorebook took a session's changes without a press. */
export type AutomaticApplyCause = "scene-close" | "scene-summary" | "close-out"

/** What `applyOverlayItems` did. */
export interface ApplyOverlayResult {
	lorebookId: number
	/** New entries moved into the lorebook. */
	applied: number[]
	/** Held changes folded in. */
	appliedChanges: number[]
	stillHeld: { amendmentId: number; reason: string }[]
	/** One id for everything this call applied (what take-back names); null when nothing was applied. */
	batch: string | null
	/** Held changes the lorebook already agreed with: deleted, not applied. */
	dropped: number[]
	/** 🚧 Links of the notes that were the lorebook's alone, moved (links that rode with entries are not here). */
	appliedLinks: number[]
	/** 🚧 Own-book history days merged into the lorebook's day of the same date (the own day's id). */
	mergedDays: number[]
	/** 🚧 Own-book links the lorebook already said, deleted instead of moved. */
	droppedLinks: number[]
	/** 🚧 Own-book days left in the notes because merging them would make a link say the same thing twice. */
	heldDays: { notesEntryId: number; reason: string }[]
	/** Where the settle line stands after it (`settleThrough`); null when nothing was applied or no applied item had an anchor. */
	settled: { moved: boolean; settledMessageId: number | null; previousSettledMessageId: number | null } | null
}

/**
 * **Apply to the lorebook** (§15, §26): overlay items move into the attached
 * book — the same rows, so every link and stat that names them keeps its
 * id — on the session's line, at a free position, with provenance kept
 * (`source_message_id` stays; `extra_json.appliedFrom` names the session and
 * the ruleset version), and leave the overlay. A link of the notes moves
 * with its ends once every end it has is in the book.
 *
 * 🚧 A held change to an entry of the book is **folded** into it: undated, into
 * the entry's row; dated, the held row moves to the book's line as an ordinary
 * dated amendment (the base row is never written). Each change is re-checked
 * after the folds before it (`heldChangeVerdict`); a conflict stays held and
 * is returned with its reason. A held change the lorebook already agrees with
 * is done: it is deleted (`dropped`), whatever was selected, and a partly
 * agreeing one applies only its other keys.
 *
 * Every applied item files a `lore_imprints` record (`origin: 'apply'`, one
 * `batch` per call): a new entry and each link that moved with it a record of
 * where it was (`field` null, `cause.moved`), a changed field its before and
 * after, each with the session, the message and who — `by` for a press,
 * `automatic` (and `sceneId`) for `applyHeldAutomatically` — what
 * `takeBackApply` reads.
 *
 * **Apply settles** ("Only Apply settles"): inside the transaction the settle
 * line moves through the newest applied anchor, never past the message before
 * the oldest item still held. It never emits; the caller announces
 * (`announceHistorySettled`) after the commit.
 *
 * 🚧 An Apply forks the session's line: a branch session still riding its
 * parent's line (`line_on_first_write`) forks its own inside the transaction,
 * once something is chosen to apply (`ensureSessionLine`), and every write and
 * check below lands on that line. An Apply with nothing to apply forks nothing.
 *
 * Selection: `entryIds` and `amendmentIds` both absent applies every item;
 * `entryIds` only, those new entries only; `amendmentIds` only, those held
 * changes only; both, both. The attached book's owner only: applying is a write.
 */
export async function applyOverlayItems(
	db: Db,
	input: {
		sessionId: number
		userId: number
		entryIds?: readonly number[] | null
		amendmentIds?: readonly number[] | null
		/** 🚧 Standalone links to move (`OverlayLinkItem.linkId`). With `entryIds` (new entries and held paragraphs, by the own day's id) and `amendmentIds`: any given selects only those. */
		linkIds?: readonly number[] | null
		/** Set by `applyHeldAutomatically` only: the records name this cause instead of the person. */
		automatic?: { automatic: AutomaticApplyCause; sceneId?: number }
	}
): Promise<ApplyOverlayResult> {
	const [session] = await db
		.select({
			lorebookId: schema.sessions.lorebookId,
			primaryRuleset: schema.sessions.primaryRuleset,
			rulesetVersion: schema.sessions.rulesetVersion
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, input.sessionId))
		.limit(1)
	if (!session) throw new OwnBookRefusal(APPLY_OVERLAY_REFUSALS.missing)
	const bookId = session.lorebookId
	if (bookId == null) throw new OwnBookRefusal(APPLY_OVERLAY_REFUSALS.noBook)
	const [book] = await db
		.select({ userId: schema.lorebooks.userId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, bookId))
		.limit(1)
	if (!book || book.userId !== input.userId)
		throw new OwnBookRefusal(APPLY_OVERLAY_REFUSALS.notOwner)
	const who: ApplyWho = input.automatic
		? {
				automatic: input.automatic.automatic,
				...(input.automatic.sceneId != null ? { sceneId: input.automatic.sceneId } : {})
			}
		: { by: { userId: input.userId } }
	const items = await overlayItemsOf(db, input.sessionId)
	const everything = !input.entryIds && !input.amendmentIds && !input.linkIds
	const wantedEntries = input.entryIds ? new Set(input.entryIds) : null
	const wantedChanges = input.amendmentIds ? new Set(input.amendmentIds) : null
	const wantedLinks = input.linkIds ? new Set(input.linkIds) : null
	const chosen = items.filter(
		(i): i is OverlayEntryItem => i.kind === "entry" && (everything || !!wantedEntries?.has(i.entryId))
	)
	// 🚧 A held paragraph is selected by the own-book day's id, as a new entry is.
	const chosenParagraphs = items.filter(
		(i): i is OverlayEntryChangeItem & { notesEntryId: number } =>
			i.kind === "entry-change" && i.notesEntryId != null && (everything || !!wantedEntries?.has(i.notesEntryId))
	)
	const chosenChanges = items.filter(
		(i): i is OverlayEntryChangeItem & { amendmentId: number } =>
			i.kind === "entry-change" &&
			i.amendmentId != null &&
			(everything || !!wantedChanges?.has(i.amendmentId))
	)
	const chosenLinkIds = new Set(
		items.filter((i): i is OverlayLinkItem => i.kind === "link" && (everything || !!wantedLinks?.has(i.linkId))).map((i) => i.linkId)
	)
	const ownBook = (await ownBookOf(db, input.sessionId)) ?? (await ownBookFor(db, input.sessionId))
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	let reading = (await sessionReadingOf(db, input.sessionId))!
	let branchId = reading.branchId ?? null
	const { nextPosition } = await import("$lib/server/utils/lorebookEntries")
	const ruleset = session.rulesetVersion
		? `${session.primaryRuleset}#${session.rulesetVersion}`
		: session.primaryRuleset
	const applied: number[] = []
	const appliedChanges: number[] = []
	const stillHeld: { amendmentId: number; reason: string }[] = []
	const dropped: number[] = []
	const appliedLinks: number[] = []
	const mergedDays: number[] = []
	const droppedLinks: number[] = []
	const heldDays: ApplyOverlayResult["heldDays"] = []
	let settled: ApplyOverlayResult["settled"] = null
	const batch = randomUUID()
	await db.transaction(async (tx) => {
		const t = tx as unknown as Db
		await tx.execute(sql`select pg_advisory_xact_lock(${bookId})`)
		// The reading is taken on the transaction handle, under the book's lock.
		reading = (await sessionReadingOf(t, input.sessionId))!
		branchId = reading.branchId ?? null
		const e = schema.lorebookEntries
		const a = schema.entryAmendments
		const { imprintField, unwrap, wrap } = await import("$lib/server/lorebooks/imprints")
		// A held change the lorebook already agrees with is done: deleted, selected or not.
		const heldNow = async () =>
			(
				await tx
					.select({ amendment: a, entry: e })
					.from(a)
					.innerJoin(e, eq(e.id, a.entryId))
					.where(and(eq(a.lorebookId, ownBook.id), isNotNull(a.base), eq(e.lorebookId, bookId)))
			).sort((x, y) => byAnchor(x.amendment, y.amendment))
		const sessionHeld = await heldNow()
		for (const { amendment, entry } of sessionHeld) {
			const earlier = sessionHeld
				.filter((h) => h.entry.id === entry.id && byAnchor(h.amendment, amendment) < 0)
				.map((h) => h.amendment)
			if (!(await heldChangeVerdict(t, reading, amendment, entry, earlier)).done) continue
			await tx.delete(a).where(eq(a.id, amendment.id))
			dropped.push(amendment.id)
		}
		if (!chosen.length && !chosenParagraphs.length && !chosenChanges.length && !chosenLinkIds.size) return
		// 🚧 Something is applied, so a session still riding its parent's line forks its own now, and
		// everything below is written and judged on it, never on the parent's.
		await ensureSessionLine(t, input.sessionId)
		reading = (await sessionReadingOf(t, input.sessionId))!
		branchId = reading.branchId ?? null
		// ★pl4-1 (lead, interim until S4 replaces Apply/Clone with merge-in-place): applying ends the
		// session's Forward, as a new message does — a Back-stashed row must never come back tied into a real book.
		await (await import("$lib/server/messages/store")).discardForwardStack(t, input.sessionId)
		/** The anchors of what was applied: the settle line moves through the newest. */
		const appliedAnchors: number[] = []
		const fileImprint = (row: {
			messageId: number | null
			subjectKind: "entry" | "relationship"
			subjectId: number
			cause: Record<string, unknown>
		}) =>
			tx.insert(schema.loreImprints).values({
				sessionId: input.sessionId,
				messageId: row.messageId,
				runId: null,
				lorebookId: bookId,
				subjectKind: row.subjectKind,
				subjectId: row.subjectId,
				field: null,
				before: null,
				after: null,
				origin: "apply",
				batch,
				cause: row.cause
			})
		const { HISTORY_TYPE_ID } = await import("$lib/shared/entries/types")
		const { historyEntryDate } = await import("$lib/server/state/reading")
		const { lorebookDayOfDate, historyDayOwnerRefusal } = await import("$lib/server/scenes/historyEntryOfDate")
		// 🚧 Each selected own-book entry, asked again here: a history day whose date the lorebook holds on
		// the session's line now is merged into that day, whatever the list said; every other one moves.
		const merges: { own: EntryRow; loreDayId: number }[] = []
		const moves: OverlayEntryItem[] = []
		for (const entryId of [...new Set([...chosen.map((c) => c.entryId), ...chosenParagraphs.map((c) => c.notesEntryId)])].sort(
			(x, y) => x - y
		)) {
			const [own] = await tx
				.select()
				.from(e)
				.where(and(eq(e.id, entryId), eq(e.lorebookId, ownBook.id)))
				.limit(1)
			if (!own) continue
			const date = own.typeId === HISTORY_TYPE_ID ? historyEntryDate(own.fields) : null
			const found = date ? await lorebookDayOfDate(t, { lorebookId: bookId, branchId, date }) : null
			if (found) merges.push({ own, loreDayId: found.historyEntryId })
			else
				moves.push({
					kind: "entry",
					entryId,
					typeId: own.typeId,
					title: own.title ?? "",
					sourceMessageId: own.sourceMessageId ?? null
				})
		}
		// 🚧 A merged day: its paragraph goes after what the lorebook's day holds, everything dated by the
		// own day is pointed at the lorebook's day, the own day goes. Never a second entry for a date.
		const rel = schema.narrativeRelationships
		for (const { own, loreDayId } of merges) {
			const [lore] = await tx
				.select()
				.from(e)
				.where(and(eq(e.id, loreDayId), eq(e.lorebookId, bookId)))
				.limit(1)
			if (!lore) continue
			// The day another line owns is not this session's to write (the rule the direct write keeps).
			const ownedElsewhere = await historyDayOwnerRefusal(t, {
				lorebookId: bookId,
				branchId,
				date: historyEntryDate(own.fields)!
			})
			if (ownedElsewhere) {
				heldDays.push({ notesEntryId: own.id, reason: ownedElsewhere })
				continue
			}
			// Deleting the own day would take with it every entry filed under it and every link that
			// ends at it (both cascade). Those stay the notes': the day waits.
			const [child] = await tx.select({ id: e.id }).from(e).where(eq(e.anchorEntryId, own.id)).limit(1)
			const [endsHere] = await tx
				.select({ id: rel.id })
				.from(rel)
				.where(or(eq(rel.fromEntryId, own.id), eq(rel.toEntryId, own.id)))
				.limit(1)
			if (child || endsHere) {
				heldDays.push({ notesEntryId: own.id, reason: MERGE_HELD_REASONS.filedUnder(own.title ?? "that day") })
				continue
			}
			// The unique index of links (`narrative_relationships_entry_pair_uq`) holds the date: when the
			// repoint would make a link a twin of another, the day stays held.
			let twin = false
			for (const l of await tx.select().from(rel).where(eq(rel.historyEntryId, own.id)))
				if (l.fromEntryId != null && l.toEntryId != null) {
					const [other] = await tx
						.select({ id: rel.id })
						.from(rel)
						.where(
							and(
								eq(rel.lorebookId, l.lorebookId),
								eq(rel.fromEntryId, l.fromEntryId),
								eq(rel.toEntryId, l.toEntryId),
								sql`lower(${rel.relationshipType}) = lower(${l.relationshipType})`,
								sql`lower(${rel.title}) = lower(${l.title})`,
								sql`coalesce(${rel.branchId}, 0) = ${l.branchId ?? 0}`,
								eq(rel.historyEntryId, lore.id),
								ne(rel.id, l.id)
							)
						)
						.limit(1)
					if (other) twin = true
				}
			if (twin) {
				heldDays.push({ notesEntryId: own.id, reason: MERGE_HELD_REASONS.twin(lore.title ?? "the lorebook's day") })
				continue
			}
			const repointed: Record<string, number[]> = {}
			for (const [name, table] of DATED_BY_HISTORY_DAY) {
				const ids = (await tx.select({ id: table.id }).from(table).where(eq(table.historyEntryId, own.id))).map(
					(x: { id: number }) => x.id
				)
				if (!ids.length) continue
				await tx.update(table).set({ historyEntryId: lore.id }).where(inArray(table.id, ids))
				repointed[name] = ids
			}
			const before = lore.content ?? ""
			const after = joinParagraph(before, own.content ?? "")
			if (after !== before) await writeEntryKeys(t, lore, { content: after })
			await tx.insert(schema.loreImprints).values({
				sessionId: input.sessionId,
				messageId: own.sourceMessageId ?? null,
				runId: null,
				lorebookId: bookId,
				subjectKind: "entry",
				subjectId: lore.id,
				field: (await storedAddressOf(HISTORY_TYPE_ID, "content")) ?? "content",
				before: wrap(before),
				after: wrap(after),
				origin: "apply",
				batch,
				cause: {
					...who,
					sessionId: input.sessionId,
					messageId: own.sourceMessageId ?? null,
					merged: { notesEntry: JSON.parse(JSON.stringify(own)), repointed }
				}
			})
			await tx.delete(e).where(eq(e.id, own.id))
			if (own.sourceMessageId != null) appliedAnchors.push(own.sourceMessageId)
			mergedDays.push(own.id)
		}
		for (const item of moves) {
			const [row] = await tx
				.select({
					extraJson: e.extraJson,
					lorebookId: e.lorebookId,
					branchId: e.branchId,
					position: e.position,
					anchorBindingId: e.anchorBindingId,
					anchorEntryId: e.anchorEntryId
				})
				.from(e)
				.where(and(eq(e.id, item.entryId), eq(e.lorebookId, ownBook.id)))
				.limit(1)
			if (!row) continue
			// A parent left behind in the notes is no parent in the book; a
			// parent already IN the book stays one (pr-6 B review: an entry the
			// session filed under a book entry lost its parent on Share).
			// 🚧 The notes' cast is not the book's, but a member of the lorebook it is filed under is.
			const keepsBinding =
				row.anchorBindingId != null &&
				(
					await tx
						.select({ id: schema.lorebookBindings.id })
						.from(schema.lorebookBindings)
						.where(and(eq(schema.lorebookBindings.id, row.anchorBindingId), eq(schema.lorebookBindings.lorebookId, bookId)))
						.limit(1)
				).length > 0
			const parentInBook =
				row.anchorEntryId != null &&
				(
					await tx
						.select({ id: e.id })
						.from(e)
						.where(and(eq(e.id, row.anchorEntryId), eq(e.lorebookId, bookId)))
						.limit(1)
				).length > 0
			const parentMoves =
				row.anchorEntryId == null ||
				parentInBook ||
				applied.includes(row.anchorEntryId) ||
				moves.some((c) => c.entryId === row.anchorEntryId)
			await tx
				.update(e)
				.set({
					lorebookId: bookId,
					branchId,
					position: await nextPosition(t, bookId, item.typeId),
					anchorBindingId: keepsBinding ? row.anchorBindingId : null,
					...(parentMoves ? {} : { anchorEntryId: null }),
					extraJson: {
						...((row.extraJson ?? {}) as Record<string, unknown>),
						appliedFrom: {
							sessionId: input.sessionId,
							messageId: item.sourceMessageId,
							ruleset
						}
					}
				})
				.where(eq(e.id, item.entryId))
			// The move bumps `updated_at` (the column's `$onUpdate`); the owner's later edit is judged against this.
			const [after] = await tx.select({ updatedAt: e.updatedAt }).from(e).where(eq(e.id, item.entryId)).limit(1)
			await fileImprint({
				messageId: item.sourceMessageId,
				subjectKind: "entry",
				subjectId: item.entryId,
				cause: {
					...who,
					sessionId: input.sessionId,
					messageId: item.sourceMessageId,
					moved: {
						lorebookId: row.lorebookId,
						branchId: row.branchId,
						position: row.position,
						anchorBindingId: row.anchorBindingId,
						anchorEntryId: row.anchorEntryId,
						updatedAt: after!.updatedAt.toISOString()
					}
				}
			})
			if (item.sourceMessageId != null) appliedAnchors.push(item.sourceMessageId)
			applied.push(item.entryId)
		}
		// The links whose every end is now outside the notes come along: an entry end that moved, the other end
		// an entry out of the notes or a member of the lorebook's cast. 🚧 A selected standalone link (no end in
		// the notes) moves by itself. A ruleset's tie row never moves.
		const r = schema.narrativeRelationships
		const noteLinks = await tx
			.select()
			.from(r)
			.where(and(eq(r.lorebookId, ownBook.id), isNull(r.rulesRunId)))
			.orderBy(r.id)
		const facts = await linkEndFactsOf(t, noteLinks)
		const stillNotes = new Set(
			(
				await tx
					.select({ id: e.id })
					.from(e)
					.where(eq(e.lorebookId, ownBook.id))
			).map((x) => x.id)
		)
		const outsideNotes = (entryId: number | null, nodeId: number | null) =>
			entryId != null ? !stillNotes.has(entryId) : nodeId != null && facts.nodes.get(nodeId)?.lorebookId === bookId
		const riding = noteLinks.filter(
			(l) =>
				[l.fromEntryId, l.toEntryId].some((id) => id != null && applied.includes(id)) &&
				outsideNotes(l.fromEntryId, l.fromNodeId) &&
				outsideNotes(l.toEntryId, l.toNodeId)
		)
		const alone = noteLinks.filter(
			(l) =>
				chosenLinkIds.has(l.id) &&
				l.branchId == null &&
				!riding.includes(l) &&
				(l.fromEntryId != null || l.toEntryId != null) &&
				endIsBooks(facts, bookId, l.fromEntryId, l.fromNodeId) &&
				endIsBooks(facts, bookId, l.toEntryId, l.toNodeId)
		)
		const moving = [...riding.map((l) => ({ l, standalone: false })), ...alone.map((l) => ({ l, standalone: true }))].sort(
			(x, y) => x.l.id - y.l.id
		)
		if (moving.length) {
			const { findLinkedThatWay } = await import("$lib/server/utils/relationshipGuards")
			const titles = await linkTitlesOf(t, input.sessionId, alone, facts)
			const made = await madeLinkMessagesOf(t, ownBook.id, alone.map((l) => l.id))
			for (const { l, standalone } of moving) {
				// 🚧 A link dated by a day that stays in the notes is dated by the lorebook's day of that date, or by none.
				let day = l.historyEntryId
				if (day != null) {
					const [named] = await tx
						.select({ lorebookId: e.lorebookId, fields: e.fields })
						.from(e)
						.where(eq(e.id, day))
						.limit(1)
					if (named?.lorebookId === ownBook.id) {
						const date = historyEntryDate(named.fields)
						day = date ? ((await lorebookDayOfDate(t, { lorebookId: bookId, branchId, date }))?.historyEntryId ?? null) : null
					}
				}
				// 🚧 What the lorebook already says is not said twice: the notes' copy goes.
				const twin = await findLinkedThatWay(
					t,
					{ fromNodeId: l.fromNodeId, fromEntryId: l.fromEntryId, toNodeId: l.toNodeId, toEntryId: l.toEntryId },
					{
						lorebookId: bookId,
						branchId,
						historyEntryId: day,
						title: l.title,
						relationshipType: l.relationshipType,
						reverseRelationshipType: l.reverseRelationshipType
					},
					l.id
				)
				if (twin != null) {
					await tx.delete(r).where(eq(r.id, l.id))
					droppedLinks.push(l.id)
					continue
				}
				await tx.update(r).set({ lorebookId: bookId, branchId, historyEntryId: day }).where(eq(r.id, l.id))
				const messageId = standalone ? (made.get(l.id) ?? null) : null
				await fileImprint({
					messageId,
					subjectKind: "relationship",
					subjectId: l.id,
					cause: {
						...who,
						sessionId: input.sessionId,
						...(standalone ? { standalone: true, title: titles.get(l.id) ?? "", messageId } : {}),
						moved: { lorebookId: ownBook.id, branchId: l.branchId, historyEntryId: l.historyEntryId }
					}
				})
				if (standalone) {
					appliedLinks.push(l.id)
					if (messageId != null) appliedAnchors.push(messageId)
				}
			}
		}
		await dropTurnTiesOfPlaces(t, applied)

		// 🚧 The held changes, in anchor order, each re-checked after the folds before it.
		for (const item of chosenChanges) {
			const [held] = await tx
				.select()
				.from(a)
				.where(and(eq(a.id, item.amendmentId), eq(a.lorebookId, ownBook.id), isNotNull(a.base)))
				.limit(1)
			if (!held) continue
			const [stored] = await tx
				.select()
				.from(e)
				.where(and(eq(e.id, held.entryId), eq(e.lorebookId, bookId)))
				.limit(1)
			if (!stored) continue
			const earlier = (
				await tx
					.select()
					.from(a)
					.where(
						and(
							eq(a.lorebookId, ownBook.id),
							isNotNull(a.base),
							eq(a.entryId, held.entryId),
							sql`${a.id} <> ${held.id}`
						)
					)
			).filter((h) => byAnchor(h, held) < 0)
			const verdict = await heldChangeVerdict(t, reading, held, stored, earlier)
			if (verdict.conflict) {
				stillHeld.push({ amendmentId: held.id, reason: verdict.conflict })
				continue
			}
			if (verdict.done) {
				// An earlier fold in this call made it agree.
				await tx.delete(a).where(eq(a.id, held.id))
				dropped.push(held.id)
				continue
			}
			const allFields = (held.fields ?? {}) as Record<string, unknown>
			const keys = Object.keys(allFields).filter((k) => !verdict.agreeing.includes(k))
			const fields = Object.fromEntries(keys.map((k) => [k, allFields[k]]))
			const base = (held.base ?? {}) as Record<string, { v: unknown } | null>
			const dated = held.year != null
			if (!dated) await writeEntryKeys(t, stored, fields)
			else
				await tx
					.update(a)
					.set({ lorebookId: bookId, branchId, base: null, sourceMessageId: null, fields })
					.where(eq(a.id, held.id))
			for (const key of keys) {
				const field = await storedAddressOf(stored.typeId, key)
				if (!field) continue
				await imprintField(
					t,
					{ sessionId: input.sessionId, messageId: held.sourceMessageId ?? null, runId: null },
					{ lorebookId: bookId, subject: "entry", subjectId: stored.id, field },
					unwrap(base[key]),
					fields[key],
					{
						origin: "apply",
						batch,
						cause: {
							...who,
							sessionId: input.sessionId,
							messageId: held.sourceMessageId ?? null,
							amendmentId: held.id,
							key,
							// A dated change moved rather than folded; take-back must tell the two apart.
							...(dated ? { dated: true } : {})
						}
					}
				)
			}
			if (!dated) await tx.delete(a).where(eq(a.id, held.id))
			if (held.sourceMessageId != null) appliedAnchors.push(held.sourceMessageId)
			appliedChanges.push(held.id)
		}

		// Apply settles: through the newest applied anchor, never past the message before the oldest item still held.
		if (!appliedAnchors.length) return
		const newest = Math.max(...appliedAnchors)
		const stillHeldAnchors: number[] = []
		if (ownBook.overlayOf != null)
			for (const row of await tx
				.select({ at: e.sourceMessageId })
				.from(e)
				.where(and(eq(e.lorebookId, ownBook.id), isNull(e.branchId))))
				if (row.at != null) stillHeldAnchors.push(row.at)
		if (ownBook.overlayOf != null) {
			const left = await standaloneLinksOf(t, ownBook.id, bookId)
			for (const m of (await madeLinkMessagesOf(t, ownBook.id, left.rows.map((l) => l.id))).values())
				if (m != null) stillHeldAnchors.push(m)
		}
		for (const { amendment } of await heldNow()) if (amendment.sourceMessageId != null) stillHeldAnchors.push(amendment.sourceMessageId)
		const through = stillHeldAnchors.length ? Math.min(newest, Math.min(...stillHeldAnchors) - 1) : newest
		const { settleThrough } = await import("$lib/server/sessions/settle")
		settled = await settleThrough(t, input.sessionId, through, { userId: input.userId })
	})
	return {
		lorebookId: bookId,
		applied,
		appliedChanges,
		stillHeld,
		batch: applied.length || appliedChanges.length || appliedLinks.length || mergedDays.length ? batch : null,
		dropped,
		appliedLinks,
		mergedDays,
		droppedLinks,
		heldDays,
		settled
	}
}

/**
 * 🚧 **Take back an Apply**: the one server function that undoes an Apply
 * (a press or an automatic one). The attached lorebook's owner only; with
 * `sessionId`, only that session's batch. Reads the batch's `apply` records,
 * **all or nothing**: it checks everything first, writes nothing until every
 * check passed, and refuses, in a sentence, when something stands on any of
 * them — a moved entry that is a place, that something else now links to,
 * amends, names (a history day, another session's story), keeps values on or
 * is filed under, that the owner edited since, or is gone; a folded field no
 * longer holding what was applied; the moved dated amendment edited or
 * removed; the turn gone. Then each entry and link goes back to where it was
 * (`cause.moved`), each undated change back — the field to its `before`, the
 * held row re-inserted with its original id in the session's own book — and
 * each dated amendment moves back as held; the batch's records are deleted.
 * It never moves the settle line (compaction is one-way).
 */
export async function takeBackApply(
	db: Db,
	input: { batch: string; userId: number; sessionId?: number }
): Promise<void> {
	const I = schema.loreImprints
	const records = (await db
		.select()
		.from(I)
		.where(and(eq(I.batch, input.batch), eq(I.origin, "apply")))
		.orderBy(I.id)) as import("$lib/server/lorebooks/imprints").LoreImprintRow[]
	if (!records.length) throw new OwnBookRefusal(TAKE_BACK_REFUSALS.nothing)
	if (input.sessionId != null && records.some((r) => r.sessionId !== input.sessionId))
		throw new OwnBookRefusal(TAKE_BACK_REFUSALS.nothing)
	const bookId = records[0]!.lorebookId
	const sessionId = records[0]!.sessionId
	const [book] = await db
		.select({ userId: schema.lorebooks.userId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, bookId))
		.limit(1)
	if (!book || book.userId !== input.userId) throw new OwnBookRefusal(APPLY_OVERLAY_REFUSALS.notOwner)
	const ownBook = await ownBookFor(db, sessionId)
	const { sameValue, unwrap } = await import("$lib/server/lorebooks/imprints")
	const { toEntryRow } = await import("$lib/server/utils/lorebookEntries")
	const { HISTORY_TYPE_ID, LOCATION_TYPE_ID } = await import("$lib/shared/entries/types")
	type Moved = {
		lorebookId: number
		branchId: number | null
		position: number
		anchorBindingId: number | null
		anchorEntryId: number | null
		updatedAt?: string
		/** 🚧 A moved link's dating when it moved; absent on a record from before links were re-dated. */
		historyEntryId?: number | null
	}
	type Merged = { notesEntry: Record<string, unknown>; repointed: Record<string, number[]> }
	const causeOf = (r: (typeof records)[number]) =>
		(r.cause ?? {}) as {
			amendmentId: number
			key: string
			dated?: boolean
			moved?: Moved
			standalone?: true
			title?: string
			merged?: Merged
		}
	const entryMoves = records.filter((r) => r.subjectKind === "entry" && r.field == null)
	const linkMoves = records.filter((r) => r.subjectKind === "relationship" && r.field == null)
	const mergeRecords = records.filter((r) => r.field != null && causeOf(r).merged != null)
	const changeRecords = records.filter((r) => r.field != null && causeOf(r).merged == null)
	// One group per held change: its records, in the order they were filed.
	const groups = new Map<number, typeof records>()
	for (const r of changeRecords) groups.set(causeOf(r).amendmentId, [...(groups.get(causeOf(r).amendmentId) ?? []), r])
	await db.transaction(async (tx) => {
		const t = tx as unknown as Db
		await tx.execute(sql`select pg_advisory_xact_lock(${bookId})`)
		await tx.execute(sql`select pg_advisory_xact_lock(${ownBook.id})`)
		const e = schema.lorebookEntries
		const a = schema.entryAmendments
		const r = schema.narrativeRelationships
		const movedEntryIds = entryMoves.map((m) => m.subjectId)
		const movedLinkIds = linkMoves.map((m) => m.subjectId)
		// Checked first, all of it, before anything is written.
		const entryPlan: { record: (typeof records)[number]; moved: Moved; extraJson: Record<string, unknown> }[] = []
		for (const record of entryMoves) {
			const moved = causeOf(record).moved
			if (!moved) throw new OwnBookRefusal(TAKE_BACK_REFUSALS.nothing)
			const [entry] = await tx
				.select()
				.from(e)
				.where(and(eq(e.id, record.subjectId), eq(e.lorebookId, bookId)))
				.limit(1)
			if (!entry) throw new OwnBookRefusal(TAKE_BACK_REFUSALS.entryGone("The entry"))
			const name = entry.title ?? `Entry ${entry.id}`
			if (entry.typeId === LOCATION_TYPE_ID) throw new OwnBookRefusal(TAKE_BACK_REFUSALS.place(name))
			// Another link to it: one that is not this batch's own.
			const linked = (
				await tx
					.select({ id: r.id, notesOf: schema.lorebooks.sessionId })
					.from(r)
					.innerJoin(schema.lorebooks, eq(schema.lorebooks.id, r.lorebookId))
					.where(
						and(
							or(eq(r.fromEntryId, entry.id), eq(r.toEntryId, entry.id)),
							sql`${r.lorebookId} <> ${ownBook.id}`
						)
					)
			).filter((l) => !movedLinkIds.includes(l.id))
			// A link in the lorebook keeps today's sentence; one only in another session's notes has its own.
			if (linked.some((l) => l.notesOf == null))
				throw new OwnBookRefusal(TAKE_BACK_REFUSALS.linked(name))
			if (linked.length) throw new OwnBookRefusal(TAKE_BACK_REFUSALS.linkedFromNotes(name))
			// An amendment on it: any in another book, any session's held change.
			const [amended] = await tx
				.select({ id: a.id })
				.from(a)
				.where(and(eq(a.entryId, entry.id), or(sql`${a.lorebookId} <> ${ownBook.id}`, isNotNull(a.base))))
				.limit(1)
			if (amended) throw new OwnBookRefusal(TAKE_BACK_REFUSALS.amended(name))
			// A history day naming it: an annotation on a history entry, or a history entry written since whose content has its title as a word.
			const [dayAnnotation] = await tx
				.select({ entryId: schema.entryAnnotations.entryId })
				.from(schema.entryAnnotations)
				.innerJoin(e, eq(e.id, schema.entryAnnotations.entryId))
				.where(and(eq(schema.entryAnnotations.refEntryId, entry.id), eq(e.typeId, HISTORY_TYPE_ID)))
				.limit(1)
			if (dayAnnotation) throw new OwnBookRefusal(TAKE_BACK_REFUSALS.named(name))
			const title = entry.title?.trim()
			if (title) {
				const asWord = new RegExp(
					`(?<![\\p{L}\\p{N}_])${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_])`,
					"iu"
				)
				const days = await tx
					.select({ content: e.content })
					.from(e)
					.where(
						and(
							eq(e.lorebookId, bookId),
							eq(e.typeId, HISTORY_TYPE_ID),
							or(gt(e.createdAt, record.createdAt), gt(e.updatedAt, record.createdAt))
						)
					)
				if (days.some((d) => asWord.test(d.content ?? "")))
					throw new OwnBookRefusal(TAKE_BACK_REFUSALS.named(name))
			}
			// The lorebook owner's edit since the Apply (the move's own `updated_at` is stored in the record).
			const movedAt = moved.updatedAt ? new Date(moved.updatedAt) : record.createdAt
			if (entry.updatedAt.getTime() > movedAt.getTime())
				throw new OwnBookRefusal(TAKE_BACK_REFUSALS.edited(name))
			// Another session's story naming it.
			const [namedByMessage] = await tx
				.select({ messageId: schema.messageAnnotations.messageId })
				.from(schema.messageAnnotations)
				.innerJoin(schema.messages, eq(schema.messages.id, schema.messageAnnotations.messageId))
				.where(
					and(
						eq(schema.messageAnnotations.refEntryId, entry.id),
						sql`${schema.messages.sessionId} <> ${sessionId}`
					)
				)
				.limit(1)
			const [namedByNote] = await tx
				.select({ entryId: schema.entryAnnotations.entryId })
				.from(schema.entryAnnotations)
				.innerJoin(e, eq(e.id, schema.entryAnnotations.entryId))
				.innerJoin(schema.lorebooks, eq(schema.lorebooks.id, e.lorebookId))
				.where(
					and(
						eq(schema.entryAnnotations.refEntryId, entry.id),
						isNotNull(schema.lorebooks.sessionId),
						sql`${schema.lorebooks.sessionId} <> ${sessionId}`
					)
				)
				.limit(1)
			if (namedByMessage || namedByNote) throw new OwnBookRefusal(TAKE_BACK_REFUSALS.namedElsewhere(name))
			// Another session's stat rows on it (`location` and `session_location` owners are entry ids).
			for (const table of [schema.attributeValues, schema.attributeConfigs]) {
				const [theirs] = await tx
					.select({ id: table.id })
					.from(table)
					.where(
						and(
							inArray(table.ownerKind, ["location", "session_location"]),
							eq(table.ownerId, entry.id),
							or(
								and(isNotNull(table.sessionId), sql`${table.sessionId} <> ${sessionId}`),
								and(
									isNull(table.sessionId),
									or(isNull(table.sourceSessionId), sql`${table.sourceSessionId} <> ${sessionId}`)
								)
							)
						)
					)
					.limit(1)
				if (theirs) throw new OwnBookRefusal(TAKE_BACK_REFUSALS.valuesElsewhere(name))
			}
			// A child entry anchored to it, outside the notes and not moved by this batch.
			const children = await tx
				.select({ id: e.id })
				.from(e)
				.where(and(eq(e.anchorEntryId, entry.id), sql`${e.lorebookId} <> ${ownBook.id}`))
			if (children.some((c) => !movedEntryIds.includes(c.id)))
				throw new OwnBookRefusal(TAKE_BACK_REFUSALS.filedUnder(name))
			await assertTurnStands(tx, sessionId, record.messageId ?? null, name)
			const { appliedFrom: _gone, ...extraJson } = (entry.extraJson ?? {}) as Record<string, unknown>
			entryPlan.push({ record, moved, extraJson })
		}
		const plan: { amendmentId: number; rows: typeof records; entry: EntryRow; dated: boolean }[] = []
		for (const [amendmentId, rows] of groups) {
			const [entry] = await tx
				.select()
				.from(e)
				.where(and(eq(e.id, rows[0]!.subjectId), eq(e.lorebookId, bookId)))
				.limit(1)
			if (!entry) {
				const named = rows.find((r) => r.field === "title")
				const was = named ? unwrap(named.before) : null
				throw new OwnBookRefusal(
					TAKE_BACK_REFUSALS.entryGone(typeof was === "string" && was ? was : "The entry")
				)
			}
			const name = entry.title ?? `Entry ${entry.id}`
			const dated = !!causeOf(rows[0]!).dated
			if (dated) {
				const [moved] = await tx
					.select()
					.from(a)
					.where(and(eq(a.id, amendmentId), eq(a.lorebookId, bookId), isNull(a.base)))
					.limit(1)
				const fields = ((moved?.fields ?? {}) as Record<string, unknown>)
				if (!moved || rows.some((r) => !sameValue(fields[causeOf(r).key], unwrap(r.after))))
					throw new OwnBookRefusal(TAKE_BACK_REFUSALS.datedEdited(name))
			} else {
				const read = toEntryRow(entry) as unknown as Record<string, unknown>
				for (const r of rows)
					if (!sameValue(read[causeOf(r).key], unwrap(r.after)))
						throw new OwnBookRefusal(
							TAKE_BACK_REFUSALS.fieldChanged(name, await labelOfKey(entry.typeId, causeOf(r).key))
						)
			}
			// The held row goes back to its turn. A turn that was deleted or taken
			// back since would leave it owned by nothing (or dropped by Forward).
			await assertTurnStands(tx, sessionId, rows[0]!.messageId ?? null, name)
			plan.push({ amendmentId, rows, entry, dated })
		}
		// 🚧 A standalone link must still be in the lorebook.
		for (const link of linkMoves) {
			const cause = causeOf(link)
			if (!cause.standalone) continue
			const [still] = await tx
				.select({ id: r.id })
				.from(r)
				.where(and(eq(r.id, link.subjectId), eq(r.lorebookId, bookId)))
				.limit(1)
			if (!still) throw new OwnBookRefusal(TAKE_BACK_REFUSALS.linkGone(cause.title ?? "link"))
		}
		// 🚧 A merged day: the lorebook's day must still end with the paragraph this session appended.
		const mergePlan: { record: (typeof records)[number]; merged: Merged; lore: EntryRow; content: string }[] = []
		for (const record of mergeRecords) {
			const merged = causeOf(record).merged!
			const [lore] = await tx
				.select()
				.from(e)
				.where(and(eq(e.id, record.subjectId), eq(e.lorebookId, bookId)))
				.limit(1)
			if (!lore) throw new OwnBookRefusal(TAKE_BACK_REFUSALS.entryGone("The history day"))
			const name = lore.title ?? `Entry ${lore.id}`
			const was = String(unwrap(record.before) ?? "")
			const paragraph = String(merged.notesEntry.content ?? "")
			const now = lore.content ?? ""
			let content: string
			if (!paragraph.trim()) content = now
			else if (now === unwrap(record.after)) content = was
			else {
				const suffix = was.trim() ? `\n\n${paragraph}` : paragraph
				if (!now.endsWith(suffix)) throw new OwnBookRefusal(TAKE_BACK_REFUSALS.paragraphBuried(name))
				content = now.slice(0, now.length - suffix.length)
			}
			await assertTurnStands(tx, sessionId, record.messageId ?? null, name)
			mergePlan.push({ record, merged, lore, content })
		}
		// The own-book days go back first (links and repoints name them).
		for (const { merged } of mergePlan) {
			const row = { ...merged.notesEntry } as Record<string, unknown>
			for (const key of ["createdAt", "updatedAt"])
				if (typeof row[key] === "string") row[key] = new Date(row[key] as string)
			// Generated columns are the database's to fill.
			delete row.embedTextHash
			delete row.annotationTextHash
			await tx.insert(e).values(row as typeof e.$inferInsert)
		}
		for (const { record, moved, extraJson } of entryPlan)
			await tx
				.update(e)
				.set({
					lorebookId: moved.lorebookId,
					branchId: moved.branchId,
					position: moved.position,
					anchorBindingId: moved.anchorBindingId,
					anchorEntryId: moved.anchorEntryId,
					extraJson
				})
				.where(eq(e.id, record.subjectId))
		for (const link of linkMoves) {
			const moved = causeOf(link).moved
			if (!moved) continue
			let back: { historyEntryId?: number | null } = {}
			if ("historyEntryId" in moved) {
				const day = moved.historyEntryId ?? null
				const stands =
					day != null && (await tx.select({ id: e.id }).from(e).where(eq(e.id, day)).limit(1)).length > 0
				back = { historyEntryId: stands ? day : null }
			}
			await tx.update(r).set({ lorebookId: moved.lorebookId, branchId: moved.branchId, ...back }).where(eq(r.id, link.subjectId))
		}
		// A merged day: what was pointed at the lorebook's day goes back to the own day, the paragraph comes off.
		for (const { merged, lore, content } of mergePlan) {
			const ownId = Number(merged.notesEntry.id)
			const repointTables = Object.fromEntries(DATED_BY_HISTORY_DAY)
			for (const [name, ids] of Object.entries(merged.repointed)) {
				const table = repointTables[name]
				if (!table || !ids.length) continue
				await tx
					.update(table)
					.set({ historyEntryId: ownId })
					.where(and(inArray(table.id, ids), eq(table.historyEntryId, lore.id)))
			}
			if (content !== (lore.content ?? "")) await writeEntryKeys(t, lore, { content })
		}
		for (const { amendmentId, rows, entry, dated } of plan) {
			const anchor = rows[0]!.messageId ?? null
			const base = Object.fromEntries(rows.map((r) => [causeOf(r).key, r.before]))
			if (dated)
				await tx
					.update(a)
					.set({ lorebookId: ownBook.id, branchId: null, base, sourceMessageId: anchor })
					.where(eq(a.id, amendmentId))
			else {
				await writeEntryKeys(t, entry, Object.fromEntries(rows.map((r) => [causeOf(r).key, unwrap(r.before)])))
				await tx.insert(a).values({
					id: amendmentId,
					lorebookId: ownBook.id,
					entryId: entry.id,
					branchId: null,
					year: null,
					month: null,
					day: null,
					fields: Object.fromEntries(rows.map((r) => [causeOf(r).key, unwrap(r.after)])),
					base,
					sourceMessageId: anchor
				})
			}
		}
		await tx.delete(I).where(and(eq(I.batch, input.batch), eq(I.origin, "apply")))
	})
}

/** Refuses when the turn an Apply's change was anchored to is not a live message of the session. Use only the transaction's handle. */
async function assertTurnStands(
	tx: Pick<Db, "select">,
	sessionId: number,
	anchorId: number | null,
	name: string
): Promise<void> {
	if (anchorId == null) return
	const [turn] = await tx
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.id, anchorId),
				eq(schema.sessionMessages.sessionId, sessionId),
				isNull(schema.sessionMessages.rewindOrdinal)
			)
		)
		.limit(1)
	if (!turn) throw new OwnBookRefusal(TAKE_BACK_REFUSALS.turnGone(name))
}

/**
 * 🚧 **Apply by itself** (owner 2026-11-12, "At scene close, unless a summary
 * waits"): the session's items the lorebook can take without asking — new
 * entries, and held changes the conflict check calls clean — go in through
 * `applyOverlayItems`, the records naming `automatic` (and the scene) instead
 * of a person. Changes apply when a scene closes; while that scene's summary
 * is being written or waits for review they wait, and apply when it is saved;
 * a summary still waiting for an earlier stretch holds back everything from
 * where that stretch starts.
 *
 * Returns null, and writes nothing, unless the session reads a lorebook its
 * own book overlays, belongs to the lorebook's owner, and
 * the write setting in force for the lorebook (`bookLoreWriteMode`) is Full;
 * for `scene-close` and `scene-summary` also the scene (this session's) is
 * closed, and for `scene-close` its summary is not running or in review. Never
 * throws (a failure is a warning, and null). **Never call it with a
 * transaction handle**: it opens its own transaction, only through
 * `applyOverlayItems`, and the caller announces the settle after the commit.
 */
export async function applyHeldAutomatically(
	db: Db,
	input: {
		sessionId: number
		automatic: AutomaticApplyCause
		sceneId?: number
		/** Only what was written before this message (Close out's closing stretch waits for its summaries). */
		before?: number
	}
): Promise<(ApplyOverlayResult & { userId: number }) | null> {
	try {
		const [session] = await db
			.select({
				userId: schema.sessions.userId,
				lorebookId: schema.sessions.lorebookId,
				branchOfSessionId: schema.sessions.branchOfSessionId
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, input.sessionId))
			.limit(1)
		if (!session || session.lorebookId == null) return null
		const ownBook = await ownBookOf(db, input.sessionId)
		if (!ownBook || ownBook.overlayOf == null) return null
		const [book] = await db
			.select({ userId: schema.lorebooks.userId })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, session.lorebookId))
			.limit(1)
		if (!book || book.userId !== session.userId) return null
		const { bookLoreWriteMode } = await import("$lib/server/state/loreWriteMode")
		if ((await bookLoreWriteMode(db, session.lorebookId)) !== "full") return null
		// An Apply discards the Forward stack for good. Nothing automatic does that
		// (P1): while turns are taken back, the changes wait for the next trigger.
		const [rewound] = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, input.sessionId),
					isNotNull(schema.sessionMessages.rewindOrdinal)
				)
			)
			.limit(1)
		if (rewound) return null

		const S = schema.scenes
		const scenes = await db
			.select({
				id: S.id,
				summaryStatus: S.summaryStatus,
				openedAtMessageId: S.openedAtMessageId,
				closedAtMessageId: S.closedAtMessageId,
				selectedMessageIds: S.selectedMessageIds
			})
			.from(S)
			.where(eq(S.sessionId, input.sessionId))
		const selectedOf = (s: { selectedMessageIds: number[] | null }) => (s.selectedMessageIds ?? []) as number[]
		const waiting = (s: { summaryStatus: string }) => s.summaryStatus === "running" || s.summaryStatus === "review"
		let through: number | null = null
		if (input.automatic !== "close-out") {
			const scene = scenes.find((s) => s.id === input.sceneId)
			if (!scene) return null
			// Closed: its close message; a scene captured by selection, the greatest message it holds.
			if (scene.closedAtMessageId != null) through = scene.closedAtMessageId
			else if (scene.openedAtMessageId == null && selectedOf(scene).length) through = Math.max(...selectedOf(scene))
			if (through == null) return null
			// Its own summary is being written or waits for review: saving it applies them.
			if (input.automatic === "scene-close" && waiting(scene)) return null
		}
		// A waiting summary gates its scene: nothing from its start on.
		const starts = scenes
			.filter(waiting)
			.map((s) => s.openedAtMessageId ?? (selectedOf(s).length ? Math.min(...selectedOf(s)) : null))
			.filter((n): n is number => n != null)
		const waitingStart = starts.length ? Math.min(...starts) : null
		// 🚧 A branch applies by itself only what **it** wrote, and only what lands on its own line.
		// What it holds as a copy of its original's waiting rows (anchored on a copied message, or on
		// none) is the original's to apply: applying the copy too would put the same room in the
		// lorebook twice. And an undated change to a lorebook entry folds into the entry itself, which
		// every line reads: from a branch that waits for a person's press.
		const isBranch = session.branchOfSessionId != null
		const copied = isBranch
			? new Set(
					(
						await db
							.select({ id: schema.sessionMessages.id })
							.from(schema.sessionMessages)
							.where(
								and(
									eq(schema.sessionMessages.sessionId, input.sessionId),
									sql`${schema.sessionMessages.metadata} ->> 'copyOf' IS NOT NULL`
								)
							)
					).map((m) => m.id)
				)
			: null
		const inRange = (anchor: number | null) =>
			anchor == null ||
			((through == null || anchor <= through) &&
				(waitingStart == null || anchor < waitingStart) &&
				(input.before == null || anchor < input.before))
		const within = (anchor: number | null) =>
			inRange(anchor) && (copied == null || (anchor != null && !copied.has(anchor)))
		const items = await overlayItemsOf(db, input.sessionId)
		const entryIds = items.filter((i) => i.kind === "entry" && within(i.sourceMessageId)).map((i) => (i as OverlayEntryItem).entryId)
		// 🚧 A held paragraph is offered by its own-book day, a standalone link by its id: the same range rule.
		for (const i of items)
			if (i.kind === "entry-change" && i.notesEntryId != null && within(i.sourceMessageId)) entryIds.push(i.notesEntryId)
		const linkIds = items.filter((i): i is OverlayLinkItem => i.kind === "link" && within(i.sourceMessageId)).map((i) => i.linkId)
		// Every held change in range is offered, conflicted or not: Apply re-checks each in anchor order after
		// the folds before it, so one that waits on an earlier change of this session folds with it, and a
		// real conflict stays held with its reason (additive or clean, decided at accept time).
		let amendmentIds = items
			.filter((i): i is OverlayEntryChangeItem => i.kind === "entry-change" && i.amendmentId != null && within(i.sourceMessageId))
			.map((i) => i.amendmentId!)
		if (isBranch && amendmentIds.length) {
			const dated = new Set(
				(
					await db
						.select({ id: schema.entryAmendments.id })
						.from(schema.entryAmendments)
						.where(and(inArray(schema.entryAmendments.id, amendmentIds), isNotNull(schema.entryAmendments.year)))
				).map((a) => a.id)
			)
			amendmentIds = amendmentIds.filter((id) => dated.has(id))
		}
		if (!entryIds.length && !amendmentIds.length && !linkIds.length) return null
		const done = await applyOverlayItems(db, {
			sessionId: input.sessionId,
			userId: session.userId,
			entryIds,
			amendmentIds,
			linkIds,
			automatic: { automatic: input.automatic, ...(input.sceneId != null ? { sceneId: input.sceneId } : {}) }
		})
		return { ...done, userId: session.userId }
	} catch (err) {
		console.warn(`[apply] automatic apply for session ${input.sessionId} failed:`, err)
		return null
	}
}

/**
 * What the lorebook's owner may do here: `mayApply` — the reader owns the
 * session's lorebook (Apply and Take back are theirs); `appliesItself` — the
 * lorebook takes this session's changes by itself (the session's owner owns
 * it, branch or not, and the write setting in force for the lorebook is
 * Full). Both false when the session reads no lorebook.
 */
export async function overlayAccessOf(
	db: Db,
	sessionId: number,
	userId: number
): Promise<{ mayApply: boolean; appliesItself: boolean }> {
	const none = { mayApply: false, appliesItself: false }
	const [session] = await db
		.select({
			userId: schema.sessions.userId,
			lorebookId: schema.sessions.lorebookId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session || session.lorebookId == null) return none
	const [book] = await db
		.select({ userId: schema.lorebooks.userId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, session.lorebookId))
		.limit(1)
	if (!book) return none
	const { bookLoreWriteMode } = await import("$lib/server/state/loreWriteMode")
	return {
		mayApply: book.userId === userId,
		appliesItself:
			book.userId === session.userId &&
			(await bookLoreWriteMode(db, session.lorebookId)) === "full"
	}
}

/**
 * What was applied from a session, one batch per Apply, newest first: who
 * pressed (a person's shown name) or why it applied by itself, the scene when
 * the cause names one, and each moved entry and folded change as the lorebook
 * holds it now. Links ride with their entries and are not items.
 */
export async function appliedBatchesOf(db: Db, sessionId: number): Promise<Sockets.Sessions.AppliedBatches.Batch[]> {
	const I = schema.loreImprints
	const records = (await db
		.select()
		.from(I)
		.where(and(eq(I.sessionId, sessionId), eq(I.origin, "apply"), isNotNull(I.batch)))
		.orderBy(I.id)) as import("$lib/server/lorebooks/imprints").LoreImprintRow[]
	if (!records.length) return []
	const { unwrap, fieldLabel } = await import("$lib/server/lorebooks/imprints")
	const e = schema.lorebookEntries
	const entryIds = [...new Set(records.filter((r) => r.subjectKind === "entry").map((r) => r.subjectId))]
	const entries = new Map(
		(entryIds.length
			? await db.select({ id: e.id, typeId: e.typeId, title: e.title }).from(e).where(inArray(e.id, entryIds))
			: []
		).map((row) => [row.id, row])
	)
	type Cause = {
		by?: { userId?: number }
		automatic?: Sockets.Sessions.AppliedBatches.Batch["automatic"]
		sceneId?: number
		amendmentId?: number
		key?: string
		standalone?: true
		title?: string
	}
	const userIds = [
		...new Set(records.map((r) => (r.cause as Cause | null)?.by?.userId).filter((n): n is number => typeof n === "number"))
	]
	const names = new Map(
		(userIds.length
			? await db
					.select({ id: schema.users.id, displayName: schema.users.displayName, username: schema.users.username })
					.from(schema.users)
					.where(inArray(schema.users.id, userIds))
			: []
		).map((u) => [u.id, u.displayName?.trim() || u.username])
	)
	const byBatch = new Map<string, typeof records>()
	for (const r of records) byBatch.set(r.batch!, [...(byBatch.get(r.batch!) ?? []), r])
	const out: { newest: number; batch: Sockets.Sessions.AppliedBatches.Batch }[] = []
	for (const [batch, rows] of byBatch) {
		const cause = (rows[0]!.cause ?? {}) as Cause
		const items: Sockets.Sessions.AppliedBatches.Item[] = []
		for (const r of rows.filter((x) => x.subjectKind === "entry" && x.field == null))
			items.push({ kind: "entry", entryId: r.subjectId, title: entries.get(r.subjectId)?.title ?? "" })
		const changes = new Map<number, typeof rows>()
		for (const r of rows.filter((x) => x.subjectKind === "entry" && x.field != null)) {
			const id = (r.cause as Cause).amendmentId ?? -r.id
			changes.set(id, [...(changes.get(id) ?? []), r])
		}
		// 🚧 A standalone link is an item; a link that rode with an entry is not (and does not count).
		const standalone = rows.filter((x) => x.subjectKind === "relationship" && x.field == null && (x.cause as Cause).standalone)
		const linkRows = standalone.length
			? await db
					.select()
					.from(schema.narrativeRelationships)
					.where(inArray(schema.narrativeRelationships.id, standalone.map((x) => x.subjectId)))
			: []
		const linkFacts = linkRows.length ? await linkEndFactsOf(db, linkRows) : null
		const linkTitles = linkFacts ? await linkTitlesOf(db, sessionId, linkRows, linkFacts) : new Map<number, string>()
		for (const x of standalone) {
			const link = linkRows.find((l) => l.id === x.subjectId)
			const entryId = link ? (link.fromEntryId ?? link.toEntryId ?? 0) : 0
			items.push({
				kind: "link",
				linkId: x.subjectId,
				entryId,
				title: linkTitles.get(x.subjectId) ?? (x.cause as Cause).title ?? ""
			} as unknown as Sockets.Sessions.AppliedBatches.Item)
		}
		for (const group of changes.values()) {
			const entry = entries.get(group[0]!.subjectId)
			items.push({
				kind: "entry-change",
				entryId: group[0]!.subjectId,
				title: entry?.title ?? "",
				changes: await Promise.all(
					group.map(async (r) => {
						const key = (r.cause as Cause).key ?? r.field!
						let label: string
						try {
							label = entry ? await labelOfKey(entry.typeId, key) : fieldLabel(r.field!)
						} catch {
							label = fieldLabel(r.field!)
						}
						return { field: key, label, before: unwrap(r.before), after: unwrap(r.after) }
					})
				)
			})
		}
		const userId = cause.by?.userId
		out.push({
			newest: Math.max(...rows.map((r) => r.id)),
			batch: {
				batch,
				at: new Date(Math.min(...rows.map((r) => r.createdAt.getTime()))).toISOString(),
				by: typeof userId === "number" ? { userId, name: names.get(userId) ?? `User ${userId}` } : null,
				automatic: cause.automatic ?? null,
				sceneId: cause.sceneId ?? null,
				count: items.length,
				items
			}
		})
	}
	return out.sort((x, y) => y.newest - x.newest).map((x) => x.batch)
}

/**
 * The places that moved into a real book leave their turn behind: their `location` `attribute_values` and
 * `attribute_configs` rows carrying a `valid_from_message_id` are re-filed as new rows undated by message,
 * earliest anchor first so the row in force keeps the highest id, and the originals are deleted. Use only `t`.
 */
async function dropTurnTiesOfPlaces(t: Db, entryIds: readonly number[]): Promise<void> {
	if (entryIds.length === 0) return
	for (const table of [schema.attributeValues, schema.attributeConfigs]) {
		const tied: any[] = await t
			.select()
			.from(table)
			.where(
				and(
					eq(table.ownerKind, "location"),
					inArray(table.ownerId, [...entryIds]),
					sql`${table.validFromMessageId} IS NOT NULL`
				)
			)
		if (tied.length === 0) continue
		tied.sort((x, y) => x.validFromMessageId - y.validFromMessageId || x.id - y.id)
		for (const { id: _id, ...row } of tied) await t.insert(table).values({ ...row, validFromMessageId: null })
		await t.delete(table).where(inArray(table.id, tied.map((x) => x.id)))
	}
}

/** An entry as a session reads it, marked when it is the session's own (§26). */
export type SessionEntryAsRead = import("$lib/server/state/entriesOnReading").EntryAsRead & {
	/** From the session's own notes: "this session only" on the wire. */
	sessionOnly?: true
}

/**
 * The union read (§26): the entries a session reads — its attached book's
 * on the session's reading (`sessionReadingOf`), then its own notes': at main's
 * head beside an attached book, on the session's reading when the notes are
 * read alone — each from `entriesAsRead`, the notes' marked `sessionOnly`. The readers that take one
 * book id keep doing so; this is for the ones a session asks "what is there".
 */
export async function sessionEntriesAsRead(
	db: Db,
	sessionId: number,
	sight: import("$lib/shared/lorebooks/placeSight").PlaceSight,
	typeIds: readonly string[] | null,
	entryIds?: readonly number[]
): Promise<SessionEntryAsRead[]> {
	const { entriesAsRead, MAIN_HEAD } = await import("$lib/server/state/entriesOnReading")
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const books = await lorebooksReadBy(db, sessionId)
	const out: SessionEntryAsRead[] = []
	const reading = await sessionReadingOf(db, sessionId)
	if (books.attachedId != null && reading)
		out.push(...(await entriesAsRead(db, reading.lorebookId, reading, sight, typeIds, entryIds)))
	const ownAt = books.attachedId == null ? (reading ?? MAIN_HEAD) : MAIN_HEAD
	if (books.ownBookId != null)
		for (const entry of await entriesAsRead(db, books.ownBookId, ownAt, sight, typeIds, entryIds))
			out.push({ ...entry, sessionOnly: true })
	return out
}
