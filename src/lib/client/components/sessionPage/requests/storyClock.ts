/**
 * 🚧 `set-story-clock` (PLAN-core-widgets W3): core's Chronicle moves the
 * session's **story clock** through the page's `sessions:setStoryClock` —
 * clear it (follow the line's present), set it, or step it through the
 * book's calendar. Core's widgets only (the askers table, `./askers.ts`);
 * the server judges who may (the session's owner) and whether the date
 * lands, and its refusal is the asking widget's own (R77), never a toast.
 * Also here: the page's read of the clock (`sessions:storyClock`), which
 * `history-entries` answers its head with, and the one projection of a
 * reading into the widget's `StoryClockV1`.
 *
 * **One reply, one ask**, as `./authorsNote.ts`: each ask carries a request
 * token the server echoes on the reply and on the `:error` refusal, and the
 * page waits under it (`./pendingAsks.ts`).
 */
import {
	STORY_TIME_UNITS,
	type StoryClockV1,
	type StoryTime,
	type StoryTimeUnit,
	type WidgetRequests
} from "@serene-pub/sdk"
import {
	compareDates,
	formatDate,
	readStoryCalendar,
	type StoryClock
} from "$lib/shared/lorebooks/storyDate"

type Reading = Sockets.Sessions.StoryClock.Reading
type Result = WidgetRequests["set-story-clock"]["result"]

/** The page's read: one `sessions:storyClock`, settled on ITS reply. */
export type StoryClockRead = (
	ask: Omit<Sockets.Sessions.StoryClock.Params, "request">
) => Promise<Sockets.Sessions.StoryClock.Response>
/** The page's write: one `sessions:setStoryClock`, settled on ITS reply. */
export type StoryClockWrite = (
	ask: Omit<Sockets.Sessions.SetStoryClock.Params, "request">
) => Promise<Sockets.Sessions.SetStoryClock.Response>

/** The reply's key: the token its ask carried; null for an untokened reply. */
export const storyClockReplyKey = (
	reply: Sockets.Sessions.StoryClock.Response
): string | null => reply.request ?? null

/** A clock with only the parts it has — never a null key. */
export function storyTimeOf(
	c: StoryClock | null | undefined
): StoryTime | null {
	if (!c || typeof c.year !== "number") return null
	const out: StoryTime = { year: c.year }
	if (c.month != null) out.month = c.month
	if (c.month != null && c.day != null) out.day = c.day
	if (c.hour != null) {
		out.hour = c.hour
		out.minute = c.minute ?? 0
	}
	return out
}

/**
 * A reading as the widget's clock: each date spelled through the book's
 * calendar, and `behind` when the session's own clock stands before its
 * line's present.
 */
export function storyClockV1(reading: Partial<Reading>): StoryClockV1 {
	const calendar = readStoryCalendar(reading.calendar ?? null)
	const own = storyTimeOf(reading.own)
	const present = storyTimeOf(reading.present)
	const linePresent = storyTimeOf(reading.linePresent)
	return {
		present,
		label: present ? formatDate(present, calendar) : "",
		own: !!own,
		linePresent,
		linePresentLabel: linePresent ? formatDate(linePresent, calendar) : "",
		behind: !!(own && linePresent && compareDates(own, linePresent) < 0)
	}
}

/** The reading's own parts, as the page's session row stores them. */
export function ownClockOf(reading: Partial<Reading>): StoryClock | null {
	return reading.own ?? null
}

const isWhole = (v: unknown): v is number =>
	typeof v === "number" && Number.isInteger(v)
const isPart = (v: unknown) => v === undefined || v === null || isWhole(v)

/** The ask a `set-story-clock` names, or why it names none. */
function askOf(
	params: unknown
): Omit<Sockets.Sessions.SetStoryClock.Params, "sessionId" | "request"> {
	const p = (params ?? {}) as Record<string, unknown>
	const ways = ["follow", "to", "by"].filter((k) => p[k] !== undefined)
	if (ways.length !== 1 || (p.unit !== undefined && ways[0] !== "by"))
		throw new Error(
			"set-story-clock takes one of { follow: true }, { to } or { by, unit }"
		)
	if (ways[0] === "follow") {
		if (p.follow !== true)
			throw new Error("set-story-clock follows with { follow: true }")
		return { follow: true }
	}
	if (ways[0] === "to") {
		const to = p.to as Record<string, unknown> | null
		if (
			!to ||
			typeof to !== "object" ||
			!isWhole(to.year) ||
			![to.month, to.day, to.hour, to.minute].every(isPart)
		)
			throw new Error(
				"set-story-clock sets a clock of whole parts: a year, and a month, day, hour and minute where it has them"
			)
		return {
			to: {
				year: to.year,
				month: (to.month as number | null | undefined) ?? null,
				day: (to.day as number | null | undefined) ?? null,
				hour: (to.hour as number | null | undefined) ?? null,
				minute: (to.minute as number | null | undefined) ?? null
			}
		}
	}
	if (!isWhole(p.by) || p.by === 0)
		throw new Error(
			"set-story-clock steps by a whole number other than zero"
		)
	if (!STORY_TIME_UNITS.includes(p.unit as StoryTimeUnit))
		throw new Error(
			`set-story-clock steps in ${STORY_TIME_UNITS.join(", ")}`
		)
	return { by: p.by, unit: p.unit as StoryTimeUnit }
}

/**
 * Answer one `set-story-clock` for the page's session. Rejects, in words,
 * with anything a widget could have got wrong and with the server's own
 * refusal; resolves with the clock as it now reads. `noteClock` hands the
 * page the session's own clock as it now stands, so the page's copy of the
 * session row (what Summarize dates by) does not keep the old one.
 */
export async function answerSetStoryClock(
	params: unknown,
	sessionId: number | null,
	write: StoryClockWrite,
	noteClock?: (own: StoryClock | null) => void
): Promise<Result> {
	const ask = askOf(params)
	if (sessionId == null)
		throw new Error("this page has no session to move the clock of")
	const res = await write({ sessionId, ...ask })
	if (res.error) throw new Error(res.error)
	if (res.lorebookId === undefined)
		throw new Error("the server did not say where the clock stands")
	noteClock?.(ownClockOf(res))
	return storyClockV1(res)
}
