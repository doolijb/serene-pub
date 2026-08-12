import { describe, expect, test } from "vitest"
import {
	buildTimelineAxis,
	compareEntries,
	countUndated,
	formatEntryLabel,
	nodesAsOf,
	relationshipsAsOf,
	type TimelineEntry
} from "./graphTimeline"

const e = (
	id: number,
	year: number,
	month?: number,
	day?: number
): TimelineEntry => ({
	id,
	year,
	month: month ?? null,
	day: day ?? null
})

const byId = (entries: TimelineEntry[]) =>
	new Map(entries.map((x) => [x.id, x]))

describe("ordering", () => {
	test("sorts by year, then month, then day", () => {
		const axis = buildTimelineAxis([
			e(1, 217, 11, 6),
			e(2, 215),
			e(3, 217, 11, 1)
		])
		expect(axis.map((x) => x.id)).toEqual([2, 3, 1])
	})

	test("a year-only entry precedes a dated one in the same year", () => {
		// "sometime in 217" reads as before "217, month 3".
		expect(compareEntries(e(1, 217), e(2, 217, 3))).toBeLessThan(0)
	})

	test("identical dates still order deterministically", () => {
		expect(compareEntries(e(1, 217, 5, 2), e(2, 217, 5, 2))).toBeLessThan(0)
		expect(
			compareEntries(e(2, 217, 5, 2), e(1, 217, 5, 2))
		).toBeGreaterThan(0)
	})

	test("labels omit the parts that are not set", () => {
		expect(formatEntryLabel(e(1, 217))).toBe("Year 217")
		expect(formatEntryLabel(e(1, 217, 11, 6))).toBe(
			"Year 217, Month 11, Day 6"
		)
	})
})

describe("relationshipsAsOf", () => {
	const entries = [e(10, 215), e(20, 217, 11, 1), e(30, 217, 11, 6)]
	const map = byId(entries)
	const rels = [
		{ historyEntryId: 10, fromNodeId: 1, toNodeId: 2 },
		{ historyEntryId: 20, fromNodeId: 2, toNodeId: 3 },
		{ historyEntryId: 30, fromNodeId: 3, toNodeId: 4 },
		{ historyEntryId: null, fromNodeId: 5, toNodeId: 6 }
	]

	test("no cutoff shows everything, undated included", () => {
		expect(relationshipsAsOf(rels, null, map)).toHaveLength(4)
	})

	test("is cumulative and inclusive of the cutoff itself", () => {
		const asOf = relationshipsAsOf(rels, e(20, 217, 11, 1), map)
		expect(asOf.map((r) => r.historyEntryId)).toEqual([10, 20])
	})

	test("the earliest point shows only what existed then", () => {
		expect(
			relationshipsAsOf(rels, e(10, 215), map).map(
				(r) => r.historyEntryId
			)
		).toEqual([10])
	})

	test("undated relationships drop out once a cutoff is active", () => {
		const asOf = relationshipsAsOf(rels, e(30, 217, 11, 6), map)
		expect(asOf).toHaveLength(3)
		expect(asOf.some((r) => r.historyEntryId === null)).toBe(false)
		expect(countUndated(rels)).toBe(1)
	})

	test("a relationship pointing at a missing entry is dropped, not shown", () => {
		const orphan = [{ historyEntryId: 999, fromNodeId: 1, toNodeId: 2 }]
		expect(relationshipsAsOf(orphan, e(30, 217, 11, 6), map)).toHaveLength(
			0
		)
	})
})

describe("nodesAsOf", () => {
	const nodes = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 99 }]

	test("no cutoff keeps every node, isolated ones included", () => {
		expect(nodesAsOf(nodes, [], null)).toHaveLength(4)
	})

	test("with a cutoff, only nodes touching a visible relationship remain", () => {
		const visible = [{ historyEntryId: 10, fromNodeId: 1, toNodeId: 2 }]
		expect(
			nodesAsOf(nodes, visible, {
				id: 10,
				year: 215,
				month: null,
				day: null
			}).map((n) => n.id)
		).toEqual([1, 2])
	})
})
