/**
 * The persistence seam between the DB and the RuntimeManager.
 *
 * `plugins` rows are the installed set; `loadEnabledPlugins` projects the
 * enabled ones into the descriptors the manager dispatches against.
 * `writeInvocation` appends the observability log — best-effort and
 * fire-and-forget from the hook's perspective, so logging never delays or fails
 * a hook result. Everything takes the db handle as a parameter so the same code
 * runs against the app db and an in-memory test db.
 */

import { eq } from "drizzle-orm"
import { plugins, pluginHookInvocations } from "$lib/server/db/schema"
import type { InvocationRecord, PluginDescriptor } from "./RuntimeManager"
import type { RuntimeKind } from "./types"
import {
	declaredPermissions,
	effectivePermissions,
	storageGrant,
	networkGrant,
	type PluginManifest
} from "./permissions"

type Db = { select: any; insert: any; update: any; delete: any }

interface PluginRow {
	pluginId: string
	name: string
	bundleSource: string
	bundleHash: string
	backends: unknown
	backend: string
	sequential: boolean
	enabled: boolean
	manifest?: PluginManifest | null
	adminDenied?: string[] | null
}

function rowToDescriptor(row: PluginRow): PluginDescriptor {
	const backends = (
		Array.isArray(row.backends) ? row.backends : ["quickjs"]
	).filter((b): b is RuntimeKind => b === "quickjs" || b === "ses")
	const backend: RuntimeKind =
		row.backend === "ses" || row.backend === "quickjs"
			? row.backend
			: "quickjs"
	return {
		id: row.pluginId,
		name: row.name,
		bundleSource: row.bundleSource,
		bundleHash: row.bundleHash,
		backends: backends.length ? backends : ["quickjs"],
		backend,
		sequential: row.sequential,
		// Grants derive from the *effective* set (declared − admin-denied).
		...capabilityGrants(row.manifest, row.adminDenied)
	}
}

/** Storage + network grants from a row's effective permission set. */
function capabilityGrants(
	manifest: PluginManifest | null | undefined,
	adminDenied: string[] | null | undefined
): { storageQuotaBytes?: number; networkHosts?: string[] } {
	const eff = effectivePermissions(declaredPermissions(manifest), adminDenied)
	return { storageQuotaBytes: storageGrant(eff), networkHosts: networkGrant(eff) }
}

/** Every enabled plugin, as manager descriptors. */
export async function loadEnabledPlugins(db: Db): Promise<PluginDescriptor[]> {
	const rows: PluginRow[] = await db
		.select()
		.from(plugins)
		.where(eq(plugins.enabled, true))
	return rows.map(rowToDescriptor)
}

/** Append one invocation to the log. Denormalized identity — no FK to plugins. */
export async function writeInvocation(
	db: Db,
	rec: InvocationRecord
): Promise<void> {
	await db.insert(pluginHookInvocations).values({
		pluginId: rec.pluginId,
		pluginName: rec.pluginName,
		bundleHash: rec.bundleHash,
		hookName: rec.hookName,
		backend: rec.backend,
		mode: rec.mode,
		triggeredBy: rec.user ?? null,
		runId: rec.runId ?? null,
		queuedAt: new Date(rec.queuedAt),
		startedAt: new Date(rec.startedAt),
		finishedAt: new Date(rec.finishedAt),
		durationMs: rec.durationMs,
		ok: rec.ok,
		outcome: rec.outcome,
		reason: rec.reason ?? null
	})
}

/* ── admin/CRUD helpers (used by the socket handlers) ────────────────────── */

export interface InstallInput {
	pluginId: string
	name: string
	version?: string
	bundleSource: string
	bundleHash: string
	backends: RuntimeKind[]
	backend?: RuntimeKind
	sequential?: boolean
	manifest?: Record<string, unknown>
}

/**
 * Insert or replace an installed plugin.
 *
 * SHA-pin rule (security): approval binds to exact bytes. A fresh install is
 * disabled until explicitly enabled; re-installing the *identical* bundle
 * (same `bundleHash`) keeps its approval; re-installing *changed* bytes forces
 * `enabled=false` so the new code cannot run under the old consent. Callers
 * must therefore re-enable after an upgrade — that re-enable is the re-review.
 */
export async function upsertPlugin(db: Db, input: InstallInput): Promise<void> {
	const backend = input.backend ?? input.backends[0] ?? "quickjs"
	const prior: { bundleHash: string; enabled: boolean }[] = await db
		.select({ bundleHash: plugins.bundleHash, enabled: plugins.enabled })
		.from(plugins)
		.where(eq(plugins.pluginId, input.pluginId))
	const enabled =
		prior[0] && prior[0].bundleHash === input.bundleHash
			? prior[0].enabled
			: false
	const values = {
		pluginId: input.pluginId,
		name: input.name,
		version: input.version ?? "0.0.0",
		bundleSource: input.bundleSource,
		bundleHash: input.bundleHash,
		backends: input.backends.length ? input.backends : ["quickjs"],
		backend,
		sequential: input.sequential ?? false,
		enabled,
		manifest: input.manifest ?? {},
		updatedAt: new Date()
	}
	await db
		.insert(plugins)
		.values(values)
		.onConflictDoUpdate({ target: plugins.pluginId, set: values })
}

export async function setEnabled(
	db: Db,
	pluginId: string,
	enabled: boolean
): Promise<void> {
	await db
		.update(plugins)
		.set({ enabled, updatedAt: new Date() })
		.where(eq(plugins.pluginId, pluginId))
}

export async function setBackendPref(
	db: Db,
	pluginId: string,
	backend: RuntimeKind
): Promise<void> {
	await db
		.update(plugins)
		.set({ backend, updatedAt: new Date() })
		.where(eq(plugins.pluginId, pluginId))
}

export async function setSequentialPref(
	db: Db,
	pluginId: string,
	sequential: boolean
): Promise<void> {
	await db
		.update(plugins)
		.set({ sequential, updatedAt: new Date() })
		.where(eq(plugins.pluginId, pluginId))
}

export async function setAdminDenied(
	db: Db,
	pluginId: string,
	denied: string[]
): Promise<void> {
	await db
		.update(plugins)
		.set({ adminDenied: denied, updatedAt: new Date() })
		.where(eq(plugins.pluginId, pluginId))
}

export async function removePlugin(db: Db, pluginId: string): Promise<void> {
	await db.delete(plugins).where(eq(plugins.pluginId, pluginId))
}
