/**
 * 🚧 §0-B (owner, 2026-11-04): **a scene compiles into the history entry of
 * its date when one exists on the book, else creates that dated entry; scene
 * open creates nothing.** This is the date-match half of the rule — the one
 * place that answers "which history entry is this date's" — shared by the
 * compile (which files a scene) and the export (which nests an unfiled scene
 * under the entry its compile would fill).
 *
 * - The entry of a date is the history entry dated exactly that day that the
 *   line reads (`rowReadsOnLine` — never a sibling line's, nor an ancestor's
 *   dated past the line's fork); of several, the lowest id (`historyEntryOver`).
 * - The date is the day alone: a clock's hour and minute never count, and a
 *   **Day-count clock** (a day with no month, 13c) dates by its year only —
 *   a day is stored only beside a month (`A day needs a month.`).
 * - No date (a scene with no clock): the newest dated entry the line reads,
 *   else the entry dated Year 1, Month 1, Day 1, as a session's other lore
 *   writes start (`historyDateOfSessionWrite`).
 * - `pickEntryOfDate` is the pure date-match over already-read rows (a caller
 *   that holds the book's history rows once asks it per line and day).
 * - `create: false` only reads, and answers null where no entry matches;
 *   `create: true` makes the dated entry there, placed after the book's last
 *   history entry, on the line that owns the date (`historyOwnerStep`, rule C,
 *   owner 2026-11-10), which may be an ancestor of the asked line. It is safe
 *   without a further check: when the asked line reads no entry on that day,
 *   the owning line has no own entry on that day either, since the asked line
 *   reads every own row of the owning step at that date. The asked line always
 *   reads the row it gets back.
 * - `assertHistoryDateFree` is the check a direct write runs: one history entry
 *   per date per line.
 *
 * Inside the caller's transaction (`tx` only), which holds the book's lock
 * (`lockBookCalendar`) when it may create. Throws `BranchRefusal` for a line
 * that is not the book's; the caller words it.
 */
import { and, desc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { assertDateLands, bookCalendarOf } from "$lib/server/state/storyTime"
import {
	BranchRefusal,
	historyEntryDate,
	historyEntryOver,
	lineOfBook
} from "$lib/server/state/reading"
import {
	forkDateOf,
	historyOwnerStep,
	lineOf,
	rowReadsOnLine,
	type Line
} from "$lib/shared/lorebooks/lineReading"
import {
	compareDates,
	dayOnly,
	formatDate,
	type StoryDate
} from "$lib/shared/lorebooks/storyDate"
import { HISTORY_TYPE_ID, entryInsert } from "$lib/server/utils/lorebookEntries"

/** Which history entry a date is filed under, and whether this call made it. */
interface HistoryEntryOfDate {
	historyEntryId: number
	/** The dated entry was created by this call (`create: true` and none matched). */
	created: boolean
	/** The date of the entry found or made. */
	date: StoryDate
}

export { dayOnly }

/** Where a scene starts on its lane: its opening line, else (tick selection) its smallest selected line; neither — null, it starts nowhere. The ONE scene-start rule (`sceneNameFor`'s numbering, `sceneDisplayNames`, the scene update's default name). */
export function sceneStartOf(scene: {
	openedAtMessageId: number | null
	selectedMessageIds: number[] | null
}): number | null {
	return (
		scene.openedAtMessageId ??
		(scene.selectedMessageIds?.length
			? Math.min(...scene.selectedMessageIds)
			: null)
	)
}

/**
 * The date-match over history rows already read: the entry `date`'s day
 * names on `line`, else (no date) the newest dated entry the line reads. Pure.
 * Newest date wins; of equal dates, the lower id (`historyEntryOver`).
 */
export function pickEntryOfDate(
	rows: ReadonlyArray<{
		id: number
		branchId: number | null
		fields: unknown
	}>,
	line: Line,
	date: StoryDate | null
): { historyEntryId: number; date: StoryDate } | null {
	const target = date ? dayOnly(date) : null
	let best: { id: number; date: StoryDate } | null = null
	for (const row of rows) {
		const rowDate = historyEntryDate(row.fields)
		if (!rowDate || !rowReadsOnLine(row, line, rowDate)) continue
		// A date's entry is dated that day; with no date, any dated entry
		// competes and the newest wins.
		if (target && compareDates(rowDate, target) !== 0) continue
		if (!best || historyEntryOver({ id: row.id, date: rowDate }, best))
			best = { id: row.id, date: rowDate }
	}
	return best ? { historyEntryId: best.id, date: best.date } : null
}

export async function historyEntryOfDate(
	tx: Db,
	at: { lorebookId: number; branchId: number | null; date: StoryDate | null },
	opts: { create: true; calendarBookId?: number }
): Promise<HistoryEntryOfDate>
export async function historyEntryOfDate(
	tx: Db,
	at: { lorebookId: number; branchId: number | null; date: StoryDate | null },
	opts: { create: boolean; calendarBookId?: number }
): Promise<HistoryEntryOfDate | null>
export async function historyEntryOfDate(
	tx: Db,
	at: { lorebookId: number; branchId: number | null; date: StoryDate | null },
	opts: { create: boolean; calendarBookId?: number }
): Promise<HistoryEntryOfDate | null> {
	const { lorebookId, branchId } = at
	const line = await lineOfBook(tx, lorebookId, branchId)
	const rows = await tx
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
	const best = pickEntryOfDate(rows, line, at.date)
	if (best)
		return {
			historyEntryId: best.historyEntryId,
			created: false,
			date: best.date
		}
	if (!opts.create) return null

	// Nothing on the line is dated that day: make the entry, dated at it —
	// or at Year 1, Month 1, Day 1 for a scene with no date on a line with no
	// dated entry at all.
	const target = at.date ? dayOnly(at.date) : null
	const date = target ?? { year: 1, month: 1, day: 1 }
	// 🚧 `calendarBookId`: the book whose calendar the new day's date must land
	// in — a session's notes file a day dated in the calendar of the lorebook it
	// reads. Absent, the book the entry is made in (as always).
	await assertDateLands(tx, opts.calendarBookId ?? lorebookId, date)
	const [last] = await tx
		.select({ position: schema.lorebookEntries.position })
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
			)
		)
		.orderBy(desc(schema.lorebookEntries.position))
		.limit(1)
	const [created] = await tx
		.insert(schema.lorebookEntries)
		.values(
			entryInsert({
				typeId: HISTORY_TYPE_ID,
				lorebookId,
				keys: [],
				content: "",
				year: date.year,
				month: date.month ?? null,
				day: date.day ?? null,
				position: (last?.position ?? -1) + 1,
				branchId: historyOwnerStep(line, date).branchId
			} as any)
		)
		.returning({ id: schema.lorebookEntries.id })
	return { historyEntryId: created.id, created: true, date }
}

/**
 * **Does the lorebook hold this day** — the one answer: the lorebook's history
 * entry dated that day on the line the session reads it on (the rule
 * `historyEntryOfDate(…, { create: false })` answers by: dated exactly that day,
 * read by the line, the lowest id of several), or null. Every caller that asks
 * whether a day is the lorebook's asks here.
 *
 * ⚠ The ruled, unbuilt "coarser covers finer" (E4, owner 2026-11-11) will
 * change this: a lorebook entry dated Year 2 will then hold Year 2 Month 5's
 * day too, and this is the one place to say so. Reads only.
 */
export async function lorebookDayOfDate(
	tx: Db,
	at: { lorebookId: number; branchId: number | null; date: StoryDate }
): Promise<{ historyEntryId: number; date: StoryDate } | null> {
	const found = await historyEntryOfDate(tx, at, { create: false })
	return found
		? { historyEntryId: found.historyEntryId, date: found.date }
		: null
}

/**
 * Rule C's refusal for a history day the line does not own (the day is at or
 * before the line's fork, so an ancestor's entry holds it), as the sentence a
 * direct write is refused with; null when the line owns the day. Throws
 * `BranchRefusal` for a branch that is not of this book. Reads only; inside the
 * caller's transaction (`tx` only).
 */
export async function historyDayOwnerRefusal(
	tx: Db,
	at: { lorebookId: number; branchId: number | null; date: StoryDate }
): Promise<string | null> {
	const day = dayOnly(at.date)
	const { lorebookId, branchId } = at
	const b = schema.lorebookBranches
	const branches = await tx
		.select({
			id: b.id,
			name: b.name,
			forkedFromBranchId: b.forkedFromBranchId,
			forkYear: b.forkYear,
			forkMonth: b.forkMonth,
			forkDay: b.forkDay
		})
		.from(b)
		.where(eq(b.lorebookId, lorebookId))
	if (branchId !== null && !branches.some((x) => x.id === branchId))
		throw new BranchRefusal(
			`branch ${branchId} is not a branch of lorebook ${lorebookId}.`
		)
	const line = lineOf(branchId, branches)
	const nameOf = (id: number | null) =>
		id == null ? "main" : (branches.find((x) => x.id === id)?.name ?? "main")
	const name = nameOf(branchId)
	const cal = await bookCalendarOf(tx, lorebookId)
	if (historyOwnerStep(line, day).branchId === branchId) return null
	const branch = branches.find((x) => x.id === branchId)!
	const fork = forkDateOf(branch)
	const parent = nameOf(historyOwnerStep(line, day).branchId)
	if (fork)
		return `${name} shares everything up to ${formatDate(fork, cal)} with ${parent}. Change that day here as an amendment, or choose a later date.`
	// 🚧 Provisional copy: the owner has not seen this sentence.
	return `${name} follows ${parent} with no fork date, so its dated history is ${parent}'s. Change that day here as an amendment.`
}

/**
 * **One history entry per date per line** (★H1/★H2, owner, 2026-11-10): throws
 * unless `date` is free for a history entry on `branchId`'s line. A date with
 * no numeric year is free (undated rows are ignored). Dates compare as the day
 * alone (`dayOnly`, `compareDates`): Year 2, Year 2 Month 5 and Year 2 Month 5
 * Day 3 are three dates. `exceptId` is the entry being re-dated.
 *
 * Rule C first: a line owns a day only after its fork date, so a fork asked
 * for a day on or before its fork (or any day, when it is dateless) is told to
 * amend instead. Then the one-per-date rule: a row dated that day that the
 * line reads (`rowReadsOnLine`) refuses it; archived rows count, they still
 * hold their date.
 *
 * Checking the target line is the whole of "any line of the book reads both
 * rows": under rule C two rows each owned by its own line can only meet on that
 * line itself (a line reads an ancestor's row at a date only when the date is
 * at or before the fork, which the nearer line does not own). A row that breaks
 * rule C (made before this rule) is ignored on other lines on purpose: a write
 * on main is never refused because of a fork; Loose ends reports such rows.
 *
 * The caller holds `lockBookCalendar(tx, lorebookId)` and passes only `tx`.
 * Errors are plain `Error`s, as `assertDateLands` throws; `BranchRefusal` for a
 * line that is not the book's.
 */
export async function assertHistoryDateFree(
	tx: Db,
	at: {
		lorebookId: number
		branchId: number | null
		date: StoryDate | null
		exceptId?: number
	}
): Promise<void> {
	if (!at.date || typeof at.date.year !== "number") return
	const day = dayOnly(at.date)
	const { lorebookId, branchId } = at
	const refusal = await historyDayOwnerRefusal(tx, {
		lorebookId,
		branchId,
		date: at.date
	})
	if (refusal) throw new Error(refusal)
	const b = schema.lorebookBranches
	const branches = await tx
		.select({
			id: b.id,
			name: b.name,
			forkedFromBranchId: b.forkedFromBranchId,
			forkYear: b.forkYear,
			forkMonth: b.forkMonth,
			forkDay: b.forkDay
		})
		.from(b)
		.where(eq(b.lorebookId, lorebookId))
	const line = lineOf(branchId, branches)
	const name =
		branchId == null ? "main" : (branches.find((x) => x.id === branchId)?.name ?? "main")
	const cal = await bookCalendarOf(tx, lorebookId)

	const rows = await tx
		.select({
			id: schema.lorebookEntries.id,
			branchId: schema.lorebookEntries.branchId,
			fields: schema.lorebookEntries.fields
		})
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
			)
		)
	for (const row of rows) {
		if (row.id === at.exceptId) continue
		const rowDate = historyEntryDate(row.fields)
		if (
			rowDate &&
			compareDates(rowDate, day) === 0 &&
			rowReadsOnLine(row, line, rowDate)
		)
			throw new Error(
				`${name} already has a history entry for ${formatDate(day, cal)}. Open it, or choose another date.`
			)
	}
}
