/** The turn line's list and the re-run sentence, projected from the store's runs and the summaries. */
import { describe, expect, test } from "vitest"
import {
	rerunWaitsForOf,
	runsInProgressOf,
	summaryRunsOf
} from "./sessionPageProjections"
import type { SessionRunRecord } from "$lib/client/sessions/store/records"

const st = { i18n: { en: "Working" } } as SessionRunRecord["status"]
const run = (over: Partial<SessionRunRecord>): SessionRunRecord => ({
	sessionId: 1,
	runId: "r",
	kind: "action",
	status: st,
	...over
})
const words = {
	statusOf: () => "Working",
	speakerOf: (id: number) => (id === 9 ? "Wren" : undefined)
}

describe("runsInProgressOf", () => {
	test("lists registered actions and routines; never a reply, a line-bound run or an unregistered action", () => {
		const out = runsInProgressOf(
			[
				run({ runId: "a", name: "Rest", since: 5, mayStop: true, readsMessageId: 9 }),
				run({ runId: "b", kind: "routine", routine: { name: "Recap" } }),
				run({ runId: "c", kind: "reply", name: "the reply", since: 1 }),
				run({ runId: "d", lineBound: true, name: "Speak", since: 1 }),
				run({ runId: "e", name: "Nameless-registration" }),
				run({ runId: "f", name: "Gate", since: 2, parked: true })
			],
			words,
			[]
		)
		expect(out).toEqual([
			{ id: "a", kind: "action", name: "Rest", status: "Working", since: 5, readsReplyOf: "Wren", mayStop: true },
			{ id: "b", kind: "routine", name: "Recap", status: "Working", mayStop: false },
			{ id: "f", kind: "action", name: "Gate", status: "Working", since: 2, parked: true, mayStop: false }
		])
	})

	test("the reader is omitted when the line is not loaded; summaries follow the runs", () => {
		const sum = { id: "s1", kind: "summary" as const, name: "Summarizing the session", mayStop: true }
		const out = runsInProgressOf([run({ runId: "a", name: "Rest", since: 5, readsMessageId: 44 })], words, [sum])
		expect(out[0]).not.toHaveProperty("readsReplyOf")
		expect(out[1]).toEqual(sum)
	})
})

describe("a holding run with only the working status", () => {
	const working = { i18n: { en: "working" } } as SessionRunRecord["status"]
	test("is listed as working and greys the re-run actions", () => {
		const runs = [run({ runId: "w", name: "Rest", since: 5, status: working, mayStop: true })]
		expect(runsInProgressOf(runs, { ...words, statusOf: () => "working" }, [])).toEqual([
			{ id: "w", kind: "action", name: "Rest", status: "working", since: 5, mayStop: true }
		])
		expect(rerunWaitsForOf(runs)).toBe("Wait for Rest to finish, or stop it first.")
	})
})

describe("summaryRunsOf", () => {
	test("this session's running summaries, Stop only where the viewer's own (or an admin's)", () => {
		const base = {
			sessionId: 1,
			scenes: [{ id: 5, name: "The gate" }, { id: 6, name: null }],
			sceneActivities: [
				{ activityId: "a", userId: 1, sceneId: 5, status: "running", startedAt: "2026-11-16T10:00:00Z" },
				{ activityId: "b", userId: 2, sceneId: 6, status: "running", startedAt: "2026-11-16T10:00:00Z" },
				{ activityId: "c", userId: 1, sceneId: 99, status: "running", startedAt: "2026-11-16T10:00:00Z" },
				{ activityId: "d", userId: 1, sceneId: 5, status: "review", startedAt: "2026-11-16T10:00:00Z" }
			],
			sessionActivities: [
				{ activityId: "e", userId: 1, sessionId: 1, status: "running", startedAt: "bad" },
				{ activityId: "f", userId: 1, sessionId: 2, status: "running", startedAt: "2026-11-16T10:00:00Z" }
			]
		}
		const member = summaryRunsOf({ ...base, viewer: { id: 1, isAdmin: false } })
		expect(member.map((r) => [r.id, r.name, r.mayStop])).toEqual([
			["a", "Summarizing The gate", true],
			["b", "Summarizing a scene", false],
			["e", "Summarizing the session", true]
		])
		expect(member[0]!.since).toBe(Date.parse("2026-11-16T10:00:00Z"))
		expect(member[2]).not.toHaveProperty("since")
		expect(summaryRunsOf({ ...base, viewer: { id: 7, isAdmin: true } }).every((r) => r.mayStop)).toBe(true)
	})
})

describe("rerunWaitsForOf", () => {
	test("names the first run that holds re-runs; a parked, line-bound or unregistered run holds none", () => {
		expect(rerunWaitsForOf([])).toBeUndefined()
		expect(
			rerunWaitsForOf([
				run({ runId: "p", name: "Gate", since: 1, parked: true }),
				run({ runId: "l", name: "Speak", since: 1, lineBound: true }),
				run({ runId: "u", name: "Nope" })
			])
		).toBeUndefined()
		expect(rerunWaitsForOf([run({ name: "Rest", since: 1 })])).toBe("Wait for Rest to finish, or stop it first.")
		expect(rerunWaitsForOf([run({ kind: "reply", since: 1 })])).toBe("Wait for the reply to finish, or stop it first.")
		expect(rerunWaitsForOf([run({ kind: "routine", routine: { name: "Recap" }, since: 1 })])).toBe(
			"Wait for Recap to finish, or stop it first."
		)
	})
})
