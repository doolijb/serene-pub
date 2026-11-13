import { describe, expect, it } from "vitest"
import {
	appsAddressVerdict,
	isAppletLauncherPath,
	nextWidth,
	snapWidth,
	viewForPath,
	viewPath
} from "./viewRoutes"

describe("view addresses", () => {
	it("maps a view to its address and back", () => {
		expect(viewPath("characters")).toBe("/characters")
		expect(viewForPath("/characters")).toBe("characters")
		expect(viewForPath("/characters/")).toBe("characters")
		expect(viewPath("library")).toBe("/library")
		expect(viewForPath("/library")).toBe("library")
		expect(viewPath("models")).toBe("/models")
		expect(viewForPath("/models")).toBe("models")
		expect(viewPath("loadouts")).toBe("/loadouts")
		expect(viewForPath("/loadouts")).toBe("loadouts")
		expect(viewPath("connections")).toBe("/connections")
	})

	it("gives no address to views whose paths are real pages", () => {
		expect(viewForPath("/admin/prompts/12")).toBe("admin")
		expect(viewForPath("/docs")).toBe("help")
		expect(viewForPath("/docs/sdk/laws")).toBe("help")
		expect(viewPath("conversations")).toBe("/messages")
		expect(viewForPath("/messages")).toBe("conversations")
		expect(viewForPath("/messages/12")).toBe("conversations")
		expect(viewForPath("/messages/people/4")).toBe("conversations")
		expect(viewForPath("/messagesx")).toBeNull()
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

describe("Apps view address (M2d)", () => {
	it("owns /apps, not the launchers under it", () => {
		expect(viewPath("apps")).toBe("/apps")
		expect(viewForPath("/apps")).toBe("apps")
		expect(viewForPath("/apps/")).toBe("apps")
		expect(viewForPath("/apps/some.plugin")).toBeNull()
	})
	it("a launcher path needs a segment after /apps/", () => {
		expect(isAppletLauncherPath("/apps/some.plugin")).toBe(true)
		expect(isAppletLauncherPath("/apps/some.plugin/x")).toBe(true)
		expect(isAppletLauncherPath("/apps")).toBe(false)
		expect(isAppletLauncherPath("/apps/")).toBe(false)
		expect(isAppletLauncherPath("/appsx")).toBe(false)
	})
	it("a cold /apps waits for the genres, then opens or goes Home", () => {
		expect(appsAddressVerdict(null)).toBe("wait")
		expect(appsAddressVerdict(0)).toBe("home")
		expect(appsAddressVerdict(2)).toBe("open")
	})
})
