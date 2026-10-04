/**
 * Edges read as of a moment.
 *
 * An edge is dated by the history entry that established it, so the moment is
 * a question about that entry's date. An edge nothing dates makes no claim
 * about when, and is in the story at every moment.
 */
import { describe, expect, it } from "vitest"
import {
	edgeDate,
	edgesAtMoment,
	edgesOnLine,
	laterLabel,
	splitByMoment
} from "./asOf"
import {
	MAIN_LINE,
	lineOf,
	type LineBranch
} from "$lib/shared/lorebooks/lineReading"

const entries = [
	{ id: 1, year: 1, month: null, day: null },
	{ id: 2, year: 3, month: 2, day: 12 }
]

const edge = (id: number, historyEntryId: number | null) => ({
	id,
	historyEntryId
})

describe("edgeDate — when an edge happened", () => {
	it("reads the date off the history entry that established it", () => {
		expect(edgeDate(edge(10, 2), entries)).toEqual({ year: 3, month: 2, day: 12 })
	})

	it("has no date for an edge nothing dates", () => {
		expect(edgeDate(edge(10, null), entries)).toBeNull()
	})

	it("has no date for an edge whose entry is not loaded", () => {
		expect(edgeDate(edge(10, 99), entries)).toBeNull()
	})
})

describe("edgesAtMoment — the web as it stood then", () => {
	const edges = [edge(10, 1), edge(11, 2), edge(12, null)]

	it("keeps every edge at now", () => {
		expect(
			edgesAtMoment(edges, undefined, entries).map((e) => e.id)
		).toEqual([10, 11, 12])
	})

	it("holds back an edge established after the moment", () => {
		expect(edgesAtMoment(edges, "Y2", entries).map((e) => e.id)).toEqual([
			10, 12
		])
	})

	it("keeps an edge established exactly at the moment", () => {
		expect(
			edgesAtMoment(edges, "Y3-2-12", entries).map((e) => e.id)
		).toEqual([10, 11, 12])
	})
})

describe("splitByMoment — what has happened, and what is still to come", () => {
	const edges = [edge(10, 1), edge(11, 2), edge(12, null)]

	it("says which edges are later, and when each of them lands", () => {
		const split = splitByMoment(edges, "Y2", entries)
		expect(split.inStory.map((e) => e.id)).toEqual([10, 12])
		expect(split.later.map((e) => e.id)).toEqual([11])
	})

	it("has nothing later at now", () => {
		expect(splitByMoment(edges, undefined, entries).later).toEqual([])
	})
})

describe("laterLabel — the date an edge is waiting on", () => {
	it("names the date and says it has not happened yet", () => {
		expect(laterLabel(edge(11, 2), entries)).toBe("Y3-2-12 · later")
	})

	it("names nothing for an edge with no date", () => {
		expect(laterLabel(edge(12, null), entries)).toBe("later")
	})
})

describe("ordered by compareDates, never the packed value", () => {
	// Packed (year×10000 + month×100 + day), Y3 Mo.1 Day 250 is 30350 and
	// Y3 Mo.3 Day 40 is 30340 — the packed form puts the earlier date later.
	const days = [
		{ id: 5, year: 3, month: 1, day: 250 },
		{ id: 6, year: 3, month: 3, day: 1 }
	]

	it("keeps a day-250 edge in the story at a later month", () => {
		expect(
			edgesAtMoment([edge(1, 5)], "Y3-3-40", days).map((e) => e.id)
		).toEqual([1])
	})

	it("keeps an edge dated at a later month out, whatever the moment's day", () => {
		const split = splitByMoment([edge(1, 6)], "Y3-2-150", days)
		expect(split.later.map((e) => e.id)).toEqual([1])
	})
})

describe("edgesOnLine — the links the line being read can see (#124)", () => {
	// Branch 7 forked from main at Y2; branch 8 forked from 7 at Y3-6; 9 is
	// a sibling of 7.
	const branches = [
		{ id: 7, forkedFromBranchId: null, forkYear: 2, forkMonth: null, forkDay: null },
		{ id: 8, forkedFromBranchId: 7, forkYear: 3, forkMonth: 6, forkDay: null },
		{ id: 9, forkedFromBranchId: null, forkYear: 2, forkMonth: null, forkDay: null }
	] satisfies LineBranch[]
	const links = [
		{ id: 1, historyEntryId: 1, branchId: null }, // main, Y1
		{ id: 2, historyEntryId: 2, branchId: null }, // main, Y3-2-12: after 7's fork
		{ id: 3, historyEntryId: null, branchId: null }, // main, undated
		{ id: 4, historyEntryId: 2, branchId: 7 }, // on 7, Y3-2-12
		{ id: 5, historyEntryId: null, branchId: 8 },
		{ id: 6, historyEntryId: null, branchId: 9 }
	]
	const ids = (line: Parameters<typeof edgesOnLine>[1]) =>
		edgesOnLine(links, line, entries).map((l) => l.id)

	it("reads main's own links on main, and no branch's", () => {
		expect(ids(MAIN_LINE)).toEqual([1, 2, 3])
	})

	it("cuts a main link dated after the fork from the branch", () => {
		expect(ids(lineOf(7, branches))).toEqual([1, 3, 4])
	})

	it("reads a fork of a fork through its parent", () => {
		expect(ids(lineOf(8, branches))).toEqual([1, 3, 4, 5])
	})

	it("never shows a sibling line's links", () => {
		expect(ids(lineOf(9, branches))).not.toContain(4)
	})

	it("draws a branch's own telling of a cast tie in place of the one it inherited at that date", () => {
		const tie = (id: number, branchId: number | null, historyEntryId: number | null) => ({
			id,
			branchId,
			historyEntryId,
			fromNodeId: 1,
			toNodeId: 2,
			fromEntryId: null,
			toEntryId: null,
			relationshipType: "ally"
		})
		const ties = [tie(1, null, 1), tie(2, 7, 1), tie(3, null, null)]
		expect(edgesOnLine(ties, lineOf(7, branches), entries).map((l) => l.id)).toEqual([2, 3])
		expect(edgesOnLine(ties, MAIN_LINE, entries).map((l) => l.id)).toEqual([1, 3])
	})
})
