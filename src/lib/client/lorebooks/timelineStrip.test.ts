/**
 * The standing timeline strip, as arithmetic — where a tick sits, and what is
 * not true yet at the moment the cursor is on.
 */
import { describe, expect, it } from "vitest"
import {
	buildTicks,
	keysAfter,
	orderByMoment,
	ratioOf,
	tickAtRatio
} from "./timelineStrip"

const dates = [
	{ id: 3, year: 2, month: 6, day: null },
	{ id: 1, year: 1, month: null, day: null },
	{ id: 2, year: 1, month: 4, day: 2 }
]

describe("buildTicks — dates become an axis", () => {
	it("orders the ticks oldest first", () => {
		expect(buildTicks(dates).map((t) => t.id)).toEqual([1, 2, 3])
	})

	it("encodes each date as one comparable number", () => {
		expect(buildTicks(dates).map((t) => t.value)).toEqual([
			10000, 10402, 20600
		])
	})

	it("labels a tick the way the entry's own heading reads", () => {
		expect(buildTicks(dates)[1].label).toBe("Year 1, Mo. 4, Day 2")
	})

	it("spreads the ticks across the axis by date, not by count", () => {
		const ticks = buildTicks(dates)
		expect(ticks[0].ratio).toBe(0)
		expect(ticks[2].ratio).toBe(1)
		expect(ticks[1].ratio).toBeCloseTo(0.0379, 3)
	})

	it("spreads evenly when every entry shares one date", () => {
		const ticks = buildTicks([
			{ id: 1, year: 5 },
			{ id: 2, year: 5 },
			{ id: 3, year: 5 }
		])
		expect(ticks.map((t) => t.ratio)).toEqual([0, 0.5, 1])
	})

	it("puts a lone tick at the start of the axis", () => {
		expect(buildTicks([{ id: 9, year: 3 }])[0].ratio).toBe(0)
	})

	it("has no axis at all for a book with no dates", () => {
		expect(buildTicks([])).toEqual([])
	})
})

describe("tickAtRatio — dragging and clicking land on a tick", () => {
	const ticks = buildTicks(dates)

	it("snaps to the nearest tick rather than between two", () => {
		expect(tickAtRatio(ticks, 0.02)?.id).toBe(2)
		expect(tickAtRatio(ticks, 0.9)?.id).toBe(3)
	})

	it("clamps a drag past either end", () => {
		expect(tickAtRatio(ticks, -4)?.id).toBe(1)
		expect(tickAtRatio(ticks, 12)?.id).toBe(3)
	})

	it("has nothing to land on with no ticks", () => {
		expect(tickAtRatio([], 0.5)).toBeNull()
	})
})

describe("ratioOf — where the cursor is drawn", () => {
	const ticks = buildTicks(dates)

	it("sits on the tick the position names", () => {
		expect(ratioOf(ticks, 10402)).toBeCloseTo(0.0379, 3)
	})

	it("sits at the end when nothing is set, which is now", () => {
		expect(ratioOf(ticks, null)).toBe(1)
	})

	it("sits at the end for a position past every tick", () => {
		expect(ratioOf(ticks, 99999)).toBe(1)
	})
})

describe("keysAfter — what is not true yet at this moment", () => {
	const items = [
		{ key: "entry#1", order: 10000 },
		{ key: "entry#2", order: 10402 },
		{ key: "entry#3", order: 20600 }
	]

	it("names the rows dated after the cursor", () => {
		expect(keysAfter(items, 10402)).toEqual(["entry#3"])
	})

	it("counts the cursor's own moment as true, not as later", () => {
		expect(keysAfter(items, 20600)).toEqual([])
	})

	it("dims nothing while the cursor is at now", () => {
		expect(keysAfter(items, null)).toEqual([])
	})
})

describe("orderByMoment — the moment's rows first", () => {
	const items = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }]

	it("moves what is not true yet to the end, order otherwise untouched", () => {
		expect(
			orderByMoment(items, new Set(["b", "c"])).map((i) => i.key)
		).toEqual(["a", "d", "b", "c"])
	})

	it("returns the list as it stands when nothing is later", () => {
		expect(orderByMoment(items, new Set()).map((i) => i.key)).toEqual([
			"a",
			"b",
			"c",
			"d"
		])
	})
})
