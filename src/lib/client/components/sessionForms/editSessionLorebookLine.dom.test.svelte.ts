/**
 * Edit Session › Lorebook: the book is fixed at start (owner 2026-11-08
 * B-5), so the form states it as one read-only line, never a picker. A
 * session with no lorebook id reads its own notes; one with an id reads
 * that book. A guest sees only the name.
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

import { BOOK_LOCK_LINES } from "$lib/shared/lorebooks/sessionNotes"

const GENRE = "test:genre/book@1"

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

async function openForm(opts: {
	lorebookId: number | null
	userId?: number
	lorebookName?: string
}) {
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
				shape: {
					characters: { min: 0 },
					personas: { min: 0 },
					lorebook: "optional",
					fields: {}
				}
			}
		]
	})
	deliver("lorebooks:list", {
		lorebookList: [
			// A shared book the picker's filters would drop: still named on the line.
			{ id: 12, name: "Shared Atlas", userId: 2, isSharedWithMe: true },
			{ id: 13, name: "Mine", userId: 1 }
		]
	})
	deliver("sessions:get#7", {
		session: {
			id: 7,
			userId: opts.userId ?? 1,
			name: "The lighthouse",
			scenario: "",
			genreId: GENRE,
			genreFields: {},
			lorebookId: opts.lorebookId,
			...(opts.lorebookName ? { lorebookName: opts.lorebookName } : {}),
			sessionCharacters: [{ character: { id: 3, name: "Wren" } }],
			sessionPersonas: [{ persona: { id: 4, name: "Me" } }],
			sessionGuests: [],
			tags: []
		}
	})
	await tick()
	flushSync()
}

const line = () => document.querySelector("[data-session-lorebook-line]")
const lineText = () => line()?.textContent?.replace(/\s+/g, " ").trim() ?? null
const lineKind = () =>
	line()?.getAttribute("data-session-lorebook-line") ?? null
const hasShare = () =>
	[...document.querySelectorAll("button")].some((b) =>
		b.textContent?.includes("Share as a lorebook")
	)

describe("Edit Session — the read-only Lorebook line", () => {
	test("an own-book session says so, offers Share, and has no picker", async () => {
		await openForm({ lorebookId: null })
		expect(lineKind()).toBe("own")
		expect(lineText()).toBe(BOOK_LOCK_LINES.ownBook)
		expect(hasShare()).toBe(true)
		expect(document.querySelectorAll('[role="combobox"]').length).toBe(0)
		expect(
			document.body.textContent?.includes("Save to choose the line")
		).toBe(false)
	})

	test("an overlay session names its book, even one the picker would not list", async () => {
		await openForm({ lorebookId: 12 })
		expect(lineKind()).toBe("overlay")
		expect(lineText()).toBe(BOOK_LOCK_LINES.overlay("Shared Atlas"))
		expect(hasShare()).toBe(false)
	})

	test("a guest sees only the name", async () => {
		await openForm({ lorebookId: 12, userId: 2 })
		expect(lineText()).toBe("Shared Atlas")
	})

	test("a guest of an own-book session sees Session notes, and no Share", async () => {
		await openForm({ lorebookId: null, userId: 2 })
		expect(lineText()).toBe("Session notes")
		expect(hasShare()).toBe(false)
	})

	test("a book the asker cannot list is named from the session's lorebookName", async () => {
		await openForm({ lorebookId: 99, lorebookName: "Hidden Tome" })
		expect(lineText()).toBe(BOOK_LOCK_LINES.overlay("Hidden Tome"))
	})
})
