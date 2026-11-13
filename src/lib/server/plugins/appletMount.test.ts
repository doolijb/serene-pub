import { describe, expect, it } from "vitest"
import { appletMount, appletCardOf } from "./appletMount"
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

	describe("appletCard (🚧 M2d)", () => {
		const card = {
			poster: "assets/poster.png",
			logo: "assets/img/logo.svg",
			blurb: { en: "Play cards", fr: "Jouer" }
		}
		const row = (extra: Record<string, unknown>, version: string | null = "1.0.0") => ({
			enabled: true,
			name: "C",
			version,
			manifest: { ...manifest, assets: { dir: "assets" }, ...extra },
			adminDenied: []
		})
		it("serves poster and logo under the encoded version, and resolves the blurb", () => {
			const m = appletMount("acme.cards", row({ appletCard: card }, "1.0.0+b1"), genres)
			expect(m?.poster).toBe("/plugin-assets/acme.cards/1.0.0%2Bb1/assets/poster.png")
			expect(m?.logo).toBe("/plugin-assets/acme.cards/1.0.0%2Bb1/assets/img/logo.svg")
			expect(m?.blurb).toBe("Play cards")
		})
		it("omits a path outside assets, an unsafe one, or any path without a version", () => {
			const out = appletMount("acme.cards", row({ appletCard: { poster: "ui/p.png", logo: "assets/../x.png" } }), genres)
			expect(out && "poster" in out).toBe(false)
			expect(out && "logo" in out).toBe(false)
			const nov = appletMount("acme.cards", row({ appletCard: card }, null), genres)
			expect(nov && "poster" in nov).toBe(false)
			expect(nov && "logo" in nov).toBe(false)
			expect(nov?.blurb).toBe("Play cards")
			const noAssets = appletMount("acme.cards", { ...row({ appletCard: card }), manifest: { ...manifest, appletCard: card } }, genres)
			expect(noAssets && "poster" in noAssets).toBe(false)
		})
		it("without an appletCard the mount carries no new keys", () => {
			const m = appletMount("acme.cards", row({}), genres)
			expect(Object.keys(m!).sort()).toEqual(["genres", "grants", "src", "title"])
		})
		it("the card of a mount is the row's shape", () => {
			const m = appletMount("acme.cards", row({ appletCard: card }), genres)!
			expect(appletCardOf(m)).toEqual({
				title: "Card table",
				poster: m.poster,
				logo: m.logo,
				blurb: "Play cards"
			})
			const bare = appletMount("acme.cards", row({}), genres)!
			expect(appletCardOf(bare)).toEqual({ title: "Card table" })
		})
	})
})
