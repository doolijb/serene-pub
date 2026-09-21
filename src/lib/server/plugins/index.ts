/**
 * The plugin subsystem's public entry point: one process-wide `SandboxManager`
 * and the startup bootstrap that hydrates it from the database.
 *
 * Everything here is inert unless `SP_PLUGINS_ENABLED` is set — the manager
 * exists (so admin routes can register/install), but no enabled plugins load
 * and no hooks fire until the gate is on. That is what lets the whole surface
 * ship in 0.6.0 turned off.
 */

import { SandboxManager, type InvocationRecord } from "./SandboxManager"
import {
	loadEnabledPlugins,
	loadPluginManifests,
	writeInvocation
} from "./store"
import {
	pluginDeclarationsOf,
	registerPluginDefinitions
} from "./pluginDefinitions"
import { makePluginRowPort } from "./rowStore"
import { pluginsEnabled } from "./flag"
import { syncPluginEngines } from "./engineHost"
import { pluginEvents, syncPluginEventHooks } from "./eventHost"
import { setRunStopObserver } from "$lib/server/pipelines/runtime/runRegistry"
import { reserveAttributeOwner } from "@serene-pub/sdk"

let manager: SandboxManager | null = null
let dbRef: Db | null = null

/** Best-effort, fire-and-forget: a failed log write never affects a hook. */
function persist(rec: InvocationRecord): void {
	if (!dbRef) return
	void writeInvocation(dbRef, rec).catch((e) =>
		console.error("[plugins] invocation log write failed:", e)
	)
}

/** The process-wide manager. Lazily created; safe to call before bootstrap. */
export function getManager(): SandboxManager {
	if (!manager)
		manager = new SandboxManager({
			onInvocation: persist,
			// The handle is resolved per call, exactly as the invocation log's
			// is: the manager can be constructed by an admin route long before
			// `bootstrapPlugins` has attached a database, and a store that
			// captured `dbRef` at construction would be permanently null.
			rows: makePluginRowPort(() => dbRef)
		})
	return manager
}

/**
 * Run once, after all *core* startup tasks complete. When the gate is on, loads
 * every enabled plugin, registers it, runs each startup lifecycle hook
 * sequentially, then opens the ready-gate so queued hook requests drain. The
 * gate is opened unconditionally at the end so the manager is never left stuck.
 */
export async function bootstrapPlugins(db: Db): Promise<void> {
	const mgr = getManager()
	dbRef = db

	// Cancelling a run reaches the hooks that run started. Registered against
	// *this* manager rather than through `getManager()`, so a shutdown cannot
	// leave a stale observer that lazily resurrects one; and registered
	// unconditionally, because a manager with nothing in flight answers a stop
	// with nothing, and wiring that depended on the sandbox flag would be
	// wiring that had never run the day somebody turned the flag on.
	setRunStopObserver({
		stopped: (runId, stop) => mgr.stopRun(runId, stop),
		finished: (runId) => mgr.forgetRun(runId)
	})

	if (pluginsEnabled()) {
		// Every installed package's node definitions, back in this process's
		// registry (D-6b). The rows in `pipeline_definition_registry` are what
		// a panel reads and what routes a node to its owner; the executor
		// resolves the declaration itself through the SDK's in-process
		// registry, which holds only what this build imported — so a plugin's
		// spec halts on `unknown type` until this has run. Read from the
		// stored manifest, which is data: nothing here loads a plugin.
		try {
			for (const row of await loadPluginManifests(db)) {
				const { declarations, refused } = pluginDeclarationsOf(
					row.manifest,
					row.pluginId
				)
				const registered = registerPluginDefinitions(declarations)
				for (const line of [...refused, ...registered.refused])
					console.warn(`[plugins] '${row.pluginId}': ${line}`)
			}
		} catch (e) {
			console.warn("[plugins] node-definition registration failed:", e)
		}

		const descriptors = await loadEnabledPlugins(db)
		// Before anything a plugin declares can be registered: an installed
		// package owns its namespace, and a person's authored slot may not
		// claim it (R2). Idempotent, and the boot reserves every *installed*
		// id already — this is the case where one is enabled while the app is
		// running.
		for (const d of descriptors) reserveAttributeOwner(d.id)
		for (const d of descriptors) {
			try {
				mgr.register(d)
			} catch (e) {
				console.warn(`[plugins] skipping '${d.id}': ${String(e)}`)
			}
		}
		// Startup lifecycle hooks: sequential, before the gate opens. A plugin
		// with no 'startup' hook simply reports 'missing' — not an error.
		for (const d of descriptors) {
			const r = await mgr.callHook(
				d.id,
				"startup",
				{},
				{ kind: "lifecycle", timeoutMs: 5_000, lifecycle: true }
			)
			if (!r.ok && r.outcome !== "missing")
				console.warn(
					`[plugins] '${d.id}' startup hook failed (${r.outcome}): ${r.reason}`
				)
		}
		// Manifest-declared template engines, registered as forwarding
		// renderers. Best-effort like the startup hooks: a bad declaration
		// warns and is skipped, and must not stall boot.
		try {
			await syncPluginEngines(db, mgr)
		} catch (e) {
			console.warn("[plugins] template-engine sync failed:", e)
		}
		// Manifest-declared event subscriptions, projected into the registry
		// core fans an occurrence out through. Best-effort for the same reason
		// as the engines above — a plugin whose declarations are refused costs
		// itself its subscriptions and nobody else theirs, and neither may
		// stall boot.
		try {
			await syncPluginEventHooks(db)
		} catch (e) {
			console.warn("[plugins] event-subscription sync failed:", e)
		}
		// Manifest-declared session presets, projected into the rows an
		// administrator enables from (24 §10). Best-effort for the same reason
		// as the two above, and at boot as well as on enable because a preset
		// withdrawn while the app was down has to come back when it starts.
		try {
			const { syncPluginPresets } = await import(
				"$lib/server/pipelines/boot/registrySync"
			)
			await syncPluginPresets(db)
		} catch (e) {
			console.warn("[plugins] session-preset sync failed:", e)
		}
		// Manifest-declared template rows — prompts, context templates and
		// variable layouts under owner-namespaced template ids (R19). Best-
		// effort and at boot for the same reasons as the presets above: a
		// template withdrawn while the app was down has to come back when it
		// starts, and a package whose declaration is refused costs itself that
		// row and nobody else theirs.
		try {
			const { syncPluginTemplates } = await import(
				"$lib/server/pipelines/boot/registrySync"
			)
			await syncPluginTemplates(db)
		} catch (e) {
			console.warn("[plugins] template sync failed:", e)
		}
		// Manifest-declared session layouts, projected into
		// `session_layout_presets` as `origin = 'plugin'` rows (session layout
		// v2 §4.1). Best-effort and at boot for the same reasons as the presets
		// above: a layout withdrawn while the app was down has to come back
		// when it starts, and a package whose layout is refused costs itself
		// that layout and nobody else theirs.
		try {
			const { syncPluginLayouts } = await import(
				"$lib/server/db/pluginLayouts"
			)
			await syncPluginLayouts(db)
		} catch (e) {
			console.warn("[plugins] session-layout sync failed:", e)
		}
	}

	mgr.markReady()
}

/** Tear down the manager (tests / shutdown). */
export async function shutdownPlugins(): Promise<void> {
	// First: the observer closes over the manager being disposed, and a run
	// cancelled after this point has no hooks left to stop.
	setRunStopObserver(null)
	// Subscriptions outlive nothing: a registry left populated would answer the
	// next emit with subscribers whose sandbox is gone.
	pluginEvents().clear()
	if (manager) await manager.dispose()
	manager = null
	dbRef = null
}

export { pluginsEnabled } from "./flag"
export type { SandboxManager } from "./SandboxManager"
