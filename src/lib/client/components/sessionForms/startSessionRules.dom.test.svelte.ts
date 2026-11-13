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
/** The book pick's row for one of the person's lorebooks. */
const bookRow = (name: string) =>
	[...host.querySelectorAll<HTMLButtonElement>("[data-book-row]")].find(
		(b) => b.querySelector("[data-book-name]")?.textContent?.trim() === name
	)!
/** A rules row under a chosen book (or starter lorebook) on Freeform: "Play it with". */
const bookChoice = (id: string) => host.querySelector<HTMLButtonElement>(`[data-book-rules-choice="${id}"]`)
const words = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? null

describe("Start a session › Rules and How strict", () => {
	test("the genre's recommended rules come first and starred; How strict starts at the genre's default", async () => {
		await render(OFFER)
		expect(heading("Lorebook and rules")).not.toBeNull()
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
		bookRow("Drowned Coast").click()
		await settle()
		// The book's row says the rules it brings, and no choice opens under it.
		expect(words(bookRow("Drowned Coast").querySelector("[data-book-rules-line]"))).toBe("Rules: Vis Itineris")
		expect(host.querySelector("[data-book-rules-under]")).toBeNull()
		expect(host.querySelector('[data-rules-choice][aria-checked="true"]')).toBeNull()
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
		bookRow("Drowned Coast").click()
		await settle()
		expect(words(bookRow("Drowned Coast").querySelector("[data-book-rules-line]"))).toBe("Rules: Vis Itineris")
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
			.filter((t) => t === "Rules" || t === "How strict" || t?.startsWith("Lorebook"))

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
		expect(heading("Lorebook and rules")).toBeNull()
		expect(heading("Rules")).toBeNull()
	})

	test("Adventure with its cast answered: one Lorebook and rules card, then How strict", async () => {
		const adventure = {
			characters: { min: 0, max: 6 },
			personas: { min: 0, max: 1 },
			lorebook: "optional"
		}
		await render(OFFER, [{ id: 7, name: "Vis Itineris", primaryRuleset: VIS }], adventure)
		expect(cardOrder()).toEqual(["Lorebook and rules", "How strict"])
		const book = bookRow("Vis Itineris")
		// Never required (RF fix 2): a blank start stands until the person picks the book.
		expect(book.getAttribute("aria-checked")).toBe("false")
		book.click()
		await settle()
		expect(book.getAttribute("aria-checked")).toBe("true")
		expect(words(book.querySelector("[data-book-rules-line]"))).toBe("Rules: Vis Itineris")
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
		expect(cardOrder()).toEqual(["Rules", "How strict"])
		// No lorebook step: no book pick; Rules stays its own card, How strict inside it.
		expect(host.querySelector("[data-book-pick]")).toBeNull()
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
		// The row says the rules it brings; no choice opens under it.
		expect(kit!.textContent).toContain("Rules: Vis Itineris")
		expect(host.querySelector("[data-book-rules-under]")).toBeNull()
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
		const book = bookRow("Drowned Coast")
		book.click()
		await settle()
		expect(host.querySelector("[data-start-kit-note]") === null).toBe(true)
		expect(book.getAttribute("aria-checked")).toBe("true")
		expect(
			host.querySelector('[data-starter-kit="primer:drowned-coast"]')!.getAttribute("aria-checked")
		).toBe("false")
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
	/** Whether the chosen book (or starter lorebook) brings rules of its own: no "Play it with" choice is open under it. */
	const bringsRules = () => host.querySelector("[data-book-rules-under]") === null

	async function pickBook(name: string) {
		const book = bookRow(name)
		book.click()
		await settle()
		expect(book.getAttribute("aria-checked")).toBe("true")
	}

	test("a book on Freeform brings no rules: the picker stays, How strict follows the pick, and both travel with the book", async () => {
		await render(LAIR_LIKE, [PLAIN_BOOK])
		await pickBook("Plain Book")
		expect(bringsRules()).toBe(false)
		expect(bookChoice(STORY)!.getAttribute("aria-checked")).toBe("true")
		// Freeform plays Words only: nothing to ask yet.
		expect(heading("How strict") === null).toBe(true)
		bookChoice(VIS)!.click()
		await settle()
		expect(bookChoice(VIS)!.getAttribute("aria-checked")).toBe("true")
		expect(strictness("mechanics")!.getAttribute("aria-checked")).toBe("true")
		const [first] = flowPayload()
		expect(first).toMatchObject({ lorebookId: 7, primaryRuleset: VIS, rigour: "mechanics" })
	})

	test("a book with rules of its own still gives them, beside a book on Freeform", async () => {
		await render(LAIR_LIKE, [PLAIN_BOOK, { id: 8, name: "Drowned Coast", primaryRuleset: VIS }])
		await pickBook("Drowned Coast")
		expect(words(bookRow("Drowned Coast").querySelector("[data-book-rules-line]"))).toBe("Rules: Vis Itineris")
		expect(bringsRules()).toBe(true)
		await pickBook("Plain Book")
		expect(words(bookRow("Plain Book").querySelector("[data-book-rules-line]"))).toBe(
			"Freeform: brings no rules of its own"
		)
		expect(bringsRules()).toBe(false)
		expect(bookChoice(VIS) === null).toBe(false)
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
		expect(bringsRules()).toBe(false)
		bookChoice(VIS)!.click()
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
		bookChoice(VIS)!.click()
		await settle()
		expect(hint()).toBeNull()
		const [first] = flowPayload()
		expect(first).toMatchObject({ lorebookId: 7, primaryRuleset: VIS, rigour: "scripts" })
	})
})

/**
 * 🚧 The book pick (owner, 2026-11-05: one choice for the lorebook and the rules): the person's
 * lorebooks, a blank start on each rules choice, and the starter lorebooks, each row saying how
 * well its rules fit; How strict is its own card after it. Start still sends today's three shapes.
 */
describe("Start a session › the book pick", () => {
	const OTHER = "core:ruleset/other@1"
	const NOPE = "core:ruleset/nope@1"
	const fit = (rating: string, group: number, reason = "") => ({ rating, group, reason, rows: [], unused: [] })
	/** Vis Itineris fits well, Other less so (with its reason), Freeform is Words only. */
	const FIT_OFFER = {
		choices: [
			{ id: VIS, name: "Vis Itineris", subtitle: "Heroes.", recommended: true, fit: fit("great", 3) },
			{
				id: OTHER,
				name: "Other Rules",
				subtitle: "Another way.",
				recommended: false,
				fit: fit("ok", 2, "It lacks a health number.")
			},
			{ id: STORY, name: "Freeform", subtitle: "Words decide.", recommended: false, rigours: ["prose"], fit: fit("good", 2, "Words only.") }
		],
		only: false,
		defaultId: VIS,
		rigour: { options: ["prose", "mechanics", "scripts"], default: "mechanics" }
	}
	const BOOKS = [
		{ id: 7, name: "Drowned Coast", primaryRuleset: VIS },
		{ id: 8, name: "Quiet Vale", primaryRuleset: STORY },
		{ id: 9, name: "Side Road", primaryRuleset: OTHER }
	]
	const kit = (id: string, name: string, rulesId: string, rulesName: string) => ({
		id: `primer:${id}`,
		source: "core",
		name,
		description: "",
		rulesId,
		rulesName,
		counts: { entries: 3, places: 1, cast: 1 }
	})
	const sentCreate = () => requests.filter((r) => r.key === "sessions:create").map((r) => r.params)[0]
	const start = () => {
		;[...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Start")?.click()
		flushSync()
		return sentCreate()
	}
	const underText = () => words(host.querySelector("[data-book-rules-under]"))

	test("nothing touched: no lorebook, and the genre's default rules — today's payload", async () => {
		await render(FIT_OFFER, BOOKS)
		const sent = start()
		expect(sent.session.lorebookId ?? null).toBeNull()
		expect(sent.session.primaryRuleset).toBe(VIS)
		expect(sent.starterKit).toBeUndefined()
		// The blank row on the genre's default rules stands chosen.
		expect(choice(VIS)!.getAttribute("aria-checked")).toBe("true")
	})

	test("a book with rules of its own reads Rules: <name> · <Rating>; picked, it travels as lorebookId with no rules", async () => {
		await render(FIT_OFFER, BOOKS)
		const line = (name: string) => words(bookRow(name).querySelector("[data-book-rules-line]"))
		expect(line("Drowned Coast")).toBe("Rules: Vis Itineris · Great")
		expect(bookRow("Drowned Coast").querySelector('[aria-label="Recommended for this genre"]')).not.toBeNull()
		expect(line("Side Road")).toBe("Rules: Other Rules · Ok")
		// Below great, the reason is told under it.
		expect(words(bookRow("Side Road"))).toContain("It lacks a health number.")
		expect(words(bookRow("Drowned Coast"))).not.toContain("health number")
		bookRow("Side Road").click()
		await settle()
		expect(bookRow("Side Road").getAttribute("aria-checked")).toBe("true")
		const sent = start()
		expect(sent.session.lorebookId).toBe(9)
		expect(sent.session.primaryRuleset).toBeUndefined()
		expect(sent.starterKit).toBeUndefined()
	})

	test("a book whose rules the genre does not list says it has rules of its own", async () => {
		await render(FIT_OFFER, [{ id: 3, name: "Odd Book", primaryRuleset: NOPE }])
		expect(words(bookRow("Odd Book").querySelector("[data-book-rules-line]"))).toBe("Rules of its own")
		expect(bookRow("Odd Book").disabled).toBe(false)
	})

	test("a book on Freeform brings none: Play it with unfolds under it, and the pick travels beside the book", async () => {
		await render(FIT_OFFER, BOOKS)
		expect(words(bookRow("Quiet Vale").querySelector("[data-book-rules-line]"))).toBe(
			"Freeform: brings no rules of its own"
		)
		expect(host.querySelector("[data-book-rules-under]")).toBeNull()
		bookRow("Quiet Vale").click()
		await settle()
		const under = host.querySelector("[data-book-rules-under]")!
		expect(bookRow("Quiet Vale").closest("li")!.contains(under)).toBe(true)
		expect(underText()).toContain("Play it with")
		// The unfold's rows are told apart from the blank start's.
		expect(under.querySelector("[data-rules-choice]")).toBeNull()
		bookChoice(OTHER)!.click()
		await settle()
		expect(bookChoice(OTHER)!.getAttribute("aria-checked")).toBe("true")
		const sent = start()
		expect(sent.session.lorebookId).toBe(8)
		expect(sent.session.primaryRuleset).toBe(OTHER)
	})

	test("Start blank: no lorebook and the rules picked; a book then a blank row drops the book", async () => {
		await render(FIT_OFFER, BOOKS)
		expect(host.textContent).toContain("Start blank")
		bookRow("Drowned Coast").click()
		await settle()
		expect(choice(VIS)!.getAttribute("aria-checked")).toBe("false")
		choice(OTHER)!.click()
		await settle()
		expect(bookRow("Drowned Coast").getAttribute("aria-checked")).toBe("false")
		expect(choice(OTHER)!.getAttribute("aria-checked")).toBe("true")
		const sent = start()
		expect(sent.session.lorebookId ?? null).toBeNull()
		expect(sent.session.primaryRuleset).toBe(OTHER)
		expect(sent.starterKit).toBeUndefined()
	})

	test("a starter lorebook travels as starterKit, with its rules read against the genre", async () => {
		await render(FIT_OFFER, BOOKS)
		feed("starterKits:list", {
			kits: [kit("drowned-coast", "The Drowned Coast", VIS, "Vis Itineris"), kit("quiet-vale", "Quiet Vale", STORY, "Freeform")]
		})
		await settle()
		const row = (id: string) => host.querySelector<HTMLButtonElement>(`[data-starter-kit="primer:${id}"]`)!
		expect(words(row("drowned-coast"))).toContain("Rules: Vis Itineris · Great")
		expect(words(row("quiet-vale"))).toContain("Freeform: brings no rules of its own")
		row("drowned-coast").click()
		await settle()
		expect(host.querySelector("[data-book-rules-under]")).toBeNull()
		const sent = start()
		expect(sent.starterKit).toEqual({ primerId: "drowned-coast" })
		expect(sent.session.lorebookId ?? null).toBeNull()
		expect(sent.session.primaryRuleset).toBeUndefined()
	})

	test("a starter lorebook on Freeform brings none: Play it with opens under it, and the pick travels beside it", async () => {
		await render(FIT_OFFER, BOOKS)
		feed("starterKits:list", { kits: [kit("quiet-vale", "Quiet Vale", STORY, "Freeform")] })
		await settle()
		const row = host.querySelector<HTMLButtonElement>('[data-starter-kit="primer:quiet-vale"]')!
		row.click()
		await settle()
		expect(row.closest("li")!.contains(host.querySelector("[data-book-rules-under]"))).toBe(true)
		expect(underText()).toContain("Play it with")
		bookChoice(OTHER)!.click()
		await settle()
		const sent = start()
		expect(sent.starterKit).toEqual({ primerId: "quiet-vale" })
		expect(sent.session.primaryRuleset).toBe(OTHER)
	})

	test("Dungeon Crawler (no lorebook step) keeps today's Rules card, with no book pick", async () => {
		await render(FIT_OFFER, BOOKS, { characters: { min: 0, max: 0 }, personas: { min: 0, max: 1 } })
		expect(host.querySelector("[data-book-pick]")).toBeNull()
		expect(heading("Rules")).not.toBeNull()
		expect(heading("Lorebook and rules")).toBeNull()
		expect(host.textContent).not.toContain("Start blank")
		choice(OTHER)!.click()
		await settle()
		expect(start().session.primaryRuleset).toBe(OTHER)
	})

	test("a genre with a lorebook step and no rules offer (Chat) keeps today's Lorebook card with None", async () => {
		await render(null, BOOKS)
		expect(host.querySelector("[data-book-pick]")).toBeNull()
		expect(heading("Lorebook")).not.toBeNull()
		expect(
			[...host.querySelectorAll('button[role="radio"]')].some((b) => b.textContent?.trim() === "None")
		).toBe(true)
	})

	test("an `only` genre: Start blank lists only its rules, and a book on other rules is disabled with the reason", async () => {
		const only = { ...FIT_OFFER, choices: FIT_OFFER.choices.slice(0, 2), only: true }
		await render(only, [...BOOKS, { id: 3, name: "Odd Book", primaryRuleset: NOPE }])
		expect([...host.querySelectorAll("[data-rules-choice]")].map((b) => b.getAttribute("data-rules-choice"))).toEqual([
			VIS,
			OTHER
		])
		const odd = bookRow("Odd Book")
		expect(odd.disabled).toBe(true)
		expect(odd.getAttribute("aria-disabled")).toBe("true")
		expect(words(odd.querySelector("[data-book-rules-line]"))).toBe("Troupe plays only by Vis Itineris or Other Rules rules.")
		odd.click()
		await settle()
		expect(odd.getAttribute("aria-checked")).toBe("false")
		// A book on a rules choice it lists is fine.
		expect(bookRow("Drowned Coast").disabled).toBe(false)
	})

	test("an `only` genre refuses a starter lorebook on other rules the same way", async () => {
		const only = { ...FIT_OFFER, choices: FIT_OFFER.choices.slice(0, 2), only: true }
		await render(only, [])
		feed("starterKits:list", { kits: [kit("nope", "Nope Kit", NOPE, "Nope Rules")] })
		await settle()
		const row = host.querySelector<HTMLButtonElement>('[data-starter-kit="primer:nope"]')!
		expect(row.disabled).toBe(true)
		expect(words(row)).toContain("Troupe plays only by Vis Itineris or Other Rules rules.")
		row.click()
		await settle()
		expect(row.getAttribute("aria-checked")).toBe("false")
	})

	test("How strict is its own card after the pick, and follows the rules in force", async () => {
		await render(FIT_OFFER, BOOKS)
		const pick = host.querySelector("[data-book-pick]")!
		const next = pick.nextElementSibling!
		expect(next.getAttribute("aria-labelledby")).toBe("start-how-strict-heading")
		expect(pick.contains(heading("How strict"))).toBe(false)
		expect(strictness("mechanics")!.getAttribute("aria-checked")).toBe("true")
		// A blank start on Freeform plays Words only: nothing to ask.
		choice(STORY)!.click()
		await settle()
		expect(heading("How strict")).toBeNull()
		choice(VIS)!.click()
		await settle()
		strictness("scripts")!.click()
		await settle()
		expect(start().session).toMatchObject({ primaryRuleset: VIS, rigour: "scripts" })
	})

	test("How strict follows a book's own rules, and a book on Freeform with the rules picked under it", async () => {
		await render(FIT_OFFER, BOOKS)
		bookRow("Drowned Coast").click()
		await settle()
		expect([...host.querySelectorAll("[data-how-strict]")].map((b) => b.getAttribute("data-how-strict"))).toEqual([
			"prose",
			"mechanics",
			"scripts"
		])
		strictness("scripts")!.click()
		await settle()
		bookRow("Quiet Vale").click()
		await settle()
		bookChoice(STORY)!.click()
		await settle()
		expect(heading("How strict")).toBeNull()
		bookChoice(VIS)!.click()
		await settle()
		expect(strictness("scripts")!.getAttribute("aria-checked")).toBe("true")
		expect(start().session).toMatchObject({ lorebookId: 8, primaryRuleset: VIS, rigour: "scripts" })
	})

	test("no SDK noun reaches the card", async () => {
		await render(FIT_OFFER, BOOKS)
		feed("starterKits:list", { kits: [kit("quiet-vale", "Quiet Vale", STORY, "Freeform")] })
		await settle()
		bookRow("Quiet Vale").click()
		await settle()
		expect(host.querySelector("[data-book-pick]")!.textContent!.toLowerCase()).not.toMatch(
			/ruleset|rigour|primer|compendium|phantom|chat/
		)
	})
})

function flowPayload(): any[] {
	const start = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Start")
	start?.click()
	flushSync()
	return requests.filter((r) => r.key === "sessions:create").map((r) => r.params.session)
}

/**
 * s22-L (owner 2026-11-05): rules the genre rates Incompatible are always
 * refused — on a book row, a starter row and the blank row — and a preset's
 * ruleset is the pre-chosen default, never a lock.
 */
describe("Start a session › Incompatible rules, and the preset's ruleset (s22-L)", () => {
	const OTHER = "core:ruleset/other@1"
	const BAD = "core:ruleset/bad@1"
	const fit = (rating: string, group: number, reason = "") => ({ rating, group, reason, rows: [], unused: [] })
	const OFFER_WITH_BAD = {
		choices: [
			{ id: VIS, name: "Vis Itineris", subtitle: "Heroes.", recommended: true, fit: fit("great", 3) },
			{ id: OTHER, name: "Other Rules", subtitle: "Another way.", recommended: false, fit: fit("ok", 2, "It lacks a health number.") },
			{ id: BAD, name: "Dice Only", subtitle: "Only dice.", recommended: false, fit: fit("incompatible", 0, "it has no way to tell the story") }
		],
		only: false,
		defaultId: VIS,
		rigour: { options: ["prose", "mechanics", "scripts"], default: "mechanics" }
	}
	const SENTENCE = "Troupe can't play Dice Only: it has no way to tell the story."
	const kit = (id: string, name: string, rulesId: string, rulesName: string) => ({
		id: `primer:${id}`,
		source: "core",
		name,
		description: "",
		rulesId,
		rulesName,
		counts: { entries: 3, places: 1, cast: 1 }
	})

	test("a book on Incompatible rules is disabled, with the refusal in place of its rules line", async () => {
		await render(OFFER_WITH_BAD, [
			{ id: 7, name: "Drowned Coast", primaryRuleset: VIS },
			{ id: 3, name: "Dice Book", primaryRuleset: BAD }
		])
		const row = bookRow("Dice Book")
		expect(row.disabled).toBe(true)
		expect(row.getAttribute("aria-disabled")).toBe("true")
		expect(words(row.querySelector("[data-book-rules-line]"))).toBe(SENTENCE)
		row.click()
		await settle()
		expect(row.getAttribute("aria-checked")).toBe("false")
		expect(bookRow("Drowned Coast").disabled).toBe(false)
	})

	test("a starter row on Incompatible rules is disabled the same way", async () => {
		await render(OFFER_WITH_BAD, [])
		feed("starterKits:list", { kits: [kit("dice", "Dice Kit", BAD, "Dice Only")] })
		await settle()
		const row = host.querySelector<HTMLButtonElement>('[data-starter-kit="primer:dice"]')!
		expect(row.disabled).toBe(true)
		expect(words(row)).toContain(SENTENCE)
		row.click()
		await settle()
		expect(row.getAttribute("aria-checked")).toBe("false")
	})

	test("the blank Incompatible row stays disabled", async () => {
		await render(OFFER_WITH_BAD, [])
		expect(choice(BAD)!.disabled).toBe(true)
		expect(choice(OTHER)!.disabled).toBe(false)
	})

	test("a preset's ruleset: its Start blank row is the chosen one, and the person may pick another", async () => {
		await render(OFFER_WITH_BAD, [], OPEN_SHAPE, CHARACTERS, [
			{ id: 1, genreId: GENRE, name: "Plain", enabled: true, isDefault: true, settings: { ruleset: { value: OTHER, lock: true } } }
		])
		expect(choice(OTHER)!.getAttribute("aria-checked")).toBe("true")
		expect(choice(VIS)!.getAttribute("aria-checked")).toBe("false")
		choice(VIS)!.click()
		await settle()
		expect(choice(VIS)!.getAttribute("aria-checked")).toBe("true")
	})

	test("a preset whose ruleset the genre rates Incompatible starts on the genre's default", async () => {
		await render(OFFER_WITH_BAD, [], OPEN_SHAPE, CHARACTERS, [
			{ id: 1, genreId: GENRE, name: "Plain", enabled: true, isDefault: true, settings: { ruleset: BAD } }
		])
		expect(choice(VIS)!.getAttribute("aria-checked")).toBe("true")
		expect(choice(BAD)!.getAttribute("aria-checked")).toBe("false")
	})
})
