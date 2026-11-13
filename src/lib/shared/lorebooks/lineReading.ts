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
 * ## Cast versions: one row in force
 *
 * A cast member's versions are rows on the line like any other, and a reading
 * takes ONE of them (`versionInForce`): the latest by date, then the nearer
 * holder (an own book of the overlay chain before the attached book, the
 * reader's own book first; on the attached book, the line before its
 * ancestors), then the higher life point, write order and id. A branch's
 * session cuts (`Line.sessionCuts`, `rowPassesSessionCut`) hide what an
 * ancestor session wrote after the fork, and a retire mark keeps a row the
 * ancestor has since retired readable by the branches that forked before it.
 *
 * ⚠ `compareDates` orders. `dateValue` is a placement scalar that collides
 * once a month or a day passes 100, and is never used here.
 */
import {
	compareDates,
	dayOnly,
	type StoryClock,
	type StoryDate
} from "./storyDate"
// A function-only cycle: `amendments.ts` imports this module too, and each side
// only calls the other inside function bodies, never at load.
import { amendmentsForAppearance } from "./amendments"

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

/**
 * 🚧 A **session cut** (plan §32 §5b, §33.2): how far into one ancestor
 * session a branch's reading sees. One per ancestor, nearest first; the first
 * cut for a session is the one that counts.
 */
export interface SessionCut {
	/** The ancestor session. */
	sessionId: number
	/** The highest origin message the reader still has from that session (its live copied lines); null = none (the branch went Back past every one), so only rows with no source message read. */
	through: number | null
	/** The write-order mark: the highest write order at the fork, taken under the state lock. */
	mark: number
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
	/**
	 * Absent or empty = not a branch, or a branch made before S4: nothing is
	 * cut by session. Cast versions read it (`rowPassesSessionCut` here; its
	 * SQL mirror is in `state/lineSql.ts`), and so do durable stat values:
	 * `rowsOnReading` keeps a value row tied to an ancestor session's turn
	 * (`validFromMessageId`) only up to that cut's `through`. Entries ride
	 * the line uncut by session (they are cut by story date only,
	 * `entryOnReadingSql`). `lineOf` does not set it — the reader adds it: `{ ...lineOf(id, branches), sessionCuts }`.
	 */
	sessionCuts?: readonly SessionCut[]
}

/** Main: shared rows only, never cut. */
export const MAIN_LINE: Line = Object.freeze({
	branchId: null,
	steps: Object.freeze([Object.freeze({ branchId: null, cut: null })])
}) as Line

/** A branch's fork date, or null when it forked at now (no cut). */
export function forkDateOf(
	branch: LineBranch | null | undefined
): StoryDate | null {
	if (!branch || branch.forkYear == null) return null
	const month = branch.forkMonth ?? null
	return {
		year: branch.forkYear,
		month,
		day: month == null ? null : (branch.forkDay ?? null)
	}
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
	const date = {
		year: clock.year,
		month,
		day: month == null ? null : (clock.day ?? null)
	}
	if (compareDates(date, cut) <= 0) return clock
	return {
		year: cut.year,
		month: cut.month,
		day: cut.day,
		hour: null,
		minute: null
	}
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

/**
 * The same chain with every fork cut lifted (a pipeline's "whole line" read).
 * It lifts fork DATE cuts only: `sessionCuts` are kept — a session cut is not
 * a date cut.
 */
export function uncutLine(line: Line): Line {
	return {
		branchId: line.branchId,
		steps: line.steps.map((s) => ({ branchId: s.branchId, cut: null })),
		...(line.sessionCuts ? { sessionCuts: line.sessionCuts } : {})
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

/**
 * **Who owns a dated history day** (rule C, owner, 2026-11-10): the step of
 * the chain whose branch owns the history entry of `date` for this line. A
 * line owns a day only strictly AFTER its fork date; on or before it the day
 * belongs to the nearest ancestor that may own it; a dateless fork owns no
 * dated history; main, the last step, owns the rest. Partial dates compare as
 * `compareDates` does (Year 2 and Year 2 Month 5 are different days). Pure.
 *
 * `steps[i + 1].cut` is the earliest fork date along steps 0..i, so the walk
 * stops at step i when the date lies past that cut. A null cut means no fork
 * date so far: step i owns nothing dated and the walk goes on.
 * `scenes/historyEntryOfDate.ts` is its server user (where a day-entry path
 * makes an empty entry, and the free-date check).
 */
export function historyOwnerStep(line: Line, date: StoryDate): LineStep {
	const steps = line.steps
	for (let i = 0; i < steps.length - 1; i++) {
		const cut = steps[i + 1].cut
		if (cut !== null && compareDates(date, cut) > 0) return steps[i]
	}
	return steps[steps.length - 1]
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

/** A dated overlay of a line, as little of it as the line rule needs. */
export interface LineDatedRow {
	id: number
	branchId: number | null
	year: number
	month?: number | null
	day?: number | null
	/** Absent: this is a line's row. A held amendment sets it (`HeldDated`). */
	held?: undefined
}

/**
 * A held amendment 🚧: the session's own, laid on top of the line it reads.
 * `anchor` is the turn's message (`source_message_id`), null when it has none.
 * It may be undated (`year` null); it has no branch and is never a line's.
 */
export interface HeldDated {
	id: number
	branchId: number | null
	year: number | null
	month?: number | null
	day?: number | null
	held: { anchor: number | null }
}

/** A line's row or a held amendment; test `held` to tell them apart. */
export type LineDated = LineDatedRow | HeldDated

function byDateThenId(a: LineDatedRow, b: LineDatedRow): number {
	return compareDates(a, b) || a.id - b.id
}

/** Anchor ascending (null first), then id. */
function byAnchorThenId(a: HeldDated, b: HeldDated): number {
	return (a.held.anchor ?? -Infinity) === (b.held.anchor ?? -Infinity)
		? a.id - b.id
		: (a.held.anchor ?? -Infinity) < (b.held.anchor ?? -Infinity)
			? -1
			: 1
}

/** Whether a held amendment applies at the moment: undated always; dated at or before it (day grain). */
function heldAppliesAt(a: HeldDated, moment: StoryDate | null): boolean {
	if (a.year == null || moment === null) return true
	return (
		compareDates(
			dayOnly({ year: a.year, month: a.month ?? null, day: a.day ?? null }),
			moment
		) <= 0
	)
}

/**
 * The amendments that apply on the line at the moment, in APPLY order.
 *
 * Main first, then each ancestor branch outward, then the line's own; inside
 * a step by date then id. `moment` null is the head (every dated amendment on
 * the chain, fork cuts still applied). Then the session's held amendments,
 * LAST, by anchor then id: they are the session's, not a line's, so fork cuts
 * never reach them.
 */
export function amendmentsOnLine<A extends LineDated>(
	amendments: readonly A[],
	line: Line,
	moment: StoryDate | null = null
): A[] {
	const groups: LineDatedRow[][] = line.steps.map(() => [])
	const held: HeldDated[] = []
	const cuts = line.steps.map((s) => earlierCut(s.cut, moment))
	for (const a of amendments) {
		if (a.held) {
			if (heldAppliesAt(a, moment)) held.push(a)
			continue
		}
		const i = line.steps.findIndex(
			(s) => s.branchId === (a.branchId ?? null)
		)
		if (i < 0) continue
		const cut = cuts[i]
		if (cut === null || compareDates(a, cut) <= 0) groups[i].push(a)
	}
	const out: LineDated[] = []
	for (let i = groups.length - 1; i >= 0; i--)
		out.push(...groups[i].sort(byDateThenId))
	out.push(...held.sort(byAnchorThenId))
	return out as A[]
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
			if (a.held) return false
			const step = stepOf(line, a.branchId)
			if (!step || compareDates(a, moment) <= 0) return false
			return step.cut === null || compareDates(a, step.cut) <= 0
		})
		.sort((x, y) => byDateThenId(x as LineDatedRow, y as LineDatedRow))
}

/**
 * A cast version, as little of it as the one-row read needs. The field names
 * are the `characterVersions` column names, so a selected row fits.
 */
export interface LineCastVersion {
	id: number
	/** NULL = main. */
	branchId: number | null
	/** Day grain; a null year is undated (never cut, ranks below every dated row). */
	year: number | null
	month?: number | null
	day?: number | null
	/** The life point; null = every appearance (ranks below every number). */
	personalPosition: number | null
	writeOrder: number
	retiredOrder: number | null
	sourceSessionId: number | null
	sourceMessageId: number | null
	/**
	 * Which own book of the overlay chain holds the row, counted from the
	 * reader: 0 = the reading session's own book, 1 = its nearest ancestor's,
	 * …; null/absent = the attached book, read along the line's steps. The
	 * reader sets it (the table has no such column). An overlay row reads as
	 * on its own book's main (`MAIN_LINE`).
	 */
	overlayDepth?: number | null
}

/**
 * 🚧 Whether a cast version survives the line's session cuts (plan §32 §5b,
 * §33.2). The cut for the row's source is the first in `line.sessionCuts`
 * with that session; a row with no source has none.
 *
 *   - **Retire mark.** A row with `retiredOrder` set reads only for a reader
 *     that has a cut for its source whose `mark < retiredOrder` (it forked
 *     before the row was retired). Every other reader passes it by: the
 *     source session itself, a session forked after the retire, any reader
 *     with no cut for that source (the book's own screens). Forward clears
 *     the mark (null) and the row reads again by the next two tests.
 *   - **Session cut.** When a cut exists, the row reads only when
 *     `sourceMessageId` is null or `<= through` (a null `through` passes only
 *     rows with a null source message), AND `writeOrder <= mark`.
 *
 * A row from any other source (null, the reader itself, a session not among
 * the cuts) is not cut. `sessionCutSql` (`lineSql.ts`) is the SQL form.
 */
export function rowPassesSessionCut(
	row: Pick<
		LineCastVersion,
		"writeOrder" | "retiredOrder" | "sourceSessionId" | "sourceMessageId"
	>,
	line: Line
): boolean {
	const cut =
		row.sourceSessionId == null
			? undefined
			: line.sessionCuts?.find((c) => c.sessionId === row.sourceSessionId)
	if (!cut) return row.retiredOrder == null
	if (row.retiredOrder != null && !(cut.mark < row.retiredOrder)) return false
	const messageSeen =
		row.sourceMessageId == null ||
		(cut.through != null && row.sourceMessageId <= cut.through)
	return messageSeen && row.writeOrder <= cut.mark
}

/** The holder rank of a candidate: higher is nearer. Any overlay row outranks every attached-book row. */
function holderRank(row: LineCastVersion, line: Line): number {
	if (row.overlayDepth != null) return 1_000_000 - row.overlayDepth
	return -line.steps.findIndex((s) => s.branchId === (row.branchId ?? null))
}

/** Positive when life point `a` is later than `b`; null ranks below every number. */
function personalPositionOver(a: number | null, b: number | null): number {
	if (a == null || b == null) return a == null ? (b == null ? 0 : -1) : 1
	return a - b
}

/** Positive when `a` is in force over `b`: date, nearer holder, life point, write order, id. */
function inForceOver(
	a: LineCastVersion,
	b: LineCastVersion,
	line: Line
): number {
	if (a.year == null || b.year == null) {
		if (a.year != null) return 1
		if (b.year != null) return -1
	} else {
		const byDate = compareDates(
			{ year: a.year, month: a.month ?? null, day: a.day ?? null },
			{ year: b.year, month: b.month ?? null, day: b.day ?? null }
		)
		if (byDate) return byDate
	}
	return (
		holderRank(a, line) - holderRank(b, line) ||
		personalPositionOver(a.personalPosition, b.personalPosition) ||
		a.writeOrder - b.writeOrder ||
		a.id - b.id
	)
}

/**
 * 🚧 The ONE cast version a reading takes (plan §32 §3, §33.2).
 *
 * Candidates: a row with `overlayDepth` set must read on its own book's main
 * (`MAIN_LINE`), any other on `line`, at `moment`; every row must pass
 * `rowPassesSessionCut`. Then the one life-point filter
 * (`amendmentsForAppearance`; `appearance` null = every row). The greatest
 * candidate wins by, in order: date (undated lowest), the nearer holder (any
 * overlay row outranks every attached-book row; among overlay rows the lower
 * `overlayDepth`; among attached rows the line before its ancestors, main
 * last), the higher life point (null lowest), the higher write order, the
 * higher id (a copy inherits its source's write order, so two rows can tie).
 * Answers the row itself, or null when no row is a candidate.
 *
 * Resolving the winner's `follows` fields against its parent card version is
 * the reader's, not this function's.
 */
export function versionInForce<V extends LineCastVersion>(
	rows: readonly V[],
	line: Line,
	moment: StoryDate | null,
	appearance: number | null
): V | null {
	const dateOf = (row: V): StoryDate | null =>
		row.year == null
			? null
			: { year: row.year, month: row.month ?? null, day: row.day ?? null }
	const candidates = amendmentsForAppearance(
		rows.filter(
			(row) =>
				(row.overlayDepth != null
					? rowReadsOnLine(row, MAIN_LINE, dateOf(row), moment)
					: rowReadsOnLine(row, line, dateOf(row), moment)) &&
				rowPassesSessionCut(row, line)
		),
		appearance
	)
	let best: V | null = null
	for (const row of candidates)
		if (best === null || inForceOver(row, best, line) > 0) best = row
	return best
}
