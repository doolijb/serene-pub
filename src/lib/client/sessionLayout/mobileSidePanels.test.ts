import { describe, it, expect, beforeEach, vi } from "vitest"
import {
	mobileSidePanels,
	nextOpen,
	resolveOpen,
	showsToggles
} from "./mobileSidePanels.svelte"

/** A stand-in for the header button that opened the overlay. */
function fakeOpener(connected = true) {
	return { isConnected: connected, focus: vi.fn() } as unknown as HTMLElement
}

describe("nextOpen — one overlay at a time", () => {
	it("opens the tapped side from closed", () => {
		expect(nextOpen(null, "left")).toBe("left")
		expect(nextOpen(null, "right")).toBe("right")
	})

	it("closes when the OPEN side is tapped again", () => {
		expect(nextOpen("left", "left")).toBe(null)
		expect(nextOpen("right", "right")).toBe(null)
	})

	it("swaps when the other side is tapped", () => {
		expect(nextOpen("left", "right")).toBe("right")
		expect(nextOpen("right", "left")).toBe("left")
	})
})

describe("resolveOpen — no stuck overlay", () => {
	it("keeps a populated side open while narrow", () => {
		expect(
			resolveOpen({ narrow: true, left: 2, right: 0, open: "left" })
		).toBe("left")
	})

	it("closes above the breakpoint (rotate / resize to desktop)", () => {
		expect(
			resolveOpen({ narrow: false, left: 2, right: 1, open: "left" })
		).toBe(null)
	})

	it("closes when the open side loses its last widget", () => {
		expect(
			resolveOpen({ narrow: true, left: 0, right: 3, open: "left" })
		).toBe(null)
		expect(
			resolveOpen({ narrow: true, left: 3, right: 0, open: "right" })
		).toBe(null)
	})

	it("never invents an open side", () => {
		expect(
			resolveOpen({ narrow: true, left: 2, right: 2, open: null })
		).toBe(null)
	})
})

describe("showsToggles — the header L/R group", () => {
	it("is hidden above the breakpoint even when both sides are populated", () => {
		expect(showsToggles({ narrow: false, left: 3, right: 3 })).toBe(false)
	})

	it("is hidden when neither side is populated", () => {
		expect(showsToggles({ narrow: true, left: 0, right: 0 })).toBe(false)
	})

	it("shows when either side is populated", () => {
		expect(showsToggles({ narrow: true, left: 1, right: 0 })).toBe(true)
		expect(showsToggles({ narrow: true, left: 0, right: 1 })).toBe(true)
	})
})

describe("the Middle sheet (QE, brief 7a)", () => {
	it("the header's panels button shows for middle widgets alone", () => {
		// The conversation sits in a side and is the phone's stage; the only
		// other widgets are the middle's, so they are what the menu lists.
		expect(showsToggles({ narrow: true, left: 0, right: 0, middle: 2 })).toBe(true)
		expect(showsToggles({ narrow: true, left: 0, right: 0, middle: 0 })).toBe(false)
	})

	it("the middle sheet stays open while it lists something, and closes when it does not", () => {
		expect(resolveOpen({ narrow: true, left: 0, right: 0, middle: 1, open: "middle" })).toBe("middle")
		expect(resolveOpen({ narrow: true, left: 3, right: 3, middle: 0, open: "middle" })).toBe(null)
	})

	it("the store opens a Middle group and publishes the count", () => {
		mobileSidePanels.setSides(true, 0, 1, 2)
		expect(mobileSidePanels.middle).toBe(2)
		mobileSidePanels.openGroup("middle", "world-state")
		expect(mobileSidePanels.open).toBe("middle")
		expect(mobileSidePanels.takePending()).toEqual({ side: "middle", key: "world-state" })
		mobileSidePanels.setSides(true, 0, 1, 0)
		expect(mobileSidePanels.open).toBe(null)
	})
})

describe("mobileSidePanels — the shared singleton", () => {
	beforeEach(() => {
		mobileSidePanels.open = null
		mobileSidePanels.setSides(true, 2, 2)
	})

	it("toggles, swaps and closes through the store", () => {
		mobileSidePanels.toggle("left")
		expect(mobileSidePanels.open).toBe("left")
		mobileSidePanels.toggle("right")
		expect(mobileSidePanels.open).toBe("right")
		mobileSidePanels.toggle("right")
		expect(mobileSidePanels.open).toBe(null)
	})

	it("returns focus to the opener when the overlay closes", () => {
		const opener = fakeOpener()
		mobileSidePanels.toggle("left", opener)
		expect(opener.focus).not.toHaveBeenCalled()
		mobileSidePanels.close()
		expect(mobileSidePanels.open).toBe(null)
		expect(opener.focus).toHaveBeenCalledTimes(1)
	})

	it("does not focus an opener that has left the DOM", () => {
		const opener = fakeOpener(false)
		mobileSidePanels.toggle("right", opener)
		mobileSidePanels.close()
		expect(opener.focus).not.toHaveBeenCalled()
	})

	it("close() on an already-closed store is a no-op", () => {
		const opener = fakeOpener()
		mobileSidePanels.toggle("left", opener)
		mobileSidePanels.close()
		mobileSidePanels.close()
		expect(opener.focus).toHaveBeenCalledTimes(1)
	})

	it("crossing back to desktop drops the overlay without stealing focus", () => {
		const opener = fakeOpener()
		mobileSidePanels.toggle("left", opener)
		mobileSidePanels.setSides(false, 2, 2)
		expect(mobileSidePanels.open).toBe(null)
		expect(opener.focus).not.toHaveBeenCalled()
	})

	it("emptying the open side drops the overlay", () => {
		mobileSidePanels.toggle("left")
		mobileSidePanels.setSides(true, 0, 2)
		expect(mobileSidePanels.open).toBe(null)
	})

	it("leaves the other side open when the closed side empties", () => {
		mobileSidePanels.toggle("left")
		mobileSidePanels.setSides(true, 2, 0)
		expect(mobileSidePanels.open).toBe("left")
	})
})

/* ── the menu's lines, over panels (PLAN-session-panels-2026-10-14) ─────── */
import { resolveDrawn, type PanelLayoutV1 } from "@serene-pub/sdk"
import { panelLines, type PanelLinesInput } from "./mobileSidePanels.svelte"

describe("panelLines — every side panel and the middle's strips", () => {
	const layout: PanelLayoutV1 = {
		version: 1,
		left: [
			{ key: "l1", tabs: ["chronicle"], pinned: false },
			{ key: "l2", tabs: ["lore-entries", "places"] }
		],
		right: [{ key: "r1", tabs: ["stats"] }],
		middle: {
			above: [{ key: "a1", tabs: ["stats#world"], height: "fit" }],
			primary: { key: "p1", tabs: ["messages"] },
			below: [{ key: "b1", tabs: ["album"] }]
		}
	}
	const d = resolveDrawn({ panels: layout }, { inline: 800 })
	const input = (over: Partial<PanelLinesInput> = {}): PanelLinesInput => ({
		left: { panels: d.left.panels, populated: true },
		right: { panels: d.right.panels, populated: true },
		middle: { above: d.middle.above, primary: d.middle.primary, below: d.middle.below },
		stageSide: null,
		stageKey: null,
		title: (p) => p.tabs.map((t) => t.instanceId).join(" · "),
		icon: () => "LayoutPanelTop",
		...over
	})

	it("lists each side's panels, then the strips above and below — never the primary", () => {
		expect(panelLines(input()).map((g) => [g.side, g.key, g.title])).toEqual([
			["left", "l1", "chronicle"],
			["left", "l2", "lore-entries · places"],
			["right", "r1", "stats"],
			["middle", "a1", "stats#world"],
			["middle", "b1", "album"]
		])
	})

	it("a docked panel's line says so — it arrives open in the sheet; a rail one does not", () => {
		const lines = panelLines(input())
		expect(lines.find((g) => g.key === "l1")!.pinned).toBe(false)
		expect(lines.find((g) => g.key === "l2")!.pinned).toBe(true)
		expect(lines.filter((g) => g.side === "middle").every((g) => g.pinned)).toBe(true)
	})

	it("an unpopulated side lists nothing", () => {
		const lines = panelLines(input({ right: { panels: d.right.panels, populated: false } }))
		expect(lines.some((g) => g.side === "right")).toBe(false)
	})

	it("while a side is the stage, its stage panel is no line and the middle is listed whole", () => {
		const lines = panelLines(input({ stageSide: "left", stageKey: "l2" }))
		expect(lines.map((g) => g.key)).toEqual(["l1", "r1", "a1", "p1", "b1"])
	})
})

describe("panelLines — a layout holding no conversation (R-B, no lock)", () => {
	const layout: PanelLayoutV1 = {
		version: 1,
		left: [{ key: "l1", tabs: ["stats"] }],
		right: [],
		middle: {
			above: [{ key: "a1", tabs: ["scene-portraits"] }],
			primary: { key: "p1", tabs: ["places"] },
			below: []
		}
	}
	const d = resolveDrawn({ panels: layout }, { inline: 800 })
	const title = (p: { tabs: readonly { instanceId: string }[] }) => p.tabs.map((t) => t.instanceId).join(" · ")

	it("the primary panel is the stage (whatever it holds): never a line; the strips and sides are", () => {
		const lines = panelLines({
			left: { panels: d.left.panels, populated: true },
			right: { panels: d.right.panels, populated: false },
			middle: { above: d.middle.above, primary: d.middle.primary, below: d.middle.below },
			stageSide: null,
			stageKey: null,
			title,
			icon: () => "LayoutPanelTop"
		})
		expect(lines.map((g) => [g.side, g.key])).toEqual([
			["left", "l1"],
			["middle", "a1"]
		])
	})

	it("an empty middle with the stage in a side: that panel is no line, and empty middle panels are none", () => {
		const empty = resolveDrawn(
			{ panels: { ...layout, middle: { above: [], primary: { key: "p1", tabs: [] }, below: [] } } },
			{ inline: 800 }
		)
		const lines = panelLines({
			left: { panels: empty.left.panels, populated: true },
			right: { panels: [], populated: false },
			middle: { above: [], primary: empty.middle.primary, below: [] },
			stageSide: "left",
			stageKey: "l1",
			title,
			icon: () => "LayoutPanelTop"
		})
		expect(lines).toEqual([])
	})
})
