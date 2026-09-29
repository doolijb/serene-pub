import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { eq } from "drizzle-orm"
import { pluginHookInvocations, plugins } from "$lib/server/db/schema"
import {
	manifestDisplayTextFindings,
	upsertPlugin,
	setEnabled,
	setBackendPref,
	setAdminDenied,
	setStorageQuotaOverride,
	loadEnabledPlugins,
	writeInvocation,
	removePlugin
} from "./store"
import { SandboxManager, type InvocationRecord } from "./SandboxManager"
import { declaredPermissions, reviewMarks } from "./permissions"

/** The decision list of a plugin whose permissions an admin has approved. */
const approved = (manifest: unknown): string[] =>
	reviewMarks(declaredPermissions(manifest as any))

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
			pluginId: "acme.hello",
			name: "Hello",
			bundleSource: BUNDLE,
			bundleHash: "hash-1",
			backends: ["quickjs", "ses"]
		})
		// disabled by default → not projected
		expect(await loadEnabledPlugins(db)).toHaveLength(0)

		await setEnabled(db, "acme.hello", true)
		const enabled = await loadEnabledPlugins(db)
		expect(enabled).toHaveLength(1)
		expect(enabled[0]).toMatchObject({
			id: "acme.hello",
			name: "Hello",
			backends: ["quickjs", "ses"],
			backend: "quickjs",
			sequential: false
		})
	})

	it("a manifest whose name has no en, or is blank, is refused at install with the sentence; a string or a map with en installs (R-20, U5i)", async () => {
		const install = (manifest: Record<string, unknown>) =>
			upsertPlugin(db, {
				pluginId: "acme.i18n",
				name: "I18n",
				bundleSource: BUNDLE,
				bundleHash: "hash-i18n",
				backends: ["quickjs"],
				manifest
			})
		await expect(install({ name: { fr: "x" } })).rejects.toThrow(
			/plugin 'acme\.i18n' cannot be installed: manifest\.name: a locale map with a required 'en' \(R-20\) — got an object without 'en'; write 'Title'/
		)
		await expect(install({ name: "Dice", description: "   " })).rejects.toThrow(
			/manifest\.description is empty — give it text a person reads/
		)
		expect(manifestDisplayTextFindings({ name: "Dice" })).toEqual([])
		expect(manifestDisplayTextFindings({ name: { en: "Dice", fr: "Dés" } })).toEqual([])
		expect(manifestDisplayTextFindings(null)).toEqual([])
		await install({ name: { en: "Dice", fr: "Dés" } })
		const rows = await db.select().from(plugins).where(eq(plugins.pluginId, "acme.i18n"))
		expect(rows).toHaveLength(1)
		await removePlugin(db, "acme.i18n")
	})

	it("upsert replaces bundle + hash on reinstall", async () => {
		await upsertPlugin(db, {
			pluginId: "acme.hello",
			name: "Hello v2",
			bundleSource: BUNDLE,
			bundleHash: "hash-2",
			backends: ["quickjs"]
		})
		const rows = await loadEnabledPlugins(db)
		const row = rows.find((r) => r.id === "acme.hello")
		// re-install disables until re-enabled (a fresh review of new bytes)
		expect(row).toBeUndefined()
	})

	it("the backend dial persists (store is dumb — the manager validates)", async () => {
		await setEnabled(db, "acme.hello", true) // hash-2 reinstall had disabled it
		await setBackendPref(db, "acme.hello", "ses")
		const row = (await loadEnabledPlugins(db)).find(
			(r) => r.id === "acme.hello"
		)
		expect(row?.backend).toBe("ses")
	})

	it("an admin storage-quota override supersedes the manifest quota (and clears back)", async () => {
		await upsertPlugin(db, {
			pluginId: "acme.store",
			name: "Store",
			bundleSource: BUNDLE,
			bundleHash: "hash-store",
			backends: ["ses"],
			manifest: { permissions: { storage: { quotaBytes: 4096 } } }
		})
		await setEnabled(db, "acme.store", true)
		// Consent: a declared quota is a request until an admin reviews it
		// (permissions.ts), so nothing below would derive a grant without this.
		await setAdminDenied(
			db,
			"acme.store",
			approved({ permissions: { storage: { quotaBytes: 4096 } } })
		)
		const find = async () =>
			(await loadEnabledPlugins(db)).find((r) => r.id === "acme.store")

		// manifest quota by default
		expect((await find())?.storageQuotaBytes).toBe(4096)
		// an override raises it beyond the 256 MB author ceiling (trusted admin act)
		await setStorageQuotaOverride(db, "acme.store", 512 * 1024 * 1024)
		expect((await find())?.storageQuotaBytes).toBe(512 * 1024 * 1024)
		// clearing reverts to the manifest quota
		await setStorageQuotaOverride(db, "acme.store", null)
		expect((await find())?.storageQuotaBytes).toBe(4096)
	})

	it("denial beats the override — a denied storage permission cannot be revived", async () => {
		await setStorageQuotaOverride(db, "acme.store", 100 * 1024 * 1024)
		await setAdminDenied(db, "acme.store", [
			...approved({ permissions: { storage: { quotaBytes: 4096 } } }),
			"storage"
		])
		const row = (await loadEnabledPlugins(db)).find(
			(r) => r.id === "acme.store"
		)
		expect(row?.storageQuotaBytes).toBeUndefined()
	})

	it("a storage-quota override reloads the live plugin and enforces the new ceiling", async () => {
		// The end-to-end seam: an admin override → store projection → the manager's
		// staleness swap → the storage host enforcing the NEW quota on the very next
		// call. (SandboxManager.test proves the copy is dropped on a quota change via
		// a bundle-behaviour swap; this proves the reloaded copy honours the number.)
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-quota-live-"))
		const mgr = new SandboxManager({ dataDir: dir })
		try {
			const PUT = `module.exports = { hooks: { put: function (input, ctx) {
				try { ctx.storage.write("f", "x".repeat(input.n)); return { stored: true }; }
				catch (e) { return { stored: false, err: String((e && e.message) || e) }; }
			} } }`
			await upsertPlugin(db, {
				pluginId: "acme.quota-live",
				name: "Quota Live",
				bundleSource: PUT,
				bundleHash: "h-live",
				backends: ["ses"],
				manifest: { permissions: { storage: { quotaBytes: 2048 } } }
			})
			await setEnabled(db, "acme.quota-live", true)
			await setAdminDenied(
				db,
				"acme.quota-live",
				approved({ permissions: { storage: { quotaBytes: 2048 } } })
			)

			// Re-project the enabled row and (re-)register — register decides
			// staleness eagerly, so a changed quota drops the warm copy here.
			const reproject = async () => {
				const row = (await loadEnabledPlugins(db)).find(
					(r) => r.id === "acme.quota-live"
				)
				if (!row) throw new Error("plugin was not projected")
				mgr.register(row)
			}
			const put = async (n: number): Promise<boolean | null> => {
				const r = await mgr.callHook(
					"acme.quota-live",
					"put",
					{ n },
					{ kind: "oracle", timeoutMs: 5000 }
				)
				return r.ok ? (r.value as { stored: boolean }).stored : null
			}

			await reproject()
			mgr.markReady()
			// 1.5 KB fits the 2 KB manifest quota; 5 KB does not
			expect(await put(1500)).toBe(true)
			expect(await put(5000)).toBe(false)

			// raise the ceiling to 100 KB → the same 5 KB write now fits, which can
			// only happen if the live copy reloaded with the new grant
			await setStorageQuotaOverride(db, "acme.quota-live", 100 * 1024)
			await reproject()
			expect(await put(5000)).toBe(true)

			// drop it back to 1 KB → the next write is refused again
			await setStorageQuotaOverride(db, "acme.quota-live", 1024)
			await reproject()
			expect(await put(2000)).toBe(false)
		} finally {
			await mgr.dispose()
			fs.rmSync(dir, { recursive: true, force: true })
		}
	}, 30_000)

	/**
	 * The consent gate, end to end: install → enable → run.
	 *
	 * An unreviewed plugin is **inert, not broken**. It loads, its hooks fire and
	 * it computes; what it does not get is anything it had to ask for. That is the
	 * whole point of the shape — a plugin nobody has reviewed should not silently
	 * do what it asked to do, and should not look like a crash either.
	 */
	it("an unreviewed plugin runs but reaches nothing it asked for", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-consent-"))
		const mgr = new SandboxManager({ dataDir: dir })
		try {
			// Reports what each grant-bearing permission answered — never throws,
			// so a refusal is a *value* and the hook itself plainly still ran.
			const PROBE = `module.exports = { hooks: { probe: async function (input, ctx) {
				var out = { ran: true, computed: 1 + 1, storage: null, network: null };
				try { ctx.storage.write("f", "x"); out.storage = "granted"; }
				catch (e) { out.storage = String((e && e.message) || e); }
				try { await ctx.fetch("http://api.example.com/"); out.network = "granted"; }
				catch (e) { out.network = String((e && e.message) || e); }
				return out;
			} } }`
			await upsertPlugin(db, {
				pluginId: "acme.consent",
				name: "Consent",
				bundleSource: PROBE,
				bundleHash: "h-consent",
				backends: ["quickjs"],
				manifest: {
					permissions: {
						storage: { quotaBytes: 4096 },
						network: { hosts: ["api.example.com"] }
					}
				}
			})
			await setEnabled(db, "acme.consent", true)

			const reproject = async () => {
				const row = (await loadEnabledPlugins(db)).find(
					(r) => r.id === "acme.consent"
				)
				if (!row) throw new Error("plugin was not projected")
				mgr.register(row)
				return row
			}
			const probe = async () => {
				const r = await mgr.callHook(
					"acme.consent",
					"probe",
					{},
					{
						kind: "oracle", timeoutMs: 5000
					}
				)
				if (!r.ok) throw new Error(`hook failed: ${r.reason}`)
				return r.value as Record<string, unknown>
			}

			// Nobody has reviewed it. Both grants are absent from the descriptor…
			const unreviewed = await reproject()
			expect(unreviewed.storageQuotaBytes).toBeUndefined()
			expect(unreviewed.networkHosts).toBeUndefined()
			mgr.markReady()
			// …and the hook still runs; it is simply refused, by name.
			const before = await probe()
			expect(before.ran).toBe(true)
			expect(before.computed).toBe(2)
			expect(before.storage).toMatch(/permission not granted/)
			expect(before.network).toMatch(/permission not granted/)

			// An admin reviews and approves. Now the same plugin has both.
			await setAdminDenied(
				db,
				"acme.consent",
				approved({
					permissions: {
						storage: { quotaBytes: 4096 },
						network: { hosts: ["api.example.com"] }
					}
				})
			)
			const reviewed = await reproject()
			expect(reviewed.storageQuotaBytes).toBe(4096)
			expect(reviewed.networkHosts).toEqual(["api.example.com"])
			const after = await probe()
			expect(after.storage).toBe("granted")
			// The network grant is real: the refusal is no longer the permission
			// one, it is whatever the (unreachable) host answers with.
			expect(after.network).not.toMatch(/permission not granted/)
			expect(fs.existsSync(path.join(dir, "extensions_data"))).toBe(true)
		} finally {
			await mgr.dispose()
			fs.rmSync(dir, { recursive: true, force: true })
		}
	}, 30_000)

	it("manager invocations are written to the log table", async () => {
		const writes: Promise<void>[] = []
		const mgr = new SandboxManager({
			onInvocation: (rec: InvocationRecord) => {
				writes.push(writeInvocation(db, rec))
			}
		})
		try {
			mgr.register({
				id: "acme.logme",
				name: "Log Me",
				bundleSource: BUNDLE,
				bundleHash: "h-log",
				backends: ["quickjs"],
				backend: "quickjs",
				sequential: false
			})
			mgr.markReady()
			await mgr.callHook(
				"acme.logme",
				"v",
				{ n: 5 },
				{
					kind: "oracle", timeoutMs: 500,
					user: "user-1",
					runId: "run-xyz"
				}
			)
			await Promise.all(writes)

			const logged = await db.select().from(pluginHookInvocations)
			const row = logged.find((r: any) => r.pluginId === "acme.logme")
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
		await removePlugin(db, "acme.logme")
		// the plugin row is gone…
		const remaining = await loadEnabledPlugins(db)
		expect(remaining.find((r) => r.id === "acme.logme")).toBeUndefined()
		// …but its history is intact — no FK cascaded it away
		const logged = await db.select().from(pluginHookInvocations)
		expect(logged.some((r: any) => r.pluginId === "acme.logme")).toBe(true)
	})
})

afterAll(() => {
	// in-memory PGlite; nothing to release
})
