/**
 * 🚧 Start a session › what the preset asks (R32, A10; lane 7): under the
 * chosen preset, the genre's settings it marks `askAtStart` and those fixed
 * at start — a fixed one saying it cannot change later — sent with Start;
 * the Rules card says the rules are fixed; a preset that locks How strict
 * asks nothing about it; preset cards print their derived calls per turn.
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
const OFFER = {
	choices: [{ id: VIS, name: "Vis Itineris", subtitle: "Heroes.", recommended: true }],
	only: false,
	defaultId: VIS,
	rigour: { options: ["prose", "mechanics", "scripts"], default: "mechanics" }
}
const SHAPE = {
	characters: { min: 0, max: 3 },
	personas: { min: 0, max: 1 },
	fields: {
		tone: { type: "enum", of: ["grounded", "grim"], default: "grounded" },
		hardcore: { type: "boolean", default: false }
	}
}

const RULES_ASKS = [
	{ key: "ruleset", label: "Rules", control: "string", value: VIS, fixed: true, rules: true },
	{
		key: "rigour",
		label: "How strict",
		control: "enum",
		members: [
			{ key: "prose", label: "Words only" },
			{ key: "mechanics", label: "Rules" },
			{ key: "scripts", label: "The rules decide" }
		],
		value: "mechanics",
		rules: true
	}
]
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
const HARDCORE_ASK = {
	key: "hardcore",
	label: "One life",
	description: "A fallen character stays fallen.",
	control: "boolean",
	value: false,
	fixed: true
}

const PRESETS = [
	{
		id: 1,
		genreId: GENRE,
		name: "Living",
		enabled: true,
		isDefault: true,
		callsPerTurn: 9,
		derived: { callsPerTurn: 2, replyCalls: 1, routineCalls: 1, perTurnRoutines: ["x"], writeTargets: [] },
		asks: [...RULES_ASKS, TONE_ASK, HARDCORE_ASK]
	},
	{
		id: 2,
		genreId: GENRE,
		name: "Rule Based",
		enabled: true,
		isDefault: false,
		derived: { callsPerTurn: 1, replyCalls: 1, routineCalls: 0, perTurnRoutines: [], writeTargets: [] },
		// How strict is locked by the preset: never asked.
		asks: [RULES_ASKS[0]]
	}
]

async function render(presets: unknown[] = PRESETS) {
	host = document.createElement("div")
	document.body.append(host)
	app = mount(StartSessionForm, {
		target: host,
		props: { onCreated: () => {}, onCancel: () => {} }
	})
	await settle()
	feed("sessions:genres", {
		genres: [{ genreId: GENRE, name: "Troupe", description: "", rules: OFFER, shape: SHAPE }]
	})
	feed("sessionPresets:list", { presets })
	feed("characters:list", { characterList: CHARACTERS })
	feed("lorebooks:list", { lorebookList: [] })
	await settle()
}

/** The preset is a row with Change (polish parity L11); Change opens its cards. */
async function openPresets() {
	host.querySelector<HTMLButtonElement>('button[aria-label="Change preset"]')!.click()
	await settle()
}

const heading = (text: string) =>
	[...host.querySelectorAll("h3")].find((h) => h.textContent?.trim() === text) ?? null
const asks = () => host.querySelector<HTMLElement>('[data-testid="start-asks"]')

function startPayload(): any {
	const start = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Start")
	start?.click()
	flushSync()
	return requests.filter((r) => r.key === "sessions:create").map((r) => r.params.session).at(-1)
}

describe("Start a session › what the preset asks", () => {
	test("preset cards print calls per turn derived from what each registers", async () => {
		await render()
		await openPresets()
		const living = host.querySelector<HTMLElement>('[data-preset-card="1"]')
		expect(living?.textContent).toContain("2 calls per turn")
		expect(living?.textContent).not.toContain("9 calls")
		expect(host.querySelector<HTMLElement>('[data-preset-card="2"]')?.textContent).toContain("1 call per turn")
	})

	test("the preset's asks sit under it; a fixed one says it cannot change later", async () => {
		await render()
		expect(asks() === null).toBe(false)
		expect(heading("Before you start") === null).toBe(false)
		expect(asks()!.querySelector('[data-start-ask="tone"]') === null).toBe(false)
		const hardcore = asks()!.querySelector<HTMLElement>('[data-start-ask="hardcore"]')!
		expect(hardcore.textContent).toContain("Can't be changed after the session starts.")
		expect(asks()!.querySelector<HTMLElement>('[data-start-ask="tone"]')!.textContent).not.toContain(
			"Can't be changed"
		)
		// The rules keep their own card, which says they are fixed.
		expect(asks()!.querySelector('[data-start-ask="ruleset"]') === null).toBe(true)
		expect(host.querySelector('[data-testid="start-rules-fixed"]')?.textContent).toContain(
			"Can't be changed after the session starts."
		)
	})

	test("an answer travels with Start; an untouched ask is left to the cascade", async () => {
		await render()
		const grim = [...asks()!.querySelectorAll<HTMLButtonElement>('[data-start-ask="tone"] [role="radio"]')].find(
			(b) => b.textContent?.trim() === "Grim"
		)!
		grim.click()
		await settle()
		expect(grim.getAttribute("aria-checked")).toBe("true")
		const sent = startPayload()
		expect(sent?.genreFields).toEqual({ tone: "grim" })
	})

	test("an ask left alone shows the preset's value, and an older pre-fill of it is not sent", async () => {
		await render([
			{
				...PRESETS[0],
				defaults: { genreFields: { tone: "pulpy", hardcore: true } },
				asks: [TONE_ASK, { ...TONE_ASK, key: "mood", label: "Mood" }]
			},
			PRESETS[1]
		])
		const grounded = [...asks()!.querySelectorAll<HTMLButtonElement>('[data-start-ask="tone"] [role="radio"]')].find(
			(b) => b.textContent?.trim() === "Grounded"
		)!
		// The ask's value is the cascade's (the preset's settings), not the pre-fill's Pulpy.
		expect(grounded.getAttribute("aria-checked")).toBe("true")
		const sent = startPayload()
		// Left alone: inherited through the cascade, never stored over it.
		expect(sent?.genreFields?.tone).toBeUndefined()
		expect(sent?.genreFields?.hardcore).toBe(true)
	})

	test("a preset that locks How strict asks nothing about it", async () => {
		await render()
		expect(host.querySelector('[data-how-strict="scripts"]') === null).toBe(false)
		await openPresets()
		const ruleBased = host.querySelector<HTMLButtonElement>('[data-preset-card="2"] [role="radio"]')!
		ruleBased.click()
		await settle()
		expect(host.querySelector('[data-how-strict="scripts"]') === null).toBe(true)
		expect(asks() === null).toBe(true)
	})
})

/**
 * Polish parity L11 (2026-10-24): Name first; the genre a radio list of one
 * row each, only the chosen row unfolding its meta line and More; the preset
 * a row with its value and Change.
 */
describe("Start a session › the genre list and the Preset row", () => {
	const OTHER = "test:genre/solo@1"

	async function renderTwo() {
		host = document.createElement("div")
		document.body.append(host)
		app = mount(StartSessionForm, {
			target: host,
			props: { onCreated: () => {}, onCancel: () => {} }
		})
		await settle()
		feed("sessions:genres", {
			genres: [
				{ genreId: GENRE, name: "Troupe", description: "A party of characters.", about: "Who is in the room.", rules: OFFER, shape: SHAPE },
				{ genreId: OTHER, name: "Solo", description: "Just the model.", shape: { characters: { min: 0, max: 0 }, personas: { min: 0, max: 0 } } }
			]
		})
		feed("sessionPresets:list", { presets: PRESETS })
		feed("characters:list", { characterList: CHARACTERS })
		feed("lorebooks:list", { lorebookList: [] })
		await settle()
	}

	test("Name comes before the genre, and every genre is a row", async () => {
		await renderTwo()
		const name = host.querySelector("#start-session-name")!
		const genre = host.querySelector("#start-genre-heading")!
		expect(name.compareDocumentPosition(genre) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
		const rows = [...host.querySelectorAll('[role="radiogroup"][aria-labelledby="start-genre-heading"] [data-genre-card]')]
		expect(rows.map((r) => r.getAttribute("data-genre-card"))).toEqual([GENRE, OTHER])
	})

	test("only the chosen row unfolds its meta line and More, which opens the rest in place", async () => {
		await renderTwo()
		expect(host.querySelector(`[data-genre-meta="${GENRE}"]`) === null).toBe(false)
		expect(host.querySelector(`[data-genre-meta="${OTHER}"]`) === null).toBe(true)
		const more = [...host.querySelectorAll<HTMLButtonElement>(`[data-genre-meta="${GENRE}"] button`)].find(
			(b) => b.textContent?.trim() === "More"
		)!
		more.click()
		await settle()
		expect(host.querySelector(`[data-genre-about="${GENRE}"]`)?.textContent).toContain("Who is in the room.")
		// Picking the other genre moves the unfolding with it; the list stays.
		host.querySelector<HTMLButtonElement>(`[data-genre-card="${OTHER}"] [role="radio"]`)!.click()
		await settle()
		expect(host.querySelector(`[data-genre-meta="${GENRE}"]`) === null).toBe(true)
		expect(host.querySelector(`[data-genre-card="${GENRE}"]`) === null).toBe(false)
	})

	test("the preset is a row with its value and Change", async () => {
		await renderTwo()
		expect(host.querySelector("[data-preset-chosen]")?.textContent?.trim()).toBe("Living")
		expect(host.querySelector("[data-preset-card]") === null).toBe(true)
		await openPresets()
		expect(host.querySelectorAll("[data-preset-card]").length).toBe(2)
	})
})
