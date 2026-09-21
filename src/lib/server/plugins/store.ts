/**
 * The persistence seam between the DB and the SandboxManager.
 *
 * `plugins` rows are the installed set; `loadEnabledPlugins` projects the
 * enabled ones into the descriptors the manager dispatches against.
 * `writeInvocation` appends the observability log — best-effort and
 * fire-and-forget from the hook's perspective, so logging never delays or fails
 * a hook result. Everything takes the db handle as a parameter so the same code
 * runs against the app db and an in-memory test db.
 */

import { eq } from "drizzle-orm"
import { i18nFindings } from "@serene-pub/sdk"
import { plugins, pluginHookInvocations } from "$lib/server/db/schema"
import { hookSettingsFor } from "./settingsHost"
import type { InvocationRecord, PluginDescriptor } from "./SandboxManager"
import type { SandboxKind } from "./types"
import {
	declaredPermissions,
	effectivePermissions,
	storageGrant,
	networkGrant,
	type PluginManifest
} from "./permissions"

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
	storageQuotaOverride?: number | null
	settings?: Record<string, unknown> | null
}

function rowToDescriptor(row: PluginRow): PluginDescriptor {
	const backends = (
		Array.isArray(row.backends) ? row.backends : ["quickjs"]
	).filter((b): b is SandboxKind => b === "quickjs" || b === "ses")
	const backend: SandboxKind =
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
		// Grants derive from the *effective* set (declared − admin-denied); an admin
		// storage-quota override rides on top of the effective storage grant.
		...permissionGrants(row.manifest, row.adminDenied, row.storageQuotaOverride),
		// Manifest-declared settings, resolved for the owning hook (12 §6).
		...(() => {
			const s = hookSettingsFor(row.manifest, row.settings)
			return s ? { settings: s } : {}
		})()
	}
}

/** Storage + network grants from a row's effective permission set. */
function permissionGrants(
	manifest: PluginManifest | null | undefined,
	adminDenied: string[] | null | undefined,
	storageQuotaOverride?: number | null
): { storageQuotaBytes?: number; networkHosts?: string[] } {
	const eff = effectivePermissions(declaredPermissions(manifest), adminDenied)
	return {
		storageQuotaBytes: storageGrant(eff, storageQuotaOverride),
		networkHosts: networkGrant(eff)
	}
}

/** Every enabled plugin, as manager descriptors. */
export async function loadEnabledPlugins(db: Db): Promise<PluginDescriptor[]> {
	const rows: PluginRow[] = await db
		.select()
		.from(plugins)
		.where(eq(plugins.enabled, true))
	return rows.map(rowToDescriptor)
}

/**
 * Every installed plugin's id and stored manifest — what its declarations are
 * read back from at boot (`pluginDefinitions.ts`).
 *
 * Installed rather than enabled: the registry rows a package published exist
 * from the moment it was installed, and a declaration this process does not
 * hold makes a spec that names it halt on `unknown type` rather than on the
 * plugin being switched off, which is the one sentence that would send an
 * administrator looking in the wrong place.
 */
export async function loadPluginManifests(
	db: Db
): Promise<Array<{ pluginId: string; manifest: unknown }>> {
	return db
		.select({ pluginId: plugins.pluginId, manifest: plugins.manifest })
		.from(plugins)
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
	backends: SandboxKind[]
	backend?: SandboxKind
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
/**
 * The install's half of R-20 (U5i): a manifest's `name` and `description` are
 * display text — a string or a locale map with `en`, never blank. The SDK's
 * `defineExtension` and the packager refuse these where the author is; the
 * install repeats the check over the manifest it is handed, because a bundle
 * may have been packaged against an older SDK and the plugin list shows this
 * name. Empty when the manifest carries neither or both are sound.
 */
export function manifestDisplayTextFindings(
	manifest: Record<string, unknown> | null | undefined
): string[] {
	if (!manifest || typeof manifest !== "object") return []
	return [
		...i18nFindings(manifest.name, "manifest.name"),
		...i18nFindings(manifest.description, "manifest.description")
	]
}

export async function upsertPlugin(db: Db, input: InstallInput): Promise<void> {
	const findings = manifestDisplayTextFindings(input.manifest)
	if (findings.length)
		throw new Error(
			`plugin '${input.pluginId}' cannot be installed: ${findings.join("; ")}`
		)
	const backend = input.backend ?? input.backends[0] ?? "quickjs"
	// Annotated: the `["quickjs"]` fallback widens to `string[]` on its own,
	// and `backends` is an enum-typed array column.
	const backends: SandboxKind[] = input.backends.length
		? input.backends
		: ["quickjs"]
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
		backends,
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
	backend: SandboxKind
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

/**
 * Set (or clear, with null) an admin's per-plugin storage-quota override. The
 * value is stored raw; the sane-band clamp and the "storage must be granted"
 * rule are applied at grant-derivation (storageGrant), the single point of truth.
 */
export async function setStorageQuotaOverride(
	db: Db,
	pluginId: string,
	bytes: number | null
): Promise<void> {
	await db
		.update(plugins)
		.set({ storageQuotaOverride: bytes, updatedAt: new Date() })
		.where(eq(plugins.pluginId, pluginId))
}

export async function removePlugin(db: Db, pluginId: string): Promise<void> {
	await db.delete(plugins).where(eq(plugins.pluginId, pluginId))
}
