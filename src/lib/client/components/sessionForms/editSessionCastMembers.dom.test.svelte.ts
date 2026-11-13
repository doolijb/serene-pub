/**
 * 🚧 Edit Session and a card-less character seat (★s4-seat-1): the seat lists
 * as its cast member, and Save sends `castMemberIds` — the whole set — only
 * when the person changed it.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
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

async function openForm(over: Record<string, unknown> = {}) {
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
	deliver("sessions:get#7", {
		session: {
			id: 7,
			userId: 1,
			name: "The crawl",
			scenario: "",
			genreId: GENRE,
			genreFields: {},
			lorebookId: 5,
			sessionCharacters: [
				{
					id: 21,
					characterId: null,
					character: null,
					castMemberId: 31,
					removedAt: null
				}
			],
			cardlessSeatShown: {
				31: { name: "Mira", nickname: null, faceMediaId: null }
			},
			sessionPersonas: [],
			sessionGuests: [],
			tags: [],
			...over
		}
	})
	await tick()
	flushSync()
}

function save() {
	const button = [...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === "Save"
	) as HTMLButtonElement
	button.click()
	flushSync()
	return emitted.filter(([e]) => e === "sessions:update").at(-1)?.[1]
}

describe("Edit Session — card-less character seats", () => {
	test("the seat lists by its member's name and an untouched Save leaves castMemberIds out", async () => {
		await openForm()
		expect(document.body.textContent).toContain("Mira")
		// The session's book is read for its card-less members.
		expect(emitted).toContainEqual([
			"lorebooks:bindingList",
			{ lorebookId: 5 }
		])
		const name = document.querySelector(
			"input#session-name, input[name=name]"
		) as HTMLInputElement | null
		if (name) {
			name.value = "The crawl II"
			name.dispatchEvent(new Event("input", { bubbles: true }))
			flushSync()
		}
		const sent = save()
		expect(sent).toBeTruthy()
		expect(sent.castMemberIds).toBeUndefined()
		expect(sent.characterIds).toEqual([])
	})

	test("a saved seat in play has no Remove", async () => {
		await openForm()
		expect(
			document.querySelector(
				'button[aria-label="Remove Mira from the session"]'
			) === null
		).toBe(true)
	})

	test("a benched seat with no lines removes after asking, and the set goes empty", async () => {
		await openForm({
			sessionCharacters: [
				{
					id: 21,
					characterId: null,
					character: null,
					castMemberId: 31,
					isActive: false,
					hasLines: false,
					removedAt: null
				}
			]
		})
		;(
			document.querySelector(
				'button[aria-label="More actions for Mira"]'
			) as HTMLButtonElement
		).click()
		await tick()
		flushSync()
		const item = [...document.querySelectorAll("[role=menuitem]")].find(
			(el) => el.textContent?.trim() === "Remove"
		) as HTMLElement
		item.dispatchEvent(
			new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })
		)
		item.click()
		flushSync()
		// Asks first, like a card seat; nothing leaves until the person agrees.
		await tick()
		;(
			[...document.querySelectorAll("button")].find(
				(b) => b.textContent?.trim() === "Remove"
			) as HTMLButtonElement
		).click()
		flushSync()
		const sent = save()
		expect(sent.castMemberIds).toEqual([])
	})
})

describe("Edit Session — members of the session's lorebook", () => {
	const members = (lorebookId: number) => ({
		lorebookId,
		lorebookBindingList: [
			{
				id: 41,
				kind: "member",
				characterId: null,
				name: "Tess",
				nickname: null,
				faceMediaId: null
			}
		]
	})

	test("a session whose lorebook is its own notes reads those notes' members", async () => {
		await openForm({ lorebookId: null, ownBookId: 9 })
		expect(emitted).toContainEqual([
			"lorebooks:bindingList",
			{ lorebookId: 9 }
		])
		deliver("lorebooks:bindingList#9", members(9))
		const add = [...document.querySelectorAll("button")].find((b) =>
			b.textContent?.includes("Add a character")
		) as HTMLButtonElement
		add.click()
		await tick()
		flushSync()
		expect(document.body.textContent).toContain("Session notes")
		expect(document.body.textContent).toContain("Tess")
	})

	test("an attached lorebook is still the one asked", async () => {
		await openForm({ lorebookId: 5, ownBookId: 9 })
		expect(emitted).toContainEqual([
			"lorebooks:bindingList",
			{ lorebookId: 5 }
		])
		expect(emitted).not.toContainEqual([
			"lorebooks:bindingList",
			{ lorebookId: 9 }
		])
		deliver("lorebooks:bindingList#5", members(5))
	})

	test("removed rows (not in the cast) are shown nowhere, with no Reassign", async () => {
		await openForm({
			sessionCharacters: [
				{
					id: 21,
					characterId: null,
					character: null,
					castMemberId: 31,
					removedAt: null
				},
				{
					id: 22,
					characterId: null,
					character: null,
					castMemberId: 32,
					removedAt: "2026-01-01",
					removedName: "A"
				},
				{
					id: 23,
					characterId: null,
					character: null,
					castMemberId: 33,
					removedAt: "2026-01-01",
					removedName: "B"
				},
				{
					id: 24,
					characterId: 12,
					character: { id: 12, name: "Old" },
					castMemberId: null,
					removedAt: "2026-01-01",
					removedName: "Old"
				}
			]
		})
		const reassign = [...document.querySelectorAll("button")].filter((b) =>
			b.textContent?.includes("Reassign")
		)
		expect(reassign.length).toBe(0)
		const headings = [...document.querySelectorAll("h3")].map((h) =>
			h.textContent?.trim()
		)
		expect(headings.includes("Removed")).toBe(false)
		expect(headings.includes("Benched")).toBe(true)
	})
})
