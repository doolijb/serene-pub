import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import {
	storePluginFiles,
	readPluginFile,
	isSafeUiPath,
	surfacesOf,
	frameSrc,
	frameCsp
} from "./frameHost"

/**
 * Frame surfaces, server half (20 §12): file storage refuses traversal,
 * surfaces read tolerantly, and the CSP is composed from the plugin's *network
 * grants* — the same declared permission that governs the server fetchHost
 * decides where the frame may connect.
 */

let db: TestDb

beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

describe("path safety", () => {
	it("refuses traversal, absolute, and dotfile-escape paths", () => {
		expect(isSafeUiPath("ui/index.html")).toBe(true)
		expect(isSafeUiPath("a/b/c.js")).toBe(true)
		expect(isSafeUiPath("../etc/passwd")).toBe(false)
		expect(isSafeUiPath("/abs")).toBe(false)
		expect(isSafeUiPath("ui/../../x")).toBe(false)
		expect(isSafeUiPath("ui/./x")).toBe(false)
	})
})

describe("file storage", () => {
	it("stores safe files wholesale, refuses unsafe ones by name", async () => {
		const r = await storePluginFiles(db, "acme/x", [
			{
				path: "ui/index.html",
				mime: "text/html",
				data: Buffer.from("<h1>hi</h1>").toString("base64")
			},
			{ path: "../evil", mime: "text/html", data: "eA==" }
		])
		expect(r.stored).toBe(1)
		expect(r.refused).toEqual(["../evil"])

		const file = await readPluginFile(db, "acme/x", "ui/index.html")
		expect(file).toBeTruthy()
		expect(Buffer.from(file!.content, "base64").toString()).toBe(
			"<h1>hi</h1>"
		)
		// Traversal never reads even if a row somehow existed.
		expect(await readPluginFile(db, "acme/x", "../secret")).toBeUndefined()
	})

	it("replaces the set wholesale, like the bundle", async () => {
		await storePluginFiles(db, "acme/y", [
			{ path: "a.js", mime: "text/javascript", data: "eA==" },
			{ path: "b.js", mime: "text/javascript", data: "eA==" }
		])
		await storePluginFiles(db, "acme/y", [
			{ path: "a.js", mime: "text/javascript", data: "eQ==" }
		])
		expect(await readPluginFile(db, "acme/y", "b.js")).toBeUndefined()
		const a = await readPluginFile(db, "acme/y", "a.js")
		expect(Buffer.from(a!.content, "base64").toString()).toBe("y")
	})
})

describe("surface declarations", () => {
	it("reads session-view, page, and panels tolerantly", () => {
		const s = surfacesOf({
			surfaces: {
				"session-view": { entry: "ui/s.html", title: "Crawl" },
				page: { entry: "ui/index.html" },
				panels: [
					{ id: "map", entry: "ui/map.html", title: "Map" },
					{ id: "BAD ID", entry: "ui/x.html" },
					{ id: "noentry" }
				]
			}
		})
		expect(s.sessionView).toEqual({ entry: "ui/s.html", title: "Crawl" })
		expect(s.page).toEqual({ entry: "ui/index.html" })
		expect(s.panels).toEqual([
			{ id: "map", entry: "ui/map.html", title: "Map" }
		])
		expect(surfacesOf(null)).toEqual({ panels: [] })
		expect(frameSrc("acme/x", "ui/s.html")).toBe(
			"/plugin-ui/acme/x/ui/s.html"
		)
	})

	it("an unsafe entry path is dropped, not served", () => {
		expect(
			surfacesOf({ surfaces: { page: { entry: "../escape" } } }).page
		).toBeUndefined()
	})
})

describe("the composed CSP", () => {
	it("locks the frame down and projects network grants into connect-src", () => {
		// No network permission: connect-src is 'none'.
		const denied = frameCsp({ permissions: {} }, null)
		expect(denied).toContain("default-src 'none'")
		expect(denied).toContain("connect-src 'none'")
		expect(denied).toContain("form-action 'none'")

		// A granted host projects into connect-src, on both schemes.
		const granted = frameCsp(
			{ permissions: { network: { hosts: ["api.example.com"] } } },
			null
		)
		expect(granted).toContain("https://api.example.com")
		expect(granted).toContain("wss://api.example.com")
		expect(granted).not.toContain("connect-src 'none'")

		// Admin-denying the grant removes it from the frame's reach too.
		const revoked = frameCsp(
			{ permissions: { network: { hosts: ["api.example.com"] } } },
			["network:api.example.com"]
		)
		expect(revoked).toContain("connect-src 'none'")
	})
})
