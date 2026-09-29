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
	tickAtRatio,
	momentAxisRows,
	stepTick
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
		{ key: "entry#1", date: { year: 1 } },
		{ key: "entry#2", date: { year: 1, month: 4, day: 2 } },
		{ key: "entry#3", date: { year: 2, month: 6 } },
		{ key: "entry#4", date: null }
	]

	it("names the rows dated after the cursor", () => {
		expect(keysAfter(items, { year: 1, month: 4, day: 2 })).toEqual([
			"entry#3"
		])
	})

	it("counts the cursor's own moment as true, not as later", () => {
		expect(keysAfter(items, { year: 2, month: 6 })).toEqual([])
	})

	it("dims nothing while the cursor is at now", () => {
		expect(keysAfter(items, null)).toEqual([])
	})

	it("orders by the calendar, not the packed value (radix-100 collision)", () => {
		// Y1-M150 packs past Y2 (1·10000 + 150·100 > 2·10000); it is not later.
		const day100 = [
			{ key: "entry#5", date: { year: 1, month: 150 } },
			{ key: "entry#6", date: { year: 2, month: 1 } }
		]
		expect(keysAfter(day100, { year: 1, month: 200 })).toEqual(["entry#6"])
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

describe("momentAxisRows — every date the story knows", () => {
	const hist = [
		{ id: 1, year: 2, month: null, day: null },
		{ id: 2, year: 6, month: null, day: null }
	]

	it("adds an amendment's date to the axis", () => {
		const rows = momentAxisRows(hist, [
			{ id: 40, year: 4, month: null, day: null }
		])
		expect(rows.map((r) => r.year)).toEqual([2, 4, 6])
	})

	it("a book with no history still has an axis if something is amended", () => {
		// The case that read "Nothing is dated yet" while an amendment sat at Y4.
		const rows = momentAxisRows(
			[],
			[{ id: 40, year: 4, month: null, day: null }]
		)
		expect(rows).toHaveLength(1)
		expect(buildTicks(rows)).toHaveLength(1)
	})

	it("several amendments on one day are one place to stand", () => {
		const rows = momentAxisRows(hist, [
			{ id: 40, year: 4, month: 3, day: 1 },
			{ id: 41, year: 4, month: 3, day: 1 },
			{ id: 42, year: 4, month: 3, day: 2 }
		])
		expect(rows.map((r) => r.id)).toEqual([1, 40, 42, 2])
	})

	it("the history entry keeps the tick where both share a date", () => {
		const rows = momentAxisRows(hist, [
			{ id: 99, year: 2, month: null, day: null }
		])
		expect(rows.map((r) => r.id)).toEqual([1, 2])
	})

	it("is sorted by date whatever order it was given", () => {
		const rows = momentAxisRows(
			[{ id: 1, year: 9, month: null, day: null }],
			[{ id: 2, year: 1, month: null, day: null }]
		)
		expect(rows.map((r) => r.year)).toEqual([1, 9])
	})

	it("nothing dated anywhere is still no axis", () => {
		expect(momentAxisRows([], [])).toEqual([])
	})
})

describe("the axis's identity is the date, not the row id", () => {
	it("keeps both rows when two tables hand over the same id", () => {
		// An entry amendment and a cast amendment, each id 1, on two dates.
		// `MomentBar` keys on `key`; keying on `id` raised each_key_duplicate.
		const rows = momentAxisRows(
			[],
			[
				{ id: 1, year: 4, month: null, day: null },
				{ id: 1, year: 9, month: null, day: null }
			]
		)
		expect(rows).toHaveLength(2)
		const ticks = buildTicks(rows)
		expect(new Set(ticks.map((t) => t.key)).size).toBe(2)
	})

	it("keeps two dates whose packed values collide as two ticks", () => {
		// Y3 Mo.1 Day 150 and Y3 Mo.2 Day 50 both pack to 30250.
		const rows = momentAxisRows(
			[{ id: 1, year: 3, month: 1, day: 150 }],
			[{ id: 2, year: 3, month: 2, day: 50 }]
		)
		expect(rows.map((r) => r.id)).toEqual([1, 2])
		const ticks = buildTicks(rows)
		expect(ticks.map((t) => t.key)).toEqual(["Y3-1-150", "Y3-2-50"])
		expect(ticks[0].date).toEqual({ year: 3, month: 1, day: 150 })
	})
})

describe("stepTick — arrow keys move by date", () => {
	const ticks = buildTicks([
		{ id: 1, year: 1, month: null, day: null },
		{ id: 2, year: 3, month: 1, day: 250 },
		{ id: 3, year: 5, month: null, day: null }
	])

	it("from now, back lands on the NEWEST date (not the one before it)", () => {
		expect(stepTick(ticks, null, "back")?.key).toBe("Y5")
	})

	it("from now, forward stays at now", () => {
		expect(stepTick(ticks, null, "forward")).toBeNull()
	})

	it("from a moment between ticks, steps to its neighbours", () => {
		expect(stepTick(ticks, { year: 4 }, "back")?.key).toBe("Y3-1-250")
		expect(stepTick(ticks, { year: 4 }, "forward")?.key).toBe("Y5")
		expect(stepTick(ticks, { year: 2 }, "back")?.key).toBe("Y1")
	})

	it("from a tick, steps one tick either way; past the newest is now", () => {
		expect(stepTick(ticks, { year: 3, month: 1, day: 250 }, "back")?.key).toBe("Y1")
		expect(stepTick(ticks, { year: 5 }, "forward")).toBeNull()
		expect(stepTick(ticks, { year: 1 }, "back")?.key).toBe("Y1")
	})

	it("has nothing to step on an empty axis", () => {
		expect(stepTick([], null, "back")).toBeUndefined()
	})
})
