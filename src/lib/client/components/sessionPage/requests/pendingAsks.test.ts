/**
 * The pending-asks table: a reply settles exactly one ask — the oldest under
 * its key — a reply nobody here asked for settles none, and no ask hangs.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { createPendingAsks } from "./pendingAsks"

type Reply = { key: string; value: number }

function table(opts: { listen?: boolean; timeoutMs?: number } = {}) {
	const sent: unknown[] = []
	const log: string[] = []
	let hear: ((r: Reply) => void) | null = null
	const asks = createPendingAsks<{ n: number }, Reply>({
		emit: (p) => {
			log.push("emit")
			sent.push(p)
		},
		...(opts.listen
			? {
					listen: (onReply: (r: Reply) => void) => {
						log.push("listen")
						hear = onReply
						return () => {
							log.push("release")
							hear = null
						}
					}
				}
			: {}),
		keyOf: (r) => r.key,
		timeout: "nobody answered",
		timeoutMs: opts.timeoutMs
	})
	return { asks, sent, log, hear: (r: Reply) => hear?.(r) }
}

afterEach(() => vi.useRealTimers())

describe("createPendingAsks", () => {
	test("a reply settles the oldest ask under its key, and only that one", async () => {
		const { asks } = table()
		const first = asks.ask("7", { n: 1 })
		const second = asks.ask("7", { n: 2 })
		const other = asks.ask("8", { n: 3 })
		expect(asks.deliver({ key: "7", value: 100 })).toBe(true)
		await expect(first).resolves.toEqual({ key: "7", value: 100 })
		expect(asks.size).toBe(2)
		expect(asks.deliver({ key: "8", value: 300 })).toBe(true)
		expect(asks.deliver({ key: "7", value: 200 })).toBe(true)
		await expect(second).resolves.toEqual({ key: "7", value: 200 })
		await expect(other).resolves.toEqual({ key: "8", value: 300 })
		expect(asks.size).toBe(0)
	})

	test("a reply nobody here asked for settles nothing — the page keeps its own handling", () => {
		const { asks } = table()
		void asks.ask("7", { n: 1 }).catch(() => {})
		expect(asks.deliver({ key: "9", value: 1 })).toBe(false)
		expect(asks.size).toBe(1)
		asks.drop("done")
	})

	test("listens before it asks, once for every ask waiting, and stops when none waits", async () => {
		const { asks, log, hear } = table({ listen: true })
		const a = asks.ask("1", { n: 1 })
		const b = asks.ask("2", { n: 2 })
		expect(log).toEqual(["listen", "emit", "emit"])
		hear({ key: "2", value: 2 })
		hear({ key: "1", value: 1 })
		await expect(a).resolves.toMatchObject({ value: 1 })
		await expect(b).resolves.toMatchObject({ value: 2 })
		expect(log).toEqual(["listen", "emit", "emit", "release"])
	})

	test("an ask that hears nothing rejects in words, and stops listening", async () => {
		vi.useFakeTimers()
		const { asks, log } = table({ listen: true, timeoutMs: 1000 })
		const a = asks.ask("1", { n: 1 })
		vi.advanceTimersByTime(1000)
		await expect(a).rejects.toThrow("nobody answered")
		expect(asks.size).toBe(0)
		expect(log.at(-1)).toBe("release")
		// Its late reply is nobody's now.
		expect(asks.deliver({ key: "1", value: 1 })).toBe(false)
	})

	test("drop rejects everything still waiting", async () => {
		const { asks, log } = table({ listen: true })
		const a = asks.ask("1", { n: 1 })
		const b = asks.ask("1", { n: 2 })
		asks.drop("the page closed")
		await expect(a).rejects.toThrow("the page closed")
		await expect(b).rejects.toThrow("the page closed")
		expect(asks.size).toBe(0)
		expect(log.at(-1)).toBe("release")
	})

	test("an ask whose send throws rejects with it and is not left waiting", async () => {
		const asks = createPendingAsks<number, Reply>({
			emit: () => {
				throw new Error("offline")
			},
			keyOf: (r) => r.key,
			timeout: "nobody answered"
		})
		await expect(asks.ask("1", 1)).rejects.toThrow("offline")
		expect(asks.size).toBe(0)
	})
})
