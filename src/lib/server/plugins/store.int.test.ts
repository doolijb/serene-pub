import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { pluginHookInvocations } from "$lib/server/db/schema"
import {
	upsertPlugin,
	setEnabled,
	setBackendPref,
	loadEnabledPlugins,
	writeInvocation,
	removePlugin
} from "./store"
import { RuntimeManager, type InvocationRecord } from "./RuntimeManager"

/**
 * The persistence seam against a real (in-memory) PGlite database with the
 * actual migrations applied — this also proves 0143_plugins.sql is valid SQL.
 * Building the DB is real WASM startup, so the timeout is generous.
 */
vi.setConfig({ testTimeout: 60_000 })

let db: TestDb
beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

const BUNDLE = "module.exports = { hooks: { v: (i) => ({ echo: i.n }) } }"

describe("plugin store", () => {
	it("upserts, enables, and projects an installed plugin to a descriptor", async () => {
		await upsertPlugin(db, {
			pluginId: "acme/hello",
			name: "Hello",
			bundleSource: BUNDLE,
			bundleHash: "hash-1",
			backends: ["quickjs", "ses"]
		})
		// disabled by default → not projected
		expect(await loadEnabledPlugins(db)).toHaveLength(0)

		await setEnabled(db, "acme/hello", true)
		const enabled = await loadEnabledPlugins(db)
		expect(enabled).toHaveLength(1)
		expect(enabled[0]).toMatchObject({
			id: "acme/hello",
			name: "Hello",
			backends: ["quickjs", "ses"],
			backend: "quickjs",
			sequential: false
		})
	})

	it("upsert replaces bundle + hash on reinstall", async () => {
		await upsertPlugin(db, {
			pluginId: "acme/hello",
			name: "Hello v2",
			bundleSource: BUNDLE,
			bundleHash: "hash-2",
			backends: ["quickjs"]
		})
		const rows = await loadEnabledPlugins(db)
		const row = rows.find((r) => r.id === "acme/hello")
		// re-install disables until re-enabled (a fresh review of new bytes)
		expect(row).toBeUndefined()
	})

	it("the backend dial persists (store is dumb — the manager validates)", async () => {
		await setEnabled(db, "acme/hello", true) // hash-2 reinstall had disabled it
		await setBackendPref(db, "acme/hello", "ses")
		const row = (await loadEnabledPlugins(db)).find((r) => r.id === "acme/hello")
		expect(row?.backend).toBe("ses")
	})

	it("manager invocations are written to the log table", async () => {
		const writes: Promise<void>[] = []
		const mgr = new RuntimeManager({
			onInvocation: (rec: InvocationRecord) => {
				writes.push(writeInvocation(db, rec))
			}
		})
		try {
			mgr.register({
				id: "acme/logme",
				name: "Log Me",
				bundleSource: BUNDLE,
				bundleHash: "h-log",
				backends: ["quickjs"],
				backend: "quickjs",
				sequential: false
			})
			mgr.markReady()
			await mgr.callHook("acme/logme", "v", { n: 5 }, {
				timeoutMs: 500,
				user: "user-1",
				runId: "run-xyz"
			})
			await Promise.all(writes)

			const logged = await db.select().from(pluginHookInvocations)
			const row = logged.find((r: any) => r.pluginId === "acme/logme")
			if (!row) throw new Error("invocation was not logged")
			expect(row).toMatchObject({
				pluginName: "Log Me",
				bundleHash: "h-log",
				hookName: "v",
				backend: "quickjs",
				mode: "concurrent",
				triggeredBy: "user-1",
				runId: "run-xyz",
				ok: true,
				outcome: "ok"
			})
			expect(row.durationMs).toBeGreaterThanOrEqual(0)
		} finally {
			await mgr.dispose()
		}
	})

	it("a logged invocation survives its plugin's uninstall (denormalized identity)", async () => {
		await removePlugin(db, "acme/logme")
		// the plugin row is gone…
		const remaining = await loadEnabledPlugins(db)
		expect(remaining.find((r) => r.id === "acme/logme")).toBeUndefined()
		// …but its history is intact — no FK cascaded it away
		const logged = await db.select().from(pluginHookInvocations)
		expect(logged.some((r: any) => r.pluginId === "acme/logme")).toBe(true)
	})
})

afterAll(() => {
	// in-memory PGlite; nothing to release
})
