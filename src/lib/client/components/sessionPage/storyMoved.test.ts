/**
 * The page tells its widgets `story:moved` (Chronicle, W3) when a history
 * entry of the session's book is added, changed or removed — never for
 * another entry type of that book, and after the release, for nothing.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
vi.mock("$lib/client/sockets/socketInstance", () => ({
	getSocket: () => socket
}))

import {
	_resetInterestForTests,
	setInterestUser
} from "$lib/client/sockets/interest.svelte"
import { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import { HISTORY_TYPE_ID } from "$lib/shared/entries/types"
import { hearStoryMoved } from "./storyMoved"

type Listener = (payload: unknown) => void
const listeners = new Map<string, Listener[]>()
const socket = {
	connected: true,
	on(event: string, fn: Listener) {
		listeners.set(event, [...(listeners.get(event) ?? []), fn])
	},
	off(event: string, fn: Listener) {
		listeners.set(
			event,
			(listeners.get(event) ?? []).filter((f) => f !== fn)
		)
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

describe("hearStoryMoved", () => {
	test("a history entry of the book made, stepped, saved or deleted reaches the widgets; lore does not", () => {
		const manager = new SurfaceManager()
		const heard: unknown[] = []
		manager.subscribe((e) => heard.push(e))

		const release = hearStoryMoved(4, manager)
		const history = { id: 1, lorebookId: 4, typeId: HISTORY_TYPE_ID }
		push("entries:create", { entry: history })
		push("entries:iterateNext", { entry: history, requestId: "x" })
		push("entries:update", { entry: history })
		push("entries:delete", {
			lorebookId: 4,
			entryId: 1,
			typeId: HISTORY_TYPE_ID
		})
		push("entries:update", {
			entry: { id: 2, lorebookId: 4, typeId: "core:entry/lore" }
		})
		// Carries nothing: where the story stands is the widget's request.
		expect(heard).toEqual(Array(4).fill({ kind: "story:moved" }))

		release()
		push("entries:create", { entry: history })
		expect(heard).toHaveLength(4)
	})
})
