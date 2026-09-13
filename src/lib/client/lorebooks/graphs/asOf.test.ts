/**
 * Edges read as of a moment.
 *
 * An edge is dated by the history entry that established it, so the moment is
 * a question about that entry's date. An edge nothing dates makes no claim
 * about when, and is in the story at every moment.
 */
import { describe, expect, it } from "vitest"
import { edgeDateValue, edgesAtMoment, laterLabel, splitByMoment } from "./asOf"

const entries = [
	{ id: 1, year: 1, month: null, day: null },
	{ id: 2, year: 3, month: 2, day: 12 }
]

const edge = (id: number, historyEntryId: number | null) => ({
	id,
	historyEntryId
})

describe("edgeDateValue — when an edge happened", () => {
	it("reads the date off the history entry that established it", () => {
		expect(edgeDateValue(edge(10, 2), entries)).toBe(30212)
	})

	it("has no date for an edge nothing dates", () => {
		expect(edgeDateValue(edge(10, null), entries)).toBeNull()
	})

	it("has no date for an edge whose entry is not loaded", () => {
		expect(edgeDateValue(edge(10, 99), entries)).toBeNull()
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
