/**
 * Who is in the world, at which point of their own life.
 *
 * A **presence** says: *this member, at this point of their life, is in the
 * world from this date until that one.* One member normally has one — they
 * turn up and stay — and a book that never says otherwise has none at all,
 * which reads as "always here, at no particular age".
 *
 * ⚠ **This is what makes two of somebody possible.** Two presences of one
 * member overlapping at one moment are two people standing in a room, which no
 * amount of resolving a single row can express. It is the minimal form of the
 * track in `DESIGN-story-time.md` §4d: a waypoint that knows when it applies.
 *
 * ⚠ A personal position is a plain integer the author gives — her age, the
 * chapter, whatever they count in. It needs no calendar, which is why this
 * works in a free-form book. When the calendar core lands it can be derived
 * from a birth instead of typed, and nothing here changes.
 *
 * ⚠ Pure. No database, no Svelte. The server resolves for retrieval and the
 * workspace resolves for reading, and they must agree.
 */
import { compareDates, type StoryDate } from "./storyDate"
import { MAIN_LINE, rowsReadingOnLine, type Line } from "./lineReading"

export interface Presence {
	id: number
	/** The `lorebook_bindings` row this is a presence of. */
	castId: number
	/** NULL = main, the shared line. */
	branchId: number | null
	/** Their own point: an age, an ordinal — whatever the author counts in. */
	personalPosition: number
	/** When this version of them enters the world. */
	fromYear: number
	fromMonth?: number | null
	fromDay?: number | null
	/** When it leaves. Absent = it never does. **Exclusive**, as a window is. */
	untilYear?: number | null
	untilMonth?: number | null
	untilDay?: number | null
	/** Why this version is here — "came back to stop herself". */
	note?: string | null
}

/**
 * ⚠ **Flat fields, not two `StoryDate` objects.** The row is flat in the
 * database and flat on the wire, and an intermediate shape would be a mapping
 * step on both sides — which is exactly where a field gets dropped. It was
 * objects for one draft, and the client read `undefined.year`.
 */
const from = (p: Presence): StoryDate => ({
	year: p.fromYear,
	month: p.fromMonth ?? null,
	day: p.fromDay ?? null
})
const until = (p: Presence): StoryDate | null =>
	p.untilYear == null
		? null
		: {
				year: p.untilYear,
				month: p.untilMonth ?? null,
				day: p.untilDay ?? null
			}

/** One person, in the world, at one point of their life. */
export interface Appearance {
	castId: number
	/** Null when the book has never said where in their life they are. */
	personalPosition: number | null
	/** The presence this came from, for editing it. Null for the implicit one. */
	presenceId: number | null
}

export interface PresenceAt {
	/** `null` = now: everything that has begun and not ended is here. */
	moment?: StoryDate | null
	/**
	 * The line (`lineOf`), its ancestor chain and fork cuts. Absent is main.
	 * ⚠ No branch-id form: a bare id cannot see a grandparent or a fork cut.
	 */
	line?: Line
}

/**
 * The presences the line being read can see, whatever the moment.
 *
 * The line's own, and each ancestor line's only when it BEGINS at or before
 * that line's fork cut — a presence main records after the fork is main's
 * story, not this line's (the same cut every dated row takes: a presence is
 * dated by its arrival). Never a sibling line's.
 *
 * ⚠ The one filter. The member page's list, the World bar (`appearancesOf`)
 * and the Lives lens all read through it, so one screen cannot list a
 * presence another says is not on the line.
 */
export function presencesOnLine<P extends Presence>(
	presences: readonly P[],
	line: Line
): P[] {
	return rowsReadingOnLine(presences, line, from)
}

/**
 * Whether a presence holds at this moment.
 *
 * ⚠ At **now** every `from` has passed — the future does not exist in a book —
 * so what decides it is whether the presence has ENDED. A presence with an
 * `until` is over by now; one without is still standing.
 */
export function holdsAt(p: Presence, moment: StoryDate | null): boolean {
	const ends = until(p)
	if (moment == null) return ends == null
	if (compareDates(from(p), moment) > 0) return false
	return ends == null || compareDates(moment, ends) < 0
}

/**
 * Everyone this member is, right here.
 *
 * ⚠ **A member with no presences gets one implicit appearance**, position
 * null. That is every member in every book today, and it must stay the
 * cheapest path: declaring nothing means being present, as it always has.
 */
export function appearancesOf(
	castId: number,
	presences: readonly Presence[],
	at: PresenceAt = {}
): Appearance[] {
	const moment = at.moment ?? null
	const mine = presencesOnLine(
		presences.filter((p) => p.castId === castId),
		at.line ?? MAIN_LINE
	)
	if (!mine.length)
		return [{ castId, personalPosition: null, presenceId: null }]

	const here = mine.filter((p) => holdsAt(p, moment))
	// ⚠ Declared presences that all happen to be elsewhere means they are NOT
	// in the world — the opposite of declaring none. Saying where someone is
	// is also saying where they are not.
	return here
		.sort((a, b) => a.personalPosition - b.personalPosition || a.id - b.id)
		.map((p) => ({
			castId,
			personalPosition: p.personalPosition,
			presenceId: p.id
		}))
}

/** Group a book's presences by the member they belong to. */
export function presencesByMember(
	presences: readonly Presence[]
): Map<number, Presence[]> {
	const out = new Map<number, Presence[]>()
	for (const p of presences) {
		const list = out.get(p.castId)
		if (list) list.push(p)
		else out.set(p.castId, [p])
	}
	return out
}
