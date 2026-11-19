/**
 * A guest picks a card someone shared with them in Edit session (G3, Q3):
 * the picker's "Shared with you" group, the pending row, the save payload.
 */
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({
	dev: true,
	building: false,
	browser: true
}))

const { listeners, emitted, socket } = vi.hoisted(() => {
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
			listeners.set(
				key,
				(listeners.get(key) ?? []).filter((h) => h !== handler)
			)
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
	const handlers = listeners.get(key) ?? []
	if (!handlers.length) throw new Error(`nothing listens on ${key}`)
	for (const h of [...handlers]) h(msg)
	flushSync()
}

const GENRE = "test:genre/crawl@1"
const norm = (t: string | null | undefined) => (t ?? "").replace(/\s+/g, " ")
const BODY = () => norm(document.body.textContent)

const OWN = { id: 51, name: "Orla", description: "Mine", userId: 2 }
const SHARED = {
	id: 90,
	name: "Sable",
	description: "Not shown",
	userId: 3,
	isSharedWithMe: true,
	ownerName: "Ana"
}

/** A session owned by user 1; viewer 2 is a guest (or viewer 1, the owner). */
async function openForm(o: { viewerId?: number; metadata?: object } = {}) {
	app = mount(EditSessionForm, {
		target: document.body,
		props: { editSessionId: 7, showEditSessionForm: true },
		context: new Map<string, unknown>([
			["userCtx", { user: { id: o.viewerId ?? 2, isAdmin: false } }],
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
			scenario: "",
			genreId: GENRE,
			genreFields: {},
			lorebookId: 5,
			metadata: o.metadata ?? {},
			sessionCharacters: [],
			sessionPersonas: [],
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
	deliver("characters:list", { characterList: [OWN, SHARED] })
	await tick()
	flushSync()
}

const button = (words: string) =>
	[...document.querySelectorAll("button")].find((b) =>
		b.textContent?.includes(words)
	) as HTMLButtonElement | undefined

async function openPicker(add: "Add a persona" | "Add a character") {
	button(add)!.click()
	flushSync()
	await tick()
	await new Promise((r) => setTimeout(r, 0))
	flushSync()
}

function save() {
	const b = [...document.querySelectorAll("button")].find(
		(x) => x.textContent?.trim() === "Save"
	) as HTMLButtonElement
	b.click()
	flushSync()
	return emitted.filter(([e]) => e === "sessions:update").at(-1)?.[1]
}

describe("Edit Session — a guest picks a shared card", () => {
	test("the persona picker lists it under Shared with you, reading From Ana", async () => {
		await openForm()
		await openPicker("Add a persona")
		expect(BODY()).toContain("Shared with you")
		expect(BODY()).toContain("From Ana")
		expect(BODY()).toContain("Sable")
		expect(BODY()).not.toContain("Not shown")
		const own = document.querySelectorAll('ul[aria-label="Characters"] li')
		expect(own.length).toBe(0)
		const shared = document.querySelector(
			'ul[aria-label="Shared characters"]'
		)
		expect(shared?.textContent).toContain("Sable")
		for (const ul of document.querySelectorAll("ul"))
			if (ul !== shared) expect(ul.textContent).not.toContain("Sable")
	})

	test("picking it adds a pending row and saves as a player seat, in neither id list", async () => {
		await openForm()
		await openPicker("Add a persona")
		button("Sable")!.click()
		flushSync()
		const row = document.querySelector('[aria-label="Shared cards to add"]')
		expect(norm(row?.textContent)).toContain("Sable")
		expect(norm(row?.textContent)).toContain("From Ana")
		const sent = save()
		expect(sent.sharedCardSeats).toEqual([
			{ characterId: 90, kind: "player" }
		])
		expect(sent.personaIds).not.toContain(90)
		expect(sent.characterIds).not.toContain(90)
	})

	test("the Characters picker offers it and a pick saves as a character seat", async () => {
		await openForm()
		await openPicker("Add a character")
		expect(BODY()).toContain("Shared with you")
		expect(BODY()).toContain("From Ana")
		button("Sable")!.click()
		flushSync()
		const sent = save()
		expect(sent.sharedCardSeats).toEqual([
			{ characterId: 90, kind: "character" }
		])
		expect(sent.personaIds).not.toContain(90)
		expect(sent.characterIds).not.toContain(90)
	})

	test("Remove drops the pending pick; Save sends none", async () => {
		await openForm()
		await openPicker("Add a persona")
		button("Sable")!.click()
		flushSync()
		const remove = document.querySelector(
			'button[aria-label="Remove Sable"]'
		) as HTMLButtonElement
		remove.click()
		flushSync()
		expect(document.querySelector('button[aria-label="Remove Sable"]')).toBeNull()
		const sent = save()
		expect(sent?.sharedCardSeats).toBeUndefined()
	})

	test("bring own off: no shared group in either picker", async () => {
		await openForm({ metadata: { guestsBringOwn: false } })
		expect(button("Add a persona") === undefined).toBe(true)
		await openPicker("Add a character")
		expect(BODY()).not.toContain("Shared with you")
		expect(BODY()).not.toContain("Sable")
	})

	test("the owner sees no shared group in either picker", async () => {
		await openForm({ viewerId: 1 })
		await openPicker("Add a persona")
		expect(BODY()).not.toContain("Shared with you")
		expect(BODY()).not.toContain("Sable")
		document.body.innerHTML = ""
		unmount(app!)
		app = null
		listeners.clear()
		await openForm({ viewerId: 1 })
		await openPicker("Add a character")
		expect(BODY()).not.toContain("Shared with you")
		expect(BODY()).not.toContain("Sable")
	})
})
