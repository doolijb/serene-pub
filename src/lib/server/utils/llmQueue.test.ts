import { describe, expect, test } from "vitest"
import { llmQueue, MAX_QUEUE_DEPTH, type LLMQueueItemInput } from "./llmQueue"

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

function item<T>(
	overrides: Partial<LLMQueueItemInput<T>> & {
		execute: LLMQueueItemInput<T>["execute"]
	}
): LLMQueueItemInput<T> {
	return {
		taskType: "session",
		connectionName: "test-connection",
		samplingName: "test-sampling",
		...overrides
	}
}

describe("llmQueue reentrancy", () => {
	test("a nested enqueue() call from within an already-executing item resolves instead of deadlocking", async () => {
		const order: string[] = []

		const { done } = llmQueue.enqueue(
			item({
				execute: async () => {
					order.push("outer-start")
					const inner = llmQueue.enqueue(
						item({
							execute: async () => {
								order.push("inner-start")
								await sleep(5)
								order.push("inner-end")
								return "inner-result"
							}
						})
					)
					const innerResult = await inner.done
					order.push("outer-end")
					return `outer-got-${innerResult}`
				}
			})
		)

		const result = await done
		expect(result).toBe("outer-got-inner-result")
		expect(order).toEqual([
			"outer-start",
			"inner-start",
			"inner-end",
			"outer-end"
		])
	})

	test("a third, genuinely-queued item on the same lane does not start until the outer run (with its nested call) completes", async () => {
		const order: string[] = []

		const { done: outerDone } = llmQueue.enqueue(
			item({
				execute: async () => {
					order.push("outer-start")
					const inner = llmQueue.enqueue(
						item({
							execute: async () => {
								order.push("inner-start")
								await sleep(10)
								order.push("inner-end")
								return "inner-result"
							}
						})
					)
					await inner.done
					order.push("outer-end")
					return "outer-result"
				}
			})
		)

		// Enqueued from top-level test code, NOT from within any active
		// lane — must be genuinely queued behind the outer run, not treated
		// as reentrant.
		const { done: thirdDone } = llmQueue.enqueue(
			item({
				execute: async () => {
					order.push("third-start")
					return "third-result"
				}
			})
		)

		const [outerResult, thirdResult] = await Promise.all([
			outerDone,
			thirdDone
		])

		expect(outerResult).toBe("outer-result")
		expect(thirdResult).toBe("third-result")
		// The critical assertion: the third item must not start until the
		// outer run (including its nested inner call) has fully finished —
		// if runInline() ever left `lane.running` cleared early, "third-start"
		// could appear before "outer-end", meaning two items ran
		// concurrently on what's supposed to be a single-flight lane.
		expect(order.indexOf("third-start")).toBeGreaterThan(
			order.indexOf("outer-end")
		)
		expect(order).toEqual([
			"outer-start",
			"inner-start",
			"inner-end",
			"outer-end",
			"third-start"
		])
	})
})

describe("llmQueue depth cap (round-11 audit fix: resource exhaustion)", () => {
	test("a genuinely-queued item past MAX_QUEUE_DEPTH is rejected outright, while items already within the cap queue and complete normally", async () => {
		// Block the lane's single "running" slot so every subsequent
		// enqueue() genuinely lands in `lane.queue` rather than starting
		// immediately and draining it before the cap can be observed.
		let releaseBlocker!: () => void
		const blockerGate = new Promise<void>((resolve) => {
			releaseBlocker = resolve
		})
		const blocker = llmQueue.enqueue(
			item({
				execute: async () => {
					await blockerGate
					return "blocker-result"
				}
			})
		)

		// Let the blocker actually start running (occupy lane.running)
		// before stacking up queued items behind it.
		await Promise.resolve()
		await Promise.resolve()

		const queued = Array.from({ length: MAX_QUEUE_DEPTH }, (_, i) =>
			llmQueue.enqueue(item({ execute: async () => `queued-${i}` }))
		)

		expect(() =>
			llmQueue.enqueue(item({ execute: async () => "overflow" }))
		).toThrow(/too many llm requests/i)

		releaseBlocker()
		const results = await Promise.all([
			blocker.done,
			...queued.map((q) => q.done)
		])
		expect(results[0]).toBe("blocker-result")
		expect(results.slice(1)).toEqual(
			Array.from({ length: MAX_QUEUE_DEPTH }, (_, i) => `queued-${i}`)
		)
	})

	test("a re-entrant (nested) enqueue() from within an already-executing item is never blocked by the depth cap", async () => {
		// Fill the lane's queue to the cap first, behind a blocker, exactly
		// like the previous test — the depth cap must only ever apply to
		// genuinely-new top-level enqueue() calls, never to the
		// deadlock-avoidance reentrant path (see the reentrancy describe
		// block above for why that path exists at all).
		const order2: string[] = []
		let releaseBlocker!: () => void
		const blockerGate = new Promise<void>((resolve) => {
			releaseBlocker = resolve
		})
		const blocker = llmQueue.enqueue(
			item({
				execute: async () => {
					order2.push("blocker-start")
					const nested = llmQueue.enqueue(
						item({
							execute: async () => {
								order2.push("nested-start")
								return "nested-result"
							}
						})
					)
					const nestedResult = await nested.done
					order2.push("blocker-end")
					await blockerGate
					return `blocker-got-${nestedResult}`
				}
			})
		)

		await Promise.resolve()
		await Promise.resolve()

		const queued = Array.from({ length: MAX_QUEUE_DEPTH }, (_, i) =>
			llmQueue.enqueue(item({ execute: async () => `queued-${i}` }))
		)

		releaseBlocker()
		const [blockerResult] = await Promise.all([
			blocker.done,
			...queued.map((q) => q.done)
		])
		expect(blockerResult).toBe("blocker-got-nested-result")
		expect(order2).toContain("nested-start")
	})
})
