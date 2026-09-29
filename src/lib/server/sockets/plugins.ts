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
import { and, asc, desc, eq } from "drizzle-orm"
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
	isRefusedPermissionKey,
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
	applyUserSettingsWrite,
	clientSettingsView,
	loadPluginUserSettingsRows,
	readUserPluginSettings,
	settingsDelivery,
	settingsSchemaOf,
	pluginUserSettingsView,
	writePluginSettings,
	writeUserPluginSettings,
	type PluginUserSettingsRow
} from "$lib/server/plugins/settingsHost"
import { notCoreRow } from "$lib/server/plugins/frameHost"
import {
	afterEnable,
	fireLifecycle,
	firePendingUpdate
} from "$lib/server/plugins/lifecycle"
import { pluginComponentRefusals } from "$lib/server/components/compat"

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
	/** The admin's switched-off swap contributions (R29, R66). */
	disabledSwaps?: string[] | null
	storageQuotaOverride?: number | null
	settings?: Record<string, unknown> | null
}

export function toPluginRow(r: Row): Sockets.Plugins.PluginRow {
	const backends = (
		Array.isArray(r.backends) ? r.backends : ["quickjs"]
	).filter((b): b is SandboxKind => b === "quickjs" || b === "ses")
	// Components built for a host contract this host does not speak (F1):
	// never offered to a session, and this is where an admin reads why.
	const refusals = pluginComponentRefusals(r.manifest)
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
		needsReview: needsReview(r.manifest, r.adminDenied),
		...(refusals.length ? { componentRefusals: refusals } : {})
	}
}

function toDescriptor(
	r: Row,
	userRows: readonly PluginUserSettingsRow[] = []
): PluginDescriptor {
	const p = toPluginRow(r)
	const eff = effectivePermissions(
		declaredPermissions(r.manifest),
		r.adminDenied
	)
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
		// Handles for the hook, plaintext host-side (R63) — as `store.ts`
		// does — and each user's own resolution for user-scoped fields.
		...settingsDelivery(r.manifest, r.settings, userRows)
	}
}

async function allRows(): Promise<Row[]> {
	return db.select().from(schema.plugins).orderBy(asc(schema.plugins.name))
}

/**
 * Each plugin's swap contributions as the plugins page shows them (R66): a
 * read-only count — the switches live on the genre hub — and the genre whose
 * hub holds them (the first contributed pipeline's), for the link.
 */
async function swapSummaries(
	rows: Row[]
): Promise<Map<string, NonNullable<Sockets.Plugins.PluginRow["swaps"]>>> {
	const out = new Map<string, NonNullable<Sockets.Plugins.PluginRow["swaps"]>>()
	const withSwaps = rows.filter(
		(r) => Array.isArray((r.manifest as any)?.swaps) && (r.manifest as any).swaps.length
	)
	if (!withSwaps.length) return out
	const { swapKey } = await import("$lib/server/pipelines/entities/bindings")
	const specs = (await db
		.select({
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			versionId: schema.pipelineSpecVersions.id,
			inputGenre: schema.pipelineSpecVersions.inputGenre
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)) as any[]
	const genreOf = new Map(
		specs
			.filter((r) => r.activeVersionId === r.versionId)
			.map((r) => [r.slug as string, (r.inputGenre ?? null) as string | null])
	)
	for (const r of withSwaps) {
		// Only swaps onto a published pipeline — the ones a genre hub lists.
		const swaps = ((r.manifest as any).swaps as any[]).filter(
			(c) => c?.spec && c?.node && c?.definition && genreOf.has(c.spec)
		)
		if (!swaps.length) continue
		const off = new Set<string>(r.disabledSwaps ?? [])
		out.set(r.pluginId, {
			total: swaps.length,
			off: swaps.filter((c) => off.has(swapKey(c.spec, c.node, c.definition))).length,
			genreId: swaps.map((c) => genreOf.get(c.spec)).find((g) => !!g) ?? null
		})
	}
	return out
}

async function listPayload(): Promise<Sockets.Plugins.List.Response> {
	const rows = await allRows()
	const sandboxEnabled = pluginsEnabled()
	// Warm/cold is live truth, so it is annotated from the live manager
	// rather than stored: with the gate off nothing is ever loaded.
	const mgr = sandboxEnabled ? getManager() : null
	const swapsOf = await swapSummaries(rows)
	return {
		plugins: rows.map((r) => ({
			...toPluginRow(r),
			warm: mgr ? mgr.isWarm(r.pluginId) : false,
			...(swapsOf.has(r.pluginId) ? { swaps: swapsOf.get(r.pluginId)! } : {})
		})),
		sandboxEnabled
	}
}

/**
 * After any mutation: refresh the canonical list to the client — lazily.
 *
 * `listPayload` reads every plugin row and asks the live manager which of them
 * are warm; `plugins:list` is gated, so a mutation made from anywhere but
 * /admin/extensions pays for neither. Skipping the emit alone would save
 * nothing; the query is the cost.
 *
 * Still returns the rows it built, because six callers spread them into their
 * own return value. That return is discarded by `register` — a write handler
 * here answers ONLY through this push — so the empty array a closed gate yields
 * reaches nothing but a direct-call test.
 */
export async function emitList(
	emitToUser: Emit
): Promise<Sockets.Plugins.PluginRow[]> {
	let plugins: Sockets.Plugins.PluginRow[] = []
	await emitToUser("plugins:list", async () => {
		const payload = await listPayload()
		plugins = payload.plugins
		return payload
	})
	return plugins
}

/**
 * Re-send `sessionPresets:list` to every socket that declared it: a plugin's
 * install, switch or uninstall publishes or culls its pipelines and lists or
 * hides its presets (R67), so an open session-create screen — anyone's — is
 * stale until it hears.
 */
async function pushPresets(socket: any): Promise<void> {
	const { pushSessionPresetsAfter } = await import("./sessionAdmin")
	await pushSessionPresetsAfter(socket)
}

/** Best-effort: keep the live manager in step with the DB (only when on). */
async function syncManager(pluginId: string): Promise<void> {
	if (!pluginsEnabled()) return
	// A row stored as `core` is never registered, even switched on: it
	// reads as absent, so the manager holds nothing under the app's name.
	const [row] = await db
		.select()
		.from(schema.plugins)
		.where(and(eq(schema.plugins.pluginId, pluginId), notCoreRow()))
	const mgr = getManager()
	if (!row || !row.enabled) {
		mgr.unregister(pluginId)
		await syncDeclarations()
		return
	}
	try {
		const userRows = await loadPluginUserSettingsRows(db, [pluginId])
		mgr.register(toDescriptor(row as Row, userRows.get(pluginId)))
	} catch (e) {
		console.warn(`[plugins] manager register '${pluginId}' failed:`, e)
	}
	await syncDeclarations()
}

/** Whether a plugin's row says it is switched on (false when there is none). */
async function isSwitchedOn(pluginId: string): Promise<boolean> {
	const [row] = await db
		.select({ enabled: schema.plugins.enabled })
		.from(schema.plugins)
		.where(eq(schema.plugins.pluginId, pluginId))
	return !!row?.enabled
}

/**
 * After a (re)install wrote the row. A replaced bundle arrives disabled, so a
 * plugin that was running is being switched off by the install: its OLD
 * bundle hears `disable` while still registered, and is then unregistered —
 * before this, the old copy kept running until the next boot. A reinstall
 * that kept the plugin on (same bundle, new version) fires its pending
 * `update` straight away, since the bundle it owes it to is already running.
 */
async function afterReinstall(pluginId: string, wasOn: boolean): Promise<void> {
	if (!pluginsEnabled()) return
	const nowOn = await isSwitchedOn(pluginId)
	if (wasOn && !nowOn) {
		await fireLifecycle(getManager(), pluginId, "disable")
		await syncManager(pluginId)
	} else if (nowOn) {
		await syncManager(pluginId)
		await firePendingUpdate(db, getManager(), pluginId)
	} else {
		// Installed but not switched on: its genres, slots and sheets still
		// register (they follow installation, not the switch — see
		// `pluginGenres.ts`), and a replaced manifest's must be re-read.
		await syncDeclarations()
	}
}

/**
 * Reconcile the manifest-declared registries with the plugin rows: genres
 * (with their slots and sheets) with the installed set; template engines,
 * event subscriptions, and session presets with the enabled set.
 *
 * All three are projections of the `plugins` table, so all three are stale the
 * moment a plugin is enabled, disabled, uninstalled or has a permission denied —
 * and the event half is the one where staleness has teeth, because an admin
 * denying an `event:` permission has to actually stop the subscription rather
 * than only change what the audit screen says.
 */
async function syncDeclarations(): Promise<void> {
	try {
		// Context variables first (typed templates, 2026-09-27): installed,
		// not enabled, like genres — see `pluginVariables.ts`.
		const { syncPluginVariables } = await import(
			"$lib/server/plugins/pluginVariables"
		)
		for (const line of await syncPluginVariables(db))
			console.warn(`[plugins] variable ${line}`)
	} catch (e) {
		console.warn("[plugins] variable sync failed:", e)
	}
	try {
		// Genres first, with their attribute slots and sheets: a plugin genre
		// the registries do not hold states no vocabulary. They follow
		// INSTALLATION, not the switch — a disabled plugin's running sessions
		// keep writing, only an uninstall withdraws. See `pluginGenres.ts`.
		const { syncPluginGenres } = await import(
			"$lib/server/plugins/pluginGenres"
		)
		for (const line of await syncPluginGenres(db))
			console.warn(`[plugins] genre ${line}`)
	} catch (e) {
		console.warn("[plugins] genre sync failed:", e)
	}
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
	try {
		// A package's `preset()` declarations reached no row at all until this
		// (24 §10). They arrive disabled and an administrator enables them;
		// disabling the plugin marks them withdrawn rather than deleting, since
		// a session names its preset. See `syncPluginPresets`.
		const { syncPluginPresets } = await import(
			"$lib/server/pipelines/boot/registrySync"
		)
		await syncPluginPresets(db)
	} catch (e) {
		console.warn("[plugins] session-preset sync failed:", e)
	}
	try {
		// …and the template rows a package ships beside its pipelines (R19):
		// the prompt an author wrote their pipeline around had nowhere to live
		// until this. Disabling marks them withdrawn rather than deleting,
		// since a configuration names the row. See `syncPluginTemplates`.
		const { syncPluginTemplates } = await import(
			"$lib/server/pipelines/boot/registrySync"
		)
		await syncPluginTemplates(db)
	} catch (e) {
		console.warn("[plugins] template sync failed:", e)
	}
	try {
		// …and the layouts a package ships for a genre (session layout v2
		// §4.1). Disabling marks them withdrawn rather than deleting, since a
		// session names its layout preset. See `syncPluginLayouts`.
		const { syncPluginLayouts } = await import(
			"$lib/server/db/pluginLayouts"
		)
		await syncPluginLayouts(db)
	} catch (e) {
		console.warn("[plugins] session-layout sync failed:", e)
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
		// The id before anything runs: `upsertPlugin` refuses it too, but only
		// after the conformance run, and a thrown refusal reaches the admin as
		// the socket layer's generic sentence.
		{
			const { pluginIdFindings } = await import("$lib/server/plugins/store")
			const bad = pluginIdFindings(params.pluginId)
			if (bad.length) {
				const msg = `This package cannot install: ${bad.join("; ")}`
				emitToUser("error", { error: msg })
				throw new Error(msg)
			}
		}
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
			// Swap contributions (R29): refused here with the SDK's sentence
			// rather than offered to nobody, or offered and mis-wired.
			const { swapContributionProblems } = await import(
				"$lib/server/plugins/swaps"
			)
			const problems = await swapContributionProblems(db, params.manifest as any)
			if (problems.length) {
				const msg = `This package cannot install: ${problems.join("; ")}`
				emitToUser("error", { error: msg })
				throw new Error(msg)
			}
		}
		// `backends` is a compiled fact: run the bundle on both sandboxes and
		// take the set it actually loads on, ignoring any author claim.
		const conf = await checkConformance(params.bundleSource, params.manifest)
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
		const wasOn = await isSwitchedOn(params.pluginId)
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
		// Its declared events (E1b), replacing what an earlier version of
		// this plugin declared — boot re-registers the same list from the
		// stored manifest.
		{
			// Its context variables (typed templates, 2026-09-27) — before
			// anything reads a band of its definitions.
			const { registerPluginVariables } = await import("$lib/server/plugins/pluginVariables")
			const varsRefused = registerPluginVariables(params.manifest, params.pluginId)
			if (varsRefused.length)
				console.warn(`[plugins] '${params.pluginId}' variables refused: ${varsRefused.join("; ")}`)
			const { registerPluginEvents } = await import("$lib/server/plugins/pluginEvents")
			const refused = registerPluginEvents(params.manifest, params.pluginId)
			if (refused.length)
				console.warn(`[plugins] '${params.pluginId}' events refused: ${refused.join("; ")}`)
			const { registerPluginAnnex } = await import("$lib/server/plugins/pluginAnnex")
			const annexRefused = registerPluginAnnex(params.manifest, params.pluginId)
			if (annexRefused.length)
				console.warn(`[plugins] '${params.pluginId}' annex fields refused: ${annexRefused.join("; ")}`)
		}
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
		// A fresh/changed bundle is disabled until re-enabled; a running
		// plugin it replaced hears `disable` on the way out.
		await afterReinstall(params.pluginId, wasOn)
		await pushPresets(socket)
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
		const wasOn = await isSwitchedOn(params.pluginId)
		// `disable` BEFORE the switch, while the plugin is still registered —
		// bounded, and its outcome never stops the switch (lifecycle.ts).
		if (pluginsEnabled() && wasOn && !params.enabled)
			await fireLifecycle(getManager(), params.pluginId, "disable")
		await setEnabled(db, params.pluginId, params.enabled)
		await syncManager(params.pluginId)
		// `update` (if a replaced bundle owes one) then `enable`, AFTER.
		if (pluginsEnabled() && !wasOn && params.enabled)
			await afterEnable(db, getManager(), params.pluginId)
		await pushPresets(socket)
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
		if (pluginsEnabled()) {
			// Its last chance to clean up, before anything of it is removed.
			// Bounded; a failure removes the plugin all the same. A plugin
			// that is switched off is not registered, so its code does not run.
			await fireLifecycle(getManager(), params.pluginId, "uninstall")
			getManager().unregister(params.pluginId)
		}
		// What an install PROJECTED comes out first, while the plugin row that
		// owns it still exists (D-6): the specs by `source_plugin_id` and the
		// configs by seed key, with everything under a spec following by FK
		// cascade. Prompts, presets and layouts are intentionally not here —
		// they are marked withdrawn by their own syncs below, because a session
		// names its preset and a configuration names a prompt row.
		const { cullPluginProjection } = await import(
			"$lib/server/plugins/install"
		)
		await cullPluginProjection(db, params.pluginId)
		await removePlugin(db, params.pluginId)
		await db
			.delete(schema.pluginFiles)
			.where(eq(schema.pluginFiles.pluginId, params.pluginId))
		if (pluginsEnabled()) await syncDeclarations()
		await pushPresets(socket)
		return { plugins: await emitList(emitToUser) }
	}
}

/**
 * **Install a plugin from a folder on this machine** (D-6) — the dev install.
 *
 * `plugins:install` takes a bundle and a manifest over the wire, which is the
 * shape a *distributed* package arrives in and a shape nothing yet produces.
 * This one takes a path: the package `serene-pub build` just wrote, read
 * straight off disk, so an author can go from `npm run package` to a genre in
 * the picker without a registry in between.
 *
 * Three refusals, in order:
 *
 *  - **admin only**, like every handler in this file;
 *  - **`pluginsEnabled()`**, unlike every handler in this file. The others are
 *    management — an admin preparing plugins for an instance that has not
 *    switched the subsystem on yet — and they change rows nothing reads. This
 *    one projects a genre into the picker and specs into the run path, which
 *    are read by the session surface whether the sandbox is on or not. A dev
 *    install is a development act, so it asks for the development flag;
 *  - **a local path, never a URL.** Anything this fetched would be code
 *    installed from wherever the string pointed, judged by nobody.
 *
 * It does not enable the plugin. `upsertPlugin`'s SHA pin leaves a fresh
 * install disabled and the permission review leaves every grant refused until
 * an administrator looks, and neither of those is a dev install's to skip.
 */
export const pluginsInstallLocal: Handler<
	Sockets.Plugins.InstallLocal.Params,
	Sockets.Plugins.InstallLocal.Response
> = {
	event: "plugins:installLocal",
	handler: async (socket, params, emitToUser) => {
		requireAdmin(socket, emitToUser)
		if (!pluginsEnabled()) {
			const msg =
				"The plugin subsystem is off. A dev install projects a genre and its " +
				"pipelines into rows the session surface reads, so it asks for " +
				"SP_PLUGINS_ENABLED rather than landing them on an instance that has " +
				"the subsystem switched off."
			emitToUser("error", { error: msg })
			throw new Error(msg)
		}
		const dir = typeof params.dir === "string" ? params.dir.trim() : ""
		if (!dir || /^[a-z][a-z0-9+.-]*:\/\//i.test(dir)) {
			const msg =
				"A dev install reads a folder on this machine. Give it a path to the " +
				"package — not a URL: code fetched from a string nobody reviewed is " +
				"code nobody judged."
			emitToUser("error", { error: msg })
			throw new Error(msg)
		}

		const { installPluginPackage } = await import(
			"$lib/server/plugins/install"
		)
		const report = await installPluginPackage(db, dir)
		for (const line of [...report.warnings, ...report.refused])
			console.warn(`[plugins] installLocal '${report.pluginId}': ${line}`)
		await afterReinstall(report.pluginId, report.wasEnabled)
		// The manifest's own declarations — presets, prompts, engines, event
		// subscriptions, layouts — are reconciled from the plugin rows, so they
		// land the moment the row exists (and again on enable).
		await syncDeclarations()
		await pushPresets(socket)
		return {
			pluginId: report.pluginId,
			specs: report.specs,
			configs: report.configs,
			genres: report.genresDeclared,
			files: report.files.stored,
			warnings: [...report.warnings, ...report.refused],
			plugins: await emitList(emitToUser)
		}
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
		// A refused key is never declared, so `known` is already undefined for
		// one; refused here as well so a write can never spell another
		// permission's mark (`isRefusedPermissionKey`).
		if (known && !isReviewMark(params.key) && !isRefusedPermissionKey(params.key)) {
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
 * unticked a host first keeps that decision, and a key the plugin has dropped
 * from its declaration keeps whatever was decided about it (if it ever comes back, the
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
 * only, like the rest of this surface. Every value here is the instance's: for
 * a user-scoped field (`scope: 'user'`) it is what everyone reads until they
 * set their own through `pluginUserSettings:set`.
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

/* ── a person's own values for user-scoped settings ──────────────────────── */

/**
 * The signed-in person's own settings, for every enabled plugin that declares
 * a user-scoped field (`scope: 'user'`). Not admin-only: this is the one part
 * of plugin settings each person owns. The user is always the socket's own —
 * there is no parameter naming anyone else, so no one can read another
 * person's values through it.
 */
async function userSettingsPayload(
	userId: number
): Promise<Sockets.PluginUserSettings.List.Response> {
	const rows = await db
		.select({
			pluginId: schema.plugins.pluginId,
			name: schema.plugins.name,
			manifest: schema.plugins.manifest,
			settings: schema.plugins.settings
		})
		.from(schema.plugins)
		.where(and(eq(schema.plugins.enabled, true), notCoreRow()))
		.orderBy(asc(schema.plugins.name))
	const out: Sockets.PluginUserSettings.List.Response["plugins"] = []
	for (const r of rows) {
		const own = await readUserPluginSettings(db, r.pluginId, userId)
		const view = pluginUserSettingsView(r.manifest, r.settings, own)
		if (view) out.push({ pluginId: r.pluginId, name: r.name, settings: view })
	}
	return { plugins: out }
}

function signedInUserId(socket: any): number | null {
	const id = socket.user?.id
	return typeof id === "number" && Number.isInteger(id) ? id : null
}

export const pluginUserSettingsList: Handler<
	Sockets.PluginUserSettings.List.Params,
	Sockets.PluginUserSettings.List.Response
> = {
	event: "pluginUserSettings:list",
	handler: async (socket, _params, emitToUser) => {
		const userId = signedInUserId(socket)
		if (userId === null) {
			const res = { plugins: [], error: "Sign in to change your own settings." }
			emitToUser("pluginUserSettings:list:error", res)
			return res
		}
		const res = await userSettingsPayload(userId)
		emitToUser("pluginUserSettings:list", res)
		return res
	}
}

/**
 * Write the signed-in person's own values. Only user-scoped fields are
 * writable — an instance field is refused by name, whoever asks, because this
 * path writes a person's row and an instance value belongs in
 * `plugins:setSettings`. A null (or "" for a secret) clears the person's own
 * value, so they read the instance's again. A successful write re-syncs the
 * manager, so their next hook call carries it.
 */
export const pluginUserSettingsSet: Handler<
	Sockets.PluginUserSettings.Set.Params,
	Sockets.PluginUserSettings.Set.Response
> = {
	event: "pluginUserSettings:set",
	handler: async (socket, params, emitToUser) => {
		const fail = (error: string) => {
			const res = { pluginId: params.pluginId, error }
			emitToUser("pluginUserSettings:set:error", res)
			return res
		}
		const userId = signedInUserId(socket)
		if (userId === null) return fail("Sign in to change your own settings.")
		const [row] = await db
			.select()
			.from(schema.plugins)
			.where(
				and(eq(schema.plugins.pluginId, params.pluginId), notCoreRow())
			)
		if (!row || !row.enabled)
			return fail("That extension is not installed and switched on.")
		const current = await readUserPluginSettings(db, row.pluginId, userId)
		const applied = applyUserSettingsWrite(
			settingsSchemaOf(row.manifest),
			current,
			params.values ?? {}
		)
		if (!applied.ok) return fail(applied.error)
		await writeUserPluginSettings(db, row.pluginId, userId, applied.next)
		await syncManager(row.pluginId)
		const res: Sockets.PluginUserSettings.Set.Response = {
			pluginId: row.pluginId,
			settings: pluginUserSettingsView(row.manifest, row.settings, applied.next)
		}
		emitToUser("pluginUserSettings:list", await userSettingsPayload(userId))
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
	register(socket, pluginsInstallLocal, emitToUser)
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
	register(socket, pluginUserSettingsList, emitToUser)
	register(socket, pluginUserSettingsSet, emitToUser)
}
