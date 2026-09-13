/**
 * The drawings are lenses now, and a lens is offered in every book. So is the
 * build: the summarization switch that used to gate it is gone (0126), so both
 * answers stand as seams a future gate would sit in rather than as questions
 * about the instance.
 */
import { describe, expect, it } from "vitest"
import { drawingForLens, graphBuildReason, lensReason } from "./graphs"

const LENSES = ["list", "cards", "tree", "graph", "time", "places"] as const

describe("lensReason — why a lens cannot be drawn", () => {
	it("offers every lens", () => {
		for (const lens of LENSES) expect(lensReason(lens)).toBeNull()
	})
})

describe("graphBuildReason — why the graph cannot be built from a session", () => {
	it("offers the build with no setting to ask", () => {
		expect(graphBuildReason()).toBeNull()
	})
})

describe("drawingForLens — which canvas a lens asks for", () => {
	it("maps the two canvas lenses onto the canvases", () => {
		expect(drawingForLens("graph")).toBe("relationships")
		expect(drawingForLens("places")).toBe("places")
	})

	it("says the pool draws itself for the three reading lenses", () => {
		expect(drawingForLens("list")).toBeNull()
		expect(drawingForLens("cards")).toBeNull()
		expect(drawingForLens("tree")).toBeNull()
	})

	it("leaves the time lens to draw its own lanes", () => {
		expect(drawingForLens("time")).toBeNull()
	})
})
