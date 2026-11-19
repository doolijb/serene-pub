/**
 * The calendar and clock editors: Save keeps the leap rule's exceptions the
 * editor does not show, and neither editor starts a date at Year 1.
 *
 * ⚠ No DOM node is ever handed to `expect`: booleans, strings and plain data.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))
const { socket, asks, interests } = vi.hoisted(() => ({
	socket: { emit: () => {}, on: () => {}, off: () => {} },
	asks: [] as Array<{ event: string; params: any }>,
	interests: new Map<string, (msg: any) => void>()
}))
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declareInterest = (key: string, handler: (msg: any) => void) => {
		interests.set(key, handler)
		return () => {}
	}
	return {
		declareInterest,
		useInterest: declareInterest,
		requestWithInterest: declareInterest,
		getInterestContext: () => ({
			useInterest: declareInterest,
			declareInterest,
			requestWithInterest: declareInterest
		})
	}
})
vi.mock("$lib/client/utils/awaitReply", () => ({
	awaitReply: async (o: { event: string; params: any }) => {
		asks.push({ event: o.event, params: o.params })
		return { lorebookId: o.params.lorebookId }
	}
}))

import { STORY_CALENDAR_PRESETS } from "@serene-pub/sdk"
import { interestKey } from "$lib/shared/sockets/interest"
import StoryCalendarEditor from "./StoryCalendarEditor.svelte"
import StoryClockEditor from "./StoryClockEditor.svelte"
import { openBookTime } from "./bookTime.svelte"

const REAL = STORY_CALENDAR_PRESETS.find((p) => p.id === "real-calendar")!.calendar

let app: Record<string, any> | null = null
beforeEach(() => {
	asks.length = 0
	interests.clear()
	openBookTime.calendar = null
	openBookTime.start = null
})
afterEach(() => {
	if (app) unmount(app)
	app = null
	document.body.innerHTML = ""
	vi.useRealTimers()
})

const q = (sel: string) => document.body.querySelector<HTMLInputElement>(sel)
const button = (text: string) =>
	[...document.body.querySelectorAll("button")].find((b) =>
		b.textContent?.includes(text)
	)!

describe("the calendar editor", () => {
	test("Save keeps skipEvery and keepEvery after a month is renamed", async () => {
		openBookTime.calendar = REAL
		const target = document.createElement("div")
		document.body.append(target)
		app = mount(StoryCalendarEditor, {
			target,
			props: { lorebookId: 7, sample: { year: 2026, month: 1, day: 1 } }
		})
		flushSync()
		button("Edit the calendar").click()
		await tick()
		const name = q('input[aria-label="Month 1 name"]')!
		name.value = "Firstmonth"
		name.dispatchEvent(new Event("input", { bubbles: true }))
		await tick()
		// The preflight is asked after a pause; the book answers with nothing stranded.
		await new Promise((r) => setTimeout(r, 400))
		interests.get(interestKey("lorebooks:checkCalendar", 7))?.({ lorebookId: 7, stranded: [] })
		await tick()
		button("Save calendar").click()
		await tick()
		await tick()
		const saved = asks.find((a) => a.event === "lorebooks:setCalendar")
		expect(saved?.params.calendar.months[0].name).toBe("Firstmonth")
		expect(saved?.params.calendar.leap).toEqual({
			every: 4,
			month: 2,
			skipEvery: 100,
			keepEvery: 400
		})
	})

	test("with no sample the example starts at where a new session would start, else today, never Year 1", async () => {
		openBookTime.start = {
			branchId: null,
			date: { year: 2031, month: 4, day: 9 },
			cause: "latest"
		}
		const target = document.createElement("div")
		document.body.append(target)
		app = mount(StoryCalendarEditor, {
			target,
			props: { lorebookId: 7, sample: null }
		})
		flushSync()
		expect(q("[data-lore-calendar-example]")!.textContent).toContain("2031")
		unmount(app)
		app = null
		document.body.innerHTML = ""

		openBookTime.start = null
		vi.useFakeTimers({ toFake: ["Date"] })
		vi.setSystemTime(new Date(2029, 2, 5, 12))
		const again = document.createElement("div")
		document.body.append(again)
		app = mount(StoryCalendarEditor, {
			target: again,
			props: { lorebookId: 7, sample: null }
		})
		flushSync()
		const text = q("[data-lore-calendar-example]")!.textContent ?? ""
		expect(text).toContain("2029")
	})
})

describe("the clock editor", () => {
	function draw(present: any) {
		const sets: any[] = []
		const target = document.createElement("div")
		document.body.append(target)
		app = mount(StoryClockEditor, {
			target,
			props: {
				branchId: null,
				branchName: null,
				present,
				onSetClock: (c: any) => sets.push(c)
			}
		})
		flushSync()
		return sets
	}

	test("with no present it starts at the session start's date parts, and never writes the calendar", async () => {
		openBookTime.start = {
			branchId: null,
			date: { year: 2031, month: 4, day: 9, hour: 7, minute: 30 },
			cause: "today"
		}
		const sets = draw(null)
		button("Set the clock").click()
		await tick()
		const inputs = [...document.body.querySelectorAll<HTMLInputElement>("input[type=number]")]
		expect(inputs.slice(0, 3).map((i) => i.value)).toEqual(["2031", "4", "9"])
		expect(inputs[3]?.value ?? "").toBe("")
		;[...document.body.querySelectorAll("button")]
			.filter((b) => b.textContent?.includes("Set the clock"))
			.at(-1)!
			.click()
		await tick()
		expect(sets).toEqual([{ year: 2031, month: 4, day: 9, hour: null, minute: null }])
		expect(asks.some((a) => a.event === "lorebooks:setCalendar")).toBe(false)
	})

	test("with neither a present nor a start the year is empty, never 1", async () => {
		draw(null)
		button("Set the clock").click()
		await tick()
		expect(q("input[type=number]")!.value).toBe("")
	})
})
