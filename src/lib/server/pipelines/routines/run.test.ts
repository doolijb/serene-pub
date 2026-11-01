/**
 * 🚧 The routine queue's wait (2026-10-30): the drain loop spun when a run
 * held the session busy with an empty event chain, because the wait settled
 * in a microtask; timers and I/O never ran. This pins that the wait always
 * yields to the event loop. Real timers on purpose — fake ones would hide
 * exactly the bug.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const events = vi.hoisted(() => ({
	pending: false,
	idle: (): Promise<void> => Promise.resolve()
}))

vi.mock("$lib/server/pipelines/runtime/sessionEvents", () => ({
	addSettleProbe: () => undefined,
	sessionEventsPending: () => events.pending,
	sessionEventsIdle: () => events.idle()
}))
vi.mock("$lib/server/pipelines/runtime/receipts", () => ({
	saveReceipt: async () => undefined
}))

import { QUIET_POLL_MS, waitQuietForRoutines } from "./run"
import { RoutineQueue, type RoutineFiringEntry } from "./queue"

const firing = (
	id: string,
	key: string,
	sessionId = 1
): RoutineFiringEntry => ({
	id,
	db: null,
	sessionId,
	registrationKey: key,
	pipeline: `p:${key}`,
	cause: { moment: "turn-ended", at: 0 },
	firedAt: {},
	depth: 0,
	queuedAt: 0
})

const timed = async (wait: Promise<void>) => {
	const start = performance.now()
	await wait
	return performance.now() - start
}

beforeEach(() => {
	events.pending = false
	events.idle = () => Promise.resolve()
})
afterEach(() => vi.restoreAllMocks())

describe("waitQuietForRoutines", () => {
	it("a session busy with nothing on its event chain still lets timers run, so the drain finishes", async () => {
		events.pending = false
		events.idle = async () => undefined
		let busy = true
		setTimeout(() => (busy = false), 50)
		let checks = 0
		let busyAtRun: boolean | null = null
		const ran: string[] = []
		const queue = new RoutineQueue({
			busy: () => {
				// The escape makes a regression FAIL: a microtask spin starves vitest's own timeout.
				if (++checks > 1000) return false
				return busy
			},
			waitQuiet: (id) => waitQuietForRoutines(id, 20),
			run: async (f) => {
				ran.push(f.id)
				busyAtRun = busy
			},
			refused: async () => undefined
		})
		await queue.fire(firing("1", "a"))
		// settling() ignores a session that is only waiting while busy, so wait for the run itself.
		await vi.waitFor(() => expect(ran).toEqual(["1"]), { timeout: 1500 })
		await Promise.all(queue.settling())
		expect(ran).toEqual(["1"])
		expect(busyAtRun).toBe(false)
		expect(checks).toBeLessThan(20)
	})

	it("when the event chain goes idle first, the wait ends early and clears its beat", async () => {
		events.pending = true
		events.idle = () => new Promise<void>((r) => setTimeout(r, 20))
		const setSpy = vi.spyOn(globalThis, "setTimeout")
		const clearSpy = vi.spyOn(globalThis, "clearTimeout")
		const elapsed = await timed(waitQuietForRoutines(1))
		expect(elapsed).toBeLessThan(QUIET_POLL_MS)
		const index = setSpy.mock.calls.findIndex(
			(call) => call[1] === QUIET_POLL_MS
		)
		expect(index).toBeGreaterThanOrEqual(0)
		expect(clearSpy).toHaveBeenCalledWith(setSpy.mock.results[index].value)
	})

	it("with nothing on the event chain, the wait is the beat alone", async () => {
		events.pending = false
		events.idle = async () => undefined
		const elapsed = await timed(waitQuietForRoutines(1))
		expect(elapsed).toBeGreaterThanOrEqual(QUIET_POLL_MS - 2)
	})

	it("when the beat comes first, the wait ends on the beat", async () => {
		events.pending = true
		events.idle = () => new Promise<void>(() => {})
		const elapsed = await timed(waitQuietForRoutines(1, 30))
		expect(elapsed).toBeGreaterThanOrEqual(28)
		expect(elapsed).toBeLessThan(QUIET_POLL_MS)
	})

	it("an event chain already idle still yields to a macrotask before the wait ends", async () => {
		events.pending = true
		events.idle = async () => undefined
		let macrotask = false
		setImmediate(() => (macrotask = true))
		await waitQuietForRoutines(1)
		expect(macrotask).toBe(true)
	})
})
