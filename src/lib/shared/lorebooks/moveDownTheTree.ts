/**
 * 🚧 **Move down the tree** (owner, 2026-11-13): an entry on a line moves,
 * for good, to a line that line was forked from ("down" = toward main), as far
 * as its own date allows. The one rule the server's move and the workspace's
 * dialog both read, so the two cannot disagree.
 *
 * Only the entry's `branch_id` changes. Its dated changes and links stay on
 * the line they were written on. The line it leaves, and every line forked
 * from that one, read exactly what they read before: the target is in their
 * chain, and the date rule keeps the entry's date inside each fork cut on the
 * way (`rowReadsOnLine`). Lines whose chain reaches the target with a cut the
 * date passes start reading it (`linesStartingToRead`).
 *
 * Entries filed under one another move together: a stored parent
 * (`anchor_entry_id`) is shared or on its child's own line
 * (`assertAnchorEntry`), so a moving entry takes its parents on the same line
 * with it, and every entry filed under it there.
 *
 * ⚠ Not a merge, a copy or a move up: nothing here writes a second row or
 * moves an entry away from main. History entries never move (a line keeps one
 * for each date). Pure.
 */
import {
	forkDateOf,
	lineOf,
	rowReadsOnLine,
	type LineBranch
} from "./lineReading"
import { compareDates, type StoryDate } from "./storyDate"

/** An entry as the move reads it. */
export interface TreeRow {
	id: number
	name: string
	/** History entries never move. */
	isHistory: boolean
	/** NULL = main. */
	branchId: number | null
	/** The entry it is filed under (`anchor_entry_id`), or null. */
	anchorEntryId: number | null
	/** The row's own date (`fields.year`, `month`, `day`): what a fork cut is measured against. Null = undated, never cut. */
	date: StoryDate | null
}

/** The fork whose date cuts a line off from a line below it. */
export interface ForkThatCuts {
	/** The line that left. */
	line: number
	/** The line it left. NULL = main. */
	leftFrom: number | null
	at: StoryDate
}

/** Why a move cannot be made, one per row it concerns. */
export type MoveDownProblem =
	| { kind: "onMain"; row: TreeRow }
	| { kind: "mixedLines" }
	| { kind: "notBelow"; source: number; target: number | null }
	| { kind: "history"; row: TreeRow }
	| { kind: "cut"; row: TreeRow; fork: ForkThatCuts | null }
	| { kind: "parentNotRead"; row: TreeRow; parent: TreeRow }
	| {
			kind: "leftBehind"
			row: TreeRow
			along: TreeRow
			relation: "parent" | "child"
	  }

/** The lines below `branchId`, nearest first, main last. Empty for main. */
export function linesBelow(
	branchId: number | null,
	branches: readonly LineBranch[]
): (number | null)[] {
	if (branchId == null) return []
	return lineOf(branchId, branches)
		.steps.slice(1)
		.map((s) => s.branchId)
}

/** Whether `target` is a line `source` was forked from, at any depth. */
export function isBelow(
	source: number | null,
	target: number | null,
	branches: readonly LineBranch[]
): boolean {
	return linesBelow(source, branches).includes(target)
}

/** Whether an entry dated `date` on `source` is still read by `source` once it sits on `target`. */
export function reachesBelow(
	date: StoryDate | null,
	source: number,
	target: number | null,
	branches: readonly LineBranch[]
): boolean {
	return (
		isBelow(source, target, branches) &&
		rowReadsOnLine({ branchId: target }, lineOf(source, branches), date)
	)
}

/**
 * The fork on the way from `source` down to `target` whose date is the cut: the
 * earliest fork date on the way (the nearest to `source` of equal ones). Null
 * when nothing on the way is dated, or `target` is not below `source`.
 */
export function forkThatCuts(
	source: number,
	target: number | null,
	branches: readonly LineBranch[]
): ForkThatCuts | null {
	const steps = lineOf(source, branches).steps
	const k = steps.findIndex((s, i) => i > 0 && s.branchId === target)
	if (k < 0) return null
	const byId = new Map(branches.map((b) => [b.id, b]))
	let found: ForkThatCuts | null = null
	for (let j = 0; j < k; j++) {
		const id = steps[j].branchId
		if (id == null) break
		const at = forkDateOf(byId.get(id))
		if (at && (!found || compareDates(at, found.at) < 0))
			found = { line: id, leftFrom: steps[j + 1].branchId, at }
	}
	return found
}

/** One row taken along by a move, and why. */
export interface TakenAlong {
	row: TreeRow
	/** `parent`: an asked entry is filed under it; `child`: it is filed under a moving entry. */
	as: "parent" | "child"
}

/**
 * The entries of `source` that must move with `ids`: the parents on `source`
 * of every moving entry, and every entry filed under a moving one there, in
 * turn, until nothing more is added. `ids` themselves are not listed.
 */
export function takenAlong(
	ids: readonly number[],
	rows: readonly TreeRow[],
	source: number
): TakenAlong[] {
	const byId = new Map(rows.map((r) => [r.id, r]))
	const moving = new Set(ids)
	const out: TakenAlong[] = []
	let grew = true
	while (grew) {
		grew = false
		for (const id of [...moving]) {
			const parent = byId.get(byId.get(id)?.anchorEntryId ?? -1)
			if (
				parent &&
				parent.branchId === source &&
				!moving.has(parent.id)
			) {
				moving.add(parent.id)
				out.push({ row: parent, as: "parent" })
				grew = true
			}
		}
		for (const row of rows) {
			if (
				row.branchId === source &&
				row.anchorEntryId != null &&
				moving.has(row.anchorEntryId) &&
				!moving.has(row.id)
			) {
				moving.add(row.id)
				out.push({ row, as: "child" })
				grew = true
			}
		}
	}
	return out
}

/**
 * Why moving `ids` to `target` cannot be done, or `[]` when it can.
 *
 * `rows` holds at least the moving entries, their parents and every entry
 * filed under them (the book's rows, on every line). Every moving entry is on
 * one line, not main; `target` is below it; none is History; each one's date
 * reaches `target` (`reachesBelow`); a parent that is not moving is shared or
 * on `target` and read there; and every entry `takenAlong` names is among
 * `ids` (`leftBehind` otherwise).
 */
export function moveDownProblems(input: {
	ids: readonly number[]
	rows: readonly TreeRow[]
	target: number | null
	branches: readonly LineBranch[]
}): MoveDownProblem[] {
	const { ids, rows, target, branches } = input
	const byId = new Map(rows.map((r) => [r.id, r]))
	const moving = ids
		.map((id) => byId.get(id))
		.filter((r): r is TreeRow => !!r)
	if (moving.length === 0) return []
	const onMain = moving.find((r) => r.branchId == null)
	if (onMain) return [{ kind: "onMain", row: onMain }]
	const source = moving[0].branchId as number
	if (moving.some((r) => r.branchId !== source))
		return [{ kind: "mixedLines" }]
	if (!isBelow(source, target, branches))
		return [{ kind: "notBelow", source, target }]

	const problems: MoveDownProblem[] = []
	const asked = new Set(ids)
	for (const row of moving) {
		if (row.isHistory) {
			problems.push({ kind: "history", row })
			continue
		}
		if (!reachesBelow(row.date, source, target, branches))
			problems.push({
				kind: "cut",
				row,
				fork: forkThatCuts(source, target, branches)
			})
		const parent = byId.get(row.anchorEntryId ?? -1)
		if (!parent || asked.has(parent.id) || parent.branchId === source)
			continue
		const readOnTarget =
			(parent.branchId == null || parent.branchId === target) &&
			rowReadsOnLine(parent, lineOf(target, branches), parent.date)
		if (!readOnTarget) problems.push({ kind: "parentNotRead", row, parent })
	}
	for (const along of takenAlong(ids, rows, source)) {
		const row =
			along.as === "parent"
				? (moving.find((r) => isFiledUnder(r, along.row.id, byId)) ??
					moving[0])
				: (byId.get(along.row.anchorEntryId ?? -1) ?? moving[0])
		problems.push({
			kind: "leftBehind",
			row,
			along: along.row,
			relation: along.as
		})
	}
	return problems
}

function isFiledUnder(
	row: TreeRow,
	ancestorId: number,
	byId: ReadonlyMap<number, TreeRow>
): boolean {
	const seen = new Set<number>()
	let cursor = row.anchorEntryId
	while (cursor != null && !seen.has(cursor)) {
		if (cursor === ancestorId) return true
		seen.add(cursor)
		cursor = byId.get(cursor)?.anchorEntryId ?? null
	}
	return false
}

/**
 * The lines that start reading the moving rows (all on `source`) once they sit
 * on `target`: main first, then the book's lines in the order given. A line
 * that read one before reads it after (the date rule), so this is the whole
 * change in who reads them.
 */
export function linesStartingToRead(
	rows: readonly TreeRow[],
	source: number,
	target: number | null,
	branches: readonly LineBranch[]
): (number | null)[] {
	const out: (number | null)[] = []
	for (const id of [null, ...branches.map((b) => b.id)]) {
		const line = lineOf(id, branches)
		if (
			rows.some(
				(r) =>
					!rowReadsOnLine({ branchId: source }, line, r.date) &&
					rowReadsOnLine({ branchId: target }, line, r.date)
			)
		)
			out.push(id)
	}
	return out
}

/** How the sentences name things: a line by id (null = main) and a date. */
export interface MoveDownWords {
	lineName: (branchId: number | null) => string
	date: (date: StoryDate) => string
	/** The book's Timeline switch: off, a cut is worded without dates. */
	timeline: boolean
}

/** The sentence for one problem: the dialog's reason and the server's refusal. */
export function moveDownSentence(p: MoveDownProblem, w: MoveDownWords): string {
	switch (p.kind) {
		case "onMain":
			return `${p.row.name} is on main, the bottom of the tree.`
		case "mixedLines":
			return "Move entries from one line at a time."
		case "notBelow":
			return `${w.lineName(p.target)} is not a line ${w.lineName(p.source)} was forked from. An entry moves only down the tree, toward main.`
		case "history":
			return `${p.row.name} is a History entry. History entries stay on their line, one for each date.`
		case "cut": {
			const fork = p.fork
			if (!fork) return `${p.row.name} is not read there.`
			if (!w.timeline || !p.row.date)
				return `${w.lineName(fork.line)} left ${w.lineName(fork.leftFrom)} before ${p.row.name} began.`
			return `${p.row.name} began at ${w.date(p.row.date)}; ${w.lineName(fork.line)} left ${w.lineName(fork.leftFrom)} at ${w.date(fork.at)}.`
		}
		case "parentNotRead":
			return `${p.row.name} is filed under ${p.parent.name}, which that line does not read.`
		case "leftBehind":
			return p.relation === "parent"
				? `${p.row.name} is filed under ${p.along.name}: move ${p.along.name} with it.`
				: `${p.along.name} is filed under ${p.row.name}: move it with ${p.row.name}.`
	}
}
