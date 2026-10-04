import { describe, expect, it } from "vitest"
import {
	STAGE_MEASURE_PX,
	balancedGutters,
	columnInsetPx,
	middleZone,
	stagePlanPx,
	sidesTucked,
	tuckThresholdPx,
	toggleTuckedFlyout,
	tuckedSidesOf,
	type TuckedFlyout
} from "./tuckedSides"
import { MIN_CENTER_PX, emptyColumnsPx } from "./sideSlot"

describe("tuckThresholdPx — derived from the zones' own minimums", () => {
	it("is the sides' footprints, their gaps and the stage's measure", () => {
		// The default right rail (264) + one body gap (8) + the prose measure.
		expect(tuckThresholdPx({ leftPx: 0, rightPx: 264, gapPx: 8 })).toBe(
			264 + 8 + STAGE_MEASURE_PX
		)
		expect(tuckThresholdPx({ leftPx: 264, rightPx: 264, gapPx: 8 })).toBe(
			264 * 2 + 16 + STAGE_MEASURE_PX
		)
	})

	it("is 0 with nothing on either side — there is nothing to tuck", () => {
		expect(tuckThresholdPx({ leftPx: 0, rightPx: 0, gapPx: 8 })).toBe(0)
	})

	it("the stage measure is the conversation's 40rem + 3.5rem column", () => {
		expect(STAGE_MEASURE_PX).toBe(40 * 16 + 3.5 * 16)
	})
})

describe("sidesTucked — the collapse decision, from the CONTAINER width", () => {
	const base = { leftPx: 0, rightPx: 264, gapPx: 8 }

	it("tucks when the sides would squeeze the stage under its measure", () => {
		// 1280 window, 64 rail, 400 dock open → an 816 session box.
		expect(sidesTucked({ ...base, bodyPx: 816 })).toBe(true)
	})

	it("stays docked with room for the sides and the whole measure", () => {
		// 1440 window, sidebar closed → 1376.
		expect(sidesTucked({ ...base, bodyPx: 1376 })).toBe(false)
		expect(sidesTucked({ ...base, bodyPx: 264 + 8 + STAGE_MEASURE_PX })).toBe(
			false
		)
		expect(
			sidesTucked({ ...base, bodyPx: 264 + 8 + STAGE_MEASURE_PX - 1 })
		).toBe(true)
	})

	it("never tucks with nothing docked on either side", () => {
		expect(sidesTucked({ leftPx: 0, rightPx: 0, gapPx: 8, bodyPx: 300 })).toBe(
			false
		)
	})

	it("an unmeasured box (0) is not an answer of 'no room'", () => {
		expect(sidesTucked({ ...base, bodyPx: 0 })).toBe(false)
	})

	it("counts both sides when both are docked", () => {
		const both = { leftPx: 264, rightPx: 264, gapPx: 8 }
		expect(sidesTucked({ ...both, bodyPx: 1200 })).toBe(true)
		expect(sidesTucked({ ...both, bodyPx: 1300 })).toBe(false)
	})
})

describe("balancedGutters — the stage centred in the available width", () => {
	it("gives a side with NO column a gutter matching the docked one (3840 case)", () => {
		// 3840 window less the 64px nav rail; the right side two columns (688)
		// + its gap, and no column on the left — none declared, hidden, or an
		// empty column that gave way. (An EMPTY left keeps its column while
		// there is room, ruled 2026-09-29: see the next case.) No width cap:
		// the body is the whole box.
		const g = balancedGutters({ bodyPx: 3776, startPx: 0, endPx: 696 })
		expect(g).toEqual({ start: 696, end: 0 })
		// Centre box: from 696 to 3776 - 696 → its middle is the body's middle.
		const centreMid = (g.start + (3776 - 696)) / 2
		expect(centreMid).toBe(3776 / 2)
	})

	it("an EMPTY left that keeps its column needs no balance (ruled 2026-09-29)", () => {
		// The same 3840 session with the left empty: its column is the width
		// its first widget will have (688 at this rung) and is granted — so
		// the two ends match and the stage is centred by the columns alone.
		const emptyLeft = emptyColumnsPx({
			hardLeftPx: 0,
			hardRightPx: 688,
			emptyLeftPx: 688,
			emptyRightPx: 0,
			bodyPx: 3776,
			gapPx: 8
		}).left
		expect(emptyLeft).toBe(688)
		expect(
			balancedGutters({ bodyPx: 3776, startPx: emptyLeft + 8, endPx: 696 })
		).toEqual({ start: 0, end: 0 })
	})

	it("balances the heavier left side too", () => {
		expect(balancedGutters({ bodyPx: 2000, startPx: 300, endPx: 100 })).toEqual(
			{ start: 0, end: 200 }
		)
	})

	it("is zero when the sides already match", () => {
		expect(balancedGutters({ bodyPx: 2000, startPx: 272, endPx: 272 })).toEqual(
			{ start: 0, end: 0 }
		)
	})

	it("never squeezes the stage under its measure to balance", () => {
		// 1100 body, 272 on the right: centring would leave 1100 - 544 = 556,
		// under the 696 measure — so it balances only by the spare 132.
		const g = balancedGutters({ bodyPx: 1100, startPx: 0, endPx: 272 })
		expect(g).toEqual({ start: 1100 - 272 - STAGE_MEASURE_PX, end: 0 })
	})

	it("is zero with no spare room at all", () => {
		expect(balancedGutters({ bodyPx: 900, startPx: 0, endPx: 272 })).toEqual({
			start: 0,
			end: 0
		})
	})

	it("honours an explicit stage measure", () => {
		expect(
			balancedGutters({ bodyPx: 1000, startPx: 0, endPx: 300, stagePx: 500 })
		).toEqual({ start: 200, end: 0 })
	})
})

describe("toggleTuckedFlyout — one tucked panel out at a time", () => {
	const a: TuckedFlyout = { side: "right", key: "scene-portraits" }
	const b: TuckedFlyout = { side: "left", key: "notes" }

	it("opens the panel asked for", () => {
		expect(toggleTuckedFlyout(null, a)).toEqual(a)
	})

	it("asking for the open one again closes it", () => {
		expect(toggleTuckedFlyout(a, { ...a })).toBeNull()
	})

	it("opening another closes the first — even across sides", () => {
		expect(toggleTuckedFlyout(a, b)).toEqual(b)
	})

	it("the same key on the other side is a different panel", () => {
		expect(toggleTuckedFlyout(a, { side: "left", key: a.key })).toEqual({
			side: "left",
			key: a.key
		})
	})
})

/* ── the middle zone takes the balance (ruled 2026-09-27) ──────────────── */

describe("middleZone — the middle takes the balance, the column its measure", () => {
	const gap = 8
	/** Body coords of the column's centre, as the CSS draws it. */
	function columnCentre(body: number, start: number, end: number): number {
		const z = middleZone({ bodyPx: body, startPx: start, endPx: end })
		const column = Math.min(STAGE_MEASURE_PX, z.middlePx)
		return (
			z.startPx +
			columnInsetPx({ middlePx: z.middlePx, columnPx: column, balance: z.balance }) +
			column / 2
		)
	}

	it("spans everything between the sides: no band outside the middle", () => {
		// 1440 less the 64px app rail; the right side at its ladder, the left empty.
		const body = 1376
		const side = 264
		const z = middleZone({ bodyPx: body, startPx: 0, endPx: side + gap })
		expect(z.startPx).toBe(0)
		expect(z.startPx + z.middlePx).toBe(body - side - gap)
		// The balance is inside the middle — the widget over it covers the
		// former gutter — and with the side at its ladder there is room for
		// all of it: the whole difference between the ends.
		expect(z.middlePx).toBe(body - side - gap)
		expect(z.balance.start).toBe(side + gap)
		expect(z.middlePx).toBeGreaterThan(STAGE_MEASURE_PX + z.balance.start)
	})

	it("the column is centred on the body at every desktop width (sides at their ladder)", () => {
		for (const body of [1376, 1856, 2496, 3776]) {
			const side = 264
			expect(Math.abs(columnCentre(body, 0, side + gap) - body / 2)).toBeLessThanOrEqual(0.5)
			expect(Math.abs(columnCentre(body, side + gap, 0) - body / 2)).toBeLessThanOrEqual(0.5)
			// Both sides docked: no balance needed, still centred.
			const both = middleZone({ bodyPx: body, startPx: side + gap, endPx: side + gap })
			expect(both.balance).toEqual({ start: 0, end: 0 })
			expect(Math.abs(columnCentre(body, side + gap, side + gap) - body / 2)).toBeLessThanOrEqual(0.5)
		}
	})

	it("tucked rails: a one-sided rail is balanced inside the middle", () => {
		// ~1280 with the sidebar open: the right side tucked to a 48px rail.
		const body = 960
		const z = middleZone({ bodyPx: body, startPx: 0, endPx: 48 + gap })
		expect(z.balance).toEqual({ start: 56, end: 0 })
		expect(z.startPx + z.middlePx).toBe(body - 56)
		expect(columnCentre(body, 0, 56)).toBe(body / 2)
	})

	it("too tight to centre: the column keeps its measure and hugs the far end", () => {
		// 1000 body, 272 on the right: 32px spare; the column shifts by all of it.
		const z = middleZone({ bodyPx: 1000, startPx: 0, endPx: 272 })
		expect(z.middlePx).toBe(728)
		expect(z.balance).toEqual({ start: 32, end: 0 })
		expect(
			columnInsetPx({ middlePx: 728, columnPx: STAGE_MEASURE_PX, balance: z.balance })
		).toBe(32)
	})

	it("a middle narrower than the column: no inset, the column fills it", () => {
		expect(
			columnInsetPx({ middlePx: 500, columnPx: 500, balance: { start: 0, end: 0 } })
		).toBe(0)
	})
})

describe("stagePlanPx — a classic scrollbar is planned for, so the rows centre too", () => {
	const gap = 8
	it("is the measure plus a scrollbar's width on each edge", () => {
		expect(stagePlanPx(0)).toBe(STAGE_MEASURE_PX)
		expect(stagePlanPx(15)).toBe(STAGE_MEASURE_PX + 30)
	})
	it("right side at its ladder, 15px scrollbar kept on both edges: rows and composer on the body's centre", () => {
		const sb = 15
		for (const body of [1376, 1856, 2496, 3776]) {
			const plan = stagePlanPx(sb)
			const side = 264
			const z = middleZone({ bodyPx: body, startPx: 0, endPx: side + gap, stagePx: plan })
			const W = STAGE_MEASURE_PX
			// The composer: the widget's full width.
			const composer = z.startPx + columnInsetPx({ middlePx: z.middlePx, columnPx: W, balance: z.balance })
			// The rows: inside a region that keeps `sb` on both edges.
			const rows =
				z.startPx + sb +
				columnInsetPx({ middlePx: z.middlePx - 2 * sb, columnPx: W, balance: z.balance })
			expect(Math.abs(composer + W / 2 - body / 2)).toBeLessThanOrEqual(1)
			expect(Math.abs(rows - composer)).toBeLessThanOrEqual(1)
		}
	})
})

describe("tuckedSidesOf — the side holding the log never tucks (brief 7a review)", () => {
	const rail = 264
	const gap = 8
	it("with the log in the middle, both sides tuck together, exactly as before", () => {
		const o = { leftPx: rail, rightPx: rail, gapPx: gap, logSide: null, middleMinPx: MIN_CENTER_PX }
		const need = tuckThresholdPx(o)
		expect(tuckedSidesOf({ ...o, bodyPx: need - 1 })).toEqual({ left: true, right: true })
		expect(tuckedSidesOf({ ...o, bodyPx: need })).toEqual({ left: false, right: false })
	})

	it("Adventure with the log moved left, at a 1280 window: nothing tucks", () => {
		// Seen live: 264 + 264 + gaps + the log's measure (≈1250) tucked a
		// ~1216px body, and the log became a rail icon. The middle holds no
		// log now, so it is owed the centre's reserve, not the log's measure.
		const o = { leftPx: rail, rightPx: rail, gapPx: gap, logSide: "left" as const, middleMinPx: MIN_CENTER_PX }
		expect(tuckedSidesOf({ ...o, bodyPx: 1216 })).toEqual({ left: false, right: false })
	})

	it("tight enough that the middle's reserve is at stake: the OTHER side tucks, the log's never", () => {
		const o = { leftPx: rail, rightPx: rail, gapPx: gap, middleMinPx: MIN_CENTER_PX }
		const need = rail + rail + 2 * gap + MIN_CENTER_PX
		expect(tuckedSidesOf({ ...o, logSide: "left", bodyPx: need - 1 })).toEqual({ left: false, right: true })
		expect(tuckedSidesOf({ ...o, logSide: "right", bodyPx: need - 1 })).toEqual({ left: true, right: false })
	})

	it("the log alone in the right rail of a ~966px body (a 1030 window): it stays a rail", () => {
		// Seen live: the Chat session with Messages in the right tucked at
		// 1030×800 and drew a World State strip over a blank body.
		const o = { leftPx: 0, rightPx: rail, gapPx: gap, logSide: "right" as const, middleMinPx: MIN_CENTER_PX }
		expect(tuckedSidesOf({ ...o, bodyPx: 966 }).right).toBe(false)
	})
})
