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

import { isFileableEntryType } from "$lib/shared/entries/types"
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
 * ⚠ Five refusals and each is its own rule: a row whose type declares no
 * `parent` field role is never filed at all — a place (places plan B2,
 * 2026-09-29), asked of the role map, never of a type id — an entry is not
 * inside itself, a ring is a tree nothing can draw, a scene is not an entry —
 * the column names a `lorebook_entries` row, so a scene could never hold one
 * — and a row is never filed under another LINE's own entry. `anchor_entry_id`
 * cascades, so a shared entry under a branch-only parent would be deleted
 * with the branch (the server refuses it too: `assertAnchorEntry`).
 *
 * `newRowBranchId` is the line a row being written will land on (a subject
 * of `null`); omitted, that check is left to the server. A row being written
 * has no pool kind to ask, so its type is the picker's to check
 * (`PartOfField` is not shown for a type that is never filed).
 */
export function canFileUnder(
	subjectKey: string | null,
	targetKey: string | null,
	pool: readonly PoolItem[],
	newRowBranchId?: number | null
): boolean {
	if (targetKey === null) return true
	const target = pool.find((item) => item.key === targetKey)
	if (!target || target.kind === SCENE_KIND) return false
	const targetLine = target.branchId ?? null
	if (!subjectKey) {
		if (newRowBranchId === undefined || targetLine === null) return true
		return targetLine === (newRowBranchId ?? null)
	}
	if (targetKey === subjectKey) return false
	const subject = pool.find((item) => item.key === subjectKey)
	if (subject && !isFileableEntryType(subject.kind)) return false
	if (targetLine !== null && targetLine !== (subject?.branchId ?? null))
		return false
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
	pool: readonly PoolItem[],
	newRowBranchId?: number | null
): PoolItem[] {
	return pool.filter(
		(item) =>
			item.kind !== SCENE_KIND &&
			item.key !== subjectKey &&
			canFileUnder(subjectKey, item.key, pool, newRowBranchId)
	)
}

/**
 * How many entries a delete of this one takes with it — the whole subtree.
 *
 * ⚠ Every level, not only the rows filed directly under it: the anchor
 * cascade follows `anchorEntryId` all the way down, so a warning that counts
 * children alone promises less than the delete does. Scenes are left out —
 * a scene hangs off its history entry through a different column, one the
 * anchor cascade does not follow.
 */
export function descendantCount(
	subjectKey: string,
	pool: readonly PoolItem[]
): number {
	const kindOf = new Map(pool.map((item) => [item.key, item.kind]))
	let n = 0
	for (const key of descendantKeys(subjectKey, pool))
		if (kindOf.get(key) !== SCENE_KIND) n++
	return n
}

/**
 * What the delete confirmation says.
 *
 * The delete cascades, so a parent takes everything under it; the count is
 * stated before the question rather than discovered afterwards.
 *
 * `everyLine`: the entry is shared by every line of the story (it has no
 * branch of its own) and the reader is on a fork. A delete is still global,
 * so the sentence says so, and names the line-only alternative.
 */
export function deleteWarning(
	contains: number,
	opts: { everyLine?: boolean } = {}
): string {
	const parts: string[] = []
	if (contains > 0)
		parts.push(
			`Contains ${contains} ${contains === 1 ? "entry" : "entries"}. ` +
				`Deleting this deletes them too, and that cannot be undone.`
		)
	else
		parts.push(
			"Are you sure you want to delete this lorebook entry? This action cannot be undone."
		)
	if (opts.everyLine)
		parts.push(
			"This entry is shared by every line of the story, so deleting it removes it from every line, not only this one. " +
				"To take it out of this line alone, use Off for a while in the entry's menu instead."
		)
	return parts.join(" ")
}
