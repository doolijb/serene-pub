/**
 * Advanced controls (2026-11-10): the start form's rules controls are
 * hidden while the switch is off, one line says so, and the payload is the
 * same either way.
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
	{ id: 5, name: "You", isPersona: true, isDefaultPersona: true }
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
const fit = (rating: string, group: number) => ({
	rating,
	group,
	reason: "",
	rows: [],
	unused: [],
	inWords: [{ label: "dice", why: "the story has none" }]
})

const OFFER = {
	choices: [
		{
			id: VIS,
			name: "Vis Itineris",
			subtitle: "Heroes.",
			recommended: true,
			fit: fit("great", 3)
		},
		{
			id: STORY,
			name: "Story",
			subtitle: "Words decide.",
			recommended: false,
			fit: fit("ok", 2)
		}
	],
	only: false,
	defaultId: VIS,
	rigour: { options: ["prose", "mechanics", "scripts"], default: "mechanics" }
}
const BOOK_SHAPE = {
	characters: { min: 0, max: 3 },
	personas: { min: 0, max: 1 },
	lorebook: "optional"
}
const CARD_SHAPE = {
	characters: { min: 0, max: 0 },
	personas: { min: 0, max: 1 }
}
const PRESET = {
	id: 1,
	genreId: GENRE,
	name: "Plain",
	enabled: true,
	isDefault: true
}

async function render(
	opts: {
		rules?: unknown
		shape?: Record<string, unknown>
		advanced?: boolean
		admin?: boolean
		presets?: unknown[]
		books?: unknown[]
		sessions?: unknown[]
		kits?: unknown[]
		prefill?: Record<string, unknown>
	} = {}
) {
	const settings = $state({ showAdvancedControls: opts.advanced ?? false })
	host = document.createElement("div")
	document.body.append(host)
	app = mount(StartSessionForm, {
		target: host,
		props: {
			onCreated: () => {},
			onCancel: () => {},
			// Test rows carry only what the form reads.
			...(opts.sessions ? { sessions: opts.sessions as any } : {}),
			...(opts.prefill ? { prefill: opts.prefill } : {})
		},
		context: new Map<string, unknown>([
			["userSettingsCtx", { settings }],
			["userCtx", { user: { isAdmin: !!opts.admin } }]
		])
	})
	await settle()
	feed("sessions:genres", {
		genres: [
			{
				genreId: GENRE,
				name: "Troupe",
				description: "",
				...(("rules" in opts ? opts.rules : OFFER)
					? { rules: "rules" in opts ? opts.rules : OFFER }
					: {}),
				shape: opts.shape ?? BOOK_SHAPE
			}
		]
	})
	feed("sessionPresets:list", { presets: opts.presets ?? [PRESET] })
	feed("characters:list", { characterList: CHARACTERS })
	feed("lorebooks:list", {
		lorebookList: opts.books ?? [
			{ id: 7, name: "Drowned Coast", primaryRuleset: VIS }
		]
	})
	await settle()
	if (opts.kits) {
		feed("starterKits:list", { kits: opts.kits })
		await settle()
	}
	return settings
}

const q = <T extends Element = Element>(sel: string) =>
	host.querySelector<T>(sel)
const lines = () =>
	[...host.querySelectorAll("p")].filter((p) =>
		p.textContent?.includes("Some controls are hidden.")
	)
const heading = (id: string) => host.querySelector(`#${id}`)

function expectRulesControls(present: boolean) {
	for (const sel of [
		"[data-rules-choice]",
		"[data-how-strict]",
		"[data-rules-in-words]",
		"#start-book-blank-heading"
	])
		expect(q(sel) !== null, sel).toBe(present)
}

function createdSession(): any {
	const start = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent?.trim() === "Start"
	)
	start?.click()
	flushSync()
	return requests
		.filter((r) => r.key === "sessions:create")
		.map((r) => r.params.session)[0]
}

describe("Start a session > advanced controls", () => {
	test("book pick, off: rules controls hidden, books stay, one line", async () => {
		await render({ admin: true })
		expectRulesControls(false)
		expect(q("[data-book-rules-choice]")).toBeNull()
		expect(q("[data-rules-audit]")).toBeNull()
		expect(q("[data-book-row]")).not.toBeNull()
		expect(lines()).toHaveLength(1)
	})

	test("book pick, on: rules controls render, no line", async () => {
		await render({
			advanced: true,
			admin: true,
			books: [{ id: 7, name: "Free Book", primaryRuleset: null }]
		})
		q<HTMLButtonElement>("[data-book-row]")!.click()
		await settle()
		expectRulesControls(true)
		expect(q("[data-book-rules-choice]")).not.toBeNull()
		expect(q("[data-rules-audit]")).not.toBeNull()
		expect(lines()).toHaveLength(0)
	})

	test("rules card path: off hides the card with one line; on shows it", async () => {
		await render({ shape: CARD_SHAPE })
		expect(heading("start-rules-heading")).toBeNull()
		expect(lines()).toHaveLength(1)
		unmount(app!)
		app = null
		document.body.innerHTML = ""
		await render({ shape: CARD_SHAPE, advanced: true })
		expect(heading("start-rules-heading")).not.toBeNull()
		expect(lines()).toHaveLength(0)
	})

	test("a genre with no rules offer shows no line", async () => {
		await render({ rules: null, shape: BOOK_SHAPE })
		expect(lines()).toHaveLength(0)
		unmount(app!)
		app = null
		document.body.innerHTML = ""
		await render({ rules: null, shape: CARD_SHAPE })
		expect(lines()).toHaveLength(0)
	})

	test.each([
		[
			"a preset carrying ruleset and rigour",
			[{ ...PRESET, settings: { ruleset: STORY, rigour: "scripts" } }],
			STORY,
			"scripts"
		],
		["no preset settings (genre default)", [PRESET], VIS, "mechanics"]
	])(
		"payload with %s is the same off and on",
		async (_name, presets, ruleset, rigour) => {
			await render({ presets })
			const off = createdSession()
			expect(off).toMatchObject({ primaryRuleset: ruleset, rigour })
			unmount(app!)
			app = null
			requests.length = 0
			listeners.clear()
			document.body.innerHTML = ""
			await render({ presets, advanced: true })
			const on = createdSession()
			expect(on.primaryRuleset).toBe(off.primaryRuleset)
			expect(on.rigour).toBe(off.rigour)
		}
	)

	test("flipping the switch redraws in place", async () => {
		const settings = await render()
		expectRulesControls(false)
		expect(lines()).toHaveLength(1)
		settings.showAdvancedControls = true
		await settle()
		expectRulesControls(true)
		expect(lines()).toHaveLength(0)
	})
})

/** The Lair's offer: Freeform first and the default, playing Words only. */
const LAIR_LIKE = {
	...OFFER,
	choices: [
		{
			id: STORY,
			name: "Freeform",
			subtitle: "Words decide; no numbers.",
			recommended: true,
			rigours: ["prose"]
		},
		{ id: VIS, name: "Vis Itineris", subtitle: "Heroes.", recommended: true }
	],
	defaultId: STORY
}
const lockedTo = (rigour: string) => ({
	...PRESET,
	asks: [],
	settings: { rigour: { value: rigour, lock: true } }
})
const TONE_SHAPE = {
	...BOOK_SHAPE,
	fields: {
		tone: { type: "enum", of: ["grounded", "grim"], default: "grounded" }
	}
}
const TONE_ASK = {
	key: "tone",
	label: "Tone",
	control: "enum",
	members: [
		{ key: "grounded", label: "Grounded" },
		{ key: "grim", label: "Grim" }
	],
	value: "grounded"
}
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
const SESSIONS = [
	{
		id: 11,
		name: "Old Harbour",
		genreId: GENRE,
		isOwner: true,
		lorebookId: 4,
		messageCount: 12,
		updatedAt: "2026-10-01T10:00:00Z"
	}
]
/** The next chapter of a session on book 4: the rules card, with the book's rules adopted. */
const NEXT_CHAPTER = { genreId: GENRE, mode: "next-chapter", from: 11, lorebookId: 4 }
const CAPPED = "core:ruleset/capped@1"
const HIDDEN_PHRASE = "Some controls are hidden."
const hintText = () =>
	q('[data-testid="start-rules-preset-hint"]')?.textContent?.replace(
		/\s+/g,
		" "
	)
const UNPLAYED =
	"Freeform keeps no numbers, so Plain runs in words here."
const clickMode = async (m: string) => {
	q<HTMLButtonElement>(`[data-creation-mode="${m}"]`)!.click()
	await settle()
}

describe("Start a session > advanced controls: what stays", () => {
	test("off: the starter lorebooks, the creation modes and a start ask still render", async () => {
		await render({
			shape: TONE_SHAPE,
			kits: KITS,
			sessions: SESSIONS,
			presets: [{ ...PRESET, asks: [TONE_ASK] }]
		})
		expect(q("[data-starter-kits]") !== null).toBe(true)
		expect(q("[data-creation-mode]") !== null).toBe(true)
		expect(q('[data-start-ask="tone"]') !== null).toBe(true)
	})

	test("rules card path, off: the adopted-rules sentence stays; How strict still asked, so the line shows", async () => {
		await render({
			shape: BOOK_SHAPE,
			sessions: SESSIONS,
			prefill: NEXT_CHAPTER,
			books: [{ id: 4, name: "Drowned Coast", primaryRuleset: VIS }]
		})
		expect(q("[data-rules-from-lorebook]") !== null).toBe(true)
		expect(q("[data-rules-choice]") === null).toBe(true)
		expect(q("[data-how-strict]") === null).toBe(true)
		expect(lines()).toHaveLength(1)
	})

	test("rules card path, off: only text held (adopted rules, How strict locked), so no line", async () => {
		await render({
			shape: BOOK_SHAPE,
			sessions: SESSIONS,
			prefill: NEXT_CHAPTER,
			books: [{ id: 4, name: "Drowned Coast", primaryRuleset: VIS }],
			presets: [lockedTo("mechanics")]
		})
		expect(q("[data-rules-from-lorebook]") !== null).toBe(true)
		expect(host.textContent?.includes(HIDDEN_PHRASE)).toBe(false)
		expect(lines()).toHaveLength(0)
	})

	test("rules card path, off: the preset hint stays beside adopted rules, and no line", async () => {
		await render({
			rules: {
				...LAIR_LIKE,
				choices: [
					...LAIR_LIKE.choices,
					{ id: CAPPED, name: "Freeform", subtitle: "", recommended: false, rigours: ["prose"] }
				]
			},
			shape: BOOK_SHAPE,
			sessions: SESSIONS,
			prefill: NEXT_CHAPTER,
			books: [{ id: 4, name: "Capped Book", primaryRuleset: CAPPED }],
			presets: [lockedTo("scripts")]
		})
		expect(q("[data-rules-from-lorebook]") !== null).toBe(true)
		expect(hintText()?.startsWith(UNPLAYED)).toBe(true)
		expect(lines()).toHaveLength(0)
	})

	test("book pick, off: the preset hint stays as text, beside the line for the blank starts it hid", async () => {
		await render({
			rules: LAIR_LIKE,
			shape: BOOK_SHAPE,
			presets: [
				{
					...PRESET,
					asks: [],
					settings: {
						ruleset: STORY,
						rigour: { value: "scripts", lock: true }
					}
				}
			],
			books: [{ id: 7, name: "Plain Book", primaryRuleset: STORY }]
		})
		expect(hintText()?.startsWith(UNPLAYED)).toBe(true)
		expect(q("[data-how-strict]") === null).toBe(true)
		expect(q("[data-book-rules-choice]") === null).toBe(true)
		expect(lines()).toHaveLength(1)
	})
})
