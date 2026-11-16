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
const { socket } = vi.hoisted(() => ({
	socket: { emit: () => {}, on: () => {}, off: () => {} }
}))
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
