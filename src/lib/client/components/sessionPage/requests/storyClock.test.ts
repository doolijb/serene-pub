/**
 * `set-story-clock` moves the session's story clock through the page's
 * `sessions:setStoryClock` (W3): one way at a time — follow the line's
 * present, a date, or a step — and the server's refusal is the widget's.
 * The reading becomes the widget's `StoryClockV1`: dates spelled through the
 * book's calendar, and `behind` when the own clock stands before the line.
 */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import {
	answerSetStoryClock,
	storyClockReplyKey,
	storyClockV1,
	storyTimeOf,
	type StoryClockWrite
} from "./storyClock"

type Response = Sockets.Sessions.StoryClock.Response

const READING: Response = {
	sessionId: 7,
	lorebookId: 4,
	branchId: null,
	own: { year: 410, month: null, day: null, hour: null, minute: null },
	present: { year: 410, month: null, day: null, hour: null, minute: null },
	linePresent: { year: 412, month: 3, day: 5, hour: null, minute: null },
	calendar: null,
	isOwner: true
}

function writing(reply: Partial<Response> = READING) {
	const asked: unknown[] = []
	const noted: unknown[] = []
	const write: StoryClockWrite = async (ask) => {
		asked.push(ask)
		return { sessionId: ask.sessionId, ...reply } as Response
	}
	return { asked, noted, write, note: (own: unknown) => noted.push(own) }
}

describe("storyClockV1", () => {
	test("spells each date free-form and says when the own clock stands before its line", () => {
		expect(storyClockV1(READING)).toEqual({
			present: { year: 410 },
			label: "Year 410",
			own: true,
			linePresent: { year: 412, month: 3, day: 5 },
			linePresentLabel: expect.stringContaining("412"),
			behind: true
		})
	})

	test("following the line: not own, never behind; no book: nothing", () => {
		const follows = storyClockV1({
			...READING,
			own: null,
			present: READING.linePresent
		})
		expect([follows.own, follows.behind, follows.present]).toEqual([
			false,
			false,
			{ year: 412, month: 3, day: 5 }
		])
		expect(
			storyClockV1({
				lorebookId: null,
				own: null,
				present: null,
				linePresent: null,
				calendar: null
			})
		).toEqual({
			present: null,
			label: "",
			own: false,
			linePresent: null,
			linePresentLabel: "",
			behind: false
		})
	})

	test("a time of day rides along; a day without a month does not", () => {
		expect(
			storyTimeOf({ year: 1, month: 2, day: 3, hour: 22, minute: null })
		).toEqual({ year: 1, month: 2, day: 3, hour: 22, minute: 0 })
		expect(storyTimeOf({ year: 1, month: null, day: 3 })).toEqual({
			year: 1
		})
	})

	test("a reply is keyed by the token its ask carried", () => {
		expect(storyClockReplyKey({ sessionId: 1, request: "t:1" })).toBe("t:1")
		expect(storyClockReplyKey({ sessionId: 1 })).toBeNull()
	})
})

describe("answerSetStoryClock", () => {
	test("follow, a date and a step each go as one ask for the page's session; the clock comes back, and the page notes it", async () => {
		const { asked, noted, write, note } = writing()
		const out = await answerSetStoryClock({ follow: true }, 7, write, note)
		await answerSetStoryClock({ to: { year: 412, month: 3 } }, 7, write)
		await answerSetStoryClock({ by: -2, unit: "days" }, 7, write)
		expect(asked).toEqual([
			{ sessionId: 7, follow: true },
			{
				sessionId: 7,
				to: { year: 412, month: 3, day: null, hour: null, minute: null }
			},
			{ sessionId: 7, by: -2, unit: "days" }
		])
		expect(out.label).toBe("Year 410")
		expect(noted).toEqual([READING.own])
	})

	test("refuses, in words and asking nothing, anything but exactly one way to move it", async () => {
		const { asked, write } = writing()
		const bad = [
			{},
			{ follow: true, by: 1, unit: "days" },
			{ follow: false },
			{ to: { year: 1.5 } },
			{ to: { year: 1, month: "3" } },
			{ by: 0, unit: "days" },
			{ by: 1, unit: "weeks" },
			{ to: { year: 1 }, unit: "days" }
		]
		for (const params of bad)
			await expect(answerSetStoryClock(params, 7, write)).rejects.toThrow(
				/set-story-clock/
			)
		await expect(
			answerSetStoryClock({ follow: true }, null, write)
		).rejects.toThrow(/no session/)
		expect(asked).toEqual([])
	})

	test("the server's refusal is the widget's, word for word", async () => {
		const { write } = writing({
			error: "That clock does not fit this lorebook. There is no month 13: this calendar has 12."
		})
		await expect(
			answerSetStoryClock({ to: { year: 1, month: 13 } }, 7, write)
		).rejects.toThrow(
			"That clock does not fit this lorebook. There is no month 13: this calendar has 12."
		)
	})

	test("core's widgets only", () => {
		expect(WIDGET_REQUEST_ASKERS["set-story-clock"]).toBe("core")
	})
})
