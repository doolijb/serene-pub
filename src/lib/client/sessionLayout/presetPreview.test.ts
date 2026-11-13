/**
 * The Presets tab's picture. Pure input → geometry, so the one part of that tab
 * with real logic is covered without a component harness. Each zone — the
 * middle too — is its panels stacked in twelve rows (panels v2).
 */
import { describe, expect, it } from "vitest"
import type { PanelLayoutV2, PanelV2 } from "@serene-pub/sdk"
import { previewOf } from "./presetPreview"

const p = (
	key: string,
	tabs: string[],
	extra: Partial<PanelV2> = {}
): PanelV2 => ({ key, tabs, ...extra })

const layout = (over: Partial<PanelLayoutV2> = {}) => ({
	panels: {
		version: 2 as const,
		left: [],
		right: [],
		middle: [p("p1", ["messages"])],
		...over
	}
})

describe("previewOf — the shipped default", () => {
	it("draws the conversation in the middle for an empty preset: Messages fills, the turn line and composer sit small after it", () => {
		const p = previewOf({})
		expect(p.middle.cells.map((c) => [c.id, c.y, c.h])).toEqual([
			["messages", 0, 8],
			["turn-line", 8, 2],
			["composer", 10, 2]
		])
		expect(p.left.cells).toEqual([])
		expect(p.right.cells).toEqual([])
	})

	it("degrades a malformed blob to the same default rather than throwing", () => {
		for (const bad of [undefined, null, "x", 7, [1, 2]]) {
			const pv = previewOf(bad)
			expect(pv.middle.cells.map((c) => c.id)).toEqual([
				"messages",
				"turn-line",
				"composer"
			])
		}
	})
})

describe("previewOf — a zone is its panels, stacked", () => {
	it("stacks a side's panels top to bottom, fills sharing the column", () => {
		const pv = previewOf(
			layout({
				right: [p("a", ["scene-portraits"]), p("b", ["sample-map"])]
			})
		)
		expect(pv.right.cells.map((c) => [c.id, c.y, c.h])).toEqual([
			["scene-portraits", 0, 6],
			["sample-map", 6, 6]
		])
		expect(pv.left.cells).toEqual([])
		expect(pv.middle.cells.map((c) => [c.id, c.h])).toEqual([
			["messages", 12]
		])
	})

	it("a share is its own twelfths; fit is a small box; fill takes what is left", () => {
		const pv = previewOf(
			layout({
				left: [
					p("a", ["places"], { height: { share: 4 } }),
					p("b", ["annex#notes"], { height: "fit" }),
					p("d", ["stats"])
				]
			})
		)
		expect(pv.left.cells.map((c) => [c.id, c.h])).toEqual([
			["places", 4],
			["annex#notes", 2],
			["stats", 6]
		])
		expect(pv.left.rows).toBe(12)
		expect(pv.left.cells.every((c) => !("rail" in c))).toBe(true)
	})

	it("the middle stacks by the same rule: a fit strip, the conversation, a share below", () => {
		const pv = previewOf(
			layout({
				middle: [
					p("s", ["stats#world"], { height: "fit" }),
					p("p1", ["messages"]),
					p("b", ["album"], { height: { share: 3 } })
				]
			})
		)
		expect(pv.middle.cells.map((c) => [c.id, c.y, c.h])).toEqual([
			["stats#world", 0, 2],
			["messages", 2, 7],
			["album", 9, 3]
		])
	})

	it("a declared height applies when none is stored: a composer panel is small", () => {
		const pv = previewOf(
			layout({ middle: [p("p1", ["messages"]), p("c", ["composer"])] })
		)
		expect(pv.middle.cells.map((c) => [c.id, c.h])).toEqual([
			["messages", 10],
			["composer", 2]
		])
	})

	it("says how many tabs a panel holds, and names it by every tab", () => {
		const pv = previewOf(
			layout({ right: [p("a", ["stats", "places"])] }),
			(id) => (id === "stats" ? "Stats" : "Places")
		)
		expect(pv.right.cells[0]).toMatchObject({
			id: "stats",
			key: "a",
			tabs: 2,
			label: "Stats · Places"
		})
	})

	it("draws no box for a retired widget a saved preset still names", () => {
		const pv = previewOf(
			layout({
				middle: [p("p1", ["messages"]), p("c", ["inventory"])],
				right: [p("r1", ["inventory"]), p("r2", ["notes"])]
			})
		)
		expect(pv.middle.cells.map((c) => c.id)).toEqual(["messages"])
		expect(pv.right.cells.map((c) => c.id)).toEqual(["notes"])
	})
})

describe("previewOf — the page's own reading (panelsOf, resolveDrawn)", () => {
	it("Adventure: the world strip over the conversation, the party and the lore on the sides", async () => {
		const { STORY_WORLD_LAYOUT } = await import("@serene-pub/core-catalog")
		const pv = previewOf(STORY_WORLD_LAYOUT)
		const ids = (z: { cells: Array<{ id: string }> }) =>
			z.cells.map((c) => c.id)
		expect(ids(pv.middle)).toContain("stats#world")
		expect(ids(pv.middle)).toContain("messages")
		expect(ids(pv.middle).indexOf("stats#world")).toBeLessThan(
			ids(pv.middle).indexOf("messages")
		)
		expect(ids(pv.right)).toEqual(
			expect.arrayContaining(["scene-portraits", "stats"])
		)
		expect(ids(pv.left)).toEqual(
			expect.arrayContaining(["chronicle", "lore-entries"])
		)
		for (const z of [pv.left, pv.middle, pv.right])
			expect(z.cells.reduce((n, c) => n + c.h, 0)).toBeLessThanOrEqual(
				z.rows
			)
	})

	it("an old-slot preset is read through the converter: the middle gains the turn line and composer", () => {
		const pv = previewOf({
			zoneLayout: {
				version: 1,
				zones: {
					right: { kind: "side", side: "right", widgets: ["notes"] }
				}
			}
		})
		expect(pv.right.cells.map((c) => c.id)).toEqual(["notes"])
		expect(pv.middle.cells.map((c) => c.id)).toEqual([
			"messages",
			"turn-line",
			"composer"
		])
	})

	it("draws a layout holding no conversation as it is (no lock): no floor over stored panels", () => {
		const pv = previewOf(layout({ middle: [p("p1", ["world-state"])] }))
		expect(pv.middle.cells.map((c) => c.id)).toEqual(["world-state"])
	})

	it("labels every box through the supplied resolver", () => {
		const pv = previewOf(
			layout({ right: [p("a", ["scene-portraits"])] }),
			(id) => (id === "scene-portraits" ? "Scene Portraits" : id)
		)
		expect(pv.right.cells[0].label).toBe("Scene Portraits")
		expect(pv.middle.cells[0].label).toBe("messages")
	})

	it("a genre's own primary is the one the floor keeps", () => {
		const pv = previewOf({}, (id) => id, "acme.battleship:board")
		expect(pv.middle.cells.map((c) => c.id)).toEqual([
			"acme.battleship:board"
		])
	})
})
