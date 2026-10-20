/**
 * The Presets tab's picture. Pure input → geometry, so the one part of that tab
 * with real logic is covered without a component harness. Each zone is its
 * panels stacked in twelve rows (PLAN-session-panels-2026-10-14).
 */
import { describe, expect, it } from "vitest"
import type { PanelLayoutV1 } from "@serene-pub/sdk"
import { previewOf } from "./presetPreview"

const layout = (over: Partial<PanelLayoutV1> = {}) => ({
	panels: {
		version: 1 as const,
		left: [],
		right: [],
		middle: { above: [], primary: { key: "p1", tabs: ["messages"] }, below: [] },
		...over
	}
})

describe("previewOf — the shipped default", () => {
	it("draws the conversation filling the middle for an empty preset", () => {
		const p = previewOf({})
		expect(p.middle.cells.map((c) => c.id)).toEqual(["messages"])
		const [messages] = p.middle.cells
		expect(messages.y).toBe(0)
		expect(messages.h).toBe(p.middle.rows)
		expect(p.left.cells).toEqual([])
		expect(p.right.cells).toEqual([])
	})

	it("degrades a malformed blob to the same default rather than throwing", () => {
		for (const bad of [undefined, null, "x", 7, [1, 2]]) {
			const p = previewOf(bad)
			expect(p.middle.cells.map((c) => c.id)).toEqual(["messages"])
		}
	})
})

describe("previewOf — a side is its panels, stacked", () => {
	it("stacks a side's panels top to bottom, fills sharing the column", () => {
		const p = previewOf(
			layout({
				right: [
					{ key: "a", tabs: ["scene-portraits"] },
					{ key: "b", tabs: ["sample-map"] }
				]
			})
		)
		expect(p.right.cells.map((c) => [c.id, c.y, c.h])).toEqual([
			["scene-portraits", 0, 6],
			["sample-map", 6, 6]
		])
		expect(p.left.cells).toEqual([])
	})

	it("a share is its own twelfths; fit and a rail panel are small boxes", () => {
		const p = previewOf(
			layout({
				left: [
					{ key: "a", tabs: ["places"], height: { share: 4 } },
					{ key: "b", tabs: ["annex#notes"], height: "fit" },
					{ key: "c", tabs: ["chronicle"], pinned: false },
					{ key: "d", tabs: ["stats"] }
				]
			})
		)
		expect(p.left.cells.map((c) => [c.id, c.h, c.rail])).toEqual([
			["places", 4, false],
			["annex#notes", 2, false],
			["chronicle", 2, true],
			["stats", 4, false]
		])
		expect(p.left.rows).toBe(12)
	})

	it("says how many tabs a panel holds, and names it by every tab", () => {
		const p = previewOf(
			layout({ right: [{ key: "a", tabs: ["stats", "places"] }] }),
			(id) => (id === "stats" ? "Stats" : "Places")
		)
		expect(p.right.cells[0]).toMatchObject({ id: "stats", key: "a", tabs: 2, label: "Stats · Places" })
	})
})

describe("previewOf — the middle", () => {
	it("strips above and below; the primary panel takes what is left", () => {
		const p = previewOf(
			layout({
				middle: {
					above: [{ key: "s", tabs: ["stats#world"], height: "fit" }],
					primary: { key: "p1", tabs: ["messages"] },
					below: [{ key: "b", tabs: ["album"], height: { share: 3 } }]
				}
			})
		)
		expect(p.middle.cells.map((c) => [c.id, c.y, c.h])).toEqual([
			["stats#world", 0, 2],
			["messages", 2, 7],
			["album", 9, 3]
		])
	})

	it("draws no box for a retired widget a saved preset still names", () => {
		const p = previewOf(
			layout({
				middle: {
					above: [],
					primary: { key: "p1", tabs: ["messages"] },
					below: [{ key: "c", tabs: ["composer"] }]
				},
				right: [
					{ key: "r1", tabs: ["composer"] },
					{ key: "r2", tabs: ["notes"] }
				]
			})
		)
		expect(p.middle.cells.map((c) => c.id)).toEqual(["messages"])
		expect(p.right.cells.map((c) => c.id)).toEqual(["notes"])
	})
})

describe("previewOf — the page's own reading (panelsOf, resolveDrawn)", () => {
	it("Adventure: the world strip over the conversation, the party docked, the lore in the rail", async () => {
		const { STORY_WORLD_LAYOUT } = await import("@serene-pub/core-catalog")
		const p = previewOf(STORY_WORLD_LAYOUT)
		expect(p.middle.cells.map((c) => [c.id, c.y, c.h])).toEqual([
			["stats#world", 0, 2],
			["messages", 2, 10]
		])
		expect(p.right.cells.map((c) => [c.id, c.y, c.h])).toEqual([
			["scene-portraits", 0, 6],
			["stats", 6, 6]
		])
		expect(p.left.cells.map((c) => [c.id, c.rail])).toEqual([
			["chronicle", true],
			["lore-entries", true]
		])
	})

	it("an old-slot preset is read through the converter", () => {
		const p = previewOf({
			zoneLayout: {
				version: 1,
				zones: { right: { kind: "side", side: "right", widgets: ["notes"] } }
			}
		})
		expect(p.right.cells.map((c) => c.id)).toEqual(["notes"])
		expect(p.middle.cells.map((c) => c.id)).toEqual(["messages"])
	})

	it("draws a layout holding no conversation as it is (R-B, no lock): no floor over stored panels", () => {
		const p = previewOf(layout({ middle: { above: [], primary: { key: "p1", tabs: ["world-state"] }, below: [] } }))
		expect(p.middle.cells.map((c) => c.id)).toEqual(["world-state"])
	})

	it("labels every box through the supplied resolver", () => {
		const p = previewOf(
			layout({ right: [{ key: "a", tabs: ["scene-portraits"] }] }),
			(id) => (id === "scene-portraits" ? "Scene Portraits" : id)
		)
		expect(p.right.cells[0].label).toBe("Scene Portraits")
		expect(p.middle.cells[0].label).toBe("messages")
	})

	it("a genre's own primary is the one the floor keeps", () => {
		const p = previewOf({}, (id) => id, "acme.battleship:board")
		expect(p.middle.cells.map((c) => c.id)).toEqual(["acme.battleship:board"])
	})
})
