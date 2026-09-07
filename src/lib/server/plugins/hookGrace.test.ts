import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { HookGracePolicy, HOOK_CANCEL_GRACE_MS } from "./hookGrace"

/**
 * The policy, on fake time.
 *
 * Every claim here is about *sequencing* — what happens, to which call, and
 * when — so the tests drive the clock rather than sleep on it: a race asserted
 * against a real 2s budget is a race asserted against the machine's load. The
 * sandbox is a pair of recording ports, because the policy's whole contract is
 * which of `abort` and `kill` it calls, in what order, and how many times.
 */

/** A recording stand-in for the dispatcher. */
function harness() {
	const aborted: number[] = []
	const killed: { callId: number; reason: string }[] = []
	/** The calls the dispatcher would report as in flight, per run. */
	const inFlight = new Map<string, Set<number>>()

	const start = (runId: string, ...callIds: number[]) => {
		const set = inFlight.get(runId) ?? new Set<number>()
		for (const id of callIds) set.add(id)
		inFlight.set(runId, set)
	}
	/** A call that came back on its own — the settle-during-grace case. */
	const settle = (policy: HookGracePolicy, runId: string, callId: number) => {
		inFlight.get(runId)?.delete(callId)
		policy.settled(callId)
	}

	const policy = new HookGracePolicy({
		callsOfRun: (runId) => [...(inFlight.get(runId) ?? [])],
		abort: (callId) => void aborted.push(callId),
		// The dispatcher's kill resolves the call through the live registry, so
		// a call that is no longer running is a no-op there. Mirrored here, so
		// a test that "kills" a settled call would have to prove the policy
		// asked for it, not merely that a no-op happened.
		kill: (callId, reason) => {
			for (const set of inFlight.values()) set.delete(callId)
			killed.push({ callId, reason })
		}
	})

	return { policy, aborted, killed, start, settle }
}

const stop = { by: "user:7", reason: "the run was cancelled" }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("abort, wait the budget, then kill", () => {
	it("asks first and kills only when the budget runs out", () => {
		const h = harness()
		h.start("r1", 1)

		h.policy.cancelRun("r1", stop)
		// The ask is immediate; nothing is forced yet.
		expect(h.aborted).toEqual([1])
		expect(h.killed).toEqual([])

		// Still inside the budget, still nothing forced — the hook is being
		// given the time the policy promised it.
		vi.advanceTimersByTime(HOOK_CANCEL_GRACE_MS - 1)
		expect(h.killed).toEqual([])

		vi.advanceTimersByTime(1)
		expect(h.killed.map((k) => k.callId)).toEqual([1])
		// And the log can tell this apart from a hook that blew its own budget.
		expect(h.killed[0].reason).toMatch(/cancellation grace/)
		expect(h.killed[0].reason).toContain("user:7")
	})

	it("does not kill a hook that returned inside the grace", () => {
		const h = harness()
		h.start("r1", 1)
		h.policy.cancelRun("r1", stop)

		// The hook woke on its signal, wound down, and came back — an ordinary
		// success, and the whole reason the grace exists.
		vi.advanceTimersByTime(50)
		h.settle(h.policy, "r1", 1)

		vi.advanceTimersByTime(HOOK_CANCEL_GRACE_MS * 10)
		expect(h.killed).toEqual([])
	})

	it("leaves no timer behind when the last waiting call settles", () => {
		const h = harness()
		h.start("r1", 1, 2)
		h.policy.cancelRun("r1", stop)
		expect(h.policy.pending()[0]).toMatchObject({ armed: true })

		h.settle(h.policy, "r1", 1)
		// One still out: the reap is still needed.
		expect(h.policy.pending()[0]).toMatchObject({
			armed: true,
			waiting: [2]
		})

		h.settle(h.policy, "r1", 2)
		// Nothing left to stop, so nothing left to fire. A timer surviving here
		// is the bug: `callId`s are handed out in sequence, and a stop that
		// arrives late has no way to know the call it names is not its own.
		expect(h.policy.pending()[0]).toMatchObject({
			armed: false,
			waiting: []
		})
		expect(vi.getTimerCount()).toBe(0)
	})
})

describe("the budget belongs to the run", () => {
	it("gives five hooks on one run one budget, not five", () => {
		const h = harness()
		h.start("r1", 1, 2, 3, 4, 5)

		h.policy.cancelRun("r1", stop)
		expect(h.aborted).toEqual([1, 2, 3, 4, 5])
		// One clock for the whole run — five would be five times the wait.
		expect(vi.getTimerCount()).toBe(1)

		vi.advanceTimersByTime(HOOK_CANCEL_GRACE_MS)
		expect(h.killed.map((k) => k.callId).sort()).toEqual([1, 2, 3, 4, 5])
		// The claim stated as the cost: everything was stopped by the time ONE
		// budget had elapsed.
		expect(vi.getTimerCount()).toBe(0)
	})

	it("hands a hook that starts mid-cancellation what is left, not a fresh window", () => {
		const h = harness()
		h.start("r1", 1)
		h.policy.cancelRun("r1", stop)

		// A chain fold absorbs the link it just lost and dispatches the next
		// one; the executor has not noticed the cancellation yet.
		vi.advanceTimersByTime(HOOK_CANCEL_GRACE_MS - 100)
		h.settle(h.policy, "r1", 1)
		h.start("r1", 2)
		h.policy.adopt("r1", 2)
		expect(h.aborted).toEqual([1, 2])
		expect(h.killed).toEqual([])

		// The run's deadline, not the new call's: 100ms later, not a new 2s.
		vi.advanceTimersByTime(100)
		expect(h.killed.map((k) => k.callId)).toEqual([2])
	})

	it("stops a hook that starts after the budget is spent on arrival", () => {
		const h = harness()
		h.start("r1", 1)
		h.policy.cancelRun("r1", stop)
		vi.advanceTimersByTime(HOOK_CANCEL_GRACE_MS)
		expect(h.killed.map((k) => k.callId)).toEqual([1])

		h.start("r1", 2)
		h.policy.adopt("r1", 2)
		// Asked, then stopped in the same breath: the grace was the run's, and
		// the run has spent it.
		expect(h.aborted).toEqual([1, 2])
		expect(h.killed.map((k) => k.callId)).toEqual([1, 2])
	})

	it("does not restart the budget when a run is stopped twice", () => {
		const h = harness()
		h.start("r1", 1)
		h.policy.cancelRun("r1", stop)
		vi.advanceTimersByTime(HOOK_CANCEL_GRACE_MS - 1)
		h.policy.cancelRun("r1", { by: "user:7", reason: "again" })

		// A second press of Cancel is not more time.
		vi.advanceTimersByTime(1)
		expect(h.killed.map((k) => k.callId)).toEqual([1])
		expect(h.aborted).toEqual([1])
	})

	it("touches only the run that was stopped", () => {
		const h = harness()
		h.start("r1", 1)
		h.start("r2", 2)

		h.policy.cancelRun("r1", stop)
		vi.advanceTimersByTime(HOOK_CANCEL_GRACE_MS * 2)
		expect(h.aborted).toEqual([1])
		expect(h.killed.map((k) => k.callId)).toEqual([1])
	})
})

describe("the run's lifetime", () => {
	it("keeps reaping a run that has already left the registry", () => {
		const h = harness()
		h.start("r1", 1)
		h.policy.cancelRun("r1", stop)

		// The normal case, not an exotic one: a cancelled run stops between
		// nodes and hits its `finally` at once, while its hooks are still
		// winding down. If `forget` called off the reap, the kill half of the
		// policy would essentially never happen.
		h.policy.forget("r1")
		vi.advanceTimersByTime(HOOK_CANCEL_GRACE_MS)
		expect(h.killed.map((k) => k.callId)).toEqual([1])
	})

	it("stops matching later calls once the run is gone", () => {
		const h = harness()
		h.start("r1", 1)
		h.policy.cancelRun("r1", stop)
		h.settle(h.policy, "r1", 1)
		h.policy.forget("r1")

		h.start("r1", 2)
		h.policy.adopt("r1", 2)
		expect(h.aborted).toEqual([1])
		expect(h.policy.pending()).toEqual([])
	})

	it("leaves a re-sent run's replacement alone", () => {
		const h = harness()
		h.start("r1", 1)
		// `runRegistry.start` supersedes a repeated id and immediately hands
		// that id to the new run. Its hooks are indistinguishable by run id, so
		// the stale run's cancellation must not be applied to them.
		h.policy.cancelRun("r1", {
			by: "system:superseded",
			reason: "superseded by a newer run with the same id",
			idReused: true
		})
		expect(h.aborted).toEqual([1])

		h.start("r1", 2)
		h.policy.adopt("r1", 2)
		vi.advanceTimersByTime(HOOK_CANCEL_GRACE_MS)
		// The stale run's own call is still reaped; the replacement's is not
		// touched at all.
		expect(h.aborted).toEqual([1])
		expect(h.killed.map((k) => k.callId)).toEqual([1])
	})

	it("dispose drops every record and timer", () => {
		const h = harness()
		h.start("r1", 1)
		h.start("r2", 2)
		h.policy.cancelRun("r1", stop)
		h.policy.cancelRun("r2", stop)
		expect(vi.getTimerCount()).toBe(2)

		h.policy.dispose()
		expect(vi.getTimerCount()).toBe(0)
		expect(h.policy.pending()).toEqual([])
		vi.advanceTimersByTime(HOOK_CANCEL_GRACE_MS * 2)
		expect(h.killed).toEqual([])
	})
})
