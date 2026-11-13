/**
 * ⏳ The `dc-crawl-clock` boot pass (plan `PLAN-history-one-per-date-2026-11-10`,
 * build scope item 6; owner GO 2026-11-10, ★H4 Q3: "the latest `crawl-time`
 * goes into the session clock"). Dungeon Crawler kept its clock in the
 * session-scoped value `core:slot/crawl-time@1` (`"Y-MM-DD HH:MM"`); the
 * session now keeps one story clock in `sessions.story_clock_*`. This pass
 * copies the value across, once, and is deleted with the attic at the RC1
 * squash.
 *
 * **Owns:** setting the five clock columns of a Dungeon Crawler session that
 * has none. It does **not** own the clock (`state/storyTime.ts`) or the
 * old value: `crawl-time` rows stay where they are.
 *
 * - **Which sessions.** Genre `core:genre/dungeon-crawler` with
 *   `story_clock_year IS NULL`. A session that has a clock is never touched,
 *   which is also what makes a second boot a no-op.
 * - **The value** is read as the session reads it (`valueOf`, session owner).
 *   The parts are written verbatim: the old writer rolled days into months
 *   with Gregorian lengths, so they land in the own book's calendar. A value
 *   that is absent is counted `noValue`; one that does not parse, or that
 *   story time refuses (`clockProblem`), `unreadable`; both are left.
 * - **Not critical.** A session whose write throws is counted in `failed`,
 *   logged by id, and the pass goes on; after the loop a non-zero `failed`
 *   throws one error naming the count (`failsHealth`).
 */
import { sql } from "drizzle-orm"
import { rawRows } from "$lib/server/db/rawRows"

export interface DcCrawlClockReport {
	/** Sessions found with no clock. */
	sessions: number
	clocksSet: number
	/** No `crawl-time` value to carry. */
	noValue: number
	/** A value that does not read as a date and time. */
	unreadable: number
	/** Sessions whose write threw. */
	failed: number
}

const SHAPE = /^(-?\d+)-(\d+)-(\d+)(?:[ T](\d+):(\d+))?$/

export async function dcCrawlClock(db: Db): Promise<DcCrawlClockReport> {
	const report: DcCrawlClockReport = {
		sessions: 0,
		clocksSet: 0,
		noValue: 0,
		unreadable: 0,
		failed: 0
	}
	const ids = rawRows<{ id: number }>(
		await db.execute(sql`
			select id from sessions
			where genre_id = 'core:genre/dungeon-crawler' and story_clock_year is null
			order by id
		`)
	).map((r) => Number(r.id))
	if (!ids.length) return report
	report.sessions = ids.length

	const { valueOf } = await import("$lib/server/state/resolve")
	const { clockColumns, clockProblem } = await import(
		"$lib/server/state/storyTime"
	)
	const { sessions } = await import("$lib/server/db/schema")
	const { and, eq, isNull } = await import("drizzle-orm")

	for (const id of ids) {
		try {
			const value = await valueOf(db, {
				sessionId: id,
				owner: { kind: "session", id },
				slotId: "core:slot/crawl-time@1"
			})
			if (value === undefined || value === null || value === "") {
				report.noValue++
				continue
			}
			const m = typeof value === "string" ? SHAPE.exec(value.trim()) : null
			if (!m) {
				report.unreadable++
				continue
			}
			const clock = {
				year: Number(m[1]),
				month: Number(m[2]),
				day: Number(m[3]),
				hour: m[4] === undefined ? null : Number(m[4]),
				minute: m[5] === undefined ? null : Number(m[5])
			}
			if (clockProblem(clock, null)) {
				report.unreadable++
				continue
			}
			await db
				.update(sessions)
				// The session's `updated_at` stays: a boot pass is not activity.
				.set({ ...clockColumns(clock), updatedAt: sql`${sessions.updatedAt}` })
				.where(and(eq(sessions.id, id), isNull(sessions.storyClockYear)))
			report.clocksSet++
		} catch (err) {
			report.failed++
			console.error(`[dc-crawl-clock] session ${id} failed and was left:`, err)
		}
	}
	if (report.failed > 0)
		throw new Error(
			`${report.failed} Dungeon Crawler session(s) could not have their clock set; see the log`
		)
	return report
}
