/**
 * A guest's Edit session is the participants list and nothing else (owner
 * ruling G1, 2026-11-16): no tabs, no session fields, other people's seats
 * as words; the owner's form keeps every tab.
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, emitted, socket } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const emitted: Array<[string, any]> = []
	return {
		listeners,
		emitted,
		socket: {
			emit: (event: string, data: any) => {
				emitted.push([event, data])
			},
			on: () => {},
			off: () => {}
		}
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
		listeners.set(key, handler)
		return () => {
			if (listeners.get(key) === handler) listeners.delete(key)
		}
	}
	return {
		declareInterest,
		useInterest: (key: string, handler: (msg: any) => void) =>
			declareInterest(key, handler),
		requestWithInterest: (
			event: string,
			params: unknown,
			handler: (msg: any) => void
		) => {
			socket.emit(event, params)
			return declareInterest(event, handler)
		}
	}
})

import EditSessionForm from "./EditSessionForm.svelte"

beforeAll(async () => {
	await import("../modals/CharacterSelectList.svelte")
})

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	emitted.length = 0
	document.body.innerHTML = ""
})

function deliver(key: string, msg: unknown) {
	const handler = listeners.get(key)
	if (!handler)
		throw new Error(
			`nothing listens on ${key}; have: ${[...listeners.keys()].join(", ")}`
		)
	handler(msg)
	flushSync()
}

const GENRE = "test:genre/crawl@1"
const norm = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ")
const BODY = () => norm(document.body.textContent)

/** Session owned by user 1; viewer 2 is a guest. Kit is the guest's card, Orla is user 3's; Pip is user 3's persona; seat 13 (Cy) is the guest's, seat 12 (Bo) user 3's. */
async function openForm(viewerId: number, initialTab?: "settings") {
	app = mount(EditSessionForm, {
		target: document.body,
		props: { editSessionId: 7, showEditSessionForm: true, initialTab },
		context: new Map<string, unknown>([
			["userCtx", { user: { id: viewerId, isAdmin: false } }],
			["systemSettingsCtx", { settings: { isAccountsEnabled: true } }]
		])
	})
	flushSync()
	deliver("sessions:genres", {
		genres: [
			{
				genreId: GENRE,
				shape: { characters: { min: 0 }, personas: { min: 0 } }
			}
		]
	})
	deliver("sessions:get#7", {
		session: {
			id: 7,
			userId: 1,
			name: "The crawl",
			scenario: "A long stair",
			genreId: GENRE,
			genreFields: {},
			lorebookId: 5,
			metadata: {},
			sessionCharacters: [
				{
					id: 21,
					characterId: 51,
					character: { id: 51, name: "Orla", nickname: null, userId: 3, description: "Orla secret card text" },
					castMemberId: null,
					removedAt: null
				},
				{
					id: 23,
					characterId: 52,
					character: { id: 52, name: "Kit", nickname: null, userId: 2, description: "Kit own card text" },
					seatedByUserId: 2,
					castMemberId: null,
					removedAt: null
				}
			],
			sessionPersonas: [
				{
					id: 11,
					personaId: 61,
					persona: { id: 61, name: "Pip", description: "Tall", userId: 3 },
					userId: 3,
					removedAt: null
				},
				{
					id: 12,
					personaId: null,
					persona: null,
					userId: 3,
					seatName: "Bo",
					removedAt: null
				},
				{
					id: 13,
					personaId: null,
					persona: null,
					userId: 2,
					seatName: "Cy",
					removedAt: null
				}
			],
			sessionGuests: [
				{ userId: 2, user: { id: 2, username: "guesty" } },
				{ userId: 5, user: { id: 5, username: "dee" } }
			],
			tags: ["old"]
		}
	})
	deliver("sessions:view", {
		sessionId: 7,
		envoys: [
			{ slug: "narrator", name: "Narrator", origin: "genre", seated: true, speaks: "in-turn" },
			{ slug: "witness", name: "Witness", origin: "genre", seated: false, speaks: "action" }
		]
	})
	await tick()
	flushSync()
}

const bench = (who: string) =>
	document.querySelector(`button[aria-label="Bench ${who}"]`)
const byLabel = (re: RegExp) =>
	[...document.querySelectorAll("button")].filter((b) =>
		re.test(b.getAttribute("aria-label") ?? "")
	)
const buttonWith = (words: string) =>
	[...document.querySelectorAll("button")].find((b) =>
		b.textContent?.includes(words)
	)

function save() {
	const button = [...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === "Save"
	) as HTMLButtonElement
	button.click()
	flushSync()
	return emitted.filter(([e]) => e === "sessions:update").at(-1)?.[1]
}

describe("Edit Session — a guest has the participants view and nothing else", () => {
	test("no tabs, no session fields, no guest management", async () => {
		await openForm(2)
		expect(document.querySelector('[role="tablist"]')).toBeNull()
		expect(BODY()).not.toContain("Settings")
		expect(document.getElementById("session-panel-settings")).toBeNull()
		expect(document.getElementById("session-panel-visibility")).toBeNull()
		expect(document.getElementById("sessionName")).toBeNull()
		expect(document.getElementById("scenario")).toBeNull()
		expect(BODY()).not.toContain("Scenario")
		expect(BODY()).not.toContain("Tags")
		expect(buttonWith("Add guests")).toBeUndefined()
		expect(byLabel(/^Remove .* from the session$/)).toHaveLength(0)
		// The list of guests stays.
		expect(BODY()).toContain("dee")
		expect(BODY()).toContain(
			"You're a guest in this session. You can change your own seats here; everything else is the session owner's."
		)
	})

	test("shows the participants content, not as a tabpanel, with the guest's own privacy view", async () => {
		await openForm(2)
		const panel = document.getElementById("session-panel-participants")!
		expect(panel).not.toBeNull()
		expect(panel.getAttribute("role")).toBeNull()
		expect(panel.hasAttribute("hidden")).toBe(false)
		expect(panel.textContent).toContain("Orla")
		expect(BODY()).toContain("What this session sees of your data")
		expect(emitted).toContainEqual([
			"sessions:accountVisibility",
			{ sessionId: 7 }
		])
	})

	test("the participants region is labelled; Privacy is a headed card; the guest sentence is said once", async () => {
		await openForm(2)
		const panel = document.getElementById("session-panel-participants")!
		expect(panel.getAttribute("aria-label")).toBe("Participants")
		const privacy = [...panel.querySelectorAll("h3")].find(
			(h) => h.textContent?.trim() === "Privacy"
		)
		expect(privacy).toBeDefined()
		expect(BODY()).not.toContain("You are a guest in this session.")
		expect(BODY().split("guest in this session").length - 1).toBe(1)
	})

	test("no move controls for a guest, not even on their own seats", async () => {
		await openForm(2)
		expect(byLabel(/^Move .* (up|down)$/)).toHaveLength(0)
		expect(bench("Kit")).not.toBeNull()
	})

	test("a character seat shows who plays it, not its card (gs-3a2: the seater, so the guest's own card says Your character too)", async () => {
		await openForm(2)
		expect(BODY()).not.toContain("Orla secret card text")
		expect(BODY()).not.toContain("Kit own card text")
		expect(BODY()).toContain("Kit Your character")
	})

	test("a guest's form never asks users:list; the owner's does", async () => {
		await openForm(2)
		expect(emitted.filter(([e]) => e === "users:list")).toHaveLength(0)
		unmount(app!)
		app = null
		listeners.clear()
		emitted.length = 0
		document.body.innerHTML = ""
		await openForm(1)
		expect(emitted.filter(([e]) => e === "users:list").length).toBeGreaterThan(0)
	})

	test("an opener naming Settings still lands on the participants content", async () => {
		await openForm(2, "settings")
		const panel = document.getElementById("session-panel-participants")!
		expect(panel.hasAttribute("hidden")).toBe(false)
		expect(panel.textContent).toContain("Orla")
	})

	test("another person's seats are words; the guest's own keep their controls", async () => {
		await openForm(2)
		// Someone else's: Orla (card), Pip (persona), Bo (player seat).
		expect(bench("Orla")).toBeNull()
		expect(bench("Pip")).toBeNull()
		expect(bench("Bo")).toBeNull()
		expect(byLabel(/^(Move|Remove|More actions)/).filter((b) =>
			/Orla|Pip|Bo\b/.test(b.getAttribute("aria-label") ?? "")
		)).toHaveLength(0)
		expect(document.querySelector('[title="Drag to reorder"]')).toBeNull()
		const bo = document.getElementById("player-seat-12")!
		expect(bo.tagName).not.toBe("INPUT")
		expect(bo.textContent?.trim()).toBe("Bo")
		// Who plays a carded persona, in words.
		expect(BODY()).toContain("A player's character")
		// The guest's own.
		expect(bench("Kit")).not.toBeNull()
		expect(bench("Cy")).not.toBeNull()
		expect(document.getElementById("player-seat-13")?.tagName).toBe("INPUT")
	})

	test("envoys read in words", async () => {
		await openForm(2)
		expect(BODY()).toContain("In this session")
		expect(BODY()).toContain("Not in this session")
		expect(BODY()).not.toContain("Switch one on to include it.")
		expect(document.querySelector('input[name^="toggle-envoy-seat"]')).toBeNull()
	})

	test("Save sends the seats only: session is exactly { id }, no tags, no lorebooks:lines", async () => {
		await openForm(2)
		const sent = save()
		expect(sent).toBeTruthy()
		expect(sent.session).toEqual({ id: 7 })
		expect(sent).not.toHaveProperty("tags")
		expect(sent.characterIds).toEqual([51, 52])
		expect(sent).not.toHaveProperty("sceneSettings")
		expect(sent).not.toHaveProperty("playerLabel")
		expect(emitted.some(([e]) => e === "lorebooks:lines")).toBe(false)
	})
})

describe("Edit Session — the owner's form is unchanged", () => {
	test("the owner sees the card text and the move controls", async () => {
		await openForm(1)
		expect(BODY()).toContain("Orla secret card text")
		expect(byLabel(/^Move .* (up|down)$/).length).toBeGreaterThan(0)
	})

	test("every tab, the Name field and Add guests", async () => {
		await openForm(1)
		const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) =>
			norm(t.textContent).trim()
		)
		expect(tabs).toEqual(
			expect.arrayContaining(["Participants", "Settings", "Privacy"])
		)
		expect(document.getElementById("sessionName")).not.toBeNull()
		expect(document.getElementById("session-panel-settings")).not.toBeNull()
		expect(document.getElementById("session-panel-visibility")).not.toBeNull()
		expect(
			document
				.getElementById("session-panel-participants")
				?.getAttribute("role")
		).toBe("tabpanel")
		expect(buttonWith("Add guests")).toBeDefined()
		expect(bench("Orla")).not.toBeNull()
	})
})
