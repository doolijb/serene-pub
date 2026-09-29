/**
 * R81 on the page: the server's `sessions:loreRanked` push for this session
 * reaches the page's widget fan-out as `lore:ranked`; another session's push
 * does not, and after the release nothing does. A mark the viewer sets
 * anywhere reaches it as `lore:marked` (the entry id only).
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({ getSocket: () => socket }))

import { _resetInterestForTests, setInterestUser } from "$lib/client/sockets/interest.svelte"
import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import { hearLoreRanked } from "./loreRanked"
import { hearLoreMarked } from "./loreMarked"

type Listener = (payload: unknown) => void
const listeners = new Map<string, Listener[]>()
const socket = {
	connected: true,
	on(event: string, fn: Listener) {
		listeners.set(event, [...(listeners.get(event) ?? []), fn])
	},
	off(event: string, fn: Listener) {
		listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== fn))
	},
	emit() {}
}
const push = (event: string, payload: unknown) => {
	for (const fn of [...(listeners.get(event) ?? [])]) fn(payload)
}

beforeEach(() => {
	listeners.clear()
	_resetInterestForTests()
	setInterestUser({ id: 1, isAdmin: false })
})

describe("hearLoreRanked", () => {
	test("this session's push reaches the widgets as lore:ranked; another session's does not", () => {
		const manager = new SurfaceManager()
		const heard: string[] = []
		manager.subscribe((e) => heard.push(e.kind))

		const release = hearLoreRanked(7, manager)
		push("sessions:loreRanked", { sessionId: 7 })
		push("sessions:loreRanked", { sessionId: 8 })
		expect(heard).toEqual(["lore:ranked"])

		release()
		push("sessions:loreRanked", { sessionId: 7 })
		expect(heard).toEqual(["lore:ranked"])
	})
})

describe("hearLoreMarked", () => {
	test("a mark the viewer sets in this session's book, from any tab, reaches the widgets as lore:marked; another book's, a refusal and the release do not", () => {
		const manager = new SurfaceManager()
		const heard: unknown[] = []
		manager.subscribe((e) => heard.push(e))

		let book: number | null = 7
		const release = hearLoreMarked(() => book, manager)
		push("entries:setMarks", { entryId: 4, lorebookId: 7, pinned: true })
		push("entries:setMarks", { entryId: 8, lorebookId: 9, pinned: true })
		push("entries:setMarks", { entryId: 5, error: "only the book's owner may mark its entries" })
		expect(heard).toEqual([{ kind: "lore:marked", entryId: 4 }])

		// A session that reads no book hears none.
		book = null
		push("entries:setMarks", { entryId: 4, lorebookId: 7, off: true })
		expect(heard).toHaveLength(1)

		book = 7
		release()
		push("entries:setMarks", { entryId: 4, lorebookId: 7, off: true })
		expect(heard).toHaveLength(1)
	})
})
