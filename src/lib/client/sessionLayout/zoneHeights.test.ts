import { describe, expect, test } from "vitest"
import {
	allocateZone,
	cssTrackOf,
	floorOf,
	type ZonePanelIn
} from "./zoneHeights"

const fit = (
	key: string,
	wantPx: number | null,
	priority: ZonePanelIn["priority"] = "normal"
): ZonePanelIn => ({
	key,
	height: "fit",
	priority,
	wantPx,
	floorPx: floorOf({ height: "fit", isMessages: false, wantPx })
})
const messages = (priority: ZonePanelIn["priority"] = "low"): ZonePanelIn => ({
	key: "messages",
	height: "fill",
	priority,
	wantPx: null,
	floorPx: 160
})
const fill = (key: string): ZonePanelIn => ({
	key,
	height: "fill",
	priority: "normal",
	wantPx: null,
	floorPx: 0
})
const share = (
	key: string,
	s: number,
	priority: ZonePanelIn["priority"] = "normal"
): ZonePanelIn => ({
	key,
	height: { share: s },
	priority,
	wantPx: null,
	floorPx: 0
})
const pxOf = (r: ReturnType<typeof allocateZone>, key: string) =>
	r!.find((p) => p.key === key)!.px

describe("floorOf", () => {
	test("messages 160, fit min(want,120), others 0", () => {
		expect(
			floorOf({ height: "fill", isMessages: true, wantPx: null })
		).toBe(160)
		expect(floorOf({ height: "fit", isMessages: false, wantPx: 80 })).toBe(
			80
		)
		expect(floorOf({ height: "fit", isMessages: false, wantPx: 400 })).toBe(
			120
		)
		expect(
			floorOf({ height: { share: 3 }, isMessages: false, wantPx: null })
		).toBe(0)
	})
})

describe("allocateZone", () => {
	test("unmeasured gives null", () => {
		expect(
			allocateZone({ columnPx: 0, gapPx: 8, panels: [messages()] })
		).toBeNull()
		expect(
			allocateZone({
				columnPx: 800,
				gapPx: 8,
				panels: [fit("c", null), messages()]
			})
		).toBeNull()
	})

	test("floors overflowing the column: everyone gets the floor, fit scrolls", () => {
		const r = allocateZone({
			columnPx: 200,
			gapPx: 0,
			panels: [fit("c", 300, "high"), messages()]
		})!
		expect(r.map((p) => p.px)).toEqual([120, 160])
		expect(r[0].scrolls).toBe(true)
		expect(r[1].scrolls).toBe(false)
	})

	test("composer grows until messages hit 160, then scrolls", () => {
		const panels = [
			fit("composer", 200, "high"),
			fit("turn", 40),
			messages()
		]
		const roomy = allocateZone({ columnPx: 700, gapPx: 0, panels })!
		expect(roomy.map((p) => p.px)).toEqual([200, 40, 460])
		expect(roomy[0].scrolls).toBe(false)
		const tight = allocateZone({ columnPx: 360, gapPx: 0, panels })!
		expect(tight.map((p) => p.px)).toEqual([160, 40, 160])
		expect(tight[0].scrolls).toBe(true)
	})

	test("low gives way before normal", () => {
		const r = allocateZone({
			columnPx: 300,
			gapPx: 0,
			panels: [
				{ ...fit("n", 200, "normal"), floorPx: 0 },
				{ ...fit("l", 200, "low"), floorPx: 0 }
			]
		})!
		expect(r.map((p) => p.px)).toEqual([200, 100])
		expect(r[1].scrolls).toBe(true)
		expect(r[0].scrolls).toBe(false)
	})

	test("two fills split evenly", () => {
		const r = allocateZone({
			columnPx: 500,
			gapPx: 0,
			panels: [fill("a"), fill("b")]
		})!
		expect(r.map((p) => p.px)).toEqual([250, 250])
		expect(r.every((p) => !p.scrolls)).toBe(true)
	})

	test("no fill leaves space at the foot", () => {
		const r = allocateZone({
			columnPx: 500,
			gapPx: 0,
			panels: [fit("a", 100)]
		})!
		expect(r[0].px).toBe(100)
	})

	test("share holds when there is room", () => {
		const r = allocateZone({
			columnPx: 600,
			gapPx: 0,
			panels: [share("s", 6), fill("f")]
		})!
		expect(r.map((p) => p.px)).toEqual([300, 300])
		expect(r[0].scrolls).toBe(false)
	})

	test("share shrinks on overflow by tier", () => {
		const r = allocateZone({
			columnPx: 600,
			gapPx: 0,
			panels: [share("hi", 8, "high"), share("lo", 8, "low")]
		})!
		expect(r.map((p) => p.px)).toEqual([400, 200])
		expect(r.map((p) => p.scrolls)).toEqual([false, true])
	})

	test("rounding never exceeds avail", () => {
		const r = allocateZone({
			columnPx: 100,
			gapPx: 0,
			panels: [fill("a"), fill("b"), fill("c")]
		})!
		const sum = r.reduce((a, p) => a + p.px, 0)
		expect(sum).toBe(100)
		expect(r.every((p) => Number.isInteger(p.px))).toBe(true)
		const s = allocateZone({
			columnPx: 101,
			gapPx: 0,
			panels: [share("a", 5), share("b", 5)]
		})!
		expect(s.reduce((a, p) => a + p.px, 0) <= 101).toBe(true)
	})

	test("gap counted n-1 times", () => {
		const r = allocateZone({
			columnPx: 520,
			gapPx: 10,
			panels: [fill("a"), fill("b"), fill("c")]
		})!
		expect(r.reduce((a, p) => a + p.px, 0)).toBe(500)
	})

	test("input not mutated; same input same output", () => {
		const panels = [fit("c", 200, "high"), messages()]
		const copy = JSON.stringify(panels)
		const a = allocateZone({ columnPx: 600, gapPx: 8, panels })
		const b = allocateZone({ columnPx: 600, gapPx: 8, panels })
		expect(JSON.stringify(panels)).toBe(copy)
		expect(a).toEqual(b)
	})
})

describe("cssTrackOf", () => {
	test("first-frame tracks", () => {
		expect(cssTrackOf({ height: "fill", isMessages: true })).toBe(
			"minmax(160px, 1fr)"
		)
		expect(cssTrackOf({ height: "fill", isMessages: false })).toBe(
			"minmax(0, 1fr)"
		)
		expect(cssTrackOf({ height: "fit", isMessages: false })).toBe(
			"minmax(120px, auto)"
		)
		expect(cssTrackOf({ height: { share: 4 }, isMessages: false })).toBe(
			"minmax(0, calc(4 / 12 * 100%))"
		)
		expect(cssTrackOf({ height: { share: 99 }, isMessages: false })).toBe(
			"minmax(0, calc(12 / 12 * 100%))"
		)
	})
})

describe("an empty Fit panel (want 0)", () => {
	test("floor 0 and 0 px, no floor applied", () => {
		expect(floorOf({ height: "fit", isMessages: false, wantPx: 0 })).toBe(0)
		const r = allocateZone({
			columnPx: 600,
			gapPx: 8,
			panels: [fill("m"), fit("turn", 0, "high")]
		})
		expect(pxOf(r, "turn")).toBe(0)
	})

	test("a Fill neighbour gets the room", () => {
		const r = allocateZone({
			columnPx: 600,
			gapPx: 0,
			panels: [fill("m"), fit("turn", 0), fit("composer", 80)]
		})
		expect(pxOf(r, "turn")).toBe(0)
		expect(pxOf(r, "composer")).toBe(80)
		expect(pxOf(r, "m")).toBe(520)
	})
})
