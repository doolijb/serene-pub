/**
 * 🚧 The arithmetic of the Knows tab: which entries are tied to the member,
 * which are not, and how many the member knows. Pure, so the zones are tested
 * without a screen.
 */

type Row = Sockets.EntryKnowledge.Row

/** One entry of the book: all the pool needs of it. */
export interface PoolEntry {
	id: number
	name: string
	typeId: string
}

export interface TiedRow {
	row: Row
	name: string
	/** Null for an entry this book does not hold: drawn as Untitled, with no type. */
	typeId: string | null
}

export interface OtherEntry {
	entry: PoolEntry
	marked: boolean
}

export const UNTITLED = "Untitled"

const byName = (a: string, b: string) =>
	a.localeCompare(b, undefined, { sensitivity: "base" })

/** Rows with a winning tie or a hand tie, by entry name. */
export function tiedRows(rows: Row[], entries: PoolEntry[]): TiedRow[] {
	const byId = new Map(entries.map((e) => [e.id, e]))
	return rows
		.filter((r) => r.winner !== null || r.hand !== null)
		.map((row) => {
			const entry = byId.get(row.entryId)
			return {
				row,
				name: entry?.name?.trim() ? entry.name : UNTITLED,
				typeId: entry?.typeId ?? null
			}
		})
		.sort((a, b) => byName(a.name, b.name) || a.row.entryId - b.row.entryId)
}

/**
 * The entries not in the Tied zone: marked first, then the rest, each by
 * name. The filter narrows only this zone.
 */
export function otherEntries(
	rows: Row[],
	entries: PoolEntry[],
	isMarked: (entryId: number) => boolean,
	filter: string
): OtherEntry[] {
	const tied = new Set(tiedRows(rows, entries).map((t) => t.row.entryId))
	const needle = filter.trim().toLowerCase()
	return entries
		.filter((e) => !tied.has(e.id))
		.filter((e) => !needle || e.name.toLowerCase().includes(needle))
		.map((entry) => ({ entry, marked: isMarked(entry.id) }))
		.sort(
			(a, b) =>
				Number(b.marked) - Number(a.marked) ||
				byName(a.entry.name, b.entry.name) ||
				a.entry.id - b.entry.id
		)
}

/** How many entries the member knows by a tie (the Known by count's rule). */
export function knowsCount(rows: Row[]): number {
	return rows.filter(
		(r) => r.known && r.winner && r.winner.kind !== "kept_from"
	).length
}
