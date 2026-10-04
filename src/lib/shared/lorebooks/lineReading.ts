/**
 * Which rows, and which amendments, are on the line being read.
 *
 * ONE rule, pure, called by the workspace (client) and by every server read
 * (`$lib/server/state/lineSql.ts` is its SQL form, `reading.ts` its row form).
 * The two halves drifted apart three times while each carried its own copy;
 * this module is the copy. Every reader takes a `Line` — a bare branch id
 * cannot see a grandparent or a fork cut, so nothing here accepts one — and
 * the conformance tests (`lineConformance.test.ts` for the shared readers,
 * `lineConformance.screens.dom.test.ts` for the screens they mount,
 * `lineSql.int.test.ts` for the SQL form and server readers) run them over
 * one table of cases (`lineReading.cases.ts`).
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
import { compareDates, type StoryClock, type StoryDate } from "./storyDate"

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
	/**
	 * The line first, then its parent, … main LAST. Never empty. A branch
	 * whose chain is not known yet (`lineOf` without it in the list) is its
	 * own step alone, with no main.
	 */
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
 * Where a line forks from once the line it left is deleted: from THAT line's
 * parent, at the earlier of the two fork dates (a fork at now takes the other
 * date; two at now stay at now).
 *
 * The chain then reads exactly what it read before, less the deleted line's
 * own rows, which go with it: every step past the deleted one was already cut
 * at the earlier date, and so is the parent now. A grandchild needs nothing —
 * its chain runs through the child, whose cut this keeps.
 *
 * ⚠ Not an entry's re-parent (`assertAnchorEntry`); this moves a line.
 */
export function forkPastDeleted(
	child: LineBranch,
	deleted: LineBranch
): Required<Omit<LineBranch, "id">> {
	const cut = earlierCut(forkDateOf(child), forkDateOf(deleted))
	const parent = deleted.forkedFromBranchId ?? null
	return {
		// A cycle the schema cannot prevent must not point a line at itself.
		forkedFromBranchId: parent === child.id ? null : parent,
		forkYear: cut?.year ?? null,
		forkMonth: cut?.month ?? null,
		forkDay: cut?.day ?? null
	}
}

/**
 * The line a session on `branchId` reads once lines are deleted: its own
 * while `after` still has it, else the nearest line of its chain in `before`
 * that `after` has — main when none does (null is main).
 *
 * `amendments:deleteBranch` moves the sessions on a deleted line this way, to
 * the line it left; a screen holding the list from before a delete finds
 * where the server put its session the same way, however many deletes it
 * missed.
 *
 * ⚠ Where a SESSION goes. A line forked from the deleted one moves by
 * `forkPastDeleted`, which also moves its fork date.
 */
export function survivingLineOf(
	branchId: number | null | undefined,
	before: readonly LineBranch[],
	after: readonly LineBranch[]
): number | null {
	if (branchId == null) return null
	const kept = new Set(after.map((b) => b.id))
	for (const id of lineBranchIds(lineOf(branchId, before)))
		if (kept.has(id)) return id
	return null
}

/**
 * The clock a session on `deleted` keeps when it moves to the line that one
 * left (`survivingLineOf`): its own while its DATE is at or before the
 * deleted line's fork date — the parent reads exactly what the session read
 * up to there — else that fork date, with no time of day. Past it, the parent
 * holds history the session's line never had. A line forked at now cut
 * nothing, so every clock stays. Answers `clock` itself when it stays.
 *
 * ⚠ The session's CLOCK. The line it moves to is `survivingLineOf`'s; a line
 * forked from the deleted one moves by `forkPastDeleted`.
 */
export function clockPastDeleted<C extends StoryClock>(
	clock: C,
	deleted: LineBranch
): C | StoryClock {
	const cut = forkDateOf(deleted)
	if (cut === null) return clock
	const month = clock.month ?? null
	const date = { year: clock.year, month, day: month == null ? null : (clock.day ?? null) }
	if (compareDates(date, cut) <= 0) return clock
	return { year: cut.year, month: cut.month, day: cut.day, hour: null, minute: null }
}

/**
 * The lines whose chain runs through `lineId`, grouped under the child that
 * leaves it directly: each child, with itself and every line forked from it
 * at any depth. What deleting the line hands each child.
 *
 * A row of the deleted line that the child reads at its head, moved onto the
 * child, reads on exactly the child's group, at exactly the moments it read
 * there before (`keepHistoryForForks` keeps a history entry that way): every
 * step between a group's line and the child is cut the same as it was, and
 * the child's own cut past the deleted line is the one the row already met.
 */
export function forksThrough(
	lineId: number,
	branches: readonly LineBranch[]
): Map<number, number[]> {
	const groups = new Map<number, number[]>()
	for (const branch of branches) {
		const chain = lineBranchIds(lineOf(branch.id, branches))
		const at = chain.indexOf(lineId)
		if (at < 1) continue
		const child = chain[at - 1]
		groups.set(child, [...(groups.get(child) ?? []), branch.id])
	}
	return groups
}

/**
 * The line being read, built from the book's branches.
 *
 * `branchId` null is main. A branch missing from `branches` (the list has not
 * arrived yet, or a stale id) reads its OWN rows only: nothing is known of
 * where it forked, so nothing of main or of a parent is read until the list
 * says — a reading that shows less than the line, never a sibling's or
 * main's rows past a cut it cannot see. A server read never builds a line
 * from a list it has not checked: `lineOfBook` refuses a branch the book
 * does not have. A parent that is missing (a stale list can name a deleted
 * line; deleting one moves its children past it first, `forkPastDeleted`)
 * ends the chain at main with the cut gathered so far. A cycle, which the
 * schema cannot prevent, ends it too.
 */
export function lineOf(
	branchId: number | null | undefined,
	branches: readonly LineBranch[]
): Line {
	if (branchId == null) return MAIN_LINE
	const byId = new Map(branches.map((b) => [b.id, b]))
	const steps: LineStep[] = [{ branchId, cut: null }]
	if (!byId.has(branchId)) return { branchId, steps }
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

/** The same chain with every fork cut lifted (a pipeline's "whole line" read). */
export function uncutLine(line: Line): Line {
	return {
		branchId: line.branchId,
		steps: line.steps.map((s) => ({ branchId: s.branchId, cut: null }))
	}
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
