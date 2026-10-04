/**
 * The cast's presences as a session reads them — `core:query/cast-presences@1`
 * (plan E-2, owner ruling R4; built 2026-10-02).
 *
 * The HOST resolves the line: a session's line is its own presences plus each
 * ancestor's that begin at or before the fork cut (`presencesOnLine`, the one
 * filter the member page, the World bar and the Lives lens read through), so
 * no node ever sees another line's spans. What it hands back is the rows and
 * the moment the session reads at; judging a moment is the reader's
 * (`core:task/eligibility@1`, through `holdsAt`).
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { presencesOnLine, type Presence } from "$lib/shared/lorebooks/presence"
import { formatDate, type StoryDate } from "$lib/shared/lorebooks/storyDate"
import { sessionReadingOf } from "$lib/server/state/reading"
import { bookCalendarOf } from "$lib/server/state/storyTime"

/** One presence, in the node's shape: dates as story dates, `until` exclusive. */
export interface PresenceRow {
	bindingId: number
	from: StoryDate
	until: StoryDate | null
	position: number | null
}

export interface PresencesOnReading {
	rows: PresenceRow[]
	/**
	 * The moment the session reads at; null is the head ("now"). Carries
	 * `label`, the moment spelled through the book's calendar, so a sentence
	 * about it reads as every other date of the book does (wave 8 leftover).
	 */
	at: (StoryDate & { label?: string }) | null
}

const date = (
	year: number | null | undefined,
	month: number | null | undefined,
	day: number | null | undefined
): StoryDate | null =>
	year == null
		? null
		: {
				year,
				...(month != null ? { month } : {}),
				...(day != null ? { day } : {})
			}

/**
 * The presences on the session's line, and the moment it reads at. A session
 * with no book reads nothing, at the head.
 */
export async function presencesOnReading(
	db: Db,
	sessionId: number
): Promise<PresencesOnReading> {
	const reading = await sessionReadingOf(db, sessionId)
	if (!reading) return { rows: [], at: null }
	const stored = await db
		.select()
		.from(schema.castPresences)
		.where(eq(schema.castPresences.lorebookId, reading.lorebookId))
	const presences: Presence[] = stored.map((p) => ({
		id: p.id,
		castId: p.lorebookBindingId,
		branchId: p.branchId,
		personalPosition: p.personalPosition,
		fromYear: p.fromYear,
		fromMonth: p.fromMonth,
		fromDay: p.fromDay,
		untilYear: p.untilYear,
		untilMonth: p.untilMonth,
		untilDay: p.untilDay
	}))
	return {
		rows: presencesOnLine(presences, reading.line).map((p) => ({
			bindingId: p.castId,
			from: date(p.fromYear, p.fromMonth, p.fromDay)!,
			until: date(p.untilYear, p.untilMonth, p.untilDay),
			position: p.personalPosition ?? null
		})),
		at: reading.moment
			? {
					...reading.moment,
					label: formatDate(
						reading.moment,
						await bookCalendarOf(db, reading.lorebookId)
					)
				}
			: null
	}
}
