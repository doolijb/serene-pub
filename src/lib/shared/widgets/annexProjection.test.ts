/**
 * `annex.v1` (R57, V1c): the viewer's annex view, as the page holds it, in
 * every widget's data — detached like every section, and `{}` rather than
 * absent when there is nothing to see.
 */
import { describe, expect, it } from "vitest"
import { projectWidgetData } from "./context"

const placement = {
	zone: { id: "main", cols: 1, rows: 1 },
	box: {
		cols: 1,
		rows: 1,
		edges: { top: true, right: true, bottom: true, left: true }
	},
	tier: "md",
	pinned: false,
	collapsed: false,
	drawered: false
} as any

describe("annex.v1", () => {
	it("carries the viewer's view, detached", () => {
		const annex = { "acme.rp": { clue: "a glove" } }
		const data = projectWidgetData({
			session: { id: 1 },
			channels: [],
			messages: [],
			annex,
			placement
		})
		expect(data.annex.v1).toEqual(annex)
		;(data.annex.v1["acme.rp"] as any).clue = "changed"
		expect(annex["acme.rp"].clue).toBe("a glove")
	})

	it("is empty, never absent, with nothing to see", () => {
		const data = projectWidgetData({
			session: { id: 1 },
			channels: [],
			messages: [],
			placement
		})
		expect(data.annex.v1).toEqual({})
	})
})
