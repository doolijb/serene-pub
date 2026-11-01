/**
 * 🚧 **Whole hour marks a story-clock move crossed** (M0, lane T1):
 * what `event.payload.clock.hours` holds for `core:event/story-clock-moved@1`,
 * read by `core:function/recurring@1 { every: 'hour' }`.
 *
 * `⌊toMinute/60⌋ − ⌊fromMinute/60⌋` on an absolute minute count
 * (`dayIndex * 1440 + hour * 60 + minute`, a missing hour or minute = 0),
 * never below 0. With a calendar the day index is SDK `storyDayIndex`;
 * free-form it is the `day` itself, and only when both ends share year and
 * month (a free-form book has no month lengths to count across). Anything
 * that cannot be placed is `undefined`: the event carries no `hours`.
 */
import { and, eq, sql } from "drizzle-orm"
import { rulesetSections, storyDayIndex, type RulesetDecl, type StoryCalendar, type StoryTime } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"

export function hoursCrossed(from: StoryTime, to: StoryTime, calendar: StoryCalendar | null): number | undefined {
	let a: number | null
	let b: number | null
	if (calendar) {
		a = storyDayIndex(from, calendar)
		b = storyDayIndex(to, calendar)
	} else if (from.year === to.year && (from.month ?? null) === (to.month ?? null)) {
		a = from.day ?? null
		b = to.day ?? null
	} else return undefined
	if (a == null || b == null) return undefined
	const minuteOf = (t: StoryTime, day: number): number => day * 1440 + (t.hour ?? 0) * 60 + (t.minute ?? 0)
	return Math.max(0, Math.floor(minuteOf(to, b) / 60) - Math.floor(minuteOf(from, a) / 60))
}

/** The sentence the ledger note says. */
const WAITS_FOR_CLOCK = "The story has no clock yet; hourly routines wait."

/** Does the ruleset use `core:function/recurring@1` every hour? Read off its function references. */
export function usesHourlyRecurring(ruleset: RulesetDecl): boolean {
	return (rulesetSections(ruleset).functions ?? []).some(
		(f) => f.ref === "core:function/recurring@1" && f.options?.every === "hour"
	)
}

/**
 * 🚧 **Hourly steps wait for a clock** (M0, lane T1): a session with no
 * story clock gets no hourly steps, and its state ledger says so ONCE — a
 * skipped, by-0 clock note; asked again, it writes nothing more.
 */
export async function noteHourlyWaitsForClock(db: Db, sessionId: number): Promise<void> {
	const [standing] = await db
		.select({ id: schema.stateProposals.id })
		.from(schema.stateProposals)
		.where(
			and(
				eq(schema.stateProposals.sessionId, sessionId),
				eq(schema.stateProposals.kind, "clock"),
				eq(schema.stateProposals.status, "skipped"),
				sql`${schema.stateProposals.payload}->>'skipped' = ${WAITS_FOR_CLOCK}`
			)
		)
		.limit(1)
	if (standing) return
	const { recordClockMove } = await import("$lib/server/state/clockMoves")
	await recordClockMove(db, {
		sessionId,
		by: 0,
		unit: "hours",
		cause: "tick",
		updatedBy: "core:rulesets",
		skipped: WAITS_FOR_CLOCK
	})
}
