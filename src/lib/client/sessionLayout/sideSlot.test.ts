import { describe, it, expect } from "vitest"
import {
	sideSlot,
	sideFlowPx,
	inlineSideWidths,
	MIN_MARGIN_PX,
	MIN_CENTER_PX,
	type SideSlotInput
} from "./sideSlot"

/** Desktop, no margins reclaimed, overlay closed — the plain rail case. */
const base: SideSlotInput = {
	narrow: false,
	overlayOwns: false,
	marginMode: false,
	marginFree: false,
	marginPx: 0
}

describe("sideSlot — one mount, four places", () => {
	it("sits in the flow on a plain desktop", () => {
		expect(sideSlot(base)).toBe("inline")
	})

	it("moves to the reclaimed margin when one is free and wide enough", () => {
		expect(
			sideSlot({
				...base,
				marginMode: true,
				marginFree: true,
				marginPx: MIN_MARGIN_PX + 1
			})
		).toBe("margin")
	})

	it("stows — never unmounts — when the margin is taken or too thin", () => {
		// A sidebar panel opened into the margin.
		expect(
			sideSlot({
				...base,
				marginMode: true,
				marginFree: false,
				marginPx: 300
			})
		).toBe("stowed")
		// The margin exists but is a sliver.
		expect(
			sideSlot({
				...base,
				marginMode: true,
				marginFree: true,
				marginPx: MIN_MARGIN_PX
			})
		).toBe("stowed")
	})

	it("stows below the breakpoint: no layout space, but still mounted", () => {
		expect(sideSlot({ ...base, narrow: true })).toBe("stowed")
		// The margin rule never outranks the breakpoint.
		expect(
			sideSlot({
				...base,
				narrow: true,
				marginMode: true,
				marginFree: true,
				marginPx: 400
			})
		).toBe("stowed")
	})

	it("hands the mount to the overlay dialog, rather than standing down", () => {
		// It used to answer "none" here — the overlay rendered that side a
		// SECOND time, so opening it reloaded every iframe in the side. The
		// dialog is now a container class on the one mount.
		expect(sideSlot({ ...base, narrow: true, overlayOwns: true })).toBe(
			"overlay"
		)
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

	it("walks stowed → margin → overlay → stowed without ever leaving the mount", () => {
		// The whole trip a side takes in one session: parked while a sidebar
		// holds its margin, docked when that closes, carried into the mobile
		// sheet on a rotate, and parked again when the sheet shuts. Every step
		// is a CONTAINER, so the subtree that moves between them is the same
		// one throughout — there is deliberately no value here that means "not
		// rendered", which is what makes the no-reload law hold by
		// construction rather than by remembering.
		const wide = { ...base, marginMode: true, marginPx: 400 }
		const trip: SideSlotInput[] = [
			{ ...wide, marginFree: false },
			{ ...wide, marginFree: true },
			{ ...wide, marginFree: true, narrow: true, overlayOwns: true },
			{ ...wide, marginFree: true, narrow: true }
		]
		expect(trip.map(sideSlot)).toEqual([
			"stowed",
			"margin",
			"overlay",
			"stowed"
		])
	})

	it("crossing the breakpoint and back never leaves the mount", () => {
		const wide = { ...base, marginMode: true, marginFree: true, marginPx: 400 }
		const narrow = { ...wide, narrow: true }
		expect([sideSlot(wide), sideSlot(narrow), sideSlot(wide)]).toEqual([
			"margin",
			"stowed",
			"margin"
		])
	})
})

describe("inlineSideWidths — an arranged side in the flow", () => {
	// 1838px viewport, `.session-layout` measures 1822: the ladder answers
	// 264px for both sides (DEFAULT_SIDE_RULES, below the 1900 step).
	const at1838 = { left: 264, right: 264, bodyPx: 1822, gapPx: 8 }

	it("gives each side the ladder width and the centre the rest", () => {
		expect(inlineSideWidths(at1838)).toEqual({ left: 264, right: 264 })
	})

	it("leaves a side that is not an in-flow arranged grid at zero", () => {
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
	const inline = {
		slot: "inline" as const,
		arranged: false,
		arrangedPx: 0,
		railPx: [] as number[]
	}

	it("reports an arranged side's grid footprint", () => {
		expect(
			sideFlowPx({ ...inline, arranged: true, arrangedPx: 264 })
		).toBe(264)
	})

	it("reports an UN-arranged side's rail — the same starvation, one step later", () => {
		// `.zone-rail` is `flex: none` at the ladder's width and
		// `.layout-center` is `min-inline-size: 0`: nothing clamped this path
		// either, it just took a narrower desktop to reach.
		expect(sideFlowPx({ ...inline, railPx: [264] })).toBe(264)
	})

	it("reports the widest rail when a side draws more than one", () => {
		expect(sideFlowPx({ ...inline, railPx: [264, 300] })).toBe(300)
	})

	it("is zero for a side that draws no rail (icon strip / empty)", () => {
		expect(sideFlowPx(inline)).toBe(0)
	})

	it("is zero for every slot that is not in the body's row", () => {
		const drawn = {
			...inline,
			arranged: true,
			arrangedPx: 264,
			railPx: [264]
		}
		expect([
			sideFlowPx({ ...drawn, slot: "margin" }),
			sideFlowPx({ ...drawn, slot: "stowed" }),
			sideFlowPx({ ...drawn, slot: "overlay" })
		]).toEqual([0, 0, 0])
	})
})

describe("the mixed pair — one side arranged, one side a rail", () => {
	it("computes the centre's reserve ONCE for the body, whichever path each side takes", () => {
		// 900 wide: an arranged 264 grid on the left, a 344x2 rail on the right.
		const left = sideFlowPx({
			slot: "inline",
			arranged: true,
			arrangedPx: 264,
			railPx: []
		})
		const right = sideFlowPx({
			slot: "inline",
			arranged: false,
			arrangedPx: 0,
			railPx: [688]
		})
		expect([left, right]).toEqual([264, 688])
		const w = inlineSideWidths({ left, right, bodyPx: 900, gapPx: 8 })
		// 900 - 16 of gap - 360 reserved = 524 to share between 952 asked.
		expect(w.left + w.right).toBeLessThanOrEqual(524)
		expect(900 - 16 - w.left - w.right).toBeGreaterThanOrEqual(
			MIN_CENTER_PX
		)
		// Shrunk in proportion, not one side sacrificed for the other.
		expect(w.left).toBe(Math.floor(264 * (524 / 952)))
		expect(w.right).toBe(Math.floor(688 * (524 / 952)))
	})

	it("a stowed side reserves nothing, so the drawn one keeps its ladder", () => {
		const left = sideFlowPx({
			slot: "stowed",
			arranged: true,
			arrangedPx: 264,
			railPx: []
		})
		const right = sideFlowPx({
			slot: "inline",
			arranged: false,
			arrangedPx: 0,
			railPx: [264]
		})
		expect(
			inlineSideWidths({ left, right, bodyPx: 900, gapPx: 8 })
		).toEqual({ left: 0, right: 264 })
	})
})
