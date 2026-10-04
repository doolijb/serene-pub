import { describe, it, expect, beforeAll } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { parsePluginWidgetId } from "@serene-pub/sdk"
import {
	storePluginFiles,
	readPluginFile,
	isSafeUiPath,
	surfacesOf,
	enabledPluginWidgetIds,
	pluginWidgetDecls,
	seatableWidgetIds,
	frameSrc,
	frameCsp
} from "./frameHost"
import { declaredPermissions, reviewMarks } from "./permissions"

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
	it("reads session-view and page tolerantly", () => {
		const s = surfacesOf({
			surfaces: {
				"session-view": { entry: "ui/s.html", title: "Crawl" },
				page: { entry: "ui/index.html" },
				// Gone: a frame in a session is a widget now, and this reader
				// does not answer for the old list.
				panels: [{ id: "map", entry: "ui/map.html" }]
			}
		})
		expect(s).toEqual({
			sessionView: { entry: "ui/s.html", title: "Crawl" },
			page: { entry: "ui/index.html" }
		})
		expect(surfacesOf(null)).toEqual({})
		expect(frameSrc("acme/x", "ui/s.html")).toBe(
			"/plugin-ui/acme/x/ui/s.html"
		)
	})

	it("an unsafe entry path is dropped, not served", () => {
		expect(
			surfacesOf({ surfaces: { page: { entry: "../escape" } } }).page
		).toBeUndefined()
	})

	/**
	 * The namespacing (ruled 2026-09-17). A package picks its widget id in
	 * private, so two packages declaring `map` declare one id — and a layout
	 * row outlives the install that could have told them apart.
	 */
	it("two packages declaring the same widget id declare two widgets", () => {
		const manifest = {
			widgets: [
				{ id: "map", title: "Map", component: "map" }
			]
		}
		const [a] = pluginWidgetDecls(manifest, "acme.dice")
		const [b] = pluginWidgetDecls(manifest, "rival.pkg")
		expect(a.id).toBe("acme.dice:map")
		expect(b.id).toBe("rival.pkg:map")
		// And neither can be a core or genre widget's id, which are plain.
		expect(parsePluginWidgetId(a.id)).toEqual({
			pluginId: "acme.dice",
			panelId: "map"
		})
	})

	it("only an ENABLED plugin's widget ids are answered for", async () => {
		const widget = (id: string) => ({ id, title: id, component: id })
		const manifest = { widgets: [widget("tray"), widget("log")] }
		await db.insert(schema.plugins).values([
			{
				pluginId: "acme.on",
				name: "On",
				bundleSource: "// x",
				bundleHash: "d1",
				enabled: true,
				manifest
			},
			{
				pluginId: "acme.off",
				name: "Off",
				bundleSource: "// x",
				bundleHash: "d2",
				enabled: false,
				manifest
			}
		])
		const ids = await enabledPluginWidgetIds(db)
		expect(ids.has("acme.on:tray")).toBe(true)
		expect(ids.has("acme.on:log")).toBe(true)
		// A disabled plugin's rows are never deleted — they simply stop being
		// answered for, so a re-enable brings the arrangement back.
		expect(ids.has("acme.off:tray")).toBe(false)
		// The bare id is nobody's widget.
		expect(ids.has("tray")).toBe(false)
	})

	/**
	 * A component widget is what `sessions:view` seats
	 * (`showcase.battleship:board` from exactly this), so every allow-list
	 * built on the enabled set must answer for it, and for a DISABLED
	 * plugin's not at all.
	 */
	it("counts an enabled plugin's component widgets, not a disabled one's", async () => {
		const manifest = {
			widgets: [
				{ id: "board", component: "board", role: "primary" },
				{ id: "ledger", component: "ledger", maxInstances: 2 },
				{ component: "anonymous" },
				null,
				{ id: "chart", component: "chart" }
			]
		}
		await db.insert(schema.plugins).values([
			{
				pluginId: "acme.game",
				name: "Game",
				bundleSource: "// x",
				bundleHash: "g1",
				enabled: true,
				manifest
			},
			{
				pluginId: "acme.shelved",
				name: "Shelved",
				bundleSource: "// x",
				bundleHash: "g2",
				enabled: false,
				manifest
			}
		])
		const ids = await enabledPluginWidgetIds(db)
		expect(ids.has("acme.game:board")).toBe(true)
		expect(ids.has("acme.game:ledger")).toBe(true)
		expect(ids.has("acme.game:chart")).toBe(true)
		expect(ids.has("acme.shelved:board")).toBe(false)
		expect(ids.has("acme.shelved:chart")).toBe(false)
		expect(ids.has("board")).toBe(false)

		// And the per-session allow-list a widget-settings write is held to.
		const seatable = await seatableWidgetIds(db, "core:genre/chat")
		expect(seatable.has("acme.game:board")).toBe(true)
		expect(seatable.has("acme.game:chart")).toBe(true)
		expect(seatable.has("acme.shelved:board")).toBe(false)

		// The one list both halves read, per manifest, namespaced, in
		// declaration order — as the layout validator lists them.
		expect(pluginWidgetDecls(manifest, "acme.game")).toEqual([
			{ id: "acme.game:board" },
			{ id: "acme.game:ledger", maxInstances: 2 },
			{ id: "acme.game:chart" }
		])
		expect(pluginWidgetDecls(null, "acme.game")).toEqual([])
	})
})

describe("the composed CSP", () => {
	it("locks the frame down and projects network grants into connect-src", () => {
		// No network permission: connect-src is 'none'.
		const denied = frameCsp({ permissions: {} }, null)
		expect(denied).toContain("default-src 'none'")
		expect(denied).toContain("connect-src 'none'")
		expect(denied).toContain("form-action 'none'")
		// The document is sandboxed by its own header, so a direct navigation
		// never runs it as the app; only this app's pages may frame it.
		expect(denied).toContain("sandbox allow-scripts")
		expect(denied).not.toMatch(/allow-same-origin/)
		expect(denied).toContain("frame-ancestors 'self'")

		// A declared-but-unreviewed host is not a grant: until an admin has
		// consented, the frame reaches no further than a plugin with no
		// permission at all (permissions.ts's review gate).
		const asked = {
			permissions: { network: { hosts: ["api.example.com"] } }
		}
		expect(frameCsp(asked, null)).toContain("connect-src 'none'")

		// A granted host projects into connect-src, on both schemes.
		const consented = reviewMarks(declaredPermissions(asked))
		const granted = frameCsp(asked, consented)
		expect(granted).toContain("https://api.example.com")
		expect(granted).toContain("wss://api.example.com")
		expect(granted).not.toContain("connect-src 'none'")

		// Admin-denying the grant removes it from the frame's reach too.
		const revoked = frameCsp(asked, [
			...consented,
			"network:api.example.com"
		])
		expect(revoked).toContain("connect-src 'none'")
	})
})
