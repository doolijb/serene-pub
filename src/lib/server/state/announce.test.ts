/**
 * 🚧 What counts as the state moving (the 100-turn walk, B10: a Planner-lane
 * edit wrote the sheet through the ruleset handler alone, and the sheet stayed
 * stale until a reload).
 */
import { describe, expect, test } from "vitest"
import { stateMoved } from "./announce"

const receipt = (nodes: Array<{ definitionId: string; output: unknown }>) => ({ nodes }) as any

describe("stateMoved", () => {
	test("a ruleset apply that wrote, or filed a proposal, moved the state", () => {
		expect(stateMoved(receipt([{ definitionId: "core:task/ruleset-resolve@1", output: { facts: { applied: [{ id: 1 }] }, rejected: [] } }]))).toBe(true)
		expect(stateMoved(receipt([{ definitionId: "core:task/ruleset-resolve@1", output: { facts: { proposed: [{ id: 2 }] }, rejected: [] } }]))).toBe(true)
		expect(stateMoved(receipt([{ definitionId: "core:task/ruleset-resolve@1", output: { facts: {}, rejected: [{ proposalId: 7 }] } }]))).toBe(true)
	})
	test("a resolve that read only, or refused without filing, did not", () => {
		expect(stateMoved(receipt([{ definitionId: "core:task/ruleset-resolve@1", output: { facts: { rigour: "scripts" }, rejected: [] } }]))).toBe(false)
		expect(stateMoved(receipt([{ definitionId: "core:task/ruleset-resolve@1", output: { facts: {}, rejected: [{ proposalId: null }] } }]))).toBe(false)
	})
	test("a seat named moved the state (the sheet's head reads its name)", () => {
		expect(stateMoved(receipt([{ definitionId: "core:outlet/set-seat-name@1", output: { status: "committed", seat: "player-seat:4" } }]))).toBe(true)
	})
})
