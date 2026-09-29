/**
 * The moment: which date the book is being read as of.
 *
 * The moment is an address — it rides in the route as `as=Y3-2-12` — so it is
 * a string here and a `StoryDate` wherever it is compared (by `compareDates`),
 * and this module is the one translation between the two. The packed number
 * (`momentValue`) is for PLACEMENT on an axis only: it collides once a month
 * or a day passes 100, so it never orders anything. Reading as of a date narrows what is in the
 * story: a dated row is in it when its date has arrived, and an undated row is
 * in it always, because a row with no date makes no claim about when.
 *
 * ⚠ **A reader first.** Editing while reading as of a date presents a choice
 * (ruled 2026-09-23): file the change as an amendment dated at this moment, or
 * change the base entry everywhere. The moment itself still edits nothing.
 */

import {
	compareDates,
	dateValue,
	formatDate,
	type StoryDate
} from "../sections/historyDates"
import {
	dateProblem,
	type StoryCalendar
} from "$lib/shared/lorebooks/storyDate"
import { momentKey, tickAtRatio, type TimelineTick } from "../timelineStrip"
import type { TimeItem } from "./storyTime"

export { momentKey }

/** The moment an absent address means. */
export const NOW_KEY = "now"

/** What the bar says on the day nothing has been dated. */
export const MOMENT_EMPTY_LINE =
	"Nothing is dated yet, date an entry and the story time fills in here"

/**
 * What the bar's track is for. It steps between the dates the book holds;
 * "Go to date" is how a reader stands anywhere else.
 */
export const MOMENT_DRAG_HINT =
	"drag to step between dated moments, or go to any date"

const KEY = /^Y(-?\d+)(?:-(\d+))?(?:-(\d+))?$/

/** The date an address names, or nothing when it names none. */
export function parseMoment(key: string | null | undefined): StoryDate | null {
	const match = key ? KEY.exec(key) : null
	if (!match) return null
	return {
		year: Number(match[1]),
		month: match[2] ? Number(match[2]) : null,
		day: match[3] ? Number(match[3]) : null
	}
}

/**
 * The moment as the axis's own unit, or null at now. PLACEMENT ONLY — order
 * with `momentDate` and `compareDates`.
 */
export function momentValue(key: string | null | undefined): number | null {
	const date = parseMoment(key)
	return date ? dateValue(date) : null
}

/** The moment as a date for ordering (`compareDates`), or null at now. */
export function momentDate(key: string | null | undefined): StoryDate | null {
	return parseMoment(key)
}

/** The moment as one key, so a drawing reading as of it can key on it. */
export function asOfKey(key: string | null | undefined): string {
	return key || NOW_KEY
}

/** The moment, named. */
export function momentLabel(key: string | null | undefined): string {
	const date = parseMoment(key)
	return date ? formatDate(date) : NOW_KEY
}

/**
 * Whether a row is in the story at this moment.
 *
 * An undated row is in it at every moment: it says nothing about when, and
 * hiding it would be reading a claim into an absence.
 */
export function isInStoryAsOf(
	date: StoryDate | null | undefined,
	moment: StoryDate | null | undefined
): boolean {
	if (moment == null || date == null) return true
	return compareDates(date, moment) <= 0
}

export interface AsOfRow {
	key: string
	/** The row's own date, or null when it carries none. */
	date: StoryDate | null
}

/** The rows not in the story yet at this moment, by key. */
export function notYetKeys(
	rows: readonly AsOfRow[],
	moment: StoryDate | null
): string[] {
	if (moment == null) return []
	return rows
		.filter((row) => !isInStoryAsOf(row.date, moment))
		.map((row) => row.key)
}

export interface CastArrival {
	id: number
	name: string
	/** The first dated thing naming them, or null when nothing dated does. */
	arrival: StoryDate | null
}

/**
 * The first dated thing naming each cast member, by binding id — by
 * `compareDates`, whatever order the items come in.
 */
export function castArrivalDates(
	items: readonly Pick<TimeItem, "date" | "present">[]
): Map<number, StoryDate> {
	const arrivals = new Map<number, StoryDate>()
	for (const item of items) {
		if (item.date == null) continue
		for (const id of item.present) {
			const was = arrivals.get(id)
			if (!was || compareDates(item.date, was) < 0)
				arrivals.set(id, item.date)
		}
	}
	return arrivals
}

export interface CastAsOf extends CastArrival {
	inStory: boolean
}

/**
 * The cast, with whoever has not arrived marked.
 *
 * A member nothing dated names counts as in the story: the book records no
 * arrival for them, and an unrecorded arrival is not a late one.
 */
export function castAsOf(
	cast: readonly CastArrival[],
	moment: StoryDate | null
): CastAsOf[] {
	return cast.map((member) => ({
		...member,
		inStory: isInStoryAsOf(member.arrival, moment)
	}))
}

export function countNotInStory(
	cast: readonly CastArrival[],
	moment: StoryDate | null
): number {
	return castAsOf(cast, moment).filter((m) => !m.inStory).length
}

const plural = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`

/** The pool at this moment, said out loud. */
export function poolAsOfSentence(total: number, notYet: number): string {
	const entries = plural(total, "entry", "entries")
	if (notYet === 0) return entries
	return `${entries} · ${notYet} not in the story yet at this moment`
}

/** The cast at this moment, said out loud. */
export function castMomentSentence(notYet: number, total: number): string {
	return `${notYet} of ${total} cast not in the story yet`
}

/**
 * How much of an entry's own history is still ahead of the moment.
 *
 * The design's sentence, pluralised: one amendment "has not happened yet", two
 * "have". Said only while a moment is set — at now nothing dated is ahead.
 */
export function amendmentsAheadSentence(notYet: number, total: number): string {
	return (
		`${notYet} of ${total} ${notYet === 1 ? "has" : "have"} not ` +
		`happened yet at this moment`
	)
}

/** The bar's own chip. */
export function momentChipLabel(key: string | null | undefined): string {
	return `Moment · ${momentLabel(key)}`
}

/**
 * What the banner over the editor says an edit made here is saved as.
 *
 * ⚠ The sentence names the CHOICE, never one outcome: at a moment a save is
 * either an amendment or a change to the base, and neither is the default.
 * The Save control is where it is made.
 */
export function momentBannerSentence(key: string): string {
	// ⚠ "it", not "the entry": this banner stands over the Cast board too,
	// where the subject is a member, and over any scope added later.
	return (
		`Reading as of ${momentLabel(key)}. A change saved here can begin at ` +
		`this date, or change it everywhere.`
	)
}

/**
 * The date a drag onto the line lands on.
 *
 * A drop snaps to a tick rather than to a pixel: the ticks are the dates the
 * book knows, and a date between two of them would be a date nothing in the
 * story shares. A line with no ticks has nowhere to land.
 */
export function dateAtRatio(
	ticks: readonly TimelineTick[],
	ratio: number
): StoryDate | null {
	const tick = tickAtRatio(ticks, ratio)
	return tick ? { ...tick.date } : null
}

/** The three boxes "Go to date" is typed into, as the inputs hold them. */
export interface DateParts {
	year: number | null
	month: number | null
	day: number | null
}

/**
 * A typed date, checked, as a moment address — or why it is not one (#164).
 *
 * The moment is not limited to the dates the book already holds: an
 * amendment filed "as of" a moment has to be able to land where nothing has
 * happened yet. The date is checked against the book's calendar (a month it
 * does not have is refused, never clamped), and a day needs a month, as it
 * does everywhere else a story date is written.
 */
export function goToDate(
	parts: DateParts,
	calendar: StoryCalendar | null | undefined
): { key: string; date: StoryDate } | { problem: string } {
	const whole = (n: number | null) =>
		typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : null
	const year = whole(parts.year)
	const month = whole(parts.month)
	const day = whole(parts.day)
	if (year === null) return { problem: "A date needs a year." }
	if (day !== null && month === null)
		return { problem: "A day needs a month." }
	const date: StoryDate = { year, month, day: month === null ? null : day }
	const problem = dateProblem(date, calendar)
	if (problem) return { problem }
	return { key: momentKey(date), date }
}

/**
 * Where a typed date stands against the story's present, said out loud —
 * by `compareDates`, never the packed value. Null when it is the present or
 * there is none to compare against.
 */
export function againstPresent(
	date: StoryDate,
	present: StoryDate | null | undefined
): string | null {
	if (!present) return null
	const order = compareDates(date, present)
	if (order > 0) return "after the story's present"
	if (order < 0) return null
	return "the story's present"
}
