/**
 * Owner note 32 (2026-10-02): "clicking a session in the sessions list shows
 * detail view with a hard to find edit button in the small sidebar view, in
 * focused, it goes straight to the edit mode."
 *
 * The ruling (lead's recommendation): a row opens the DETAIL at every width,
 * and the detail's header carries **Open session** as its primary and
 * **Edit** beside it — labelled buttons in the open, not a ⋯ away and not an
 * icon-only arrow.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))

const { listeners, socket } = vi.hoisted(() => {
	const listeners = new Map<string, (msg: any) => void>()
	return {
		listeners,
		socket: { emit: () => {}, on: () => {}, off: () => {} }
	}
})

vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => socket
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (msg: any) => void) => {
		listeners.set(key, handler)
		return () => listeners.delete(key)
	}
}))

import SessionViewPanel from "./SessionViewPanel.svelte"

const SESSION = {
	id: 12,
	name: "The lighthouse",
	sessionCharacters: [{ character: { id: 1, name: "Wren" } }],
	sessionPersonas: [],
	tags: []
}

let app: ReturnType<typeof mount> | null = null
afterEach(() => {
	if (app) unmount(app)
	app = null
	listeners.clear()
	document.body.innerHTML = ""
})

async function mountPanel(canEdit: boolean) {
	const onOpen = vi.fn()
	const onEdit = vi.fn()
	app = mount(SessionViewPanel, {
		target: document.body,
		props: { sessionId: SESSION.id, onOpen, onEdit, canEdit }
	})
	flushSync()
	await tick()
	for (const handler of listeners.values()) handler({ session: SESSION })
	flushSync()
	await tick()
	return { onOpen, onEdit }
}

function button(text: string) {
	return [...document.querySelectorAll("button")].find(
		(b) => b.textContent?.trim() === text
	)
}

describe("Session detail header (notes 32)", () => {
	test("Open session is a labelled primary; Edit sits beside it", async () => {
		const { onOpen, onEdit } = await mountPanel(true)
		const open = button("Open session")
		const edit = button("Edit")
		expect(open, "a labelled Open session button").toBeTruthy()
		expect(open!.className).toContain("preset-filled-primary-500")
		expect(edit, "Edit in the open, not in the ⋯").toBeTruthy()
		expect(edit!.className).not.toContain("preset-filled")
		open!.click()
		edit!.click()
		expect(onOpen).toHaveBeenCalledOnce()
		expect(onEdit).toHaveBeenCalledOnce()
	})

	test("a reader who cannot edit sees no Edit", async () => {
		await mountPanel(false)
		expect(button("Open session")).toBeTruthy()
		expect(button("Edit")).toBeUndefined()
	})
})
