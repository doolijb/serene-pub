/**
 * 🚧 **Notes shown** — how a session's notes (its own book, `lorebooks.session_id`
 * set) are named and listed wherever they would otherwise pass for a lorebook.
 *
 * Why: the owner's rulings of 2026-11-13 — a session's notes are a property of
 * the session, never shown by the stored `lorebooks.name`, and the Lorebooks
 * view lists only notes with something in them.
 *
 * Owns: the two read-only answers, *what is this book called to a person*
 * (`bookShownName`, `bookShownNames`) and *which notes hold something*
 * (`writtenNotesOf`). It writes nothing and never touches `lorebooks.name`.
 * Does not own: the words (`$lib/shared/lorebooks/sessionNotes`), the notes'
 * lifecycle (`ownBook.ts`), or what any caller does with the answer.
 *
 * ## The written rule — "list notes unless they are empty"
 *
 * Notes are **unwritten** only when they hold nothing beyond the base versions
 * of cast members that a seat points at (`session_characters.cast_member_id`,
 * `session_personas.cast_member_id`; a seat mints exactly that and no other row
 * into notes). They are **written** when any of these holds:
 *
 * - a `lorebook_entries` row (places and history days are entries);
 * - an `entry_amendments`, `cast_amendments` or `cast_presences` row;
 * - a `narrative_relationships`, `scenes`, `lore_imprints`, `lore_sources`,
 *   `lorebook_branches`, `binding_merge_logs` or `dismissed_duplicate_pairs` row;
 * - a world value kept in them: a non-empty `lorebooks.annex`, an
 *   `attribute_values` / `attribute_configs` row owned by the book or by one of
 *   its members, or `extra_json.ruleFed` (the places' overlay);
 * - a story clock set (any `story_clock_*` column);
 * - a member no seat points at, or an overlay row (`overlay_of`);
 * - a member version beyond its base (dated, on a line, with a life point, from
 *   a session, retired, or with an author — a seat's base has none).
 *
 * Counted as bookkeeping, never as written: `sessions.lorebook_id`,
 * `lorebook_tags`, `lorebook_shares`, `binding_suggestions` (a scan derived
 * from entries and messages), `characters.lorebook_id` (a property of a card).
 */

import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import type { SQL } from "drizzle-orm"
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import { sessionNotesName } from "$lib/shared/lorebooks/sessionNotes"

/** 🚧 A real book's own name; a notes book's *‹session›'s notes* by the session's name now. */
export async function bookShownName(
	db: Db,
	book: { name: string; sessionId: number | null }
): Promise<string> {
	if (book.sessionId == null) return book.name
	const [session] = await db
		.select({ name: schema.sessions.name })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, book.sessionId))
		.limit(1)
	return sessionNotesName(session?.name)
}

/** 🚧 {@link bookShownName} for a list: one query on `sessions` for every notes book. */
export async function bookShownNames(
	db: Db,
	books: readonly { id: number; name: string; sessionId: number | null }[]
): Promise<Map<number, string>> {
	const sessionIds = [
		...new Set(
			books.flatMap((b) => (b.sessionId != null ? [b.sessionId] : []))
		)
	]
	const names = new Map<number, string | null>()
	if (sessionIds.length > 0) {
		const rows = await db
			.select({ id: schema.sessions.id, name: schema.sessions.name })
			.from(schema.sessions)
			.where(inArray(schema.sessions.id, sessionIds))
		for (const r of rows) names.set(r.id, r.name)
	}
	return new Map(
		books.map((b) => [
			b.id,
			b.sessionId == null
				? b.name
				: sessionNotesName(names.get(b.sessionId))
		])
	)
}

/** 🚧 The ids among `lorebookIds` whose notes are written (see the rule above); empty for no ids. */
export async function writtenNotesOf(
	db: Db,
	lorebookIds: readonly number[]
): Promise<Set<number>> {
	const written = new Set<number>()
	const ids = [...new Set(lorebookIds)]
	if (ids.length === 0) return written
	const addAll = (rows: { lorebookId: number }[]) => {
		for (const r of rows) written.add(r.lorebookId)
	}
	const byBook = async (
		table: PgTable & { lorebookId: AnyPgColumn },
		/** Rows this read leaves out. */
		also?: SQL
	) => {
		const rows = await db
			.selectDistinct({ lorebookId: table.lorebookId })
			.from(table)
			.where(and(inArray(table.lorebookId, ids), also))
		for (const r of rows)
			if (r.lorebookId != null) written.add(r.lorebookId as number)
	}

	await byBook(schema.lorebookEntries)
	await byBook(schema.entryAmendments)
	await byBook(schema.castAmendments)
	await byBook(schema.castPresences)
	// A knowledge tie is the person's note on an entry, not a link: it does not make the notes written.
	await byBook(
		schema.narrativeRelationships,
		isNull(schema.narrativeRelationships.knowledgeKind)
	)
	await byBook(schema.scenes)
	await byBook(schema.loreImprints)
	await byBook(schema.loreSources)
	await byBook(schema.lorebookBranches)
	await byBook(schema.bindingMergeLogs)
	await byBook(schema.dismissedDuplicatePairs)

	// The book's own columns: annex, rule-fed overlay, story clock.
	const L = schema.lorebooks
	const own = await db
		.select({ id: L.id })
		.from(L)
		.where(
			and(
				inArray(L.id, ids),
				or(
					sql`${L.annex} <> '{}'::jsonb`,
					sql`jsonb_exists(${L.extraJson}::jsonb, 'ruleFed')`,
					isNotNull(L.storyClockYear),
					isNotNull(L.storyClockMonth),
					isNotNull(L.storyClockDay),
					isNotNull(L.storyClockHour),
					isNotNull(L.storyClockMinute)
				)
			)
		)
	for (const r of own) written.add(r.id)

	// Members: an overlay row, or one no seat points at.
	const B = schema.lorebookBindings
	const members = await db
		.selectDistinct({ lorebookId: B.lorebookId })
		.from(B)
		.where(
			and(
				inArray(B.lorebookId, ids),
				or(
					isNotNull(B.overlayOf),
					sql`NOT EXISTS (SELECT 1 FROM ${schema.sessionCharacters} sc WHERE sc.cast_member_id = ${B.id})
						AND NOT EXISTS (SELECT 1 FROM ${schema.sessionPersonas} sp WHERE sp.cast_member_id = ${B.id})`
				)
			)
		)
	addAll(members)

	// Member versions beyond a seat's base.
	const V = schema.characterVersions
	const versions = await db
		.selectDistinct({ lorebookId: V.lorebookId })
		.from(V)
		.where(
			and(
				inArray(V.lorebookId, ids),
				isNotNull(V.castMemberId),
				or(
					isNotNull(V.branchId),
					isNotNull(V.year),
					isNotNull(V.personalPosition),
					isNotNull(V.sourceSessionId),
					isNotNull(V.retiredOrder),
					isNotNull(V.writtenBy),
					// A person's edit of a seated member's base version
					// stamps nothing else: the row was written after it was made.
					sql`${V.updatedAt} > ${V.createdAt}`
				)
			)
		)
	for (const r of versions)
		if (r.lorebookId != null) written.add(r.lorebookId)

	// World values: owned by the book or by one of its members.
	for (const table of [schema.attributeValues, schema.attributeConfigs]) {
		const owned = await db
			.select({ ownerId: table.ownerId })
			.from(table)
			.where(
				and(
					eq(table.ownerKind, "lorebook"),
					inArray(table.ownerId, ids)
				)
			)
		for (const r of owned) written.add(r.ownerId)
		const ofMembers = await db
			.selectDistinct({ lorebookId: B.lorebookId })
			.from(table)
			.innerJoin(B, eq(B.id, table.ownerId))
			.where(
				and(
					eq(table.ownerKind, "cast_member"),
					inArray(B.lorebookId, ids)
				)
			)
		addAll(ofMembers)
	}
	return written
}
