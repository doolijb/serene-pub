/**
 * The turn hold — turns before background work (2026-10-03).
 *
 * What it must guarantee, in order of how badly each one fails:
 *   · a hold cannot leak: `withTurnHold` closes however the turn ends, and a
 *     hold never closed goes stale rather than parking the sweep for ever;
 *   · background work waits out every open hold AND the grace after the last;
 *   · waiting is cheap — every parked lane shares one promise.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import {
	TURN_HOLD_STALE_MS,
	isTurnHoldActive,
	openTurnHold,
	openTurnHoldCount,
	resetTurnHoldsForTests,
	setTurnHoldGraceForTests,
	whenTurnsQuiet,
	withTurnHold,
	yieldToEventLoop
} from "./turnHold"

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

afterEach(() => {
	vi.useRealTimers()
	resetTurnHoldsForTests()
})

describe("the turn hold", () => {
	it("is inactive until a turn opens one", () => {
		expect(isTurnHoldActive()).toBe(false)
		const close = openTurnHold()
		expect(isTurnHoldActive()).toBe(true)
		expect(openTurnHoldCount()).toBe(1)
		close()
		expect(openTurnHoldCount()).toBe(0)
	})

	it("stays active for the grace after the last close, then lifts", async () => {
		setTurnHoldGraceForTests(40)
		const close = openTurnHold()
		close()
		expect(isTurnHoldActive()).toBe(true)
		await delay(60)
		expect(isTurnHoldActive()).toBe(false)
	})

	it("waits for every open hold, not the first to close", async () => {
		setTurnHoldGraceForTests(10)
		const a = openTurnHold("a")
		const b = openTurnHold("b")
		a()
		await delay(30)
		expect(isTurnHoldActive()).toBe(true)
		b()
		await delay(30)
		expect(isTurnHoldActive()).toBe(false)
	})

	it("closes are idempotent — a double close does not end another turn's hold", () => {
		const a = openTurnHold("a")
		openTurnHold("b")
		a()
		a()
		expect(openTurnHoldCount()).toBe(1)
	})

	it("withTurnHold closes when the turn throws", async () => {
		setTurnHoldGraceForTests(0)
		await expect(
			withTurnHold(async () => {
				expect(openTurnHoldCount()).toBe(1)
				throw new Error("the oracle fell over")
			})
		).rejects.toThrow("the oracle fell over")
		expect(openTurnHoldCount()).toBe(0)
		expect(isTurnHoldActive()).toBe(false)
	})

	it("whenTurnsQuiet resolves at once when nothing holds", async () => {
		let done = false
		void whenTurnsQuiet().then(() => (done = true))
		await Promise.resolve()
		expect(done).toBe(true)
	})

	it("whenTurnsQuiet resolves only after the last close and the grace", async () => {
		setTurnHoldGraceForTests(30)
		const close = openTurnHold()
		let quietAt = 0
		const started = Date.now()
		const waiting = whenTurnsQuiet().then(() => (quietAt = Date.now()))
		await delay(40)
		expect(quietAt).toBe(0) // still held — no grace while a hold is open
		close()
		const closedAt = Date.now()
		await waiting
		expect(quietAt - closedAt).toBeGreaterThanOrEqual(25)
		expect(quietAt - started).toBeGreaterThanOrEqual(60)
	})

	it("every waiter shares one promise", () => {
		const close = openTurnHold()
		expect(whenTurnsQuiet()).toBe(whenTurnsQuiet())
		close()
	})

	it("a hold left open past the stale mark is ignored, so it cannot park the sweep for ever", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		vi.useFakeTimers({ toFake: ["Date"] })
		setTurnHoldGraceForTests(0)
		openTurnHold("leaked") // never closed
		expect(isTurnHoldActive()).toBe(true)
		vi.setSystemTime(Date.now() + TURN_HOLD_STALE_MS + 1)
		expect(isTurnHoldActive()).toBe(false)
		expect(openTurnHoldCount()).toBe(0)
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("leaked"))
		warn.mockRestore()
	})

	it("yieldToEventLoop lets a due timer in, where a microtask chain never does", async () => {
		let fired = false
		setTimeout(() => (fired = true), 0)
		const due = Date.now() + 5
		while (Date.now() < due) {
			// spin until the timer is due
		}
		for (let i = 0; i < 1000; i++) await Promise.resolve()
		expect(fired).toBe(false)
		// Two trips: the first may land in this loop iteration's check phase,
		// before the next timers phase.
		await yieldToEventLoop()
		await yieldToEventLoop()
		expect(fired).toBe(true)
	})
})
