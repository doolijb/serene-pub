/**
 * SessionLorebookReading › `timeline`: off, the reading shows the Line picker
 * only; on (or left out), the story clock as before.
 *
 * ⚠ No DOM node is ever handed to `expect`: booleans and strings.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))
const { socket, listeners } = vi.hoisted(() => ({
	socket: { emit: () => {}, on: () => {}, off: () => {} },
	listeners: new Map<string, (msg: any) => void>()
}))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declareInterest = (key: string, handler: (msg: any) => void) => {
		listeners.set(key, handler)
		return () => {
			if (listeners.get(key) === handler) listeners.delete(key)
		}
	}
	return { declareInterest, useInterest: declareInterest, requestWithInterest: declareInterest }
})
vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))

import SessionLorebookReading from "./SessionLorebookReading.svelte"

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	document.body.innerHTML = ""
})

async function render(over: Record<string, unknown> = {}) {
	app = mount(SessionLorebookReading, {
		target: document.body,
		props: { lorebookId: 7, branchId: null, clock: null, ...over }
	})
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
const text = () => document.body.textContent ?? ""
const has = (sel: string) => document.body.querySelector(sel) !== null

describe("SessionLorebookReading › timeline", () => {
	test("off: the Line select stays, no story clock", async () => {
		await render({ timeline: false })
		expect(text()).toContain("Line")
		expect(text()).not.toContain("Story clock")
		expect(has('[data-testid="session-story-clock-followed"]')).toBe(false)
		expect(text()).not.toContain("Nothing on this line is dated yet")
		expect(has('[data-testid="session-story-clock"]')).toBe(false)
	})

	test("off with a clock held: still none drawn", async () => {
		await render({ timeline: false, clock: { year: 1, month: 1, day: 1 } })
		expect(text()).not.toContain("Story clock")
		expect(has('[data-testid="session-story-clock"]')).toBe(false)
	})

	test("off, read-only: the line alone, no story clock", async () => {
		await render({ timeline: false, readOnly: true })
		expect(text()).toContain("Line")
		expect(text()).not.toContain("Story clock")
		expect(text()).not.toContain("story clock")
		expect(has('[data-testid="session-story-clock-readonly"]')).toBe(false)
	})

	test("on, read-only: the story clock shows", async () => {
		await render({ readOnly: true })
		expect(has('[data-testid="session-story-clock-readonly"]')).toBe(true)
	})

	test.each([[true], [undefined]])(
		"on (%s): the story clock shows",
		async (v) => {
			await render(v === undefined ? {} : { timeline: v })
			expect(text()).toContain("Line")
			expect(text()).toContain("Story clock")
			expect(has('[data-testid="session-story-clock-followed"]')).toBe(
				true
			)
		}
	)
})

describe("SessionLorebookReading › an own clock's first value", () => {
	const reply = (start: unknown) => ({
		lorebookId: 7,
		calendar: null,
		clocks: { main: null, branches: [] },
		presents: { main: null, branches: [] },
		start
	})
	async function chooseOwn() {
		const inputs = [...document.body.querySelectorAll<HTMLInputElement>("input[role='combobox']")]
		const input = inputs.find((i) => i.value.includes("Follow"))!
		input.focus()
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
		await tick()
		await new Promise((r) => setTimeout(r, 20))
		flushSync()
		const option = [...document.body.querySelectorAll<HTMLElement>("[role='option']")].find((o) =>
			o.textContent?.includes("own clock")
		)!
		option.click()
		await tick()
		await new Promise((r) => setTimeout(r, 20))
		flushSync()
	}
	const inputs = () => [...document.body.querySelectorAll<HTMLInputElement>('[data-testid="session-story-clock"] input')]

	test("with no present it starts at the book's start date, never Year 1", async () => {
		await render({})
		listeners.get("lorebooks:storyTime#7")!(
			reply({ branchId: null, date: { year: 2026, month: 11, day: 16, hour: 12, minute: 30 }, cause: "today" })
		)
		flushSync()
		await chooseOwn()
		expect(inputs()[0]?.value).toBe("2026")
		expect(inputs()[1]?.value).toBe("11")
	})

	test("with no present and no start date the inputs are empty and ask for a year", async () => {
		await render({})
		listeners.get("lorebooks:storyTime#7")!(reply({ branchId: null, date: null, cause: "asks" }))
		flushSync()
		await chooseOwn()
		// The five clock fields (year, month, day, hour, minute), not Step by and its unit.
		expect(inputs().slice(0, 5).map((i) => i.value)).toEqual(["", "", "", "", ""])
		expect(document.body.querySelector("#session-story-clock-hint")?.textContent?.trim()).toBe("The clock needs a year.")
	})
})
