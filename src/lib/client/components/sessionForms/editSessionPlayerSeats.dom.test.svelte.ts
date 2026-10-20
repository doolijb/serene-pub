/**
 * 🚧 Edit Session and a card-less player seat: a seat with no card
 * (`persona_id` null, a seat name) must open the form (a null `persona` is
 * not a persona), list by its seat name, rename and remove through Save
 * (`playerSeatChanges`), and count toward the genre's persona floor.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false, browser: true }))

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

vi.mock("$lib/client/sockets/loadSockets.client", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/typedSocket", () => ({ useTypedSocket: () => socket }))
vi.mock("$lib/client/sockets/interest.svelte", () => {
	const declareInterest = (key: string, handler: (msg: any) => void) => {
		listeners.set(key, handler)
		return () => {
			if (listeners.get(key) === handler) listeners.delete(key)
		}
	}
	return {
		declareInterest,
		useInterest: (key: string, handler: (msg: any) => void) => declareInterest(key, handler),
		requestWithInterest: (event: string, params: unknown, handler: (msg: any) => void) => {
			socket.emit(event, params)
			return declareInterest(event, handler)
		}
	}
})

import EditSessionForm from "./EditSessionForm.svelte"

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
	if (!handler) throw new Error(`nothing listens on ${key}; have: ${[...listeners.keys()].join(", ")}`)
	handler(msg)
	flushSync()
}

const GENRE = "test:genre/crawl@1"

async function openForm(viewerId = 1) {
	app = mount(EditSessionForm, {
		target: document.body,
		props: { editSessionId: 7, showEditSessionForm: true },
		context: new Map([["userCtx", { user: { id: viewerId, isAdmin: false } }]])
	})
	flushSync()
	deliver("sessions:genres", {
		genres: [{ genreId: GENRE, shape: { characters: { min: 0 }, personas: { min: 1 } } }]
	})
	deliver("sessions:get#7", {
		session: {
			id: 7,
			userId: 1,
			name: "The crawl",
			scenario: "",
			genreId: GENRE,
			genreFields: {},
			sessionCharacters: [],
			sessionPersonas: [
				{ id: 11, personaId: null, persona: null, userId: 1, seatName: "Ann", removedAt: null },
				{ id: 12, personaId: null, persona: null, userId: 2, seatName: "Bo", removedAt: null }
			],
			sessionGuests: [],
			tags: []
		}
	})
	await tick()
	flushSync()
}

const seatInput = (id: number) => document.getElementById(`player-seat-${id}`) as HTMLInputElement | null

function save() {
	const button = [...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === "Save"
	) as HTMLButtonElement
	button.click()
	flushSync()
	return emitted.filter(([e]) => e === "sessions:update").at(-1)?.[1]
}

describe("Edit Session — card-less player seats", () => {
	test("the form loads, listing each seat by its seat name", async () => {
		await openForm()
		expect(document.body.textContent).not.toContain("Loading session")
		expect(seatInput(11)?.value).toBe("Ann")
		expect(seatInput(12)?.value).toBe("Bo")
	})

	test("a rename and a removal go with Save; the seats meet the persona floor", async () => {
		await openForm()
		const ann = seatInput(11)!
		ann.value = "Ann the Bold"
		ann.dispatchEvent(new Event("input", { bubbles: true }))
		flushSync()
		;(document.querySelector('button[aria-label="Remove Bo from the session"]') as HTMLButtonElement).click()
		flushSync()
		expect(seatInput(12)).toBeNull()
		const sent = save()
		expect(sent).toBeTruthy()
		expect(sent.personaIds).toEqual([])
		expect(sent.playerSeats).toBeUndefined()
		expect(sent.playerSeatChanges).toEqual([
			{ playerSeatId: 11, seatName: "Ann the Bold" },
			{ playerSeatId: 12, remove: true }
		])
	})

	test("a guest edits only their own seat", async () => {
		await openForm(2)
		expect(seatInput(11)?.disabled).toBe(true)
		expect(seatInput(12)?.disabled).toBe(false)
		expect(document.querySelector('button[aria-label="Remove Ann from the session"]')).toBeNull()
	})
})
