/**
 * Placing a member: turning what the form holds into a presence, or into the
 * reason it is not one yet.
 *
 * A **presence** (a `cast_presences` row) says *this member, at this point of
 * their own life, is in the world from this date until that one*. The editor
 * that collects it is `PresencesPanel.svelte`; the rules are here so they can
 * be tested without a DOM.
 *
 * ⚠ **These rules mirror `amendmentsPlaceHandler`, which still enforces them.**
 * This is the message, not the gate: a form that refuses early says *why* in
 * the author's words, where the socket can only throw after the fact. The two
 * must not drift — when one changes, change both (NOMENCLATURE R5).
 *
 * ⚠ **An overlap is not an error.** Two presences of one member holding at one
 * moment are two of them standing in the room, which is the entire point of the
 * shape. The form says so out loud and lets it through; only a *duplicate* —
 * the same point of their life over the same span — is refused, and that
 * because it is a slip, not a story.
 */
import {
	holdsAt,
	type Presence
} from "$lib/shared/lorebooks/presence"
import { compareDates, type StoryDate } from "$lib/shared/lorebooks/storyDate"

/**
 * The form's own shape.
 *
 * ⚠ **A numeric field is a number OR a string, and may be `null`.** Svelte's
 * `bind:value` on `<input type="number">` hands back a *number*, and `null`
 * for an empty field — not the string the markup suggests. Typing these as
 * `string` was a lie the unit tests could not catch (they build drafts by
 * hand, as strings) and the browser threw `value.trim is not a function` on
 * the first keystroke. The readers below are total over all three.
 */
export type DraftField = string | number | null | undefined

export interface PresenceDraft {
	personalPosition: DraftField
	fromYear: DraftField
	fromMonth: DraftField
	fromDay: DraftField
	untilYear: DraftField
	untilMonth: DraftField
	untilDay: DraftField
	/** Text, so this one really is a string. */
	note: string
}

export function emptyDraft(): PresenceDraft {
	return {
		personalPosition: "",
		fromYear: "",
		fromMonth: "",
		fromDay: "",
		untilYear: "",
		untilMonth: "",
		untilDay: "",
		note: ""
	}
}

/** What a valid draft becomes, ready to go on the wire minus its ids. */
export interface PresenceFields {
	personalPosition: number
	fromYear: number
	fromMonth: number | null
	fromDay: number | null
	untilYear: number | null
	untilMonth: number | null
	untilDay: number | null
	note: string | null
}

export type DraftResult =
	| { ok: true; fields: PresenceFields }
	| { ok: false; problem: string }

/**
 * Whether the author put anything here. Blank is not the same as a zero, and
 * `0` is a value: `Number.isFinite(0)` is true and `String(0).trim()` is "0".
 */
function given(value: DraftField): boolean {
	if (value == null) return false
	if (typeof value === "number") return Number.isFinite(value)
	return value.trim() !== ""
}

function whole(value: DraftField): number | null {
	if (value == null) return null
	const n = typeof value === "number" ? value : Number(value.trim())
	return Number.isInteger(n) ? n : null
}

/**
 * The presence this draft describes, or the sentence standing in its way.
 *
 * ⚠ The order of the checks is the order the author fills the form in, so the
 * first thing they have not finished is the thing they are told about.
 */
export function readDraft(draft: PresenceDraft): DraftResult {
	if (!given(draft.personalPosition))
		return {
			ok: false,
			problem: "Say where in their life this is — an age, a chapter, whatever you count in."
		}
	const personalPosition = whole(draft.personalPosition)
	if (personalPosition == null)
		return { ok: false, problem: "That point in their life is not a number." }

	if (!given(draft.fromYear))
		return { ok: false, problem: "Say what year they arrive." }
	const fromYear = whole(draft.fromYear)
	if (fromYear == null)
		return { ok: false, problem: "That arrival year is not a number." }

	const fromMonth = given(draft.fromMonth) ? whole(draft.fromMonth) : null
	if (given(draft.fromMonth) && fromMonth == null)
		return { ok: false, problem: "That arrival month is not a number." }
	const fromDay = given(draft.fromDay) ? whole(draft.fromDay) : null
	if (given(draft.fromDay) && fromDay == null)
		return { ok: false, problem: "That arrival day is not a number." }
	// ⚠ The calendar narrows left to right: a day with no month is not a date.
	if (fromDay != null && fromMonth == null)
		return {
			ok: false,
			problem: "A day needs a month: the calendar narrows left to right."
		}

	const leaves = given(draft.untilYear)
	const untilYear = leaves ? whole(draft.untilYear) : null
	if (leaves && untilYear == null)
		return { ok: false, problem: "That departure year is not a number." }
	const untilMonth = given(draft.untilMonth) ? whole(draft.untilMonth) : null
	if (given(draft.untilMonth) && untilMonth == null)
		return { ok: false, problem: "That departure month is not a number." }
	const untilDay = given(draft.untilDay) ? whole(draft.untilDay) : null
	if (given(draft.untilDay) && untilDay == null)
		return { ok: false, problem: "That departure day is not a number." }
	// ⚠ An end is optional; a half-given one is not — the same sentence the
	// server throws, said before the round trip.
	if (!leaves && (untilMonth != null || untilDay != null))
		return { ok: false, problem: "An end needs a year to be an end." }
	if (untilDay != null && untilMonth == null)
		return {
			ok: false,
			problem: "A departure day needs a month: the calendar narrows left to right."
		}

	if (untilYear != null) {
		// ⚠ `compareDates`, never the packed value: a book numbering days of
		// the year carries a day past 100, where the packed form collides.
		const from: StoryDate = { year: fromYear, month: fromMonth, day: fromDay }
		const until: StoryDate = {
			year: untilYear,
			month: untilMonth,
			day: untilDay
		}
		if (compareDates(until, from) <= 0)
			return { ok: false, problem: "They would leave before they arrived." }
	}

	return {
		ok: true,
		fields: {
			personalPosition,
			fromYear,
			fromMonth,
			fromDay,
			untilYear,
			untilMonth,
			untilDay,
			note: (draft.note ?? "").trim() || null
		}
	}
}

/** The two dates one presence spans, as the comparator wants them. */
export function spanOf(p: {
	fromYear: number
	fromMonth?: number | null
	fromDay?: number | null
	untilYear?: number | null
	untilMonth?: number | null
	untilDay?: number | null
}): { from: StoryDate; until: StoryDate | null } {
	return {
		from: {
			year: p.fromYear,
			month: p.fromMonth ?? null,
			day: p.fromDay ?? null
		},
		until:
			p.untilYear == null
				? null
				: {
						year: p.untilYear,
						month: p.untilMonth ?? null,
						day: p.untilDay ?? null
					}
	}
}

/** Whether two spans are in the world at the same time. Open ends never end. */
export function spansOverlap(
	a: { from: StoryDate; until: StoryDate | null },
	b: { from: StoryDate; until: StoryDate | null }
): boolean {
	// ⚠ `until` is EXCLUSIVE, so touching ends do not overlap: one leaves on
	// the day the other arrives and they never share a room.
	if (a.until != null && compareDates(a.until, b.from) <= 0) return false
	if (b.until != null && compareDates(b.until, a.from) <= 0) return false
	return true
}

/**
 * What the author should be told before they place this — never a refusal
 * except for the one case that is a slip.
 */
export interface DraftNotice {
	/** `refuse` stops the save; `warn` is said and allowed. */
	kind: "refuse" | "warn"
	message: string
}

/**
 * How this presence sits against the ones the member already has on this line.
 *
 * ⚠ The only refusal is an exact repeat — same point of their life, same span.
 * Everything else that looks like a conflict is a story: two of her at once, a
 * younger self arriving before an older one leaves. Those are warned about in
 * the words of what they mean, so the author knows they meant it.
 */
export function draftNotice(
	fields: PresenceFields,
	existing: readonly Presence[]
): DraftNotice | null {
	const mine = spanOf(fields)
	for (const p of existing) {
		const theirs = spanOf(p)
		const sameSpan =
			compareDates(mine.from, theirs.from) === 0 &&
			((mine.until == null && theirs.until == null) ||
				(mine.until != null &&
					theirs.until != null &&
					compareDates(mine.until, theirs.until) === 0))
		if (sameSpan && p.personalPosition === fields.personalPosition)
			return {
				kind: "refuse",
				message: "They are already placed at that point of their life over exactly that span."
			}
	}
	const overlapping = existing.filter((p) => spansOverlap(mine, spanOf(p)))
	if (!overlapping.length) return null
	const positions = [
		...new Set([...overlapping.map((p) => p.personalPosition), fields.personalPosition])
	].sort((a, b) => a - b)
	if (positions.length === 1)
		return {
			kind: "warn",
			message: "This overlaps a presence at the same point of their life. That is the same person twice over, which is probably not what you meant."
		}
	return {
		kind: "warn",
		message: `Two of them will be in the world at once, at ${positions.join(" and ")}. That is allowed — it is what presences are for.`
	}
}

/** Whether this presence is one the moment being read can see. */
export function holdsNow(p: Presence, moment: StoryDate | null): boolean {
	return holdsAt(p, moment)
}
