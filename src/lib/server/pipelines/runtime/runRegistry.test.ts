/**
 * One abort, two shapes — and the receipt that says who asked.
 *
 * ⚠ This exists because half of it was missing. The registry has always
 * created an `AbortController` per run and the trigger has always passed its
 * signal into `runSpec`, so Cancel reached the *adapter* — the in-flight
 * request really did stop. It reached nothing else. The executor's between-node
 * hook (`opts.cancelSignal`, 13 §3) was passed nowhere in this application, so
 * `checkCancel` was permanently false and the graph walked straight on to the
 * next node, spending the time and the tokens the person had just asked it not
 * to spend. The visible symptom was a Cancel that stopped the picture being
 * rendered and then rendered the next one.
 *
 * The fix is a projection, not a second mechanism: `cancellation()` reads the
 * same controller and returns the shape the executor asks for. What the shape
 * adds is provenance — an `AbortSignal` cannot carry an actor or a cause, which
 * is exactly why the SDK asks for a function rather than a signal, and why the
 * registry now records who asked immediately before it aborts.
 *
 * Written at this seam rather than through a database because the claim is
 * about sequencing: the node after the cancelled one does not run. The real
 * executor is here, so that is asserted on the bindings that did and did not
 * fire, not on a returned status.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { spec, compile, run, ok } from "@serene-pub/sdk"
import * as C from "@serene-pub/contracts"
import {
	start,
	cancel,
	cancelSession,
	setLiveRow,
	finish,
	active,
	cancellation,
	setRunStopObserver,
	_reset,
	type RunStop
} from "$lib/server/pipelines/runtime/runRegistry"

const USER = 7
const OTHER_USER = 8

beforeEach(() => _reset())
// The observer is process-wide, so a test that sets one has to put it back.
afterEach(() => setRunStopObserver(null))

describe("what a stopped run knows about who stopped it", () => {
	it("says nothing while the run is still going", () => {
		const handle = start({ runId: "r1", userId: USER, kind: "action" })
		expect(cancellation(handle)).toBeUndefined()
	})

	it("names the person who pressed Cancel", () => {
		const handle = start({ runId: "r1", userId: USER, kind: "action" })
		expect(cancel("r1", USER)).toEqual({ found: true, allowed: true })
		expect(cancellation(handle)).toEqual({
			by: `user:${USER}`,
			reason: "the run was cancelled"
		})
	})

	it("does not invent a person for a run superseded by a re-send", () => {
		// A repeated id means a client re-sent; nobody pressed anything, so the
		// stale run's receipt must not claim a user cancelled it.
		const stale = start({ runId: "r1", userId: USER, kind: "action" })
		start({ runId: "r1", userId: USER, kind: "action" })
		expect(cancellation(stale)).toEqual({
			by: "system:superseded",
			reason: "superseded by a newer run with the same id"
		})
	})

	it("distinguishes a registry reset from either", () => {
		const handle = start({ runId: "r1", userId: USER, kind: "action" })
		_reset()
		expect(cancellation(handle)).toEqual({
			by: "system:reset",
			reason: "the run registry was reset"
		})
	})

	it("leaves somebody else's run running, and unstamped", () => {
		const handle = start({ runId: "r1", userId: USER, kind: "action" })
		expect(cancel("r1", OTHER_USER)).toEqual({
			found: true,
			allowed: false
		})
		expect(handle.controller.signal.aborted).toBe(false)
		expect(cancellation(handle)).toBeUndefined()
	})

	it("deregisters exactly once, and a late cancel is not an error", () => {
		start({ runId: "r1", userId: USER, kind: "action" })
		finish("r1")
		expect(active()).toHaveLength(0)
		expect(cancel("r1", USER)).toEqual({ found: false, allowed: true })
	})
})

/**
 * Two nodes in a row, with the cancel arriving inside the first one — the
 * shape of pressing Cancel while a provider is mid-call.
 *
 * The first binding *returns* rather than throwing, which is the case the
 * signal alone cannot cover: an adapter that notices the abort and gives back
 * what it has is a successful node, so nothing about the result says stop.
 */
const twoNodes = () =>
	compile(
		spec("test:spec/cancel-wiring", { version: "1.0.0" })
			.inlet("input", C.userMessage.v1())
			.query("first", ($) =>
				C.sessionHistory.v1({ scope: $.input.sessionScope })
			)
			.query("second", ($) =>
				C.lorebookTriggers.v1({ text: $.input.text })
			)
			.build()
	)

describe("the executor stopping between nodes", () => {
	it("does not run the node after the cancelled one", async () => {
		const ran: string[] = []
		const handle = start({ runId: "r1", userId: USER, kind: "action" })

		const receipt = await run(twoNodes(), {
			input: { text: "hello", sessionScope: { sessionId: 1 } },
			seed: "seed:cancel",
			bindings: {
				"core:inlet/user-message@1": async (i: any) => ok(i),
				"core:query/session-history@1": async () => {
					ran.push("first")
					// Mid-node, exactly as a socket handler would: the person
					// pressed Cancel while this was in flight.
					cancel("r1", USER)
					return ok({ main: "history" })
				},
				"core:query/lorebook-triggers@1": async () => {
					ran.push("second")
					return ok({ main: "lore" })
				}
			},
			cancelSignal: () => cancellation(handle)
		})

		// The claim, stated as the thing that actually costs time and tokens:
		// the next node never executed. A status alone would pass even if it had.
		expect(ran).toEqual(["first"])
		expect(receipt.nodes.map((n) => n.nodeKey)).not.toContain("second")

		// And the receipt is a receipt: an actor and a cause, not a bare failure.
		expect(receipt.outcome).toBe("cancelled")
		expect(receipt.cancelledBy).toBe(`user:${USER}`)
		expect(receipt.haltReason).toBe("the run was cancelled")
	})

	it("runs to the end when nobody cancels — the poll is not a brake", async () => {
		const ran: string[] = []
		const handle = start({ runId: "r1", userId: USER, kind: "action" })

		const receipt = await run(twoNodes(), {
			input: { text: "hello", sessionScope: { sessionId: 1 } },
			seed: "seed:cancel",
			bindings: {
				"core:inlet/user-message@1": async (i: any) => ok(i),
				"core:query/session-history@1": async () => {
					ran.push("first")
					return ok({ main: "history" })
				},
				"core:query/lorebook-triggers@1": async () => {
					ran.push("second")
					return ok({ main: "lore" })
				}
			},
			cancelSignal: () => cancellation(handle)
		})

		expect(ran).toEqual(["first", "second"])
		expect(receipt.outcome).toBe("ok")
		expect(receipt.cancelledBy).toBeUndefined()
	})
})

/**
 * The half an `AbortController` cannot reach.
 *
 * A run's adapters get the stop as an event and the executor gets it as a poll,
 * and both are projections of the one controller. An extension hook is neither:
 * it is running inside a sandbox on another thread, addressable only by name,
 * so cancelling a run left its hooks running to their own deadlines — spending
 * exactly the time and the resources the person asked back.
 *
 * The observer is the third projection, and it is notified from `stop` rather
 * than from the three callers on purpose: a stop path that forgot to tell it
 * would be the same bug again, in a corner.
 */
describe("telling the rest of the process a run stopped", () => {
	const recorder = () => {
		const stops: { runId: string; stop: RunStop }[] = []
		const finished: string[] = []
		setRunStopObserver({
			stopped: (runId, stop) => void stops.push({ runId, stop }),
			finished: (runId) => void finished.push(runId)
		})
		return { stops, finished }
	}

	it("names who and why for a person's cancel", () => {
		const seen = recorder()
		start({ runId: "r1", userId: USER, kind: "action" })
		cancel("r1", USER)
		expect(seen.stops).toEqual([
			{
				runId: "r1",
				stop: {
					by: `user:${USER}`,
					reason: "the run was cancelled",
					idReused: false
				}
			}
		])
	})

	it("flags a supersede, because the id is about to mean a different run", () => {
		const seen = recorder()
		start({ runId: "r1", userId: USER, kind: "action" })
		start({ runId: "r1", userId: USER, kind: "action" })
		// Without this flag an observer keyed on the run id would apply the
		// stale run's stop to the replacement's work — a re-send cancelling
		// itself.
		expect(seen.stops).toHaveLength(1)
		expect(seen.stops[0].stop).toMatchObject({
			by: "system:superseded",
			idReused: true
		})
	})

	it("reports a reset, and reports a finish", () => {
		const seen = recorder()
		start({ runId: "r1", userId: USER, kind: "action" })
		_reset()
		expect(seen.stops[0].stop.by).toBe("system:reset")

		start({ runId: "r2", userId: USER, kind: "action" })
		finish("r2")
		expect(seen.finished).toEqual(["r2"])
	})

	it("is not told about a cancel it was not allowed to make", () => {
		const seen = recorder()
		start({ runId: "r1", userId: USER, kind: "action" })
		cancel("r1", OTHER_USER)
		expect(seen.stops).toEqual([])
	})

	it("cannot break the stop by throwing", () => {
		setRunStopObserver({
			stopped: () => {
				throw new Error("observer is broken")
			},
			finished: () => {
				throw new Error("observer is broken")
			}
		})
		const handle = start({ runId: "r1", userId: USER, kind: "action" })
		expect(() => cancel("r1", USER)).not.toThrow()
		// The run is still stopped, and still says who stopped it: a listener
		// is a listener, not a participant.
		expect(handle.controller.signal.aborted).toBe(true)
		expect(cancellation(handle)?.by).toBe(`user:${USER}`)
		expect(() => finish("r1")).not.toThrow()
	})

	it("goes quiet when it is unwired", () => {
		const seen = recorder()
		setRunStopObserver(null)
		start({ runId: "r1", userId: USER, kind: "action" })
		cancel("r1", USER)
		finish("r1")
		expect(seen.stops).toEqual([])
		expect(seen.finished).toEqual([])
	})
})

describe("a message's Stop stops what the released rows were about — and only that", () => {
	// A guest's Stop on a reply used to abort the owner's image render or
	// summary in the same session: `cancelSession` matched on the session
	// alone. It matches on the rows now.
	const SESSION = 3

	it("stops a reply whose row was released, by the row", () => {
		const reply = start({
			runId: "reply",
			userId: USER,
			sessionId: SESSION,
			kind: "reply",
			liveRow: 41
		})
		expect(cancelSession(SESSION, `user:${OTHER_USER}`, [41])).toBe(1)
		expect(reply.controller.signal.aborted).toBe(true)
		expect(cancellation(reply)?.by).toBe(`user:${OTHER_USER}`)
	})

	it("a concurrent action in the session survives a Stop on a message it is not filling", () => {
		const reply = start({
			runId: "reply",
			userId: USER,
			sessionId: SESSION,
			kind: "reply",
			liveRow: 41
		})
		const render = start({
			runId: "render",
			userId: OTHER_USER,
			sessionId: SESSION,
			kind: "action"
		})
		const summary = start({
			runId: "summary",
			userId: OTHER_USER,
			sessionId: SESSION,
			kind: "action",
			liveRow: 99
		})
		expect(cancelSession(SESSION, `user:${USER}`, [41])).toBe(1)
		expect(reply.controller.signal.aborted).toBe(true)
		expect(render.controller.signal.aborted).toBe(false)
		expect(summary.controller.signal.aborted).toBe(false)
	})

	it("an action IS stopped when the row it fills is among the released", () => {
		const post = start({
			runId: "post",
			userId: OTHER_USER,
			sessionId: SESSION,
			kind: "action",
			liveRow: 99
		})
		expect(cancelSession(SESSION, `user:${USER}`, [41, 99])).toBe(1)
		expect(post.controller.signal.aborted).toBe(true)
	})

	it("a reply that has not made its row yet is stopped — the only thing a Stop can mean for it", () => {
		const fresh = start({
			runId: "fresh",
			userId: USER,
			sessionId: SESSION,
			kind: "reply"
		})
		expect(cancelSession(SESSION, `user:${USER}`, [41])).toBe(1)
		expect(fresh.controller.signal.aborted).toBe(true)
	})

	it("the row a fresh reply opens is learned from the live row, and matched from then on", () => {
		const fresh = start({
			runId: "fresh",
			userId: USER,
			sessionId: SESSION,
			kind: "reply"
		})
		setLiveRow("fresh", 41)
		// A Stop on some OTHER stuck row no longer reaches it…
		expect(cancelSession(SESSION, `user:${USER}`, [12])).toBe(0)
		expect(fresh.controller.signal.aborted).toBe(false)
		// …and a Stop on its own row does.
		expect(cancelSession(SESSION, `user:${USER}`, [41])).toBe(1)
		expect(fresh.controller.signal.aborted).toBe(true)
	})

	it("another session's runs are never touched", () => {
		const elsewhere = start({
			runId: "elsewhere",
			userId: USER,
			sessionId: SESSION + 1,
			kind: "reply",
			liveRow: 41
		})
		expect(cancelSession(SESSION, `user:${USER}`, [41])).toBe(0)
		expect(elsewhere.controller.signal.aborted).toBe(false)
	})
})
