/**
 * The Move tab's screen-size simulator — pure geometry, so the whole feature's
 * logic is covered without a component harness.
 */
import { describe, expect, it } from "vitest"
import { TIER_MIN_PX } from "../surfaces/types"
import { DEFAULT_SIDE_RULES } from "./schema"
import {
	EDIT_SIDE_FRACTION,
	EDIT_ZONE_CHROME_PX,
	MOBILE_EDIT_PX,
	SIM_HEIGHT_PX,
	SIM_OPTIONS,
	SIM_WIDTH_PX,
	ULTRAWIDE_PREVIEW_PX,
	mobileEditing,
	narrowWidth,
	railColumns,
	simulatedGeometry,
	simulationExit
} from "./simulator"

const CELL = 48

describe("SIM_WIDTH_PX — the tier table", () => {
	it("previews each tier at the width where that tier BEGINS", () => {
		expect(SIM_WIDTH_PX.cozy).toBe(TIER_MIN_PX.cozy)
		expect(SIM_WIDTH_PX.roomy).toBe(TIER_MIN_PX.roomy)
		expect(SIM_WIDTH_PX.wide).toBe(TIER_MIN_PX.wide)
	})

	it("gives compact a real phone width (its entry width is 0)", () => {
		expect(TIER_MIN_PX.compact).toBe(0)
		expect(SIM_WIDTH_PX.compact).toBeGreaterThan(320)
		expect(SIM_WIDTH_PX.compact).toBeLessThan(TIER_MIN_PX.cozy)
	})

	it("offers the tiers narrowest-first, each labelled with its width", () => {
		expect(SIM_OPTIONS.map((o) => o.tier)).toEqual([
			"compact",
			"cozy",
			"roomy",
			"wide",
			"ultrawide"
		])
		const widths = SIM_OPTIONS.map((o) => o.width)
		expect(widths).toEqual([...widths].sort((a, b) => a - b))
		for (const o of SIM_OPTIONS) {
			expect(o.width).toBe(SIM_WIDTH_PX[o.tier])
			expect(o.label).toMatch(/^[A-Z]/)
		}
	})
})

describe("SIM_HEIGHT_PX — the height a tier previews at", () => {
	it("gives every preset a height, because the rail model is decided on one", () => {
		// Whether a side group can expand beside the pinned ones is a question
		// about the COLUMN's height (see ./sideRail). Previewing five tiers at
		// this monitor's height would answer it the same way five times.
		for (const o of SIM_OPTIONS) {
			expect(SIM_HEIGHT_PX[o.tier]).toBeGreaterThan(0)
		}
		expect(Object.keys(SIM_HEIGHT_PX).sort()).toEqual(
			Object.keys(SIM_WIDTH_PX).sort()
		)
	})

	it("pairs each width with a plausible logical height for that device", () => {
		// The two narrow presets are held portrait — a phone and a tablet (or a
		// split window, which is the same shape); the desktop ones are
		// landscape. That is the whole claim: they are that device's numbers,
		// not this window's.
		for (const t of ["compact", "cozy"] as const) {
			expect(SIM_HEIGHT_PX[t]).toBeGreaterThan(SIM_WIDTH_PX[t])
		}
		for (const t of ["roomy", "wide", "ultrawide"] as const) {
			expect(SIM_HEIGHT_PX[t]).toBeLessThan(SIM_WIDTH_PX[t])
		}
	})
})

describe("simulatedGeometry — the editor's ¼ | ½ | ¼ split", () => {
	it("splits a width into quarter / half / quarter", () => {
		const g = simulatedGeometry(1280, CELL)
		expect(g.left).toBe(320)
		expect(g.right).toBe(320)
		expect(g.centre).toBe(640)
	})

	it("accounts for every pixel — the centre absorbs the rounding", () => {
		for (const w of [1279, 1281, 999, 1023, 1440, 2561]) {
			const g = simulatedGeometry(w, CELL)
			expect(g.left + g.centre + g.right).toBe(w)
			expect(g.left).toBe(g.right)
		}
	})

	it("matches the editor's live math (round(w * 0.25)) at the real width", () => {
		expect(EDIT_SIDE_FRACTION).toBe(0.25)
		for (const w of [1024, 1365, 1920, 2560]) {
			expect(simulatedGeometry(w, CELL).left).toBe(
				Math.round(w * EDIT_SIDE_FRACTION)
			)
		}
	})

	it("honours a custom side fraction", () => {
		const g = simulatedGeometry(1000, CELL, { sideFraction: 0.2 })
		expect(g.left).toBe(200)
		expect(g.right).toBe(200)
		expect(g.centre).toBe(600)
	})

	it("never produces negative geometry for a degenerate width", () => {
		for (const w of [0, -10, Number.NaN]) {
			const g = simulatedGeometry(w, CELL)
			expect(g.left).toBeGreaterThanOrEqual(0)
			expect(g.centre).toBeGreaterThanOrEqual(0)
			expect(g.right).toBeGreaterThanOrEqual(0)
		}
	})
})

describe("simulatedGeometry — margins too narrow to hold a cell", () => {
	it("culls a side that cannot fit one whole cell and gives it to the centre", () => {
		// A quarter of 280px is 70px; minus the zone chrome that is under one
		// 48px cell, so the rail can hold nothing at all.
		expect(70 - EDIT_ZONE_CHROME_PX).toBeLessThan(CELL)
		const g = simulatedGeometry(280, CELL)
		expect(g.left).toBe(0)
		expect(g.right).toBe(0)
		expect(g.centre).toBe(280)
	})

	it("keeps a side that fits at least one cell", () => {
		// The compact preview: a quarter is wide enough for a single column.
		const g = simulatedGeometry(SIM_WIDTH_PX.compact, CELL)
		expect(g.left).toBeGreaterThan(0)
		expect(g.left - EDIT_ZONE_CHROME_PX).toBeGreaterThanOrEqual(CELL)
	})

	it("culls against a bigger cell too — the rule is cells, not pixels", () => {
		const wide = simulatedGeometry(SIM_WIDTH_PX.compact, 96)
		expect(wide.left).toBe(0)
		expect(wide.centre).toBe(SIM_WIDTH_PX.compact)
	})
})

describe("simulatedGeometry — the down-scale that keeps the frame on screen", () => {
	it("does not scale when the simulated width already fits", () => {
		expect(simulatedGeometry(1024, CELL, { available: 1600 }).scale).toBe(1)
		expect(simulatedGeometry(1024, CELL, { available: 1024 }).scale).toBe(1)
	})

	it("does not scale when no available width was given", () => {
		expect(simulatedGeometry(2560, CELL).scale).toBe(1)
	})

	it("shrinks to exactly the available fraction when it does not fit", () => {
		expect(simulatedGeometry(1600, CELL, { available: 800 }).scale).toBe(0.5)
		expect(simulatedGeometry(2000, CELL, { available: 1200 }).scale).toBe(0.6)
	})

	it("never scales up and never returns a non-positive scale", () => {
		for (const available of [0, -5, Number.NaN, 4000]) {
			const s = simulatedGeometry(1440, CELL, { available }).scale
			expect(s).toBeGreaterThan(0)
			expect(s).toBeLessThanOrEqual(1)
		}
	})

	it("scales the frame only — the zone widths stay the simulated ones", () => {
		const big = simulatedGeometry(1920, CELL, { available: 600 })
		const same = simulatedGeometry(1920, CELL)
		expect(big.scale).toBeLessThan(1)
		expect(big.left).toBe(same.left)
		expect(big.centre).toBe(same.centre)
		expect(big.right).toBe(same.right)
	})
})

describe("simulationExit — the snapshot guard around a preview", () => {
	/** A zone arrangement, shaped like the editor's captured GsLayout. */
	const wide = {
		middle: {
			cols: 12,
			rows: 8,
			items: [{ id: "messages", x: 0, y: 0, w: 12, h: 5 }]
		},
		left: { cols: 5, rows: 8, items: [{ id: "cast", x: 0, y: 0, w: 5, h: 3 }] }
	}
	/** The same arrangement after a phone-width preview clamped it. */
	const clamped = {
		middle: {
			cols: 1,
			rows: 8,
			items: [{ id: "messages", x: 0, y: 0, w: 1, h: 5 }]
		},
		left: { cols: 1, rows: 8, items: [{ id: "cast", x: 0, y: 0, w: 1, h: 3 }] }
	}

	it("puts the pre-preview arrangement back when the user only LOOKED", () => {
		const r = simulationExit(wide, clamped, false)
		expect(r.restored).toBe(true)
		expect(r.arranged).toEqual(wide)
		expect(r.arranged.middle.cols).toBe(12)
	})

	it("keeps what the user arranged while simulating", () => {
		const r = simulationExit(wide, clamped, true)
		expect(r.restored).toBe(false)
		expect(r.arranged).toBe(clamped)
	})

	it("never invents an arrangement when there is no snapshot", () => {
		for (const none of [null, undefined]) {
			const r = simulationExit(none, clamped, false)
			expect(r.restored).toBe(false)
			expect(r.arranged).toBe(clamped)
		}
	})

	it("is pure — neither input is mutated", () => {
		const snap = structuredClone(wide)
		const cur = structuredClone(clamped)
		simulationExit(snap, cur, false)
		simulationExit(snap, cur, true)
		expect(snap).toEqual(wide)
		expect(cur).toEqual(clamped)
	})
})

describe("Ultrawide — the rail ladder's multi-column branch", () => {
	/** Where the LIVE ladder itself says a side rail stops being one column. */
	const multiCol = DEFAULT_SIDE_RULES.right.find((r) => (r.columns ?? 1) > 1)!

	it("offers an Ultrawide preset above the ladder's multi-column breakpoint", () => {
		expect(multiCol.columns).toBe(2)
		expect(SIM_WIDTH_PX.ultrawide).toBe(ULTRAWIDE_PREVIEW_PX)
		expect(SIM_WIDTH_PX.ultrawide).toBeGreaterThanOrEqual(multiCol.min)
		expect(SIM_OPTIONS.map((o) => o.tier)).toEqual([
			"compact",
			"cozy",
			"roomy",
			"wide",
			"ultrawide"
		])
	})

	it("reports the rail column count the live ladder gives that width", () => {
		expect(simulatedGeometry(SIM_WIDTH_PX.wide, CELL).sideColumns).toBe(1)
		expect(
			simulatedGeometry(SIM_WIDTH_PX.ultrawide, CELL).sideColumns
		).toBe(multiCol.columns)
		// The BRANCH is what is previewed, not the preset's own width: one pixel
		// below it the rails are still a single column.
		expect(simulatedGeometry(multiCol.min - 1, CELL).sideColumns).toBe(1)
		expect(simulatedGeometry(multiCol.min, CELL).sideColumns).toBe(2)
	})

	it("reads the columns off the ladder rather than a copy of it", () => {
		expect(railColumns(multiCol.min)).toBe(multiCol.columns)
		expect(railColumns(0)).toBe(1)
		// A degenerate width must not walk the whole ladder (NaN < min is false
		// for every rule, which would report the widest branch for nothing).
		expect(railColumns(Number.NaN)).toBe(1)
	})

	it("culls a margin that cannot hold one cell PER rail column", () => {
		// A quarter of 2400 is 600px. At a 290px cell that is one whole cell
		// after the chrome but not two — enough for the 1-column rail this
		// width used to be drawn as, not for the 2-column one it really shows.
		const cell = 290
		expect(600 - EDIT_ZONE_CHROME_PX).toBeGreaterThanOrEqual(cell)
		expect(600 - EDIT_ZONE_CHROME_PX).toBeLessThan(2 * cell)
		expect(simulatedGeometry(2400, cell).left).toBe(0)
		// One pixel narrower is a one-column rail again, and it survives.
		expect(simulatedGeometry(2399, cell).left).toBeGreaterThan(0)
	})

	it("still splits the frame ¼ | ½ | ¼ — the ladder governs columns, not the split", () => {
		const w = SIM_WIDTH_PX.ultrawide
		const g = simulatedGeometry(w, CELL)
		expect(g.left).toBe(Math.round(w * EDIT_SIDE_FRACTION))
		expect(g.left + g.centre + g.right).toBe(w)
	})
})

describe("mobileEditing — which editor a width gets", () => {
	it("puts the phone's own breakpoint at the width the side rails dock", () => {
		expect(MOBILE_EDIT_PX).toBe(TIER_MIN_PX.roomy)
		expect(narrowWidth(MOBILE_EDIT_PX - 1)).toBe(true)
		expect(narrowWidth(MOBILE_EDIT_PX)).toBe(false)
	})

	it("gives a real narrow window the row editor, with no way out of it", () => {
		expect(mobileEditing({ narrow: true, simNarrow: true, grid: false })).toBe(true)
		expect(mobileEditing({ narrow: true, simNarrow: true, grid: true })).toBe(true)
		expect(mobileEditing({ narrow: true, simNarrow: false, grid: true })).toBe(true)
	})

	it("gives a previewed phone the row editor a desktop can look at", () => {
		expect(mobileEditing({ narrow: false, simNarrow: true, grid: false })).toBe(true)
		expect(mobileEditing({ narrow: false, simNarrow: true, grid: true })).toBe(false)
	})

	it("leaves a wide window on the grid", () => {
		expect(mobileEditing({ narrow: false, simNarrow: false, grid: false })).toBe(false)
	})
})
