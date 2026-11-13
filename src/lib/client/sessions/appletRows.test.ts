import { describe, expect, it } from "vitest"
import { appletOwner, appletRows, genreNamesFor } from "./appletRows"

const card = (title: string, extra: object = {}) => ({ title, ...extra })
const TOWN = card("Town Life", { poster: "/p.png", logo: "/l.png", blurb: "A town." })
const g = (genreId: string, name: string, shape: any, appletCard?: ReturnType<typeof card>) => ({
	genreId,
	name,
	shape,
	appletCard
})

describe("appletRows", () => {
	it("groups applet genres by their view plugin into one row, carrying the card art", () => {
		const rows = appletRows([
			g("a.b:genre/x", "Alpha", { applet: true, view: "a.b" }, TOWN),
			g("a.b:genre/y", "Beta", { applet: true, view: "a.b" }, TOWN),
			g("c.d:genre/z", "Zed", { applet: true, view: "c.d" }, card("Zed")),
			g("core:genre/story", "Story", {}),
			g("e.f:genre/q", "Quiet", { view: "e.f" })
		])
		expect(rows.map((r) => r.pluginId)).toEqual(["a.b", "c.d"])
		expect(rows[0]).toEqual({
			pluginId: "a.b",
			title: "Town Life",
			poster: "/p.png",
			logo: "/l.png",
			blurb: "A town.",
			genres: [
				{ genreId: "a.b:genre/x", name: "Alpha" },
				{ genreId: "a.b:genre/y", name: "Beta" }
			]
		})
		expect(rows[1].title).toBe("Zed")
		expect(rows[1].poster).toBeUndefined()
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
