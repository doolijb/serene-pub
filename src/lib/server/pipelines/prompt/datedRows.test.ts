/**
 * Dated rows in the prompt: History rows, Earlier scenes rows, the current date
 * and the story calendar reach their variables as values — `date` and
 * `dateDelta` in the `StoryDateValue` / `StoryDateDelta` shape — and a layout
 * decides how they print. Every layout here is an explicit JSON one, so what is
 * asserted is the value Assemble hands down, not a shipped layout's wording.
 */
import { describe, expect, it } from "vitest"
import { allocate, render } from "$lib/server/pipelines/prompt/assemble"
import { CORE_TEMPLATE_ENGINE } from "$lib/server/pipelines/prompt/renderers"
import type { Decision } from "$lib/server/pipelines/ranking/select"

const entry = (
	id: number,
	year: number,
	month?: number,
	day?: number,
	content = "Things happened."
): Decision => ({
	candidate: {
		id: `h${id}`,
		source: "history",
		tokens: 5,
		signals: {},
		payload: { id, content, year, month, day }
	},
	score: 0.5,
	reason: "filled_scored",
	included: true,
	why: "scored"
})

const VARIABLE = {
	history: "core:var/history@1",
	earlierScenes: "core:var/earlier-scenes@1",
	currentDate: "core:var/current-date@1",
	storyCalendar: "core:var/story-calendar@1"
} as const
type Key = keyof typeof VARIABLE

/** An explicit JSON layout for each key named. */
const asJson = (...keys: Key[]) =>
	Object.fromEntries(
		keys.map((key) => [
			key,
			{
				variableId: VARIABLE[key],
				engine: CORE_TEMPLATE_ENGINE,
				source: `{{{json ${key} 0}}}`
			}
		])
	)

const THAW = {
	months: [
		{ name: "Thaw", days: 30 },
		{ name: "Bloom", days: 31 }
	],
	yearLabel: "Year"
}

const clock = (year: number, month?: number, day?: number, from = "clock") => ({
	now: { year, month, day, from },
	calendar: null
})

const run = async (
	key: Key,
	over: {
		entries?: Decision[]
		storyTime?: unknown
		earlierScenes?: unknown
	} = {}
) => {
	const r = await render({
		allocation: allocate(over.entries ?? [], { budgetTotal: 100 }),
		engine: CORE_TEMPLATE_ENGINE,
		messages: [{ id: 1, role: "user", content: "hello" }],
		template: `[{{{${key}}}}]`,
		variables: asJson(key) as never,
		earlierScenes: over.earlierScenes as never,
		...(over.storyTime ? { templateContext: { storyTime: over.storyTime } } : {})
	})
	const text = r.rendered as string
	const json = text.slice(1, -1)
	return { text, value: json ? JSON.parse(json) : undefined, notes: r.notes }
}

describe("History rows", () => {
	const entries = [entry(1, 409), entry(2, 412, 3, 3), entry(3, 412, 3, 7)]

	it("come newest first, each with its date and its distance from now", async () => {
		const { value } = await run("history", {
			entries,
			storyTime: clock(412, 3, 5)
		})
		expect(value.map((r: any) => r.content)).toHaveLength(3)
		expect(value.map((r: any) => r.date.year.number)).toEqual([412, 412, 409])
		expect(value.map((r: any) => r.date.day?.number ?? null)).toEqual([7, 3, null])
		expect(value[0].date).toMatchObject({
			year: { number: 412 },
			month: { number: 3 },
			day: { number: 7 },
			time: null
		})
		// Row minus now: a later day and an earlier one differ in sign.
		expect(value[0].dateDelta).not.toBeNull()
		expect(value[0].dateDelta).not.toEqual(value[1].dateDelta)
		expect(value[2].dateDelta).not.toBeNull()
	})

	it("is absent, never an empty list, with no History", async () => {
		const { text, value } = await run("history", { storyTime: clock(412, 3, 5) })
		expect(text).toBe("[]")
		expect(value).toBeUndefined()
	})

	it("skips blank content", async () => {
		const { value } = await run("history", {
			entries: [entry(1, 412, 3, 3, "   "), entry(2, 412, 3, 4, "Kept.")]
		})
		expect(value.map((r: any) => r.content)).toEqual(["Kept."])
	})

	it("has no names in a free-form book and names under a calendar", async () => {
		const free = await run("history", {
			entries: [entry(1, 3, 2, 7)],
			storyTime: { now: null, calendar: null }
		})
		expect(free.value[0].date.month.name).toBeUndefined()
		expect(free.value[0].date.year.name).toBeUndefined()
		const named = await run("history", {
			entries: [entry(1, 3, 2, 7)],
			storyTime: { now: null, calendar: THAW }
		})
		expect(named.value[0].date.month).toEqual({ number: 2, name: "Bloom" })
		expect(named.value[0].date.year).toEqual({ number: 3, name: "Year 3" })
	})

	it("has a null dateDelta without story time, without a now, and with a now borrowed from History", async () => {
		for (const storyTime of [
			undefined,
			{ now: null, calendar: null },
			clock(412, 3, 5, "history")
		]) {
			const { value } = await run("history", {
				entries: [entry(1, 412, 3, 3)],
				storyTime
			})
			expect(value[0].dateDelta).toBeNull()
			expect(value[0].date.year.number).toBe(412)
		}
	})
})

describe("Earlier scenes rows", () => {
	const scenes = [
		{
			name: "The Ford",
			summary: "They crossed.",
			openedStoryClock: { year: 412, month: 3, day: 1, hour: 9, minute: 30 }
		},
		{ name: "The Inn", summary: "They slept." }
	]

	it("carry the date and distance of the clock they opened at, null without one", async () => {
		const { value } = await run("earlierScenes", {
			earlierScenes: scenes,
			storyTime: clock(412, 3, 5)
		})
		expect(value[0]).toMatchObject({
			name: "The Ford",
			summary: "They crossed.",
			date: { day: { number: 1 }, time: { hour: 9, minute: 30 } }
		})
		expect(value[0].dateDelta).not.toBeNull()
		expect(value[1]).toEqual({
			name: "The Inn",
			summary: "They slept.",
			date: null,
			dateDelta: null
		})
	})

	it("have a null dateDelta with no now of the story's own", async () => {
		for (const storyTime of [undefined, { now: null, calendar: null }, clock(412, 3, 5, "history")]) {
			const { value } = await run("earlierScenes", {
				earlierScenes: scenes,
				storyTime
			})
			expect(value[0].dateDelta).toBeNull()
			expect(value[0].date).not.toBeNull()
		}
	})
})

describe("the current date", () => {
	it("is a date value with its time when the clock has one", async () => {
		const { value } = await run("currentDate", {
			storyTime: {
				now: { year: 4, month: 1, day: 9, hour: 22, minute: 5, from: "clock" },
				calendar: null
			}
		})
		expect(value).toEqual({
			year: { number: 4 },
			month: { number: 1 },
			day: { number: 9 },
			time: { hour: 22, minute: 5 }
		})
	})

	it("has no time without an hour, and reads the newest History day with no story time", async () => {
		const clocked = await run("currentDate", { storyTime: clock(4, 1, 9) })
		expect(clocked.value.time).toBeNull()
		const borrowed = await run("currentDate", {
			entries: [entry(1, 3, 2, 7), entry(2, 2, 1, 1)]
		})
		expect(borrowed.value).toEqual({
			year: { number: 3 },
			month: { number: 2 },
			day: { number: 7 },
			time: null
		})
	})

	it("carries the calendar's spelling in its names", async () => {
		const { value } = await run("currentDate", {
			storyTime: { now: { year: 5, month: 1, from: "clock" }, calendar: THAW }
		})
		expect(value.month).toEqual({ number: 1, name: "Thaw" })
		expect(value.year.name).toBe("Year 5")
	})

	it("is absent when there is no present at all", async () => {
		const { text } = await run("currentDate")
		expect(text).toBe("[]")
	})
})

describe("the story calendar", () => {
	it("is handed down under a declared calendar", async () => {
		const { value } = await run("storyCalendar", {
			storyTime: { now: null, calendar: THAW }
		})
		expect(value).toEqual(THAW)
	})

	it("is absent in a free-form book", async () => {
		expect((await run("storyCalendar", { storyTime: clock(4) })).text).toBe("[]")
		expect((await run("storyCalendar")).text).toBe("[]")
	})
})
