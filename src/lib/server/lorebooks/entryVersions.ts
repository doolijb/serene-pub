/**
 * The write of an entry's dated version on a line (an `entry_amendments` row
 * with `base` NULL), and the two checks every such write makes: the version is
 * not dated before the entry's Beginning, and a second write at one entry, line
 * and date updates the first.
 *
 * Owns: `writeEntryVersion`, `beginningRefusal` / `assertAtOrAfterBeginning`,
 * `ownChangeAt`. Does not own: a held change in a session's notes (`base` set;
 * `host.ts` and `ownBook.ts` write those); the per-turn record (`imprints.ts`)
 * and the edit history (`redlines.ts`), which the caller files.
 *
 * A leaf: it never imports `$lib/server/db`; every function takes its handle,
 * and inside a transaction that handle is the caller's `tx`.
 */
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { bookCalendarOf } from "$lib/server/state/storyTime"
import { takesBeginning } from "$lib/server/utils/lorebookEntries"
import {
	compareDates,
	dayOnly,
	formatDate,
	type StoryDate
} from "$lib/shared/lorebooks/storyDate"

/**
 * The sentence refusing a change dated before its entry's Beginning, or null.
 * An entry that has a Beginning is not read before it: the Beginning's own day
 * is allowed, and an entry of a type that keeps its own date (history) or has
 * none is not judged. Only `tx`.
 */
export async function beginningRefusal(
	tx: Db,
	lorebookId: number,
	entryId: number,
	change: StoryDate
): Promise<string | null> {
	const [entry] = await tx
		.select({ typeId: schema.lorebookEntries.typeId, fields: schema.lorebookEntries.fields })
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.id, entryId))
		.limit(1)
	if (!entry || !takesBeginning(entry.typeId)) return null
	const f = (entry.fields ?? {}) as Record<string, unknown>
	if (typeof f.year !== "number") return null
	const beginning: StoryDate = {
		year: f.year,
		month: typeof f.month === "number" ? f.month : null,
		day: typeof f.day === "number" ? f.day : null
	}
	if (compareDates(dayOnly(change), dayOnly(beginning)) >= 0) return null
	const calendar = await bookCalendarOf(tx, lorebookId)
	return (
		`This entry began at ${formatDate(beginning, calendar)}, so a change can't be dated ` +
		`${formatDate(change, calendar)}, before it. Date the change at or after ${formatDate(beginning, calendar)}.`
	)
}

/** Throws the refusal sentence of `beginningRefusal`. Call it inside the write's transaction, after the book's lock. */
export async function assertAtOrAfterBeginning(
	tx: Db,
	lorebookId: number,
	entryId: number,
	change: StoryDate
): Promise<void> {
	const sentence = await beginningRefusal(tx, lorebookId, entryId, change)
	if (sentence) throw new Error(sentence)
}

/**
 * The line's own stored change of an entry at exactly one date (a held
 * amendment, `base` set, is a session's and never counts). An entry has at most
 * one per line and date; old data may hold several, the highest id answers.
 * `exceptId` leaves out the row being moved. Only `tx`.
 */
export async function ownChangeAt(
	tx: Db,
	at: {
		entryId: number
		branchId: number | null
		date: StoryDate
		exceptId?: number
	}
) {
	const t = schema.entryAmendments
	const [row] = await tx
		.select({ id: t.id, fields: t.fields, historyEntryId: t.historyEntryId })
		.from(t)
		.where(
			and(
				eq(t.entryId, at.entryId),
				at.branchId == null ? isNull(t.branchId) : eq(t.branchId, at.branchId),
				eq(t.year, at.date.year),
				at.date.month == null ? isNull(t.month) : eq(t.month, at.date.month),
				at.date.day == null ? isNull(t.day) : eq(t.day, at.date.day),
				isNull(t.base),
				at.exceptId == null ? undefined : ne(t.id, at.exceptId)
			)
		)
		.orderBy(desc(t.id))
		.limit(1)
	return row
}

export type EntryVersionWrite =
	| { kind: "made"; id: number; after: Record<string, unknown> }
	| {
			kind: "merged"
			id: number
			before: Record<string, unknown>
			after: Record<string, unknown>
	  }

/**
 * Writes an entry's dated version on a line: the line's existing version at
 * that date takes `fields` over its own (other keys kept), else a row is made.
 * Takes the book's lock (re-entrant), refuses a date before the entry's
 * Beginning, and files no per-turn record and no edit history. Only `tx`.
 */
export async function writeEntryVersion(
	tx: Db,
	input: {
		lorebookId: number
		entryId: number
		branchId: number | null
		date: StoryDate
		fields: Record<string, unknown>
		historyEntryId?: number | null
	}
): Promise<EntryVersionWrite> {
	const { lorebookId, entryId, branchId, date, fields, historyEntryId } = input
	await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
	await assertAtOrAfterBeginning(tx, lorebookId, entryId, date)
	const taken = await ownChangeAt(tx, { entryId, branchId, date })
	if (taken) {
		const before = (taken.fields ?? {}) as Record<string, unknown>
		const after = { ...before, ...fields }
		await tx
			.update(schema.entryAmendments)
			.set({
				fields: after,
				historyEntryId: historyEntryId ?? taken.historyEntryId,
				updatedAt: new Date()
			})
			.where(eq(schema.entryAmendments.id, taken.id))
		return { kind: "merged", id: taken.id, before, after }
	}
	const [row] = await tx
		.insert(schema.entryAmendments)
		.values({
			lorebookId,
			entryId,
			branchId,
			year: date.year,
			month: date.month,
			day: date.day,
			fields,
			historyEntryId: historyEntryId ?? null
		})
		.returning({ id: schema.entryAmendments.id })
	return { kind: "made", id: row!.id, after: fields }
}
