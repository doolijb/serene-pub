/**
 * 🚧 The Scenes card names the routine that writes summaries when the session
 * has the *Summarize finished scenes* routine, and keeps the Summaries choice
 * when it does not.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

import { setSocket } from "$lib/client/sockets/socketInstance"
import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import SessionSceneSettings from "./SessionSceneSettings.svelte"

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

const routine = (
	pipeline: string,
	mode: string,
	name = "Summarize finished scenes"
) => ({
	registrationKey: `${pipeline}-key`,
	pipeline,
	name,
	cadence: { id: "x", name: "x", options: {} },
	mode,
	allowStacking: false,
	waiting: 0,
	running: false,
	runNow: false
})

function show(routines: any[] | null, disabled = false) {
	app = mount(SessionSceneSettings, {
		target,
		props: { genreShape: null, override: null, sessionId: 7, disabled }
	})
	flushSync()
	if (routines)
		client.dispatch("sessions:routines", { sessionId: 7, routines })
	flushSync()
}

const line = () =>
	target
		.querySelector("[data-scene-summaries-routine]")
		?.textContent?.replace(/\s+/g, " ")
		.trim() ?? ""
const summariesCombobox = () =>
	[...target.querySelectorAll<HTMLElement>('[role="combobox"]')].find(
		(el) =>
			(el.getAttribute("aria-label") ?? el.id ?? "").length >= 0 &&
			(el.closest("div")?.parentElement?.textContent ?? "").includes(
				"Summaries"
			)
	) ?? null

describe("the Scenes card and the summary routine", () => {
	test("a session with the routine shows its name and mode, not the select", () => {
		show([routine("core:spec/scene-summaries", "review")])
		expect(line()).toBe(
			"Summaries are written by the Summarize finished scenes routine (Review). Change it under Routines."
		)
		expect(!!target.querySelector('[id$="-summary-help"]')).toBe(false)
	})

	test("a disabled card does not point at Routines", () => {
		show([routine("core:spec/scene-summaries", "review")], true)
		expect(line()).toBe(
			"Summaries are written by the Summarize finished scenes routine (Review)."
		)
	})

	test("Off reads (Off)", () => {
		show([routine("core:spec/scene-summaries", "off")])
		expect(line()).toContain("routine (Off).")
	})

	test("without the routine the Summaries select shows with its three options", () => {
		show([
			routine(
				"core:spec/scene-boundaries",
				"full",
				"Find where scenes begin"
			)
		])
		expect(!!target.querySelector("[data-scene-summaries-routine]")).toBe(
			false
		)
		expect(!!target.querySelector('[id$="-summary-help"]')).toBe(true)
		expect((target.textContent ?? "").includes("Summaries")).toBe(true)
		expect(!!summariesCombobox()).toBe(true)
		expect(
			(
				target.querySelector('[id$="-summary-help"]')?.textContent ?? ""
			).trim()
		).toBe(
			"Summarize a scene when you choose, from the Chronicle or the scene's divider."
		)
	})

	test("before the routines answer, neither the select nor the routine's line shows", () => {
		// A pick made in that window would be sent and dropped by the server
		// without a word, so there is nothing to pick until the answer is in.
		show(null)
		expect(!!target.querySelector("[data-scene-summaries-routine]")).toBe(
			false
		)
		expect(!!target.querySelector('[id$="-summary-help"]')).toBe(false)
	})
})
