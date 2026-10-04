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

describe("awaitReply — a refusal that names its request (matchError)", () => {
	test("a place-stat save is settled only by its own refusal, or one naming no request", async () => {
		// L4 review: another stat's refusal, or another tab's, rejected this
		// save — the error showed under the wrong stat and a save that landed
		// read as failed. `lorebookState:*` refusals echo the request id.
		const { socketPlaceStatsApi } = await import("$lib/client/lorebooks/places/placeStatsApi")
		const emits: Array<{ event: string; params: any }> = []
		const api = socketPlaceStatsApi({ emit: (event: string, params: any) => emits.push({ event, params }) } as any)
		const params = {
			lorebookId: 4,
			owner: { kind: "location", id: 42 },
			branchId: null,
			moment: null,
			slotId: "core:slot/inventory@1",
			value: ["gold"],
			readValue: null
		} as const
		const saving = api.write(params as any)
		const mine = emits.at(-1)!.params.requestId as string
		expect(mine).toBeTruthy()
		let settled = false
		void saving.then(
			() => (settled = true),
			() => (settled = true)
		)

		// Someone else's refusal: ignored.
		handlers.get("lorebookState:set:error")!({ error: "Lamps lit is out of bounds.", lorebookId: 4, requestId: "another" })
		await Promise.resolve()
		expect(settled).toBe(false)

		// Its own reply resolves it.
		const reply = { lorebookId: 4, requestId: mine, values: { "core:slot/inventory@1": ["gold"] } }
		handlers.get("lorebookState:set#4")!(reply)
		await expect(saving).resolves.toEqual(reply)
	})

	test("its own refusal, or a refusal naming no request, still rejects", async () => {
		const { socketPlaceStatsApi } = await import("$lib/client/lorebooks/places/placeStatsApi")
		const emits: Array<{ event: string; params: any }> = []
		const api = socketPlaceStatsApi({ emit: (event: string, params: any) => emits.push({ event, params }) } as any)
		const at = { lorebookId: 4, owner: { kind: "location", id: 42 }, branchId: null, moment: null } as const
		const reading = api.read(at as any)
		const mine = emits.at(-1)!.params.requestId as string
		handlers.get("lorebookState:get:error")!({ error: "Lorebook not found.", requestId: mine })
		await expect(reading).rejects.toThrow("Lorebook not found.")

		const again = api.read(at as any)
		handlers.get("lorebookState:get:error")!({ error: "Something broke." })
		await expect(again).rejects.toThrow("Something broke.")
	})
})
