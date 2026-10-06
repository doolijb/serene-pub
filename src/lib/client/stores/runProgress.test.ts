/**
 * The run-progress store's merge and its memory of what just ended.
 *
 * Two subscribers take the same frames off the wire — the session page and
 * the progress card both `apply` them — so whichever runs first deletes the
 * run on its terminal frame. The card then read the store at its own turn,
 * found nothing, and titled the receipt "Working" (2026-09-17: the Adventure
 * Ask road's card). What is pinned: a terminal frame with no label keeps the
 * started frame's; the same terminal frame applied twice keeps it too; the
 * session's `lastFinished` follows the most recent terminal frame; a new
 * run in the session clears it; and the outcome/reason the card draws ride
 * the kept frame.
 */
import { beforeEach, describe, expect, test } from "vitest"
import { runProgress } from "./runProgress.svelte"

const SESSION = 42

beforeEach(() => runProgress.clearAll())

describe("runProgress", () => {
	test("a terminal frame with no label keeps the started frame's label", () => {
		runProgress.started({ runId: "r1", sessionId: SESSION, label: "ask" })
		runProgress.apply({
			runId: "r1",
			nodeKey: "write",
			status: { i18n: { en: "thinking" } }
		})
		runProgress.apply({
			runId: "r1",
			sessionId: SESSION,
			done: true,
			outcome: "ok"
		})

		expect(runProgress.get("r1")).toBeUndefined()
		expect(runProgress.forSession(SESSION)).toEqual([])
		expect(runProgress.lastFinished(SESSION)).toMatchObject({
			runId: "r1",
			label: "ask",
			outcome: "ok",
			done: true
		})
	})

	test("the same terminal frame applied twice — by two subscribers — still keeps the label", () => {
		runProgress.started({ runId: "r1", sessionId: SESSION, label: "ask" })
		const terminal = {
			runId: "r1",
			sessionId: SESSION,
			done: true,
			outcome: "ok" as const
		}
		runProgress.apply(terminal)
		runProgress.apply(terminal)
		expect(runProgress.lastFinished(SESSION)).toMatchObject({
			runId: "r1",
			label: "ask"
		})
	})

	test("a terminal frame that carries its own label wins", () => {
		runProgress.started({ runId: "r1", sessionId: SESSION, label: "ask" })
		runProgress.apply({
			runId: "r1",
			sessionId: SESSION,
			done: true,
			outcome: "ok",
			label: "respond"
		})
		expect(runProgress.lastFinished(SESSION)?.label).toBe("respond")
	})

	test("lastFinished follows the most recent terminal frame, per session", () => {
		runProgress.started({ runId: "a", sessionId: SESSION, label: "ask" })
		runProgress.started({ runId: "b", sessionId: SESSION, label: "answer" })
		runProgress.started({
			runId: "elsewhere",
			sessionId: 7,
			label: "respond"
		})
		runProgress.apply({
			runId: "a",
			sessionId: SESSION,
			done: true,
			outcome: "ok"
		})
		expect(runProgress.lastFinished(SESSION)?.runId).toBe("a")
		runProgress.apply({
			runId: "b",
			sessionId: SESSION,
			done: true,
			outcome: "halt",
			haltNodeKey: "save",
			error: "no option"
		})
		expect(runProgress.lastFinished(SESSION)).toMatchObject({
			runId: "b",
			label: "answer",
			outcome: "halt",
			haltNodeKey: "save",
			error: "no option"
		})
		// The other session's run is untouched, in flight and unfinished.
		expect(runProgress.lastFinished(7)).toBeUndefined()
		expect(runProgress.forSession(7).map((r) => r.runId)).toEqual([
			"elsewhere"
		])
	})

	test("a terminal frame naming no session is keyed by the session the run started in", () => {
		runProgress.started({ runId: "r1", sessionId: SESSION, label: "ask" })
		runProgress.apply({ runId: "r1", done: true, outcome: "ok" })
		expect(runProgress.lastFinished(SESSION)).toMatchObject({
			runId: "r1",
			sessionId: SESSION
		})
	})

	test("a new run in the session clears what last ended there; dismiss and clearAll do too", () => {
		runProgress.started({ runId: "r1", sessionId: SESSION, label: "ask" })
		runProgress.apply({
			runId: "r1",
			sessionId: SESSION,
			done: true,
			outcome: "ok"
		})
		expect(runProgress.lastFinished(SESSION)).toBeDefined()
		runProgress.started({ runId: "r2", sessionId: SESSION, label: "ask" })
		expect(runProgress.lastFinished(SESSION)).toBeUndefined()
		runProgress.apply({
			runId: "r2",
			sessionId: SESSION,
			done: true,
			outcome: "ok"
		})
		runProgress.dismissFinished(SESSION)
		expect(runProgress.lastFinished(SESSION)).toBeUndefined()
		runProgress.apply({
			runId: "r2",
			sessionId: SESSION,
			done: true,
			outcome: "ok"
		})
		runProgress.clearAll()
		expect(runProgress.lastFinished(SESSION)).toBeUndefined()
	})

	test("what is kept of a finished run carries no preview and no status", () => {
		runProgress.started({ runId: "r1", sessionId: SESSION, label: "ask" })
		runProgress.apply({
			runId: "r1",
			status: { i18n: { en: "thinking" } },
			preview: { base64: "AAAA", mime: "image/png" }
		})
		runProgress.apply({
			runId: "r1",
			sessionId: SESSION,
			done: true,
			outcome: "ok"
		})
		const kept = runProgress.lastFinished(SESSION)!
		expect(kept).toMatchObject({ runId: "r1", label: "ask", outcome: "ok" })
		expect("preview" in kept).toBe(false)
		expect("status" in kept).toBe(false)
	})

	test("a non-terminal frame merges onto the run rather than replacing it", () => {
		runProgress.started({
			runId: "r1",
			sessionId: SESSION,
			label: "ask",
			steps: 3
		})
		runProgress.apply({
			runId: "r1",
			stage: "Answer a form",
			status: null
		})
		expect(runProgress.get("r1")).toMatchObject({
			sessionId: SESSION,
			label: "ask",
			steps: 3,
			stage: "Answer a form",
			status: null
		})
	})
})
