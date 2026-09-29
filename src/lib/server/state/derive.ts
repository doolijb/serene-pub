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
	type AttributeSlotDecl,
	type SlotValue
} from "@serene-pub/sdk"

export interface DerivationInputs {
	storyDate: { year: number; month?: number; day?: number } | null
	/** Reads another slot on the same owner, through the same resolution chain. */
	read(slotId: string): Promise<SlotValue | undefined>
}

/** The value of a derived slot, or `undefined` when it cannot be computed. */
export async function deriveValue(
	decl: AttributeSlotDecl,
	inputs: DerivationInputs
): Promise<SlotValue | undefined> {
	if (decl.type !== "derived") return undefined
	switch (decl.config?.derivation) {
		case derivations.age.id:
			return await age(decl, inputs)
		default:
			// A declaration naming a derivation this build does not implement
			// reads as absent rather than throwing: the same "never refuse,
			// fall back and say so" posture a stale binding gets, and the
			// alternative is one plugin's slot stopping a turn.
			return undefined
	}
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
