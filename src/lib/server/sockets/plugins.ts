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
	removePlugin
} from "$lib/server/plugins/store"
import {
	permissionStates,
	declaredPermissions,
	effectivePermissions,
	storageGrant,
	networkGrant,
	type PluginManifest
} from "$lib/server/plugins/permissions"

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
		enabled: r.enabled
	}
}

function toDescriptor(r: Row): PluginDescriptor {
	const p = toPluginRow(r)
	const eff = effectivePermissions(declaredPermissions(r.manifest), r.adminDenied)
	return {
		id: r.pluginId,
		name: r.name,
		bundleSource: r.bundleSource,
		bundleHash: r.bundleHash,
		backends: p.backends,
		backend: p.backend,
		sequential: r.sequential,
		storageQuotaBytes: storageGrant(eff),
		networkHosts: networkGrant(eff)
	}
}

async function allRows(): Promise<Row[]> {
	return db.select().from(schema.plugins).orderBy(asc(schema.plugins.name))
}

async function listPayload(): Promise<Sockets.Plugins.List.Response> {
	const rows = await allRows()
	return { plugins: rows.map(toPluginRow), runtimeEnabled: pluginsEnabled() }
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
		return
	}
	try {
		mgr.register(toDescriptor(row as Row))
	} catch (e) {
		console.warn(`[plugins] manager register '${pluginId}' failed:`, e)
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
		const res = { pluginId: params.pluginId, permissions }
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
		const res = { pluginId: params.pluginId, permissions }
		emitToUser("plugins:permissions", res)
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
	register(socket, pluginsInstall, emitToUser)
	register(socket, pluginsSetEnabled, emitToUser)
	register(socket, pluginsSetBackend, emitToUser)
	register(socket, pluginsSetSequential, emitToUser)
	register(socket, pluginsUninstall, emitToUser)
	register(socket, pluginsActive, emitToUser)
	register(socket, pluginsKill, emitToUser)
	register(socket, pluginsLogs, emitToUser)
}
