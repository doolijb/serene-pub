import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

/**
 * The admin socket API against a real (in-memory) DB. Exercised with the
 * runtime flag OFF (the default), so this proves the management/persistence
 * path — install, enable, the dial, uninstall, logs, and admin gating — which
 * is exactly what an admin uses to prepare plugins before the runtime is on.
 */

let testDb: TestDb
let dataDir: string

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db }
})

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "sp-plugins-sock-int-"))
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

const adminSocket = { user: { id: 1, isAdmin: true } } as any
const userSocket = { user: { id: 2, isAdmin: false } } as any

function collector() {
	const events: { event: string; data: any }[] = []
	return { emit: (event: string, data: any) => events.push({ event, data }), events }
}

const BUNDLE = "module.exports = { hooks: { v: (i) => i.n } }"

describe("plugin admin socket API", () => {
	test("install → list (disabled) → enable → dial → logs → uninstall", async () => {
		const h = await import("./plugins")
		const c = collector()

		// install
		await h.pluginsInstall.handler(
			adminSocket,
			{
				pluginId: "acme/x",
				name: "Acme X",
				bundleSource: BUNDLE,
				backends: ["quickjs", "ses"]
			},
			c.emit
		)
		let list = await h.pluginsList.handler(adminSocket, {}, c.emit)
		expect(list.runtimeEnabled).toBe(false) // flag off in this test
		const row = list.plugins.find((p) => p.pluginId === "acme/x")
		expect(row).toMatchObject({
			name: "Acme X",
			backends: ["quickjs", "ses"],
			backend: "quickjs",
			enabled: false // fresh install is disabled until reviewed
		})
		expect(row!.bundleHash).toHaveLength(64) // sha-256 hex

		// enable
		await h.pluginsSetEnabled.handler(
			adminSocket,
			{ pluginId: "acme/x", enabled: true },
			c.emit
		)
		list = await h.pluginsList.handler(adminSocket, {}, c.emit)
		expect(list.plugins.find((p) => p.pluginId === "acme/x")?.enabled).toBe(true)

		// the dial
		await h.pluginsSetBackend.handler(
			adminSocket,
			{ pluginId: "acme/x", backend: "ses" },
			c.emit
		)
		list = await h.pluginsList.handler(adminSocket, {}, c.emit)
		expect(list.plugins.find((p) => p.pluginId === "acme/x")?.backend).toBe("ses")

		// sequential
		await h.pluginsSetSequential.handler(
			adminSocket,
			{ pluginId: "acme/x", sequential: true },
			c.emit
		)
		list = await h.pluginsList.handler(adminSocket, {}, c.emit)
		expect(list.plugins.find((p) => p.pluginId === "acme/x")?.sequential).toBe(true)

		// logs (none yet)
		const logs = await h.pluginsLogs.handler(adminSocket, {}, c.emit)
		expect(logs.logs).toEqual([])

		// active monitor (empty, flag off)
		const active = await h.pluginsActive.handler(adminSocket, {}, c.emit)
		expect(active.active).toEqual([])

		// uninstall
		await h.pluginsUninstall.handler(
			adminSocket,
			{ pluginId: "acme/x" },
			c.emit
		)
		list = await h.pluginsList.handler(adminSocket, {}, c.emit)
		expect(list.plugins.find((p) => p.pluginId === "acme/x")).toBeUndefined()
	})

	test("reinstalling changed bytes disables until re-enabled (SHA-pin)", async () => {
		const h = await import("./plugins")
		const c = collector()
		await h.pluginsInstall.handler(
			adminSocket,
			{ pluginId: "acme/y", name: "Y", bundleSource: BUNDLE, backends: ["quickjs"] },
			c.emit
		)
		await h.pluginsSetEnabled.handler(adminSocket, { pluginId: "acme/y", enabled: true }, c.emit)
		// re-install with different bytes
		await h.pluginsInstall.handler(
			adminSocket,
			{ pluginId: "acme/y", name: "Y", bundleSource: BUNDLE + "\n// changed", backends: ["quickjs"] },
			c.emit
		)
		const list = await h.pluginsList.handler(adminSocket, {}, c.emit)
		expect(list.plugins.find((p) => p.pluginId === "acme/y")?.enabled).toBe(false)
	})

	test("admin views permissions and denial drops the grant", async () => {
		const h = await import("./plugins")
		const c = collector()
		await h.pluginsInstall.handler(
			adminSocket,
			{
				pluginId: "acme/perm",
				name: "Perm",
				bundleSource: BUNDLE,
				backends: ["quickjs"],
				manifest: {
					permissions: {
						storage: { quotaBytes: 2048 },
						network: { hosts: ["x.com"] }
					}
				}
			},
			c.emit
		)
		const perms = await h.pluginsPermissions.handler(
			adminSocket,
			{ pluginId: "acme/perm" },
			c.emit
		)
		expect(perms.permissions.map((p) => p.key).sort()).toEqual([
			"network:x.com",
			"storage"
		])
		expect(perms.permissions.find((p) => p.key === "storage")?.granted).toBe(true)
		// storage facts ride along for the override control
		expect(perms.storage?.granted).toBe(true)
		expect(perms.storage?.declaredBytes).toBe(2048)
		expect(perms.storage?.effectiveBytes).toBe(2048)
		expect(perms.storage?.overrideBytes).toBe(null)

		// deny storage → not granted anymore
		const after = await h.pluginsSetPermission.handler(
			adminSocket,
			{ pluginId: "acme/perm", key: "storage", granted: false },
			c.emit
		)
		expect(after.permissions.find((p) => p.key === "storage")?.granted).toBe(false)
		expect(after.permissions.find((p) => p.key === "network:x.com")?.granted).toBe(true)
		// storage denied → facts reflect it (no enforced quota)
		expect(after.storage?.granted).toBe(false)
		expect(after.storage?.effectiveBytes).toBe(null)

		// re-grant
		const regranted = await h.pluginsSetPermission.handler(
			adminSocket,
			{ pluginId: "acme/perm", key: "storage", granted: true },
			c.emit
		)
		expect(regranted.permissions.find((p) => p.key === "storage")?.granted).toBe(true)
	})

	test("admin sets and clears a per-plugin storage-quota override", async () => {
		const h = await import("./plugins")
		const c = collector()
		await h.pluginsInstall.handler(
			adminSocket,
			{
				pluginId: "acme/quota",
				name: "Quota",
				bundleSource: BUNDLE,
				backends: ["quickjs"],
				manifest: { permissions: { storage: { quotaBytes: 2048 } } }
			},
			c.emit
		)
		// set an override above the author ceiling (a trusted admin act)
		const set = await h.pluginsSetStorageQuota.handler(
			adminSocket,
			{ pluginId: "acme/quota", bytes: 512 * 1024 * 1024 },
			c.emit
		)
		expect(set.storage?.overrideBytes).toBe(512 * 1024 * 1024)
		expect(set.storage?.effectiveBytes).toBe(512 * 1024 * 1024)
		expect(set.storage?.declaredBytes).toBe(2048)

		// an out-of-band huge value is clamped to the admin ceiling
		const clamped = await h.pluginsSetStorageQuota.handler(
			adminSocket,
			{ pluginId: "acme/quota", bytes: 999 * 1024 * 1024 * 1024 },
			c.emit
		)
		expect(clamped.storage?.overrideBytes).toBe(2 * 1024 * 1024 * 1024)

		// clearing reverts to the manifest quota
		const cleared = await h.pluginsSetStorageQuota.handler(
			adminSocket,
			{ pluginId: "acme/quota", bytes: null },
			c.emit
		)
		expect(cleared.storage?.overrideBytes).toBe(null)
		expect(cleared.storage?.effectiveBytes).toBe(2048)
	})

	test("non-admins are refused", async () => {
		const h = await import("./plugins")
		const c = collector()
		await expect(h.pluginsList.handler(userSocket, {}, c.emit)).rejects.toThrow(
			/admin/i
		)
		expect(c.events.some((e) => e.event === "error")).toBe(true)
	})

	test("the log table records real invocations (via the manager onInvocation)", async () => {
		// prove logs surface: write one directly through the store, then read it
		const { writeInvocation } = await import("$lib/server/plugins/store")
		await writeInvocation(testDb as any, {
			callId: 1,
			pluginId: "acme/logged",
			pluginName: "Logged",
			bundleHash: "h",
			hookName: "v",
			backend: "quickjs",
			mode: "concurrent",
			queuedAt: Date.now(),
			startedAt: Date.now(),
			finishedAt: Date.now(),
			durationMs: 3,
			ok: true,
			outcome: "ok"
		})
		const h = await import("./plugins")
		const c = collector()
		const res = await h.pluginsLogs.handler(
			adminSocket,
			{ pluginId: "acme/logged" },
			c.emit
		)
		expect(res.logs).toHaveLength(1)
		expect(res.logs[0]).toMatchObject({
			pluginId: "acme/logged",
			hookName: "v",
			outcome: "ok"
		})
	})
})
