/**
 * 🚧 The member push (`sessions:refresh`, pr-6 ledger A1), the session store's: folded into the rows the session page
 * holds — never a replace, so the page keeps its pagination and an in-flight "load older".
 */

/** One row as the merge reads it: its id, and its channel as stored (`null` reads as "main"). */
export interface MergeableRow {
	id: number
	channel?: string | null
}

/**
 * The page's rows with a push folded in. Pure: returns a NEW array, ascending by id, and never
 * mutates `page` or `pushed`.
 * - `floor` = the smallest id in `page`; with `page` empty, every pushed row is taken.
 * - A pushed row with id ≥ floor replaces the page's row of that id, or is added.
 * - A pushed row with id < floor is NOT taken: it belongs to a page not loaded yet.
 * - A page row with id ≥ `coversFromId` (null = every row) that `pushed` does not hold is dropped:
 *   the push holds every live row the member reads from there on, so absence = taken back or deleted.
 * - A page row with id < `coversFromId` is kept as it is.
 */
export function mergeRefreshedRows<R extends MergeableRow>(
	page: readonly R[],
	pushed: readonly R[],
	coversFromId: number | null
): R[] {
	const pushedById = new Map<number, R>()
	for (const r of pushed) pushedById.set(r.id, r)
	let floor = -Infinity
	if (page.length) {
		floor = Infinity
		for (const r of page) if (r.id < floor) floor = r.id
	}
	const cover = coversFromId ?? -Infinity
	const out: R[] = []
	const kept = new Set<number>()
	for (const r of page) {
		if (pushedById.has(r.id)) {
			out.push(pushedById.get(r.id)!)
			kept.add(r.id)
		} else if (r.id < cover) {
			out.push(r)
			kept.add(r.id)
		}
	}
	for (const r of pushedById.values()) {
		if (r.id >= floor && !kept.has(r.id)) out.push(r)
	}
	return out.sort((a, b) => a.id - b.id)
}
