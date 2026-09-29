/**
 * `entryChannel` — each door hears only its own kind.
 *
 * The regression: `entries:delete` names the book and the row but not the
 * type, so every door open on a book toasted every delete ("All entries"
 * showed four wrong-kind toasts for one row).
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const handlersByKey = new Map<string, Array<(data: any) => void>>()

vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (data: any) => void) => {
		const list = handlersByKey.get(key) ?? []
		list.push(handler)
		handlersByKey.set(key, list)
		return () => {
			handlersByKey.set(
				key,
				(handlersByKey.get(key) ?? []).filter((h) => h !== handler)
			)
		}
	}
}))

import { entryChannel } from "./entryManager"

const fire = (key: string, data: any) =>
	(handlersByKey.get(key) ?? []).forEach((h) => h(data))

const socket = { emit: vi.fn() } as any

function door(typeId: string) {
	const onDeleted = vi.fn()
	const onReordered = vi.fn()
	const channel = entryChannel(socket, {
		lorebookId: 7,
		typeId: typeId as any,
		vectorSource: typeId,
		handlers: { onList: () => {}, onDeleted, onReordered }
	})
	channel.open()
	return { channel, onDeleted, onReordered }
}

beforeEach(() => {
	handlersByKey.clear()
	socket.emit.mockClear()
})

describe("entryChannel delete and reorder replies", () => {
	test("a delete toasts only in the door whose row it was", () => {
		const world = door("core:entry/world-lore")
		const history = door("core:entry/history")
		fire("entries:list#7", {
			lorebookId: 7,
			typeId: "core:entry/world-lore",
			entryList: [{ id: 1 }]
		})
		fire("entries:list#7", {
			lorebookId: 7,
			typeId: "core:entry/history",
			entryList: [{ id: 2 }]
		})

		fire("entries:delete#7", { success: "ok", lorebookId: 7, entryId: 1 })
		expect(world.onDeleted).toHaveBeenCalledTimes(1)
		expect(history.onDeleted).not.toHaveBeenCalled()
	})

	test("a row this door created, or removed itself, is its own", () => {
		const world = door("core:entry/world-lore")
		fire("entries:create#7", {
			entry: { id: 5, lorebookId: 7, typeId: "core:entry/world-lore" }
		})
		fire("entries:delete#7", { success: "ok", lorebookId: 7, entryId: 5 })
		world.channel.remove(9)
		fire("entries:delete#7", { success: "ok", lorebookId: 7, entryId: 9 })
		expect(world.onDeleted).toHaveBeenCalledTimes(2)
	})

	test("says whether this door asked for the delete, so only that one toasts", () => {
		const world = door("core:entry/world-lore")
		fire("entries:list#7", {
			lorebookId: 7,
			typeId: "core:entry/world-lore",
			entryList: [{ id: 1 }, { id: 2 }]
		})
		// Another tab's (or a session's) delete of a row this door lists.
		fire("entries:delete#7", { success: "ok", lorebookId: 7, entryId: 1 })
		expect(world.onDeleted).toHaveBeenLastCalledWith(1, false)
		world.channel.remove(2)
		fire("entries:delete#7", { success: "ok", lorebookId: 7, entryId: 2 })
		expect(world.onDeleted).toHaveBeenLastCalledWith(2, true)
	})

	test("another book's delete is never ours", () => {
		const world = door("core:entry/world-lore")
		world.channel.remove(9)
		fire("entries:delete#7", { success: "ok", lorebookId: 8, entryId: 9 })
		expect(world.onDeleted).not.toHaveBeenCalled()
	})

	test("a reorder reply toasts only in the door that asked", () => {
		const world = door("core:entry/world-lore")
		const history = door("core:entry/history")
		world.channel.reorder([{ id: 1, position: 1 }])
		fire("entries:updatePositions", { success: "ok" })
		expect(world.onReordered).toHaveBeenCalledTimes(1)
		expect(history.onReordered).not.toHaveBeenCalled()
	})
})
