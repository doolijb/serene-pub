/**
 * 🚧 **Move down the tree** — the server's one writer of an entry's line toward
 * main: `lorebook_entries.branch_id` set to a line the entry's line was forked
 * from, for good, in one transaction under the book's lock. The rule it applies
 * is `$lib/shared/lorebooks/moveDownTheTree`, the same one the workspace's
 * dialog reads.
 *
 * Owns: that one column write, the standing-record refusal, and the sessions a
 * move changes the reading of. The line delete's `keepHistoryForForks` is the
 * other writer of `branch_id` (for the History entries of a deleted line).
 *
 * Does not own: a merge, a copy to a sibling line, a move up, the edit history
 * (a move leaves no redline: the redline keys carry no line), the entry's dated
 * changes and links (they stay on the line they were written on).
 *
 * ⚠ Every function takes its handle: `moveEntriesDownTheTree` only inside
 * `db.transaction`, with its `tx`. Never statically imports `$lib/server/db`.
 */
import { and, eq, inArray, isNull, or } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { formatDate } from "$lib/shared/lorebooks/storyDate"
import {
	linesStartingToRead,
	moveDownProblems,
	moveDownSentence,
	type TreeRow
} from "$lib/shared/lorebooks/moveDownTheTree"
import { historyEntryDate } from "$lib/server/state/reading"
import { bookCalendarOf, lockBookCalendar } from "$lib/server/state/storyTime"
import { timelineOfBook } from "./timeline"

/** The refusal for an entry of a session's notes. */
export const NOTES_REFUSAL =
	"Entries in a session's notes don't move between lines."

/** The refusal while a session's turn still holds a take-back on the entry. */
export function standingImprintRefusal(name: string): string {
	return `A session's turn made or changed ${name} and can still take it back. It can move once that scene settles, or once you keep or revert that change.`
}

/**
 * Moves `entryIds` (all on one line) to `target`, a line that line was forked
 * from (NULL = main). Throws the refusal's sentence. `startedLines` are the
 * lines that read the entries now and did not before.
 */
export async function moveEntriesDownTheTree(
	tx: Db,
	p: { lorebookId: number; entryIds: number[]; target: number | null }
): Promise<{
	moved: { id: number; typeId: string }[]
	source: number
	startedLines: (number | null)[]
}> {
	await lockBookCalendar(tx, p.lorebookId)

	const lines = await tx
		.select({
			id: schema.lorebookBranches.id,
			name: schema.lorebookBranches.name,
			forkedFromBranchId: schema.lorebookBranches.forkedFromBranchId,
			forkYear: schema.lorebookBranches.forkYear,
			forkMonth: schema.lorebookBranches.forkMonth,
			forkDay: schema.lorebookBranches.forkDay
		})
		.from(schema.lorebookBranches)
		.where(eq(schema.lorebookBranches.lorebookId, p.lorebookId))
	if (p.target != null && !lines.some((b) => b.id === p.target))
		throw new Error("That branch is not a line of this lorebook.")

	const entries = await tx
		.select({
			id: schema.lorebookEntries.id,
			typeId: schema.lorebookEntries.typeId,
			title: schema.lorebookEntries.title,
			branchId: schema.lorebookEntries.branchId,
			anchorEntryId: schema.lorebookEntries.anchorEntryId,
			fields: schema.lorebookEntries.fields
		})
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, p.lorebookId))
	const rows: TreeRow[] = entries.map((e) => ({
		id: e.id,
		name: e.title?.trim() || "Untitled",
		isHistory: e.typeId === HISTORY_TYPE_ID,
		branchId: e.branchId,
		anchorEntryId: e.anchorEntryId,
		date: historyEntryDate(e.fields)
	}))
	const byId = new Map(entries.map((e) => [e.id, e]))
	if (p.entryIds.some((id) => !byId.has(id)))
		throw new Error("Entry not found or access denied.")

	const calendar = await bookCalendarOf(tx, p.lorebookId)
	const lineNames = new Map(lines.map((b) => [b.id, b.name]))
	const [problem] = moveDownProblems({
		ids: p.entryIds,
		rows,
		target: p.target,
		branches: lines
	})
	if (problem)
		throw new Error(
			moveDownSentence(problem, {
				lineName: (id) =>
					id == null ? "main" : (lineNames.get(id) ?? "that line"),
				date: (d) => formatDate(d, calendar),
				timeline: await timelineOfBook(tx, p.lorebookId)
			})
		)

	const standing = await tx
		.select({ subjectId: schema.loreImprints.subjectId })
		.from(schema.loreImprints)
		.where(
			and(
				eq(schema.loreImprints.subjectKind, "entry"),
				inArray(schema.loreImprints.subjectId, p.entryIds),
				// A standing record's take-back, or a kept record of the row
				// having been made (no field), whose Revert deletes the row:
				// either would remove the entry from every line now reading it.
				or(
					eq(schema.loreImprints.status, "standing"),
					and(
						eq(schema.loreImprints.status, "kept"),
						isNull(schema.loreImprints.field)
					)
				)
			)
		)
	if (standing.length > 0) {
		const first = p.entryIds.find((id) =>
			standing.some((s) => s.subjectId === id)
		)!
		throw new Error(
			standingImprintRefusal(rows.find((r) => r.id === first)!.name)
		)
	}

	await tx
		.update(schema.lorebookEntries)
		.set({ branchId: p.target })
		.where(inArray(schema.lorebookEntries.id, p.entryIds))

	const movingRows = rows.filter((r) => p.entryIds.includes(r.id))
	const source = movingRows[0].branchId as number
	return {
		moved: p.entryIds.map((id) => ({ id, typeId: byId.get(id)!.typeId })),
		source,
		startedLines: linesStartingToRead(movingRows, source, p.target, lines)
	}
}

/** The sessions of the book played on any of `lines` (NULL = main), in id order. */
export async function sessionsOnLines(
	db: Db,
	lorebookId: number,
	lines: (number | null)[]
): Promise<number[]> {
	if (lines.length === 0) return []
	const ids = lines.filter((l): l is number => l != null)
	const conditions = [
		...(ids.length > 0
			? [inArray(schema.sessions.lorebookBranchId, ids)]
			: []),
		...(lines.includes(null)
			? [isNull(schema.sessions.lorebookBranchId)]
			: [])
	]
	const rows = await db
		.select({ id: schema.sessions.id })
		.from(schema.sessions)
		.where(
			and(eq(schema.sessions.lorebookId, lorebookId), or(...conditions))
		)
		.orderBy(schema.sessions.id)
	return rows.map((r) => r.id)
}
