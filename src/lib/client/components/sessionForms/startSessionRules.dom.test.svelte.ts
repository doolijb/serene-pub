/**
 * 🚧 Start a session › Rules and How strict (PLAN-rulesets §4, §21;
 * NOMENCLATURE §28): the genre's offer, its recommended rules first and
 * starred, How strict pre-selected at the genre's default; a chosen
 * lorebook's rules adopted ("From the lorebook: ‹name›"); Chat asks neither.
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

const CHARACTERS = [
	{ id: 1, name: "Jasmine" },
	{ id: 2, name: "Bram" },
	{ id: 3, name: "Corin" },
	{ id: 4, name: "Dell" },
	{ id: 5, name: "You", isPersona: true, isDefaultPersona: true },
	{ id: 6, name: "Wren", isPersona: true }
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

const VIS = "core:ruleset/vis-itineris@1"
const STORY = "core:ruleset/freeform@1"

const OFFER = {
	choices: [
		{ id: VIS, name: "Vis Itineris", subtitle: "Heroes whose deeds move the world.", recommended: true },
		{ id: STORY, name: "Story", subtitle: "Words decide; no numbers.", recommended: false }
	],
	only: false,
	defaultId: VIS,
	rigour: { options: ["prose", "mechanics", "scripts"], default: "mechanics" }
}

const OPEN_SHAPE = {
	characters: { min: 0, max: 3 },
	personas: { min: 0, max: 1 },
	lorebook: "optional"
}

async function render(
	rules: unknown,
	lorebookList: unknown[] = [],
	shape: Record<string, unknown> = OPEN_SHAPE,
	characterList: unknown[] = CHARACTERS
) {
	host = document.createElement("div")
	document.body.append(host)
	app = mount(StartSessionForm, {
		target: host,
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
				shape
			}
		]
	})
	feed("sessionPresets:list", {
		presets: [{ id: 1, genreId: GENRE, name: "Plain", enabled: true, isDefault: true }]
	})
	feed("characters:list", { characterList })
	feed("lorebooks:list", { lorebookList })
	await settle()
}

const heading = (text: string) =>
	[...host.querySelectorAll("h3")].find((h) => h.textContent?.trim() === text) ?? null
const choice = (id: string) => host.querySelector<HTMLButtonElement>(`[data-rules-choice="${id}"]`)
const strictness = (id: string) => host.querySelector<HTMLButtonElement>(`[data-how-strict="${id}"]`)

describe("Start a session › Rules and How strict", () => {
	test("the genre's recommended rules come first and starred; How strict starts at the genre's default", async () => {
		await render(OFFER)
		expect(heading("Rules")).not.toBeNull()
		const order = [...host.querySelectorAll("[data-rules-choice]")].map((b) => b.getAttribute("data-rules-choice"))
		expect(order).toEqual([VIS, STORY])
		expect(choice(VIS)!.getAttribute("aria-checked")).toBe("true")
		expect(choice(VIS)!.querySelector('[aria-label="Recommended for this genre"]')).not.toBeNull()
		expect(choice(STORY)!.querySelector('[aria-label="Recommended for this genre"]')).toBeNull()
		expect(heading("How strict")).not.toBeNull()
		expect([...host.querySelectorAll("[data-how-strict]")].map((b) => b.textContent?.trim())).toEqual([
			"Words only",
			"Rules",
			"Rules and dice"
		])
		expect(strictness("mechanics")!.getAttribute("aria-checked")).toBe("true")
		// No SDK noun reaches the screen (§28).
		expect(host.textContent?.toLowerCase()).not.toMatch(/ruleset|rigour/)
	})

	test("the picks travel with the create", async () => {
		await render(OFFER)
		choice(STORY)!.click()
		strictness("scripts")!.click()
		await settle()
		expect(choice(STORY)!.getAttribute("aria-checked")).toBe("true")
		const [first] = flowPayload()
		expect(first).toMatchObject({ primaryRuleset: STORY, rigour: "scripts" })
	})

	test("a chosen lorebook's rules are adopted, and the picker says so", async () => {
		await render(OFFER, [{ id: 7, name: "Drowned Coast", primaryRuleset: VIS }])
		const book = [...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find(
			(b) => b.textContent?.trim() === "Drowned Coast"
		)!
		book.click()
		await settle()
		expect(host.querySelector("[data-rules-from-lorebook]")?.textContent?.trim()).toBe(
			"From the lorebook: Vis Itineris"
		)
		expect(host.querySelector("[data-rules-choice]")).toBeNull()
		// How strict is still the session's to choose.
		expect(heading("How strict")).not.toBeNull()
	})

	/** The DOM order of the cards by their headings. */
	const cardOrder = () =>
		[...host.querySelectorAll("h3")]
			.map((h) => h.textContent?.trim())
			.filter((t) => t === "Rules" || t?.startsWith("Lorebook"))

	test("Adventure: the lorebook is asked first, and Rules never shows ahead of it", async () => {
		const adventure = {
			characters: { min: 1, max: 6 },
			personas: { min: 0, max: 1 },
			lorebook: "required"
		}
		const books = [{ id: 7, name: "Vis Itineris", primaryRuleset: VIS }]
		// Nobody in it yet: the lorebook step is not open, so neither is Rules
		// — never "From the lorebook" with no lorebook on screen.
		await render(OFFER, books, adventure, [])
		expect(heading("Lorebook*")).toBeNull()
		expect(heading("Rules")).toBeNull()
	})

	test("Adventure with its cast answered: Lorebook card, then Rules derived from it", async () => {
		const adventure = {
			characters: { min: 0, max: 6 },
			personas: { min: 0, max: 1 },
			lorebook: "required"
		}
		await render(OFFER, [{ id: 7, name: "Vis Itineris", primaryRuleset: VIS }], adventure)
		expect(cardOrder()).toEqual(["Lorebook*", "Rules"])
		const book = [...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find(
			(b) => b.textContent?.trim() === "Vis Itineris"
		)!
		// The one book is chosen for the person, and shown chosen.
		expect(book.getAttribute("aria-checked")).toBe("true")
		expect(host.querySelector("[data-rules-from-lorebook]")?.textContent?.trim()).toBe(
			"From the lorebook: Vis Itineris"
		)
	})

	test("Chat: the lorebook picker, no Rules", async () => {
		await render(null, [{ id: 7, name: "Vis Itineris" }])
		expect(cardOrder()).toEqual(["Lorebook"])
	})

	test("Dungeon Crawler (no lorebook step): Rules alone", async () => {
		await render(OFFER, [{ id: 7, name: "Vis Itineris" }], {
			characters: { min: 0, max: 0 },
			personas: { min: 0, max: 1 }
		})
		expect(cardOrder()).toEqual(["Rules"])
	})

	test("a genre that offers no choice (Chat) asks neither", async () => {
		await render(null)
		expect(heading("Rules")).toBeNull()
		expect(heading("How strict")).toBeNull()
	})
})

/**
 * What Start would send, read off the form's own create: a character is
 * added through the flow the cast test drives, then Start is pressed.
 */
function flowPayload(): any[] {
	const start = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Start")
	start?.click()
	flushSync()
	return requests.filter((r) => r.key === "sessions:create").map((r) => r.params.session)
}
