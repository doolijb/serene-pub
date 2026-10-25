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
	characterList: unknown[] = CHARACTERS,
	presets: unknown[] = [{ id: 1, genreId: GENRE, name: "Plain", enabled: true, isDefault: true }]
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
	feed("sessionPresets:list", { presets })
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
			"The rules decide"
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

	test("How strict follows a lorebook's rules, not the genre's default it replaced", async () => {
		// The genre starts on rules that play Words only (the Lair's Freeform);
		// the book brings rules that play all three (REPORT-lair-L5 start-form bug).
		const wordsFirst = {
			...OFFER,
			choices: [
				{ id: STORY, name: "Story", subtitle: "Words decide; no numbers.", recommended: true, rigours: ["prose"] },
				{ id: VIS, name: "Vis Itineris", subtitle: "Heroes whose deeds move the world.", recommended: true }
			],
			defaultId: STORY
		}
		await render(wordsFirst, [{ id: 7, name: "Drowned Coast", primaryRuleset: VIS }])
		// No book yet: the genre's rules, Words only, so nothing to ask.
		expect(heading("How strict")).toBeNull()
		const book = [...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find(
			(b) => b.textContent?.trim() === "Drowned Coast"
		)!
		book.click()
		await settle()
		expect(host.querySelector("[data-rules-from-lorebook]")?.textContent?.trim()).toBe(
			"From the lorebook: Vis Itineris"
		)
		expect([...host.querySelectorAll("[data-how-strict]")].map((b) => b.getAttribute("data-how-strict"))).toEqual([
			"prose",
			"mechanics",
			"scripts"
		])
		// The genre's default, which the book's rules play — not stuck on Words only.
		expect(strictness("mechanics")!.getAttribute("aria-checked")).toBe("true")
		strictness("scripts")!.click()
		await settle()
		expect(strictness("scripts")!.getAttribute("aria-checked")).toBe("true")
		const [first] = flowPayload()
		expect(first).toMatchObject({ lorebookId: 7, rigour: "scripts" })
		// The book's rules are adopted server-side: none is sent.
		expect(first.primaryRuleset).toBeUndefined()
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
			lorebook: "optional"
		}
		const books = [{ id: 7, name: "Vis Itineris", primaryRuleset: VIS }]
		// Nobody in it yet: the lorebook step is not open, so neither is Rules
		// — never "From the lorebook" with no lorebook on screen.
		await render(OFFER, books, adventure, [])
		expect(heading("Lorebook")).toBeNull()
		expect(heading("Rules")).toBeNull()
	})

	test("Adventure with its cast answered: Lorebook card, then Rules derived from it", async () => {
		const adventure = {
			characters: { min: 0, max: 6 },
			personas: { min: 0, max: 1 },
			lorebook: "optional"
		}
		await render(OFFER, [{ id: 7, name: "Vis Itineris", primaryRuleset: VIS }], adventure)
		expect(cardOrder()).toEqual(["Lorebook", "Rules"])
		const book = [...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find(
			(b) => b.textContent?.trim() === "Vis Itineris"
		)!
		// Never required (RF fix 2): None stands until the person picks the book.
		expect(book.getAttribute("aria-checked")).toBe("false")
		book.click()
		await settle()
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
describe("Start a session › Start from a starter lorebook", () => {
	const KITS = [
		{
			id: "primer:drowned-coast",
			source: "core",
			name: "The Drowned Coast",
			description: "A storm-wrecked shore.",
			rulesId: VIS,
			rulesName: "Vis Itineris",
			counts: { entries: 12, places: 3, cast: 2 }
		}
	]

	test("a kit beside the books: its rules adopted, one line about its notes, and it travels as starterKit", async () => {
		await render(OFFER, [
			{ id: 7, name: "Drowned Coast", primaryRuleset: VIS },
			// An admin's own kit is on their shelf too: never offered as a book.
			{ id: 9, name: "My kit", primaryRuleset: VIS, kind: "starter_kit" }
		])
		expect(requests.some((r) => r.key === "starterKits:list")).toBe(true)
		feed("starterKits:list", { kits: KITS })
		await settle()
		const radios = () => [...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]')]
		expect(radios().some((b) => b.textContent?.trim() === "My kit")).toBe(false)
		const kit = host.querySelector<HTMLButtonElement>('[data-starter-kit="primer:drowned-coast"]')
		expect(kit === null).toBe(false)
		kit!.click()
		await settle()
		expect(kit!.getAttribute("aria-checked")).toBe("true")
		expect(host.querySelector("[data-rules-from-lorebook]")?.textContent?.trim()).toBe(
			"From the starter lorebook: Vis Itineris"
		)
		expect(host.querySelector("[data-start-kit-note]") === null).toBe(false)
		const start = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Start")
		start?.click()
		flushSync()
		const [sent] = requests.filter((r) => r.key === "sessions:create").map((r) => r.params)
		expect(sent.starterKit).toEqual({ primerId: "drowned-coast" })
		expect(sent.session.lorebookId).toBeNull()
		expect(sent.session.primaryRuleset).toBeUndefined()
		// No SDK noun reaches the screen (§28).
		expect(host.textContent?.toLowerCase()).not.toMatch(/ruleset|primer|compendium|phantom/)
	})

	test("choosing a book after a kit drops the kit", async () => {
		await render(OFFER, [{ id: 7, name: "Drowned Coast", primaryRuleset: VIS }])
		feed("starterKits:list", { kits: KITS })
		await settle()
		host.querySelector<HTMLButtonElement>('[data-starter-kit="primer:drowned-coast"]')!.click()
		await settle()
		const book = [...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find(
			(b) => b.textContent?.trim() === "Drowned Coast"
		)!
		book.click()
		await settle()
		expect(host.querySelector("[data-start-kit-note]") === null).toBe(true)
		expect(host.querySelector("[data-rules-from-lorebook]")?.textContent?.trim()).toBe(
			"From the lorebook: Vis Itineris"
		)
	})

	test("no kits listed: the choice is not drawn", async () => {
		await render(OFFER, [{ id: 7, name: "Drowned Coast", primaryRuleset: VIS }])
		feed("starterKits:list", { kits: [] })
		await settle()
		expect(host.querySelector("[data-starter-kits]") === null).toBe(true)
	})
})

/**
 * fix7 (2026-10-23, owner: "In lair, I can't choose a ruleset"): a book on
 * Freeform — every book's default — brings no rules of its own, so the
 * Rules stay the person's to choose; and a preset's locked How strict, stored
 * as a setting decision, is read (it was never found as a bare string).
 */
describe("Start a session › a book on Freeform, and a preset's How strict (fix7)", () => {
	/** The Lair's offer: Freeform first and the default, playing Words only. */
	const LAIR_LIKE = {
		...OFFER,
		choices: [
			{ id: STORY, name: "Freeform", subtitle: "Words decide; no numbers.", recommended: true, rigours: ["prose"] },
			{ id: VIS, name: "Vis Itineris", subtitle: "Heroes whose deeds move the world.", recommended: true }
		],
		defaultId: STORY
	}
	const PLAIN_BOOK = { id: 7, name: "Plain Book", primaryRuleset: STORY }
	const adoptedLine = () => host.querySelector("[data-rules-from-lorebook]")?.textContent?.trim() ?? null

	async function pickBook(name: string) {
		const book = [...host.querySelectorAll<HTMLButtonElement>('button[role="radio"]')].find(
			(b) => b.textContent?.trim() === name
		)!
		book.click()
		await settle()
		expect(book.getAttribute("aria-checked")).toBe("true")
	}

	test("a book on Freeform brings no rules: the picker stays, How strict follows the pick, and both travel with the book", async () => {
		await render(LAIR_LIKE, [PLAIN_BOOK])
		await pickBook("Plain Book")
		expect(adoptedLine()).toBeNull()
		expect(choice(STORY)!.getAttribute("aria-checked")).toBe("true")
		// Freeform plays Words only: nothing to ask yet.
		expect(heading("How strict") === null).toBe(true)
		choice(VIS)!.click()
		await settle()
		expect(choice(VIS)!.getAttribute("aria-checked")).toBe("true")
		expect(strictness("mechanics")!.getAttribute("aria-checked")).toBe("true")
		const [first] = flowPayload()
		expect(first).toMatchObject({ lorebookId: 7, primaryRuleset: VIS, rigour: "mechanics" })
	})

	test("a book with rules of its own still gives them, beside a book on Freeform", async () => {
		await render(LAIR_LIKE, [PLAIN_BOOK, { id: 8, name: "Drowned Coast", primaryRuleset: VIS }])
		await pickBook("Drowned Coast")
		expect(adoptedLine()).toBe("From the lorebook: Vis Itineris")
		expect(host.querySelector("[data-rules-choice]") === null).toBe(true)
		await pickBook("Plain Book")
		expect(adoptedLine()).toBeNull()
		expect(host.querySelector("[data-rules-choice]") === null).toBe(false)
	})

	test("a starter lorebook on Freeform brings none either: the pick travels beside it", async () => {
		await render(LAIR_LIKE, [])
		feed("starterKits:list", {
			kits: [
				{
					id: "primer:quiet-vale",
					source: "core",
					name: "Quiet Vale",
					description: "A vale.",
					rulesId: STORY,
					rulesName: "Freeform",
					counts: { entries: 3, places: 1, cast: 1 }
				}
			]
		})
		await settle()
		host.querySelector<HTMLButtonElement>('[data-starter-kit="primer:quiet-vale"]')!.click()
		await settle()
		expect(adoptedLine()).toBeNull()
		choice(VIS)!.click()
		await settle()
		const start = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Start")
		start?.click()
		flushSync()
		const [sent] = requests.filter((r) => r.key === "sessions:create").map((r) => r.params)
		expect(sent.starterKit).toEqual({ primerId: "quiet-vale" })
		expect(sent.session.primaryRuleset).toBe(VIS)
	})

	test("a preset that locks How strict starts on the first rules that play it, and says so when picked rules can't", async () => {
		const RULES_ASK = {
			key: "ruleset",
			label: "Rules",
			control: "string",
			value: STORY,
			fixed: true,
			rules: true
		}
		await render(LAIR_LIKE, [PLAIN_BOOK], OPEN_SHAPE, CHARACTERS, [
			{
				id: 1,
				genreId: GENRE,
				name: "The rules decide",
				enabled: true,
				isDefault: true,
				// As a preset stores it: `setting('scripts', { lock: true })`.
				settings: { rigour: { value: "scripts", lock: true } },
				asks: [RULES_ASK]
			}
		])
		const hint = () => host.querySelector('[data-testid="start-rules-preset-hint"]')?.textContent?.replace(/\s+/g, " ").trim() ?? null
		// Freeform can't decide anything: the first recommended rules that can.
		expect(choice(VIS)!.getAttribute("aria-checked")).toBe("true")
		expect(hint()).toBeNull()
		// How strict is the preset's: not asked.
		expect(heading("How strict") === null).toBe(true)
		choice(STORY)!.click()
		await settle()
		expect(hint()).toBe(
			"Freeform keeps no numbers, so The rules decide runs in words here. Pick rules with numbers for them to decide."
		)
		// A book on Freeform changes none of it.
		await pickBook("Plain Book")
		choice(VIS)!.click()
		await settle()
		expect(hint()).toBeNull()
		const [first] = flowPayload()
		expect(first).toMatchObject({ lorebookId: 7, primaryRuleset: VIS, rigour: "scripts" })
	})
})

function flowPayload(): any[] {
	const start = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Start")
	start?.click()
	flushSync()
	return requests.filter((r) => r.key === "sessions:create").map((r) => r.params.session)
}
