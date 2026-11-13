import {
	castAsOf,
	type Amendment,
	type AsOf,
	type LineAmendment
} from "$lib/shared/lorebooks/amendments"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
import type { Line } from "$lib/shared/lorebooks/lineReading"

/**
 * Reading a cast member at a moment, from their VERSIONS (lane cv-member2, B2).
 *
 * The server sends each member's row as the version in force at the book's
 * present on main ("the most recently active", owner 2026-11-06), plus
 * `baseColumns` (what the member reads before its first change). Each Changes
 * row carries `columns`: its whole version. A reading is the base with the
 * rows that apply folded over it — whole versions, never diffs, so a link or
 * an unlink at a present reads the same here as in the prompt.
 */

/** A Changes row as the fold needs it: the whole version, with its date. */
export type CastVersionOverlay = Pick<
	LineAmendment,
	"id" | "branchId" | "year" | "month" | "day"
> & {
	personalPosition?: number | null
	columns?: object | null
	/** What changed from the version before (the Changes list's words); the row-owned keys fold from here. */
	fields?: Record<string, unknown> | null
}

/** Where a member is read, and the book's present on main. */
export interface CastReadAt {
	/** The moment being read; null = now. */
	moment?: StoryDate | null
	line: Line
}

/**
 * The moment the fold reads at. A moment being read is that moment; "now" on
 * MAIN is the book's present (so a change dated after it does not apply, and
 * the result is the row the server sent); "now" on a branch has no cap.
 * Only the fold uses this: the UI's moment stays null at "now".
 */
export function foldMoment(
	at: CastReadAt,
	present: StoryDate | null
): StoryDate | null {
	if (at.moment) return at.moment
	return at.line.branchId == null ? present : null
}

/**
 * A member as they read: the row with its base version put back, then every
 * Changes row that applies on the line folded over it.
 *
 * ⚠ A carded version's `name` is null and never overwrites the row's name;
 * only a card-less version's own name applies. The row's `aliases` are the
 * binding's own (the server keeps them so, the card's names merged in): the
 * base never overwrites them, and a Changes row applies them only where it
 * changed them (`fields`), as the diff fold did.
 */
export function readCastVersion<T extends { baseColumns?: object | null }>(
	row: T,
	overlays: readonly CastVersionOverlay[],
	at: CastReadAt,
	present: StoryDate | null
): T {
	const base = withBaseVersion(row)
	if (!overlays.length) return base
	const asOf: AsOf = { moment: foldMoment(at, present), line: at.line }
	return castAsOf(base, asVersionAmendments(overlays), asOf)
}

/** The row with its base version put back (the row as it is when it has none). */
export function withBaseVersion<T extends { baseColumns?: object | null }>(
	row: T
): T {
	return row.baseColumns
		? ({ ...row, ...versionColumns(row.baseColumns) } as T)
		: row
}

/**
 * Changes rows as amendments whose `fields` are the whole version (the
 * row-owned keys only where the row changed them) — what `castAsOf` and
 * `compareLines` fold over `withBaseVersion(row)`.
 */
export function asVersionAmendments(
	overlays: readonly CastVersionOverlay[]
): Amendment[] {
	return overlays.map((o) => ({
		id: o.id,
		branchId: o.branchId,
		year: o.year,
		month: o.month,
		day: o.day,
		fields: {
			...versionColumns(o.columns ?? {}),
			...rowOwnedChanges(o.fields)
		}
	}))
}

/** Keys the binding row owns: never taken whole from a version. */
const ROW_OWNED = ["aliases"] as const

/** A version's columns minus the row-owned keys, and minus a carded version's null name. */
function versionColumns(columns: object): Record<string, unknown> {
	const out = { ...(columns as Record<string, unknown>) }
	for (const key of ROW_OWNED) delete out[key]
	if (out.name === null) delete out.name
	return out
}

/** The row-owned keys a Changes row changed. */
function rowOwnedChanges(
	fields: Record<string, unknown> | null | undefined
): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const key of ROW_OWNED)
		if (fields && key in fields) out[key] = fields[key]
	return out
}

/**
 * The member as it will stand after a base save of `fields`: the save writes
 * the version shown (`castVersionId`) — the base version, or the Changes row
 * of that id — so the write goes there before the member is read again.
 * Answers what a base save would still read differently at the moment
 * being read (#113).
 */
export function afterBaseWrite<
	T extends {
		castVersionId?: number | null
		baseColumns?: object | null
	}
>(
	row: T,
	overlays: readonly CastVersionOverlay[],
	fields: Record<string, unknown>
): { row: T; overlays: CastVersionOverlay[] } {
	const intoRow = overlays.some((o) => o.id === row.castVersionId)
	return {
		row: {
			...row,
			...fields,
			baseColumns:
				intoRow || !row.baseColumns
					? row.baseColumns
					: { ...row.baseColumns, ...fields }
		},
		overlays: intoRow
			? overlays.map((o) =>
					o.id === row.castVersionId
						? { ...o, columns: { ...(o.columns ?? {}), ...fields } }
						: o
				)
			: [...overlays]
	}
}
