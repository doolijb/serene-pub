import { describe, expect, it } from "vitest"
import { nextWidth, snapWidth, viewForPath, viewPath } from "./viewRoutes"

describe("view addresses", () => {
	it("maps a view to its address and back", () => {
		expect(viewPath("characters")).toBe("/characters")
		expect(viewForPath("/characters")).toBe("characters")
		expect(viewForPath("/characters/")).toBe("characters")
		expect(viewPath("library")).toBe("/library")
		expect(viewForPath("/library")).toBe("library")
	})

	it("gives no address to views whose paths are real pages", () => {
		expect(viewForPath("/admin/prompts/12")).toBe("admin")
		expect(viewForPath("/docs")).toBe("help")
		expect(viewForPath("/docs/sdk/laws")).toBe("help")
		expect(viewForPath("/docsomething")).toBeNull()
		expect(viewForPath("/administrator")).toBeNull()
		expect(viewPath("pipelines")).toBeNull()
		expect(viewPath("toString")).toBeNull()
	})

	it("matches exactly, never a prefix", () => {
		expect(viewForPath("/sessions/42")).toBeNull()
		// The card image proxy lives under the Library's address and is not it.
		expect(viewForPath("/library/cardImage/charavault/x.png")).toBeNull()
		expect(viewForPath("/")).toBeNull()
	})
})

describe("widths", () => {
	it("cycles dock → half → focus → dock", () => {
		expect(nextWidth("dock")).toBe("half")
		expect(nextWidth("half")).toBe("focus")
		expect(nextWidth("focus")).toBe("dock")
	})

	it("snaps a released drag to the nearest width", () => {
		expect(snapWidth(420, 1376)).toBe("dock")
		expect(snapWidth(600, 1376)).toBe("half")
		expect(snapWidth(1200, 1376)).toBe("focus")
		expect(snapWidth(100, 0)).toBe("dock")
	})
})
