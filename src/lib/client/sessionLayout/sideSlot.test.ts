import {
	resolveDrawn,
	type LayoutZoneRule,
	type PanelV1,
	type SessionLayoutV1
} from "@serene-pub/sdk"
import { describe, it, expect } from "vitest"
import {
	sideSlot,
	sideFlowPx,
	inlineSideWidths,
	MIN_CENTER_PX,
	type SideSlotInput
} from "./sideSlot"

/** Desktop, overlay closed — the plain rail case. */
const base: SideSlotInput = {
	narrow: false,
	overlayOwns: false
}

describe("sideSlot — one mount, three places", () => {
	it("sits in the flow on a plain desktop", () => {
		expect(sideSlot(base)).toBe("inline")
	})

	it("stows below the breakpoint: no layout space, but still mounted", () => {
		expect(sideSlot({ ...base, narrow: true })).toBe("stowed")
	})

	it("hands the mount to the overlay dialog, rather than standing down", () => {
		// It used to answer "none" here — the overlay rendered that side a
		// SECOND time, so opening it reloaded every iframe in the side. The
		// dialog is now a container class on the one mount.
		expect(sideSlot({ ...base, narrow: true, overlayOwns: true })).toBe(
			"overlay"
		)
	})

	it("the overlay outranks the breakpoint, and the breakpoint the flow", () => {
		// The order the three rules are written in is the answer to "a side
		// the sheet is showing on a desktop-width window": still the overlay.
		expect(sideSlot({ ...base, overlayOwns: true })).toBe("overlay")
	})

	it("leaves the other side stowed while one side is in the overlay", () => {
		const open = { ...base, narrow: true, overlayOwns: true }
		const other = { ...base, narrow: true, overlayOwns: false }
		expect([sideSlot(open), sideSlot(other)]).toEqual(["overlay", "stowed"])
	})

	it("opening and closing the overlay never leaves the mount", () => {
		const shut = { ...base, narrow: true }
		const open = { ...shut, overlayOwns: true }
		expect([sideSlot(shut), sideSlot(open), sideSlot(shut)]).toEqual([
			"stowed",
			"overlay",
			"stowed"
		])
	})

	it("walks inline → stowed → overlay → stowed → inline without ever leaving the mount", () => {
		// The whole trip a side takes in one session: docked beside the chat,
		// parked when the window narrows, carried into the mobile sheet,
		// parked again when the sheet shuts, docked again on the way back up.
		// Every step is a CONTAINER, so the subtree that moves between them is
		// the same one throughout — there is deliberately no value here that
		// means "not rendered", which is what makes the no-reload law hold by
		// construction rather than by remembering.
		const trip: SideSlotInput[] = [
			base,
			{ ...base, narrow: true },
			{ ...base, narrow: true, overlayOwns: true },
			{ ...base, narrow: true },
			base
		]
		expect(trip.map(sideSlot)).toEqual([
			"inline",
			"stowed",
			"overlay",
			"stowed",
			"inline"
		])
	})

	it("crossing the breakpoint and back never leaves the mount", () => {
		const narrow = { ...base, narrow: true }
		expect([sideSlot(base), sideSlot(narrow), sideSlot(base)]).toEqual([
			"inline",
			"stowed",
			"inline"
		])
	})
})

describe("sideSlot — the stage (QE, brief 7a)", () => {
	it("a side holding the stage's conversation becomes the stage, on the phone and in Stage only", () => {
		expect(sideSlot({ ...base, narrow: true, stage: true })).toBe("stage")
		expect(sideSlot({ ...base, stage: true })).toBe("stage")
	})

	it("its sheet still opens over it: the overlay outranks the stage", () => {
		expect(sideSlot({ ...base, narrow: true, stage: true, overlayOwns: true })).toBe("overlay")
	})

	it("the stage is a container like the rest: stowed → stage → overlay → stage, one mount", () => {
		const trip: SideSlotInput[] = [
			{ ...base, narrow: true },
			{ ...base, narrow: true, stage: true },
			{ ...base, narrow: true, stage: true, overlayOwns: true },
			{ ...base, narrow: true, stage: true }
		]
		expect(trip.map(sideSlot)).toEqual(["stowed", "stage", "overlay", "stage"])
	})

	it("reserves no side width: the stage is the body, not a rail beside it", () => {
		expect(
			sideFlowPx({ slot: "stage", populated: true, mode: "rail", widthPx: 300 })
		).toBe(0)
	})
})

describe("inlineSideWidths — a docked side in the flow", () => {
	// 1838px viewport, `.session-layout` measures 1822: the ladder answers
	// 264px for both sides (DEFAULT_SIDE_RULES, below the 1900 step).
	const at1838 = { left: 264, right: 264, bodyPx: 1822, gapPx: 8 }

	it("gives each side the ladder width and the centre the rest", () => {
		expect(inlineSideWidths(at1838)).toEqual({ left: 264, right: 264 })
	})

	it("leaves a side that is not docked in the flow at zero", () => {
		expect(inlineSideWidths({ ...at1838, left: 0 })).toEqual({
			left: 0,
			right: 264
		})
	})

	it("shrinks both sides rather than starve the centre", () => {
		// 900 wide, two 344×2 rails: 1376 asked, 900 - 16 - 360 = 524 spare.
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
		// One side only: 400 - 8 - 360 = 32 of room, so the 264 rail clamps to
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

describe("sideFlowPx — what a side occupies in the body's row", () => {
	const docked = {
		slot: "inline" as const,
		populated: true,
		mode: "rail" as const,
		widthPx: 264
	}

	it("reports a docked side's ladder footprint", () => {
		expect(sideFlowPx(docked)).toBe(264)
		expect(sideFlowPx({ ...docked, widthPx: 688 })).toBe(688)
	})

	it("is zero for a side that draws nothing", () => {
		// This is the footprint of what a side DRAWS. An empty side draws no
		// panel, so it is 0 here too; its column (ruled 2026-09-29) is not a
		// footprint but a separate, softer ask — `emptyColumnPx` /
		// `emptyColumnsPx`, below — so it never moves the tuck threshold.
		expect(sideFlowPx({ ...docked, populated: false })).toBe(0)
		expect(sideFlowPx({ ...docked, mode: "hidden" })).toBe(0)
	})

	it("a TUCKED side is its icon rail and nothing more", () => {
		// ./tuckedSides: the panels are put away and reached from the rail,
		// so the column gives its whole ladder footprint back to the stage.
		expect(sideFlowPx({ ...docked, tucked: true })).toBe(RAIL_PX)
	})

	it("a RAIL-ONLY side — every panel in the rail — is its icon rail, never the ladder's column (lane E1)", () => {
		// Nothing in it is docked: its panels are rail icons that fly out over
		// the session. Counting the column it does not draw tucked Adventure's
		// party column at 1280px (lane L's finding). The model reads it as
		// tucked; a rung of `icons` (every panel `pinned: false`) or `drawer`
		// says the same.
		expect(sideFlowPx({ ...docked, tucked: true })).toBe(36)
		expect(sideFlowPx({ ...docked, mode: "icons" })).toBe(36)
		expect(sideFlowPx({ ...docked, mode: "drawer" })).toBe(36)
	})

	it("is zero for every slot that is not in the body's row", () => {
		expect([
			sideFlowPx({ ...docked, slot: "stowed" }),
			sideFlowPx({ ...docked, slot: "overlay" }),
			sideFlowPx({ ...docked, slot: "stage" })
		]).toEqual([0, 0, 0])
	})
})

describe("the pair — the centre's reserve is computed once for the body", () => {
	it("shrinks both docked sides in proportion, never one for the other", () => {
		// 900 wide: a 264 column on the left, a 344×2 column on the right.
		const left = sideFlowPx({ slot: "inline", populated: true, mode: "rail", widthPx: 264 })
		const right = sideFlowPx({ slot: "inline", populated: true, mode: "rail", widthPx: 688 })
		expect([left, right]).toEqual([264, 688])
		const w = inlineSideWidths({ left, right, bodyPx: 900, gapPx: 8 })
		// 900 - 16 of gap - 360 reserved = 524 to share between 952 asked.
		expect(w.left + w.right).toBeLessThanOrEqual(524)
		expect(900 - 16 - w.left - w.right).toBeGreaterThanOrEqual(
			MIN_CENTER_PX
		)
		expect(w.left).toBe(Math.floor(264 * (524 / 952)))
		expect(w.right).toBe(Math.floor(688 * (524 / 952)))
	})

	it("a stowed side reserves nothing, so the drawn one keeps its ladder", () => {
		const left = sideFlowPx({ slot: "stowed", populated: true, mode: "rail", widthPx: 264 })
		const right = sideFlowPx({ slot: "inline", populated: true, mode: "rail", widthPx: 264 })
		expect(
			inlineSideWidths({ left, right, bodyPx: 900, gapPx: 8 })
		).toEqual({ left: 0, right: 264 })
	})
})

/* ── the middle grows, the sides keep their width (ruled 2026-09-28) ──── */
import { dockedZoneWidths } from "./sideSlot"
import { STAGE_MEASURE_PX } from "./tuckedSides"

describe("dockedZoneWidths — the middle takes the window's growth", () => {
	const gap = 8
	// Bodies at 1440, 1920, 2560 and 3840 less the 64px app rail.
	const bodies = [1376, 1856, 2496, 3776]
	it("a docked side keeps its ladder width however wide the session grows", () => {
		for (const body of bodies) {
			for (const ladder of [264, 300, 688]) {
				const w = dockedZoneWidths({ left: 0, right: ladder, bodyPx: body, gapPx: gap })
				if (body - gap - ladder < 360) continue
				expect(w.right).toBe(ladder)
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

/* ── an empty side keeps its column (ruled 2026-09-29) ─────────────────── */
import {
	emptyColumnPx,
	emptyColumnsPx,
	sidePopulated,
	type EmptyColumnInput
} from "./sideSlot"
import { RAIL_PX } from "./sideRail"
import { sidesTucked } from "./tuckedSides"

/** A layout with these right/left panels and the conversation in the middle. */
function withSides(
	o: { left?: PanelV1[]; right?: PanelV1[] } = {},
	zoneLayout?: SessionLayoutV1["zoneLayout"]
): SessionLayoutV1 {
	return {
		panels: {
			version: 1,
			left: o.left ?? [],
			right: o.right ?? [],
			middle: { above: [], primary: { key: "p1", tabs: ["messages"] }, below: [] }
		},
		...(zoneLayout ? { zoneLayout } : {})
	}
}

/** An empty side's rung at a container width — `resolveDrawn`'s, ⏳ its rules a zone's. */
function emptyRungAt(
	side: "left" | "right",
	width: number,
	o: { rules?: LayoutZoneRule[] } = {}
) {
	const zones = o.rules
		? { [side]: { kind: "side" as const, side, widgets: [], rules: o.rules } }
		: undefined
	return resolveDrawn(
		withSides({}, zones ? { version: 1, zones } : undefined),
		{ inline: width }
	)[side].rung!
}

/** An empty side in the flow — what `sideWidths` asks with. */
function askOf(
	side: "left" | "right",
	width: number,
	o: Partial<EmptyColumnInput> & { rules?: LayoutZoneRule[] } = {}
): number {
	const { rules, ...rest } = o
	const rung = emptyRungAt(side, width, { rules })
	return emptyColumnPx({
		slot: "inline",
		populated: false,
		mode: rung.mode,
		widthPx: rung.width * rung.columns,
		...rest
	})
}

const GAP = 8
/**
 * What the session draws — `SessionLayout`'s `sideWidths`, pure: a populated
 * side's own footprint, else whatever its empty column was granted, and the
 * middle whatever is left.
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
	it("an empty docked left keeps its ladder width, on a rail rung or an icon one", () => {
		// "The columns shouldn't disappear if the pane is empty": every side
		// that docks keeps its column. 248 on the 1200–1440 rung, 264 to the
		// 1900 step, 300 above it, 344 × 2 from 2400.
		expect(askOf("left", 1216)).toBe(248)
		expect(askOf("left", 1376)).toBe(248)
		expect(askOf("left", 1440)).toBe(264)
		expect(askOf("left", 1920)).toBe(300)
		expect(askOf("left", 2496)).toBe(688)
		expect(
			emptyColumnPx({ slot: "inline", populated: false, mode: "icons", widthPx: 248 })
		).toBe(248)
		expect(askOf("right", 800)).toBe(264)
		expect(askOf("right", 1216)).toBe(248)
	})

	it("is the footprint the first panel gets, so adding it does not move anything", () => {
		for (const width of [1376, 1920, 2496]) {
			const r = resolveDrawn(withSides({ left: [{ key: "a", tabs: ["stats"] }] }), {
				inline: width
			}).left.rung!
			expect(askOf("left", width)).toBe(
				sideFlowPx({
					slot: "inline",
					populated: true,
					mode: r.mode,
					widthPx: r.width * r.columns
				})
			)
		}
	})

	it("a HIDDEN side still asks for nothing — only an empty one changed", () => {
		const rules: LayoutZoneRule[] = [{ min: 0, mode: "hidden", width: 264 }]
		expect(emptyRungAt("left", 1376, { rules }).mode).toBe("hidden")
		expect(askOf("left", 1376, { rules })).toBe(0)
	})

	it("asks for nothing on a rung where the side does not dock (the drawer)", () => {
		// The default Left docks from 1200; below it the ladder says drawer.
		expect(emptyRungAt("left", 1100).mode).toBe("drawer")
		expect(askOf("left", 1100)).toBe(0)
	})

	it("a populated side asks nothing — its own footprint is what it takes", () => {
		expect(askOf("left", 1376, { populated: true })).toBe(0)
	})

	it("stowed and in the phone's sheet an empty side takes nothing, like any side", () => {
		expect(askOf("left", 1376, { slot: "stowed" })).toBe(0)
		expect(askOf("left", 1376, { slot: "overlay" })).toBe(0)
	})

	it("TUCKED, an empty side is nothing at all — no column, and no icon rail", () => {
		// A rail with no icon has no panel to open.
		expect(askOf("left", 1376, { tucked: true })).toBe(0)
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

	it("gives way before any populated side tucks", () => {
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
		expect(sidesTucked({ leftPx: 0, rightPx: 248, gapPx: GAP, bodyPx: 1200 })).toBe(
			false
		)
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

	it("a hidden side still takes 0 while the other side's empty column is kept", () => {
		const w = drawnWidths({
			hardLeft: 0,
			hardRight: 0,
			emptyLeft: askOf("left", 1376, {
				rules: [{ min: 0, mode: "hidden", width: 264 }]
			}),
			emptyRight: askOf("right", 1376),
			bodyPx: 1376
		})
		expect(w).toEqual({ left: 0, right: 248, middle: 1376 - 248 - GAP })
	})
})

describe("tucking is unchanged by an empty side", () => {
	it("the threshold reads only what the sides draw, and an empty side draws nothing", () => {
		const empty = { slot: "inline" as const, populated: false, mode: "rail" as const, widthPx: 264 }
		expect(sideFlowPx(empty)).toBe(0)
		// So a populated right tucks exactly where it did with no left at all.
		for (const bodyPx of [900, 967, 968, 1200, 1376])
			expect(
				sidesTucked({ leftPx: sideFlowPx(empty), rightPx: 264, gapPx: GAP, bodyPx })
			).toBe(sidesTucked({ leftPx: 0, rightPx: 264, gapPx: GAP, bodyPx }))
	})

	it("a populated side tucks to its icon rail as before", () => {
		expect(
			sideFlowPx({ slot: "inline", populated: true, mode: "rail", widthPx: 264, tucked: true })
		).toBe(RAIL_PX)
	})
})

describe("sidePopulated — one test, on the desktop and in the phone's panels menu", () => {
	it("a side with no panel, or on a hidden rung, is not populated", () => {
		expect(sidePopulated({ mode: "rail", panels: 0 })).toBe(false)
		expect(sidePopulated({ mode: "hidden", panels: 3 })).toBe(false)
		expect(sidePopulated({ mode: "icons", panels: 1 })).toBe(true)
	})

	it("a side holding only a conversation copy is populated — never an empty column", () => {
		// `messages#sanctum` is no panel instance, but it is a panel's tab,
		// and the phone's menu has always counted it. The desktop asks the
		// same question, so a Sanctum-only side is populated on both and is
		// never given a blank column.
		const populated = sidePopulated({ mode: "rail", panels: 1 })
		expect(populated).toBe(true)
		expect(
			emptyColumnPx({ slot: "inline", populated, mode: "rail", widthPx: 248 })
		).toBe(0)
	})
})

describe("sidePopulated — the same cases, read off the drawn layout (C5)", () => {
	/** A side as the SDK's one reader draws it, in the shape `sidePopulated` asks. */
	const sideOf = (layout: SessionLayoutV1, side: "left" | "right", inline = 1376) => {
		const z = resolveDrawn(layout, { inline })[side]
		return { mode: z.rung!.mode, panels: z.panels.length }
	}

	it("a side with nothing in it, or a hidden one, is not populated", () => {
		expect(sidePopulated(sideOf({}, "right"))).toBe(false)
		expect(sidePopulated(sideOf(withSides(), "right"))).toBe(false)
		expect(
			sidePopulated(
				sideOf(
					withSides(
						{ right: [{ key: "a", tabs: ["stats"] }] },
						{
							version: 1,
							zones: {
								right: {
									kind: "side",
									side: "right",
									widgets: [],
									rules: [{ min: 0, mode: "hidden" }]
								}
							}
						}
					),
					"right"
				)
			)
		).toBe(false)
	})

	it("a side holding only a conversation copy is populated — never an empty column", () => {
		const side = sideOf(withSides({ right: [{ key: "a", tabs: ["messages#sanctum"] }] }), "right")
		expect(side).toEqual({ mode: "rail", panels: 1 })
		expect(sidePopulated(side)).toBe(true)
	})

	it("a side whose every panel is in the rail is populated, on the icons rung", () => {
		const side = sideOf(
			withSides({ right: [{ key: "a", tabs: ["stats"], pinned: false }] }),
			"right"
		)
		expect(side).toEqual({ mode: "icons", panels: 1 })
		expect(sidePopulated(side)).toBe(true)
	})

	it("a panel holding only a retired widget draws nothing: the side is empty", () => {
		const side = sideOf(withSides({ right: [{ key: "a", tabs: ["inventory"] }] }), "right")
		expect(sidePopulated(side)).toBe(false)
	})

	it("an old-slot layout reads the same, through the converter", () => {
		const side = sideOf(
			{
				arrangedGrid: {
					right: { cols: 1, rows: 12, items: [{ id: "stats", x: 0, y: 0, w: 1, h: 12 }] }
				}
			},
			"right"
		)
		expect(sidePopulated(side)).toBe(true)
	})
})

describe("a layout holding no conversation (R-B, no lock)", () => {
	it("a side of other widgets is populated like any other; nothing makes it the stage", () => {
		expect(sidePopulated({ mode: "rail", panels: 2 })).toBe(true)
		// The stage moves to a side only when `stageOf` says so — with no
		// conversation, only when the middle holds nothing at all.
		expect(sideSlot({ ...base, narrow: true })).toBe("stowed")
		expect(sideSlot(base)).toBe("inline")
	})

	it("the side the stage falls back to, with an empty middle, is drawn as the stage", () => {
		expect(sideSlot({ ...base, narrow: true, stage: true })).toBe("stage")
	})
})
