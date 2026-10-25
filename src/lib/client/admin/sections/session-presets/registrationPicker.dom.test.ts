/**
 * 🚧 The preset editor's pipeline picker, filtered by fit (PLAN-layering R4,
 * A11; lane 7): for the trigger chosen, the server's candidates — those that
 * fit are the choices (made-for-it first), those that do not are listed
 * apart, greyed, each with why in words; an action's own pipeline is picked
 * for the person when it fits.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

import { setSocket } from "$lib/client/sockets/socketInstance"
import { _resetInterestForTests, setInterestUser } from "$lib/client/sockets/interest.svelte"
import RegistrationPicker from "./RegistrationPicker.svelte"

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

const SCENE_OPENED = { family: "event", event: "core:event/scene-opened@1" }
const CANDIDATES = [
	{ slug: "core:spec/story-illustrate-scene", name: "Picture the scene", fits: true, suits: true },
	{ slug: "acme:spec/scene-chime", name: "Scene chime", fits: true },
	{
		slug: "core:spec/story-respond",
		name: "Story reply",
		fits: false,
		reason: "Story reply reads the speaker; scene-opened carries none."
	}
]

let client: ReturnType<typeof makeClientSocket>
let app: ReturnType<typeof mount> | null = null
let target: HTMLElement

beforeEach(() => {
	client = makeClientSocket()
	setSocket(client as never)
	setInterestUser({ id: 1, isAdmin: true })
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

function show(trigger: Record<string, unknown> | null, opts: { suggested?: string | null } = {}) {
	const picks: Array<{ slug: string }> = []
	app = mount(RegistrationPicker, {
		target,
		props: { trigger, picked: null, suggested: opts.suggested ?? null, onpick: (c: { slug: string }) => picks.push(c) }
	})
	flushSync()
	return picks
}

const asked = () => client.emits.filter((e) => e.event === "sessionPresets:candidates").map((e) => e.payload)
function answer(candidates = CANDIDATES) {
	const [q] = asked()
	client.dispatch("sessionPresets:candidates", { requestId: q.requestId, candidates })
	flushSync()
}
const choices = () => [...target.querySelectorAll<HTMLButtonElement>('[role="radio"][data-candidate]')]

describe("the pipeline picker, filtered by fit", () => {
	test("asks nothing until the trigger is chosen", () => {
		show(null)
		expect(asked()).toHaveLength(0)
		expect(target.textContent).toContain("Choose what it runs on first.")
	})

	test("asks the server for the trigger's candidates", () => {
		show(SCENE_OPENED)
		expect(asked()).toEqual([expect.objectContaining({ trigger: SCENE_OPENED })])
	})

	test("only pipelines that fit are choices; the made-for-it one is marked", () => {
		show(SCENE_OPENED)
		answer()
		expect(choices().map((b) => b.dataset.candidate)).toEqual(["core:spec/story-illustrate-scene", "acme:spec/scene-chime"])
		expect(choices()[0]!.textContent).toContain("Made for this")
		expect(target.querySelector('[data-candidate="core:spec/story-respond"]') === null).toBe(true)
	})

	test("one that does not fit is listed apart with why, never as a choice", () => {
		show(SCENE_OPENED)
		answer()
		const unfit = target.querySelector<HTMLElement>('[data-unfit="core:spec/story-respond"]')
		expect(unfit === null).toBe(false)
		expect(unfit!.textContent).toContain("Story reply reads the speaker; scene-opened carries none.")
		expect(unfit!.querySelector("button") === null).toBe(true)
		expect(target.querySelector('[data-testid="registration-picker-unfit"] summary')?.textContent).toContain(
			"1 pipeline does not fit"
		)
	})

	test("a press picks a pipeline", () => {
		const picks = show(SCENE_OPENED)
		answer()
		choices()[1]!.click()
		flushSync()
		expect(picks.map((p) => p.slug)).toEqual(["acme:spec/scene-chime"])
	})

	test("an action's own pipeline is picked for the person when it fits", () => {
		const picks = show({ family: "action", action: "acme:spec/scene-chime#chime" }, { suggested: "acme:spec/scene-chime" })
		answer()
		expect(picks.map((p) => p.slug)).toEqual(["acme:spec/scene-chime"])
	})

	test("nothing fits: it says so", () => {
		show(SCENE_OPENED)
		answer([CANDIDATES[2]!])
		expect(choices()).toHaveLength(0)
		expect(target.textContent).toContain("No published pipeline fits this.")
	})
})
