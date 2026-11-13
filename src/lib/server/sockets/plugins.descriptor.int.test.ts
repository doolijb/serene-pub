import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"

/**
 * ONE descriptor builder (M2b fix). Every admin action re-registers a plugin
 * through the plugins socket; the boot read registers through `store.ts`. They
 * were two builders once, and the socket's dropped per-user storage, the user
 * annex and package files — granted on the admin page, "not granted" in the
 * hook until a restart. Here the socket path, with the sandbox ON, must hand the
 * manager exactly what the boot read would, and the grant must work at once.
 */

let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const ID = "acme.shelf"
const MANIFEST = {
	name: "Shelf",
	assets: { dir: "assets" },
	permissions: {
		storage: { quotaBytes: 65536, perUser: { quotaBytes: 4096 } },
		applet: { annex: { user: true } }
	}
}
const BUNDLE = `module.exports = { hooks: {
	use: async function (input, ctx) {
		var w = await ctx.storage.user.files.write("n.txt", new TextEncoder().encode("hi " + input.n));
		var r = await ctx.storage.user.files.read("n.txt");
		var a = await ctx.package.read("assets/a.json");
		return {
			w: w.kind,
			r: r.kind === "ok" ? new TextDecoder().decode(r.value) : r.reason,
			a: a.kind === "ok" ? new TextDecoder().decode(a.value) : a.reason
		};
	}
} }`

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sp-plugins-desc-"))
	vi.stubEnv("SERENE_PUB_DATA_DIR", dataDir)
	vi.stubEnv("SP_PLUGINS_ENABLED", "1")
	// The package's shipped file, where an install of version 1.0.0 puts it.
	const assets = path.join(dataDir, "plugins", ID, "1.0.0", "assets")
	await fs.mkdir(assets, { recursive: true })
	await fs.writeFile(path.join(assets, "a.json"), '{"shelf":1}')
}, 60_000)

afterAll(async () => {
	const { getManager } = await import("$lib/server/plugins")
	await getManager().dispose()
	vi.unstubAllEnvs()
	await fs.rm(dataDir, { recursive: true, force: true })
})

const admin = { user: { id: 1, isAdmin: true } } as any
const noop = () => {}

describe("one descriptor builder (M2b fix)", () => {
	test("approve then enable through the socket puts per-user storage, the user annex and package files in force — no restart", async () => {
		const h = await import("./plugins")
		const { getManager } = await import("$lib/server/plugins")
		const { SandboxManager } = await import("$lib/server/plugins/SandboxManager")
		const { loadEnabledPlugins } = await import("$lib/server/plugins/store")
		const { db } = await import("$lib/server/db")
		const register = vi.spyOn(SandboxManager.prototype, "register")

		await h.pluginsInstall.handler(
			admin,
			{ pluginId: ID, name: "Shelf", version: "1.0.0", bundleSource: BUNDLE, backends: ["quickjs", "ses"], manifest: MANIFEST },
			noop
		)
		await h.pluginsReviewPermissions.handler(admin, { pluginId: ID }, noop)
		await h.pluginsSetEnabled.handler(admin, { pluginId: ID, enabled: true }, noop)

		// What the socket path registered, against what the boot read builds from the same row.
		const live = register.mock.calls.map(([d]) => d).filter((d) => d.id === ID).at(-1)!
		expect(live).toMatchObject({
			userStorageQuotaBytes: 4096,
			userAnnexGranted: true,
			packageAssets: { version: "1.0.0", dir: "assets" }
		})
		const boot = (await loadEnabledPlugins(db as never)).find((d) => d.id === ID)
		expect(live).toEqual(boot)

		// And in force at once: the hook writes the person's own file and reads the package's.
		const mgr = getManager()
		mgr.markReady()
		const res = await mgr.callHook(ID, "use", { n: 1 }, { kind: "outlet", timeoutMs: 15_000, user: "1", frameCause: { pluginId: ID } })
		expect(res.ok && res.value).toEqual({ w: "ok", r: "hi 1", a: '{"shelf":1}' })
		register.mockRestore()
	}, 120_000)
})
