/**
 * Where an entry is filed — the `anchorEntryId` write, as arithmetic.
 *
 * One parent, and null is the top level. The picker and the drag both ask the
 * same two questions of the pool the list already holds: which rows may hold
 * this one, and what goes with it if it is deleted. Pure, because both are
 * rules about the pool rather than about a component, and because the refusal
 * below is the client half of a refusal the server makes too — a move it would
 * reject must never be offered.
 */

import { SCENE_KIND, type PoolItem } from "../poolFilter"

/**
 * Every row inside this one, however deep.
 *
 * Walked with a seen-set, so a ring in the anchors ends the walk instead of
 * spinning: the pool can hold one, and the tree draws it as roots.
 */
export function descendantKeys(
	subjectKey: string,
	pool: readonly PoolItem[]
): Set<string> {
	const out = new Set<string>()
	const frontier = [subjectKey]
	while (frontier.length) {
		const key = frontier.pop()!
		for (const item of pool) {
			if (item.parentKey !== key) continue
			if (item.key === subjectKey || out.has(item.key)) continue
			out.add(item.key)
			frontier.push(item.key)
		}
	}
	return out
}

/**
 * The entries filed directly under this one, in list order.
 *
 * ⚠ Entries only. A scene hangs off the history entry it was compiled into,
 * which is a different relation in a different column; counting one here would
 * put a row in Contains that `anchorEntryId` never filed.
 */
export function containedBy(
	subjectKey: string,
	pool: readonly PoolItem[]
): PoolItem[] {
	return pool.filter(
		(item) =>
			item.kind !== SCENE_KIND &&
			item.key !== subjectKey &&
			item.parentKey === subjectKey
	)
}

/**
 * Whether a row may be filed under a target.
 *
 * ⚠ Three refusals and each is its own rule: an entry is not inside itself, a
 * ring is a tree nothing can draw, and a scene is not an entry — the column
 * names a `lorebook_entries` row, so a scene could never hold one.
 */
export function canFileUnder(
	subjectKey: string | null,
	targetKey: string | null,
	pool: readonly PoolItem[]
): boolean {
	if (targetKey === null) return true
	const target = pool.find((item) => item.key === targetKey)
	if (!target || target.kind === SCENE_KIND) return false
	if (!subjectKey) return true
	if (targetKey === subjectKey) return false
	return !descendantKeys(subjectKey, pool).has(targetKey)
}

/**
 * The rows the picker offers, in list order.
 *
 * A subject of `null` is a row being written, which is inside nothing and may
 * therefore go anywhere.
 */
export function anchorCandidates(
	subjectKey: string | null,
	pool: readonly PoolItem[]
): PoolItem[] {
	return pool.filter(
		(item) =>
			item.kind !== SCENE_KIND &&
			item.key !== subjectKey &&
			canFileUnder(subjectKey, item.key, pool)
	)
}

/**
 * What the delete confirmation says.
 *
 * The delete cascades, so a parent takes everything under it; the count is
 * stated before the question rather than discovered afterwards.
 */
export function deleteWarning(contains: number): string {
	const base =
		"Are you sure you want to delete this lorebook entry? This action cannot be undone."
	if (contains <= 0) return base
	return (
		`Contains ${contains} ${contains === 1 ? "entry" : "entries"}. ` +
		`Deleting this deletes them too, and that cannot be undone.`
	)
}
