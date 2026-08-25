/**
 * The backend-agnostic runtime contract.
 *
 * SP Core only ever talks to a `PluginRuntime`. Two implementations satisfy it
 * — `QuickJsRuntime` (quickjs-ng compiled to WASM, the secure default) and
 * `SesWorkerRuntime` (a SES-hardened worker, the faster fallback) — and they
 * differ only in *transport*, never in behaviour a hook can observe. Nothing
 * here names a backend to the plugin: a hook cannot tell which one is running
 * it, which is what makes the security/speed dial safe to flip.
 */

import type { CapabilityConfig } from "./storageHost"

/** Which sandbox a runtime is. Internal — never surfaced to a hook. */
export type RuntimeKind = "quickjs" | "ses"

/** A hook is addressed by its plugin and its declared name. */
export interface HookRef {
	pluginId: string
	hookName: string
}

/** Hook input and output are JSON-serializable — the marshalable contract
 * both backends share (a hook receives a value and returns a value). */
export type Json =
	| null
	| boolean
	| number
	| string
	| Json[]
	| { [key: string]: Json }

export interface InvokeOptions {
	/** The declared-variable bindings + free context handed to the hook. */
	input: Record<string, unknown>
	/** Wall-clock budget for this single call. The runtime enforces it. */
	timeoutMs: number
	/**
	 * Seed label for the call's deterministic RNG (`Math.random`/`ctx.random`)
	 * — a roll is a pure function of this label on either backend, mirroring
	 * the Scripts sandbox so behaviour is identical and replayable.
	 */
	seedLabel: string
	/** What `Date.now()` answers inside the sandbox — the run's recorded start. */
	nowMs: number
	/** Ceiling on the serialized return; a hook rewrites a value, never balloons one. */
	maxOutputBytes?: number
}

export interface HookRunSuccess {
	ok: true
	/** `undefined` when the hook returned nothing — passthrough. */
	value: unknown
	logs: string[]
	durationMs: number
	backend: RuntimeKind
}

export interface HookRunFailure {
	ok: false
	reason: string
	logs: string[]
	durationMs: number
	backend: RuntimeKind
	/**
	 * Why it failed — the observability log records this verbatim.
	 *  - `error`   a throw inside the hook
	 *  - `timeout` the inner deadline fired (the interpreter stopped it)
	 *  - `killed`  the outer wall-clock backstop terminated the runtime
	 *  - `load`    the plugin bundle could not be evaluated
	 *  - `missing` no such plugin / hook is loaded
	 */
	outcome: "error" | "timeout" | "killed" | "load" | "missing"
}

export type HookRunResult = HookRunSuccess | HookRunFailure

/**
 * One sandbox instance. It can hold one or more plugins (the manager decides
 * the topology — a shared QuickJS worker, or one SES worker per extension) and
 * invoke their hooks under a per-call deadline. Every method is transport over
 * the same behavioural contract.
 */
export interface PluginRuntime {
	readonly kind: RuntimeKind

	/**
	 * Evaluate a plugin's bundle into this runtime so its hooks can be called.
	 * Idempotent per `pluginId` + `bundleHash`: re-loading the same bytes is a
	 * no-op; loading different bytes replaces the prior load. A load failure
	 * throws (the caller records it) and leaves no partial state.
	 */
	load(
		pluginId: string,
		bundleSource: string,
		bundleHash: string,
		/** The plugin's scoped storage grant, if any — omit to deny storage. */
		config?: CapabilityConfig
	): Promise<void>

	/** Whether `pluginId` (at any bundle) is currently loaded. */
	has(pluginId: string): boolean

	/** Invoke a hook. Resolves with success or a typed failure — it never
	 * rejects for a hook-level fault (throw/timeout/kill); it only rejects on
	 * a genuine host/runtime bug the caller should surface loudly. */
	invoke(hook: HookRef, opts: InvokeOptions): Promise<HookRunResult>

	/** Drop a plugin's loaded state and free its context. */
	unload(pluginId: string): void

	/** Terminate the sandbox and release every resource. Idempotent. */
	dispose(): Promise<void>
}
