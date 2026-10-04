/**
 * Which version of a cast tie a line reads (plan A3, review round).
 *
 * A tie between two cast members can hold several versions, one per date: the
 * history entry that dates it (`narrative_relationships.history_entry_id`), or
 * none for undated. A line reads its own versions and its ancestors' up to each
 * fork (`rowsReadingOnLine`, `rowsOnReading`). When the line and an ancestor
 * both hold a version of the same tie at the same date, the nearer line's is
 * the one read — the precedence amendments have (`lineReading.ts`): a branch's
 * own telling of a moment replaces the telling it inherited there, and the
 * ancestor's row stays as it was for every other line. Versions at different
 * dates are the tie's history and are all read.
 *
 * The same tie is the same `from`, the same `to` and the same words, case kept
 * (what a graph build's apply matches a proposal against). The same date is the
 * same history entry, or both undated.
 *
 * A link with an entry at either end is passed through: a place's ways are one
 * row per way on a line (`findLinkedThatWay`), never versions of one another.
 *
 * Pure. The server's graph reads (the prompt's layers, a build's seeds, its
 * apply) and the workspace's `edgesOnLine` all call it, so a prompt and the
 * canvas read the same ties. Call it on rows the line already reads: it picks
 * among them and cuts nothing by date.
 */
import type { Line } from "./lineReading"

/** A relationship row, as little of it as the choice needs. */
export interface TieVersionLike {
	branchId?: number | null
	fromNodeId?: number | null
	toNodeId?: number | null
	fromEntryId?: number | null
	toEntryId?: number | null
	relationshipType?: string
	historyEntryId?: number | null
}

/** The tie and date a cast-tie row is a version of; null for any other link. */
function versionKey(row: TieVersionLike): string | null {
	if (
		row.fromNodeId == null ||
		row.toNodeId == null ||
		row.fromEntryId != null ||
		row.toEntryId != null ||
		typeof row.relationshipType !== "string"
	)
		return null
	return JSON.stringify([
		row.fromNodeId,
		row.toNodeId,
		row.relationshipType,
		row.historyEntryId ?? null
	])
}

/**
 * The rows the line reads, with each cast tie's version at a date taken from
 * the nearest line that holds one there. Order is kept.
 */
export function nearestTieVersions<T extends TieVersionLike>(
	rows: readonly T[],
	line: Line
): T[] {
	const depthOf = (row: T): number => {
		const at = line.steps.findIndex(
			(step) => step.branchId === (row.branchId ?? null)
		)
		return at < 0 ? Number.POSITIVE_INFINITY : at
	}
	const nearest = new Map<string, number>()
	for (const row of rows) {
		const key = versionKey(row)
		if (key === null) continue
		const depth = depthOf(row)
		if (depth < (nearest.get(key) ?? Number.POSITIVE_INFINITY))
			nearest.set(key, depth)
	}
	return rows.filter((row) => {
		const key = versionKey(row)
		return key === null || depthOf(row) === nearest.get(key)
	})
}
