import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { eq } from "drizzle-orm"

/**
 * The admin socket API against a real (in-memory) DB. Exercised with the
 * sandbox flag OFF (the default), so this proves the management/persistence
 * path — install, enable, the dial, uninstall, logs, and admin gating — which
 * is exactly what an admin uses to prepare plugins before the sandbox is on.
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
	return {
		emit: (event: string, data: any) => events.push({ event, data }),
		events
	}
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
				pluginId: "acme.x",
				name: "Acme X",
				bundleSource: BUNDLE,
				backends: ["quickjs", "ses"]
			},
			c.emit
		)
		let list = await h.pluginsList.handler(adminSocket, {}, c.emit)
		expect(list.sandboxEnabled).toBe(false) // flag off in this test
		const row = list.plugins.find((p) => p.pluginId === "acme.x")
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
			{ pluginId: "acme.x", enabled: true },
			c.emit
		)
		list = await h.pluginsList.handler(adminSocket, {}, c.emit)
		expect(list.plugins.find((p) => p.pluginId === "acme.x")?.enabled).toBe(
			true
		)

		// the dial
		await h.pluginsSetBackend.handler(
			adminSocket,
			{ pluginId: "acme.x", backend: "ses" },
			c.emit
		)
		list = await h.pluginsList.handler(adminSocket, {}, c.emit)
		expect(list.plugins.find((p) => p.pluginId === "acme.x")?.backend).toBe(
			"ses"
		)

		// sequential
		await h.pluginsSetSequential.handler(
			adminSocket,
			{ pluginId: "acme.x", sequential: true },
			c.emit
		)
		list = await h.pluginsList.handler(adminSocket, {}, c.emit)
		expect(
			list.plugins.find((p) => p.pluginId === "acme.x")?.sequential
		).toBe(true)

		// logs (none yet)
		const logs = await h.pluginsLogs.handler(adminSocket, {}, c.emit)
		expect(logs.logs).toEqual([])

		// active monitor (empty, flag off)
		const active = await h.pluginsActive.handler(adminSocket, {}, c.emit)
		expect(active.active).toEqual([])

		// uninstall
		await h.pluginsUninstall.handler(
			adminSocket,
			{ pluginId: "acme.x" },
			c.emit
		)
		list = await h.pluginsList.handler(adminSocket, {}, c.emit)
		expect(
			list.plugins.find((p) => p.pluginId === "acme.x")
		).toBeUndefined()
	})

	test("reinstalling changed bytes disables until re-enabled (SHA-pin)", async () => {
		const h = await import("./plugins")
		const c = collector()
		await h.pluginsInstall.handler(
			adminSocket,
			{
				pluginId: "acme.y",
				name: "Y",
				bundleSource: BUNDLE,
				backends: ["quickjs"]
			},
			c.emit
		)
		await h.pluginsSetEnabled.handler(
			adminSocket,
			{ pluginId: "acme.y", enabled: true },
			c.emit
		)
		// re-install with different bytes
		await h.pluginsInstall.handler(
			adminSocket,
			{
				pluginId: "acme.y",
				name: "Y",
				bundleSource: BUNDLE + "\n// changed",
				backends: ["quickjs"]
			},
			c.emit
		)
		const list = await h.pluginsList.handler(adminSocket, {}, c.emit)
		expect(list.plugins.find((p) => p.pluginId === "acme.y")?.enabled).toBe(
			false
		)
	})

	test("admin views permissions and denial drops the grant", async () => {
		const h = await import("./plugins")
		const c = collector()
		await h.pluginsInstall.handler(
			adminSocket,
			{
				pluginId: "acme.perm",
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
		// Fresh install: everything it asked for is *pending*, and therefore
		// refused. The declaration is visible (an admin has to be able to see
		// what was asked) but nothing is in force.
		const asked = await h.pluginsPermissions.handler(
			adminSocket,
			{ pluginId: "acme.perm" },
			c.emit
		)
		expect(asked.permissions.map((p) => p.key).sort()).toEqual([
			"network:x.com",
			"storage"
		])
		expect(asked.permissions.every((p) => p.pending && !p.granted)).toBe(
			true
		)
		expect(asked.storage?.granted).toBe(false)
		expect(asked.storage?.declaredBytes).toBe(2048)
		expect(asked.storage?.effectiveBytes).toBe(null)
		const listed = await h.pluginsList.handler(adminSocket, {}, c.emit)
		expect(
			listed.plugins.find((p) => p.pluginId === "acme.perm")?.needsReview
		).toBe(true)

		// The consent act puts what is still ticked into force.
		const perms = await h.pluginsReviewPermissions.handler(
			adminSocket,
			{ pluginId: "acme.perm" },
			c.emit
		)
		expect(perms.permissions.every((p) => !p.pending)).toBe(true)
		expect(
			perms.permissions.find((p) => p.key === "storage")?.granted
		).toBe(true)
		// storage facts ride along for the override control
		expect(perms.storage?.granted).toBe(true)
		expect(perms.storage?.declaredBytes).toBe(2048)
		expect(perms.storage?.effectiveBytes).toBe(2048)
		expect(perms.storage?.overrideBytes).toBe(null)
		const reviewed = await h.pluginsList.handler(adminSocket, {}, c.emit)
		expect(
			reviewed.plugins.find((p) => p.pluginId === "acme.perm")
				?.needsReview
		).toBe(false)

		// deny storage → not granted anymore
		const after = await h.pluginsSetPermission.handler(
			adminSocket,
			{ pluginId: "acme.perm", key: "storage", granted: false },
			c.emit
		)
		expect(
			after.permissions.find((p) => p.key === "storage")?.granted
		).toBe(false)
		expect(
			after.permissions.find((p) => p.key === "network:x.com")?.granted
		).toBe(true)
		// storage denied → facts reflect it (no enforced quota)
		expect(after.storage?.granted).toBe(false)
		expect(after.storage?.effectiveBytes).toBe(null)

		// re-grant
		const regranted = await h.pluginsSetPermission.handler(
			adminSocket,
			{ pluginId: "acme.perm", key: "storage", granted: true },
			c.emit
		)
		expect(
			regranted.permissions.find((p) => p.key === "storage")?.granted
		).toBe(true)
	})

	/**
	 * The review record shares the `adminDenied` list with the denials, so the
	 * write path has to be the thing that keeps them apart: a denial must never
	 * be spendable as a forged review. Both guards are asserted here because a
	 * manifest can name any key at all in the compiled array form.
	 */
	test("a permission write cannot forge a review, or invent a key", async () => {
		const h = await import("./plugins")
		const c = collector()
		await h.pluginsInstall.handler(
			adminSocket,
			{
				pluginId: "acme.forge",
				name: "Forge",
				bundleSource: BUNDLE,
				backends: ["quickjs"],
				// Declares storage, plus a "capability" shaped like storage's marker.
				manifest: { permissions: ["storage", "__reviewed:storage"] }
			},
			c.emit
		)
		// Denying the marker-shaped key would write "__reviewed:storage" into the
		// list — a review of the real storage permission. It is refused.
		const forged = await h.pluginsSetPermission.handler(
			adminSocket,
			{
				pluginId: "acme.forge",
				key: "__reviewed:storage",
				granted: false
			},
			c.emit
		)
		expect(
			forged.permissions.find((p) => p.key === "storage")?.pending
		).toBe(true)
		expect(
			forged.permissions.find((p) => p.key === "storage")?.granted
		).toBe(false)
		expect(forged.storage?.granted).toBe(false)

		// A key the manifest never declared is not writable either.
		const invented = await h.pluginsSetPermission.handler(
			adminSocket,
			{
				pluginId: "acme.forge",
				key: "network:evil.example",
				granted: true
			},
			c.emit
		)
		expect(invented.permissions.map((p) => p.key)).not.toContain(
			"network:evil.example"
		)

		// And the ordinary path still works: deciding a declared key reviews it.
		const decided = await h.pluginsSetPermission.handler(
			adminSocket,
			{ pluginId: "acme.forge", key: "storage", granted: true },
			c.emit
		)
		expect(
			decided.permissions.find((p) => p.key === "storage")
		).toMatchObject({
			granted: true,
			pending: false
		})
	})

	/**
	 * `#` separates a key from what it was reviewed as, and this write adds the
	 * key's mark whether the admin grants or denies. A declared
	 * `widget:lore#scope` would mark as the real `lore` scope's review, so
	 * DENYING the decoy granted the scope; `storage#{…}` did the same for the
	 * storage quota. Such a key is refused: not listed, not writable.
	 */
	test("deciding a '#'-key decoy cannot review the permission it imitates", async () => {
		const h = await import("./plugins")
		const { grantedWidgetScopes } = await import("$lib/server/plugins/permissions")
		const { eq } = await import("drizzle-orm")
		const c = collector()
		await h.pluginsInstall.handler(
			adminSocket,
			{ pluginId: "acme.decoy", name: "Decoy", bundleSource: BUNDLE, backends: ["quickjs"] },
			c.emit
		)
		// The manifest as a package could ship it — set on the row directly, so
		// only the permission write is under test.
		const manifest = {
			permissions: ["widget:lore", "widget:lore#scope", "storage", 'storage#{"quotaBytes":5242880}'],
			genres: [{ shape: { panels: [{ id: "a", scopes: ["lore"] }] } }]
		}
		await testDb.update(schema.plugins).set({ manifest }).where(eq(schema.plugins.pluginId, "acme.decoy"))
		const row = async () =>
			(await testDb.select().from(schema.plugins).where(eq(schema.plugins.pluginId, "acme.decoy")))[0]

		for (const granted of [false, true])
			for (const key of ["widget:lore#scope", 'storage#{"quotaBytes":5242880}']) {
				const res = await h.pluginsSetPermission.handler(
					adminSocket,
					{ pluginId: "acme.decoy", key, granted },
					c.emit
				)
				expect(res.permissions.find((p) => p.key === "widget:lore")).toMatchObject({
					pending: true,
					granted: false
				})
				expect(res.permissions.find((p) => p.key === "storage")).toMatchObject({
					pending: true,
					granted: false
				})
				expect(res.storage?.granted).toBe(false)
			}
		const r = await row()
		expect(grantedWidgetScopes(r.manifest as never, r.adminDenied)).toEqual([])
		expect(r.adminDenied ?? []).toEqual([])
		// Not listed, so there is nothing to tick.
		const asked = await h.pluginsPermissions.handler(adminSocket, { pluginId: "acme.decoy" }, c.emit)
		expect(asked.permissions.map((p) => p.key).sort()).toEqual(["storage", "widget:lore"])
	})

	test("admin sets and clears a per-plugin storage-quota override", async () => {
		const h = await import("./plugins")
		const c = collector()
		await h.pluginsInstall.handler(
			adminSocket,
			{
				pluginId: "acme.quota",
				name: "Quota",
				bundleSource: BUNDLE,
				backends: ["quickjs"],
				manifest: { permissions: { storage: { quotaBytes: 2048 } } }
			},
			c.emit
		)
		// Consent first: an override tunes a grant, it does not create one.
		await h.pluginsReviewPermissions.handler(
			adminSocket,
			{ pluginId: "acme.quota" },
			c.emit
		)
		// set an override above the author ceiling (a trusted admin act)
		const set = await h.pluginsSetStorageQuota.handler(
			adminSocket,
			{ pluginId: "acme.quota", bytes: 512 * 1024 * 1024 },
			c.emit
		)
		expect(set.storage?.overrideBytes).toBe(512 * 1024 * 1024)
		expect(set.storage?.effectiveBytes).toBe(512 * 1024 * 1024)
		expect(set.storage?.declaredBytes).toBe(2048)

		// an out-of-band huge value is clamped to the admin ceiling
		const clamped = await h.pluginsSetStorageQuota.handler(
			adminSocket,
			{ pluginId: "acme.quota", bytes: 999 * 1024 * 1024 * 1024 },
			c.emit
		)
		expect(clamped.storage?.overrideBytes).toBe(2 * 1024 * 1024 * 1024)

		// clearing reverts to the manifest quota
		const cleared = await h.pluginsSetStorageQuota.handler(
			adminSocket,
			{ pluginId: "acme.quota", bytes: null },
			c.emit
		)
		expect(cleared.storage?.overrideBytes).toBe(null)
		expect(cleared.storage?.effectiveBytes).toBe(2048)
	})

	test("non-admins are refused", async () => {
		const h = await import("./plugins")
		const c = collector()
		await expect(
			h.pluginsList.handler(userSocket, {}, c.emit)
		).rejects.toThrow(/admin/i)
		expect(c.events.some((e) => e.event === "error")).toBe(true)
	})

	test("the cooperative stop is guarded exactly like the forced one", async () => {
		const h = await import("./plugins")
		// Asking somebody else's extension to stop mid-call is a sandbox
		// intervention however politely it is done, so it is admin-only on the
		// same footing as the kill beside it.
		await expect(
			h.pluginsAbort.handler(userSocket, { callId: 1 }, collector().emit)
		).rejects.toThrow(/admin/i)

		const c = collector()
		const res = await h.pluginsAbort.handler(
			adminSocket,
			{ callId: 1 },
			c.emit
		)
		// Flag off in this suite: nothing runs, so there is nothing to signal —
		// and the monitor is refreshed either way, as the kill does.
		expect(res).toEqual({ aborted: false, active: [] })
		expect(c.events.some((e) => e.event === "plugins:active")).toBe(true)
	})

	test("the log table records real invocations (via the manager onInvocation)", async () => {
		// prove logs surface: write one directly through the store, then read it
		const { writeInvocation } = await import("$lib/server/plugins/store")
		await writeInvocation(testDb as any, {
			callId: 1,
			pluginId: "acme.logged",
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
			{ pluginId: "acme.logged" },
			c.emit
		)
		expect(res.logs).toHaveLength(1)
		expect(res.logs[0]).toMatchObject({
			pluginId: "acme.logged",
			hookName: "v",
			outcome: "ok"
		})
	})
})

/**
 * Per-user settings (`scope: 'user'`): the permission rule, end to end
 * against a real DB. An instance field is an administrator's; a user-scoped
 * field is each person's own, and the socket never names another person.
 */
describe("user-scoped plugin settings", () => {
	const SETTINGS = {
		endpoint: { type: "string", default: "https://a.test" },
		notation: { type: "string", default: "1d20", scope: "user" }
	}

	async function fixture() {
		const [a] = await testDb
			.insert(schema.users)
			.values({ username: `pus-a-${Math.random()}`, isAdmin: false })
			.returning()
		const [b] = await testDb
			.insert(schema.users)
			.values({ username: `pus-b-${Math.random()}`, isAdmin: false })
			.returning()
		const [admin] = await testDb
			.insert(schema.users)
			.values({ username: `pus-admin-${Math.random()}`, isAdmin: true })
			.returning()
		const pluginId = `acme.dice${Math.floor(Math.random() * 1e9)}`
		await testDb.insert(schema.plugins).values({
			pluginId,
			name: "Dice",
			bundleSource: BUNDLE,
			bundleHash: "h-dice",
			enabled: true,
			manifest: { settings: SETTINGS },
			settings: { notation: "2d6" }
		})
		return {
			pluginId,
			a: { user: { id: a.id, isAdmin: false } } as any,
			b: { user: { id: b.id, isAdmin: false } } as any,
			admin: { user: { id: admin.id, isAdmin: true } } as any
		}
	}

	test("a non-admin is refused on instance fields and allowed on their own user fields", async () => {
		const h = await import("./plugins")
		const f = await fixture()
		const c = collector()

		// The instance surface is admin-only, whatever the field.
		await expect(
			h.pluginsSetSettings.handler(
				f.a,
				{ pluginId: f.pluginId, values: { notation: "9d9" } },
				c.emit
			)
		).rejects.toThrow(/admin/i)

		// Through their own surface, an instance field is refused by name…
		const refused = await h.pluginUserSettingsSet.handler(
			f.a,
			{ pluginId: f.pluginId, values: { endpoint: "https://mine.test" } },
			c.emit
		)
		expect(refused.error).toMatch(/'endpoint'.*administrator/)
		const [row] = await testDb
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, f.pluginId))
		expect(row.settings).toEqual({ notation: "2d6" })

		// …and a user-scoped one is theirs.
		const ok = await h.pluginUserSettingsSet.handler(
			f.a,
			{ pluginId: f.pluginId, values: { notation: "3d8" } },
			c.emit
		)
		expect(ok.error).toBeUndefined()
		expect(ok.settings).toMatchObject({
			values: { notation: "3d8" },
			own: ["notation"]
		})
		// The instance value did not move.
		const [after] = await testDb
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, f.pluginId))
		expect(after.settings).toEqual({ notation: "2d6" })

		// An admin still writes the instance value for everyone.
		const adminWrite = await h.pluginsSetSettings.handler(
			f.admin,
			{ pluginId: f.pluginId, values: { notation: "4d4" } },
			c.emit
		)
		expect(adminWrite.error).toBeUndefined()
	})

	test("user A cannot read or write user B's values", async () => {
		const h = await import("./plugins")
		const f = await fixture()
		const c = collector()

		await h.pluginUserSettingsSet.handler(
			f.a,
			{ pluginId: f.pluginId, values: { notation: "3d8" } },
			c.emit
		)
		// B reads the instance value, never A's.
		const bView = await h.pluginUserSettingsList.handler(f.b, {}, c.emit)
		const bDice = bView.plugins.find((p) => p.pluginId === f.pluginId)!
		expect(bDice.settings.values).toEqual({ notation: "2d6" })
		expect(bDice.settings.own).toEqual([])

		// B's write lands on B's row only; A still reads their own.
		await h.pluginUserSettingsSet.handler(
			f.b,
			{ pluginId: f.pluginId, values: { notation: "1d4" } },
			c.emit
		)
		const aView = await h.pluginUserSettingsList.handler(f.a, {}, c.emit)
		expect(
			aView.plugins.find((p) => p.pluginId === f.pluginId)!.settings.values
		).toEqual({ notation: "3d8" })

		// Nothing in the request can name another person: a smuggled userId
		// is ignored and the write lands on the caller's own row.
		await h.pluginUserSettingsSet.handler(
			f.b,
			{ pluginId: f.pluginId, values: { notation: "6d6" }, userId: f.a.user.id } as any,
			c.emit
		)
		const rows = await testDb
			.select()
			.from(schema.pluginUserSettings)
			.where(eq(schema.pluginUserSettings.pluginId, f.pluginId))
		const byUser = Object.fromEntries(rows.map((r) => [r.userId, r.settings]))
		expect(byUser[f.a.user.id]).toEqual({ notation: "3d8" })
		expect(byUser[f.b.user.id]).toEqual({ notation: "6d6" })

		// Clearing falls back to the instance value and removes the row.
		await h.pluginUserSettingsSet.handler(
			f.a,
			{ pluginId: f.pluginId, values: { notation: null } },
			c.emit
		)
		const again = await h.pluginUserSettingsList.handler(f.a, {}, c.emit)
		expect(
			again.plugins.find((p) => p.pluginId === f.pluginId)!.settings
		).toMatchObject({ values: { notation: "2d6" }, own: [] })
	})

	test("a plugin without user-scoped fields is left off a person's list", async () => {
		const h = await import("./plugins")
		const f = await fixture()
		await testDb.insert(schema.plugins).values({
			pluginId: `acme.plain${Math.floor(Math.random() * 1e9)}`,
			name: "Plain",
			bundleSource: BUNDLE,
			bundleHash: "h-plain",
			enabled: true,
			manifest: { settings: { endpoint: { type: "string" } } }
		})
		const res = await h.pluginUserSettingsList.handler(f.a, {}, collector().emit)
		expect(res.plugins.map((p) => p.name)).not.toContain("Plain")
	})
})

describe("consent writes always answer", () => {
	// The admin change form waits for every write its Save sends (owner
	// ruling 2026-10-02): a write for a plugin uninstalled meanwhile must be
	// refused on its own `:error`, never left silent.
	test("a permission write or review for a missing plugin is refused in words", async () => {
		const h = await import("./plugins")
		const c = collector()
		await h.pluginsSetPermission.handler(
			adminSocket,
			{ pluginId: "acme.gone", key: "storage", granted: true },
			c.emit
		)
		await h.pluginsReviewPermissions.handler(adminSocket, { pluginId: "acme.gone" }, c.emit)
		expect(c.events.map((e) => e.event)).toEqual([
			"plugins:setPermission:error",
			"plugins:reviewPermissions:error"
		])
		expect(c.events[0].data.error).toMatch(/acme\.gone/)
	}, 60_000)
})
