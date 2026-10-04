/**
 * The Move tab's arrangement round trip: a saved arrangement must come back
 * out of the blob intact, be drawable in a zone of ANY size, and — this is the
 * one that bit — never be quietly rewritten by the size the editor happened to
 * be opened at.
 */
import { describe, expect, it } from "vitest"
import {
	arrangedIds,
	clampFrame,
	clampPos,
	dedupeArranged,
	firstSlot,
	fits,
	frameCovers,
	itemPinned,
	loadArranged,
	makeRoom,
	MIN_CARD_ROWS,
	reexpress,
	seatCard,
	seedPositions,
	showZonePin,
	unitPinned,
	withGeometry,
	withPins
} from "./arrangedGeometry"
import type { ArrangedGridV1, ArrangedItem, ArrangedZone } from "@serene-pub/sdk"
import type { GsItem } from "./gsItem"

const pos = (
	id: string,
	x: number,
	y: number,
	w: number,
	h: number
): ArrangedItem => ({
	id,
	x,
	y,
	w,
	h
})
/** Rows a placed item occupies, as a closed range — the overlap test's unit. */
const rowsOf = (p: ArrangedItem) => [p.y, p.y + p.h - 1]
function overlaps(a: ArrangedItem, b: ArrangedItem): boolean {
	return (
		a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
	)
}

describe("loadArranged — the verbatim blob, defensively", () => {
	it("keeps a well-formed zone, anchors and groups included", () => {
		const saved = {
			left: {
				cols: 9,
				rows: 37,
				items: [
					{
						id: "map",
						x: 0,
						y: 8,
						w: 9,
						h: 3,
						anchor: { top: true },
						group: "g:map+notes"
					}
				]
			}
		}
		const out = loadArranged(saved)
		expect(out.left).toEqual(saved.left)
		expect(out.left!.items[0].group).toBe("g:map+notes")
	})

	it("drops malformed zones and malformed items instead of throwing", () => {
		const out = loadArranged({
			left: {
				cols: 9,
				rows: 37,
				items: [pos("map", 0, 0, 9, 3), { id: "x" }]
			},
			middle: { cols: "wide", rows: 3, items: [] },
			right: null
		})
		expect(out.left!.items.map((i) => i.id)).toEqual(["map"])
		expect(out.middle).toBeUndefined()
		expect(out.right).toBeUndefined()
	})

	it("yields nothing at all for junk (the never-edited session)", () => {
		for (const junk of [undefined, null, 7, "nope"])
			expect(loadArranged(junk)).toEqual({})
	})

	it("drops a retired widget id and keeps the zone's cells", () => {
		// An arrangement captured when the composer was its own widget. Every
		// reader of a saved arrangement comes through here, so dropping it once
		// keeps an empty card out of the live render, the editor and the
		// preset picture alike.
		const out = loadArranged({
			middle: {
				cols: 18,
				rows: 34,
				items: [
					pos("messages", 0, 0, 18, 31),
					pos("composer", 0, 31, 18, 3)
				]
			}
		})
		expect(out.middle!.items).toEqual([pos("messages", 0, 0, 18, 31)])
		expect(out.middle!.cols).toBe(18)
		expect(out.middle!.rows).toBe(34)
	})
})

describe("withGeometry — the saved cells laid over the editor's items", () => {
	const items: GsItem[] = [
		{ id: "messages", title: "Messages", place: "fill" },
		{ id: "world-state", title: "World State", place: "bottom", h: 3 }
	]

	it("overlays x/y/w/h for a saved item and leaves an unsaved one alone", () => {
		const out = withGeometry(items, {
			cols: 18,
			rows: 34,
			items: [pos("messages", 0, 0, 18, 31)]
		})
		expect(out[0]).toMatchObject({
			x: 0,
			y: 0,
			w: 18,
			h: 31,
			place: "fill"
		})
		expect(out[1]).toEqual(items[1])
	})

	it("carries anchors and group membership across the round trip", () => {
		const out = withGeometry(items, {
			cols: 18,
			rows: 34,
			items: [
				{
					...pos("world-state", 0, 31, 18, 3),
					anchor: { bottom: true },
					group: "g:world-state+messages"
				}
			]
		})
		expect(out[1].anchor).toEqual({ bottom: true })
		expect(out[1].group).toBe("g:world-state+messages")
	})

	it("is a no-op without a saved zone", () => {
		expect(withGeometry(items, undefined)).toBe(items)
	})
})

describe("frameCovers — is this zone a RESTORE or an edit?", () => {
	const frame: ArrangedZone = {
		cols: 9,
		rows: 37,
		items: [pos("map", 0, 8, 9, 3), pos("notes", 0, 12, 9, 3)]
	}
	const item = (id: string): GsItem => ({ id, title: id })

	it("covers exactly the items it saved", () => {
		expect(frameCovers([item("map"), item("notes")], frame)).toBe(true)
	})

	it("does not cover a zone a widget was just added to", () => {
		expect(
			frameCovers([item("map"), item("notes"), item("cast")], frame)
		).toBe(false)
	})

	it("does not cover a zone a widget was just removed from", () => {
		expect(frameCovers([item("map")], frame)).toBe(false)
	})

	it("is false with no saved frame at all", () => {
		expect(frameCovers([item("map")], undefined)).toBe(false)
	})
})

describe("seedPositions — default placement (nothing saved yet)", () => {
	const chat: GsItem[] = [
		{ id: "messages", title: "Messages", place: "fill" },
		{ id: "world-state", title: "World State", place: "bottom", h: 3 }
	]

	it("fills the middle above a bottom-docked strip, full width", () => {
		const out = seedPositions(chat, 18, 34)
		expect(out).toEqual([
			pos("messages", 0, 0, 18, 31),
			pos("world-state", 0, 31, 18, 3)
		])
		expect(overlaps(out[0], out[1])).toBe(false)
	})

	it("stacks plain items from the top", () => {
		const out = seedPositions(
			[
				{ id: "map", title: "Map", h: 3 },
				{ id: "notes", title: "Notes", h: 3 }
			],
			9,
			37
		)
		expect(out.map((p) => p.y)).toEqual([0, 3])
	})

	it("seeds an item with no saved geometry below one placed explicitly, not on top of it", () => {
		const out = seedPositions(
			[
				{ id: "map", title: "Map", x: 0, y: 2, w: 9, h: 3 },
				{ id: "notes", title: "Notes", h: 3 }
			],
			9,
			37
		)
		expect(out[0]).toEqual(pos("map", 0, 2, 9, 3))
		expect(out[1].y).toBeGreaterThanOrEqual(5)
		expect(overlaps(out[0], out[1])).toBe(false)
	})
})

describe("seedPositions — a saved arrangement drawn in a SMALLER zone", () => {
	// The real numbers from the running app: a middle zone arranged in an
	// 1838×1889 window (18 × 34 cells) reopened in a 1400×1000 one (14 × 15).
	const frame: ArrangedZone = {
		cols: 18,
		rows: 34,
		items: [pos("messages", 0, 0, 18, 31), pos("world-state", 0, 31, 18, 3)]
	}
	const items = withGeometry(
		[
			{ id: "messages", title: "Messages", place: "fill" },
			{ id: "world-state", title: "World State", place: "bottom", h: 3 }
		],
		frame
	)

	it("re-expresses the arrangement instead of piling cards on each other", () => {
		const out = seedPositions(items, 14, 15, frame)
		expect(overlaps(out[0], out[1])).toBe(false)
	})

	it("keeps the order it was arranged in — the strip still under messages", () => {
		const [messages, strip] = seedPositions(items, 14, 15, frame)
		expect(rowsOf(messages)[1]).toBeLessThan(rowsOf(strip)[0])
		expect(strip.y + strip.h).toBe(15)
	})

	it("keeps every card inside the zone", () => {
		for (const p of seedPositions(items, 14, 15, frame)) {
			expect(p.x).toBeGreaterThanOrEqual(0)
			expect(p.y).toBeGreaterThanOrEqual(0)
			expect(p.x + p.w).toBeLessThanOrEqual(14)
			expect(p.y + p.h).toBeLessThanOrEqual(15)
			expect(p.w).toBeGreaterThan(0)
			expect(p.h).toBeGreaterThan(0)
		}
	})

	it("touches nothing when the zone is the size it was arranged in", () => {
		expect(seedPositions(items, 18, 34, frame)).toEqual(frame.items)
	})

	it("spreads back out when the window returns to the size it was arranged at", () => {
		// A side zone with a card parked low: squeezed into a short zone and
		// then given the room back, it lands where it started.
		const side: ArrangedZone = {
			cols: 9,
			rows: 37,
			items: [pos("map", 0, 24, 9, 6)]
		}
		const one = withGeometry([{ id: "map", title: "Map", h: 3 }], side)
		const narrow = seedPositions(one, 6, 18, side)
		expect(narrow[0].y + narrow[0].h).toBeLessThanOrEqual(18)
		const back = seedPositions(
			withGeometry([{ id: "map", title: "Map", h: 3 }], side),
			9,
			37,
			side
		)
		expect(back).toEqual(side.items)
	})

	it("still places a widget added since, alongside the restored ones", () => {
		const mixed = withGeometry(
			[
				{ id: "messages", title: "Messages", place: "fill" },
				{ id: "world-state", title: "World State", place: "bottom", h: 3 },
				{ id: "cast", title: "Cast", h: 3 }
			],
			frame
		)
		const out = seedPositions(mixed, 14, 15, frame)
		expect(out.map((p) => p.id)).toEqual([
			"messages",
			"world-state",
			"cast"
		])
		expect(out[2].h).toBeGreaterThan(0)
	})
})

describe("reexpress — a zone RE-MEASURED, not re-seeded", () => {
	// A side zone arranged in a wide window: two cards side by side over a
	// full-width one. Deliberately odd numbers — an even grid halves and
	// doubles exactly, which would hide the lossiness the reference exists to
	// avoid.
	const wide: ArrangedZone = {
		cols: 9,
		rows: 12,
		items: [
			pos("map", 0, 0, 5, 4),
			pos("notes", 5, 0, 4, 4),
			pos("cast", 0, 4, 9, 8)
		]
	}
	/** The same arrangement as a phone-width zone draws it. */
	const squeezed = [
		pos("map", 0, 0, 2, 2),
		pos("notes", 2, 0, 1, 2),
		pos("cast", 0, 2, 3, 4)
	]

	it("squeezes the whole arrangement into a narrow zone, sharing no cell", () => {
		const out = reexpress(wide, 3, 6)
		expect(out).toEqual(squeezed)
		for (const a of out)
			for (const b of out)
				if (a !== b) expect(overlaps(a, b)).toBe(false)
	})

	it("is the identity in the zone it was arranged in", () => {
		expect(reexpress(wide, 9, 12)).toEqual(wide.items)
	})

	it("comes back INTACT through narrow → wide, from the same reference", () => {
		reexpress(wide, 3, 6) // the squeeze (a preview, a dragged sidebar)
		expect(reexpress(wide, 9, 12)).toEqual(wide.items)
	})

	it("would NOT come back from the last clamp — why the reference is held", () => {
		// Re-expressing from what the narrow zone drew (gridstack's own
		// re-column, or a reference updated by the re-measure itself) rounds
		// the arrangement away: this is the layout-destroying path, pinned.
		const clamp: ArrangedZone = { cols: 3, rows: 6, items: squeezed }
		const back = reexpress(clamp, 9, 12)
		expect(back).not.toEqual(wide.items)
		expect(back[0]).toEqual(pos("map", 0, 0, 6, 4))
		expect(back[1]).toEqual(pos("notes", 6, 0, 3, 4))
	})

	it("keeps every card inside a zone of any size", () => {
		for (const [c, r] of [
			[1, 1],
			[2, 30],
			[40, 3],
			[9, 12]
		]) {
			for (const p of reexpress(wide, c, r)) {
				expect(p.x).toBeGreaterThanOrEqual(0)
				expect(p.y).toBeGreaterThanOrEqual(0)
				expect(p.w).toBeGreaterThan(0)
				expect(p.h).toBeGreaterThan(0)
				expect(p.x + p.w).toBeLessThanOrEqual(c)
				expect(p.y + p.h).toBeLessThanOrEqual(r)
			}
		}
	})

	it("re-expresses an empty zone to nothing rather than throwing", () => {
		expect(reexpress({ cols: 4, rows: 4, items: [] }, 2, 2)).toEqual([])
	})
})

/**
 * PER-GROUP PIN (ruled 2026-09-10). The pin used to be the ZONE's, so every
 * group in a side column shared it and the Move tab's per-group toggle died
 * with the page. It is now a field on the arranged ITEM, and these are the two
 * halves of that promise: an arrangement saved before the field existed still
 * reads as everything pinned, and a group the user unpinned comes back
 * unpinned.
 */
describe("the persisted per-group pin", () => {
	const zone = (items: ArrangedItem[]): ArrangedZone => ({ cols: 9, rows: 12, items })
	/** Through the wire the blob actually takes: a json column. */
	const roundTrip = (a: unknown) =>
		loadArranged(JSON.parse(JSON.stringify(a)))

	it("reads a LEGACY arrangement — no pin field anywhere — as all pinned", () => {
		const saved = {
			left: zone([
				pos("map", 0, 0, 9, 4),
				{ ...pos("notes", 0, 4, 9, 4), group: "g:notes+cast" },
				{ ...pos("cast", 0, 8, 9, 4), group: "g:notes+cast" }
			])
		}
		const out = roundTrip(saved)
		expect(out.left!.items.every(itemPinned)).toBe(true)
		expect(unitPinned(out.left!.items.slice(1))).toBe(true)
	})

	it("carries one group's unpin through save → load", () => {
		const before = { left: zone([pos("map", 0, 0, 9, 4), pos("notes", 0, 4, 9, 4)]) }
		const after = {
			left: withPins(before.left, ["notes"], false)
		}
		const out = roundTrip(after)
		expect(out.left!.items.map(itemPinned)).toEqual([true, false])
	})

	it("writes every member of a tab group, so the group reads as one", () => {
		const g = zone([
			{ ...pos("notes", 0, 0, 5, 4), group: "g:notes+cast" },
			{ ...pos("cast", 5, 0, 4, 4), group: "g:notes+cast" }
		])
		const out = roundTrip({ left: withPins(g, ["notes", "cast"], false) })
		expect(unitPinned(out.left!.items)).toBe(false)
	})

	it("stores a PIN as the absence of the field — absent is the default", () => {
		const off = withPins(zone([pos("map", 0, 0, 9, 4)]), ["map"], false)
		const on = withPins(off, ["map"], true)
		expect(JSON.stringify(off)).toContain('"pinned":false')
		expect(JSON.stringify(on)).not.toContain("pinned")
		expect(unitPinned(roundTrip({ left: on }).left!.items)).toBe(true)
	})

	it("leaves the items it was not asked about alone", () => {
		const z = zone([pos("map", 0, 0, 9, 4), pos("notes", 0, 4, 9, 4)])
		const out = withPins(z, ["map"], false)
		expect(out.items[1]).toBe(z.items[1])
		expect(z.items[0].pinned).toBeUndefined()
	})

	it("reads a group as pinned unless EVERY member says otherwise", () => {
		// Regrouping a pinned widget with an unpinned one: the default wins,
		// which is the same reading a legacy arrangement gets.
		const mixed = withPins(
			zone([
				{ ...pos("notes", 0, 0, 5, 4), group: "g" },
				{ ...pos("cast", 5, 0, 4, 4), group: "g" }
			]),
			["notes"],
			false
		)
		expect(unitPinned(mixed.items)).toBe(true)
	})

	it("lays a saved pin back over the editor's items (withGeometry)", () => {
		const items: GsItem[] = [
			{ id: "map", title: "Map", h: 3 },
			{ id: "notes", title: "Notes", h: 3 }
		]
		const saved = withPins(
			zone([pos("map", 0, 0, 9, 4), pos("notes", 0, 4, 9, 4)]),
			["notes"],
			false
		)
		const out = withGeometry(items, saved)
		expect(out.map(itemPinned)).toEqual([true, false])
	})
})

describe("showZonePin — the zone-wide pin only means something un-arranged", () => {
	const zone = (items: ArrangedItem[]): ArrangedZone => ({ cols: 9, rows: 12, items })

	it("shows on a side with no saved arrangement (governs the rail vs icons)", () => {
		expect(showZonePin(undefined)).toBe(true)
	})

	it("hides once a side has a saved frame — arrangedSide ignores it there", () => {
		expect(showZonePin(zone([pos("map", 0, 0, 9, 4)]))).toBe(false)
	})

	it("hides even for a frame with no items (still a reported arrangement)", () => {
		expect(showZonePin(zone([]))).toBe(false)
	})
})

/**
 * The commit's invariant. A widget dragged between zones used to be reported by
 * the DESTINATION only — the source zone's `dragstop` fires on the destination
 * grid, so the source stayed a "restore" and kept the card — and the commit
 * wrote the same widget into two zones' widget lists. The source-side report is
 * fixed at the seam; this is the net that says so if it ever tears again.
 */
describe("dedupeArranged — a widget id lives in exactly one zone", () => {
	const zone = (...items: ArrangedItem[]): ArrangedZone => ({ cols: 7, rows: 12, items })

	it("leaves a clean arrangement alone, object identity included", () => {
		const a: ArrangedGridV1 = {
			left: zone(pos("stats", 0, 0, 7, 3)),
			right: zone(pos("portraits", 0, 0, 7, 3))
		}
		const out = dedupeArranged(a)
		expect(out.duplicates).toEqual([])
		expect(out.arranged).toBe(a)
	})

	it("keeps the zone the last drop named and drops the rest", () => {
		const a: ArrangedGridV1 = {
			left: zone(pos("stats", 0, 0, 7, 3), pos("portraits", 0, 5, 7, 3)),
			right: zone(pos("portraits", 0, 0, 7, 3))
		}
		const out = dedupeArranged(a, { id: "portraits", zone: "left" })
		expect(out.arranged.left?.items.map((i) => i.id)).toEqual([
			"stats",
			"portraits"
		])
		expect(out.arranged.right?.items).toEqual([])
		expect(out.duplicates).toEqual([
			{ id: "portraits", kept: "left", dropped: ["right"] }
		])
	})

	it("honours a drop that named the OTHER zone", () => {
		const a: ArrangedGridV1 = {
			left: zone(pos("portraits", 0, 0, 7, 3)),
			right: zone(pos("portraits", 0, 0, 7, 3))
		}
		const out = dedupeArranged(a, { id: "portraits", zone: "right" })
		expect(out.arranged.left?.items).toEqual([])
		expect(out.arranged.right?.items.map((i) => i.id)).toEqual([
			"portraits"
		])
	})

	it("falls back to left → middle → right with no drop to go on", () => {
		const a: ArrangedGridV1 = {
			middle: zone(pos("notes", 0, 0, 7, 3)),
			right: zone(pos("notes", 0, 0, 7, 3))
		}
		const out = dedupeArranged(a, null)
		expect(out.arranged.middle?.items.map((i) => i.id)).toEqual(["notes"])
		expect(out.arranged.right?.items).toEqual([])
		expect(out.duplicates[0].kept).toBe("middle")
	})

	it("ignores a drop hint naming a zone the widget is not in", () => {
		const a: ArrangedGridV1 = {
			left: zone(pos("notes", 0, 0, 7, 3)),
			right: zone(pos("notes", 0, 0, 7, 3))
		}
		const out = dedupeArranged(a, { id: "notes", zone: "middle" })
		expect(out.duplicates[0].kept).toBe("left")
	})

	it("resolves a widget that somehow reached all three zones", () => {
		const a: ArrangedGridV1 = {
			left: zone(pos("notes", 0, 0, 7, 3)),
			middle: zone(pos("notes", 0, 0, 7, 3)),
			right: zone(pos("notes", 0, 0, 7, 3))
		}
		const out = dedupeArranged(a, { id: "notes", zone: "right" })
		expect(out.duplicates).toEqual([
			{ id: "notes", kept: "right", dropped: ["left", "middle"] }
		])
		expect(out.arranged.left?.items).toEqual([])
		expect(out.arranged.middle?.items).toEqual([])
		expect(out.arranged.right?.items.map((i) => i.id)).toEqual(["notes"])
	})

	it("keeps each zone's cell grid while pruning its items", () => {
		const a: ArrangedGridV1 = {
			left: { cols: 5, rows: 9, items: [pos("notes", 0, 0, 5, 3)] },
			right: { cols: 7, rows: 12, items: [pos("notes", 0, 0, 7, 3)] }
		}
		const out = dedupeArranged(a, { id: "notes", zone: "left" })
		expect(out.arranged.left).toMatchObject({ cols: 5, rows: 9 })
		expect(out.arranged.right).toMatchObject({ cols: 7, rows: 12 })
	})
})

/**
 * The reference a zone RE-EXPRESSES from when it is re-measured. A zone that
 * was empty when the editor opened reports `{cols, rows, items: []}` for
 * itself, and that report is what the next mount is handed as its `frame` —
 * so a zone that has since gained a widget was taking an EMPTY frame as its
 * reference. Re-expressing from it returns nothing, gridstack's own
 * `column(n, "none")` clamp is left standing, and since that clamp only ever
 * shrinks `w`, one trip through a narrow preview left the widget a sliver of
 * its zone, live and saved. `frameCovers` is the question that separates the
 * two cases, which is why GridStackZone now asks it before choosing.
 */
describe("re-measure reference — an empty frame is not one", () => {
	const stats: GsItem[] = [{ id: "stats", title: "Stats", h: 3 }]

	it("an empty frame does not account for the card on screen", () => {
		expect(frameCovers(stats, { cols: 7, rows: 14, items: [] })).toBe(false)
	})

	it("re-expressing from it restores nothing", () => {
		expect(reexpress({ cols: 7, rows: 14, items: [] }, 2, 14)).toEqual([])
	})

	it("re-expressing from the seeded positions survives narrow → wide", () => {
		const seeded = seedPositions(stats, 7, 14)
		expect(seeded).toEqual([{ id: "stats", x: 0, y: 0, w: 7, h: 3 }])
		const ref: ArrangedZone = { cols: 7, rows: 14, items: seeded }
		expect(reexpress(ref, 2, 14)[0]).toMatchObject({ w: 2 })
		expect(reexpress(ref, 7, 14)[0]).toMatchObject({ w: 7 })
	})
})

/**
 * The live view spends a saved cell straight as `grid-column: x + 1 / span w`
 * against `repeat(cols, 1fr)`. A column past `cols` does NOT overflow — CSS
 * grid adds implicit tracks for it, and the explicit `1fr` tracks then resolve
 * to 0px, so one bad cell flattens every other widget in the zone. Measured in
 * the browser on 2026-09-17: `scene-portraits` saved at x = 7 in a 7-column
 * frame gave `grid-column: 8 / span 7`, a computed template of seven 0px
 * tracks followed by seven implicit 20.125px ones, and a 38px `stats`.
 *
 * `seedPositions` has always ended with this clamp, which is why the EDITOR
 * drew the same arrangement correctly and the live view did not.
 */
describe("clampPos — a saved cell belongs to the frame that describes it", () => {
	it("pulls a column past the frame back inside it", () => {
		expect(clampPos(pos("portraits", 7, 0, 7, 3), 7, 12)).toMatchObject({
			x: 0,
			w: 7
		})
	})

	it("narrows a card wider than the frame rather than moving it out", () => {
		expect(clampPos(pos("map", 2, 0, 9, 3), 7, 12)).toMatchObject({
			x: 0,
			w: 7
		})
	})

	it("clamps rows the same way", () => {
		expect(clampPos(pos("map", 0, 11, 7, 6), 7, 12)).toMatchObject({
			y: 6,
			h: 6
		})
	})

	it("never produces a zero or negative span", () => {
		expect(clampPos(pos("map", 0, 0, 0, 0), 7, 12)).toMatchObject({
			w: 1,
			h: 1
		})
		expect(clampPos(pos("map", -3, -2, 7, 3), 7, 12)).toMatchObject({
			x: 0,
			y: 0
		})
	})

	it("returns the SAME object when the cell already fits", () => {
		const p = pos("map", 0, 0, 7, 3)
		expect(clampPos(p, 7, 12)).toBe(p)
		const frame: ArrangedZone = { cols: 7, rows: 12, items: [p] }
		expect(clampFrame(frame)).toBe(frame)
	})

	it("keeps the anchor / group / pin riding on the item", () => {
		const p: ArrangedItem = {
			...pos("map", 9, 0, 3, 3),
			anchor: { top: true },
			group: "g:a+b",
			pinned: false
		}
		expect(clampPos(p, 7, 12)).toMatchObject({
			x: 4,
			anchor: { top: true },
			group: "g:a+b",
			pinned: false
		})
	})

	it("loadArranged clamps what an older blob already stored", () => {
		const out = loadArranged({
			left: {
				cols: 7,
				rows: 12,
				items: [pos("stats", 0, 0, 7, 3), pos("portraits", 7, 5, 7, 3)]
			}
		})
		expect(out.left?.items.map((i) => [i.x, i.w])).toEqual([
			[0, 7],
			[0, 7]
		])
	})
})

/* ── making room for one more card ─────────────────────────────────────── */

describe("firstSlot / fits / makeRoom", () => {
	/** A frame at `cols`×`rows` holding these cells. */
	const frame = (cols: number, rows: number, items: ArrangedItem[]): ArrangedZone => ({
		cols,
		rows,
		items
	})

	it("makes room for a tray card in the middle zone's normal state", () => {
		// One GROW widget over the whole grid — what `zoneIsFull` was written
		// for, and the frame a new card has nowhere to go in.
		const full = frame(15, 16, [pos("messages", 0, 0, 15, 16)])
		expect(fits(full, { w: 15, h: 4 })).toBe(false)
		const next = makeRoom(full, { w: 15, h: 4 })
		expect(next).not.toBe(full)
		expect(next.items).toEqual([pos("messages", 0, 0, 15, 12)])
		expect(fits(next, { w: 15, h: 4 })).toBe(true)
	})

	it("hands back the same frame when a slot already exists", () => {
		const roomy = frame(7, 16, [pos("stats", 0, 0, 7, 6)])
		expect(fits(roomy, { w: 7, h: 3 })).toBe(true)
		expect(makeRoom(roomy, { w: 7, h: 3 })).toBe(roomy)
	})

	it("free cells are not a free slot", () => {
		// A quarter of the frame free, one cell in each corner — `zoneIsFull`
		// says there is room, and there is room for nothing.
		const corners = frame(4, 4, [
			pos("a", 1, 0, 2, 1),
			pos("b", 0, 1, 4, 2),
			pos("c", 1, 3, 2, 1)
		])
		expect(fits(corners, { w: 1, h: 1 })).toBe(true)
		expect(fits(corners, { w: 2, h: 2 })).toBe(false)
	})

	it("returns the frame unchanged when every card is already at the floor", () => {
		const minimal = frame(4, 6, [
			pos("a", 0, 0, 4, MIN_CARD_ROWS),
			pos("b", 0, 2, 4, MIN_CARD_ROWS),
			pos("c", 0, 4, 4, MIN_CARD_ROWS)
		])
		expect(makeRoom(minimal, { w: 4, h: 3 })).toBe(minimal)
	})

	it("returns the frame unchanged when no sequence of shrinks frees a slot", () => {
		// Shrinking either card to the floor leaves two one-row gaps, never
		// the three contiguous rows asked for.
		const tight = frame(4, 6, [pos("a", 0, 0, 4, 3), pos("b", 0, 3, 4, 3)])
		expect(makeRoom(tight, { w: 4, h: 3 })).toBe(tight)
	})

	it("cascades to the next largest when the biggest card is at the floor", () => {
		// `a` has the largest area but nothing left to give, so the rows come
		// off the first of the three columns instead.
		const full = frame(12, 7, [
			pos("a", 0, 0, 12, MIN_CARD_ROWS),
			pos("b", 0, 2, 4, 5),
			pos("c", 4, 2, 4, 5),
			pos("d", 8, 2, 4, 5)
		])
		const next = makeRoom(full, { w: 4, h: 3 })
		expect(next.items.map((i) => [i.id, i.y, i.h])).toEqual([
			["a", 0, 2],
			["b", 2, 2],
			["c", 2, 5],
			["d", 2, 5]
		])
		expect(fits(next, { w: 4, h: 3 })).toBe(true)
	})

	it("cascades to the second largest when the first shrink is not enough", () => {
		// Two full-height columns: freeing the bottom rows of one is useless
		// while the other still reaches the floor, so both give rows up.
		const full = frame(8, 8, [pos("a", 0, 0, 4, 8), pos("b", 4, 0, 4, 8)])
		const next = makeRoom(full, { w: 8, h: 2 })
		expect(next.items.map((i) => [i.id, i.h])).toEqual([
			["a", 6],
			["b", 6]
		])
		expect(fits(next, { w: 8, h: 2 })).toBe(true)
	})

	it("never shrinks a card past the floor, even for a tall ask", () => {
		const full = frame(6, 8, [pos("a", 0, 0, 6, 8)])
		const next = makeRoom(full, { w: 6, h: 6 })
		expect(next.items[0].h).toBe(MIN_CARD_ROWS)
		expect(fits(next, { w: 6, h: 6 })).toBe(true)
	})

	it("keeps every card's top edge where it was", () => {
		const full = frame(7, 16, [
			pos("stats", 0, 0, 7, 10),
			pos("portraits", 0, 10, 7, 6)
		])
		const next = makeRoom(full, { w: 7, h: 3 })
		expect(next.items.map((i) => i.y)).toEqual([0, 10])
	})

	it("names the top-left-most slot, and null when there is none", () => {
		const roomy = frame(4, 6, [pos("a", 0, 0, 4, 2)])
		expect(firstSlot(roomy, { w: 4, h: 3 })).toEqual({ x: 0, y: 2 })
		expect(firstSlot(roomy, { w: 4, h: 5 })).toBeNull()
	})

	it("seats a mid-stack newcomer where the seeding rules never would", () => {
		// The shape that makes `makeRoom` on its own a no-op: the rows it frees
		// are UNDER the biggest card, mid-stack, while `seedPositions` puts a
		// card with no saved cells at the foot of the x = 0 stack — which in a
		// full zone is clamped straight back on top of `portraits`. Writing the
		// slot onto the newcomer is the half that fixes it, and it also makes
		// the frame account for every card on screen, so the re-seeded zone
		// reads as a faithful restore.
		const full = frame(7, 16, [
			pos("stats", 0, 0, 7, 10),
			pos("portraits", 0, 10, 7, 6)
		])
		const need = { w: 7, h: 3 }
		const roomy = makeRoom(full, need)
		const slot = firstSlot(roomy, need)
		expect(slot).toEqual({ x: 0, y: 7 })
		const seated: ArrangedZone = {
			...roomy,
			items: [...roomy.items, pos("map", slot!.x, slot!.y, need.w, need.h)]
		}
		for (const a of seated.items)
			for (const b of seated.items)
				if (a !== b) expect(overlaps(a, b)).toBe(false)
		// And the seeder agrees, because the frame now names every card.
		expect(
			seedPositions(
				seated.items.map((i) => ({ ...i, title: "" })),
				7,
				16,
				seated
			).map((i) => `${i.id}:y${i.y}h${i.h}`)
		).toEqual(["stats:y0h7", "portraits:y10h6", "map:y7h3"])
	})
})

describe("arrangedIds — what the editor counts as placed", () => {
	it("gathers every zone's ids, and an absent zone contributes none", () => {
		const a: ArrangedGridV1 = {
			left: { cols: 4, rows: 8, items: [pos("stats", 0, 0, 4, 3)] },
			middle: { cols: 9, rows: 8, items: [pos("messages", 0, 0, 9, 8)] }
		}
		expect([...arrangedIds(a)].sort()).toEqual(["messages", "stats"])
		expect(arrangedIds({})).toEqual(new Set())
	})

	it("counts a card MID-MOVE, which is the whole point", () => {
		// `map` has left the middle's frame for the right's. Committed
		// membership has caught up with neither, so this is the only list that
		// still knows the widget is placed.
		const a: ArrangedGridV1 = {
			middle: { cols: 9, rows: 8, items: [pos("messages", 0, 0, 9, 8)] },
			right: { cols: 4, rows: 8, items: [pos("map", 0, 0, 4, 3)] }
		}
		expect(arrangedIds(a).has("map")).toBe(true)
	})
})

/**
 * `seatCard` — the tray's add and Duplicate, seating one more card in a zone's
 * working frame (brief 7b and its review). Before the review a zone with no
 * room left seated nothing but the page placed the widget anyway, so it was
 * seeded on top of the bottom card; a third such card sent gridstack's
 * `_fixCollisions` into unbounded recursion.
 */
describe("seatCard — room made, the newcomer written, or null when there is none", () => {
	const frame = (cols: number, rows: number, items: ArrangedItem[]): ArrangedZone => ({ cols, rows, items })
	const noOverlap = (z: ArrangedZone) => {
		for (const a of z.items) for (const b of z.items) if (a !== b) expect(overlaps(a, b)).toBe(false)
	}

	it("a full middle: the big card gives up rows and the newcomer is written into them", () => {
		const full = frame(15, 16, [pos("messages", 0, 0, 15, 16)])
		const out = seatCard(full, "stats", [{ w: 15, h: 3 }])!
		expect(out.items).toEqual([pos("messages", 0, 0, 15, 13), pos("stats", 0, 13, 15, 3)])
		noOverlap(out)
	})

	it("a Duplicate asks for its source's size first, then falls back to a new card's footprint", () => {
		// The source is 8 rows tall; the zone can free 3 rows, never 8.
		const tight = frame(6, 12, [pos("a", 0, 0, 6, 5), pos("b", 0, 5, 6, 7)])
		const out = seatCard(tight, "b#2", [{ w: 6, h: 8 }, { w: 6, h: 3 }])!
		const added = out.items.find((i) => i.id === "b#2")!
		expect(added.h).toBe(3)
		noOverlap(out)
		// With room for the source's size, it takes it.
		const roomy = frame(6, 20, [pos("b", 0, 0, 6, 8)])
		expect(seatCard(roomy, "b#2", [{ w: 6, h: 8 }, { w: 6, h: 3 }])!.items[1]).toEqual(pos("b#2", 0, 8, 6, 8))
	})

	it("a size wider than the zone is the zone's width", () => {
		const out = seatCard(frame(4, 10, []), "x", [{ w: 9, h: 3 }])!
		expect(out.items).toEqual([pos("x", 0, 0, 4, 3)])
	})

	it("NO ROOM: every card at the floor and no slot left answers null — the add must be refused", () => {
		// A side zone 14 rows tall of 2-row cards: seven of them, and no eighth.
		const packed = frame(4, 14, Array.from({ length: 7 }, (_, n) => pos(`w${n}`, 0, n * 2, 4, MIN_CARD_ROWS)))
		expect(seatCard(packed, "w7", [{ w: 4, h: 3 }])).toBeNull()
		// …the source's size and the fallback alike.
		expect(seatCard(packed, "w0#2", [{ w: 4, h: 2 }, { w: 4, h: 3 }])).toBeNull()
	})
})
