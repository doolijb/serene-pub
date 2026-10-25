/**
 * 🚧 The composer's **Routines** sub-menu (PLAN-layering R39; lane 7): the
 * session's owner only, listing the routines that are not Off; a press fires
 * `sessions:runRoutine`; an item says when a run is already waiting, and —
 * Allow stacking off — cannot be pressed again.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

import { setSocket } from "$lib/client/sockets/socketInstance"
import { _resetInterestForTests, setInterestUser } from "$lib/client/sockets/interest.svelte"
import ComposerRoutinesMenu from "./ComposerRoutinesMenu.svelte"

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

const routine = (over: Record<string, unknown>) => ({
	registrationKey: "every-n-turns→story-sweep",
	pipeline: "core:spec/story-sweep",
	name: "Look back over the story",
	cadence: { id: "core:cadence/every-n-turns@1", name: "Every few turns", options: { n: 5 } },
	clock: undefined,
	mode: "full",
	allowStacking: false,
	waiting: 0,
	running: false,
	runNow: true,
	...over
})

const ROUTINES = [
	routine({}),
	routine({
		registrationKey: "after-each-round→story-reckoning",
		pipeline: "core:spec/story-reckoning",
		name: "Note what changed",
		cadence: { id: "core:cadence/after-each-round@1", name: "After each round", options: {} },
		waiting: 1
	}),
	routine({
		registrationKey: "on-event→story-illustrate-new-scene",
		pipeline: "core:spec/story-illustrate-new-scene",
		name: "Picture each new scene",
		mode: "off",
		runNow: false
	})
]

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

function show(isOwner: boolean, routines: unknown[] = ROUTINES) {
	app = mount(ComposerRoutinesMenu, { target, props: { sessionId: 7, isOwner, chipClass: "chip" } })
	flushSync()
	client.dispatch("sessions:routines", { sessionId: 7, routines })
	flushSync()
}

const trigger = () => target.querySelector<HTMLButtonElement>('[aria-label="Routines: run one now"]')
const menuItem = (name: RegExp) =>
	[...document.querySelectorAll<HTMLElement>("[role=menuitem]")].find((el) => name.test((el.textContent ?? "").trim()))

async function open() {
	trigger()!.click()
	flushSync()
	await tick()
}

describe("the composer's Routines sub-menu", () => {
	test("a guest never sees it, and asks nothing", () => {
		show(false)
		expect(trigger() === null).toBe(true)
		expect(client.emits.some((e) => e.event === "sessions:routines")).toBe(false)
	})

	test("the owner sees it while a routine is enabled", () => {
		show(true)
		expect(trigger() === null).toBe(false)
		expect(target.textContent).toContain("Routines")
	})

	test("nothing enabled, no chip", () => {
		show(true, [ROUTINES[2]])
		expect(trigger() === null).toBe(true)
	})

	test("lists the enabled routines; one waiting says so and is greyed", async () => {
		show(true)
		await open()
		expect(menuItem(/^Look back over the story$/) === undefined).toBe(false)
		const waiting = menuItem(/Note what changed — already waiting/)
		expect(waiting === undefined).toBe(false)
		expect(waiting!.hasAttribute("data-disabled")).toBe(true)
		expect(menuItem(/Picture each new scene/) === undefined).toBe(true)
	})

	test("a press runs it now; the answer is said beside the chip", async () => {
		show(true)
		await open()
		const item = menuItem(/^Look back over the story$/)!
		item.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }))
		item.click()
		flushSync()
		await tick()
		const asked = client.emits.filter((e) => e.event === "sessions:runRoutine").map((e) => e.payload)
		expect(asked).toEqual([
			expect.objectContaining({ sessionId: 7, registrationKey: "every-n-turns→story-sweep" })
		])
		client.dispatch("sessions:runRoutine", { ...asked[0], queued: true })
		flushSync()
		expect(target.querySelector('[data-testid="composer-routines-said"]')?.textContent).toContain(
			"Look back over the story will run once the story settles."
		)
	})
})
