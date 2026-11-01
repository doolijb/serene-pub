import { describe, expect, it } from "vitest"
import { appletMount } from "./appletMount"
import { declaredPermissions, reviewMarks } from "./permissions"

const manifest = {
	id: "acme.cards",
	name: "Cards",
	version: "1.0.0",
	permissions: ["storage", "applet:characters:read", "applet:annex:user", "network"],
	surfaces: { "session-view": { entry: "view.html", title: "Card table" } }
}
const genres = [
	{ genreId: "acme.cards:genre/solitaire", name: "Solitaire", shape: { applet: true, view: "acme.cards" } },
	{ genreId: "acme.cards:genre/plain", name: "Plain", shape: {} },
	{ genreId: "other:genre/x", name: "X", shape: { applet: true, view: "other" } }
]

describe("appletMount", () => {
	it("is null for a disabled or missing plugin", () => {
		expect(appletMount("acme.cards", undefined, genres)).toBeNull()
		expect(appletMount("acme.cards", { enabled: false, name: "C", manifest }, genres)).toBeNull()
	})
	it("is null when the plugin offers no applet genre of its own", () => {
		expect(appletMount("acme.cards", { enabled: true, name: "C", manifest }, [genres[1], genres[2]])).toBeNull()
	})
	it("is null without a session-view surface", () => {
		expect(appletMount("acme.cards", { enabled: true, name: "C", manifest: { ...manifest, surfaces: {} } }, genres)).toBeNull()
	})
	it("mounts the surface with its own genres; unreviewed permissions grant nothing", () => {
		const m = appletMount("acme.cards", { enabled: true, name: "C", version: "1.0.0", manifest, adminDenied: [] }, genres)
		expect(m?.title).toBe("Card table")
		expect(m?.src).toContain("acme.cards")
		expect(m?.genres).toEqual([{ genreId: "acme.cards:genre/solitaire", name: "Solitaire" }])
		expect(m?.grants).toEqual([])
	})
	it("grants the reviewed applet and storage keys, minus denials, and nothing else", () => {
		const marks = reviewMarks(declaredPermissions(manifest as any))
		const m = appletMount("acme.cards", { enabled: true, name: "C", manifest, adminDenied: [...marks, "applet:annex:user"] }, genres)
		expect(m?.grants.sort()).toEqual(["applet:characters:read", "storage"])
	})
})
