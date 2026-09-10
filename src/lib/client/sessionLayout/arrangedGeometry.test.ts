/**
 * The Move tab's arrangement round trip: a saved arrangement must come back
 * out of the blob intact, be drawable in a zone of ANY size, and — this is the
 * one that bit — never be quietly rewritten by the size the editor happened to
 * be opened at.
 */
import { describe, expect, it } from "vitest"
import {
	frameCovers,
	loadArranged,
	reexpress,
	seedPositions,
	withGeometry
} from "./arrangedGeometry"
import type { GsItem, GsLayout, GsPos } from "./GridStackZone.svelte"

const pos = (
	id: string,
	x: number,
	y: number,
	w: number,
	h: number
): GsPos => ({
	id,
	x,
	y,
	w,
	h
})
/** Rows a placed item occupies, as a closed range — the overlap test's unit. */
const rowsOf = (p: GsPos) => [p.y, p.y + p.h - 1]
function overlaps(a: GsPos, b: GsPos): boolean {
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
})

describe("withGeometry — the saved cells laid over the editor's items", () => {
	const items: GsItem[] = [
		{ id: "messages", title: "Messages", place: "fill" },
		{ id: "composer", title: "Composer", place: "bottom", h: 3 }
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
					...pos("composer", 0, 31, 18, 3),
					anchor: { bottom: true },
					group: "g:composer+messages"
				}
			]
		})
		expect(out[1].anchor).toEqual({ bottom: true })
		expect(out[1].group).toBe("g:composer+messages")
	})

	it("is a no-op without a saved zone", () => {
		expect(withGeometry(items, undefined)).toBe(items)
	})
})

describe("frameCovers — is this zone a RESTORE or an edit?", () => {
	const frame: GsLayout = {
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
		{ id: "composer", title: "Composer", place: "bottom", h: 3 }
	]

	it("fills the middle above a bottom-docked composer, full width", () => {
		const out = seedPositions(chat, 18, 34)
		expect(out).toEqual([
			pos("messages", 0, 0, 18, 31),
			pos("composer", 0, 31, 18, 3)
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
})

describe("seedPositions — a saved arrangement drawn in a SMALLER zone", () => {
	// The real numbers from the running app: a middle zone arranged in an
	// 1838×1889 window (18 × 34 cells) reopened in a 1400×1000 one (14 × 15).
	const frame: GsLayout = {
		cols: 18,
		rows: 34,
		items: [pos("messages", 0, 0, 18, 31), pos("composer", 0, 31, 18, 3)]
	}
	const items = withGeometry(
		[
			{ id: "messages", title: "Messages", place: "fill" },
			{ id: "composer", title: "Composer", place: "bottom", h: 3 }
		],
		frame
	)

	it("re-expresses the arrangement instead of piling cards on each other", () => {
		const out = seedPositions(items, 14, 15, frame)
		expect(overlaps(out[0], out[1])).toBe(false)
	})

	it("keeps the order it was arranged in — composer still under messages", () => {
		const [messages, composer] = seedPositions(items, 14, 15, frame)
		expect(rowsOf(messages)[1]).toBeLessThan(rowsOf(composer)[0])
		expect(composer.y + composer.h).toBe(15)
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
		const side: GsLayout = {
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
				{ id: "composer", title: "Composer", place: "bottom", h: 3 },
				{ id: "cast", title: "Cast", h: 3 }
			],
			frame
		)
		const out = seedPositions(mixed, 14, 15, frame)
		expect(out.map((p) => p.id)).toEqual(["messages", "composer", "cast"])
		expect(out[2].h).toBeGreaterThan(0)
	})
})

describe("reexpress — a zone RE-MEASURED, not re-seeded", () => {
	// A side zone arranged in a wide window: two cards side by side over a
	// full-width one. Deliberately odd numbers — an even grid halves and
	// doubles exactly, which would hide the lossiness the reference exists to
	// avoid.
	const wide: GsLayout = {
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
		const clamp: GsLayout = { cols: 3, rows: 6, items: squeezed }
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
