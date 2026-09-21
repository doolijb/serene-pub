/**
 * The backend-agnostic sandbox contract.
 *
 * SP Core only ever talks to a `PluginSandbox`. Two implementations satisfy it
 * — `QuickJsSandbox` (quickjs-ng compiled to WASM, the secure default) and
 * `SesWorkerSandbox` (a SES-hardened worker, the faster fallback) — and they
 * differ only in *transport*, never in behaviour a hook can observe. Nothing
 * here names a backend to the plugin: a hook cannot tell which one is running
 * it, which is what makes the security/speed dial safe to flip.
 */

import type {
	PermissionConfig,
	PluginRowChange,
	PluginRowSnapshotEntry
} from "./storageHost"
import type { HookCtxKind } from "./hookCtx"

/** Which sandbox this is. Internal — never surfaced to a hook. */
export type SandboxKind = "quickjs" | "ses"

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
	/**
	 * What kind of hook this is, which decides what its `ctx` carries
	 * (`hookCtx.ts`, plans/29 R-3): a task or chain link gets neither
	 * `storage` nor `fetch`, an oracle gets both, the rest get `storage`.
	 * Required — the sandbox throws on a call that names none, because a
	 * default in either direction is a grant nobody decided.
	 */
	kind: HookCtxKind
	/** The declared-variable bindings + free context handed to the hook. */
	input: Record<string, unknown>
	/** Wall-clock budget for this single call. The sandbox enforces it. */
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
	/**
	 * The caller's handle for this call — the address `abort` and `kill` use.
	 * Omit it and the call runs exactly as before; it simply cannot be stopped
	 * individually (the conformance probe and other one-shots don't need to be).
	 */
	jobId?: string
	/**
	 * This plugin's rows, as the host read them for this call.
	 *
	 * A sandbox is a *transport*: it carries the snapshot in and the diff back
	 * out, and never touches a database. It has to be this way round — the
	 * sandbox runs in a worker with no database handle, and QuickJS (the
	 * default backend) has no asynchronous capability bridge to reach one, so a
	 * row store the guest called across the boundary would work on SES and
	 * throw on the backend most plugins actually run on. See `storageHost.ts`.
	 *
	 * Absent when the plugin has no storage grant, or when the caller keeps no
	 * rows (the conformance probe, most tests) — the store then starts empty
	 * and behaves exactly as it would for a plugin with none.
	 */
	rows?: PluginRowSnapshotEntry[]
}

export interface HookRunSuccess {
	ok: true
	/** `undefined` when the hook returned nothing — passthrough. */
	value: unknown
	logs: string[]
	durationMs: number
	backend: SandboxKind
	/**
	 * What the hook decided about its rows: one collapsed op per key it
	 * touched, for the caller to commit.
	 *
	 * Present **only** on a call that returned *and* whose file transaction
	 * committed — the two are decided together inside the sandbox, so a hook
	 * that was killed, timed out or threw carries nothing here and there is
	 * nothing for a caller to accidentally apply. `SandboxManager` consumes it
	 * and strips it; no caller above the manager ever sees it.
	 */
	rowChanges?: PluginRowChange[]
}

export interface HookRunFailure {
	ok: false
	reason: string
	logs: string[]
	durationMs: number
	backend: SandboxKind
	/**
	 * Why it failed — the observability log records this verbatim.
	 *  - `error`   a throw inside the hook
	 *  - `timeout` the inner deadline fired (the interpreter stopped it)
	 *  - `killed`  something stopped this call from outside — a `kill`, or the
	 *              outer wall-clock backstop terminating a wedged worker
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
export interface PluginSandbox {
	readonly kind: SandboxKind

	/**
	 * Evaluate a plugin's bundle into this sandbox so its hooks can be called.
	 * Idempotent per `pluginId` + `bundleHash`: re-loading the same bytes is a
	 * no-op; loading different bytes replaces the prior load. A load failure
	 * throws (the caller records it) and leaves no partial state.
	 */
	load(
		pluginId: string,
		bundleSource: string,
		bundleHash: string,
		/** The plugin's scoped storage grant, if any — omit to deny storage. */
		config?: PermissionConfig
	): Promise<void>

	/** Whether `pluginId` (at any bundle) is currently loaded. */
	has(pluginId: string): boolean

	/** Invoke a hook. Resolves with success or a typed failure — it never
	 * rejects for a hook-level fault (throw/timeout/kill); it only rejects on
	 * a genuine host/sandbox bug the caller should surface loudly. */
	invoke(hook: HookRef, opts: InvokeOptions): Promise<HookRunResult>

	/**
	 * Cooperative stop for **one** in-flight job: fire the `AbortSignal` that
	 * job's `ctx.signal` carries. Per-job on both backends.
	 *
	 * This asks; it does not stop. The signal is constructed inside the sandbox
	 * and can only fire while the hook is suspended at an `await`, so a hook that
	 * is synchronous, spinning, or awaiting only already-resolved promises never
	 * observes it — and from out here those are one failure mode, not three: it
	 * did not return in time, so `kill` is what comes next. A hook that *does*
	 * wake winds down in its own frame — its transaction, temp files and locals
	 * all still in scope — and returns normally; a returning hook is just a
	 * returning hook, and the result is an ordinary success.
	 *
	 * Returns whether there was a job in flight under that handle to signal —
	 * never whether the hook acted on it, which is observable only as the hook
	 * returning in time.
	 */
	abort(jobId: string): boolean

	/**
	 * Forced stop for one in-flight job: it settles as `killed` and the caller
	 * stops waiting. Nothing here gives the hook a chance to wind down — a
	 * caller that wants it to have one calls `abort`, waits, and only then
	 * `kill`s. That grace policy belongs to the dispatcher, not here — it is
	 * `hookGrace.ts`, reached through `SandboxManager.stopRun`.
	 *
	 * **This is the one place the two backends are not equivalent, and a caller
	 * has to know it.**
	 *  - QuickJS is interruptible between VM instructions, so the kill lands on
	 *    that one call: every other job on the shared sandbox keeps running, and
	 *    the guest cannot catch the interrupt to survive it.
	 *  - SES runs on real V8, which offers no interrupt point below the thread,
	 *    so the only forced stop is terminating the worker. It posts the
	 *    cooperative abort first — a courtesy that reaches only a hook already
	 *    parked at an await, and that nothing waits on. A SES worker hosts a
	 *    single plugin, so the blast radius is that plugin's *other* in-flight
	 *    calls: they settle as `killed` too, naming this one as the cause. The
	 *    worker is rebuilt, and the plugin re-stored into it, on the next call.
	 * So: never assume SES forced-kill is per-job. It is per-worker by nature,
	 * and only the cooperative `abort` above is per-job on both sides.
	 *
	 * Returns whether there was a job in flight under that handle to stop.
	 */
	kill(jobId: string): Promise<boolean>

	/** Drop a plugin's loaded state and free its context. */
	unload(pluginId: string): void

	/** Terminate the sandbox and release every resource. Idempotent. */
	dispose(): Promise<void>
}
