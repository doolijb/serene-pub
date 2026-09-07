/**
 * Admin socket API for the plugin subsystem — the "exposed now" surface.
 *
 * Every handler is admin-only. Management (list/install/enable/dial/sequential/
 * uninstall/logs) always works so an admin can prepare plugins; the *sandbox*
 * sync (registering with the live manager, the monitor, the abort, the kill) is
 * guarded by `pluginsEnabled()`, so with the flag off the DB changes persist
 * but nothing runs — the whole surface stays inert until the gate is set, then
 * boot loads what's enabled.
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
import type { PluginDescriptor } from "$lib/server/plugins/SandboxManager"
import type { SandboxKind } from "$lib/server/plugins/types"
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
	isReviewMark,
	needsReview,
	reviewMark,
	reviewMarks,
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
	const backends = (
		Array.isArray(r.backends) ? r.backends : ["quickjs"]
	).filter((b): b is SandboxKind => b === "quickjs" || b === "ses")
	return {
		pluginId: r.pluginId,
		name: r.name,
		version: r.version,
		bundleHash: r.bundleHash,
		backends: backends.length ? backends : ["quickjs"],
		backend: r.backend === "ses" ? "ses" : "quickjs",
		sequential: r.sequential,
		enabled: r.enabled,
		hasSettings: Object.keys(settingsSchemaOf(r.manifest)).length > 0,
		// How an admin is told a plugin is waiting: a declared permission no one
		// has decided about yet. Until they do it is refused, so this badge is
		// also the explanation for a plugin that runs but reaches nothing.
		needsReview: needsReview(r.manifest, r.adminDenied)
	}
}

function toDescriptor(r: Row): PluginDescriptor {
	const p = toPluginRow(r)
	const eff = effectivePermissions(
		declaredPermissions(r.manifest),
		r.adminDenied
	)
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
	const sandboxEnabled = pluginsEnabled()
	// Warm/cold is live truth, so it is annotated from the live manager
	// rather than stored: with the gate off nothing is ever loaded.
	const mgr = sandboxEnabled ? getManager() : null
	return {
		plugins: rows.map((r) => ({
			...toPluginRow(r),
			warm: mgr ? mgr.isWarm(r.pluginId) : false
		})),
		sandboxEnabled
	}
}

/** After any mutation: refresh the canonical list to the client. */
async function emitList(
	emitToUser: Emit
): Promise<Sockets.Plugins.PluginRow[]> {
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
		await syncDeclarations()
		return
	}
	try {
		mgr.register(toDescriptor(row as Row))
	} catch (e) {
		console.warn(`[plugins] manager register '${pluginId}' failed:`, e)
	}
	await syncDeclarations()
}

/**
 * Reconcile the manifest-declared registries with the enabled set: template
 * engines, and event subscriptions.
 *
 * Both are projections of the `plugins` table, so both are stale the moment a
 * plugin is enabled, disabled, uninstalled or has a permission denied — and the
 * event half is the one where staleness has teeth, because an admin denying an
 * `event:` permission has to actually stop the subscription rather than only
 * change what the audit screen says.
 */
async function syncDeclarations(): Promise<void> {
	try {
		const { syncPluginEngines } = await import(
			"$lib/server/plugins/engineHost"
		)
		await syncPluginEngines(db, getManager())
	} catch (e) {
		console.warn("[plugins] template-engine sync failed:", e)
	}
	try {
		const { syncPluginEventHooks } = await import(
			"$lib/server/plugins/eventHost"
		)
		await syncPluginEventHooks(db)
	} catch (e) {
		console.warn("[plugins] event-subscription sync failed:", e)
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
		// What the sandbox will actually enforce right now (override wins) — only
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
		if (pluginsEnabled()) await syncDeclarations()
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

/**
 * Ask one in-flight hook to stop itself — the cooperative half of the kill
 * below, and admin-only for the same reason: stopping somebody else's
 * extension mid-call is a sandbox intervention whichever way it is done.
 *
 * Deliberately the bare ask, with no kill behind it. The escalation from ask to
 * force is `hookGrace.ts`'s job when *core* stops something automatically (a
 * cancelled run); here a person is watching the monitor and decides for
 * themselves whether the call is winding down or stuck.
 */
export const pluginsAbort: Handler<
	Sockets.Plugins.Abort.Params,
	Sockets.Plugins.Abort.Response
> = {
	event: "plugins:abort",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const mgr = pluginsEnabled() ? getManager() : null
		const aborted = mgr ? await mgr.abortCall(params.callId) : false
		const res = { aborted, active: mgr ? mgr.activeInvocations() : [] }
		emitToUser("plugins:active", { active: res.active })
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
					.where(
						eq(
							schema.pluginHookInvocations.pluginId,
							params.pluginId
						)
					)
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

/**
 * Grant or deny one declared permission.
 *
 * Acting on a key is also *reviewing* it: the decision is recorded alongside the
 * denial, so ticking a box that was waiting on review puts the permission in
 * force immediately rather than leaving it inert until some later approval.
 *
 * Two guards on what may be written. The key must be one the manifest actually
 * declares — the list is not a scratchpad — and it may never be a reserved
 * review marker, or an admin denying a plugin's oddly-named "permission" would
 * be spending that denial forging a review of the real permission behind it.
 */
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
		const declared = declaredPermissions(row.manifest as PluginManifest)
		const known = declared.find((p) => p.key === params.key)
		if (known && !isReviewMark(params.key)) {
			const entries = new Set<string>(row.adminDenied ?? [])
			if (params.granted) entries.delete(params.key)
			else entries.add(params.key)
			entries.add(reviewMark(known))
			await setAdminDenied(db, params.pluginId, [...entries])
			// Re-derive the live grant (a denied 'storage' drops the plugin's quota).
			await syncManager(params.pluginId)
		}
		const [updated] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, params.pluginId))
		const permissions = updated
			? permissionStates(
					updated.manifest as PluginManifest,
					updated.adminDenied
				)
			: []
		const storage = updated ? storageFacts(updated as Row) : undefined
		const res = { pluginId: params.pluginId, permissions, storage }
		emitToUser("plugins:permissions", res)
		return res
	}
}

/**
 * The consent act: record that an admin has reviewed this plugin's requested
 * permissions, and put in force everything they left ticked.
 *
 * It writes markers only — never a denial and never a removal — so an admin who
 * unticked a host first keeps that decision, and a key the plugin no longer
 * declares keeps whatever was decided about it (if it ever comes back, the
 * marker is still there and nothing re-prompts, which is the same rule as an
 * update that asks for nothing new).
 */
export const pluginsReviewPermissions: Handler<
	Sockets.Plugins.ReviewPermissions.Params,
	Sockets.Plugins.ReviewPermissions.Response
> = {
	event: "plugins:reviewPermissions",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		const [row] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, params.pluginId))
		if (!row) return { pluginId: params.pluginId, permissions: [] }
		const declared = declaredPermissions(row.manifest as PluginManifest)
		const entries = new Set<string>(row.adminDenied ?? [])
		for (const mark of reviewMarks(declared)) entries.add(mark)
		await setAdminDenied(db, params.pluginId, [...entries])
		// The grants only exist from here on: re-derive them for the live manager.
		await syncManager(params.pluginId)
		const [updated] = await db
			.select()
			.from(schema.plugins)
			.where(eq(schema.plugins.pluginId, params.pluginId))
		const permissions = updated
			? permissionStates(
					updated.manifest as PluginManifest,
					updated.adminDenied
				)
			: []
		const storage = updated ? storageFacts(updated as Row) : undefined
		const res = { pluginId: params.pluginId, permissions, storage }
		emitToUser("plugins:permissions", res)
		// The waiting badge lives on the list row, so that has to refresh too.
		await emitList(emitToUser)
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
			? permissionStates(
					updated.manifest as PluginManifest,
					updated.adminDenied
				)
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
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: Emit
	) => void
) {
	register(socket, pluginsList, emitToUser)
	register(socket, pluginsPermissions, emitToUser)
	register(socket, pluginsSetPermission, emitToUser)
	register(socket, pluginsReviewPermissions, emitToUser)
	register(socket, pluginsSetStorageQuota, emitToUser)
	register(socket, pluginsInstall, emitToUser)
	register(socket, pluginsSetEnabled, emitToUser)
	register(socket, pluginsSetBackend, emitToUser)
	register(socket, pluginsSetSequential, emitToUser)
	register(socket, pluginsUninstall, emitToUser)
	register(socket, pluginsUnload, emitToUser)
	register(socket, pluginsActive, emitToUser)
	register(socket, pluginsAbort, emitToUser)
	register(socket, pluginsKill, emitToUser)
	register(socket, pluginsLogs, emitToUser)
	register(socket, pluginsGetSettings, emitToUser)
	register(socket, pluginsSetSettings, emitToUser)
}
