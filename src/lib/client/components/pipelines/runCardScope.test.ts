/**
 * The progress card's scope (walkthrough 2026-10-15): a channel's copy draws
 * its own channel's runs, and a receipt yields to the next row there.
 */
import { describe, expect, test } from "vitest"
import { newestRowIdOn, receiptStands, runIsOnChannel } from "./runCardScope"

describe("which runs a channel's progress card shows", () => {
	test("a run on its own channel, by slug and lane", () => {
		expect(runIsOnChannel({ channel: "planner" }, "planner")).toBe(true)
		expect(runIsOnChannel({ channel: "planner:1" }, "planner")).toBe(true)
		expect(runIsOnChannel({ channel: "planner" }, "main")).toBe(false)
		expect(runIsOnChannel({ channel: "planner:2" }, "planner")).toBe(false)
	})
	test("a run that names no channel is the main copy's alone", () => {
		expect(runIsOnChannel({}, "main")).toBe(true)
		expect(runIsOnChannel({}, "planner")).toBe(false)
	})
	test("a card told no channel shows every run", () => {
		expect(runIsOnChannel({ channel: "planner" }, undefined)).toBe(true)
	})
})

describe("a finished run's receipt", () => {
	const rows = [
		{ id: 4, channel: "main" },
		{ id: 5, channel: "planner" },
		{ id: 6, channel: null }
	]
	test("the newest row is read per channel; a null channel is main", () => {
		expect(newestRowIdOn(rows, "main")).toBe(6)
		expect(newestRowIdOn(rows, "planner")).toBe(5)
		expect(newestRowIdOn(rows, "parley")).toBe(0)
		expect(newestRowIdOn(rows, undefined)).toBe(6)
	})
	test("a failure stands until a newer row lands on its channel", () => {
		const seen = { runId: "r1", newestRowId: 6 }
		const r1 = { runId: "r1", outcome: "err" } as const
		expect(receiptStands(r1, seen, 6)).toBe(true)
		expect(receiptStands(r1, seen, 7)).toBe(false)
		// Another run's receipt has not been sighted yet: it stands.
		expect(receiptStands({ runId: "r2", outcome: "halt" }, seen, 9)).toBe(true)
		expect(receiptStands(r1, null, 9)).toBe(true)
	})
	test("a run that ended ok has no receipt: its row is the answer", () => {
		expect(receiptStands({ runId: "r1", outcome: "ok" }, null, 0)).toBe(false)
		expect(receiptStands({ runId: "r1" }, null, 0)).toBe(false)
	})
	test("a run the card never saw in flight has no receipt", () => {
		expect(receiptStands({ runId: "r1", outcome: "err" }, null, 0, false)).toBe(false)
	})
})
