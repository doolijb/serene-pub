/**
 * The host half of a plugin's lifecycle callbacks (SDK `LifecycleMoment`).
 *
 * Ruled 2026-09-26: every moment a plugin may declare is one the host calls.
 * Boot calls `startup` (index.ts). This module calls the rest:
 *
 * - **enable** — after a plugin is switched on and registered.
 * - **disable** — before it is switched off, while it is still registered.
 * - **update** — once, on a replaced bundle's first run (its first enable, or
 *   the boot after one), sent `{ previousVersion, version }`. The old version
 *   waits in `plugins.update_from_version` because a changed bundle arrives
 *   disabled, so nothing of it may run at install.
 * - **uninstall** — before the plugin's rows and files are removed.
 * - **shutdown** — from the `plugins` managed service, during graceful shutdown.
 *
 * Every call is a lifecycle call: the lifecycle grants, the lifecycle timeout,
 * recorded in the invocation log like `startup`. And every call is **bounded
 * twice**: the sandbox kills a hook at `timeoutMs`, and an outer race gives up
 * waiting at `boundMs` — the case the sandbox deadline cannot cover is a
 * lifecycle call queued behind a sequential plugin's in-flight hook. Nothing
 * here throws: a failed, slow or absent callback is logged and returned as an
 * outcome, and the switch, the removal or the exit it preceded goes ahead.
 */

import { eq } from "drizzle-orm"
import type { LifecycleMoment, LifecycleUpdateInput } from "@serene-pub/sdk"
import { plugins } from "$lib/server/db/schema"
import type { SandboxManager } from "./SandboxManager"
import type { HookRunFailure } from "./types"

/** The moments this module fires. `load` and `startup` belong to boot. */
export type HostFiredMoment = Exclude<LifecycleMoment, "load">

/**
 * The bounds, as one mutable object so a test can shorten them. `timeoutMs`
 * matches boot's `startup` call; shutdown gets less, because the managed
 * services share one 10 s deadline and the database still has to close.
 */
export const LIFECYCLE_BOUNDS = {
	timeoutMs: 5_000,
	boundMs: 6_000,
	shutdownTimeoutMs: 2_000,
	shutdownBoundMs: 3_000
}

export interface LifecycleFiring {
	pluginId: string
	moment: HostFiredMoment
	/**
	 * The hook's outcome; `missing` when the plugin declared no callback for
	 * this moment (not an error), `bounded` when the outer wait gave up, and
	 * `skipped` when the plugin is not registered, so nothing ran.
	 */
	outcome: "ok" | HookRunFailure["outcome"] | "bounded" | "skipped"
	reason?: string
}

/**
 * Call one plugin's callback for one moment. Never throws, never waits past
 * `boundMs`. A plugin the manager does not hold is skipped without a log row:
 * a disabled plugin's code does not run, lifecycle or not.
 */
export async function fireLifecycle(
	mgr: SandboxManager,
	pluginId: string,
	moment: HostFiredMoment,
	input: Record<string, unknown> = {},
	bounds: { timeoutMs?: number; boundMs?: number } = {}
): Promise<LifecycleFiring> {
	if (!mgr.isRegistered(pluginId))
		return { pluginId, moment, outcome: "skipped" }
	const timeoutMs = bounds.timeoutMs ?? LIFECYCLE_BOUNDS.timeoutMs
	const boundMs = bounds.boundMs ?? LIFECYCLE_BOUNDS.boundMs
	let timer: ReturnType<typeof setTimeout> | undefined
	let firing: LifecycleFiring
	try {
		const bounded = new Promise<"bounded">((resolve) => {
			timer = setTimeout(() => resolve("bounded"), boundMs)
		})
		const r = await Promise.race([
			mgr.callHook(pluginId, moment, input, {
				kind: "lifecycle",
				timeoutMs,
				lifecycle: true
			}),
			bounded
		])
		firing =
			r === "bounded"
				? {
						pluginId,
						moment,
						outcome: "bounded",
						reason: `no answer within ${boundMs} ms — not waited for`
					}
				: r.ok
					? { pluginId, moment, outcome: "ok" }
					: { pluginId, moment, outcome: r.outcome, reason: r.reason }
	} catch (e) {
		firing = { pluginId, moment, outcome: "error", reason: String(e) }
	} finally {
		if (timer) clearTimeout(timer)
	}
	if (firing.outcome !== "ok" && firing.outcome !== "missing")
		console.warn(
			`[plugins] '${pluginId}' ${moment} callback failed (${firing.outcome}): ${firing.reason}`
		)
	return firing
}

/**
 * Fire a replaced bundle's pending `update`, once. The pending version is
 * cleared whatever the callback answered — "exactly once" is the promise, and
 * a callback that failed is not owed a second run on every enable.
 */
export async function firePendingUpdate(
	db: Db,
	mgr: SandboxManager,
	pluginId: string
): Promise<LifecycleFiring | null> {
	if (!mgr.isRegistered(pluginId)) return null
	const [row] = await db
		.select({
			version: plugins.version,
			updateFromVersion: plugins.updateFromVersion
		})
		.from(plugins)
		.where(eq(plugins.pluginId, pluginId))
	if (!row || row.updateFromVersion == null) return null
	await db
		.update(plugins)
		.set({ updateFromVersion: null })
		.where(eq(plugins.pluginId, pluginId))
	const input: LifecycleUpdateInput = {
		previousVersion: row.updateFromVersion,
		version: row.version
	}
	return fireLifecycle(mgr, pluginId, "update", { ...input })
}

/**
 * A plugin was just switched on and registered: its pending `update` first
 * (the new bundle migrates before it goes live), then `enable`.
 */
export async function afterEnable(
	db: Db,
	mgr: SandboxManager,
	pluginId: string
): Promise<LifecycleFiring[]> {
	const out: LifecycleFiring[] = []
	try {
		const update = await firePendingUpdate(db, mgr, pluginId)
		if (update) out.push(update)
	} catch (e) {
		console.warn(`[plugins] '${pluginId}' pending update failed:`, e)
	}
	out.push(await fireLifecycle(mgr, pluginId, "enable"))
	return out
}

/**
 * The graceful-shutdown half: every registered plugin's `shutdown`, in
 * parallel — they share no state, and in series one slow plugin would spend
 * every other plugin's window — under one overall bound.
 */
export async function fireShutdown(
	mgr: SandboxManager
): Promise<LifecycleFiring[]> {
	const ids = mgr.registeredIds()
	if (!ids.length) return []
	const { shutdownTimeoutMs, shutdownBoundMs } = LIFECYCLE_BOUNDS
	return Promise.all(
		ids.map((id) =>
			fireLifecycle(
				mgr,
				id,
				"shutdown",
				{},
				{ timeoutMs: shutdownTimeoutMs, boundMs: shutdownBoundMs }
			)
		)
	)
}
