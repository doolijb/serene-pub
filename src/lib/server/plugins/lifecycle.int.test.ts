import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import type { SandboxManager } from "./SandboxManager"

/**
 * The five lifecycle moments the host fires beside boot's `startup` (ruled
 * 2026-09-26): enable, disable, update, uninstall and shutdown — each exactly
 * once, at its moment, with its input, and none of them able to hold up the
 * switch, the removal or the exit it rides on.
 *
 * Driven through the admin socket handlers against a real (in-memory) DB and
 * the real sandbox, with the plugin gate ON. The manager's `callHook` is
 * wrapped, not replaced, so every call still runs in the sandbox; the wrapper
 * only notes what was called, with what, and what the row said at that moment.
 */

let testDb: TestDb
const savedFlag = process.env.SP_PLUGINS_ENABLED

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	process.env.SP_PLUGINS_ENABLED = "1"
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	const { shutdownPlugins } = await import("./index")
	await shutdownPlugins()
	if (savedFlag === undefined) delete process.env.SP_PLUGINS_ENABLED
	else process.env.SP_PLUGINS_ENABLED = savedFlag
})

const admin = { user: { id: 1, isAdmin: true } } as any
const emit = () => {}

const MOMENTS = ["enable", "disable", "update", "uninstall", "shutdown"]

/** Every moment answers its input back, so a call's payload is observable. */
const ECHO = `module.exports = { hooks: {
	enable: (i) => i, disable: (i) => i, update: (i) => i,
	uninstall: (i) => i, shutdown: (i) => i, v: (i) => i
} }`

interface Seen {
	pluginId: string
	moment: string
	input: unknown
	/** The row's `enabled` when the call was made (undefined = no row). */
	rowEnabled: boolean | undefined
	registered: boolean
	ok?: boolean
}

let seen: Seen[] = []

async function rowOf(pluginId: string) {
	const [row] = await testDb
		.select()
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, pluginId))
	return row
}

/** Wrap the live manager's `callHook` (once per manager instance). */
async function watch(): Promise<SandboxManager> {
	const { getManager } = await import("./index")
	const mgr = getManager()
	if ((mgr as any).__watched) return mgr
	;(mgr as any).__watched = true
	const real = mgr.callHook.bind(mgr)
	mgr.callHook = async (pluginId, hookName, input, opts) => {
		if (!MOMENTS.includes(hookName)) return real(pluginId, hookName, input, opts)
		const row = await rowOf(pluginId)
		const s: Seen = {
			pluginId,
			moment: hookName,
			input,
			rowEnabled: row?.enabled,
			registered: mgr.isRegistered(pluginId)
		}
		seen.push(s)
		const r = await real(pluginId, hookName, input, opts)
		s.ok = r.ok
		return r
	}
	return mgr
}

const moments = (pluginId: string) =>
	seen.filter((s) => s.pluginId === pluginId).map((s) => s.moment)

async function install(pluginId: string, version: string, bundleSource = ECHO) {
	const h = await import("$lib/server/sockets/plugins")
	await watch()
	await h.pluginsInstall.handler(
		admin,
		{ pluginId, name: pluginId, version, bundleSource, backends: ["quickjs"] },
		emit
	)
}

async function setEnabled(pluginId: string, enabled: boolean) {
	const h = await import("$lib/server/sockets/plugins")
	await watch()
	await h.pluginsSetEnabled.handler(admin, { pluginId, enabled }, emit)
}

async function uninstall(pluginId: string) {
	const h = await import("$lib/server/sockets/plugins")
	await watch()
	await h.pluginsUninstall.handler(admin, { pluginId }, emit)
}

afterEach(async () => {
	seen = []
	const { LIFECYCLE_BOUNDS } = await import("./lifecycle")
	Object.assign(LIFECYCLE_BOUNDS, {
		timeoutMs: 5_000,
		boundMs: 6_000,
		shutdownTimeoutMs: 2_000,
		shutdownBoundMs: 3_000
	})
})

describe("plugin lifecycle moments", () => {
	test("enable fires once, after the switch, with an empty input", async () => {
		await install("acme.enable", "1.0.0")
		expect(moments("acme.enable")).toEqual([]) // an install runs nothing
		await setEnabled("acme.enable", true)
		expect(seen).toEqual([
			{
				pluginId: "acme.enable",
				moment: "enable",
				input: {},
				rowEnabled: true,
				registered: true,
				ok: true
			}
		])
		// Switching on what is already on is not a second enable.
		await setEnabled("acme.enable", true)
		expect(moments("acme.enable")).toEqual(["enable"])
	}, 60_000)

	test("disable fires once, before the switch, while still registered", async () => {
		await install("acme.disable", "1.0.0")
		await setEnabled("acme.disable", true)
		seen = []
		await setEnabled("acme.disable", false)
		expect(seen).toEqual([
			{
				pluginId: "acme.disable",
				moment: "disable",
				input: {},
				rowEnabled: true,
				registered: true,
				ok: true
			}
		])
		expect((await rowOf("acme.disable"))?.enabled).toBe(false)
		const mgr = await watch()
		expect(mgr.isRegistered("acme.disable")).toBe(false)
		// Switching off what is already off is not a second disable.
		await setEnabled("acme.disable", false)
		expect(moments("acme.disable")).toEqual(["disable"])
	}, 60_000)

	test("update fires once, on the replaced bundle's first enable, with both versions", async () => {
		await install("acme.update", "1.0.0")
		await setEnabled("acme.update", true)
		seen = []
		// A changed bundle switches a running plugin off: the OLD copy hears
		// `disable` and is unregistered, and nothing of the new one runs yet.
		await install("acme.update", "2.0.0", ECHO + "\n// v2")
		expect(moments("acme.update")).toEqual(["disable"])
		expect((await watch()).isRegistered("acme.update")).toBe(false)
		expect((await rowOf("acme.update"))?.updateFromVersion).toBe("1.0.0")
		// A second reinstall before it runs keeps the version it came from.
		await install("acme.update", "2.1.0", ECHO + "\n// v2.1")
		expect((await rowOf("acme.update"))?.updateFromVersion).toBe("1.0.0")
		seen = []
		await setEnabled("acme.update", true)
		expect(seen.map((s) => [s.moment, s.input, s.ok])).toEqual([
			["update", { previousVersion: "1.0.0", version: "2.1.0" }, true],
			["enable", {}, true]
		])
		expect((await rowOf("acme.update"))?.updateFromVersion).toBe(null)
		// Exactly once: the next enable is only an enable.
		await setEnabled("acme.update", false)
		seen = []
		await setEnabled("acme.update", true)
		expect(moments("acme.update")).toEqual(["enable"])
	}, 60_000)

	test("a replaced bundle enabled while the app was down hears update at boot, before startup", async () => {
		await install("acme.boot", "1.0.0")
		await install("acme.boot", "1.5.0", ECHO + "\n// boot")
		// Switched on with no sandbox to hear it — the row alone.
		await testDb
			.update(schema.plugins)
			.set({ enabled: true })
			.where(eq(schema.plugins.pluginId, "acme.boot"))
		const { bootstrapPlugins, shutdownPlugins } = await import("./index")
		await shutdownPlugins()
		seen = []
		await watch()
		await bootstrapPlugins(testDb as any)
		expect(
			seen.filter((s) => s.pluginId === "acme.boot").map((s) => [s.moment, s.input])
		).toEqual([["update", { previousVersion: "1.0.0", version: "1.5.0" }]])
		expect((await rowOf("acme.boot"))?.updateFromVersion).toBe(null)
	}, 60_000)

	test("uninstall fires once, before the row is removed", async () => {
		await install("acme.gone", "1.0.0")
		await setEnabled("acme.gone", true)
		seen = []
		await uninstall("acme.gone")
		expect(seen).toEqual([
			{
				pluginId: "acme.gone",
				moment: "uninstall",
				input: {},
				rowEnabled: true,
				registered: true,
				ok: true
			}
		])
		expect(await rowOf("acme.gone")).toBeUndefined()
	}, 60_000)

	test("a switched-off plugin's code does not run on uninstall", async () => {
		await install("acme.off", "1.0.0")
		seen = []
		await uninstall("acme.off")
		expect(moments("acme.off")).toEqual([])
		expect(await rowOf("acme.off")).toBeUndefined()
	}, 60_000)

	test("shutdown fires once per registered plugin, then the manager is torn down", async () => {
		await install("acme.bye", "1.0.0")
		await setEnabled("acme.bye", true)
		const mgr = await watch()
		const others = mgr.registeredIds().filter((id) => id !== "acme.bye")
		seen = []
		const { shutdownPluginsGracefully } = await import("./index")
		await shutdownPluginsGracefully()
		expect(moments("acme.bye")).toEqual(["shutdown"])
		expect(seen.find((s) => s.pluginId === "acme.bye")?.input).toEqual({})
		// Every registered plugin, once each.
		expect(seen.map((s) => s.pluginId).sort()).toEqual(
			["acme.bye", ...others].sort()
		)
		expect(seen.every((s) => s.moment === "shutdown")).toBe(true)
		expect(mgr.registeredIds()).toEqual([]) // disposed
	}, 60_000)
})

describe("a failing or hung callback holds nothing up", () => {
	const HOSTILE = `module.exports = { hooks: {
		enable: () => { throw new Error("enable boom") },
		disable: () => { throw new Error("disable boom") },
		uninstall: () => { while (true) {} },
		shutdown: () => { while (true) {} }
	} }`

	test("enable and disable still switch; uninstall still removes; shutdown still returns", async () => {
		const { LIFECYCLE_BOUNDS } = await import("./lifecycle")
		Object.assign(LIFECYCLE_BOUNDS, {
			timeoutMs: 300,
			boundMs: 1_000,
			shutdownTimeoutMs: 300,
			shutdownBoundMs: 1_000
		})
		await install("acme.hostile", "1.0.0", HOSTILE)

		await setEnabled("acme.hostile", true)
		expect(seen.map((s) => [s.moment, s.ok])).toEqual([["enable", false]])
		expect((await rowOf("acme.hostile"))?.enabled).toBe(true)
		expect((await watch()).isRegistered("acme.hostile")).toBe(true)

		await setEnabled("acme.hostile", false)
		expect(moments("acme.hostile")).toEqual(["enable", "disable"])
		expect((await rowOf("acme.hostile"))?.enabled).toBe(false)

		await setEnabled("acme.hostile", true)
		let t = Date.now()
		await uninstall("acme.hostile")
		expect(Date.now() - t).toBeLessThan(5_000)
		expect(seen.at(-1)).toMatchObject({ moment: "uninstall", ok: false })
		expect(await rowOf("acme.hostile")).toBeUndefined()

		await install("acme.hostile", "1.0.0", HOSTILE)
		await setEnabled("acme.hostile", true)
		const { shutdownPluginsGracefully } = await import("./index")
		t = Date.now()
		await shutdownPluginsGracefully()
		expect(Date.now() - t).toBeLessThan(5_000)
		expect(seen.at(-1)).toMatchObject({ moment: "shutdown", ok: false })
	}, 60_000)

	test("the outer bound gives up on a call that never answers", async () => {
		const { fireLifecycle } = await import("./lifecycle")
		const stuck = {
			isRegistered: () => true,
			callHook: () => new Promise(() => {})
		} as unknown as SandboxManager
		const t = Date.now()
		const r = await fireLifecycle(stuck, "acme.stuck", "disable", {}, {
			timeoutMs: 50,
			boundMs: 150
		})
		expect(r.outcome).toBe("bounded")
		expect(Date.now() - t).toBeLessThan(1_000)
	})

	test("a manager that throws is an outcome, not an exception", async () => {
		const { fireLifecycle } = await import("./lifecycle")
		const broken = {
			isRegistered: () => true,
			callHook: () => {
				throw new Error("no sandbox")
			}
		} as unknown as SandboxManager
		const r = await fireLifecycle(broken, "acme.broken", "shutdown")
		expect(r).toMatchObject({ outcome: "error" })
		expect(r.reason).toMatch(/no sandbox/)
	})
})
