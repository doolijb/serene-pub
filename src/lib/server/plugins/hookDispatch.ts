/**
 * The plugin-runtime side of the unified hook interface.
 *
 * `makeScriptApplier` (the pipeline's one chain applier) routes a link whose
 * type is plugin-owned to a `PluginHookDispatch`; this is that port, backed by
 * the `RuntimeManager`. It does two small things and nothing else:
 *
 *  1. Resolve the registry's `ownerPluginId` (an integer, `plugins.id`) to the
 *     runtime address everything else uses — the plugin's `namespace/name`
 *     string id — and the link's script type id to the hook's exported name.
 *  2. Run the hook through `manager.callHook` and translate its richer result
 *     back into the `ScriptRunResult` shape the chain fold expects.
 *
 * Nothing here decides policy: the manager owns the backend, the deadline, the
 * concurrency and the permission-checked capabilities. Resolution failures come
 * back as `{ ok: false }`, never throws, so a chain absorbs an unservable link
 * as an error application and the turn continues.
 *
 * **Why the hook name is looked up, not parsed.** A script type id follows the
 * fixed grammar `<namespace>:script:<content>/<operation>@<major>` — the last
 * segment is a *content contract* (`transform`, `filter`), shared across every
 * hook of that shape, never a function name. So the type id cannot say which of
 * a plugin's exported hooks implements a given link. That binding lives in the
 * compiled manifest as `hookTypes: { [scriptTypeId]: exportedHookName }`, which
 * the packager's registry projection writes when it lands a plugin's types. The
 * port reads it from the stored manifest — the one source of truth — rather
 * than guessing a convention that a settling manifest shape could contradict.
 */

import { eq } from "drizzle-orm"
import { plugins } from "$lib/server/db/schema"
import type { RuntimeManager } from "./RuntimeManager"
import type {
	PluginHookDispatch,
	PluginHookRequest
} from "$lib/server/pipelines/scripts/pluginDispatch"
import type { ScriptRunResult } from "$lib/server/pipelines/scripts/host"

type Db = { select: any }

/** What the port needs from an installed plugin, resolved once per owner. */
interface OwnerResolution {
	/** The runtime address — `namespace/name`. */
	pluginId: string
	/** `scriptTypeId → exported hook name`, from the compiled manifest. */
	hookTypes: Record<string, string>
}

/** Read `hookTypes` off a stored manifest, tolerant of its json being anything. */
export function hookTypesOf(manifest: unknown): Record<string, string> {
	const raw =
		manifest && typeof manifest === "object"
			? (manifest as any).hookTypes
			: undefined
	if (!raw || typeof raw !== "object") return {}
	const out: Record<string, string> = {}
	for (const [typeId, hook] of Object.entries(raw as Record<string, unknown>))
		if (typeof hook === "string" && hook) out[typeId] = hook
	return out
}

const fail = (reason: string): ScriptRunResult => ({
	ok: false,
	reason,
	logs: [],
	durationMs: 0
})

export function makePluginHookDispatch(
	db: Db,
	manager: RuntimeManager
): PluginHookDispatch {
	// One resolution per owner for the life of the applier (one run). A plugin
	// enabled or removed mid-run is not observed — the chain a run applies is
	// the one resolved when it started, matching the script-row cache.
	const cache = new Map<number, OwnerResolution | null>()
	async function resolveOwner(
		ownerPluginId: number
	): Promise<OwnerResolution | null> {
		if (cache.has(ownerPluginId)) return cache.get(ownerPluginId)!
		const rows = await db
			.select({ pluginId: plugins.pluginId, manifest: plugins.manifest })
			.from(plugins)
			.where(eq(plugins.id, ownerPluginId))
			.limit(1)
		const row = rows[0]
		const resolution: OwnerResolution | null = row?.pluginId
			? {
					pluginId: row.pluginId as string,
					hookTypes: hookTypesOf(row.manifest)
				}
			: null
		cache.set(ownerPluginId, resolution)
		return resolution
	}

	return {
		async runHook(req: PluginHookRequest): Promise<ScriptRunResult> {
			const owner = await resolveOwner(req.ownerPluginId)
			if (!owner) return fail("this extension is no longer installed")

			const hookName = owner.hookTypes[req.typeId]
			if (!hookName)
				return fail(
					`the extension declares no hook for ${req.typeId}`
				)

			const r = await manager.callHook(
				owner.pluginId,
				hookName,
				{ value: req.value, extras: req.extras },
				{
					timeoutMs: req.timeoutMs ?? 250,
					seedLabel: req.seedLabel,
					nowMs: req.nowMs,
					maxOutputBytes: req.maxOutputBytes,
					runId: req.runId,
					user: req.user,
					lifecycle: false
				}
			)

			// HookRunResult → ScriptRunResult: the chain fold only ever reads the
			// shared core (ok / value / logs / durationMs). `backend` and the
			// typed `outcome` are the runtime's own observability, already logged
			// by the manager; the pipeline neither needs nor learns them.
			return r.ok
				? {
						ok: true,
						value: r.value,
						logs: r.logs,
						durationMs: r.durationMs
					}
				: {
						ok: false,
						reason: r.reason,
						logs: r.logs,
						durationMs: r.durationMs
					}
		}
	}
}
