/**
 * 🚧 The owner's two guest seat switches (G3, G4) on Edit Session: the
 * owner's switches and what a frozen guest sees.
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

import { GUEST_SEAT_SENTENCES } from "$lib/shared/sessions/guestSeats"
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

interface Opts {
	viewerId?: number
	metadata?: Record<string, unknown>
	accounts?: boolean
	shape?: Record<string, unknown>
	members?: "solo"
	/** The genre's player label: a genre of player seats (the Lair) has one. */
	playerLabel?: string
}

/** A session owned by user 1 (guest 2 owns the Orla card and Mira's seat): a card seat, a persona, Ann's card-less seat, a card-less cast member. */
async function openForm(o: Opts = {}) {
	app = mount(EditSessionForm, {
		target: document.body,
		props: { editSessionId: 7, showEditSessionForm: true },
		context: new Map<string, unknown>([
			["userCtx", { user: { id: o.viewerId ?? 1, isAdmin: false } }],
			[
				"systemSettingsCtx",
				{ settings: { isAccountsEnabled: o.accounts ?? true } }
			]
		])
	})
	flushSync()
	deliver("sessions:genres", {
		genres: [
			{
				genreId: GENRE,
				members: o.members,
				...(o.playerLabel ? { playerLabel: o.playerLabel } : {}),
				shape: o.shape ?? {
					characters: { min: 0 },
					personas: { min: 0 }
				}
			}
		]
	})
	deliver("sessions:get#7", {
		session: {
			id: 7,
			userId: 1,
			name: "The crawl",
			scenario: "",
			genreId: GENRE,
			genreFields: {},
			lorebookId: 5,
			metadata: o.metadata ?? {},
			sessionCharacters: [
				{
					id: 21,
					characterId: 51,
					character: { id: 51, name: "Orla", nickname: null, userId: 2 },
					castMemberId: null,
					removedAt: null
				},
				{
					id: 22,
					characterId: null,
					character: null,
					castMemberId: 31,
					seatedByUserId: 2,
					removedAt: null
				}
			],
			cardlessSeatShown: {
				31: { name: "Mira", nickname: null, faceMediaId: null }
			},
			sessionPersonas: [
				{
					id: 11,
					personaId: 61,
					persona: { id: 61, name: "Pip", description: "", userId: 2 },
					userId: 2,
					removedAt: null
				},
				{
					id: 12,
					personaId: null,
					persona: null,
					userId: 2,
					seatName: "Bo",
					removedAt: null
				}
			],
			// The switches show only once the session has a guest (gs-3a2 S4).
			sessionGuests: [
				{
					sessionId: 7,
					userId: 2,
					isPlayer: true,
					user: { id: 2, username: "ann", displayName: null }
				}
			],
			tags: []
		}
	})
	await tick()
	flushSync()
}

const seatInput = (id: number) =>
	document.getElementById(`player-seat-${id}`) as HTMLInputElement | null
const bench = (who: string) =>
	document.querySelector(`button[aria-label="Bench ${who}"]`)
const addButton = (words: string) =>
	[...document.querySelectorAll("button")].find((b) =>
		b.textContent?.includes(words)
	)
const switchInput = (name: string) =>
	document.querySelector(`input[name="${name}"]`) as HTMLInputElement | null

function save() {
	const button = [...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === "Save"
	) as HTMLButtonElement
	button.click()
	flushSync()
	return emitted.filter(([e]) => e === "sessions:update").at(-1)?.[1]
}

const BRING = GUEST_SEAT_SENTENCES.bringOwnOff
const TAKE = GUEST_SEAT_SENTENCES.takeCastOff
const BRING_LABEL = "Guests can bring their own characters"
const TAKE_LABEL = "Guests can take cast members"

describe("Edit Session — the owner's guest seat switches", () => {
	test("both show with their sentences in a group genre with accounts on", async () => {
		await openForm({ playerLabel: "Adventurer" })
		expect(BODY()).toContain(BRING_LABEL)
		expect(BODY()).toContain(TAKE_LABEL)
		expect(BODY()).toContain(
			"Guests add, remove and bench characters and personas they own, and can name a seat. Off keeps their seats as they are."
		)
		expect(BODY()).toContain(
			"Guests take or leave the seat of a cast member without a card whom nobody plays. Off keeps their seats as they are."
		)
		expect(
			document
				.getElementById("guests-bring-own-help")
				?.textContent?.includes("Off keeps")
		).toBe(true)
		expect(BODY()).not.toContain(BRING)
		expect(BODY()).not.toContain(TAKE)
	})

	test("the naming clause shows only where the genre offers take-seat (a genre with a player label)", async () => {
		await openForm()
		expect(BODY()).toContain(
			"Guests add, remove and bench characters and personas they own. Off keeps their seats as they are."
		)
		expect(BODY()).not.toContain("can name a seat")
	})

	test("absent with accounts off and in a solo genre", async () => {
		await openForm({ accounts: false })
		expect(BODY()).not.toContain(BRING_LABEL)
		expect(BODY()).not.toContain(TAKE_LABEL)
		unmount(app!)
		app = null
		listeners.clear()
		document.body.innerHTML = ""
		await openForm({ members: "solo" })
		expect(BODY()).not.toContain(BRING_LABEL)
		expect(BODY()).not.toContain(TAKE_LABEL)
	})

	test("a shape with personas and no characters shows only bring own", async () => {
		await openForm({ shape: { personas: { min: 0 } } })
		expect(BODY()).toContain(BRING_LABEL)
		expect(BODY()).not.toContain(TAKE_LABEL)
	})

	test("toggling one and saving sends that one only; an untouched Save sends neither", async () => {
		await openForm()
		const untouched = save()
		expect(untouched.guestsBringOwn).toBeUndefined()
		expect(untouched.guestsTakeCast).toBeUndefined()
		emitted.length = 0
		switchInput("guests-take-cast")!.click()
		flushSync()
		const sent = save()
		expect(sent.guestsTakeCast).toBe(false)
		expect(sent.guestsBringOwn).toBeUndefined()
	})

	test("the saved switches load into the owner's form", async () => {
		await openForm({ metadata: { guestsBringOwn: false } })
		expect(switchInput("guests-bring-own")!.checked).toBe(false)
		expect(switchInput("guests-take-cast")!.checked).toBe(true)
		// The owner is never frozen.
		expect(BODY()).not.toContain(BRING)
		expect(bench("Orla")).not.toBeNull()
	})
})

describe("Edit Session — a guest with a switch off", () => {
	test("bring own off: the line shows, the carded and player-seat controls are gone, the rename box stays", async () => {
		await openForm({ viewerId: 2, metadata: { guestsBringOwn: false } })
		expect(BODY()).toContain(BRING)
		expect(BODY()).not.toContain(TAKE)
		expect(addButton("Add a persona")).toBeUndefined()
		expect(bench("Pip")).toBeNull()
		expect(bench("Bo")).toBeNull()
		expect(bench("Orla")).toBeNull()
		expect(seatInput(12)).not.toBeNull()
		expect(seatInput(12)!.disabled).toBe(false)
		// A card-less cast seat is still theirs to change (take cast is on).
		expect(bench("Mira")).not.toBeNull()
		expect(addButton("Add a character")).toBeDefined()
	})

	test("take cast off: the line shows, the cast seat is frozen and the picker offers no members", async () => {
		await openForm({ viewerId: 2, metadata: { guestsTakeCast: false } })
		expect(BODY()).toContain(TAKE)
		expect(BODY()).not.toContain(BRING)
		expect(BODY()).toContain("Mira")
		expect(bench("Mira")).toBeNull()
		// Their own seats stay as today.
		expect(bench("Pip")).not.toBeNull()
		expect(bench("Orla")).not.toBeNull()
		deliver("sessions:castToTake#7", {
			sessionId: 7,
			members: [{ castMemberId: 41, name: "Tess", faceMediaId: null }]
		})
		addButton("Add a character")!.click()
		await tick()
		flushSync()
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		expect(BODY()).not.toContain("Tess")
	})

	test("both off: no Add a character", async () => {
		await openForm({
			viewerId: 2,
			metadata: { guestsBringOwn: false, guestsTakeCast: false }
		})
		expect(BODY()).toContain(BRING)
		expect(BODY()).toContain(TAKE)
		expect(addButton("Add a character")).toBeUndefined()
	})

	test("both on: the controls as today and no line", async () => {
		await openForm({ viewerId: 2 })
		expect(BODY()).not.toContain(BRING)
		expect(BODY()).not.toContain(TAKE)
		expect(bench("Pip")).not.toBeNull()
		expect(bench("Bo")).not.toBeNull()
		expect(bench("Orla")).not.toBeNull()
		expect(bench("Mira")).not.toBeNull()
		expect(addButton("Add a persona")).toBeDefined()
		expect(addButton("Add a character")).toBeDefined()
		// A guest never sees the owner's switches.
		expect(switchInput("guests-bring-own")).toBeNull()
		expect(switchInput("guests-take-cast")).toBeNull()
	})
})

describe("Edit Session — a guest's cast to take", () => {
	test("a guest asks sessions:castToTake and offers what it lists", async () => {
		await openForm({ viewerId: 2 })
		expect(emitted).toContainEqual(["sessions:castToTake", { sessionId: 7 }])
		expect(emitted.some(([e]) => e === "lorebooks:bindingList")).toBe(false)
		deliver("sessions:castToTake#7", {
			sessionId: 7,
			members: [{ castMemberId: 41, name: "Tess", faceMediaId: null }]
		})
		addButton("Add a character")!.click()
		await tick()
		flushSync()
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		expect(BODY()).toContain("Tess")
	})

	test("a guest's picker shows one plain group, never a lorebook name", async () => {
		await openForm({ viewerId: 2 })
		deliver("sessions:castToTake#7", {
			sessionId: 7,
			members: [
				{ castMemberId: 41, name: "Tess", faceMediaId: null },
				{ castMemberId: 42, name: "Una", faceMediaId: null }
			]
		})
		addButton("Add a character")!.click()
		await tick()
		flushSync()
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		expect(BODY()).toContain("Tess")
		expect(BODY()).toContain("Una")
		expect(BODY()).toContain("Cast members")
		expect(BODY()).not.toContain("Untitled lorebook")
	})

	test("the owner still asks lorebooks:bindingList", async () => {
		await openForm()
		expect(emitted).toContainEqual([
			"lorebooks:bindingList",
			{ lorebookId: 5 }
		])
		expect(emitted.some(([e]) => e === "sessions:castToTake")).toBe(false)
	})
})
