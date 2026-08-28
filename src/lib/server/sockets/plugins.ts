/**
 * Admin socket API for the plugin subsystem — the "exposed now" surface.
 *
 * Every handler is admin-only. Management (list/install/enable/dial/sequential/
 * uninstall/logs) always works so an admin can prepare plugins; the *runtime*
 * sync (registering with the live manager, the monitor, the kill) is guarded by
 * `pluginsEnabled()`, so with the flag off the DB changes persist but nothing
 * runs — the whole surface stays inert until the gate is set, then boot loads
 * what's enabled.
 *
 * These are linked from the pipeline management page for now (interim home;
 * re-homed under a dedicated admin route later — build self-contained).
 */

import { createHash } from "node:crypto"
import { asc, desc, eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import { getManager, pluginsEnabled } from "$lib/server/plugins"
import type { PluginDescriptor } from "$lib/server/plugins/RuntimeManager"
import type { RuntimeKind } from "$lib/server/plugins/types"
import { checkConformance } from "$lib/server/plugins/conformance"
import {
	upsertPlugin,
	setEnabled,
	setBackendPref,
	setSequentialPref,
	setAdminDenied,
	setStorageQuotaOverride,
	removePlugin
} from "$lib/server/plugins/store"
import {
	permissionStates,
	declaredPermissions,
	effectivePermissions,
	storageGrant,
	networkGrant,
	normalizeAdminStorageQuota,
	MIN_STORAGE_QUOTA,
	MAX_ADMIN_STORAGE_QUOTA,
	type PluginManifest
} from "$lib/server/plugins/permissions"
import {
	applySettingsWrite,
	clientSettingsView,
	hookSettingsFor,
	settingsSchemaOf,
	writePluginSettings
} from "$lib/server/plugins/settingsHost"

type Emit = (event: string, data: any) => void

function requireAdmin(socket: any, emitToUser: Emit): void {
	if (!socket.user?.isAdmin) {
		const msg = "Access denied. Only admin users can manage plugins."
		emitToUser("error", { error: msg })
		throw new Error(msg)
	}
}

interface Row {
	pluginId: string
	name: string
	version: string
	bundleSource: string
	bundleHash: string
	backends: unknown
	backend: string
	sequential: boolean
	enabled: boolean
	manifest?: PluginManifest | null
	adminDenied?: string[] | null
	storageQuotaOverride?: number | null
	settings?: Record<string, unknown> | null
}

function toPluginRow(r: Row): Sockets.Plugins.PluginRow {
	const backends = (Array.isArray(r.backends) ? r.backends : ["quickjs"]).filter(
		(b): b is RuntimeKind => b === "quickjs" || b === "ses"
	)
	return {
		pluginId: r.pluginId,
		name: r.name,
		version: r.version,
		bundleHash: r.bundleHash,
		backends: backends.length ? backends : ["quickjs"],
		backend: r.backend === "ses" ? "ses" : "quickjs",
		sequential: r.sequential,
		enabled: r.enabled,
		hasSettings: Object.keys(settingsSchemaOf(r.manifest)).length > 0
	}
}

function toDescriptor(r: Row): PluginDescriptor {
	const p = toPluginRow(r)
	const eff = effectivePermissions(declaredPermissions(r.manifest), r.adminDenied)
	const settings = hookSettingsFor(r.manifest, r.settings)
	return {
		id: r.pluginId,
		name: r.name,
		bundleSource: r.bundleSource,
		bundleHash: r.bundleHash,
		backends: p.backends,
		backend: p.backend,
		sequential: r.sequential,
		storageQuotaBytes: storageGrant(eff, r.storageQuotaOverride),
		networkHosts: networkGrant(eff),
		...(settings ? { settings } : {})
	}
}

async function allRows(): Promise<Row[]> {
	return db.select().from(schema.plugins).orderBy(asc(schema.plugins.name))
}

async function listPayload(): Promise<Sockets.Plugins.List.Response> {
	const rows = await allRows()
	const runtimeEnabled = pluginsEnabled()
	// Warm/cold is runtime truth, so it is annotated from the live manager
	// rather than stored: with the gate off nothing is ever loaded.
	const mgr = runtimeEnabled ? getManager() : null
	return {
		plugins: rows.map((r) => ({
			...toPluginRow(r),
			warm: mgr ? mgr.isWarm(r.pluginId) : false
		})),
		runtimeEnabled
	}
}

/** After any mutation: refresh the canonical list to the client. */
async function emitList(emitToUser: Emit): Promise<Sockets.Plugins.PluginRow[]> {
	const payload = await listPayload()
	emitToUser("plugins:list", payload)
	return payload.plugins
}

/** Best-effort: keep the live manager in step with the DB (only when on). */
async function syncManager(pluginId: string): Promise<void> {
	if (!pluginsEnabled()) return
	const [row] = await db
		.select()
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, pluginId))
	const mgr = getManager()
	if (!row || !row.enabled) {
		mgr.unregister(pluginId)
		await syncEngines()
		return
	}
	try {
		mgr.register(toDescriptor(row as Row))
	} catch (e) {
		console.warn(`[plugins] manager register '${pluginId}' failed:`, e)
	}
	await syncEngines()
}

/** Reconcile manifest-declared template engines with the enabled set. */
async function syncEngines(): Promise<void> {
	try {
		const { syncPluginEngines } = await import(
			"$lib/server/plugins/engineHost"
		)
		await syncPluginEngines(db, getManager())
	} catch (e) {
		console.warn("[plugins] template-engine sync failed:", e)
	}
}

/** The storage-quota picture for the admin override control (undefined = plugin declares no storage). */
function storageFacts(r: Row): Sockets.Plugins.StorageQuota | undefined {
	const declared = declaredPermissions(r.manifest)
	const storagePerm = declared.find((p) => p.key === "storage")
	if (!storagePerm) return undefined
	const eff = effectivePermissions(declared, r.adminDenied)
	const granted = eff.some((p) => p.key === "storage")
	return {
		granted,
		// The manifest-declared (author-band-clamped) quota, shown even when denied.
		declaredBytes: (storagePerm.config?.quotaBytes as number) ?? null,
		// What the runtime will actually enforce right now (override wins) — only
		// meaningful while storage is granted.
		effectiveBytes: granted
			? (storageGrant(eff, r.storageQuotaOverride) ?? null)
			: null,
		overrideBytes: r.storageQuotaOverride ?? null,
		minBytes: MIN_STORAGE_QUOTA,
		maxBytes: MAX_ADMIN_STORAGE_QUOTA
	}
}

/* ── handlers ────────────────────────────────────────────────────────────── */

export const pluginsList: Handler<
	Sockets.Plugins.List.Params,
	Sockets.Plugins.List.Response
> = {
	event: "plugins:list",
	handler: async (socket, _params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const res = await listPayload()
		emitToUser("plugins:list", res)
		return res
	}
}

export const pluginsInstall: Handler<
	Sockets.Plugins.Install.Params,
	Sockets.Plugins.Install.Response
> = {
	event: "plugins:install",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		// Requirements first (24 §10, T7b): what the package references but
		// does not ship must exist here, or the install refuses with names —
		// a missing dependency found now is a sentence; found at runtime it
		// is a broken session.
		{
			const { missingRequirements, requirementsOf } = await import(
				"$lib/server/plugins/requirements"
			)
			const missing = await missingRequirements(
				db,
				requirementsOf(params.manifest)
			)
			if (missing.length) {
				const msg =
					`This package requires ${missing.join(", ")} — not installed ` +
					`on this instance. Install what it builds on first.`
				emitToUser("error", { error: msg })
				throw new Error(msg)
			}
		}
		// `backends` is a compiled fact: run the bundle on both sandboxes and
		// take the set it actually loads on, ignoring any author claim.
		const conf = await checkConformance(params.bundleSource)
		if (conf.backends.length === 0) {
			const msg =
				"Plugin failed conformance on every backend: " +
				JSON.stringify(conf.issues)
			emitToUser("error", { error: msg })
			throw new Error(msg)
		}
		const bundleHash = createHash("sha256")
			.update(params.bundleSource, "utf8")
			.digest("hex")
		await upsertPlugin(db, {
			pluginId: params.pluginId,
			name: params.name,
			version: params.version,
			bundleSource: params.bundleSource,
			bundleHash,
			backends: conf.backends,
			sequential: params.sequential,
			manifest: params.manifest
		})
		// The frame surfaces' documents (20 §12), replaced wholesale like the
		// bundle. Refused paths are logged, not fatal — a plugin with one bad
		// path still installs, minus that file.
		if (Array.isArray(params.files)) {
			const { storePluginFiles } = await import(
				"$lib/server/plugins/frameHost"
			)
			const r = await storePluginFiles(db, params.pluginId, params.files)
			if (r.refused.length)
				console.warn(
					`[plugins] '${params.pluginId}' UI files refused (unsafe path): ${r.refused.join(", ")}`
				)
		}
		// A fresh/changed bundle is disabled until re-enabled — no manager sync.
		return { plugins: await emitList(emitToUser) }
	}
}

export const pluginsSetEnabled: Handler<
	Sockets.Plugins.SetEnabled.Params,
	Sockets.Plugins.SetEnabled.Response
> = {
	event: "plugins:setEnabled",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		await setEnabled(db, params.pluginId, params.enabled)
		await syncManager(params.pluginId)
		return { plugins: await emitList(emitToUser) }
	}
}

export const pluginsSetBackend: Handler<
	Sockets.Plugins.SetBackend.Params,
	Sockets.Plugins.SetBackend.Response
> = {
	event: "plugins:setBackend",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		await setBackendPref(db, params.pluginId, params.backend)
		if (pluginsEnabled()) {
			try {
				getManager().setBackend(params.pluginId, params.backend)
			} catch (e) {
				// not registered / unsupported backend — the DB pref still stands
				console.warn(`[plugins] setBackend '${params.pluginId}':`, e)
			}
		}
		return { plugins: await emitList(emitToUser) }
	}
}

export const pluginsSetSequential: Handler<
	Sockets.Plugins.SetSequential.Params,
	Sockets.Plugins.SetSequential.Response
> = {
	event: "plugins:setSequential",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		await setSequentialPref(db, params.pluginId, params.sequential)
		if (pluginsEnabled()) {
			try {
				getManager().setSequential(params.pluginId, params.sequential)
			} catch (e) {
				console.warn(`[plugins] setSequential '${params.pluginId}':`, e)
			}
		}
		return { plugins: await emitList(emitToUser) }
	}
}

export const pluginsUninstall: Handler<
	Sockets.Plugins.Uninstall.Params,
	Sockets.Plugins.Uninstall.Response
> = {
	event: "plugins:uninstall",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		if (pluginsEnabled()) getManager().unregister(params.pluginId)
		await removePlugin(db, params.pluginId)
		await db
			.delete(schema.pluginFiles)
			.where(eq(schema.pluginFiles.pluginId, params.pluginId))
		if (pluginsEnabled()) await syncEngines()
		return { plugins: await emitList(emitToUser) }
	}
}

/**
 * The admin's memory lever: drop a plugin's loaded copy (and a SES plugin's
 * dedicated worker) while keeping it installed and enabled — the next hook
 * call faults it back in cold. Deferred by the manager while calls are in
 * flight, so nothing running loses the copy it started on.
 */
export const pluginsUnload: Handler<
	Sockets.Plugins.Unload.Params,
	Sockets.Plugins.Unload.Response
> = {
	event: "plugins:unload",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		if (pluginsEnabled()) getManager().unload(params.pluginId)
		return { plugins: await emitList(emitToUser) }
	}
}

export const pluginsActive: Handler<
	Sockets.Plugins.Active.Params,
	Sockets.Plugins.Active.Response
> = {
	event: "plugins:active",
	handler: async (socket, _params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const active = pluginsEnabled() ? getManager().activeInvocations() : []
		const res = { active }
		emitToUser("plugins:active", res)
		return res
	}
}

export const pluginsKill: Handler<
	Sockets.Plugins.Kill.Params,
	Sockets.Plugins.Kill.Response
> = {
	event: "plugins:kill",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const mgr = pluginsEnabled() ? getManager() : null
		const killed = mgr ? await mgr.killCall(params.callId) : false
		const res = { killed, active: mgr ? mgr.activeInvocations() : [] }
		emitToUser("plugins:active", { active: res.active })
		return res
	}
}

export const pluginsLogs: Handler<
	Sockets.Plugins.Logs.Params,
	Sockets.Plugins.Logs.Response
> = {
	event: "plugins:logs",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const limit = Math.min(Math.max(params.limit ?? 100, 1), 500)
		const base = db
			.select()
			.from(schema.pluginHookInvocations)
			.orderBy(desc(schema.pluginHookInvocations.finishedAt))
			.limit(limit)
		const rows = params.pluginId
			? await db
					.select()
					.from(schema.pluginHookInvocations)
					.where(eq(schema.pluginHookInvocations.pluginId, params.pluginId))
					.orderBy(desc(schema.pluginHookInvocations.finishedAt))
					.limit(limit)
			: await base
		const logs: Sockets.Plugins.LogRow[] = rows.map((r: any) => ({
			id: r.id,
			pluginId: r.pluginId,
			pluginName: r.pluginName,
			hookName: r.hookName,
			backend: r.backend,
			mode: r.mode,
			triggeredBy: r.triggeredBy,
			runId: r.runId,
			durationMs: r.durationMs,
			ok: r.ok,
			outcome: r.outcome,
			reason: r.reason,
			finishedAt: r.finishedAt
		}))
		const res = { logs }
		emitToUser("plugins:logs", res)
		return res
	}
}

export const pluginsPermissions: Handler<
	Sockets.Plugins.Permissions.Params,
	Sockets.Plugins.Permissions.Response
> = {
	event: "plugins:permissions",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const [row] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, params.pluginId))
		const permissions = row
			? permissionStates(row.manifest as PluginManifest, row.adminDenied)
			: []
		const storage = row ? storageFacts(row as Row) : undefined
		const res = { pluginId: params.pluginId, permissions, storage }
		emitToUser("plugins:permissions", res)
		return res
	}
}

export const pluginsSetPermission: Handler<
	Sockets.Plugins.SetPermission.Params,
	Sockets.Plugins.SetPermission.Response
> = {
	event: "plugins:setPermission",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const [row] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, params.pluginId))
		if (!row) return { pluginId: params.pluginId, permissions: [] }
		const denied = new Set<string>(row.adminDenied ?? [])
		if (params.granted) denied.delete(params.key)
		else denied.add(params.key)
		await setAdminDenied(db, params.pluginId, [...denied])
		// Re-derive the live grant (a denied 'storage' drops the plugin's quota).
		await syncManager(params.pluginId)
		const [updated] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, params.pluginId))
		const permissions = updated
			? permissionStates(updated.manifest as PluginManifest, updated.adminDenied)
			: []
		const storage = updated ? storageFacts(updated as Row) : undefined
		const res = { pluginId: params.pluginId, permissions, storage }
		emitToUser("plugins:permissions", res)
		return res
	}
}

/**
 * Set or clear (bytes=null) an admin's per-plugin storage-quota override. The
 * value is normalized/clamped to the admin band here (defensively) and again at
 * grant-derivation; an invalid non-null value clears the override rather than
 * bricking the quota. Re-syncs the live grant so the new ceiling takes effect.
 */
export const pluginsSetStorageQuota: Handler<
	Sockets.Plugins.SetStorageQuota.Params,
	Sockets.Plugins.SetStorageQuota.Response
> = {
	event: "plugins:setStorageQuota",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const bytes =
			params.bytes == null
				? null
				: (normalizeAdminStorageQuota(params.bytes) ?? null)
		await setStorageQuotaOverride(db, params.pluginId, bytes)
		await syncManager(params.pluginId)
		const [updated] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, params.pluginId))
		const permissions = updated
			? permissionStates(updated.manifest as PluginManifest, updated.adminDenied)
			: []
		const storage = updated ? storageFacts(updated as Row) : undefined
		const res = { pluginId: params.pluginId, permissions, storage }
		emitToUser("plugins:permissions", res)
		return res
	}
}

/**
 * The settings view for one plugin (12 §6): the manifest's schema, the stored
 * values with every secret masked to set/unset, and the config state. Admin
 * only, like the rest of this surface — per-user (`scope: 'user'`) settings
 * are a later lane; today every write is instance scope.
 */
export const pluginsGetSettings: Handler<
	Sockets.Plugins.GetSettings.Params,
	Sockets.Plugins.GetSettings.Response
> = {
	event: "plugins:getSettings",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const [row] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, params.pluginId))
		const res: Sockets.Plugins.GetSettings.Response = {
			pluginId: params.pluginId,
			settings: row
				? clientSettingsView(row.manifest, row.settings)
				: null
		}
		emitToUser("plugins:getSettings", res)
		return res
	}
}

/**
 * Write settings values. Secrets arrive as plaintext over the socket and are
 * encrypted at this one write path (settingsHost.ts); absent means unchanged
 * and empty means cleared, so the form never has to read one back. A
 * successful write re-syncs the manager, so the next hook call carries the
 * new values.
 */
export const pluginsSetSettings: Handler<
	Sockets.Plugins.SetSettings.Params,
	Sockets.Plugins.SetSettings.Response
> = {
	event: "plugins:setSettings",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const [row] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, params.pluginId))
		if (!row) {
			const res = {
				pluginId: params.pluginId,
				error: "That extension is not installed."
			}
			emitToUser("plugins:setSettings:error", res)
			return res
		}
		const schemaDecl = settingsSchemaOf(row.manifest)
		if (!Object.keys(schemaDecl).length) {
			const res = {
				pluginId: params.pluginId,
				error: "This extension declares no settings."
			}
			emitToUser("plugins:setSettings:error", res)
			return res
		}
		const applied = applySettingsWrite(
			schemaDecl,
			row.settings,
			params.values ?? {}
		)
		if (!applied.ok) {
			const res = { pluginId: params.pluginId, error: applied.error }
			emitToUser("plugins:setSettings:error", res)
			return res
		}
		await writePluginSettings(db, params.pluginId, applied.next)
		await syncManager(params.pluginId)
		const [after] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, params.pluginId))
		const res: Sockets.Plugins.SetSettings.Response = {
			pluginId: params.pluginId,
			settings: after
				? clientSettingsView(after.manifest, after.settings)
				: null
		}
		emitToUser("plugins:getSettings", res)
		return res
	}
}

export function registerPluginHandlers(
	socket: any,
	emitToUser: Emit,
	register: (socket: any, handler: Handler<any, any>, emitToUser: Emit) => void
) {
	register(socket, pluginsList, emitToUser)
	register(socket, pluginsPermissions, emitToUser)
	register(socket, pluginsSetPermission, emitToUser)
	register(socket, pluginsSetStorageQuota, emitToUser)
	register(socket, pluginsInstall, emitToUser)
	register(socket, pluginsSetEnabled, emitToUser)
	register(socket, pluginsSetBackend, emitToUser)
	register(socket, pluginsSetSequential, emitToUser)
	register(socket, pluginsUninstall, emitToUser)
	register(socket, pluginsUnload, emitToUser)
	register(socket, pluginsActive, emitToUser)
	register(socket, pluginsKill, emitToUser)
	register(socket, pluginsLogs, emitToUser)
	register(socket, pluginsGetSettings, emitToUser)
	register(socket, pluginsSetSettings, emitToUser)
}
