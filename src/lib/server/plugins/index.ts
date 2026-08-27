/**
 * The plugin subsystem's public entry point: one process-wide `RuntimeManager`
 * and the startup bootstrap that hydrates it from the database.
 *
 * Everything here is inert unless `SP_PLUGINS_ENABLED` is set — the manager
 * exists (so admin routes can register/install), but no enabled plugins load
 * and no hooks fire until the gate is on. That is what lets the whole surface
 * ship in 0.6.0 turned off.
 */

import { RuntimeManager, type InvocationRecord } from "./RuntimeManager"
import { loadEnabledPlugins, writeInvocation } from "./store"
import { pluginsEnabled } from "./flag"
import { syncPluginEngines } from "./engineHost"

type Db = { select: any; insert: any; update: any; delete: any }

let manager: RuntimeManager | null = null
let dbRef: Db | null = null

/** Best-effort, fire-and-forget: a failed log write never affects a hook. */
function persist(rec: InvocationRecord): void {
	if (!dbRef) return
	void writeInvocation(dbRef, rec).catch((e) =>
		console.error("[plugins] invocation log write failed:", e)
	)
}

/** The process-wide manager. Lazily created; safe to call before bootstrap. */
export function getManager(): RuntimeManager {
	if (!manager) manager = new RuntimeManager({ onInvocation: persist })
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
	}

	mgr.markReady()
}

/** Tear down the manager (tests / shutdown). */
export async function shutdownPlugins(): Promise<void> {
	if (manager) await manager.dispose()
	manager = null
	dbRef = null
}

export { pluginsEnabled } from "./flag"
export type { RuntimeManager } from "./RuntimeManager"
