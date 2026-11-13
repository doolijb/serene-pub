import { describe, expect, test } from "vitest"
import {
	answerSessionScenario,
	answerSetSessionScenario
} from "./sessionScenario"

const owner = () => ({ scenario: "A dark inn.", canEdit: true })

describe("session-scenario", () => {
	test("reads the page's scenario", () => {
		expect(answerSessionScenario({ readScenario: owner })).toEqual({
			scenario: "A dark inn.",
			canEdit: true
		})
	})
	test("refuses in words with no reader or no session", () => {
		expect(() => answerSessionScenario({})).toThrow(
			"this page can't read the session's scenario"
		)
		expect(() =>
			answerSessionScenario({ readScenario: () => null })
		).toThrow("this page has no session")
	})
})

describe("set-session-scenario", () => {
	test("writes with the id and scenario, and answers optimistically", () => {
		const writes: Array<[number, string]> = []
		const out = answerSetSessionScenario({ scenario: "New." }, 7, {
			readScenario: owner,
			writeScenario: (id, s) => writes.push([id, s])
		})
		expect(writes).toEqual([[7, "New."]])
		expect(out).toEqual({ scenario: "New.", canEdit: true })
	})
	test("refuses in words", () => {
		const writes: unknown[] = []
		const deps = {
			readScenario: owner,
			writeScenario: (...a: unknown[]) => writes.push(a)
		}
		expect(() =>
			answerSetSessionScenario({ scenario: "x" }, 1, {})
		).toThrow("can't read")
		expect(() =>
			answerSetSessionScenario({ scenario: "x" }, 1, {
				readScenario: () => null
			})
		).toThrow("no session")
		expect(() =>
			answerSetSessionScenario({ scenario: "x" }, null, deps)
		).toThrow("no session")
		expect(() =>
			answerSetSessionScenario({ scenario: 3 }, 1, deps)
		).toThrow("set-session-scenario takes the scenario as text")
		expect(() =>
			answerSetSessionScenario({ scenario: "x".repeat(20001) }, 1, deps)
		).toThrow("A scenario is at most 20000 characters.")
		expect(() =>
			answerSetSessionScenario({ scenario: "x" }, 1, {
				...deps,
				readScenario: () => ({ scenario: "", canEdit: false })
			})
		).toThrow("Only the session's owner can change the scenario.")
		expect(writes).toEqual([])
	})
})
