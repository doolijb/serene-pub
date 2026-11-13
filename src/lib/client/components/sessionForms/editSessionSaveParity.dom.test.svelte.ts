/**
 * Edit Session › a card seat and a card-less seat save the same way
 * (2026-11-09): both ask before dropping an unsaved row, both benches wait for
 * Save, Save writes each (`characterId` for the card, `castMemberId` for the
 * card-less seat), and a fresh read of the session puts both back.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, emitted, socket } = vi.hoisted(() => {
	// Several components listen on one key (the pickers share `characters:list`).
	const listeners = new Map<string, Array<(msg: any) => void>>()
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
		listeners.set(key, [...(listeners.get(key) ?? []), handler])
		return () => {
			const rest = (listeners.get(key) ?? []).filter((h) => h !== handler)
			if (rest.length) listeners.set(key, rest)
			else listeners.delete(key)
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

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	emitted.length = 0
	document.body.innerHTML = ""
})

function deliver(key: string, msg: unknown) {
	const handlers = listeners.get(key)
	if (!handlers)
		throw new Error(
			`nothing listens on ${key}; have: ${[...listeners.keys()].join(", ")}`
		)
	for (const handler of handlers) handler(msg)
	flushSync()
}

const GENRE = "test:genre/crawl@1"
// Card 3 and member 3 share an id on purpose: the two ranges overlap.
const SEATS = [
	{
		id: 20,
		characterId: 3,
		character: { id: 3, name: "Wren" },
		castMemberId: null,
		isActive: true,
		removedAt: null
	},
	{
		id: 21,
		characterId: null,
		character: null,
		castMemberId: 3,
		isActive: true,
		removedAt: null
	}
]

const sessionMsg = () => ({
	session: {
		id: 7,
		userId: 1,
		name: "The crawl",
		scenario: "",
		genreId: GENRE,
		genreFields: {},
		lorebookId: 5,
		sessionCharacters: SEATS.map((s) => ({ ...s })),
		cardlessSeatShown: {
			3: { name: "Mira", nickname: null, faceMediaId: null }
		},
		sessionPersonas: [],
		sessionGuests: [],
		tags: []
	}
})

async function openForm() {
	app = mount(EditSessionForm, {
		target: document.body,
		props: { editSessionId: 7, showEditSessionForm: true },
		context: new Map([["userCtx", { user: { id: 1, isAdmin: false } }]])
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
	deliver("sessions:get#7", sessionMsg())
	await tick()
	flushSync()
}

const button = (label: string) =>
	[...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === label
	) as HTMLButtonElement
const removeBtn = (name: string) =>
	document.querySelector(
		`button[aria-label="Remove ${name} from the session"]`
	) as HTMLButtonElement
const benchBtn = (name: string) =>
	document.querySelector(
		`button[aria-label="Bench ${name}"]`
	) as HTMLButtonElement | null
const seatEnabled = () =>
	emitted.filter(([e]) => e === "sessions:setCastSeatEnabled")

async function addUnsavedRows() {
	deliver("characters:list", {
		characterList: [
			{ id: 3, name: "Wren" },
			{ id: 8, name: "Dov" }
		]
	})
	deliver("lorebooks:bindingList#5", {
		lorebookId: 5,
		lorebookBindingList: [
			{
				id: 3,
				kind: "member",
				characterId: null,
				overlayOf: null,
				name: "Mira",
				faceMediaId: null
			},
			{
				id: 44,
				kind: "member",
				characterId: null,
				overlayOf: null,
				name: "Tess",
				faceMediaId: null
			}
		]
	})
	button("Add a character").click()
	flushSync()
	await tick()
	const pick = (name: string) =>
		[...document.querySelectorAll("input[type=checkbox]")].find(
			(i) =>
				document
					.getElementById(i.getAttribute("aria-labelledby") ?? "")
					?.textContent?.trim() === name
		) as HTMLInputElement
	pick("Dov").click()
	pick("Tess").click()
	flushSync()
	button("Add 2 characters").click()
	flushSync()
	await tick()
}

describe("Edit Session — card and card-less seats save alike", () => {
	test("both benches are held until Save, then each is written by its own id", async () => {
		await openForm()
		benchBtn("Wren")!.click()
		benchBtn("Mira")!.click()
		flushSync()
		await tick()
		// Nothing written at once.
		expect(seatEnabled()).toEqual([])
		button("Save").click()
		flushSync()
		expect(seatEnabled()).toEqual([
			[
				"sessions:setCastSeatEnabled",
				{ sessionId: 7, characterId: 3, enabled: false }
			],
			[
				"sessions:setCastSeatEnabled",
				{ sessionId: 7, castMemberId: 3, enabled: false }
			]
		])
	})

	test("benching a member alone writes only the member, never a card", async () => {
		await openForm()
		benchBtn("Mira")!.click()
		flushSync()
		button("Save").click()
		flushSync()
		expect(seatEnabled()).toEqual([
			[
				"sessions:setCastSeatEnabled",
				{ sessionId: 7, castMemberId: 3, enabled: false }
			]
		])
	})

	test("a fresh read of the session puts both lists and both drafts back", async () => {
		await openForm()
		benchBtn("Wren")!.click()
		benchBtn("Mira")!.click()
		flushSync()
		await tick()
		expect(benchBtn("Wren") === null).toBe(true)
		expect(benchBtn("Mira") === null).toBe(true)
		deliver("sessions:get#7", sessionMsg())
		await tick()
		flushSync()
		expect(benchBtn("Wren") === null).toBe(false)
		expect(benchBtn("Mira") === null).toBe(false)
		button("Save").click()
		flushSync()
		expect(seatEnabled()).toEqual([])
	})

	test("an unsaved card row and an unsaved card-less row have no Bench, and both ask before they go", async () => {
		await openForm()
		await addUnsavedRows()
		for (const name of ["Dov", "Tess"]) {
			expect(benchBtn(name) === null).toBe(true)
			expect(removeBtn(name) === null).toBe(false)
			removeBtn(name).click()
			flushSync()
			await tick()
			expect(document.body.textContent).toContain("Remove character?")
			expect(document.body.textContent).toContain(`(${name})`)
			// Cancel: the row stays.
			button("Cancel").click()
			flushSync()
			await tick()
			expect(removeBtn(name) === null).toBe(false)
		}
		expect(document.body.textContent).toContain("Ready to add")
	})
})
