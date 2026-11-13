/**
 * Start a session › the books that are not yours, grouped by source: one group
 * per plugin (core = Serene Pub), then one per person who shared. Own books stay first.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, requests, socket } = vi.hoisted(() => {
	const listeners = new Map<string, Array<(msg: any) => void>>()
	/** Every request the form sent, in order. */
	const requests: Array<{ key: string; params: any }> = []
	return {
		listeners,
		requests,
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
	toaster: {
		success: () => {},
		error: () => {},
		info: () => {},
		warning: () => {}
	}
}))

import StartSessionForm from "./StartSessionForm.svelte"

const GENRE = "test:genre/troupe@1"
const VIS = "core:ruleset/vis-itineris@1"
const STORY = "core:ruleset/freeform@1"

const OFFER = {
	choices: [
		{
			id: VIS,
			name: "Vis Itineris",
			subtitle: "Heroes.",
			recommended: true
		},
		{
			id: STORY,
			name: "Story",
			subtitle: "Words decide.",
			recommended: false
		}
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

const BOOKS = [
	{ id: 1, name: "Mine", kind: "book", primaryRuleset: VIS },
	{
		id: 2,
		name: "Zed book",
		kind: "book",
		primaryRuleset: VIS,
		provided: { disabled: false, pluginName: "Zed Plugin" }
	},
	{
		id: 3,
		name: "Core book",
		kind: "book",
		primaryRuleset: VIS,
		provided: { disabled: false, pluginName: null }
	},
	{
		id: 4,
		name: "Ada book",
		kind: "book",
		primaryRuleset: VIS,
		provided: { disabled: false, pluginName: "Ada Plugin" }
	},
	{
		id: 5,
		name: "Zed two",
		kind: "book",
		primaryRuleset: VIS,
		provided: { disabled: false, pluginName: "Zed Plugin" }
	},
	{
		id: 6,
		name: "Wren tale",
		kind: "book",
		primaryRuleset: VIS,
		surfacedFromSessionId: 21,
		isSharedWithMe: true,
		ownerName: "Wren"
	},
	{
		id: 7,
		name: "Ash tale",
		kind: "book",
		primaryRuleset: VIS,
		surfacedFromSessionId: 22,
		isSharedWithMe: true,
		ownerName: "Ash"
	},
	{
		id: 8,
		name: "Nameless tale",
		kind: "book",
		primaryRuleset: VIS,
		surfacedFromSessionId: 23,
		isSharedWithMe: true,
		ownerName: null
	},
	{
		id: 9,
		name: "Wren two",
		kind: "book",
		primaryRuleset: VIS,
		surfacedFromSessionId: 24,
		isSharedWithMe: true,
		ownerName: "Wren"
	}
]
const KITS = [
	{
		id: "primer:x",
		source: "core",
		name: "Kit X",
		description: "",
		rulesId: VIS,
		rulesName: "Vis Itineris",
		counts: { entries: 1, places: 0, cast: 0 }
	}
]

let app: ReturnType<typeof mount> | null = null
let host: HTMLElement
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	requests.length = 0
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

async function render(rules: unknown, books: readonly unknown[] = BOOKS) {
	host = document.createElement("div")
	document.body.append(host)
	app = mount(StartSessionForm, {
		target: host,
		context: new Map([["userSettingsCtx", { settings: { showAdvancedControls: true } }]]),
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
				isDefault: true
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
	feed("starterKits:list", { kits: KITS })
	await settle()
}

const groups = (kind: string) => [
	...host.querySelectorAll(`[data-book-group="${kind}"]`)
]
const labels = (kind: string) =>
	groups(kind).map((g) => g.getAttribute("data-book-group-label") ?? "")
const rowsIn = (g: Element) =>
	[...g.querySelectorAll("[data-book-row]")].map(
		(b) => b.getAttribute("data-book-row") ?? ""
	)
const groupOf = (id: number) =>
	host
		.querySelector(`[data-book-row="${id}"]`)
		?.closest("[data-book-group]")
		?.getAttribute("data-book-group-label") ?? null
const headingTexts = (kind: string) =>
	groups(kind).map(
		(g) =>
			g.querySelector("p")?.textContent?.replace(/\s+/g, " ").trim() ?? ""
	)
const startPayload = () => {
	const start = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent?.trim() === "Start"
	)
	start?.click()
	flushSync()
	return requests
		.filter((r) => r.key === "sessions:create")
		.map((r) => r.params)
}
const click = async (id: number) => {
	host.querySelector<HTMLButtonElement>(`[data-book-row="${id}"]`)!.click()
	await settle()
}

describe.each([
	["the book pick (Lorebook and rules)", OFFER],
	["the plain Lorebook card", null]
] as const)("Start a session › books by source in %s", (name, rules) => {
	test("groups, headings and order", async () => {
		await render(rules)
		expect(host.querySelector("[data-book-pick]") !== null).toBe(
			rules !== null
		)
		expect(labels("plugin")).toEqual([
			"Ada Plugin",
			"Serene Pub",
			"Zed Plugin"
		])
		expect(headingTexts("plugin")).toEqual([
			"Comes with Ada Plugin",
			"Comes with Serene Pub",
			"Comes with Zed Plugin"
		])
		expect(labels("shared")).toEqual(["Ash", "Shared with you", "Wren"])
		expect(headingTexts("shared")).toEqual([
			"Shared by Ash",
			"Shared with you",
			"Shared by Wren"
		])
		expect(
			groups("shared").every((g) =>
				g.textContent!.includes("Their session's lorebook")
			)
		).toBe(true)
		expect(
			groups("shared").some((g) =>
				g.textContent!.includes("Shared by Wren Shared by")
			)
		).toBe(false)
		expect(groupOf(1)).toBeNull()
		expect(groupOf(4)).toBe("Ada Plugin")
		expect(groupOf(3)).toBe("Serene Pub")
		expect(groupOf(2)).toBe("Zed Plugin")
		expect(groupOf(5)).toBe("Zed Plugin")
		expect(groupOf(7)).toBe("Ash")
		expect(groupOf(8)).toBe("Shared with you")
		expect(groupOf(6)).toBe("Wren")
		expect(groupOf(9)).toBe("Wren")
		const zed = groups("plugin").find(
			(g) => g.getAttribute("data-book-group-label") === "Zed Plugin"
		)!
		expect(rowsIn(zed)).toEqual(["2", "5"])
		// Every group's heading id is unique, and the shared ones sit in one wrapper.
		const ids = [...host.querySelectorAll('p[id*="-heading-"]')].map(
			(p) => p.id
		)
		expect(new Set(ids).size).toBe(ids.length)
		expect(
			host.querySelectorAll(
				"[data-surfaced-books] [data-book-group='shared']"
			).length
		).toBe(3)
		expect(
			host.querySelector(
				"[data-surfaced-books] [data-book-group='plugin']"
			) === null
		).toBe(true)
		expect(
			host.textContent!.includes("Start from a starter lorebook")
		).toBe(true)
		// Own first, then plugins, then people, then the starter lorebooks.
		const order = [
			...host.querySelectorAll(
				"[data-book-row], [data-book-group], [data-starter-kits]"
			)
		].map(
			(el) =>
				el.getAttribute("data-book-row") ??
				el.getAttribute("data-book-group") ??
				"kits"
		)
		const first = (v: string) => order.indexOf(v)
		expect(order[0]).toBe("1")
		expect(first("plugin")).toBeGreaterThan(first("1"))
		expect(first("shared")).toBeGreaterThan(order.lastIndexOf("plugin"))
		expect(first("kits")).toBeGreaterThan(order.lastIndexOf("shared"))
	})

	test("a plugin row is read directly, in the new mode", async () => {
		await render(rules)
		await click(3)
		const sent = startPayload()[0]
		expect(sent.mode ?? "new").toBe("new")
		expect((sent.session ?? sent).lorebookId).toBe(3)
	})

	test("someone with only shared books still sees them, under the own-notes line", async () => {
		const shared = (BOOKS as readonly { isSharedWithMe?: boolean; provided?: unknown }[]).filter(
			(b) => b.isSharedWithMe && !b.provided
		)
		expect(shared.length).toBeGreaterThan(0)
		await render(rules, shared)
		expect(labels("plugin")).toEqual([])
		expect(groups("shared").length).toBeGreaterThan(0)
		expect(host.textContent!.replace(/\s+/g, " ")).toContain(
			"You have no lorebooks of your own yet. The session can keep its world in its own notes."
		)
		expect(host.textContent).not.toContain("start without one")
	})

	test("a shared row starts the copy mode", async () => {
		await render(rules)
		await click(6)
		const sent = startPayload()[0]
		expect(sent.mode).toBe("new-world")
		expect(sent.session.lorebookId).toBe(6)
	})
})
