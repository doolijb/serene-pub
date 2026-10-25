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
 *   the session alone, and deleted with it (the FK cascades; the stat rows on
 *   its owners, which carry no key, by `purgeOwnBookOf`);
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
 * parent's book cascades with the parent, and a branch session that outlives
 * its parent must not lose its world with it.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import { liveMessageWhere } from "$lib/server/messages/store"
import * as schema from "$lib/server/db/schema"
import { sessionLoreWriteMode } from "$lib/server/state/loreWriteMode"
import type { LoreWriteMode } from "$lib/shared/lorebooks/loreWriteMode"
import { SHARE_REFUSALS } from "$lib/shared/lorebooks/sessionNotes"
import { STORY_CALENDAR_PRESETS, type StoryCalendar } from "@serene-pub/sdk"

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
 * 🚧 The one insert of an own book: `kind` 'book', `story_calendar`
 * `OWN_BOOK_CALENDAR`, every `story_clock_*` NULL; a blank name reads
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
	}
): Promise<OwnBookRow> {
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
			storyCalendar: OWN_BOOK_CALENDAR,
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
 * is not this session's message is ignored for the newest.
 */
export async function loreWriteTargetFor(
	db: Db,
	sessionId: number,
	opts: { anchorMessageId?: number | null } = {}
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
	if (route === "book")
		return { route, lorebookId: attachedId!, attachedId, mode, sourceMessageId: null }
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

/**
 * Before a session is deleted: what its notes hold that carries no key —
 * the stat rows on its owners, pending changes, ranking evidence — goes
 * (`purgeLorebook`); the row itself and its entries go by the cascade.
 */
export async function purgeOwnBookOf(db: Db, sessionId: number): Promise<void> {
	const ownBook = await ownBookOf(db, sessionId)
	if (!ownBook) return
	const { purgeLorebook } = await import("$lib/server/lorebooks/tableRegistry")
	await db.transaction(async (tx) => {
		await purgeLorebook(tx as unknown as Db, ownBook.id)
		await tx.delete(schema.lorebooks).where(eq(schema.lorebooks.id, ownBook.id))
	})
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
 * copied message. Only entries are copied — 🚧 the notes' links and stat
 * rows do not come across yet.
 */
export async function copyOwnBookToBranch(
	tx: Db,
	input: {
		sessionId: number
		created: { id: number; name: string | null; userId: number; lorebookId: number | null; primaryRuleset: string; rulesetVersion: string | null }
		forkMessageId: number
		remap: Map<number, number>
	}
): Promise<{ lorebookId: number; entryRemap: Map<number, number> }> {
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
		return { lorebookId: fresh.id, entryRemap: new Map() }
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
	const entries = await tx
		.select()
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, parent.id),
				// The notes are never branched as a book: only main's rows.
				isNull(schema.lorebookEntries.branchId)
			)
		)
		.orderBy(schema.lorebookEntries.id)
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
				// The cast of the notes is not copied: no binding to anchor to.
				anchorBindingId: null,
				sourceMessageId: anchor
			})
			.returning({ id: schema.lorebookEntries.id })
		entryRemap.set(oldId, copy!.id)
	}
	// Each copied entry's id by its original's: the branch's state rows name
	// the copies (`copyStateRows` — a place owner, a location ref).
	return { lorebookId: made!.id, entryRemap }
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

/** A refusal of a notes action, as a sentence a person can read. */
export class OwnBookRefusal extends Error {}

/** The refusals "Apply to the lorebook" gives. */
export const APPLY_OVERLAY_REFUSALS = Object.freeze({
	missing: "Session not found.",
	noBook: "This session reads no lorebook, so there is nothing to apply to.",
	notOwner: "Only the lorebook's owner can apply changes to it."
})

/**
 * One item of an overlay (§26 overlay role) as the review queue lists it:
 * an entry the session wrote to its own notes while it read a book it could
 * not write. 🚧 Entries only; links travel with their ends (`applyOverlayItems`).
 */
export interface OverlayItem {
	entryId: number
	typeId: string
	title: string
	/** The message that wrote it. */
	sourceMessageId: number | null
}

/**
 * The overlay's items, oldest first: the notes' entries while the session
 * reads an attached lorebook. Empty when the notes are the world store (no
 * book: nothing to review) or there are no notes.
 */
export async function overlayItemsOf(db: Db, sessionId: number): Promise<OverlayItem[]> {
	const ownBook = await ownBookOf(db, sessionId)
	if (!ownBook || ownBook.overlayOf == null) return []
	const [session] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (session?.lorebookId == null) return []
	const e = schema.lorebookEntries
	const rows = await db
		.select({ id: e.id, typeId: e.typeId, title: e.title, sourceMessageId: e.sourceMessageId })
		.from(e)
		.where(and(eq(e.lorebookId, ownBook.id), isNull(e.branchId)))
		.orderBy(e.id)
	return rows.map((r) => ({
		entryId: r.id,
		typeId: r.typeId,
		title: r.title ?? "",
		sourceMessageId: r.sourceMessageId ?? null
	}))
}

/**
 * **Apply to the lorebook** (§15, §26): overlay items move into the attached
 * book — the same rows, so every link and stat that names them keeps its
 * id — on the session's line, at a free position, with provenance kept
 * (`source_message_id` stays; `extra_json.appliedFrom` names the session and
 * the ruleset version), and leave the overlay. A link of the notes moves
 * with its ends once every end it has is in the book. `entryIds` absent
 * applies every item. The attached book's owner only: applying is a write.
 */
export async function applyOverlayItems(
	db: Db,
	input: { sessionId: number; userId: number; entryIds?: readonly number[] | null }
): Promise<{ lorebookId: number; applied: number[] }> {
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
	const items = await overlayItemsOf(db, input.sessionId)
	const wanted = input.entryIds ? new Set(input.entryIds) : null
	const chosen = items.filter((i) => !wanted || wanted.has(i.entryId))
	if (!chosen.length) return { lorebookId: bookId, applied: [] }
	const ownBook = (await ownBookOf(db, input.sessionId))!
	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const branchId = (await sessionReadingOf(db, input.sessionId))?.branchId ?? null
	const { nextPosition } = await import("$lib/server/utils/lorebookEntries")
	const ruleset = session.rulesetVersion
		? `${session.primaryRuleset}#${session.rulesetVersion}`
		: session.primaryRuleset
	const applied: number[] = []
	await db.transaction(async (tx) => {
		const t = tx as unknown as Db
		await tx.execute(sql`select pg_advisory_xact_lock(${bookId})`)
		const e = schema.lorebookEntries
		for (const item of chosen) {
			const [row] = await tx
				.select({ extraJson: e.extraJson, anchorEntryId: e.anchorEntryId })
				.from(e)
				.where(and(eq(e.id, item.entryId), eq(e.lorebookId, ownBook.id)))
				.limit(1)
			if (!row) continue
			// A parent left behind in the notes is no parent in the book; a
			// parent already IN the book stays one (pr-6 B review: an entry the
			// session filed under a book entry lost its parent on Share).
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
				chosen.some((c) => c.entryId === row.anchorEntryId)
			await tx
				.update(e)
				.set({
					lorebookId: bookId,
					branchId,
					position: await nextPosition(t, bookId, item.typeId),
					// The notes' cast is not the book's.
					anchorBindingId: null,
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
			applied.push(item.entryId)
		}
		// The links whose every end is now outside the notes come along.
		const r = schema.narrativeRelationships
		const links = await tx
			.select({
				id: r.id,
				fromEntryId: r.fromEntryId,
				toEntryId: r.toEntryId,
				fromNodeId: r.fromNodeId,
				toNodeId: r.toNodeId
			})
			.from(r)
			.where(eq(r.lorebookId, ownBook.id))
		const stillNotes = new Set(
			(
				await tx
					.select({ id: e.id })
					.from(e)
					.where(eq(e.lorebookId, ownBook.id))
			).map((x) => x.id)
		)
		const moving = links.filter(
			(l) =>
				l.fromNodeId == null &&
				l.toNodeId == null &&
				[l.fromEntryId, l.toEntryId].some((id) => id != null && applied.includes(id)) &&
				[l.fromEntryId, l.toEntryId].every((id) => id == null || !stillNotes.has(id))
		)
		if (moving.length)
			await tx
				.update(r)
				.set({ lorebookId: bookId, branchId })
				.where(inArray(r.id, moving.map((l) => l.id)))
	})
	return { lorebookId: bookId, applied }
}

/** An entry as a session reads it, marked when it is the session's own (§26). */
export type SessionEntryAsRead = import("$lib/server/state/entriesOnReading").EntryAsRead & {
	/** From the session's own notes: "this session only" on the wire. */
	sessionOnly?: true
}

/**
 * The union read (§26): the entries a session reads — its attached book's
 * on the session's reading (`sessionReadingOf`), then its own notes' at their
 * head (the notes are never branched as a book) — each from
 * `entriesAsRead`, the notes' marked `sessionOnly`. The readers that take one
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
	if (books.attachedId != null) {
		const reading = await sessionReadingOf(db, sessionId)
		if (reading) out.push(...(await entriesAsRead(db, reading.lorebookId, reading, sight, typeIds, entryIds)))
	}
	if (books.ownBookId != null)
		for (const entry of await entriesAsRead(db, books.ownBookId, MAIN_HEAD, sight, typeIds, entryIds))
			out.push({ ...entry, sessionOnly: true })
	return out
}

/**
 * 🚧 **Clone with changes and attach** (R-p): the attached book copied whole (`duplicateLorebookRows`), the session
 * moved onto the copy with every row of its own that named the original by id remapped, then the own book's
 * changes written into the copy (`applyOverlayItems`). The original is never written.
 */
export async function cloneWithChanges(db: Db, input: { sessionId: number; userId: number; name?: string | null }): Promise<{ lorebookId: number; name: string; applied: number[] }> {
	const [session] = await db
		.select({
			userId: schema.sessions.userId,
			name: schema.sessions.name,
			lorebookId: schema.sessions.lorebookId,
			lorebookBranchId: schema.sessions.lorebookBranchId
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, input.sessionId))
		.limit(1)
	if (!session) throw new OwnBookRefusal(SHARE_REFUSALS.missing)
	if (session.userId !== input.userId) throw new OwnBookRefusal(SHARE_REFUSALS.notOwner)
	const attachedId = session.lorebookId
	if (attachedId == null) throw new OwnBookRefusal(SHARE_REFUSALS.noBook)
	const { assertReadableBook } = await import("$lib/server/utils/ownedBook")
	const attached = await assertReadableBook(db, input.userId, attachedId, { isAdmin: false })
	const name =
		input.name?.trim() ||
		`${attached.name} (with ${session.name?.trim() || UNNAMED}'s notes)`
	const { duplicateLorebookRows } = await import("$lib/server/utils/lorebookDuplicate")
	const sessionId = input.sessionId
	/** The own book's entries whose parent is now one of the copy's: id → that parent. */
	const underCopy = new Map<number, number>()

	const copyId = await db.transaction(async (tx) => {
		const t = tx as unknown as Db
		const copy = await duplicateLorebookRows(t, attachedId, session.userId, name)
		const { maps } = copy
		/** A source id's copy, where the source id is one the map holds; else the id as it was. */
		const through = (map: Map<number, number>, id: number | null): number | null =>
			id == null ? null : (map.get(id) ?? id)

		await tx
			.update(schema.sessions)
			.set({
				lorebookId: copy.id,
				lorebookBranchId:
					session.lorebookBranchId != null
						? (maps.branches.get(session.lorebookBranchId) ?? null)
						: null,
				updatedAt: new Date()
			})
			.where(eq(schema.sessions.id, sessionId))

		// The own book: overlays the copy; its rows that named the original's rows now name the copy's.
		const own = await ownBookOf(t, sessionId)
		if (own) {
			const e = schema.lorebookEntries
			const ownEntries = await tx
				.select({ id: e.id, anchorEntryId: e.anchorEntryId, anchorBindingId: e.anchorBindingId })
				.from(e)
				.where(eq(e.lorebookId, own.id))
			for (const row of ownEntries) {
				const anchorEntryId = through(maps.entries, row.anchorEntryId)
				if (anchorEntryId != null && anchorEntryId !== row.anchorEntryId)
					underCopy.set(row.id, anchorEntryId)
				const anchorBindingId = through(maps.bindings, row.anchorBindingId)
				if (anchorEntryId === row.anchorEntryId && anchorBindingId === row.anchorBindingId)
					continue
				await tx.update(e).set({ anchorEntryId, anchorBindingId }).where(eq(e.id, row.id))
			}
			const r = schema.narrativeRelationships
			const links = await tx
				.select({
					id: r.id,
					fromEntryId: r.fromEntryId,
					toEntryId: r.toEntryId,
					fromNodeId: r.fromNodeId,
					toNodeId: r.toNodeId
				})
				.from(r)
				.where(eq(r.lorebookId, own.id))
			for (const l of links) {
				const next = {
					fromEntryId: through(maps.entries, l.fromEntryId),
					toEntryId: through(maps.entries, l.toEntryId),
					fromNodeId: through(maps.bindings, l.fromNodeId),
					toNodeId: through(maps.bindings, l.toNodeId)
				}
				if (
					next.fromEntryId === l.fromEntryId &&
					next.toEntryId === l.toEntryId &&
					next.fromNodeId === l.fromNodeId &&
					next.toNodeId === l.toNodeId
				)
					continue
				await tx.update(r).set(next).where(eq(r.id, l.id))
			}
			// The rule-fed overlay: entry fields keyed by entry id, cast states by member id.
			const extra = (own.extraJson ?? {}) as Record<string, unknown>
			const fed = extra.ruleFed as
				| { entryFields?: Record<string, unknown>; castStates?: Record<string, unknown> }
				| undefined
			let extraJson: Record<string, unknown> | undefined
			if (fed && typeof fed === "object") {
				const rekey = (o: Record<string, unknown> | undefined, map: Map<number, number>) => {
					const out: Record<string, unknown> = {}
					for (const [k, v] of Object.entries(o ?? {})) {
						const n = Number(k)
						out[Number.isInteger(n) && map.has(n) ? String(map.get(n)) : k] = v
					}
					return out
				}
				extraJson = {
					...extra,
					ruleFed: {
						...fed,
						entryFields: rekey(fed.entryFields, maps.entries),
						castStates: rekey(fed.castStates, maps.bindings)
					}
				}
			}
			await tx
				.update(schema.lorebooks)
				.set({ overlayOf: copy.id, ...(extraJson ? { extraJson } : {}) })
				.where(eq(schema.lorebooks.id, own.id))
		}

		// This session's scenes filed in the original move to the copy; the copy's capture-less duplicates go.
		const sc = schema.scenes
		const moving = await tx
			.select({ id: sc.id, branchId: sc.branchId, historyEntryId: sc.historyEntryId })
			.from(sc)
			.where(and(eq(sc.sessionId, sessionId), eq(sc.lorebookId, attachedId)))
		for (const scene of moving) {
			const duplicate = maps.scenes.get(scene.id)
			if (duplicate != null) await tx.delete(sc).where(eq(sc.id, duplicate))
			await tx
				.update(sc)
				.set({
					lorebookId: copy.id,
					branchId: scene.branchId != null ? (maps.branches.get(scene.branchId) ?? null) : null,
					historyEntryId: through(maps.entries, scene.historyEntryId)!
				})
				.where(eq(sc.id, scene.id))
			// Its cast names the original's members.
			const cast = await tx
				.select({ id: schema.sceneCharacters.id, bindingId: schema.sceneCharacters.bindingId })
				.from(schema.sceneCharacters)
				.where(eq(schema.sceneCharacters.sceneId, scene.id))
			for (const c of cast) {
				const bindingId = through(maps.bindings, c.bindingId)!
				if (bindingId !== c.bindingId)
					await tx
						.update(schema.sceneCharacters)
						.set({ bindingId })
						.where(eq(schema.sceneCharacters.id, c.id))
			}
		}

		// The session's cast-member attributes name the original's members.
		for (const table of [schema.attributeValues, schema.attributeConfigs] as const) {
			const rows = await tx
				.select({ id: table.id, ownerId: table.ownerId })
				.from(table)
				.where(and(eq(table.sessionId, sessionId), eq(table.ownerKind, "cast_member")))
			for (const row of rows) {
				const ownerId = maps.bindings.get(row.ownerId)
				if (ownerId != null)
					await tx.update(table).set({ ownerId }).where(eq(table.id, row.id))
			}
		}

		// The session's imprints on entries and members name the copy's; other kinds are untouched.
		const li = schema.loreImprints
		const imprints = await tx
			.select({ id: li.id, subjectKind: li.subjectKind, subjectId: li.subjectId })
			.from(li)
			.where(and(eq(li.sessionId, sessionId), inArray(li.subjectKind, ["entry", "member"])))
		for (const row of imprints) {
			const subjectId = (row.subjectKind === "entry" ? maps.entries : maps.bindings).get(row.subjectId)
			if (subjectId != null)
				await tx.update(li).set({ subjectId, lorebookId: copy.id }).where(eq(li.id, row.id))
		}
		return copy.id
	})

	const { applied } = await applyOverlayItems(db, {
		sessionId,
		userId: input.userId,
		entryIds: null
	})
	// `applyOverlayItems` lets go of a parent that is not itself moving; here the parent is
	// already in the copy, so the entry keeps it.
	for (const id of applied) {
		const parent = underCopy.get(id)
		if (parent != null)
			await db
				.update(schema.lorebookEntries)
				.set({ anchorEntryId: parent })
				.where(and(eq(schema.lorebookEntries.id, id), isNull(schema.lorebookEntries.anchorEntryId)))
	}
	return { lorebookId: copyId, name, applied }
}
