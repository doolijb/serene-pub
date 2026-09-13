/**
 * The moment: which date the book is being read as of.
 *
 * The moment is an address — it rides in the route as `as=Y3-2-12` — so it is
 * a string here and a number wherever it is compared, and this module is the
 * one translation between the two. Reading as of a date narrows what is in the
 * story: a dated row is in it when its date has arrived, and an undated row is
 * in it always, because a row with no date makes no claim about when.
 *
 * ⚠ **A reader, not an editor.** Editing while reading as of a date saves to
 * the entry itself: a dated amendment is a shape the book does not hold yet.
 */

import {
	dateFromValue,
	dateValue,
	formatDate,
	type StoryDate
} from "../sections/historyDates"
import { tickAtRatio, type TimelineTick } from "../timelineStrip"

/** The moment an absent address means. */
export const NOW_KEY = "now"

/** What the bar says on the day nothing has been dated. */
export const MOMENT_EMPTY_LINE =
	"Nothing is dated yet, date an entry and the story time fills in here"

/** What the bar's track is for. */
export const MOMENT_DRAG_HINT = "drag to read the book as of any date"

/** A story date as an address: `Y3`, `Y3-2`, `Y3-2-12`. */
export function momentKey(date: StoryDate): string {
	const parts = [`Y${date.year}`]
	if (date.month != null) parts.push(String(date.month))
	if (date.month != null && date.day != null) parts.push(String(date.day))
	return parts.join("-")
}

const KEY = /^Y(\d+)(?:-(\d+))?(?:-(\d+))?$/

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

/** The moment as the axis's own unit, or null at now. */
export function momentValue(key: string | null | undefined): number | null {
	const date = parseMoment(key)
	return date ? dateValue(date) : null
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
	value: number | null | undefined,
	moment: number | null
): boolean {
	if (moment == null || value == null) return true
	return value <= moment
}

export interface AsOfRow {
	key: string
	/** The row's date as the axis's unit, or null when it carries none. */
	value: number | null
}

/** The rows not in the story yet at this moment, by key. */
export function notYetKeys(
	rows: readonly AsOfRow[],
	moment: number | null
): string[] {
	if (moment == null) return []
	return rows
		.filter((row) => !isInStoryAsOf(row.value, moment))
		.map((row) => row.key)
}

export interface CastArrival {
	id: number
	name: string
	/** The first dated thing naming them, or null when nothing dated does. */
	arrival: number | null
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
	moment: number | null
): CastAsOf[] {
	return cast.map((member) => ({
		...member,
		inStory: isInStoryAsOf(member.arrival, moment)
	}))
}

export function countNotInStory(
	cast: readonly CastArrival[],
	moment: number | null
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

/** The bar's own chip. */
export function momentChipLabel(key: string | null | undefined): string {
	return `Moment · ${momentLabel(key)}`
}

/** What the banner over the editor says an edit made here is saved as. */
export function momentBannerSentence(key: string): string {
	return (
		`Reading as of ${momentLabel(key)}. Changes made here are saved to ` +
		`the entry itself; dated amendments are not built yet.`
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
	return tick ? dateFromValue(tick.value) : null
}
