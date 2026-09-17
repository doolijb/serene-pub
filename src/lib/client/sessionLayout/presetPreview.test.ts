/**
 * The Presets tab's picture. Pure input → geometry, so the one part of that tab
 * with real logic is covered without a component harness.
 */
import { describe, expect, it } from "vitest"
import { previewOf } from "./presetPreview"

describe("previewOf — the shipped default", () => {
	it("draws the built-in chat arrangement for an empty preset", () => {
		const p = previewOf({})
		expect(p.middle.cells.map((c) => c.id)).toEqual(["messages"])
		// The conversation is the whole middle.
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

describe("previewOf — zoneLayout side zones", () => {
	it("stacks a side zone's widgets top to bottom", () => {
		const p = previewOf({
			zoneLayout: {
				version: 1,
				zones: {
					right: {
						kind: "side",
						side: "right",
						widgets: ["scene-portraits", "sample-map"]
					}
				}
			}
		})
		expect(p.right.cells.map((c) => c.id)).toEqual([
			"scene-portraits",
			"sample-map"
		])
		expect(p.right.cells.map((c) => c.y)).toEqual([0, 1])
		expect(p.left.cells).toEqual([])
	})

	it("routes a left-side zone to the left column", () => {
		const p = previewOf({
			zoneLayout: {
				version: 1,
				zones: {
					l: { kind: "side", side: "left", widgets: ["tasks"] }
				}
			}
		})
		expect(p.left.cells.map((c) => c.id)).toEqual(["tasks"])
		expect(p.right.cells).toEqual([])
	})

	it("ignores strips and non-string widget entries", () => {
		const p = previewOf({
			zoneLayout: {
				version: 1,
				zones: {
					top: { kind: "strip", area: "top", widgets: ["banner"] },
					right: {
						kind: "side",
						side: "right",
						widgets: ["ok", 5, null]
					}
				}
			}
		})
		expect(p.right.cells.map((c) => c.id)).toEqual(["ok"])
		expect(p.left.cells).toEqual([])
	})
})

describe("previewOf — arrangedGrid wins", () => {
	const arranged = {
		arrangedGrid: {
			middle: {
				cols: 4,
				rows: 8,
				items: [
					{ id: "world-state", x: 0, y: 0, w: 4, h: 2 },
					{ id: "messages", x: 0, y: 2, w: 4, h: 6 }
				]
			}
		}
	}

	it("uses the editor's captured geometry over the defaults", () => {
		const p = previewOf(arranged)
		expect(p.middle.cols).toBe(4)
		expect(p.middle.rows).toBe(8)
		expect(p.middle.cells[1]).toMatchObject({
			id: "messages",
			y: 2,
			h: 6
		})
	})

	it("draws no block for a retired widget id a saved preset still names", () => {
		// A preset arranged when the composer was its own widget. The picture
		// has to show what applying it will actually produce.
		const p = previewOf({
			arrangedGrid: {
				middle: {
					cols: 4,
					rows: 8,
					items: [
						{ id: "messages", x: 0, y: 0, w: 4, h: 6 },
						{ id: "composer", x: 0, y: 6, w: 4, h: 2 }
					]
				}
			},
			zoneLayout: {
				version: 1,
				zones: {
					right: {
						kind: "side",
						side: "right",
						widgets: ["composer", "notes"]
					}
				}
			}
		})
		expect(p.middle.cells.map((c) => c.id)).toEqual(["messages"])
		expect(p.right.cells.map((c) => c.id)).toEqual(["notes"])
	})

	it("grows the frame so nothing is clipped by the schematic's defaults", () => {
		const p = previewOf({
			arrangedGrid: {
				right: {
					cols: 1,
					rows: 1,
					items: [{ id: "wide", x: 0, y: 0, w: 6, h: 9 }]
				}
			}
		})
		expect(p.right.cols).toBe(6)
		expect(p.right.rows).toBe(9)
	})

	it("falls back per zone — an arranged middle leaves the sides to zoneLayout", () => {
		const p = previewOf({
			...arranged,
			zoneLayout: {
				version: 1,
				zones: {
					right: { kind: "side", side: "right", widgets: ["notes"] }
				}
			}
		})
		expect(p.middle.cols).toBe(4)
		expect(p.right.cells.map((c) => c.id)).toEqual(["notes"])
	})

	it("skips malformed items and falls back when none survive", () => {
		const p = previewOf({
			arrangedGrid: { middle: { cols: 4, rows: 8, items: [{ x: 1 }] } }
		})
		expect(p.middle.cells.map((c) => c.id)).toEqual(["messages"])
	})
})

describe("previewOf — labels", () => {
	it("labels every cell through the supplied resolver", () => {
		const p = previewOf(
			{
				zoneLayout: {
					version: 1,
					zones: {
						right: {
							kind: "side",
							side: "right",
							widgets: ["scene-portraits"]
						}
					}
				}
			},
			(id) => (id === "scene-portraits" ? "Scene Portraits" : id)
		)
		expect(p.right.cells[0].label).toBe("Scene Portraits")
		expect(p.middle.cells[0].label).toBe("messages")
	})
})
