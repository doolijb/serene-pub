import { describe, it, expect } from "vitest"
import {
	dockedZoneWidths,
	emptyColumnPx,
	emptyColumnsPx,
	inlineSideWidths,
	MIN_CENTER_PX,
	sideFlowPx,
	sidePopulated,
	sideSlot,
	sideWidthPx,
	type SideSlotInput
} from "./sideSlot"
import { switchOn } from "./sessionZones.svelte"
import { STAGE_MEASURE_PX } from "./tuckedSides"

describe("sideSlot — one mount, three places", () => {
	const base: SideSlotInput = { narrow: false, shown: null, side: "left" }

	it("sits in the flow on a plain desktop", () => {
		expect(sideSlot(base)).toBe("inline")
		expect(sideSlot({ ...base, side: "right" })).toBe("inline")
	})

	it("stows below the breakpoint: no layout space, but still mounted", () => {
		expect(sideSlot({ ...base, narrow: true })).toBe("stowed")
	})

	it("is solo when the zone switch (or full screen) shows that side", () => {
		expect(sideSlot({ ...base, shown: "left" })).toBe("solo")
		expect(sideSlot({ ...base, narrow: true, shown: "left" })).toBe("solo")
		expect(sideSlot({ ...base, side: "right", shown: "right" })).toBe("solo")
	})

	it("is stowed when the switch shows another zone, narrow or not", () => {
		expect(sideSlot({ ...base, shown: "middle" })).toBe("stowed")
		expect(sideSlot({ ...base, shown: "right" })).toBe("stowed")
		expect(sideSlot({ ...base, narrow: true, shown: "middle" })).toBe("stowed")
	})

	it("walks inline → stowed → solo → stowed → inline without ever leaving the mount", () => {
		const trip: SideSlotInput[] = [
			base,
			{ ...base, shown: "middle" },
			{ ...base, shown: "left" },
			{ ...base, shown: "right" },
			base
		]
		expect(trip.map(sideSlot)).toEqual(["inline", "stowed", "solo", "stowed", "inline"])
	})
})

describe("sideWidthPx — today's docked widths, one column", () => {
	it("steps at 1440, 1900 and 2400", () => {
		expect([0, 1000, 1439, 1440, 1899, 1900, 2399, 2400, 5000].map(sideWidthPx)).toEqual([
			248, 248, 248, 264, 264, 300, 300, 344, 344
		])
	})
})

describe("sideFlowPx — what a side occupies in the body's row", () => {
	const inline = { slot: "inline" as const, populated: true, widthPx: 264 }

	it("reports an inline side's width", () => {
		expect(sideFlowPx(inline)).toBe(264)
		expect(sideFlowPx({ ...inline, widthPx: 688 })).toBe(688)
	})

	it("is zero for a side that draws nothing", () => {
		// An empty side's column is a separate, softer ask (`emptyColumnPx` /
		// `emptyColumnsPx`), so it never moves the zone switch's threshold.
		expect(sideFlowPx({ ...inline, populated: false })).toBe(0)
	})

	it("is zero for every slot that is not in the body's row", () => {
		expect([
			sideFlowPx({ ...inline, slot: "stowed" }),
			sideFlowPx({ ...inline, slot: "solo" })
		]).toEqual([0, 0])
	})

	it("never negative", () => {
		expect(sideFlowPx({ ...inline, widthPx: -5 })).toBe(0)
	})
})

describe("the pair — the centre's reserve is computed once for the body", () => {
	it("shrinks both sides in proportion, never one for the other", () => {
		const left = sideFlowPx({ slot: "inline", populated: true, widthPx: 264 })
		const right = sideFlowPx({ slot: "inline", populated: true, widthPx: 688 })
		const w = inlineSideWidths({ left, right, bodyPx: 900, gapPx: 8 })
		expect(w.left + w.right).toBeLessThanOrEqual(524)
		expect(900 - 16 - w.left - w.right).toBeGreaterThanOrEqual(MIN_CENTER_PX)
		expect(w.left).toBe(Math.floor(264 * (524 / 952)))
		expect(w.right).toBe(Math.floor(688 * (524 / 952)))
	})

	it("a stowed side reserves nothing, so the drawn one keeps its width", () => {
		const left = sideFlowPx({ slot: "stowed", populated: true, widthPx: 264 })
		const right = sideFlowPx({ slot: "inline", populated: true, widthPx: 264 })
		expect(inlineSideWidths({ left, right, bodyPx: 900, gapPx: 8 })).toEqual({
			left: 0,
			right: 264
		})
	})
})

describe("inlineSideWidths — a docked side in the flow", () => {
	// 1838px viewport, `.session-layout` measures 1822: sideWidthPx answers
	// 264px for both sides (sideWidthPx, below the 1900 step).
	const at1838 = { left: 264, right: 264, bodyPx: 1822, gapPx: 8 }

	it("gives each side its width and the centre the rest", () => {
		expect(inlineSideWidths(at1838)).toEqual({ left: 264, right: 264 })
	})

	it("leaves a side that is not docked in the flow at zero", () => {
		expect(inlineSideWidths({ ...at1838, left: 0 })).toEqual({
			left: 0,
			right: 264
		})
	})

	it("shrinks both sides rather than starve the centre", () => {
		// 900 wide, two 688px asks: 1376 asked, 900 - 16 - 360 = 524 spare.
		const tight = { left: 688, right: 688, bodyPx: 900, gapPx: 8 }
		const w = inlineSideWidths(tight)
		expect(w.left + w.right).toBeLessThanOrEqual(524)
		expect(w.left).toBe(w.right)
		expect(900 - 16 - w.left - w.right).toBeGreaterThanOrEqual(
			MIN_CENTER_PX
		)
	})

	it("never returns a negative width when the centre alone won't fit", () => {
		expect(
			inlineSideWidths({ left: 300, right: 300, bodyPx: 300, gapPx: 8 })
		).toEqual({ left: 0, right: 0 })
	})

	it("counts one gap per side that is actually in the flow", () => {
		// One side only: 400 - 8 - 360 = 32 of room, so the 264 side clamps to
		// 32 — with two sides it would have had 8px less to share.
		expect(
			inlineSideWidths({ left: 264, right: 0, bodyPx: 400, gapPx: 8 })
		).toEqual({ left: 32, right: 0 })
	})

	it("honours a caller-supplied centre minimum", () => {
		// 1822 - 16 of gap - 1400 reserved = 406 to share between two 264s.
		expect(inlineSideWidths({ ...at1838, minCenterPx: 1400 })).toEqual({
			left: 203,
			right: 203
		})
	})
})

/* ── the middle grows, the sides keep their width (ruled 2026-09-28) ──── */
describe("dockedZoneWidths — the middle takes the window's growth", () => {
	const gap = 8
	// Bodies at 1440, 1920, 2560 and 3840 less the 64px app rail.
	const bodies = [1376, 1856, 2496, 3776]
	it("a docked side keeps its width however wide the session grows", () => {
		for (const body of bodies) {
			for (const width of [264, 300, 688]) {
				const w = dockedZoneWidths({ left: 0, right: width, bodyPx: body, gapPx: gap })
				if (body - gap - width < 360) continue
				expect(w.right).toBe(width)
				expect(w.left).toBe(0)
			}
		}
	})
	it("the middle is everything the sides leave, so it grows with the window", () => {
		let last = 0
		for (const body of bodies) {
			const w = dockedZoneWidths({ left: 264, right: 264, bodyPx: body, gapPx: gap })
			expect(w).toEqual({ left: 264, right: 264, middle: body - 2 * (264 + gap) })
			expect(w.middle).toBeGreaterThan(last)
			last = w.middle
		}
		// At 4K the middle is far wider than the column's measure.
		expect(
			dockedZoneWidths({ left: 0, right: 688, bodyPx: 3776, gapPx: gap }).middle
		).toBe(3776 - 688 - gap)
		expect(3776 - 688 - gap).toBeGreaterThan(STAGE_MEASURE_PX * 4)
	})
	it("a wider window never widens a side", () => {
		const a = dockedZoneWidths({ left: 300, right: 300, bodyPx: 1856, gapPx: gap })
		const b = dockedZoneWidths({ left: 300, right: 300, bodyPx: 3776, gapPx: gap })
		expect(b.left).toBe(a.left)
		expect(b.right).toBe(a.right)
		expect(b.middle - a.middle).toBe(3776 - 1856)
	})
	it("the tight case still clamps the sides for the centre's reserve", () => {
		const w = dockedZoneWidths({ left: 400, right: 400, bodyPx: 900, gapPx: gap })
		expect(w.left + w.right).toBeLessThan(800)
		expect(w.middle).toBeGreaterThanOrEqual(360)
	})
	it("no sides: the middle is the whole body", () => {
		expect(dockedZoneWidths({ left: 0, right: 0, bodyPx: 1856, gapPx: gap })).toEqual({
			left: 0,
			right: 0,
			middle: 1856
		})
	})
})


const GAP = 8
/** An empty side in the flow at a body width — what `sideWidths` asks with. */
function askOf(bodyPx: number, o: { slot?: "inline" | "stowed" | "solo" } = {}): number {
	return emptyColumnPx({
		slot: o.slot ?? "inline",
		populated: false,
		widthPx: sideWidthPx(bodyPx)
	})
}
/**
 * What the session draws — `SessionLayoutModel`'s `sideWidths`, pure: a
 * populated side's own footprint, else whatever its empty column was granted,
 * and the middle whatever is left.
 */
function drawnWidths(o: {
	hardLeft: number
	hardRight: number
	emptyLeft: number
	emptyRight: number
	bodyPx: number
}) {
	const granted = emptyColumnsPx({
		hardLeftPx: o.hardLeft,
		hardRightPx: o.hardRight,
		emptyLeftPx: o.emptyLeft,
		emptyRightPx: o.emptyRight,
		bodyPx: o.bodyPx,
		gapPx: GAP
	})
	return dockedZoneWidths({
		left: o.hardLeft || granted.left,
		right: o.hardRight || granted.right,
		bodyPx: o.bodyPx,
		gapPx: GAP
	})
}

describe("emptyColumnPx — an empty side asks for the width its first widget will have", () => {
	it("an empty inline side asks for its width", () => {
		expect(askOf(1376)).toBe(248)
		expect(askOf(1856)).toBe(264)
		expect(askOf(2496)).toBe(344)
	})
	it("is the footprint the first panel gets, so adding it does not move anything", () => {
		for (const body of [1376, 1856, 2496]) {
			const widthPx = sideWidthPx(body)
			expect(askOf(body)).toBe(
				sideFlowPx({ slot: "inline", populated: true, widthPx })
			)
		}
	})
	it("a populated side asks nothing — its own footprint is what it takes", () => {
		expect(emptyColumnPx({ slot: "inline", populated: true, widthPx: 248 })).toBe(0)
	})
	it("stowed or solo, an empty side takes nothing", () => {
		expect(askOf(1376, { slot: "stowed" })).toBe(0)
		expect(askOf(1376, { slot: "solo" })).toBe(0)
	})
})

describe("emptyColumnsPx — the middle does not grow into an empty side", () => {
	it("1440 (a 1376 body): the empty left keeps 248 and the middle is what it was with widgets there", () => {
		const w = drawnWidths({
			hardLeft: 0,
			hardRight: 248,
			emptyLeft: 248,
			emptyRight: 0,
			bodyPx: 1376
		})
		expect(w).toEqual({ left: 248, right: 248, middle: 1376 - 2 * 248 - 2 * GAP })
		expect(w).toEqual(
			dockedZoneWidths({ left: 248, right: 248, bodyPx: 1376, gapPx: GAP })
		)
	})

	it("1920 (an 1856 body): 300 each side, and the middle takes the rest", () => {
		const w = drawnWidths({
			hardLeft: 0,
			hardRight: 300,
			emptyLeft: 300,
			emptyRight: 0,
			bodyPx: 1856
		})
		expect(w).toEqual({ left: 300, right: 300, middle: 1856 - 600 - 2 * GAP })
	})

	it("both sides empty: both columns kept, and the stage between them", () => {
		const w = drawnWidths({
			hardLeft: 0,
			hardRight: 0,
			emptyLeft: 264,
			emptyRight: 264,
			bodyPx: 1600
		})
		expect(w).toEqual({ left: 264, right: 264, middle: 1600 - 528 - 2 * GAP })
	})

	it("gives way before the zone switch turns on", () => {
		// 1200 holds the right (248 + 8) and the stage (696), not an empty
		// 248 + 8 as well (1208): the empty column goes to 0 and the right stays docked.
		const w = drawnWidths({
			hardLeft: 0,
			hardRight: 248,
			emptyLeft: 248,
			emptyRight: 0,
			bodyPx: 1200
		})
		expect(w.left).toBe(0)
		expect(w.right).toBe(248)
		expect(
			switchOn({ narrow: false, bodyPx: 1200, leftPx: 0, rightPx: 248, gapPx: GAP })
		).toBe(false)
	})

	it("is kept exactly while the populated sides, the stage's measure and the column all fit", () => {
		const need = 264 + GAP + STAGE_MEASURE_PX + 264 + GAP
		const at = (bodyPx: number) =>
			emptyColumnsPx({
				hardLeftPx: 0,
				hardRightPx: 264,
				emptyLeftPx: 264,
				emptyRightPx: 0,
				bodyPx,
				gapPx: GAP
			})
		expect(at(need)).toEqual({ left: 264, right: 0 })
		expect(at(need - 1)).toEqual({ left: 0, right: 0 })
	})

	it("two empty sides are kept together or not at all, so the stage stays centred", () => {
		// 1200 has room for one (248 + 8 + 696 = 952) but not both (1208).
		expect(
			emptyColumnsPx({
				hardLeftPx: 0,
				hardRightPx: 0,
				emptyLeftPx: 248,
				emptyRightPx: 248,
				bodyPx: 1200,
				gapPx: GAP
			})
		).toEqual({ left: 0, right: 0 })
	})

	it("an unmeasured box (0) keeps them, like every first-frame decision here", () => {
		expect(
			emptyColumnsPx({
				hardLeftPx: 0,
				hardRightPx: 264,
				emptyLeftPx: 264,
				emptyRightPx: 0,
				bodyPx: 0,
				gapPx: GAP
			})
		).toEqual({ left: 264, right: 0 })
	})

	it("nothing asked, nothing granted", () => {
		expect(
			emptyColumnsPx({
				hardLeftPx: 264,
				hardRightPx: 264,
				emptyLeftPx: 0,
				emptyRightPx: 0,
				bodyPx: 3000,
				gapPx: GAP
			})
		).toEqual({ left: 0, right: 0 })
	})

	it("never grants a side that already draws something", () => {
		expect(
			emptyColumnsPx({
				hardLeftPx: 264,
				hardRightPx: 0,
				emptyLeftPx: 264,
				emptyRightPx: 0,
				bodyPx: 3000,
				gapPx: GAP
			})
		).toEqual({ left: 0, right: 0 })
	})

	it("a side that asks nothing still takes 0 while the other side's empty column is kept", () => {
		const w = drawnWidths({
			hardLeft: 0,
			hardRight: 0,
			emptyLeft: 0,
			emptyRight: askOf(1376),
			bodyPx: 1376
		})
		expect(w).toEqual({ left: 0, right: 248, middle: 1376 - 248 - GAP })
	})
})


describe("sidePopulated — one test, on the desktop and in the zone switch", () => {
	it("a side with no panel is not populated; one with a panel is", () => {
		expect(sidePopulated({ panels: 0 })).toBe(false)
		expect(sidePopulated({ panels: 1 })).toBe(true)
		expect(sidePopulated({ panels: 3 })).toBe(true)
	})
})
