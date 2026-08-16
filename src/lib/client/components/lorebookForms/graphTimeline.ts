/**
 * "As of" filtering for the narrative graph.
 *
 * A relationship records the history entry it was established in, so the graph
 * can be replayed in story order instead of only ever showing its final state.
 *
 * Pure functions, kept out of the component so the ordering and cutoff rules
 * are testable — they are easy to get subtly wrong (month/day are nullable, and
 * entries at the same date must still order deterministically).
 */

export interface TimelineEntry {
	id: number
	year: number
	month: number | null
	day: number | null
}

export interface DatedRelationship {
	historyEntryId: number | null
	fromNodeId: number
	toNodeId: number
}

/**
 * Chronological sort key. month/day are nullable — an entry dated only to a
 * year sorts before anything in that year that names a month, which is the
 * intuitive reading of "sometime in 217". `id` breaks exact ties so the order
 * is total and stable rather than dependent on input order.
 */
export function entrySortKey(
	e: TimelineEntry
): [number, number, number, number] {
	return [e.year, e.month ?? 0, e.day ?? 0, e.id]
}

export function compareEntries(a: TimelineEntry, b: TimelineEntry): number {
	const ka = entrySortKey(a)
	const kb = entrySortKey(b)
	for (let i = 0; i < ka.length; i++) {
		if (ka[i] !== kb[i]) return ka[i] - kb[i]
	}
	return 0
}

/** The slider's axis: every entry, oldest first. */
export function buildTimelineAxis(entries: TimelineEntry[]): TimelineEntry[] {
	return [...entries].sort(compareEntries)
}

export function formatEntryLabel(e: TimelineEntry): string {
	const parts = [`Year ${e.year}`]
	if (e.month != null) parts.push(`Month ${e.month}`)
	if (e.day != null) parts.push(`Day ${e.day}`)
	return parts.join(", ")
}

/**
 * Relationships established at or before the cutoff.
 *
 * Cumulative rather than point-in-time: the question is "what did the web look
 * like by then", so a tie is inclusive. This is deliberately NOT status-aware —
 * `status` (active/resolved/broken) records where a relationship stands *now*,
 * and nothing records when it changed, so pretending a resolved relationship
 * un-resolves as you scrub backwards would be inventing history the data does
 * not contain.
 *
 * Undated relationships are dropped while a cutoff is active. They cannot be
 * placed on the axis, and silently showing them at every position would make
 * the earliest frame look busier than the story was. Callers surface the count
 * instead — see `countUndated`.
 */
export function relationshipsAsOf<T extends DatedRelationship>(
	relationships: T[],
	cutoff: TimelineEntry | null,
	entriesById: Map<number, TimelineEntry>
): T[] {
	if (!cutoff) return relationships
	return relationships.filter((r) => {
		if (r.historyEntryId == null) return false
		const entry = entriesById.get(r.historyEntryId)
		if (!entry) return false
		return compareEntries(entry, cutoff) <= 0
	})
}

export function countUndated(relationships: DatedRelationship[]): number {
	return relationships.filter((r) => r.historyEntryId == null).length
}

/**
 * Nodes still worth drawing at the cutoff: anything touching a visible
 * relationship.
 *
 * Nodes carry no date of their own, so their presence is inferred from their
 * connections — a character who has not met anyone yet simply has not entered
 * the story as far as the graph is concerned. With no cutoff every node is
 * kept, including isolated ones, since that is the real current graph.
 */
export function nodesAsOf<N extends { id: number }>(
	nodes: N[],
	visibleRelationships: DatedRelationship[],
	cutoff: TimelineEntry | null
): N[] {
	if (!cutoff) return nodes
	const touched = new Set<number>()
	for (const r of visibleRelationships) {
		touched.add(r.fromNodeId)
		touched.add(r.toNodeId)
	}
	return nodes.filter((n) => touched.has(n.id))
}
