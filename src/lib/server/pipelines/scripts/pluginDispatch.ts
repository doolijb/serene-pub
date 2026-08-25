/**
 * The seam between core's Scripts sandbox and the extension plugin runtime.
 *
 * A chain link is addressed the same way whoever owns it — a `pipeline_scripts`
 * row pinning a script type. When that type is core's own (`transport: 'node'`)
 * the applier runs the row's source through `runScriptSource`; when it belongs
 * to a plugin (`transport: 'process'`) the applier hands the link to *this*
 * port instead, which runs the extension's hook out-of-process. Both return the
 * one `ScriptRunResult` shape, so the chain's fold law — transform / verdict /
 * inject, earliest-index-wins — is applied identically regardless of which
 * executor produced the value. That shared law *is* the single dispatch
 * interface the design calls for: core and extension hooks are indistinguishable
 * to the pipeline once the port has answered.
 *
 * The port is an interface here, in the scripts layer, and implemented in
 * `$lib/server/plugins`. The direction matters: the scripts layer never imports
 * the plugin runtime — the runtime is injected as this capability, absent when
 * plugins are disabled, so the whole subsystem stays dark behind its flag
 * without the pipeline knowing it exists.
 */

import type { ScriptRunResult } from "./host"

/** One extension-hook link, resolved from a chain and routed here by transport. */
export interface PluginHookRequest {
	/** The type's owning plugin (`plugins.id`), from the registry row. */
	ownerPluginId: number
	/** The pinned script type id the link addresses (`namespace/name:hook@1`). */
	typeId: string
	/** The subject value flowing through the hook — the chain's current value. */
	value: unknown
	/** Declared read-only context (speaker/cast names), gated to what the link reads. */
	extras: Record<string, unknown>
	/** Per-link deterministic RNG label — the same address form core scripts use. */
	seedLabel: string
	/** What `ctx.now()` answers — the run's pinned clock. */
	nowMs: number
	timeoutMs?: number
	maxOutputBytes?: number
	/** The pipeline run this link fired within — the invocation log's soft link. */
	runId?: string
	/** Who triggered the run, for the log and the account-visibility view. */
	user?: string
}

export interface PluginHookDispatch {
	/**
	 * Run one extension hook and return its result in the Scripts sandbox shape.
	 * Resolution failures (plugin not loaded, hook missing) come back as
	 * `{ ok: false }` rather than throwing, so a link the runtime cannot serve
	 * is absorbed as an error application exactly like a core script that threw
	 * — a chain never breaks a turn.
	 */
	runHook(req: PluginHookRequest): Promise<ScriptRunResult>
}
