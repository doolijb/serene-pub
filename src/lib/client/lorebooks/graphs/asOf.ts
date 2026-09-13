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

import { dateValue, type StoryDate } from "../sections/historyDates"
import { isInStoryAsOf, momentKey, momentValue } from "../time/moment"

/** A history entry, as little of it as a date needs. */
export interface DatedEntryLike extends StoryDate {
	id: number
}

/** An edge, as little of it as its date needs. */
export interface DatedEdgeLike {
	historyEntryId: number | null
}

/** When an edge happened, or nothing when nothing dates it. */
export function edgeDateValue(
	edge: DatedEdgeLike,
	entries: readonly DatedEntryLike[]
): number | null {
	if (edge.historyEntryId == null) return null
	const entry = entries.find((e) => e.id === edge.historyEntryId)
	return entry ? dateValue(entry) : null
}

/** The web as it stood at the moment: everything that had happened by then. */
export function edgesAtMoment<T extends DatedEdgeLike>(
	edges: readonly T[],
	moment: string | null | undefined,
	entries: readonly DatedEntryLike[]
): T[] {
	const at = momentValue(moment)
	if (at == null) return [...edges]
	return edges.filter((e) => isInStoryAsOf(edgeDateValue(e, entries), at))
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
	const at = momentValue(moment)
	if (at == null) return { inStory: [...edges], later: [] }
	const inStory: T[] = []
	const later: T[] = []
	for (const edge of edges)
		(isInStoryAsOf(edgeDateValue(edge, entries), at)
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
