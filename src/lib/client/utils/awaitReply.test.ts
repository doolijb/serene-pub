/**
 * `awaitReply` — the promise a save waits on before it claims success.
 *
 * The properties that matter: somebody else's broadcast does not settle it,
 * the error sibling rejects it with the server's sentence, and every exit
 * releases both interests.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const handlers = new Map<string, (data: any) => void>()
const released: string[] = []

vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (data: any) => void) => {
		handlers.set(key, handler)
		return () => {
			released.push(key)
			handlers.delete(key)
		}
	}
}))

import { awaitReply } from "./awaitReply"

function setup(timeoutMs?: number) {
	const emits: Array<{ event: string; params: any }> = []
	const socket = {
		emit: (event: string, params: any) => emits.push({ event, params })
	}
	const promise = awaitReply({
		socket: socket as any,
		event: "entries:create",
		params: {
			entry: { typeId: "core:entry/world-lore", lorebookId: 4 }
		} as any,
		replyKey: "entries:create#4",
		errorEvent: "entries:create:error",
		match: (data: any) => data.entry?.name === "Mine",
		timeoutMs
	})
	return { emits, promise }
}

beforeEach(() => {
	handlers.clear()
	released.length = 0
})
afterEach(() => vi.useRealTimers())

describe("awaitReply", () => {
	test("declares both interests before it emits, on the scoped reply key", () => {
		const { emits } = setup()
		expect([...handlers.keys()].sort()).toEqual([
			"entries:create#4",
			"entries:create:error"
		])
		expect(emits).toEqual([
			{
				event: "entries:create",
				params: {
					entry: { typeId: "core:entry/world-lore", lorebookId: 4 }
				}
			}
		])
	})

	test("ignores somebody else's reply and resolves on its own", async () => {
		const { promise } = setup()
		handlers.get("entries:create#4")!({ entry: { name: "Theirs" } })
		expect(released).toEqual([])
		handlers.get("entries:create#4")!({ entry: { name: "Mine" } })
		await expect(promise).resolves.toEqual({ entry: { name: "Mine" } })
		expect(released.sort()).toEqual([
			"entries:create#4",
			"entries:create:error"
		])
	})

	test("rejects with the server's sentence on the error sibling", async () => {
		const { promise } = setup()
		handlers.get("entries:create:error")!({ error: "Lorebook not found." })
		await expect(promise).rejects.toThrow("Lorebook not found.")
		expect(released).toHaveLength(2)
	})

	test("rejects on timeout and releases", async () => {
		vi.useFakeTimers()
		const { promise } = setup(1000)
		const assertion = expect(promise).rejects.toThrow(/did not answer/)
		vi.advanceTimersByTime(1000)
		await assertion
		expect(released).toHaveLength(2)
	})
})
