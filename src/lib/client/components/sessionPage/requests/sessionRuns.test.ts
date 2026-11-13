import { describe, expect, test, vi } from "vitest"
import { WIDGET_REQUEST_ASKERS } from "@serene-pub/sdk"
import {
	answerSessionRuns,
	answerSessionRunSteps,
	sessionRunOf,
	sessionRunStepsOf,
	type SessionRunsDeps
} from "./sessionRuns"

const row = (over: Record<string, unknown> = {}): any => ({
	id: 1,
	runId: "r1",
	specSlug: "story-respond",
	specVersion: "1.0.0",
	specHash: null,
	specHashIsCurrent: true,
	specHashRenamedAt: null,
	userId: 7,
	username: "ann",
	outcome: "halt",
	haltNodeKey: "n1",
	haltReason: "because",
	elapsedMs: 1500,
	tokensSpent: 42,
	isPreview: false,
	artifacts: [],
	sessionId: 3,
	startedAt: "2026-11-06T10:00:00.000Z",
	triggerFamily: "routine",
	registrationKey: "k→s",
	triggerSource: "schedule",
	endedAt: "2026-11-06T10:00:02.000Z",
	parentRunId: "p0",
	depth: 2,
	...over
})

const deps = (over: Partial<SessionRunsDeps> = {}): SessionRunsDeps => ({
	isAdmin: true,
	sessionId: 3,
	contextDebugging: true,
	findMessage: () => undefined,
	read: vi.fn(async () => ({ runs: [] })),
	...over
})

describe("answerSessionRuns", () => {
	test("a non-admin is refused and nothing is read", async () => {
		const d = deps({ isAdmin: false })
		await expect(answerSessionRuns({}, d)).rejects.toThrow("runs are for admins")
		expect(d.read).not.toHaveBeenCalled()
	})

	test("limit: default 25, clamped to 100, bad refused", async () => {
		const d = deps()
		await answerSessionRuns({}, d)
		expect(d.read).toHaveBeenLastCalledWith({ sessionId: 3, limit: 25 })
		await answerSessionRuns({ limit: 500 }, d)
		expect(d.read).toHaveBeenLastCalledWith({ sessionId: 3, limit: 100 })
		await answerSessionRuns({ limit: 10 }, d)
		expect(d.read).toHaveBeenLastCalledWith({ sessionId: 3, limit: 10 })
		for (const limit of [0, 1.5, "3" as any, NaN])
			await expect(answerSessionRuns({ limit }, d)).rejects.toThrow(/whole number of runs/)
	})

	test("no session is refused", async () => {
		const d = deps({ sessionId: null })
		await expect(answerSessionRuns({}, d)).rejects.toThrow("this page has no session open")
		expect(d.read).not.toHaveBeenCalled()
	})

	test("a reply's error is thrown", async () => {
		const d = deps({ read: async () => ({ runs: [], error: "nope" }) as any })
		await expect(answerSessionRuns({}, d)).rejects.toThrow("nope")
	})

	test("maps a row, every field", () => {
		expect(sessionRunOf(row(), 9)).toEqual({
			runId: "r1",
			pipeline: "story-respond",
			outcome: "halt",
			triggerFamily: "routine",
			registrationKey: "k→s",
			triggerSource: "schedule",
			userId: 7,
			username: "ann",
			startedAt: Date.parse("2026-11-06T10:00:00.000Z"),
			endedAt: Date.parse("2026-11-06T10:00:02.000Z"),
			elapsedMs: 1500,
			tokens: 42,
			haltNodeKey: "n1",
			haltReason: "because",
			isPreview: false,
			parentRunId: "p0",
			depth: 2,
			promptMessageId: 9
		})
		const bare = sessionRunOf(row({ username: undefined, userId: null, triggerFamily: null }), null)
		expect(bare.username).toBeNull()
		expect(bare.userId).toBeNull()
		expect(bare.triggerFamily).toBeNull()
	})

	test("promptMessageId needs context debugging and a line with debugMeta", async () => {
		const runs = [
			row({
				artifacts: [
					{ kind: "file", entityId: 1, action: "created" },
					{ kind: "message", entityId: 10, action: "created" },
					{ kind: "message", entityId: 11, action: "created" }
				]
			})
		]
		const find = (id: number) => (id === 11 ? { id, debugMeta: { a: 1 } } : id === 10 ? { id } : undefined)
		const on = await answerSessionRuns({}, deps({ read: async () => ({ runs }) as any, findMessage: find }))
		expect(on.runs[0].promptMessageId).toBe(11)
		const off = await answerSessionRuns(
			{},
			deps({ read: async () => ({ runs }) as any, findMessage: find, contextDebugging: false })
		)
		expect(off.runs[0].promptMessageId).toBeNull()
		const unloaded = await answerSessionRuns({}, deps({ read: async () => ({ runs }) as any }))
		expect(unloaded.runs[0].promptMessageId).toBeNull()
	})
})

describe("answerSessionRunSteps", () => {
	test("a non-admin is refused and nothing is read", async () => {
		const read = vi.fn()
		await expect(answerSessionRunSteps({ runId: "r" }, { isAdmin: false, read })).rejects.toThrow("runs are for admins")
		expect(read).not.toHaveBeenCalled()
	})

	test("needs a runId", async () => {
		const read = vi.fn()
		for (const p of [{}, { runId: "" }, { runId: 3 }] as any[])
			await expect(answerSessionRunSteps(p, { isAdmin: true, read })).rejects.toThrow("session-run-steps names a runId")
		expect(read).not.toHaveBeenCalled()
	})

	test("an error or a missing run is thrown", async () => {
		await expect(
			answerSessionRunSteps({ runId: "r" }, { isAdmin: true, read: async () => ({ error: "bad" }) as any })
		).rejects.toThrow("bad")
		await expect(
			answerSessionRunSteps({ runId: "r" }, { isAdmin: true, read: async () => ({}) as any })
		).rejects.toThrow("no such run")
	})

	test("steps are mapped from the receipt, sorted, iteration in the label", async () => {
		const receipt = {
			nodes: [
				{ seq: 2, nodeKey: "b", kind: "oracle", result: "halt", reason: "why", elapsedMs: 5, tokens: 9 },
				{ seq: 1, nodeKey: "a", iteration: 0, kind: "gate", result: "ok", elapsedMs: 1 }
			]
		}
		const out = await answerSessionRunSteps(
			{ runId: "r" },
			{ isAdmin: true, read: async () => ({ run: { receipt } }) as any }
		)
		expect(out.steps).toEqual([
			{ seq: 1, key: "a [0]", kind: "gate", result: "ok", reason: null, elapsedMs: 1, tokens: null },
			{ seq: 2, key: "b", kind: "oracle", result: "halt", reason: "why", elapsedMs: 5, tokens: 9 }
		])
		expect(sessionRunStepsOf(null)).toEqual([])
	})
})

describe("the askers", () => {
	test("both are core's", () => {
		expect(WIDGET_REQUEST_ASKERS["session-runs" as keyof typeof WIDGET_REQUEST_ASKERS]).toBe("core")
		expect(WIDGET_REQUEST_ASKERS["session-run-steps" as keyof typeof WIDGET_REQUEST_ASKERS]).toBe("core")
	})
})
