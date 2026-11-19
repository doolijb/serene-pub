/**
 * Start a session › a provided lorebook is never read: it is sent as a starter
 * lorebook (`starterKit`), the form says so with the starter lorebook's own line, and a
 * genre that seats from the lorebook's people says so in the confirm.
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
import { KIT_SESSION_NOTE } from "$lib/client/lorebooks/starterKitCards"

const GENRE = "test:genre/troupe@1"
const APPLET = "acme.cards:genre/solitaire"
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

async function render(
	rules: unknown,
	opts: { prefill?: any; shape?: Record<string, unknown> } = {}
) {
	host = document.createElement("div")
	document.body.append(host)
	app = mount(StartSessionForm, {
		target: host,
		context: new Map([["userSettingsCtx", { settings: { showAdvancedControls: true } }]]),
		props: { onCreated: () => {}, onCancel: () => {}, prefill: opts.prefill }
	})
	await settle()
	feed("sessions:genres", {
		genres: [
			{
				genreId: opts.prefill?.genreId ?? GENRE,
				name: "Troupe",
				description: "",
				...(rules ? { rules } : {}),
				shape: {
					...SHAPE,
					...(opts.prefill?.fromApplet
						? { applet: true, view: "acme.cards" }
						: {}),
					...opts.shape
				},
				...(opts.prefill?.fromApplet ? { appletCard: { title: "Card Table" } } : {})
			}
		]
	})
	feed("sessionPresets:list", {
		presets: [
			{
				id: 1,
				genreId: opts.prefill?.genreId ?? GENRE,
				name: "Plain",
				enabled: true,
				isDefault: true
			}
		]
	})
	feed("characters:list", {
		characterList: [{ id: 5, name: "You", isPersona: true, isDefaultPersona: true }]
	})
	feed("lorebooks:list", { lorebookList: BOOKS })
	await settle()
}

const click = async (id: number) => {
	host.querySelector<HTMLButtonElement>(`[data-book-row="${id}"]`)!.click()
	await settle()
}
const sentCreate = (label = "Start") => {
	const start = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
		(b) => b.textContent?.trim() === label || b.textContent?.includes(label)
	)
	start?.click()
	flushSync()
	return requests.filter((r) => r.key === "sessions:create").map((r) => r.params)
}
const notes = () => [...host.querySelectorAll("[data-start-kit-note]")]

describe.each([
	["the book pick (Lorebook and rules)", OFFER],
	["the plain Lorebook card", null]
] as const)("Start a session › a provided lorebook in %s", (_name, rules) => {
	test("picking it shows the starter lorebook's line under its group; an own book shows none", async () => {
		await render(rules)
		expect(notes()).toHaveLength(0)
		await click(2)
		const note = host.querySelector(
			'[data-book-group="plugin"] [data-start-kit-note]'
		)
		expect(note?.textContent?.trim()).toBe(KIT_SESSION_NOTE)
		await click(1)
		expect(notes()).toHaveLength(0)
	})

	test("Start sends it as starterKit, with no lorebookId", async () => {
		await render(rules)
		await click(2)
		const [sent] = sentCreate()
		expect(sent.starterKit).toEqual({ lorebookId: 2 })
		expect(sent.session.lorebookId).toBeNull()
	})

	test("an own book still travels as lorebookId", async () => {
		await render(rules)
		await click(1)
		const [sent] = sentCreate()
		expect(sent.starterKit).toBeUndefined()
		expect(sent.session.lorebookId).toBe(1)
	})
})

describe("Start a session › a provided lorebook and an applet", () => {
	const request = (over: Record<string, unknown> = {}) => ({
		genreId: APPLET,
		fromApplet: "acme.cards",
		...over
	})
	const confirmText = () =>
		host.querySelector("[data-applet-confirm]")!.textContent!.replace(/\s+/g, " ")
	const shape = { castFromLorebook: {} }

	test("the confirm says who is in it for a provided lorebook", async () => {
		await render(null, { prefill: request({ lorebookId: 2 }), shape })
		expect(confirmText()).toContain("Who is in it: the world's own people")
	})

	test("a prefill naming the provided lorebook sends it as starterKit", async () => {
		await render(null, { prefill: request({ lorebookId: 2 }), shape })
		const [sent] = sentCreate("Start Troupe")
		expect(sent.starterKit).toEqual({ lorebookId: 2 })
		expect(sent.session.lorebookId).toBeNull()
	})
})
