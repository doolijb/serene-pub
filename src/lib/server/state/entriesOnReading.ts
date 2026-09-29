/**
 * The book's entries and cast members **as a reading sees them** — the one
 * server path every session-side reader of lore goes through.
 *
 * A reading (`./reading.ts`) is a line and a moment. Reading an entry at one
 * is two steps, and a reader that does only the first reads the wrong book:
 *
 * 1. **Which rows** — shared rows plus the rows of the line's ancestor chain,
 *    each dated row cut at the earlier of the moment and its step's fork date
 *    (`entryOnReadingSql`, the SQL form of `rowReadsOnLine`).
 * 2. **What they say** — the base row with every entry amendment on that line
 *    that has happened by the moment applied, later winning per field
 *    (`entryAt`, the one pure resolver the workspace uses too).
 *
 * Owner ruling 3 (2026-09-28): retrieval resolves at the session's **story
 * clock** when it has one, else at the **head** of its line — which is exactly
 * what `sessionReadingOf` yields (`moment` is the clock's date, or null).
 *
 * ⚠ Amendments overlay the WIRE row (`toEntryRow`'s shape: `name`, `keys`, the
 * declared fields flat), because that is the shape the editor saves them from.
 * Resolve a wire row, never a stored one.
 *
 * ⚠ A cast amendment may swap the card (`characterId`). A session SEAT holds
 * the member's own card — `castMemberAsOf` finds the member by it — so a reader
 * that keys seats, privacy or state owners on a card keeps the member's own
 * `characterId` (`castMemberAt(..., { keepCard: true })`). Only a reader that
 * DRAWS the member (sprites) follows the swap.
 */

import { and, asc, eq, inArray, type SQL } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	castAsOf,
	entryAsOf,
	groupAmendments,
	type Amendment
} from "$lib/shared/lorebooks/amendments"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { MAIN_LINE } from "$lib/shared/lorebooks/lineReading"
import { historyDateColumns, onLineAtSql, onLineSql } from "./lineSql"
import { lineOfReading, type LineReading } from "./reading"

/** What these readers need of a reading: its line and its moment. */
export type EntryReading = Pick<LineReading, "branchId" | "moment" | "forkedAt" | "line">

/** Main at its head — the reading of a caller with no session and no line. */
export const MAIN_HEAD: EntryReading = Object.freeze({
	branchId: null,
	moment: null,
	forkedAt: null,
	line: MAIN_LINE
})

/**
 * `lorebook_entries` rows on the reading: on the chain, and — for a dated row
 * (a history entry) — dated at or before the earlier of the moment and its
 * step's fork cut. Main at its head is `branch_id IS NULL` and nothing else,
 * so a book with no branches and no clock reads exactly what it always did.
 */
export function entryOnReadingSql(reading: EntryReading): SQL {
	const e = schema.lorebookEntries
	return onLineAtSql(
		e.branchId,
		historyDateColumns(e.fields),
		lineOfReading(reading),
		reading.moment
	)
}

/**
 * Whether one stored row is on the reading's LINE — membership only, no
 * dates. For a row fetched by id, where the question is "may this line name
 * it at all", not "has it happened yet".
 */
export function entryOnLineSql(reading: EntryReading): SQL {
	return onLineSql(schema.lorebookEntries.branchId, lineOfReading(reading))
}

/**
 * The book's entry amendments on the reading's line, grouped by entry id —
 * one query. `entryIds` narrows it; an empty list reads nothing.
 *
 * Only the chain's amendments are loaded (`onLineSql`); which of them have
 * happened by the moment, and in what order, is `entryAt`'s — the shared
 * resolver's — decision, never a second copy of it here.
 */
export async function entryOverlaysFor(
	db: Db,
	lorebookId: number,
	reading: EntryReading,
	entryIds?: readonly number[]
): Promise<Map<number, Amendment[]>> {
	if (entryIds && entryIds.length === 0) return new Map()
	const a = schema.entryAmendments
	const rows = await db
		.select({
			id: a.id,
			entryId: a.entryId,
			branchId: a.branchId,
			year: a.year,
			month: a.month,
			day: a.day,
			fields: a.fields
		})
		.from(a)
		.where(
			and(
				eq(a.lorebookId, lorebookId),
				onLineSql(a.branchId, lineOfReading(reading)),
				entryIds ? inArray(a.entryId, [...entryIds]) : undefined
			)
		)
	return groupAmendments(
		rows.map((r) => ({
			id: r.id,
			entryId: r.entryId,
			branchId: r.branchId ?? null,
			year: r.year,
			month: r.month ?? null,
			day: r.day ?? null,
			fields: (r.fields ?? {}) as Record<string, unknown>
		})),
		"entryId"
	)
}

/** One wire row as the reading sees it. A row with no overlays is returned as is. */
export function entryAt<T extends { id: number }>(
	row: T,
	overlays: ReadonlyMap<number, readonly Amendment[]>,
	reading: EntryReading
): T {
	const list = overlays.get(row.id)
	if (!list?.length) return row
	return entryAsOf(row, list, {
		line: lineOfReading(reading),
		moment: reading.moment
	})
}

/** Every field name any of these overlays sets — to know which SQL filters an amendment can defeat. */
export function amendedFieldNames(
	overlays: ReadonlyMap<number, readonly Amendment[]>
): Set<string> {
	const out = new Set<string>()
	for (const list of overlays.values())
		for (const a of list) for (const key of Object.keys(a.fields)) out.add(key)
	return out
}

/** The book's cast amendments on the reading's line, grouped by member id. */
export async function castOverlaysFor(
	db: Db,
	lorebookId: number,
	reading: EntryReading
): Promise<Map<number, Amendment[]>> {
	const c = schema.castAmendments
	const rows = await db
		.select({
			id: c.id,
			memberId: c.lorebookBindingId,
			branchId: c.branchId,
			year: c.year,
			month: c.month,
			day: c.day,
			fields: c.fields
		})
		.from(c)
		.where(and(eq(c.lorebookId, lorebookId), onLineSql(c.branchId, lineOfReading(reading))))
	return groupAmendments(
		rows.map((r) => ({
			id: r.id,
			memberId: r.memberId,
			branchId: r.branchId ?? null,
			year: r.year,
			month: r.month ?? null,
			day: r.day ?? null,
			fields: (r.fields ?? {}) as Record<string, unknown>
		})),
		"memberId"
	)
}

/**
 * One cast member (a `lorebook_bindings` row) as the reading sees them — at no
 * particular point of their own life, so every overlay on the line applies
 * (`amendmentsForAppearance(…, null)`).
 *
 * `keepCard` keeps the member's own `characterId`: see the header.
 */
export function castMemberAt<T extends { id: number; characterId?: number | null }>(
	member: T,
	overlays: ReadonlyMap<number, readonly Amendment[]>,
	reading: EntryReading,
	opts: { keepCard?: boolean } = {}
): T {
	const list = overlays.get(member.id)
	if (!list?.length) return member
	const resolved = castAsOf(member, list, {
		line: lineOfReading(reading),
		moment: reading.moment
	})
	return opts.keepCard ? { ...resolved, characterId: member.characterId } : resolved
}

/**
 * The book's live places on a reading — one definition for every reader of
 * "which places are there" (`lorebookState.lorebookLinks`, a session's
 * `resolve.ts locationsOf`): `core:entry/location` rows on the reading's line, titled as
 * amended by the moment, dropping any the line has archived. Entry order.
 */
export async function placesOnReading(
	db: Db,
	lorebookId: number,
	reading: EntryReading = MAIN_HEAD
): Promise<{ entryId: number; name: string }[]> {
	const rows = await db
		.select({
			id: schema.lorebookEntries.id,
			title: schema.lorebookEntries.title,
			archived: schema.lorebookEntries.archived
		})
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				eq(schema.lorebookEntries.typeId, LOCATION_TYPE_ID),
				entryOnReadingSql(reading)
			)
		)
		.orderBy(asc(schema.lorebookEntries.id))
	if (!rows.length) return []
	const overlays = await entryOverlaysFor(
		db,
		lorebookId,
		reading,
		rows.map((r) => r.id)
	)
	const out: { entryId: number; name: string }[] = []
	for (const r of rows) {
		// The wire names (`name`), which is what an amendment overlays.
		const e = entryAt({ id: r.id, name: r.title ?? "", archived: r.archived }, overlays, reading)
		if (e.archived === true) continue
		out.push({ entryId: r.id, name: typeof e.name === "string" ? e.name : "" })
	}
	return out
}
