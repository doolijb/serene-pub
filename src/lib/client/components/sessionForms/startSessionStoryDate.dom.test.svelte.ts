/**
 * Start a session › the story's start date under the chosen dated lorebook
 * (`lorebooks:storyTime`'s `start`): one line per cause, a Change button that
 * opens the line and clock control, and `asks` makes the date required (Start
 * waits, and says why). A lorebook with no timeline says nothing.
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

const { listeners, requests, asks, state, socket } = vi.hoisted(() => {
	const listeners = new Map<string, Array<(msg: any) => void>>()
	const requests: Array<{ key: string; params: any }> = []
	return {
		listeners,
		requests,
		asks: [] as Array<{ event: string; params: any }>,
		state: { refuse: false },
		socket: { emit: () => {}, on: () => {}, off: () => {} }
	}
})

vi.mock("$lib/client/sockets/loadSockets.client", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declareInterest = (key: string, handler: (msg: any) => void) => {
		listeners.set(key, [...(listeners.get(key) ?? []), handler])
		return () =>
			listeners.set(
				key,
				(listeners.get(key) ?? []).filter((h) => h !== handler)
			)
	}
	return {
		declareInterest,
		useInterest: declareInterest,
		requestWithInterest: (
			key: string,
			params: unknown,
			handler: (msg: any) => void
		) => {
			requests.push({ key, params })
			return declareInterest(key, handler)
		}
	}
})
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { success() {}, error() {}, info() {}, warning() {} }
}))
vi.mock("$lib/client/utils/awaitReply", () => ({
	awaitReply: async (o: { event: string; params: any }) => {
		asks.push({ event: o.event, params: o.params })
		if (o.event === "lorebooks:update") {
			if (state.refuse) throw new Error("Only the owner can do that.")
			return { requestId: o.params.requestId }
		}
		return { choices: [], defaultId: null }
	}
}))

import StartSessionForm from "./StartSessionForm.svelte"

const GENRE = "test:genre/troupe@1"
const VIS = "core:ruleset/vis-itineris@1"
const OFFER = {
	choices: [
		{ id: VIS, name: "Vis Itineris", subtitle: "", recommended: true }
	],
	only: false,
	defaultId: VIS,
	rigour: { options: ["prose", "mechanics", "scripts"], default: "mechanics" }
}
const SHAPE = {
	characters: { min: 0, max: 3 },
	personas: { min: 0, max: 1 },
	lorebook: "optional"
}
const book = (id: number, over: Record<string, unknown> = {}) => ({
	id,
	name: `Book ${id}`,
	kind: "book",
	primaryRuleset: VIS,
	bookAccess: "owner",
	timelineEnabled: false,
	...over
})
const BOOKS = [book(1), book(2, { timelineEnabled: true })]

let app: ReturnType<typeof mount> | null = null
let host: HTMLElement
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	requests.length = 0
	asks.length = 0
	state.refuse = false
	document.body.innerHTML = ""
})

async function settle() {
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}
function feed(key: string, msg: unknown) {
	for (const h of listeners.get(key) ?? []) h(msg)
}

async function render(
	rules: unknown,
	timelineDefault: boolean | undefined,
	books: readonly unknown[] = BOOKS
) {
	host = document.createElement("div")
	document.body.append(host)
	app = mount(StartSessionForm, {
		target: host,
		context: new Map([
			["userSettingsCtx", { settings: { showAdvancedControls: true } }]
		]),
		props: { onCreated: () => {}, onCancel: () => {} }
	})
	await settle()
	feed("sessions:genres", {
		genres: [
			{
				genreId: GENRE,
				name: "Troupe",
				description: "",
				...(rules ? { rules } : {}),
				shape: SHAPE
			}
		]
	})
	feed("sessionPresets:list", {
		presets: [
			{
				id: 1,
				genreId: GENRE,
				name: "Plain",
				enabled: true,
				isDefault: true,
				...(timelineDefault === undefined ? {} : { timelineDefault })
			}
		]
	})
	feed("characters:list", {
		characterList: [
			{ id: 5, name: "You", isPersona: true, isDefaultPersona: true }
		]
	})
	feed("lorebooks:list", { lorebookList: books })
	await settle()
	feed("starterKits:list", { kits: [] })
	await settle()
}

const pick = async (id: number) => {
	host.querySelector<HTMLButtonElement>(`[data-book-row="${id}"]`)!.click()
	await settle()
}
const line = () => host.querySelector('[data-testid="start-story-date"]')
const lineText = () => line()?.textContent?.replace(/\s+/g, " ").trim() ?? ""
const reading = () => host.querySelector('[data-testid="session-lorebook-reading"]')
const reply = (start: unknown) => ({
	lorebookId: 2,
	calendar: null,
	clocks: { main: null, branches: [] },
	presents: { main: null, branches: [] },
	start
})
const startButton = () =>
	[...host.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent?.trim() === "Start"
	)

describe.each([
	["the book pick (Lorebook and rules)", OFFER],
	["the plain Lorebook card", null]
] as const)("Start a session › story start date in %s", (_name, rules) => {
	test("a dated book asks for its start, once", async () => {
		await render(rules, undefined)
		expect(requests.filter((r) => r.key === "lorebooks:storyTime")).toHaveLength(0)
		await pick(2)
		expect(requests.filter((r) => r.key === "lorebooks:storyTime")).toEqual([
			{ key: "lorebooks:storyTime", params: { lorebookId: 2 } }
		])
	})

	test("a book with no timeline says nothing and asks nothing", async () => {
		await render(rules, undefined)
		await pick(1)
		expect(line() === null).toBe(true)
		expect(requests.filter((r) => r.key === "lorebooks:storyTime")).toHaveLength(0)
	})

	test.each(["present", "latest"] as const)("%s: where the book last was, with Change", async (cause) => {
		await render(rules, undefined)
		await pick(2)
		feed("lorebooks:storyTime", reply({ branchId: null, date: { year: 12, month: 4 }, cause }))
		await settle()
		expect(line()?.getAttribute("data-cause")).toBe(cause)
		expect(lineText()).toContain("The story begins on")
		expect(lineText()).toContain("where Book 2 last was.")
		expect(lineText()).toContain("Change")
		expect(reading() === null).toBe(true)
		expect(startButton()?.disabled).toBe(false)
	})

	test("today: the story begins today", async () => {
		await render(rules, undefined)
		await pick(2)
		feed(
			"lorebooks:storyTime",
			reply({ branchId: null, date: { year: 2026, month: 11, day: 16, hour: 12, minute: 30 }, cause: "today" })
		)
		await settle()
		expect(line()?.getAttribute("data-cause")).toBe("today")
		expect(lineText()).toContain("The story begins today,")
		expect(lineText()).toContain("2026")
	})

	test("Change opens the line and clock control", async () => {
		await render(rules, undefined)
		await pick(2)
		feed("lorebooks:storyTime", reply({ branchId: null, date: { year: 12, month: 4 }, cause: "present" }))
		await settle()
		host.querySelector<HTMLButtonElement>("[data-start-date-change]")!.click()
		await settle()
		expect(reading() !== null).toBe(true)
		expect(host.querySelector("[data-start-date-change]") === null).toBe(true)
	})

	test("asks: the control is shown, Start waits and says why", async () => {
		await render(rules, undefined)
		await pick(2)
		feed("lorebooks:storyTime", reply({ branchId: null, date: null, cause: "asks" }))
		await settle()
		expect(line()?.getAttribute("data-cause")).toBe("asks")
		expect(lineText()).toBe(
			"Today's date doesn't fit this lorebook's calendar, so choose the date the story begins on."
		)
		expect(reading() !== null).toBe(true)
		expect(host.querySelector("[data-start-date-change]") === null).toBe(true)
		expect(startButton()?.disabled).toBe(true)
		expect(host.querySelector("#start-session-reason")?.textContent?.trim()).toBe(
			"Choose the date the story begins on."
		)
	})
})
