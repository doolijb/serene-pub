/**
 * 🚧 The session's step settings in its form (PROPOSAL-live-scenes §15 G11):
 * the reply tick under *The story › Story clock*, every other step's story
 * settings as one card; each field writes at once, a refusal is said under
 * it (never a toast), and **Reset** clears the session's own value.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

import { setSocket } from "$lib/client/sockets/socketInstance"
import { _resetInterestForTests, setInterestUser } from "$lib/client/sockets/interest.svelte"
import SessionStepSettings from "./SessionStepSettings.svelte"

type Listener = (payload: any) => void
function makeClientSocket() {
	const listeners = new Map<string, Listener[]>()
	return {
		connected: true,
		id: "tab-a",
		emits: [] as Array<{ event: string; payload: any }>,
		on(event: string, fn: Listener) {
			listeners.set(event, [...(listeners.get(event) ?? []), fn])
		},
		off(event: string, fn: Listener) {
			const arr = listeners.get(event) ?? []
			const at = arr.indexOf(fn)
			if (at !== -1) arr.splice(at, 1)
		},
		emit(event: string, payload: any) {
			this.emits.push({ event, payload })
		},
		dispatch(event: string, payload: any) {
			for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
		}
	}
}

const TICK = {
	spec: "core:spec/story-respond",
	specName: "Reply",
	nodeKey: "tick",
	definitionId: "core:task/clock-step@1",
	heading: "Each reply advances the clock by",
	fields: [
		{ path: "by", label: "By", control: "integer", value: 0, inherited: 0, source: "author" },
		{
			path: "unit",
			label: "Unit",
			control: "enum",
			members: [
				{ key: "minutes", label: "Minutes" },
				{ key: "hours", label: "Hours" }
			],
			value: "hours",
			inherited: "minutes",
			source: "session"
		}
	]
}
const SPRITES = {
	spec: "core:spec/story-respond",
	specName: "Reply",
	nodeKey: "spritePick",
	definitionId: "core:oracle/pick-sprite@1",
	heading: "Pick a sprite",
	fields: [{ path: "enabled", label: "Choose sprites", control: "boolean", value: true, inherited: true, source: "author" }]
}

let client: ReturnType<typeof makeClientSocket>
let app: ReturnType<typeof mount> | null = null
let target: HTMLElement

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: false })
	target = document.createElement("div")
	document.body.append(target)
})

afterEach(() => {
	if (app) unmount(app)
	app = null
	_resetInterestForTests()
	setSocket(null)
	document.body.innerHTML = ""
})

function show(place: "story-clock" | "other") {
	app = mount(SessionStepSettings, { target, props: { sessionId: 7, place, cardClass: "card" } })
	flushSync()
	client.dispatch("sessions:stepSettings", { sessionId: 7, steps: [TICK, SPRITES] })
	flushSync()
}

const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? ""
const writes = () => client.emits.filter((e) => e.event === "sessions:setStepSetting").map((e) => e.payload)

describe("step settings in the session's form", () => {
	test("asks for the session's step settings once mounted", () => {
		show("story-clock")
		expect(client.emits.filter((e) => e.event === "sessions:stepSettings")).toEqual([
			{ event: "sessions:stepSettings", payload: { sessionId: 7 } }
		])
	})

	test("under the story clock: the reply tick alone, applied at once", () => {
		show("story-clock")
		expect(text()).toContain("Each reply advances the clock by · Applies at once")
		expect(text()).not.toContain("Choose sprites")
		const by = target.querySelector<HTMLInputElement>('input[type="number"]')!
		expect(by.value).toBe("0")
		by.value = "5"
		by.dispatchEvent(new Event("change", { bubbles: true }))
		flushSync()
		expect(writes()).toEqual([
			expect.objectContaining({ sessionId: 7, spec: TICK.spec, nodeKey: "tick", path: "by", value: 5 })
		])
	})

	test("a refusal is said under its field; Reset clears the session's own value", async () => {
		show("story-clock")
		const by = target.querySelector<HTMLInputElement>('input[type="number"]')!
		by.value = "2"
		by.dispatchEvent(new Event("change", { bubbles: true }))
		flushSync()
		const [asked] = writes()
		client.dispatch("sessions:setStepSetting", {
			...asked,
			error: "By is at most 1. Nothing was saved."
		})
		// The reply settles the write's promise; its continuation says the refusal.
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		expect(target.querySelector('[role="alert"]')?.textContent).toContain("By is at most 1")
		// The unit is the session's own: Reset sends null.
		const reset = [...target.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Reset")!
		expect(text()).toContain("Set for this session. Reset to Minutes.")
		reset.click()
		flushSync()
		expect(writes().at(-1)).toEqual(expect.objectContaining({ path: "unit", value: null }))
	})

	test("elsewhere: every other step as one card, never the clock's", () => {
		show("other")
		expect(target.querySelector('[data-testid="session-step-settings"]')).not.toBeNull()
		expect(text()).toContain("Step settings")
		expect(text()).toContain("Choose sprites")
		expect(text()).not.toContain("Each reply advances the clock by")
		const sw = target.querySelector<HTMLInputElement>('input[role="switch"]')!
		expect(sw.checked).toBe(true)
		sw.click()
		flushSync()
		expect(writes().at(-1)).toEqual(expect.objectContaining({ nodeKey: "spritePick", path: "enabled", value: false }))
	})

	test("nothing to show draws nothing", () => {
		app = mount(SessionStepSettings, { target, props: { sessionId: 7, place: "other" } })
		flushSync()
		client.dispatch("sessions:stepSettings", { sessionId: 7, steps: [TICK] })
		flushSync()
		expect(text()).toBe("")
	})
})
