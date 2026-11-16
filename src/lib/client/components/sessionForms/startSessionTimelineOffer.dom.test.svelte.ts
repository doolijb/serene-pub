/**
 * Start a session › the timeline offer under the chosen lorebook: shown when
 * the chosen preset expects a timeline and the lorebook keeps none; copy mode
 * and a lorebook that is not the person's own only say so; the New lorebook
 * dialog asks.
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
const BOOKS = [
	book(1),
	book(2, { timelineEnabled: true }),
	book(3, { provided: { disabled: false, pluginName: null } }),
	book(4, { readOnly: true }),
	book(6, {
		isSharedWithMe: true,
		bookAccess: "shared",
		surfacedFromSessionId: 21,
		ownerName: "Wren"
	})
]

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
const offer = () => host.querySelector("[data-timeline-offer]")
const offerKind = () => offer()?.getAttribute("data-timeline-offer") ?? null
const offerText = () => offer()?.textContent?.replace(/\s+/g, " ").trim() ?? ""
const switchButton = () =>
	host.querySelector<HTMLButtonElement>("[data-timeline-switch]")

describe.each([
	["the book pick (Lorebook and rules)", OFFER],
	["the plain Lorebook card", null]
] as const)("Start a session › timeline offer in %s", (_name, rules) => {
	test("an own lorebook attached directly: the sentence names the preset and the button switches it on", async () => {
		await render(rules, true)
		expect(offer() === null).toBe(true)
		await pick(1)
		expect(offerKind()).toBe("switch")
		expect(offerText()).toContain(
			"This lorebook keeps no timeline. Plain plays best with one."
		)
		expect(switchButton()?.textContent?.trim()).toBe(
			"Switch the timeline on"
		)
		switchButton()!.click()
		await settle()
		const updates = asks.filter((a) => a.event === "lorebooks:update")
		expect(updates).toHaveLength(1)
		expect(updates[0].params.lorebook.id).toBe(1)
		expect(updates[0].params.timelineEnabled).toBe(true)
		// The re-sent list says the row is on: the offer goes.
		feed("lorebooks:list", {
			lorebookList: BOOKS.map((b) =>
				b.id === 1 ? { ...b, timelineEnabled: true } : b
			)
		})
		await settle()
		expect(offer() === null).toBe(true)
	})

	test("a refusal shows in place", async () => {
		await render(rules, true)
		await pick(1)
		state.refuse = true
		switchButton()!.click()
		await settle()
		expect(offerText()).toContain("Only the owner can do that.")
		expect(offerKind()).toBe("switch")
	})

	test("a shared lorebook is started in copy mode: it says so, no button", async () => {
		await render(rules, true)
		await pick(6)
		expect(offerKind()).toBe("copy")
		expect(offerText()).toContain("Plain plays best with one.")
		expect(offerText()).toContain(
			"You can switch it on in the copy's Book settings."
		)
		expect(switchButton() === null).toBe(true)
	})

	test.each([
		[3, "a provided lorebook"],
		[4, "a read-only lorebook"]
	])("%i, %s: story time won't move, no button", async (id) => {
		await render(rules, true)
		await pick(id)
		expect(offerKind()).toBe("fixed")
		expect(offerText()).toContain("Story time won't move in this session.")
		expect(switchButton() === null).toBe(true)
	})

	test.each([
		["the preset's default is off", false, 1],
		["the preset carries no default", undefined, 1],
		["the lorebook keeps a timeline", true, 2]
	] as const)("no offer when %s", async (_why, def, id) => {
		await render(rules, def)
		await pick(id)
		expect(offer() === null).toBe(true)
	})
})

describe("Start a session › New lorebook asks for a timeline", () => {
	test("the Blank way draws Keep a timeline and lorebooks:create carries it as set", async () => {
		await render(OFFER, undefined, [])
		const open = [
			...host.querySelectorAll<HTMLButtonElement>("button")
		].find((b) => b.textContent?.includes("Create a lorebook"))!
		open.click()
		await settle()
		const q = (sel: string) => document.body.querySelector<HTMLElement>(sel)
		expect(q("[data-new-lorebook-timeline]")?.textContent).toContain(
			"Keep a timeline"
		)
		q('[data-field="new-lorebook-timeline"] input')!.click()
		await settle()
		const input = q("#new-lorebook-name") as HTMLInputElement
		input.value = "Harbour"
		input.dispatchEvent(new Event("input", { bubbles: true }))
		await settle()
		;[...document.body.querySelectorAll<HTMLButtonElement>("button")]
			.find((b) => b.textContent?.trim() === "Create")!
			.click()
		await settle()
		const made = requests.filter((r) => r.key === "lorebooks:create")
		expect(made).toHaveLength(1)
		expect(made[0].params.name).toBe("Harbour")
		expect(made[0].params.timelineEnabled).toBe(true)
	})
})
