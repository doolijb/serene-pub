/**
 * The layout editor's pure panel ops (./arrangeOps), shared by the desktop
 * and phone editors. Every op answers a new `PanelLayoutV1` or a refusal, and
 * no sequence of them may break the rules of PLAN-session-panels §1.1.
 */
import { describe, expect, it } from "vitest"
import type { PanelLayoutV1, PanelV1 } from "@serene-pub/sdk"
import { panelsOf, validateSessionLayout } from "@serene-pub/sdk"
import { STORY_WORLD_LAYOUT, STORY_LAYOUT, LAIR_LAYOUT } from "@serene-pub/core-catalog"
import {
	ALREADY_PLACED,
	MIDDLE_EMPTY,
	NOT_A_STACK,
	UNKNOWN_PANEL,
	UNKNOWN_TAB,
	addTab,
	allPanels,
	moveTab,
	movePanel,
	newPanel,
	nextPanelKey,
	placedIds,
	removeRefusal,
	removeTab,
	samePanels,
	setHeight,
	setPinned,
	setPrimary,
	setTabOrder,
	setTitle,
	splitOut,
	stackOf,
	type ArrangeOutcome,
	type StackPlace
} from "./arrangeOps"

const p = (key: string, tabs: string[], extra: Partial<PanelV1> = {}): PanelV1 => ({ key, tabs, ...extra })

/** Messages in the middle, a strip above, two docked panels left, one in the rail right. */
const base = (): PanelLayoutV1 => ({
	version: 1,
	left: [p("p3", ["chronicle", "lore-entries"]), p("p4", ["stats"])],
	middle: { above: [p("p2", ["stats#world"], { height: "fit" })], primary: p("p1", ["messages"]), below: [] },
	right: [p("p5", ["authors-note"], { pinned: false })]
})

function ok(out: ArrangeOutcome): PanelLayoutV1 {
	if (!out.layout) throw new Error(`refused: ${out.refused}`)
	return out.layout
}

describe("addTab", () => {
	it("adds at the end, or at an index", () => {
		const end = ok(addTab(base(), "places", { panelKey: "p4" }))
		expect(end.left[1].tabs).toEqual(["stats", "places"])
		const at = ok(addTab(base(), "places", { panelKey: "p3", index: 1 }))
		expect(at.left[0].tabs).toEqual(["chronicle", "places", "lore-entries"])
	})
	it("refuses a widget already placed, and an unknown panel", () => {
		expect(addTab(base(), "stats", { panelKey: "p3" }).refused).toBe(ALREADY_PLACED)
		expect(addTab(base(), "places", { panelKey: "nope" }).refused).toBe(UNKNOWN_PANEL)
	})
	it("never mutates its input", () => {
		const b = base()
		const before = JSON.stringify(b)
		addTab(b, "places", { panelKey: "p1" })
		expect(JSON.stringify(b)).toBe(before)
	})
})

describe("newPanel", () => {
	it("mints the next key", () => {
		const out = ok(newPanel(base(), "places", { place: "right", index: 0 }))
		expect(out.right[0]).toEqual({ key: "p6", tabs: ["places"] })
	})
	it("a strip strips `pinned`; a side keeps `pinned: false`", () => {
		const strip = ok(newPanel(base(), "places", { place: "below", index: 0 }, { pinned: false }))
		expect(strip.middle.below[0]).toEqual({ key: "p6", tabs: ["places"], height: "fit" })
		const side = ok(newPanel(base(), "places", { place: "left", index: 9 }, { pinned: false }))
		expect(side.left[2]).toEqual({ key: "p6", tabs: ["places"], pinned: false })
	})
	it("refuses a widget already placed", () => {
		expect(newPanel(base(), "messages", { place: "left", index: 0 }).refused).toBe(ALREADY_PLACED)
	})
})

/** Only the primary in the middle. */
const lone = (): PanelLayoutV1 => ({ ...base(), middle: { above: [], primary: p("p1", ["messages"]), below: [] } })

describe("removeTab", () => {
	it("removing the primary's last tab promotes the last `above`, dropping its height", () => {
		expect(removeRefusal(base(), "messages")).toBeNull()
		const out = ok(removeTab(base(), "messages"))
		expect(out.middle).toEqual({ above: [], primary: { key: "p2", tabs: ["stats#world"] }, below: [] })
	})
	it("else the first `below`", () => {
		const b: PanelLayoutV1 = {
			...base(),
			middle: { above: [], primary: p("p1", ["messages"]), below: [p("p6", ["places"]), p("p7", ["album"])] }
		}
		const out = ok(removeTab(b, "messages"))
		expect(out.middle).toEqual({ above: [], primary: p("p6", ["places"]), below: [p("p7", ["album"])] })
	})
	it("refuses MIDDLE_EMPTY when the middle would be empty", () => {
		expect(removeRefusal(lone(), "messages")).toBe(MIDDLE_EMPTY)
		expect(removeTab(lone(), "messages").refused).toBe(MIDDLE_EMPTY)
	})
	it("the very last Messages goes when the middle stays filled", () => {
		const b: PanelLayoutV1 = { ...base(), middle: { above: [], primary: p("p1", ["board"]), below: [] }, right: [p("p5", ["messages"])] }
		const out = ok(removeTab(b, "messages"))
		expect(out.right).toEqual([])
		expect(placedIds(out).some((id) => id.startsWith("messages"))).toBe(false)
	})
	it("a primary tab that is not the last just leaves", () => {
		const two = ok(addTab(base(), "board", { panelKey: "p1" }))
		expect(ok(removeTab(two, "messages")).middle.primary).toEqual(p("p1", ["board"]))
	})
	it("drops a side panel it empties", () => {
		const out = ok(removeTab(base(), "stats"))
		expect(out.left.map((x) => x.key)).toEqual(["p3"])
		const strip = ok(removeTab(base(), "stats#world"))
		expect(strip.middle.above).toEqual([])
	})
	it("tidies `open` when the open tab leaves", () => {
		const b = base()
		b.left[0] = { ...b.left[0], open: "lore-entries" }
		const out = ok(removeTab(b, "lore-entries"))
		expect(out.left[0]).toEqual({ key: "p3", tabs: ["chronicle"] })
	})
	it("refuses an unknown tab", () => {
		expect(removeTab(base(), "nope").refused).toBe(UNKNOWN_TAB)
	})
})

describe("moveTab", () => {
	it("reorders within a panel", () => {
		const out = ok(moveTab(base(), "lore-entries", { panelKey: "p3", index: 0 }))
		expect(out.left[0].tabs).toEqual(["lore-entries", "chronicle"])
	})
	it("answers the same object for a move that changes nothing", () => {
		const b = base()
		expect(moveTab(b, "chronicle", { panelKey: "p3", index: 0 }).layout).toBe(b)
	})
	it("moves across panels", () => {
		const out = ok(moveTab(base(), "chronicle", { panelKey: "p5" }))
		expect(out.left[0].tabs).toEqual(["lore-entries"])
		expect(out.right[0].tabs).toEqual(["authors-note", "chronicle"])
	})
	it("out of a one-tab panel removes that panel", () => {
		const out = ok(moveTab(base(), "stats", { panelKey: "p3" }))
		expect(out.left.map((x) => x.key)).toEqual(["p3"])
		expect(out.left[0].tabs).toEqual(["chronicle", "lore-entries", "stats"])
	})
	it("taking the primary's last tab promotes the nearest middle panel", () => {
		const out = ok(moveTab(base(), "messages", { panelKey: "p4" }))
		expect(out.left[1].tabs).toEqual(["stats", "messages"])
		expect(out.middle.primary).toEqual(p("p2", ["stats#world"]))
		expect(out.middle.above).toEqual([])
	})
	it("into the very panel that gets promoted", () => {
		const out = ok(moveTab(base(), "messages", { panelKey: "p2", index: 0 }))
		expect(out.middle).toEqual({ above: [], primary: p("p2", ["messages", "stats#world"]), below: [] })
	})
	it("refuses MIDDLE_EMPTY with nothing to promote", () => {
		expect(moveTab(lone(), "messages", { panelKey: "p4" }).refused).toBe(MIDDLE_EMPTY)
	})
	it("refuses unknown tabs and panels", () => {
		expect(moveTab(base(), "nope", { panelKey: "p4" }).refused).toBe(UNKNOWN_TAB)
		expect(moveTab(base(), "stats", { panelKey: "nope" }).refused).toBe(UNKNOWN_PANEL)
	})
})

describe("splitOut", () => {
	it("a one-tab panel just moves", () => {
		const out = ok(splitOut(base(), "stats", { place: "right", index: 0 }))
		expect(out.left.map((x) => x.key)).toEqual(["p3"])
		expect(out.right[0]).toEqual({ key: "p4", tabs: ["stats"] })
	})
	it("a tab of a multi-tab panel takes a new panel", () => {
		const out = ok(splitOut(base(), "lore-entries", { place: "left", index: 1 }))
		expect(out.left).toEqual([p("p3", ["chronicle"]), p("p6", ["lore-entries"]), p("p4", ["stats"])])
	})
	it("the primary's last tab moves the primary and promotes", () => {
		const out = ok(splitOut(base(), "messages", { place: "below", index: 0 }))
		expect(out.middle).toEqual({ above: [], primary: p("p2", ["stats#world"]), below: [{ ...p("p1", ["messages"]), height: "fit" }] })
		expect(splitOut(lone(), "messages", { place: "left", index: 0 }).refused).toBe(MIDDLE_EMPTY)
	})
	it("a tab of a multi-tab primary takes a new panel", () => {
		const two = ok(addTab(base(), "board", { panelKey: "p1" }))
		const out = ok(splitOut(two, "board", { place: "right", index: 0 }))
		expect(out.middle.primary).toEqual(p("p1", ["messages"]))
		expect(out.right[0]).toEqual(p("p6", ["board"]))
	})
})

describe("movePanel", () => {
	it("moves the primary to a side and promotes the last `above`", () => {
		const out = ok(movePanel(base(), "p1", { place: "left", index: 0 }))
		expect(out.left[0]).toEqual(p("p1", ["messages"]))
		expect(out.middle).toEqual({ above: [], primary: p("p2", ["stats#world"]), below: [] })
	})
	it("moves the primary to a strip (index counts without the promoted panel)", () => {
		const b: PanelLayoutV1 = {
			...base(),
			middle: { above: [p("p2", ["stats#world"])], primary: p("p1", ["messages"]), below: [p("p6", ["places"])] }
		}
		const out = ok(movePanel(b, "p1", { place: "below", index: 1 }))
		expect(out.middle).toEqual({ above: [], primary: p("p2", ["stats#world"]), below: [p("p6", ["places"]), { ...p("p1", ["messages"]), height: "fit" }] })
	})
	it("refuses MIDDLE_EMPTY with nothing to promote, even into a strip", () => {
		expect(movePanel(lone(), "p1", { place: "left", index: 0 }).refused).toBe(MIDDLE_EMPTY)
		expect(movePanel(lone(), "p1", { place: "above", index: 0 }).refused).toBe(MIDDLE_EMPTY)
	})
	it("answers the same object for its own slot", () => {
		const b = base()
		expect(movePanel(b, "p4", { place: "left", index: 1 }).layout).toBe(b)
		expect(movePanel(b, "p4", { place: "left", index: 99 }).layout).toBe(b)
	})
	it("reorders within a stack (index counts without the panel)", () => {
		const out = ok(movePanel(base(), "p4", { place: "left", index: 0 }))
		expect(out.left.map((x) => x.key)).toEqual(["p4", "p3"])
	})
	it("a rail panel moved to a strip loses its pin; a strip to a side arrives docked", () => {
		const down = ok(movePanel(base(), "p5", { place: "below", index: 0 }))
		expect(down.middle.below[0]).toEqual({ key: "p5", tabs: ["authors-note"], height: "fit" })
		const side = ok(movePanel(base(), "p2", { place: "right", index: 0 }))
		expect(side.right[0]).toEqual({ key: "p2", tabs: ["stats#world"], height: "fit" })
		expect(side.right[0].pinned).toBeUndefined()
	})
	it("a rail panel moved to the other side stays in the rail", () => {
		const out = ok(movePanel(base(), "p5", { place: "left", index: 0 }))
		expect(out.left[0].pinned).toBe(false)
		expect(out.right).toEqual([])
	})
})

describe("setPrimary", () => {
	it("from `above`: the old primary lands at the end of `above`", () => {
		const b: PanelLayoutV1 = {
			...base(),
			middle: { above: [p("p2", ["stats#world"], { height: "fit" }), p("p6", ["places"])], primary: p("p1", ["messages"]), below: [] }
		}
		const out = ok(setPrimary(b, "p2"))
		expect(out.middle).toEqual({ above: [p("p6", ["places"]), p("p1", ["messages"])], primary: p("p2", ["stats#world"]), below: [] })
	})
	it("from `below`", () => {
		const b: PanelLayoutV1 = { ...base(), middle: { ...base().middle, below: [p("p6", ["places"])] } }
		const out = ok(setPrimary(b, "p6"))
		expect(out.middle.primary).toEqual(p("p6", ["places"]))
		expect(out.middle.below).toEqual([])
		expect(out.middle.above.map((x) => x.key)).toEqual(["p2", "p1"])
	})
	it("from a side, dropping `pinned`", () => {
		const out = ok(setPrimary(base(), "p5"))
		expect(out.right).toEqual([])
		expect(out.middle.primary).toEqual(p("p5", ["authors-note"]))
		expect(out.middle.above[1]).toEqual(p("p1", ["messages"]))
		const left = ok(setPrimary(base(), "p3"))
		expect(left.left.map((x) => x.key)).toEqual(["p4"])
		expect(left.middle.primary).toEqual(p("p3", ["chronicle", "lore-entries"]))
	})
	it("the old primary arrives without `pinned`", () => {
		const b = base()
		b.middle.primary = { ...b.middle.primary, pinned: false }
		const out = ok(setPrimary(b, "p4"))
		expect(out.middle.above[1]).toEqual(p("p1", ["messages"]))
		expect(validateSessionLayout({ panels: out }).errors).toEqual([])
	})
	it("already primary answers the same object; unknown is refused", () => {
		const b = base()
		expect(setPrimary(b, "p1").layout).toBe(b)
		expect(setPrimary(b, "nope").refused).toBe(UNKNOWN_PANEL)
	})
	it("never mutates its input", () => {
		const b = base()
		const before = JSON.stringify(b)
		setPrimary(b, "p3")
		expect(JSON.stringify(b)).toBe(before)
	})
})

describe("setHeight", () => {
	it("Fill is absent", () => {
		const out = ok(setHeight(base(), "p2", undefined))
		expect(out.middle.above[0]).toEqual({ key: "p2", tabs: ["stats#world"] })
		const fill = ok(setHeight(base(), "p2", "fill"))
		expect(samePanels(fill, out)).toBe(true)
	})
	it("sets fit and share, holding a share to 1–12", () => {
		expect(ok(setHeight(base(), "p4", "fit")).left[1].height).toBe("fit")
		expect(ok(setHeight(base(), "p4", { share: 40 })).left[1].height).toEqual({ share: 12 })
	})
	it("a height that changes nothing answers the same object", () => {
		const b = base()
		expect(setHeight(b, "p2", "fit").layout).toBe(b)
		expect(setHeight(b, "p4", undefined).layout).toBe(b)
	})
	it("refuses the primary", () => {
		expect(setHeight(base(), "p1", "fit").refused).toBe(NOT_A_STACK)
	})
})

describe("setPinned", () => {
	it("docks and rails a side panel", () => {
		const docked = ok(setPinned(base(), "p5", true))
		expect(docked.right[0]).toEqual({ key: "p5", tabs: ["authors-note"] })
		const rail = ok(setPinned(base(), "p4", false))
		expect(rail.left[1].pinned).toBe(false)
	})
	it("refuses strips and the primary", () => {
		expect(setPinned(base(), "p2", false).refused).toBe(NOT_A_STACK)
		expect(setPinned(base(), "p1", false).refused).toBe(NOT_A_STACK)
	})
	it("a pin that changes nothing answers the same object", () => {
		const b = base()
		expect(setPinned(b, "p4", true).layout).toBe(b)
		expect(setPinned(b, "p5", false).layout).toBe(b)
	})
})

describe("setTitle", () => {
	it("names, trims and clears", () => {
		const named = ok(setTitle(base(), "p3", "  Lore  "))
		expect(named.left[0].title).toBe("Lore")
		const cleared = ok(setTitle(named, "p3", "   "))
		expect(cleared.left[0]).not.toHaveProperty("title")
	})
	it("unchanged answers the same object; unknown is refused", () => {
		const b = base()
		expect(setTitle(b, "p3", undefined).layout).toBe(b)
		expect(setTitle(b, "nope", "x").refused).toBe(UNKNOWN_PANEL)
	})
})

describe("setTabOrder", () => {
	it("reorders and tidies `open`", () => {
		const b = base()
		b.left[0] = { ...b.left[0], open: "lore-entries" }
		const out = ok(setTabOrder(b, "p3", ["lore-entries", "chronicle"]))
		expect(out.left[0]).toEqual({ key: "p3", tabs: ["lore-entries", "chronicle"] })
	})
	it("refuses a list that is not the panel's tabs", () => {
		expect(setTabOrder(base(), "p3", ["chronicle", "stats"]).refused).toBe(UNKNOWN_TAB)
		expect(setTabOrder(base(), "p3", ["chronicle"]).refused).toBe(UNKNOWN_TAB)
	})
	it("the same order answers the same object", () => {
		const b = base()
		expect(setTabOrder(b, "p3", ["chronicle", "lore-entries"]).layout).toBe(b)
	})
})

describe("readers", () => {
	it("samePanels compares by content", () => {
		expect(samePanels(base(), base())).toBe(true)
		expect(samePanels(base(), ok(setPinned(base(), "p4", false)))).toBe(false)
	})
	it("placedIds lists every tab once", () => {
		expect(placedIds(base()).sort()).toEqual(
			["authors-note", "chronicle", "lore-entries", "messages", "stats", "stats#world"].sort()
		)
	})
	it("nextPanelKey is one past the highest `p<n>`", () => {
		expect(nextPanelKey(base())).toBe("p6")
		const odd = { ...base(), right: [p("custom", ["authors-note"]), p("p41", ["places"])] }
		expect(nextPanelKey(odd)).toBe("p42")
	})
})

/* ── property loop: random edits over the core layouts ─────────────────── */

/** A small seeded PRNG (mulberry32), so a failure replays. */
function rng(seed: number) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const POOL = ["places", "album", "actions", "turn-order", "chronicle", "stats#2", "messages#2", "annex#notes", "lore-entries"]
const PLACES: StackPlace[] = ["left", "right", "above", "below"]

function invariants(layout: PanelLayoutV1, why: string) {
	const panels = allPanels(layout)
	for (const { panel } of panels) expect(panel.tabs.length, `${why}: empty panel ${panel.key}`).toBeGreaterThan(0)
	const ids = placedIds(layout)
	expect(new Set(ids).size, `${why}: duplicate id in ${ids.join(",")}`).toBe(ids.length)
	const keys = panels.map(({ panel }) => panel.key)
	expect(new Set(keys).size, `${why}: duplicate key`).toBe(keys.length)
	expect(layout.middle.primary?.tabs.length ?? 0, `${why}: no primary`).toBeGreaterThan(0)
	expect(layout.middle.primary.pinned, `${why}: primary pinned`).toBeUndefined()
	expect(layout.middle.primary.height, `${why}: primary height`).toBeUndefined()
	const v = validateSessionLayout({ panels: layout })
	expect(v.errors, why).toEqual([])
}

describe("random edit sequences keep every rule", () => {
	for (const [name, source] of [
		["Chat", STORY_LAYOUT],
		["Adventure", STORY_WORLD_LAYOUT],
		["Lair", LAIR_LAYOUT]
	] as const) {
		it(name, () => {
			const landed = new Map<string, number>()
			for (let seed = 1; seed <= 40; seed++) {
				const r = rng(seed * 7919 + name.length)
				const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
				let layout = structuredClone(panelsOf(source))
				invariants(layout, `${name} start`)
				for (let step = 0; step < 60; step++) {
					const keys = allPanels(layout).map(({ panel }) => panel.key)
					const ids = placedIds(layout)
					const fresh = POOL.filter((id) => !ids.includes(id))
					const freshId = fresh.length ? pick(fresh) : "album#9"
					const anyId = pick([...ids, "nope"])
					const key = pick([...keys, "nope"])
					const slot = { place: pick(PLACES), index: Math.floor(r() * 4) }
					const tabSlot = { panelKey: key, index: r() < 0.5 ? undefined : Math.floor(r() * 3) }
					const ops: Array<[string, () => ArrangeOutcome]> = [
						["addTab", () => addTab(layout, freshId, tabSlot)],
						["newPanel", () => newPanel(layout, freshId, slot, r() < 0.5 ? { pinned: false } : {})],
						["removeTab", () => removeTab(layout, anyId)],
						["moveTab", () => moveTab(layout, anyId, tabSlot)],
						["splitOut", () => splitOut(layout, anyId, slot)],
						["movePanel", () => movePanel(layout, key, slot)],
						["movePanel primary", () => movePanel(layout, layout.middle.primary.key, slot)],
						["setPrimary", () => setPrimary(layout, key)],
						["setHeight", () => setHeight(layout, key, pick([undefined, "fit", "fill", { share: Math.floor(r() * 14) }] as const))],
						["setPinned", () => setPinned(layout, key, r() < 0.5)],
						["setTitle", () => setTitle(layout, key, pick([undefined, "Lore", " "]))],
						[
							"setTabOrder",
							() => {
								const tabs = allPanels(layout).find(({ panel }) => panel.key === key)?.panel.tabs ?? []
								return setTabOrder(layout, key, [...tabs].reverse())
							}
						]
					]
					const [op, run] = pick(ops)
					const before = JSON.stringify(layout)
					const out = run()
					expect(JSON.stringify(layout), `${op} mutated its input`).toBe(before)
					if (out.layout) {
						if (out.layout !== layout) landed.set(op, (landed.get(op) ?? 0) + 1)
						layout = out.layout
						invariants(layout, `${name} seed ${seed} step ${step} ${op}`)
					}
				}
				// Strips never pin, whatever the sequence.
				for (const place of ["above", "below"] as const)
					for (const panel of stackOf(layout, place)) expect(panel.pinned).toBeUndefined()
			}
			// The primary ops really changed layouts, not only refused.
			for (const op of ["setPrimary", "movePanel primary", "removeTab", "moveTab", "splitOut"])
				expect(landed.get(op) ?? 0, `${name}: ${op} never changed a layout`).toBeGreaterThan(0)
		})
	}
})
