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
import { loadEnabledPlugins, writeInvocation } from "./store"
import { makePluginRowPort } from "./rowStore"
import { pluginsEnabled } from "./flag"
import { syncPluginEngines } from "./engineHost"
import { pluginEvents, syncPluginEventHooks } from "./eventHost"
import { setRunStopObserver } from "$lib/server/pipelines/runtime/runRegistry"

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
		const descriptors = await loadEnabledPlugins(db)
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
				{ timeoutMs: 5_000, lifecycle: true }
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
