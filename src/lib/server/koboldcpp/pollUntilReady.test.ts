import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { pollUntilReady, type PollResult } from "./pollUntilReady"

describe("pollUntilReady", () => {
	beforeEach(() => {
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	test("resolves immediately when the first check is already ready", async () => {
		const check = vi.fn<() => Promise<PollResult>>(async () => "ready")
		await pollUntilReady(check, { intervalMs: 10 })
		expect(check).toHaveBeenCalledTimes(1)
	})

	test("keeps polling on not-ready until it becomes ready", async () => {
		let calls = 0
		const check = vi.fn<() => Promise<PollResult>>(async () => {
			calls++
			return calls >= 3 ? "ready" : "not-ready"
		})
		const promise = pollUntilReady(check, { intervalMs: 10 })
		await vi.advanceTimersByTimeAsync(10)
		await vi.advanceTimersByTimeAsync(10)
		await promise
		expect(calls).toBe(3)
	})

	describe("with isAlive provided (managed subprocess we hold a handle to)", () => {
		test("tolerates repeated refusals indefinitely as long as isAlive() is true", async () => {
			let calls = 0
			const check = vi.fn<() => Promise<PollResult>>(async () => {
				calls++
				return calls >= 5 ? "ready" : "refused"
			})
			const promise = pollUntilReady(check, {
				intervalMs: 10,
				isAlive: () => true
			})
			for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(10)
			await promise
			expect(calls).toBe(5)
		})

		test("throws immediately once isAlive() reports the process is gone, regardless of refusedStrikeThreshold", async () => {
			let alive = true
			const check = vi.fn<() => Promise<PollResult>>(async () => "refused")
			const promise = pollUntilReady(check, {
				intervalMs: 10,
				isAlive: () => alive,
				refusedStrikeThreshold: 100 // should be irrelevant when isAlive is provided
			})
			promise.catch(() => {})
			// Let one refusal go through tolerated, then the process "exits".
			await vi.advanceTimersByTimeAsync(0)
			alive = false
			await vi.advanceTimersByTimeAsync(10)
			await expect(promise).rejects.toThrow(/no longer running/)
		})

		test("also throws if isAlive() reports dead on a not-ready (non-refused) result", async () => {
			const check = vi.fn<() => Promise<PollResult>>(async () => "not-ready")
			const promise = pollUntilReady(check, {
				intervalMs: 10,
				isAlive: () => false
			})
			await expect(promise).rejects.toThrow(/no longer running/)
		})
	})

	describe("without isAlive (an external/unowned instance)", () => {
		test("tolerates fewer than refusedStrikeThreshold consecutive refusals", async () => {
			let calls = 0
			const check = vi.fn<() => Promise<PollResult>>(async () => {
				calls++
				if (calls <= 2) return "refused"
				return "ready"
			})
			const promise = pollUntilReady(check, {
				intervalMs: 10,
				refusedStrikeThreshold: 3
			})
			await vi.advanceTimersByTimeAsync(10)
			await vi.advanceTimersByTimeAsync(10)
			await promise
			expect(calls).toBe(3)
		})

		test("throws once refusedStrikeThreshold consecutive refusals are hit", async () => {
			const check = vi.fn<() => Promise<PollResult>>(async () => "refused")
			const promise = pollUntilReady(check, {
				intervalMs: 10,
				refusedStrikeThreshold: 3
			})
			promise.catch(() => {}) // avoid unhandled-rejection noise while timers advance
			await vi.advanceTimersByTimeAsync(10)
			await vi.advanceTimersByTimeAsync(10)
			await expect(promise).rejects.toThrow(/appears to have crashed/)
		})

		test("a not-ready result resets the refusal streak", async () => {
			// refused, refused, not-ready, refused, refused, ready — never hits 3
			// consecutive refusals because the not-ready in the middle resets it.
			const sequence: PollResult[] = [
				"refused",
				"refused",
				"not-ready",
				"refused",
				"refused",
				"ready"
			]
			let i = 0
			const check = vi.fn<() => Promise<PollResult>>(
				async () => sequence[i++]
			)
			const promise = pollUntilReady(check, {
				intervalMs: 10,
				refusedStrikeThreshold: 3
			})
			for (let n = 0; n < sequence.length - 1; n++) {
				await vi.advanceTimersByTimeAsync(10)
			}
			await promise
			expect(i).toBe(sequence.length)
		})
	})

	test("throws a timeout error once hardTimeoutMs elapses, even while nominally alive", async () => {
		const check = vi.fn<() => Promise<PollResult>>(async () => "not-ready")
		const promise = pollUntilReady(check, {
			intervalMs: 1000,
			hardTimeoutMs: 5000,
			isAlive: () => true,
			label: "test-thing"
		})
		promise.catch(() => {})
		for (let i = 0; i < 6; i++) {
			await vi.advanceTimersByTimeAsync(1000)
		}
		await expect(promise).rejects.toThrow(
			/test-thing did not become ready within/
		)
	})

	test("throws when the abort signal fires mid-poll", async () => {
		const controller = new AbortController()
		const check = vi.fn<() => Promise<PollResult>>(async () => "not-ready")
		const promise = pollUntilReady(check, {
			intervalMs: 10,
			signal: controller.signal
		})
		promise.catch(() => {})
		controller.abort()
		await vi.advanceTimersByTimeAsync(10)
		await expect(promise).rejects.toThrow()
	})

	test("calls onTick roughly every 30s of elapsed time, not every poll", async () => {
		const check = vi.fn<() => Promise<PollResult>>(async () => "not-ready")
		const onTick = vi.fn()
		const promise = pollUntilReady(check, {
			intervalMs: 10_000,
			hardTimeoutMs: 100_000,
			isAlive: () => true,
			onTick
		})
		promise.catch(() => {})
		// 6 ticks of 10s = 60s elapsed — onTick should fire at ~30s and ~60s,
		// not once per 10s poll.
		for (let i = 0; i < 6; i++) {
			await vi.advanceTimersByTimeAsync(10_000)
		}
		expect(onTick.mock.calls.length).toBeGreaterThanOrEqual(2)
		expect(onTick.mock.calls.length).toBeLessThan(6)
	})
})
