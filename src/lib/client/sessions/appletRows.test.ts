import { describe, expect, it } from "vitest"
import { appletOwner, appletRows, genreNamesFor } from "./appletRows"

const g = (genreId: string, name: string, shape: any, appletTitle?: string) => ({ genreId, name, shape, appletTitle })

describe("appletRows", () => {
	it("groups applet genres by their view plugin into one row, named by the launcher's title", () => {
		const rows = appletRows([
			g("a.b:genre/x", "Alpha", { applet: true, view: "a.b" }, "Town Life"),
			g("a.b:genre/y", "Beta", { applet: true, view: "a.b" }, "Town Life"),
			g("c.d:genre/z", "Zed", { applet: true, view: "c.d" }, "Zed"),
			g("core:genre/story", "Story", {}),
			g("e.f:genre/q", "Quiet", { view: "e.f" })
		])
		expect(rows.map((r) => r.pluginId)).toEqual(["a.b", "c.d"])
		expect(rows[0].label).toBe("Town Life")
		expect(rows[0].subtitle).toBe("Alpha · Beta")
		expect(rows[1].label).toBe("Zed")
	})
	it("lists no genre the server did not vouch for (its launcher would not mount)", () => {
		expect(appletRows([g("a.b:genre/x", "Alpha", { applet: true, view: "a.b" })])).toEqual([])
	})
	it("is empty with no applets", () => {
		expect(appletRows([g("core:genre/story", "Story", {})])).toEqual([])
	})
	it("appletOwner needs both applet and view", () => {
		expect(appletOwner({ applet: true })).toBeNull()
		expect(appletOwner({ applet: true, view: "p" })).toBe("p")
		expect(appletOwner(null)).toBeNull()
	})
	it("genreNamesFor drops unknown ids", () => {
		expect(genreNamesFor(["a", "nope"], [{ genreId: "a", name: "A" }])).toEqual(["A"])
	})
})
