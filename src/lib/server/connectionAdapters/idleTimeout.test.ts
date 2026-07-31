/**
 * Round-7 audit fix: LLM adapter request timeouts need idle/no-progress
 * semantics, not wall-clock — a hard total-duration cap would abort a
 * slow-but-healthy local-inference generation just as readily as a
 * genuinely hung endpoint, and slow-but-alive is this app's normal
 * operating mode (CPU-only/small-GPU self-hosted inference). This locks in
 * createIdleWatchdog's core contract: poke() resets the clock, and onIdle
 * only fires after a full idleMs gap with no poke() at all.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createIdleWatchdog } from "./idleTimeout"

beforeEach(() => {
	vi.useFakeTimers()
})
afterEach(() => {
	vi.useRealTimers()
})

describe("createIdleWatchdog", () => {
	test("fires onIdle after idleMs with no poke() at all", () => {
		const onIdle = vi.fn()
		createIdleWatchdog(1000, onIdle)

		vi.advanceTimersByTime(999)
		expect(onIdle).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(onIdle).toHaveBeenCalledTimes(1)
	})

	test("poke() resets the clock — regular activity never fires onIdle", () => {
		const onIdle = vi.fn()
		const { poke } = createIdleWatchdog(1000, onIdle)

		// Simulate a slow-but-alive stream: a chunk every 800ms, well inside
		// the 1000ms idle window, for far longer than the idle window itself.
		for (let i = 0; i < 10; i++) {
			vi.advanceTimersByTime(800)
			poke()
		}
		expect(onIdle).not.toHaveBeenCalled()
	})

	test("a real gap after activity stops still fires onIdle", () => {
		const onIdle = vi.fn()
		const { poke } = createIdleWatchdog(1000, onIdle)

		vi.advanceTimersByTime(500)
		poke()
		// Activity stops here — no more poke() calls.
		vi.advanceTimersByTime(999)
		expect(onIdle).not.toHaveBeenCalled()
		vi.advanceTimersByTime(1)
		expect(onIdle).toHaveBeenCalledTimes(1)
	})

	test("clear() cancels a pending fire", () => {
		const onIdle = vi.fn()
		const { clear } = createIdleWatchdog(1000, onIdle)

		clear()
		vi.advanceTimersByTime(10_000)
		expect(onIdle).not.toHaveBeenCalled()
	})
})
