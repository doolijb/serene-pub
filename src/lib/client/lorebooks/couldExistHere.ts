/**
 * 🚧 **Could exist here** (owner, 2026-11-13/14): the entries of lines forked
 * from the line being read, at any depth, which the list's group shows muted.
 * Never a sibling line's entries. Entries that begin later stay in the list
 * body, where they gain their cause line (`couldExistWhy`) and **Read from**.
 * Pure.
 */
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { lineOf, type LineBranch } from "$lib/shared/lorebooks/lineReading"
import {
	moveDownProblems,
	moveDownSentence,
	takenAlong,
	type MoveDownWords,
	type TreeRow
} from "$lib/shared/lorebooks/moveDownTheTree"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"

/** The lines forked from `branchId` at any depth: never itself, never a sibling; main = every line. In `branches` order. */
export function linesForkedFrom(
	branchId: number | null,
	branches: readonly LineBranch[]
): number[] {
	return branches
		.filter((b) =>
			lineOf(b.id, branches)
				.steps.slice(1)
				.some((s) => s.branchId === branchId)
		)
		.map((b) => b.id)
}

/** The stored rows on lines forked from the line being read, of `kinds` (null = every kind held), never History. */
export function forkedLineRows<
	R extends { typeId: string; branchId?: number | null }
>(input: {
	rawRows: Readonly<Record<string, readonly R[]>>
	kinds: readonly string[] | null
	line: number | null
	branches: readonly LineBranch[]
}): R[] {
	const forked = new Set(linesForkedFrom(input.line, input.branches))
	const out: R[] = []
	for (const [kind, rows] of Object.entries(input.rawRows)) {
		if (kind === HISTORY_TYPE_ID) continue
		if (input.kinds && !input.kinds.includes(kind)) continue
		for (const row of rows)
			if (
				row.typeId !== HISTORY_TYPE_ID &&
				forked.has(row.branchId as number)
			)
				out.push(row)
	}
	return out
}

export type CouldExistReason =
	| { kind: "line"; branchId: number }
	| { kind: "later"; date: StoryDate }

/** The few words that say why a row is not read here. */
export function couldExistWhy(
	reason: CouldExistReason,
	words: {
		lineName: (id: number | null) => string
		date: (d: StoryDate) => string
	}
): string {
	return reason.kind === "line"
		? `On ${words.lineName(reason.branchId)}`
		: `Begins in ${words.date(reason.date)}`
}

/**
 * Why the entry cannot be moved down the tree to `target` (the line being read), or null when it can:
 * the dialog's own rule; the entries taken along with it on its line move with it.
 */
export function moveHereProblem(input: {
	id: number
	rows: readonly TreeRow[]
	target: number | null
	branches: readonly LineBranch[]
	words: MoveDownWords
}): string | null {
	const { id, rows, target, branches, words } = input
	const row = rows.find((r) => r.id === id)
	if (!row) return null
	const along =
		row.branchId == null
			? []
			: takenAlong([id], rows, row.branchId).map((a) => a.row.id)
	const p = moveDownProblems({
		ids: [id, ...along],
		rows,
		target,
		branches
	})[0]
	return p ? moveDownSentence(p, words) : null
}
