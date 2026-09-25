import { describe, expect, it } from "vitest"
import { buildAxis, overlaps, ratioOf } from "./livesLens"
import type { Presence } from "$lib/shared/lorebooks/presence"

const p = (
	over: Partial<Presence> & {
		id: number
		personalPosition: number
		fromYear: number
	}
) => ({ castId: 1, branchId: null, ...over }) as Presence
const cast = [
	{ id: 1, name: "Verity" },
	{ id: 2, name: "Tomas" }
]

describe("ratioOf", () => {
	it("places between the ends", () => {
		expect(ratioOf(50, 0, 100)).toBe(0.5)
		expect(ratioOf(0, 0, 100)).toBe(0)
		expect(ratioOf(100, 0, 100)).toBe(1)
	})
	it("a single date has no span, so it sits mid-line", () => {
		expect(ratioOf(500, 500, 500)).toBe(0.5)
	})
	it("clamps rather than running off the end", () => {
		expect(ratioOf(-40, 0, 100)).toBe(0)
		expect(ratioOf(400, 0, 100)).toBe(1)
	})
})

describe("overlaps", () => {
	const span = (from: number, to: number) => ({ from, to })
	it("two spans that share time overlap", () => {
		expect(overlaps([span(500, 560), span(540, 600)])).toBe(true)
	})
	it("end to end does not — until is exclusive, so that is a handover", () => {
		expect(overlaps([span(500, 540), span(540, 600)])).toBe(false)
	})
	it("one span never overlaps itself", () => {
		expect(overlaps([span(500, 600)])).toBe(false)
	})
	it("an open-ended span swallows everything after it", () => {
		// The case the ratio version got wrong: clamped to the axis, an open
		// run and one starting at the right edge merely touched.
		expect(overlaps([span(500, Infinity), span(540, Infinity)])).toBe(true)
	})
})

describe("the axis", () => {
	it("a member with no presences gets no lane", () => {
		// They are in the world at every moment, which a line cannot say.
		const axis = buildAxis(cast, [], [{ year: 500 }, { year: 600 }])
		expect(axis.lanes).toEqual([])
	})

	it("spans the pins as well as the presences", () => {
		// A life is only legible against the events it crossed.
		const axis = buildAxis(
			cast,
			[p({ id: 1, personalPosition: 30, fromYear: 550 })],
			[{ year: 100 }, { year: 900 }]
		)
		expect(axis.min).toBeLessThanOrEqual(1000000)
		expect(axis.lanes[0].runs[0].from).toBeCloseTo(
			(550 - 100) / (900 - 100),
			5
		)
	})

	it("an open presence runs to the edge", () => {
		const axis = buildAxis(
			cast,
			[p({ id: 1, personalPosition: 30, fromYear: 500 })],
			[{ year: 500 }, { year: 700 }]
		)
		expect(axis.lanes[0].runs[0].to).toBe(1)
		expect(axis.lanes[0].runs[0].open).toBe(true)
	})

	it("marks a doubled lane whatever the axis happens to span", () => {
		// The bug this replaced: "two of them" appeared at one moment and not
		// at another, because the answer was read off the drawing.
		const rows = [
			p({ id: 1, personalPosition: 34, fromYear: 506 }),
			p({ id: 2, personalPosition: 50, fromYear: 540 })
		]
		for (const moment of [undefined, { year: 545 }, { year: 9000 }])
			expect(buildAxis(cast, rows, [], { moment }).lanes[0].doubled).toBe(
				true
			)
	})

	it("marks a lane where two of them stand together", () => {
		const axis = buildAxis(
			cast,
			[
				p({ id: 1, personalPosition: 34, fromYear: 500 }),
				p({ id: 2, personalPosition: 50, fromYear: 540 })
			],
			[{ year: 500 }, { year: 600 }]
		)
		expect(axis.lanes[0].doubled).toBe(true)
	})

	it("does not mark a lane that merely hands over", () => {
		const axis = buildAxis(
			cast,
			[
				p({
					id: 1,
					personalPosition: 34,
					fromYear: 500,
					untilYear: 540
				}),
				p({ id: 2, personalPosition: 50, fromYear: 540 })
			],
			[{ year: 500 }, { year: 600 }]
		)
		expect(axis.lanes[0].doubled).toBe(false)
	})

	it("leaves a sibling line's presences out", () => {
		const axis = buildAxis(
			cast,
			[
				p({ id: 1, personalPosition: 34, fromYear: 500 }),
				p({ id: 2, personalPosition: 50, fromYear: 520, branchId: 7 })
			],
			[{ year: 500 }, { year: 600 }]
		)
		expect(axis.lanes[0].runs).toHaveLength(1)
		expect(
			buildAxis(
				cast,
				[
					p({ id: 1, personalPosition: 34, fromYear: 500 }),
					p({
						id: 2,
						personalPosition: 50,
						fromYear: 520,
						branchId: 7
					})
				],
				[{ year: 500 }, { year: 600 }],
				{ branchId: 7 }
			).lanes[0].runs
		).toHaveLength(2)
	})

	it("orders a lane's runs by when they begin", () => {
		const axis = buildAxis(
			cast,
			[
				p({ id: 1, personalPosition: 50, fromYear: 580 }),
				p({ id: 2, personalPosition: 34, fromYear: 500 })
			],
			[{ year: 500 }, { year: 600 }]
		)
		expect(axis.lanes[0].runs.map((r) => r.personalPosition)).toEqual([
			34, 50
		])
	})

	it("puts the cursor where the moment is, and nowhere at now", () => {
		const pins = [{ year: 500 }, { year: 700 }]
		expect(
			buildAxis(cast, [], pins, { moment: { year: 600 } }).cursor
		).toBeCloseTo(0.5, 5)
		expect(buildAxis(cast, [], pins).cursor).toBeNull()
	})

	it("a book with nothing in it draws nothing and does not divide by zero", () => {
		const axis = buildAxis([], [], [])
		expect(axis).toMatchObject({ min: 0, max: 0, lanes: [], cursor: null })
	})
})
