/**
 * 🚧 THE one reading of §0-B for unfiled scenes: **an unfiled scene belongs to
 * the history entry of its day** (`historyEntryOfDate`'s rule, read-only, on the
 * scene's own line). Every place that asks "which unfiled scenes would this
 * entry take?" asks here: the compile press and its Apply (`sockets/scenes.ts`),
 * the history list's `unfiledSceneCount` (`sockets/entries.ts`) and the
 * lorebook export (`utils/lorebookExportBuilder.ts`).
 *
 * - A scene's day is its opened story clock's date: none without a year; a day
 *   with no month is dropped (a Day-count clock dates by its year alone).
 * - Only the scenes `line` reads (main's shared ones and the chain's own, each
 *   ancestor's up to its fork cut); the export asks for main's.
 * - The book's history rows are read once per call, one `lineOfBook` per
 *   distinct scene line, and each (line, day) group goes through
 *   `pickEntryOfDate` — the same rule `historyEntryOfDate` runs. A scene whose
 *   line is not the book's (`BranchRefusal`) is skipped, never thrown.
 *
 * Read-only. Takes the caller's handle (`tx` inside a transaction).
 */
import { and, asc, eq, isNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { BranchRefusal, lineOfBook } from "$lib/server/state/reading"
import { onLineSql } from "$lib/server/state/lineSql"
import { rowsReadingOnLine, type Line } from "$lib/shared/lorebooks/lineReading"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
import { HISTORY_TYPE_ID } from "$lib/server/utils/lorebookEntries"
import { dayOnly, pickEntryOfDate } from "./historyEntryOfDate"

type SceneRow = typeof schema.scenes.$inferSelect

/** The scene's day: no year → none; else its opening clock through the one `dayOnly` rule. */
export function sceneDay(scene: SceneRow): StoryDate | null {
	const year = scene.openedStoryClockYear
	if (year == null) return null
	return dayOnly({
		year,
		month: scene.openedStoryClockMonth ?? null,
		day: scene.openedStoryClockDay ?? null
	})
}

/** History entry id → its unfiled scenes, in id order. */
export async function unfiledScenesByEntry(
	db: Db,
	at: { lorebookId: number; line: Line }
): Promise<Map<number, SceneRow[]>> {
	const { lorebookId, line } = at
	const found = await db.query.scenes.findMany({
		where: and(
			isNull(schema.scenes.historyEntryId),
			eq(schema.scenes.lorebookId, lorebookId),
			onLineSql(schema.scenes.branchId, line)
		),
		orderBy: asc(schema.scenes.id)
	})
	const rows = rowsReadingOnLine(found, line, sceneDay)

	const groups = new Map<
		string,
		{ branchId: number | null; date: StoryDate | null; rows: SceneRow[] }
	>()
	for (const scene of rows) {
		const branchId = scene.branchId ?? null
		const date = sceneDay(scene)
		const key = `${branchId}|${date ? `${date.year}-${date.month}-${date.day}` : "none"}`
		const group = groups.get(key)
		if (group) group.rows.push(scene)
		else groups.set(key, { branchId, date, rows: [scene] })
	}

	const byEntry = new Map<number, SceneRow[]>()
	if (groups.size === 0) return byEntry

	const historyRows = await db
		.select({
			id: schema.lorebookEntries.id,
			branchId: schema.lorebookEntries.branchId,
			fields: schema.lorebookEntries.fields,
			position: schema.lorebookEntries.position
		})
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
			)
		)
	// A scene's line is its own branch's, once per distinct branch; a refusal
	// is remembered as null and skips every group on it.
	const lines = new Map<number | null, Line | null>()
	for (const group of groups.values()) {
		if (!lines.has(group.branchId)) {
			try {
				lines.set(
					group.branchId,
					await lineOfBook(db, lorebookId, group.branchId)
				)
			} catch (e) {
				if (!(e instanceof BranchRefusal)) throw e
				lines.set(group.branchId, null)
			}
		}
		const groupLine = lines.get(group.branchId)
		if (!groupLine) continue
		const answer = pickEntryOfDate(historyRows, groupLine, group.date)
		if (!answer) continue
		byEntry.set(
			answer.historyEntryId,
			[...(byEntry.get(answer.historyEntryId) ?? []), ...group.rows].sort(
				(a, b) => a.id - b.id
			)
		)
	}
	return byEntry
}
