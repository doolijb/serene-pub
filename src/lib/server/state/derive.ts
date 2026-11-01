/**
 * Derived slots: computed on every read, stored never.
 *
 * Age is a birthdate plus a position on the story clock. There is no value to
 * write, and writing one guarantees staleness — which is why derived-vs-stored
 * is a property of the declaration rather than a habit callers are asked to
 * keep. `checkSlotValue` refuses a write to a derived slot for the same reason.
 *
 * The SDK owns the closed set of derivation *names* (`derivations` in
 * attributes.ts); this module owns the arithmetic, because the inputs — the
 * session's story date — are the host's and not the SDK's.
 *
 * ⚠ **Absent, not zero.** Every branch that cannot compute returns `undefined`.
 * A character with no birthdate is not aged 0, and a world with no clock has
 * not just begun; both are questions this install cannot answer, and answering
 * them with a number is how a prompt ends up asserting something nobody wrote.
 */

import {
	derivations,
	parseStoryTime,
	storyDayIndex,
	type AttributeSlotDecl,
	type I18n,
	type SlotValue,
	type StoryCalendar
} from "@serene-pub/sdk"

/** The day's periods when a calendar declares none: morning 5 · day 12 · dusk 18 · night 22. */
const DEFAULT_PERIODS: ReadonlyArray<{ id: string; label: I18n; from: number }> = [
	{ id: "morning", label: "Morning", from: 5 },
	{ id: "day", label: "Day", from: 12 },
	{ id: "dusk", label: "Dusk", from: 18 },
	{ id: "night", label: "Night", from: 22 }
]

export interface DerivationInputs {
	storyDate: { year: number; month?: number; day?: number } | null
	/** The session's story clock, whole; `null` when it has none. */
	clock: {
		year: number
		month?: number | null
		day?: number | null
		hour?: number | null
		minute?: number | null
	} | null
	/** The calendar of the book the session reads; `null` is free-form. */
	calendar: StoryCalendar | null
	/** Reads another slot on the same owner, through the same resolution chain. */
	read(slotId: string): Promise<SlotValue | undefined>
}

/** The value of a derived slot, or `undefined` when it cannot be computed. */
export async function deriveValue(
	decl: AttributeSlotDecl,
	inputs: DerivationInputs
): Promise<SlotValue | undefined> {
	// A stored slot may name a derived default (`config.derivation`): the reading
	// a read uses when no layer holds a value. An expression has no config key.
	if (decl.type !== "derived" && !decl.config?.derivation) return undefined
	switch (decl.config?.derivation) {
		case derivations.age.id:
			return await age(decl, inputs)
		case derivations.dayPeriod.id:
			return periodOf(inputs.clock, inputs.calendar?.periods ?? DEFAULT_PERIODS)
		case derivations.timeOfDay.id:
			return periodOf(inputs.clock, DEFAULT_PERIODS)
		case derivations.season.id:
			return seasonOf(inputs.clock, inputs.calendar)
		default:
			// A declaration naming a derivation this build does not implement
			// reads as absent rather than throwing: the same "never refuse,
			// fall back and say so" posture a stale binding gets, and the
			// alternative is one plugin's slot stopping a turn.
			return undefined
	}
}

/** The period with the greatest `from` at or before the hour; before the first, the last. */
function periodOf(
	clock: DerivationInputs["clock"],
	periods: ReadonlyArray<{ id: string; from: number }>
): SlotValue | undefined {
	const hour = clock?.hour
	if (hour === null || hour === undefined || !periods.length) return undefined
	let found: { id: string; from: number } | undefined
	for (const p of periods) if (p.from <= hour && (!found || p.from > found.from)) found = p
	return (found ?? periods[periods.length - 1]).id
}

function seasonOf(
	clock: DerivationInputs["clock"],
	calendar: StoryCalendar | null
): SlotValue | undefined {
	const seasons = calendar?.seasons
	if (!clock || !calendar || !calendar.months?.length || !seasons) return undefined
	if (clock.month == null || clock.day == null) return undefined
	const idx = storyDayIndex(clock, calendar)
	if (idx === null) return undefined
	const i = ((Math.floor(idx / seasons.days) % 4) + 4) % 4
	const label = seasons.labels[i]
	if (typeof label === "string") return label
	return label?.en ?? Object.values(label ?? {})[0]
}

/**
 * How old someone is: `config.from`'s value read as a story date, subtracted
 * from the world's present one.
 *
 * The birthdate is read as `year` or `year-month` or `year-month-day` — the
 * same shape a history entry's date has, because that is the only calendar this
 * codebase has ever had. A birthdate the format cannot read is absent, not zero.
 */
async function age(
	decl: AttributeSlotDecl,
	inputs: DerivationInputs
): Promise<SlotValue | undefined> {
	const from = decl.config?.from
	if (!from || !inputs.storyDate) return undefined
	const born = parseStoryDate(await inputs.read(from))
	if (!born) return undefined

	const now = inputs.storyDate
	let years = now.year - born.year
	// The birthday has not come round yet this year — the one place the
	// optional parts of the date are load-bearing, and absent parts read as
	// "already passed" so that a year-only birthdate gives a whole number.
	if (
		born.month !== undefined &&
		now.month !== undefined &&
		(now.month < born.month ||
			(now.month === born.month &&
				born.day !== undefined &&
				now.day !== undefined &&
				now.day < born.day))
	)
		years -= 1
	return years < 0 ? undefined : years
}

/**
 * `412`, `"412"`, `"412-03"`, `"412-03-05"` — the calendar this codebase has,
 * read by the SDK's story-time parser (the one a story-time stat is checked
 * with), so a birthdate typed into a story-time slot reads here as it does
 * everywhere. A time of day is carried and ignored: age counts days.
 */
function parseStoryDate(
	value: SlotValue | undefined
): { year: number; month?: number; day?: number } | undefined {
	const time = parseStoryTime(value)
	if (!time) return undefined
	return {
		year: time.year,
		...(time.month ? { month: time.month } : {}),
		...(time.day ? { day: time.day } : {})
	}
}
