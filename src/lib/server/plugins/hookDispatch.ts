/**
 * The plugin-runtime side of the unified hook interface.
 *
 * `makeScriptApplier` (the pipeline's one chain applier) routes a link whose
 * type is plugin-owned to a `PluginHookDispatch`; this is that port, backed by
 * the `RuntimeManager`. It does two small things and nothing else:
 *
 *  1. Resolve the registry's `ownerPluginId` (an integer, `plugins.id`) to the
 *     runtime address everything else uses — the plugin's `namespace/name`
 *     string id — and the link's script type id to the hook's export name.
 *  2. Run the hook through `manager.callHook` and translate its richer result
 *     back into the `ScriptRunResult` shape the chain fold expects.
 *
 * Nothing here decides policy: the manager owns the backend, the deadline, the
 * concurrency and the permission-checked capabilities. Resolution failures come
 * back as `{ ok: false }`, never throws, so a chain absorbs an unservable link
 * as an error application and the turn continues.
 *
 * Hook-type-id convention (the contract the packager's registry projection
 * must honour): a plugin pipeline hook is pinned as `<pluginId>:<hook>@<v>`,
 * e.g. `acme/summarizer:trimContext@1`. `pluginId` is the `namespace/name`
 * address; `hook` is the exported hook function's name. The owning plugin is
 * already known from the registry row's `ownerPluginId`, so only the hook name
 * is parsed out here.
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

/** The hook export name from a plugin type id, or null if it is not one. */
export function hookNameFromTypeId(typeId: string): string | null {
	const at = typeId.lastIndexOf("@")
	const body = at >= 0 ? typeId.slice(0, at) : typeId
	const colon = body.lastIndexOf(":")
	if (colon < 0) return null
	const hook = body.slice(colon + 1)
	// A hook name is a JS identifier; anything else (a core `content/operation`
	// segment that slipped through, say) is not a plugin hook address.
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(hook) ? hook : null
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
	const idCache = new Map<number, string | null>()
	async function runtimeIdFor(ownerPluginId: number): Promise<string | null> {
		if (idCache.has(ownerPluginId)) return idCache.get(ownerPluginId)!
		const rows = await db
			.select({ pluginId: plugins.pluginId })
			.from(plugins)
			.where(eq(plugins.id, ownerPluginId))
			.limit(1)
		const id = (rows[0]?.pluginId as string | undefined) ?? null
		idCache.set(ownerPluginId, id)
		return id
	}

	return {
		async runHook(req: PluginHookRequest): Promise<ScriptRunResult> {
			const pluginId = await runtimeIdFor(req.ownerPluginId)
			if (!pluginId) return fail("this extension is no longer installed")

			const hookName = hookNameFromTypeId(req.typeId)
			if (!hookName)
				return fail(`not a plugin hook type id: ${req.typeId}`)

			const r = await manager.callHook(
				pluginId,
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
