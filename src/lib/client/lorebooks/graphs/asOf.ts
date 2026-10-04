/**
 * Edges read as of a moment.
 *
 * An edge is dated by the history entry that established it, so "when did this
 * happen" is a question about that entry's date. An edge nothing dates makes no
 * claim about when and is in the story at every moment, which is the rule the
 * rest of the workspace reads dated rows by.
 *
 * ⚠ **A reader, not an editor.** Reading as of a date changes what is drawn and
 * nothing about what is stored.
 */

import type { StoryDate } from "../sections/historyDates"
import { isInStoryAsOf, momentDate, momentKey } from "../time/moment"
import {
	rowsReadingOnLine,
	type Line
} from "$lib/shared/lorebooks/lineReading"
import {
	nearestTieVersions,
	type TieVersionLike
} from "$lib/shared/lorebooks/tieVersions"

/** A history entry, as little of it as a date needs. */
export interface DatedEntryLike extends StoryDate {
	id: number
}

/** An edge, as little of it as its date needs. */
export interface DatedEdgeLike {
	historyEntryId: number | null
}

/**
 * When an edge happened, or nothing when nothing dates it.
 *
 * ⚠ A DATE, ordered by `compareDates` — never the packed `dateValue`, which
 * puts Y3 Mo. 1 Day 250 after Y3 Mo. 3 Day 50.
 */
export function edgeDate(
	edge: DatedEdgeLike,
	entries: readonly DatedEntryLike[]
): StoryDate | null {
	if (edge.historyEntryId == null) return null
	const entry = entries.find((e) => e.id === edge.historyEntryId)
	return entry
		? { year: entry.year, month: entry.month ?? null, day: entry.day ?? null }
		: null
}

/**
 * The edges the line being read can see (owner ruling 5).
 *
 * `line` carries the whole ancestor chain (`openBookTime.lineOf`), so a fork
 * of a fork reads its parent's links too. A link on an ancestor line that is
 * dated after the fork is CUT from the branch — the date is the history entry
 * that dates it; an undated link is never cut. A sibling line's links never
 * show. A branch's own version of a cast tie at a date is drawn in place of
 * the version it inherited at that date (`nearestTieVersions`, the prompt's
 * rule too).
 */
export function edgesOnLine<
	T extends DatedEdgeLike & TieVersionLike & { branchId?: number | null }
>(edges: readonly T[], line: Line, entries: readonly DatedEntryLike[]): T[] {
	return nearestTieVersions(
		rowsReadingOnLine(edges, line, (e) => edgeDate(e, entries)),
		line
	)
}

/** The web as it stood at the moment: everything that had happened by then. */
export function edgesAtMoment<T extends DatedEdgeLike>(
	edges: readonly T[],
	moment: string | null | undefined,
	entries: readonly DatedEntryLike[]
): T[] {
	const at = momentDate(moment)
	if (at == null) return [...edges]
	return edges.filter((e) => isInStoryAsOf(edgeDate(e, entries), at))
}

export interface MomentSplit<T> {
	inStory: T[]
	/** Established after the moment: drawn, dimmed, and dated. */
	later: T[]
}

/**
 * The same edges, in two piles.
 *
 * The cast board dims what has not happened yet rather than hiding it: a
 * relationship the reader can see they are reading past is a different thing
 * from one that has silently gone.
 */
export function splitByMoment<T extends DatedEdgeLike>(
	edges: readonly T[],
	moment: string | null | undefined,
	entries: readonly DatedEntryLike[]
): MomentSplit<T> {
	const at = momentDate(moment)
	if (at == null) return { inStory: [...edges], later: [] }
	const inStory: T[] = []
	const later: T[] = []
	for (const edge of edges)
		(isInStoryAsOf(edgeDate(edge, entries), at)
			? inStory
			: later
		).push(edge)
	return { inStory, later }
}

/** The date an edge is waiting on, as the chip beside it says it. */
export function laterLabel(
	edge: DatedEdgeLike,
	entries: readonly DatedEntryLike[]
): string {
	const entry =
		edge.historyEntryId == null
			? undefined
			: entries.find((e) => e.id === edge.historyEntryId)
	return entry ? `${momentKey(entry)} · later` : "later"
}
