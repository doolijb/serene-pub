/**
 * 🚧 `routine-log` (A7, R23; lane 7): the page's session's routine runs, as
 * the server's `sessions:routineLog` answers; a bad ask and a refusal are
 * the widget's own error. Core's widgets only.
 */
import { describe, expect, test } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import { answerRoutineLog } from "./routineLog"

const ENTRY = {
	runId: "r1",
	registrationKey: "every-n-turns→story-sweep",
	pipeline: "core:spec/story-sweep",
	name: "Look back over the story",
	kind: "ran" as const,
	startedAt: 1,
	endedAt: 2,
	wrote: []
}

describe("routine-log", () => {
	test("asks for the page's session, and answers with the log", async () => {
		const asked: unknown[] = []
		const res = await answerRoutineLog({ limit: 20 }, 7, async (ask) => {
			asked.push(ask)
			return { sessionId: 7, lastInteractionAt: 5, entries: [ENTRY] }
		})
		expect(asked).toEqual([{ sessionId: 7, limit: 20 }])
		expect(res).toEqual({ lastInteractionAt: 5, entries: [ENTRY] })
	})

	test("a bad ask, no session, or a refusal is the widget's error", async () => {
		const read = async () => ({ sessionId: 7, lastInteractionAt: null, entries: [], error: "Session not found." })
		await expect(answerRoutineLog({ limit: 0 }, 7, read)).rejects.toThrow(/limit/)
		await expect(answerRoutineLog({}, null, read)).rejects.toThrow(/no session/)
		await expect(answerRoutineLog({}, 7, read)).rejects.toThrow("Session not found.")
	})

	test("core's widgets ask it", () => {
		expect(WIDGET_REQUEST_ASKERS["routine-log"]).toBe("core")
	})
})
