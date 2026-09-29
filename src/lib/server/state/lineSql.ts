/**
 * The line rule, as SQL.
 *
 * `$lib/shared/lorebooks/lineReading.ts` decides which rows and which
 * amendments are on the line being read; this is the same decision as a
 * Drizzle predicate, so a server read can filter in the database instead of
 * loading every line's rows and dropping most of them. The two MUST agree —
 * `lineSql.int.test.ts` runs both over one table of cases.
 *
 * Build the `Line` with `lineOfBook` (`./reading.ts`, validates the branch
 * against the book) or `lineOf` (shared, from a branch list already loaded).
 *
 * ⚠ Main is `IS NULL` alone, never "no condition". A fork's own rows are rows
 * main does not have, so an unfiltered read is not main's reading; it is every
 * line at once.
 */
import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm"
import type { AnyPgColumn } from "drizzle-orm/pg-core"
import {
	earlierCut,
	lineBranchIds,
	type Line
} from "$lib/shared/lorebooks/lineReading"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"

/**
 * "Shared, or on a line of the chain" — membership only, no dates.
 *
 * The mirror of `isOnLine` / `rowsOnLine`. For a table whose rows carry no
 * story date (entries, scenes, edges, bindings).
 */
export function onLineSql(branchColumn: AnyPgColumn, line: Line): SQL {
	const ids = lineBranchIds(line)
	if (!ids.length) return isNull(branchColumn)
	return or(
		isNull(branchColumn),
		ids.length === 1 ? eq(branchColumn, ids[0]) : inArray(branchColumn, ids)
	)!
}

/** A row's date parts, as columns (or expressions). `year` NULL = undated. */
export interface DateColumns {
	year: AnyPgColumn | SQL
	month: AnyPgColumn | SQL
	day: AnyPgColumn | SQL
}

/**
 * `date <= cut`, by `compareDates`: year, then month, then day, an absent part
 * counting as 0. A row comparison, so it is one index-friendly expression.
 */
export function dateAtOrBeforeSql(cols: DateColumns, cut: StoryDate): SQL {
	return sql`(${cols.year}, coalesce(${cols.month}, 0), coalesce(${cols.day}, 0)) <= (${cut.year}::int, ${cut.month ?? 0}::int, ${cut.day ?? 0}::int)`
}

/**
 * The full rule for DATED rows: on the chain, and — per step — dated at or
 * before the earlier of the moment and that step's fork cut. An undated row
 * (`year` NULL) is never cut. The mirror of `rowReadsOnLine` and of
 * `amendmentsOnLine`'s filter (it does not order; order in the caller or
 * resolve with `amendmentsOnLine` after the read).
 *
 * `moment` null is the head: only the fork cuts apply.
 */
export function onLineAtSql(
	branchColumn: AnyPgColumn,
	date: DateColumns,
	line: Line,
	moment: StoryDate | null = null
): SQL {
	const arms = line.steps.map((step) => {
		const onStep =
			step.branchId === null
				? isNull(branchColumn)
				: eq(branchColumn, step.branchId)
		const cut = earlierCut(step.cut, moment)
		if (cut === null) return onStep
		return and(onStep, or(isNull(date.year), dateAtOrBeforeSql(date, cut)))!
	})
	return arms.length === 1 ? arms[0] : or(...arms)!
}

/**
 * A history entry's date, read out of its `fields` (jsonb), as `DateColumns`.
 *
 * Only a JSON NUMBER counts, matching the workspace (`typeof row.year ===
 * "number"`); anything else is undated — never cut. Live writes refuse a
 * non-integer declared field (`assertDeclaredFields`), so a stored string is
 * a legacy row, and reading it as undated keeps it visible rather than guessing.
 */
export function historyDateColumns(fieldsColumn: AnyPgColumn | SQL): DateColumns {
	// The key is one of three literals, never input: raw, so `->` resolves
	// to the text-key operator rather than guessing a parameter's type.
	const part = (key: "year" | "month" | "day") => {
		const k = sql.raw(`'${key}'`)
		return sql`(case when jsonb_typeof(${fieldsColumn}->${k}) = 'number' then (${fieldsColumn}->>${k})::numeric::int end)`
	}
	return { year: part("year"), month: part("month"), day: part("day") }
}
