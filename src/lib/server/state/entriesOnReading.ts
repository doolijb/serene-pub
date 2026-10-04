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
 * ⚠ A cast amendment may draw the member with another card (`characterId`,
 * a **dated card**). A session SEAT holds a card — the member's own, or a
 * dated one; `cardMemberAt` finds the member by either (plan A25) — so a
 * reader that keys seats, privacy or state owners on a card keeps the
 * member's own `characterId` (`castMemberAt(..., { keepCard: true })`) and
 * finds a dated card through `castMemberCards`. Only a reader that DRAWS the
 * member (sprites) follows the dated card.
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
import { MAIN_LINE, amendmentsOnLine } from "$lib/shared/lorebooks/lineReading"
import { answeringRows, keyTerms } from "$lib/shared/lorebooks/describingRow"
import {
	whyUnseen,
	type PlaceSight,
	type UnseenReason
} from "$lib/shared/lorebooks/placeSight"
import { historyDateColumns, onLineAtSql, onLineSql } from "./lineSql"
import { lineOfReading, sessionReadingOf, type LineReading } from "./reading"

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

/**
 * The amendment that decides `field` of this entry where the reading stands —
 * the last one, in the order the resolver applies them (`amendmentsOnLine`),
 * that sets it — or null when the base row decides it. What a write to the
 * base names when it does not show at this reading (plan A14: `heldBy`).
 */
export function amendmentDeciding(
	overlays: ReadonlyMap<number, readonly Amendment[]>,
	entryId: number,
	field: string,
	reading: EntryReading
): Amendment | null {
	let decides: Amendment | null = null
	for (const a of amendmentsOnLine(overlays.get(entryId) ?? [], lineOfReading(reading), reading.moment))
		if (Object.prototype.hasOwnProperty.call(a.fields, field)) decides = a
	return decides
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
 * The member-keyed, synchronous entry point to the one cast resolver
 * (`castAsOf`); its card-keyed twin, which also reads presences and answers
 * each appearance, is `cardMemberAt` (`sockets/amendments.ts`). Two entry
 * points, one resolver — see there.
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
 * One entry as a reading has it: its id and type, its name and keys as the
 * line's amendments leave them by the moment, and — when the looker does not
 * see it — why (`whyUnseen`: the entry's own marks, or a dated change).
 */
export interface EntryAsRead {
	entryId: number
	typeId: string
	name: string
	keys: string[]
	unseen: UnseenReason | null
}

/**
 * The book's entries on a reading, each as `sight` has it (plan A27): rows on
 * the reading's line at its moment, each resolved with the line's amendments
 * by then and marked with the reason `sight` does not see it, when it does
 * not. Entry order. `typeIds` narrows to those entry types (null: every
 * type); `entryIds` narrows the read (a door asking about one entry). An
 * empty list of either reads nothing.
 */
export async function entriesAsRead(
	db: Db,
	lorebookId: number,
	reading: EntryReading,
	sight: PlaceSight,
	typeIds: readonly string[] | null,
	entryIds?: readonly number[]
): Promise<EntryAsRead[]> {
	if ((entryIds && entryIds.length === 0) || typeIds?.length === 0) return []
	const e = schema.lorebookEntries
	const rows = await db
		.select({
			id: e.id,
			typeId: e.typeId,
			title: e.title,
			keys: e.keys,
			enabled: e.enabled,
			archived: e.archived
		})
		.from(e)
		.where(
			and(
				eq(e.lorebookId, lorebookId),
				typeIds ? inArray(e.typeId, [...typeIds]) : undefined,
				entryOnReadingSql(reading),
				entryIds ? inArray(e.id, [...entryIds]) : undefined
			)
		)
		.orderBy(asc(e.id))
	if (!rows.length) return []
	// Narrowed as the rows were: a read of the whole book loads the line's
	// amendments whole rather than binding one id per entry.
	const overlays = await entryOverlaysFor(db, lorebookId, reading, entryIds)
	return rows.map((r) => {
		// The wire row (`name`, `keys`), which is what an amendment overlays.
		const seen = entryAt(
			{
				id: r.id,
				name: r.title ?? "",
				keys: r.keys ?? [],
				enabled: r.enabled,
				archived: r.archived
			},
			overlays,
			reading
		)
		return {
			entryId: r.id,
			typeId: r.typeId,
			name: typeof seen.name === "string" ? seen.name : "",
			keys: keyTerms(seen.keys),
			unseen: whyUnseen(r, seen, sight)
		}
	})
}

/**
 * The book's places on a reading, as `sight` sees them — the one definition
 * of "which places are there" (plan A27; `shared/lorebooks/placeSight.ts`).
 * A session's readers (`resolve.ts locationsOf`, so its prompt, its State
 * widget and every `state:*` reply; the place owner door) ask with
 * `"session"`; the book's own pages (`lorebookState.lorebookLinks`: the place
 * editor's stats, a pipeline reading the book) and what the book keeps of a
 * place out of the story (item supply, the delete safeguard, the ledger's
 * names) with `"book"`. Titled as amended by the moment, in entry order.
 */
export async function placesOnReading(
	db: Db,
	lorebookId: number,
	reading: EntryReading,
	sight: PlaceSight,
	entryIds?: readonly number[]
): Promise<{ entryId: number; name: string }[]> {
	return (await entriesAsRead(db, lorebookId, reading, sight, [LOCATION_TYPE_ID], entryIds))
		.filter((p) => !p.unseen)
		.map(({ entryId, name }) => ({ entryId, name }))
}

/**
 * What a name finds among entries as a reading has them, by the rooms' own
 * name rule (`answeringRows`: the name exactly, then a looser spelling with a
 * leading "the" aside, then a key) — the rule Answer the door and
 * `{{locationEntry}}` find a room by, so a model's "the guardroom" is the
 * room the prompt shows as "Guardroom":
 *
 * - `one` — one entry the looker sees answers;
 * - `tie` — several it sees answer alike (two rooms called the same, or
 *   sharing a key): their names, in entry order. Every door refuses it —
 *   taking the first would put a change on the wrong room without a word;
 * - `unseen` — none it sees answers, but one it does not see does (switched
 *   off, archived): that entry and why. Every door refuses it — the words
 *   name a room out of the story, and kept as words they would put the
 *   party there anyway;
 * - `none` — nothing answers.
 */
export type NamedEntry =
	| { kind: "one"; entryId: number }
	| { kind: "tie"; names: string[] }
	| { kind: "unseen"; entryId: number; name: string; why: UnseenReason }
	| { kind: "none" }

/** `NamedEntry` for `name` among `entries` (from `entriesAsRead`). Pure. */
export function entryNamed(name: string, entries: readonly EntryAsRead[]): NamedEntry {
	if (!name.trim()) return { kind: "none" }
	const rowsOf = (list: readonly EntryAsRead[]) =>
		list.map((entry) => ({ name: entry.name, keys: entry.keys, entry }))
	const answering = (list: readonly EntryAsRead[]) =>
		(answeringRows(name, rowsOf(list)) as { entry: EntryAsRead }[]).map((r) => r.entry)
	const seen = answering(entries.filter((p) => !p.unseen))
	if (seen.length === 1) return { kind: "one", entryId: seen[0]!.entryId }
	if (seen.length > 1) return { kind: "tie", names: seen.map((p) => p.name) }
	const [hidden] = answering(entries.filter((p) => p.unseen))
	return hidden?.unseen
		? { kind: "unseen", entryId: hidden.entryId, name: hidden.name, why: hidden.unseen }
		: { kind: "none" }
}

/**
 * The place a session's words name (`entryNamed` over the book's places as
 * the session reads them). Read by every door that turns a model's words
 * into a place: a value on a slot that may point at one
 * (`write.ts loreRefNamed`) and a change's owner (`tools/stateTools.ts
 * ownerFor`). `none` when the session has no book.
 */
export async function sessionPlaceNamed(
	db: Db,
	sessionId: number,
	name: string
): Promise<NamedEntry> {
	return await sessionEntryNamed(db, sessionId, [LOCATION_TYPE_ID], name)
}

/**
 * `sessionPlaceNamed` for a slot that may point at other entry types too
 * (`SlotConfig.entryTypes`): the same sight, the same name rule, over the
 * entries of `typeIds` (bare ids, `core:entry/location`).
 */
export async function sessionEntryNamed(
	db: Db,
	sessionId: number,
	typeIds: readonly string[],
	name: string
): Promise<NamedEntry> {
	if (!name.trim()) return { kind: "none" }
	const reading = await sessionReadingOf(db, sessionId)
	if (!reading) return { kind: "none" }
	return entryNamed(
		name,
		await entriesAsRead(db, reading.lorebookId, reading, "session", typeIds)
	)
}
