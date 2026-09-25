/**
 * The geometry of the weave: lives laid against the story's line.
 *
 * Pure, so the drawing can be tested without a canvas. One lane per member,
 * one run per presence — a run being the stretch of world time during which
 * that version of them is standing in it.
 *
 * ⚠ Placed by DATE, never by count, exactly as the moment bar's ticks are: a
 * decade of silence has to read as a gap, or the drawing is a list wearing a
 * timeline's clothes.
 */
import {
	compareDates,
	dateValue,
	type StoryDate
} from "$lib/shared/lorebooks/storyDate"
import type { Presence } from "$lib/shared/lorebooks/presence"

export interface LaneRun {
	presenceId: number
	personalPosition: number
	/** 0…1 along the axis. */
	from: number
	to: number
	/** No end was given: it runs to the edge and means "still here". */
	open: boolean
	note: string | null
}

export interface Lane {
	castId: number
	name: string
	runs: LaneRun[]
	/** This member is in the world more than once somewhere on this axis. */
	doubled: boolean
}

export interface Axis {
	/** Every date the drawing must place something at. */
	min: number
	max: number
	lanes: Lane[]
	/** Where the moment being read sits, or null at now. */
	cursor: number | null
}

/** Where a value sits along the axis. A zero span puts everything mid-line. */
export function ratioOf(value: number, min: number, max: number): number {
	if (max <= min) return 0.5
	return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

const dateOf = (p: Presence): StoryDate => ({
	year: p.fromYear,
	month: p.fromMonth ?? null,
	day: p.fromDay ?? null
})
const endOf = (p: Presence): StoryDate | null =>
	p.untilYear == null
		? null
		: {
				year: p.untilYear,
				month: p.untilMonth ?? null,
				day: p.untilDay ?? null
			}

/**
 * The whole drawing.
 *
 * ⚠ The axis spans the PINS as well as the presences. A life is only legible
 * against the events it crossed, so a book whose history runs to Y900 draws its
 * lives against Y900 even when nobody is placed past Y550.
 *
 * ⚠ A member with no presences gets **no lane**. They are in the world at every
 * moment, which is a fact about all of time and nothing a line can say; the
 * roster already lists them. Drawing a full-width bar for every undated member
 * would bury the two or three lives the author actually placed.
 */
export function buildAxis(
	members: readonly { id: number; name: string }[],
	presences: readonly Presence[],
	pins: readonly StoryDate[],
	at: { moment?: StoryDate | null; branchId?: number | null } = {}
): Axis {
	const branchId = at.branchId ?? null
	const mine = presences.filter(
		(p) => p.branchId == null || p.branchId === branchId
	)

	const values: number[] = pins.map(dateValue)
	for (const p of mine) {
		values.push(dateValue(dateOf(p)))
		const end = endOf(p)
		if (end) values.push(dateValue(end))
	}
	if (at.moment) values.push(dateValue(at.moment))
	const min = values.length ? Math.min(...values) : 0
	const max = values.length ? Math.max(...values) : 0

	const lanes: Lane[] = []
	for (const member of members) {
		const runs = mine
			.filter((p) => p.castId === member.id)
			.sort(
				(a, b) =>
					compareDates(dateOf(a), dateOf(b)) ||
					a.personalPosition - b.personalPosition
			)
			.map((p) => {
				const end = endOf(p)
				return {
					presenceId: p.id,
					personalPosition: p.personalPosition,
					from: ratioOf(dateValue(dateOf(p)), min, max),
					to: end ? ratioOf(dateValue(end), min, max) : 1,
					open: end == null,
					note: p.note ?? null
				}
			})
		if (!runs.length) continue
		// ⚠ Computed from the DATES, never from the ratios above. Whether two
		// versions of someone coexist is a fact about the story, not about how
		// wide the drawing happens to be — and the ratios are clamped to the
		// axis, so an open-ended run and one starting at the axis's right edge
		// merely touched, and the lane stopped saying "two of them" as soon as
		// the reader returned to now.
		const spans = mine
			.filter((p) => p.castId === member.id)
			.map((p) => {
				const end = endOf(p)
				return {
					from: dateValue(dateOf(p)),
					to: end ? dateValue(end) : Infinity
				}
			})
		lanes.push({
			castId: member.id,
			name: member.name,
			runs,
			doubled: overlaps(spans)
		})
	}

	return {
		min,
		max,
		lanes,
		cursor: at.moment ? ratioOf(dateValue(at.moment), min, max) : null
	}
}

/**
 * Whether any two spans are in the world at the same time.
 *
 * ⚠ Takes DATE values, not the drawing's ratios: an open-ended span is
 * `Infinity`, which a ratio cannot be. See the note at the call site.
 *
 * ⚠ Touching ends do NOT overlap: `until` is exclusive, so a version that
 * leaves exactly as the next arrives is a handover, not a meeting.
 */
export function overlaps(
	spans: readonly { from: number; to: number }[]
): boolean {
	const sorted = [...spans].sort((a, b) => a.from - b.from)
	for (let i = 1; i < sorted.length; i++)
		if (sorted[i].from < sorted[i - 1].to) return true
	return false
}
