/**
 * 🚧 The routine queue (PLAN-layering R13, R14, R18; lane 6): one at a time,
 * in order, each firing its own entry; nothing starts while the session is
 * busy with an action or event run; Allow stacking off refuses a firing
 * that finds the same routine WAITING and queues one that finds it RUNNING.
 * Pure over fakes — no database, no timers.
 */
import { describe, expect, it } from "vitest"
import { ALREADY_WAITING, RoutineQueue, type RoutineFiringEntry } from "./queue"

function harness() {
	let busy = false
	const quiet: Array<() => void> = []
	const ran: string[] = []
	const refused: Array<{ key: string; reason: string }> = []
	const gates = new Map<string, () => void>()
	const queue = new RoutineQueue({
		busy: () => busy,
		waitQuiet: () => new Promise<void>((r) => quiet.push(r)),
		run: async (f) => {
			ran.push(`${f.registrationKey}:${f.id}`)
			const gate = gates.get(f.id)
			if (gate) await new Promise<void>((r) => gates.set(f.id, r))
		},
		refused: async (f, reason) => {
			refused.push({ key: f.registrationKey, reason })
		}
	})
	const firing = (id: string, key: string, sessionId = 1): RoutineFiringEntry => ({
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
	return {
		queue,
		firing,
		ran,
		refused,
		setBusy: (b: boolean) => (busy = b),
		/** Wake every waiter. */
		wake: () => quiet.splice(0).forEach((r) => r()),
		/** Hold this firing's run open until `release`. */
		hold: (id: string) => gates.set(id, () => {}),
		release: (id: string) => gates.get(id)?.(),
		settle: () => Promise.all(queue.settling())
	}
}

const tick = () => new Promise((r) => setImmediate(r))

describe("the routine queue", () => {
	it("runs firings one at a time, in the order they came (R14)", async () => {
		const h = harness()
		await h.queue.fire(h.firing("1", "a"), { allowStacking: true })
		await h.queue.fire(h.firing("2", "b"), { allowStacking: true })
		await h.queue.fire(h.firing("3", "a"), { allowStacking: true })
		await h.settle()
		expect(h.ran).toEqual(["a:1", "b:2", "a:3"])
	})

	it("waits while the session is busy with an action or event run, then runs (R13)", async () => {
		const h = harness()
		h.setBusy(true)
		await h.queue.fire(h.firing("1", "a"))
		await tick()
		expect(h.ran).toEqual([])
		expect(h.queue.isWaiting(1, "a")).toBe(true)
		// A settle does not wait on a queue the session's runs hold.
		expect(h.queue.settling()).toEqual([])
		h.setBusy(false)
		h.wake()
		await h.settle()
		expect(h.ran).toEqual(["a:1"])
		expect(h.queue.isWaiting(1, "a")).toBe(false)
	})

	it("Allow stacking off: a firing that finds the routine WAITING is refused with an inspector line (R18)", async () => {
		const h = harness()
		h.setBusy(true)
		expect(await h.queue.fire(h.firing("1", "a"))).toEqual({ queued: true })
		expect(await h.queue.fire(h.firing("2", "a"))).toEqual({ queued: false, reason: ALREADY_WAITING })
		expect(h.refused).toEqual([{ key: "a", reason: "Skipped: already waiting" }])
		// Another routine is not this one.
		expect(await h.queue.fire(h.firing("3", "b"))).toEqual({ queued: true })
		h.setBusy(false)
		h.wake()
		await h.settle()
		expect(h.ran).toEqual(["a:1", "b:3"])
	})

	it("Allow stacking off: one that arrives while the routine RUNS still queues one follow-up", async () => {
		const h = harness()
		h.hold("1")
		await h.queue.fire(h.firing("1", "a"))
		await tick()
		expect(h.queue.isRunning(1, "a")).toBe(true)
		expect(await h.queue.fire(h.firing("2", "a"))).toEqual({ queued: true })
		expect(await h.queue.fire(h.firing("3", "a"))).toMatchObject({ queued: false })
		h.release("1")
		await h.settle()
		expect(h.ran).toEqual(["a:1", "a:2"])
	})

	it("Allow stacking on: every firing queues, none merged", async () => {
		const h = harness()
		h.setBusy(true)
		for (const id of ["1", "2", "3"]) await h.queue.fire(h.firing(id, "a"), { allowStacking: true })
		expect(h.queue.view(1).waiting.map((w) => w.registrationKey)).toEqual(["a", "a", "a"])
		h.setBusy(false)
		h.wake()
		await h.settle()
		expect(h.ran).toEqual(["a:1", "a:2", "a:3"])
		expect(h.refused).toEqual([])
	})

	it("sessions are queued apart: one session's busy run never holds another's routine", async () => {
		const h = harness()
		h.hold("1")
		await h.queue.fire(h.firing("1", "a", 1))
		await h.queue.fire(h.firing("2", "a", 2))
		await tick()
		expect(h.ran).toEqual(["a:1", "a:2"])
		h.release("1")
		await h.settle()
	})

	it("a run that throws does not stop the queue", async () => {
		const ran: string[] = []
		const queue = new RoutineQueue({
			busy: () => false,
			waitQuiet: async () => undefined,
			run: async (f) => {
				ran.push(f.id)
				if (f.id === "1") throw new Error("boom")
			},
			refused: async () => undefined
		})
		const base = { db: null, sessionId: 9, pipeline: "p", cause: { moment: "event", at: 0 }, firedAt: {}, depth: 0, queuedAt: 0 }
		await queue.fire({ ...base, id: "1", registrationKey: "a" })
		await queue.fire({ ...base, id: "2", registrationKey: "b" })
		await Promise.all(queue.settling())
		expect(ran).toEqual(["1", "2"])
	})
})

describe("a settle and the queue", () => {
	it("a settle stops waiting on a routine once the session holds it again (a parked run never hangs a settle)", async () => {
		let busy = false
		const quiet: Array<() => void> = []
		let releaseFirst!: () => void
		const queue = new RoutineQueue({
			busy: () => busy,
			waitQuiet: () => new Promise<void>((r) => quiet.push(r)),
			run: async (f) => {
				if (f.id === "1") await new Promise<void>((r) => (releaseFirst = r))
			},
			refused: async () => undefined
		})
		const base = { db: null, sessionId: 3, pipeline: "p", cause: { moment: "event", at: 0 }, firedAt: {}, depth: 0, queuedAt: 0 }
		await queue.fire({ ...base, id: "1", registrationKey: "a" })
		await queue.fire({ ...base, id: "2", registrationKey: "b" })
		const settled = Promise.all(queue.settling())
		// The first run ends just as the session turns busy (a reply parked at review).
		busy = true
		releaseFirst()
		await settled
		expect(queue.view(3).waiting.map((w) => w.registrationKey)).toEqual(["b"])
		busy = false
		quiet.splice(0).forEach((r) => r())
		await Promise.all(queue.settling())
		expect(queue.view(3).waiting).toEqual([])
	})
})
