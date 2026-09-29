/**
 * Which rows, and which amendments, are on the line being read.
 *
 * ONE rule, pure, called by the workspace (client) and by every server read
 * (`$lib/server/state/lineSql.ts` is its SQL form, `reading.ts` its row form).
 * The two halves drifted apart three times while each carried its own copy;
 * this module is the copy.
 *
 * ## A line is an ancestor chain (owner ruling 5, 2026-09-28)
 *
 * Main is the absence of a branch. A branch forks from main or from another
 * branch, optionally AT a story date. Reading branch C, forked from B at `dC`,
 * where B was forked from main at `dB`, sees:
 *
 *   - C's own rows, whatever their date;
 *   - B's rows dated at or before `dC`;
 *   - main's rows dated at or before the EARLIER of `dC` and `dB`.
 *
 * A fork with no date ("forked at now") cuts nothing: it keeps following the
 * line it left. A row on any line NOT in the chain (a sibling) is never seen.
 *
 * An UNDATED row is never cut — it makes no claim about when, so it reads on
 * every line whose chain contains its branch.
 *
 * ## Amendments
 *
 * The amendments that apply are the chain's, each step's filtered by the
 * earlier of the moment and that step's fork cut, applied oldest ancestor
 * first: main, then each branch outward to the line itself. Later wins per
 * field, and a nearer line always wins over an ancestor — the precedence
 * `amendmentsAsOf` has always had between a branch and main, generalised.
 *
 * ⚠ `compareDates` orders. `dateValue` is a placement scalar that collides
 * once a month or a day passes 100, and is never used here.
 */
import { compareDates, type StoryDate } from "./storyDate"

/** A branch row, as little of it as the chain needs (the wire's `Branch` fits). */
export interface LineBranch {
	id: number
	/** The line it left. NULL = main. */
	forkedFromBranchId?: number | null
	forkYear?: number | null
	forkMonth?: number | null
	forkDay?: number | null
}

/** One line of the chain and how far along it the reading line sees. */
export interface LineStep {
	/** NULL = main. */
	branchId: number | null
	/**
	 * The latest story date this step's DATED rows are seen up to, from the
	 * forks alone (the moment is applied on top). NULL = no fork cut. Always
	 * null on the first step: a line is never cut off from itself.
	 */
	cut: StoryDate | null
}

/** A line being read: the branch, and its chain down to main. */
export interface Line {
	/** The line itself. NULL = main. */
	branchId: number | null
	/** The line first, then its parent, … main LAST. Never empty. */
	steps: readonly LineStep[]
}

/** Main: shared rows only, never cut. */
export const MAIN_LINE: Line = Object.freeze({
	branchId: null,
	steps: Object.freeze([Object.freeze({ branchId: null, cut: null })])
}) as Line

/** A branch's fork date, or null when it forked at now (no cut). */
export function forkDateOf(branch: LineBranch | null | undefined): StoryDate | null {
	if (!branch || branch.forkYear == null) return null
	const month = branch.forkMonth ?? null
	return { year: branch.forkYear, month, day: month == null ? null : (branch.forkDay ?? null) }
}

/** The earlier of two cuts, where null is "no cut" (so the other wins). */
export function earlierCut(
	a: StoryDate | null | undefined,
	b: StoryDate | null | undefined
): StoryDate | null {
	if (a == null) return b ?? null
	if (b == null) return a
	return compareDates(a, b) <= 0 ? a : b
}

/**
 * The line being read, built from the book's branches.
 *
 * `branchId` null is main. A branch missing from `branches` (the list has not
 * arrived yet, or a stale id) reads as its own rows plus all of main, uncut —
 * the conservative reading, and the one a lone branch id always meant. A
 * parent that is missing (deleted: its children fall back to main by `SET
 * NULL`, but a stale list can still name it) ends the chain at main with the
 * cut gathered so far. A cycle, which the schema cannot prevent, ends it too.
 */
export function lineOf(
	branchId: number | null | undefined,
	branches: readonly LineBranch[]
): Line {
	if (branchId == null) return MAIN_LINE
	const byId = new Map(branches.map((b) => [b.id, b]))
	const steps: LineStep[] = [{ branchId, cut: null }]
	const seen = new Set<number>([branchId])
	let cut: StoryDate | null = null
	let cursor = byId.get(branchId)
	while (cursor) {
		cut = earlierCut(cut, forkDateOf(cursor))
		const parent = cursor.forkedFromBranchId ?? null
		if (parent == null || seen.has(parent)) break
		seen.add(parent)
		steps.push({ branchId: parent, cut })
		cursor = byId.get(parent)
	}
	steps.push({ branchId: null, cut })
	return { branchId, steps }
}

/**
 * A one-level line: the branch and main, main cut at `forkedAt`.
 *
 * ⚠ For callers that know only a branch id and its own fork date. It cannot
 * see a grandparent; build the line with `lineOf` whenever the branch list is
 * at hand.
 */
export function lineFromFork(
	branchId: number | null | undefined,
	forkedAt?: StoryDate | null
): Line {
	if (branchId == null) return MAIN_LINE
	return {
		branchId,
		steps: [
			{ branchId, cut: null },
			{ branchId: null, cut: forkedAt ?? null }
		]
	}
}

/** The same chain with every fork cut lifted (a pipeline's "whole line" read). */
export function uncutLine(line: Line): Line {
	return {
		branchId: line.branchId,
		steps: line.steps.map((s) => ({ branchId: s.branchId, cut: null }))
	}
}

/** Accept a `Line`, or a bare branch id (read as a one-level fork of main). */
export function asLine(line: Line | number | null | undefined): Line {
	if (line != null && typeof line === "object") return line
	return lineFromFork(line ?? null, null)
}

/** The step of the chain a row on `rowBranchId` belongs to, or undefined. */
export function stepOf(
	line: Line,
	rowBranchId: number | null | undefined
): LineStep | undefined {
	const id = rowBranchId ?? null
	return line.steps.find((s) => s.branchId === id)
}

/** The non-main branch ids of the chain, the line itself first. */
export function lineBranchIds(line: Line): number[] {
	return line.steps
		.map((s) => s.branchId)
		.filter((id): id is number => id != null)
}

/** Whether the row's branch is in the chain at all, whatever its date. */
export function isOnLine(
	row: { branchId?: number | null },
	line: Line
): boolean {
	return stepOf(line, row.branchId) !== undefined
}

/**
 * Whether a row reads on the line.
 *
 * `date` is the row's own story date (null = undated: never cut). `moment`
 * null is the head — nothing is cut by the moment, only by forks. The workspace
 * passes no moment for its pool (later rows are drawn dimmed, not hidden); the
 * server passes the reading's moment.
 */
export function rowReadsOnLine(
	row: { branchId?: number | null },
	line: Line,
	date: StoryDate | null = null,
	moment: StoryDate | null = null
): boolean {
	const step = stepOf(line, row.branchId)
	if (!step) return false
	if (date == null) return true
	const cut = earlierCut(step.cut, moment)
	return cut === null || compareDates(date, cut) <= 0
}

/**
 * The rows of a list that read on the line.
 *
 * `dateOf` names a row's own date (undefined/null = undated). Omit it for a
 * list that carries no dates: then only the chain decides.
 */
export function rowsReadingOnLine<T extends { branchId?: number | null }>(
	rows: readonly T[],
	line: Line,
	dateOf?: (row: T) => StoryDate | null | undefined,
	moment: StoryDate | null = null
): T[] {
	return rows.filter((row) =>
		rowReadsOnLine(row, line, dateOf ? (dateOf(row) ?? null) : null, moment)
	)
}

/** A dated overlay, as little of it as the line rule needs. */
export interface LineDated {
	id: number
	branchId: number | null
	year: number
	month?: number | null
	day?: number | null
}

function byDateThenId(a: LineDated, b: LineDated): number {
	return compareDates(a, b) || a.id - b.id
}

/**
 * The amendments that apply on the line at the moment, in APPLY order.
 *
 * Main first, then each ancestor branch outward, then the line's own; inside
 * a step by date then id. `moment` null is the head (every dated amendment on
 * the chain, fork cuts still applied).
 */
export function amendmentsOnLine<A extends LineDated>(
	amendments: readonly A[],
	line: Line,
	moment: StoryDate | null = null
): A[] {
	const groups: A[][] = line.steps.map(() => [])
	const cuts = line.steps.map((s) => earlierCut(s.cut, moment))
	for (const a of amendments) {
		const i = line.steps.findIndex((s) => s.branchId === (a.branchId ?? null))
		if (i < 0) continue
		const cut = cuts[i]
		if (cut === null || compareDates(a, cut) <= 0) groups[i].push(a)
	}
	const out: A[] = []
	for (let i = groups.length - 1; i >= 0; i--)
		out.push(...groups[i].sort(byDateThenId))
	return out
}

/**
 * The amendments still AHEAD of the moment on this line, soonest first.
 *
 * On the chain, dated after the moment, and not past their step's fork cut —
 * an amendment main made after the fork never happens on this line, so it is
 * not "not yet", it is not at all. Empty at the head by construction.
 */
export function amendmentsAheadOnLine<A extends LineDated>(
	amendments: readonly A[],
	line: Line,
	moment: StoryDate | null
): A[] {
	if (!moment) return []
	return amendments
		.filter((a) => {
			const step = stepOf(line, a.branchId)
			if (!step || compareDates(a, moment) <= 0) return false
			return step.cut === null || compareDates(a, step.cut) <= 0
		})
		.sort(byDateThenId)
}
