/**
 * 🚧 **A session's own notes** — the lorebook a session writes its world to
 * when it has no lorebook, or may not write the one it has (PLAN-rulesets
 * §26, ruled 2026-10-16). Working word: *phantom*. Never said in the UI: a
 * person meets it only as the "this session only" mark on what it holds and
 * as one action, **Create lorebook from session**.
 *
 * ## A real lorebook row, not JSON
 *
 * The notes are a `lorebooks` row with `session_id` set, on the same tables
 * and the same lorebook API as any book — entries, links, amendments, dated
 * history, stats on their owners — so every reader that takes a book id
 * reads them unchanged. They are:
 *
 * - **made lazily**, on the session's first write that has nowhere else to go
 *   (`phantomLorebookFor`), named after the session and taking its ruleset;
 * - **invisible**: every listing, picker and search filters
 *   `session_id IS NULL`, and the access check lets the session's members in
 *   and nobody else (`phantomAccessFor`);
 * - **the session's**, with no permission or approval ever asked — managed by
 *   the session alone, and deleted with it (the FK cascades; the stat rows on
 *   its owners, which carry no key, by `purgePhantomOf`);
 * - **an overlay** (`overlay_of`) while the session reads a real lorebook it
 *   may not write: the notes then hold the session's diff, and a session's
 *   reading is the union (`lorebooksReadBy`).
 *
 * ## Where a session's world write lands
 *
 * `loreWriteTargetFor` is the one routing rule: the attached book when the
 * session's owner owns it and their lore write mode is **Full**; otherwise —
 * no book, Review changes, Off, or a book someone else owns — these notes,
 * each row stamped with the message that wrote it (`source_message_id`), so
 * the timeline (§29) retracts it with its message and a branch knows whether
 * it came across.
 *
 * ## Branches
 *
 * A session branch is a new session; its notes are a copy of the parent's as
 * of the fork (`copyPhantomToBranch`): every row anchored at or before the
 * fork message, anchors remapped onto the copied messages. Deliberately a
 * copy rather than a `lorebook_branches` line on the parent's notes: the
 * parent's notes cascade with the parent, and a branch session that outlives
 * its parent must not lose its world with it.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { sessionLoreWriteMode } from "$lib/server/state/loreWriteMode"
import type { LoreWriteMode } from "$lib/shared/lorebooks/loreWriteMode"

/** What a session's notes are named when the session has no name. */
const UNNAMED = "Untitled session"

export type PhantomRow = typeof schema.lorebooks.$inferSelect

/** The refusals "Create lorebook from session" gives, in its own sentences. */
export const CREATE_LOREBOOK_FROM_SESSION_REFUSALS = Object.freeze({
	notOwner: "Only the session's owner can create a lorebook from it.",
	attached:
		"This session already reads a lorebook. Its notes stay with the session.",
	missing: "Session not found."
})

/** The session's own notes, when it has any. Never creates. */
export async function phantomOf(
	db: Db,
	sessionId: number
): Promise<PhantomRow | null> {
	const [row] = await db
		.select()
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.sessionId, sessionId))
		.limit(1)
	return row ?? null
}

/**
 * The session's own notes, made on first ask (§26): named after the session,
 * owned by its owner, taking its ruleset, `referenced` (notes never
 * materialise a compendium), and overlaying its attached lorebook when it
 * has one. An existing row's `overlay_of` follows the session's book, so a
 * session that attaches or drops a book reads its notes the right way round.
 *
 * Race-safe: the partial unique index on `session_id` lets two first writes
 * both insert and one win (`ON CONFLICT DO NOTHING`), and both read the winner.
 */
export async function phantomLorebookFor(
	db: Db,
	sessionId: number
): Promise<PhantomRow> {
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

	const existing = await phantomOf(db, sessionId)
	if (existing) {
		// The notes follow the session on every resync — its book AND its
		// ruleset (A19): a session that changes ruleset otherwise keeps notes
		// stamped with the one it left, and their pieces read as a stranger's.
		const rulesetVersion = session.rulesetVersion ?? null
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

	await db
		.insert(schema.lorebooks)
		.values({
			name: session.name?.trim() || UNNAMED,
			userId: session.userId,
			sessionId,
			overlayOf,
			primaryRuleset: session.primaryRuleset,
			rulesetVersion: session.rulesetVersion,
			compendiumMode: "referenced"
		})
		.onConflictDoNothing()
	const made = await phantomOf(db, sessionId)
	if (!made) throw new Error(`The notes of session ${sessionId} could not be made`)
	return made
}

/**
 * The books a session reads (§26 "reads are the union"): its attached
 * lorebook, then its own notes — each only when it exists. `ids` is the two
 * in that order, for a reader that loops; a row read from `phantomId` is
 * "this session only" on the wire (`sessionOnly: true`).
 */
export interface BooksReadBy {
	attachedId: number | null
	phantomId: number | null
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
	if (!row) return { attachedId: null, phantomId: null, ids: [] }
	const phantom = await phantomOf(db, row.id)
	return booksReadBy(row.lorebookId ?? null, phantom?.id ?? null)
}

/** The pure half of `lorebooksReadBy`: the two ids, in reading order. */
export function booksReadBy(attachedId: number | null, phantomId: number | null): BooksReadBy {
	const ids: number[] = []
	if (attachedId != null) ids.push(attachedId)
	if (phantomId != null && phantomId !== attachedId) ids.push(phantomId)
	return { attachedId, phantomId: phantomId === attachedId ? null : phantomId, ids }
}

/**
 * Where a session's world write lands (§15, §26; the brief's routing rule):
 *
 * - `book` — the attached lorebook: the session's owner owns it and the
 *   owner's lore write mode is **Full**;
 * - `phantom` — the session's own notes: no book, Review changes, Off, or a
 *   book someone else owns (a shared book is read and copied, never written).
 *
 * Pure: the caller reads the facts. `reason: "delete"` is the delete
 * safeguard, whose notes go with the session it records — it never routes to
 * them (see `durable.ts`).
 */
export type LoreWriteRoute = "book" | "phantom"

export function loreWriteRoute(facts: {
	attachedId: number | null
	bookOwnerId: number | null
	sessionOwnerId: number
	mode: LoreWriteMode
}): LoreWriteRoute {
	if (facts.attachedId == null) return "phantom"
	if (facts.bookOwnerId !== facts.sessionOwnerId) return "phantom"
	return facts.mode === "full" ? "book" : "phantom"
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
	const phantom = await phantomLorebookFor(db, sessionId)
	return {
		route,
		lorebookId: phantom.id,
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
					eq(schema.messages.sessionId, sessionId)
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
export async function phantomAccessFor(
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
export async function purgePhantomOf(db: Db, sessionId: number): Promise<void> {
	const phantom = await phantomOf(db, sessionId)
	if (!phantom) return
	const { purgeLorebook } = await import("$lib/server/lorebooks/tableRegistry")
	await db.transaction(async (tx) => {
		await purgeLorebook(tx as unknown as Db, phantom.id)
		await tx.delete(schema.lorebooks).where(eq(schema.lorebooks.id, phantom.id))
	})
}

/**
 * A revision that overwrites (§28 `overwrite`): the notes' rows anchored to
 * the deleted messages go with them. Their `source_message_id` is a plain
 * int, so the message cascade cannot take them; this is that cascade, called
 * inside the delete's own transaction. Returns the entry ids removed.
 */
export async function retractPhantomEntriesAnchoredTo(
	tx: Db,
	sessionId: number,
	messageIds: readonly number[]
): Promise<number[]> {
	if (!messageIds.length) return []
	const [phantom] = await tx
		.select({ id: schema.lorebooks.id })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.sessionId, sessionId))
		.limit(1)
	if (!phantom) return []
	const gone = await tx
		.delete(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, phantom.id),
				inArray(schema.lorebookEntries.sourceMessageId, [...messageIds])
			)
		)
		.returning({ id: schema.lorebookEntries.id })
	return gone.map((r) => r.id)
}

/**
 * A session branch's notes (§28 "the phantom branches with it"): a copy of
 * the parent's as of the fork, inside the branch's own transaction. An entry
 * anchored after the fork stays behind; one with no anchor (written before
 * the session had a message) comes across; every anchor moves onto its
 * copied message. Only entries are copied — 🚧 the notes' links and stat
 * rows do not come across yet.
 */
export async function copyPhantomToBranch(
	tx: Db,
	input: {
		sessionId: number
		created: { id: number; name: string | null; userId: number; lorebookId: number | null; primaryRuleset: string; rulesetVersion: string | null }
		forkMessageId: number
		remap: Map<number, number>
	}
): Promise<{ lorebookId: number; entryRemap: Map<number, number> } | null> {
	const [parent] = await tx
		.select()
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.sessionId, input.sessionId))
		.limit(1)
	if (!parent) return null
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
			compendiumMode: "referenced",
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
 * **Create lorebook from session** (§26 ruling): the session's notes become
 * an ordinary lorebook — named, `session_id` and `overlay_of` cleared —
 * and the session reads it from then on.
 * Owner-only; refused for a session that already reads a lorebook (its notes
 * are a diff on that book, and resolving a diff is the review queue's, not
 * this action's). A session with no notes yet gets an empty book.
 */
export async function createLorebookFromPhantom(
	db: Db,
	input: { sessionId: number; userId: number; name?: string | null }
): Promise<{ lorebookId: number; name: string }> {
	const [session] = await db
		.select({
			userId: schema.sessions.userId,
			name: schema.sessions.name,
			lorebookId: schema.sessions.lorebookId,
			primaryRuleset: schema.sessions.primaryRuleset,
			rulesetVersion: schema.sessions.rulesetVersion,
			compendiumMode: schema.sessions.compendiumMode
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, input.sessionId))
		.limit(1)
	if (!session) throw new PhantomRefusal(CREATE_LOREBOOK_FROM_SESSION_REFUSALS.missing)
	if (session.userId !== input.userId)
		throw new PhantomRefusal(CREATE_LOREBOOK_FROM_SESSION_REFUSALS.notOwner)
	if (session.lorebookId != null)
		throw new PhantomRefusal(CREATE_LOREBOOK_FROM_SESSION_REFUSALS.attached)
	const phantom = await phantomLorebookFor(db, input.sessionId)
	const name = input.name?.trim() || session.name?.trim() || phantom.name
	await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(${phantom.id})`)
		await tx
			.update(schema.lorebooks)
			// The session's ruleset and compendium mode carry over: the
			// notes were always `referenced`, the book is what the session is.
			.set({
				name,
				sessionId: null,
				overlayOf: null,
				primaryRuleset: session.primaryRuleset,
				rulesetVersion: session.rulesetVersion,
				compendiumMode: session.compendiumMode
			})
			.where(eq(schema.lorebooks.id, phantom.id))
		await tx
			.update(schema.sessions)
			.set({ lorebookId: phantom.id, lorebookBranchId: null, updatedAt: new Date() })
			.where(eq(schema.sessions.id, input.sessionId))
	})
	return { lorebookId: phantom.id, name }
}

/** A refusal of a notes action, as a sentence a person can read. */
export class PhantomRefusal extends Error {}

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
	const phantom = await phantomOf(db, sessionId)
	if (!phantom || phantom.overlayOf == null) return []
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
		.where(and(eq(e.lorebookId, phantom.id), isNull(e.branchId)))
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
	if (!session) throw new PhantomRefusal(APPLY_OVERLAY_REFUSALS.missing)
	const bookId = session.lorebookId
	if (bookId == null) throw new PhantomRefusal(APPLY_OVERLAY_REFUSALS.noBook)
	const [book] = await db
		.select({ userId: schema.lorebooks.userId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, bookId))
		.limit(1)
	if (!book || book.userId !== input.userId)
		throw new PhantomRefusal(APPLY_OVERLAY_REFUSALS.notOwner)
	const items = await overlayItemsOf(db, input.sessionId)
	const wanted = input.entryIds ? new Set(input.entryIds) : null
	const chosen = items.filter((i) => !wanted || wanted.has(i.entryId))
	if (!chosen.length) return { lorebookId: bookId, applied: [] }
	const phantom = (await phantomOf(db, input.sessionId))!
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
				.where(and(eq(e.id, item.entryId), eq(e.lorebookId, phantom.id)))
				.limit(1)
			if (!row) continue
			// A parent left behind in the notes is no parent in the book.
			const parentMoves =
				row.anchorEntryId == null ||
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
			.where(eq(r.lorebookId, phantom.id))
		const stillNotes = new Set(
			(
				await tx
					.select({ id: e.id })
					.from(e)
					.where(eq(e.lorebookId, phantom.id))
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
	if (books.phantomId != null)
		for (const entry of await entriesAsRead(db, books.phantomId, MAIN_HEAD, sight, typeIds, entryIds))
			out.push({ ...entry, sessionOnly: true })
	return out
}
