/**
 * ★B-2 (2026-11-08): the session's ⋯ menu offers **Merge ‹book› into these notes** to the owner
 * of a session that reads an attached book; it asks the ruled sentence, and Confirm emits
 * `sessions:foldInParent`. No clone verb is offered beside it.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"
import { FOLD_CONFIRM, FOLD_LABEL } from "$lib/shared/lorebooks/sessionNotes"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, notesHandlers, socket } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	const notesHandlers: Array<(msg: any) => void> = []
	return {
		listeners,
		notesHandlers,
		socket: { emit: vi.fn(), on: () => {}, off: () => {} }
	}
})

vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (msg: any) => void) => {
		listeners.set(key, handler)
		return () => listeners.delete(key)
	},
	requestWithInterest: (
		_event: string,
		_params: unknown,
		handler: (msg: any) => void
	) => {
		notesHandlers.push(handler)
		return () => {}
	}
}))

import SessionViewPanel from "./SessionViewPanel.svelte"

const BOOK = "Brackenvale"
const session = (lorebookId: number | null) => ({
	id: 12,
	name: "The lighthouse",
	lorebookId,
	sessionCharacters: [{ character: { id: 1, name: "Wren" } }],
	sessionPersonas: [],
	tags: []
})

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	notesHandlers.length = 0
	socket.emit.mockClear()
	document.body.innerHTML = ""
})

async function menuLabels(opts: {
	isOwner: boolean
	lorebookId: number | null
}) {
	app = mount(SessionViewPanel, {
		target: document.body,
		props: {
			sessionId: 12,
			onOpen: () => {},
			onEdit: () => {},
			canEdit: true,
			isOwner: opts.isOwner
		}
	})
	flushSync()
	await tick()
	for (const handler of listeners.values())
		handler({ session: session(opts.lorebookId) })
	flushSync()
	await tick()
	for (const handler of notesHandlers)
		handler({ books: [{ sessionId: 12, attached: { id: 5, name: BOOK } }] })
	flushSync()
	await tick()
	const trigger = document.querySelector<HTMLButtonElement>(
		"button[aria-label='Session options']"
	)
	if (!trigger) return []
	trigger.click()
	await tick()
	flushSync()
	return [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
}

const labelsOf = (items: HTMLElement[]) =>
	items.map((el) => el.textContent?.trim())

describe("Merge ‹book› into these notes, in the session's ⋯ menu", () => {
	test("the owner of a session reading a book sees it, is asked, and confirming emits", async () => {
		const items = await menuLabels({ isOwner: true, lorebookId: 5 })
		expect(labelsOf(items)).toContain(FOLD_LABEL(BOOK))
		expect(labelsOf(items).some((l) => /clone/i.test(l ?? ""))).toBe(false)
		const item = items.find(
			(el) => el.textContent?.trim() === FOLD_LABEL(BOOK)
		)!
		item.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				pointerType: "mouse"
			})
		)
		item.click()
		await new Promise((r) => setTimeout(r, 50))
		flushSync()
		await tick()
		const dialog = document.querySelector("[data-action-confirm]")!
		expect(dialog.textContent).toContain(FOLD_CONFIRM(BOOK))
		const confirm = [...dialog.querySelectorAll("button")].find(
			(b) => b.textContent?.trim() === FOLD_LABEL(BOOK)
		)!
		expect(socket.emit).not.toHaveBeenCalledWith(
			"sessions:foldInParent",
			expect.anything()
		)
		confirm.click()
		expect(socket.emit).toHaveBeenCalledWith("sessions:foldInParent", {
			sessionId: 12
		})
	})

	test("a session with no attached book has no Merge", async () => {
		const items = await menuLabels({ isOwner: true, lorebookId: null })
		expect(labelsOf(items).some((l) => /^Merge /.test(l ?? ""))).toBe(false)
		expect(labelsOf(items).some((l) => /clone/i.test(l ?? ""))).toBe(false)
	})

	test("a non-owner has no Merge", async () => {
		const items = await menuLabels({ isOwner: false, lorebookId: 5 })
		expect(labelsOf(items).some((l) => /^Merge /.test(l ?? ""))).toBe(false)
	})
})
