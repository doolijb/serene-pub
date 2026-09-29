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
import {
	loadPluginUserSettingsRows,
	settingsDelivery,
	type PluginUserSettingsRow
} from "./settingsHost"
import { isPluginSlug } from "./frameHost"
import { markAdminOverviewStale } from "$lib/server/admin/overviewStale"
import { isReservedAuthoredNamespace } from "$lib/shared/widgets/authoredOwner"
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

function rowToDescriptor(
	row: PluginRow,
	userRows: readonly PluginUserSettingsRow[] = []
): PluginDescriptor {
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
		// Manifest-declared settings, resolved for the owning hook (12 §6):
		// the instance's, and each user's own for user-scoped fields. Handles
		// for the hook, plaintext kept host-side for the fetch bridge and the
		// scrub (R63).
		...settingsDelivery(row.manifest, row.settings, userRows)
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

/**
 * `notCoreRow` (`frameHost`) at the two boot reads, which also SAY so: never loaded, so
 * nothing registers under the app's own name. Said once per boot read; the
 * row stays for an administrator to remove.
 */
function notCore<T extends { pluginId: string }>(rows: T[]): T[] {
	return rows.filter((r) => {
		if (r.pluginId !== "core") return true
		console.warn(
			"[plugins] a stored plugin claims the id 'core', which is the app's own — not loaded; remove it"
		)
		return false
	})
}

/** Every enabled plugin, as manager descriptors. */
export async function loadEnabledPlugins(db: Db): Promise<PluginDescriptor[]> {
	const rows: PluginRow[] = await db
		.select()
		.from(plugins)
		.where(eq(plugins.enabled, true))
	const kept = notCore(rows)
	const userRows = await loadPluginUserSettingsRows(
		db,
		kept.map((r) => r.pluginId)
	)
	return kept.map((r) => rowToDescriptor(r, userRows.get(r.pluginId)))
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
	return notCore(
		await db
			.select({ pluginId: plugins.pluginId, manifest: plugins.manifest })
			.from(plugins)
	)
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

/**
 * The install's check on the id itself: a plugin's id is its SDK slug — one
 * URL segment (`/plugin-ui/<id>/…`) — and never `core`, the app's own owner
 * id, which core's widgets are answered as and a page trusts. Held here, on
 * the one write every install path makes (`plugins:install`,
 * `plugins:installLocal`, the `plugin-install` script), not only where a
 * package is read (`readPluginPackage`). Empty when the id is sound.
 */
export function pluginIdFindings(pluginId: unknown): string[] {
	if (typeof pluginId !== "string" || !isPluginSlug(pluginId))
		return [
			`id ${JSON.stringify(pluginId)} is not a plugin slug — lowercase letters, ` +
				`digits, dots and hyphens ('chariot.dice-tray')`
		]
	if (pluginId === "core")
		return ["id 'core' is the app's own — a plugin cannot take it"]
	// `authored.<id>` is the owner of an authored component (C6): a plugin
	// under it would share that component's UI worker and answer as it.
	if (isReservedAuthoredNamespace(pluginId))
		return [
			`id '${pluginId}' is in the 'authored' namespace, which this instance keeps for ` +
				`components authored in the app — a plugin cannot take it`
		]
	return []
}

export async function upsertPlugin(db: Db, input: InstallInput): Promise<void> {
	const findings = [
		...pluginIdFindings(input.pluginId),
		...manifestDisplayTextFindings(input.manifest)
	]
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
	const prior: {
		bundleHash: string
		enabled: boolean
		version: string
		updateFromVersion: string | null
	}[] = await db
		.select({
			bundleHash: plugins.bundleHash,
			enabled: plugins.enabled,
			version: plugins.version,
			updateFromVersion: plugins.updateFromVersion
		})
		.from(plugins)
		.where(eq(plugins.pluginId, input.pluginId))
	const enabled =
		prior[0] && prior[0].bundleHash === input.bundleHash
			? prior[0].enabled
			: false
	const version = input.version ?? "0.0.0"
	// A reinstall that replaced the bundle (or its version) owes the new
	// bundle an `update` callback on its first run (lifecycle.ts). The oldest
	// version not yet announced wins: two reinstalls before that run are one
	// upgrade from where the plugin actually was.
	const replaced =
		!!prior[0] &&
		(prior[0].bundleHash !== input.bundleHash || prior[0].version !== version)
	const updateFromVersion = replaced
		? (prior[0].updateFromVersion ?? prior[0].version)
		: (prior[0]?.updateFromVersion ?? null)
	const values = {
		pluginId: input.pluginId,
		name: input.name,
		version,
		bundleSource: input.bundleSource,
		bundleHash: input.bundleHash,
		backends,
		backend,
		sequential: input.sequential ?? false,
		enabled,
		manifest: input.manifest ?? {},
		updateFromVersion,
		updatedAt: new Date()
	}
	await db
		.insert(plugins)
		.values(values)
		.onConflictDoUpdate({ target: plugins.pluginId, set: values })
	// A changed bundle arrives disabled: the Overview's `plugins:awaitingReview`.
	markAdminOverviewStale()
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
	// Re-enabling a changed bundle is its re-review (see `upsertPlugin`).
	markAdminOverviewStale()
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
	// Review marks live here: `needsReview` may have just turned false.
	markAdminOverviewStale()
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
	// Its events stop being recordable at once (E1b).
	const { withdrawPluginEvents } = await import("./pluginEvents")
	withdrawPluginEvents(pluginId)
	// …and its annex declaration (ruling 2026-09-26).
	const { withdrawPluginAnnex } = await import("./pluginAnnex")
	withdrawPluginAnnex(pluginId)
	// …and its context variables (typed templates, 2026-09-27).
	const { withdrawPluginVariables } = await import("./pluginVariables")
	withdrawPluginVariables(pluginId)
	await db.delete(plugins).where(eq(plugins.pluginId, pluginId))
	markAdminOverviewStale()
}
