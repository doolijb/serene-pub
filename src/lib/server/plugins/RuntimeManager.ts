/**
 * The orchestration layer. SP Core's entire touchpoint is
 * `manager.callHook(...)`; the manager decides *which* backend runs it, keeps
 * the sandboxes warm, enforces the concurrency and lifecycle rules, exposes the
 * live registry the admin monitor reads, and emits an observability record for
 * every invocation. It is unopinionated about the backend — it only ever talks
 * to the `PluginRuntime` contract.
 *
 * Topology (from the SES-vs-QuickJS asymmetry): QuickJS is interruptible, so a
 * single shared QuickJS runtime hosts every quickjs plugin. SES can only be
 * stopped by terminating its worker, so each SES plugin gets **its own** SES
 * worker — a kill's blast radius is one extension, never all of them.
 */

import path from "node:path"
import { QuickJsRuntime } from "./QuickJsRuntime"
import { SesWorkerRuntime } from "./SesWorkerRuntime"
import type { CapabilityConfig } from "./storageHost"
import type { HookRunResult, PluginRuntime, RuntimeKind } from "./types"

/** What the manager needs to know about an installed, enabled plugin. Persisted
 * elsewhere; the manager holds the projection it dispatches against. */
export interface PluginDescriptor {
	id: string
	/** Human name — carried so logs and the monitor read well and outlive it. */
	name: string
	bundleSource: string
	bundleHash: string
	/** Backends the conformance harness certified this bundle runs on. */
	backends: RuntimeKind[]
	/** The active backend (the security/speed dial). Must be in `backends`. */
	backend: RuntimeKind
	/** Sequential-only: manifest-declared, or admin-forced. Concurrent otherwise. */
	sequential: boolean
	/**
	 * The scoped-storage grant, if the plugin's manifest declares one — the
	 * quota in bytes. Absent = storage denied. The manager derives the private
	 * directory (`<dataDir>/extensions_data/<id>`) and passes both to the
	 * runtime at load; the plugin never sees the path.
	 */
	storageQuotaBytes?: number
	/** The mediated-network grant: allowed fetch hosts. Absent = network denied. */
	networkHosts?: string[]
}

export interface CallOptions {
	timeoutMs: number
	/** Deterministic RNG seed; defaults to a stable per-call label. */
	seedLabel?: string
	/** What `ctx.now()` answers; defaults to the wall clock at dispatch. */
	nowMs?: number
	maxOutputBytes?: number
	/** Who triggered this (a user/session), for the log and the live monitor. */
	user?: string
	/** The pipeline run this hook fired within, if any — the log's soft link. */
	runId?: string
	/**
	 * A lifecycle (startup/install) hook. These run sequentially and bypass the
	 * ready-gate — they *are* startup. Everything else queues until ready.
	 */
	lifecycle?: boolean
}

/** One in-flight call, as the admin monitor sees it. */
export interface ActiveCall {
	callId: number
	pluginId: string
	pluginName: string
	hookName: string
	backend: RuntimeKind
	user?: string
	lifecycle: boolean
	startedAt: number
}

/** The observability record emitted for every completed invocation. Identity is
 * denormalized (name + hash) so the row stays meaningful after uninstall. */
export interface InvocationRecord {
	callId: number
	pluginId: string
	pluginName: string
	bundleHash: string
	hookName: string
	backend: RuntimeKind
	mode: "concurrent" | "sequential" | "lifecycle"
	user?: string
	runId?: string
	queuedAt: number
	startedAt: number
	finishedAt: number
	durationMs: number
	ok: boolean
	outcome: "ok" | "error" | "timeout" | "killed" | "load" | "missing"
	reason?: string
}

export class RuntimeManager {
	private readonly quickjs = new QuickJsRuntime()
	private readonly sesWorkers = new Map<string, SesWorkerRuntime>()
	private readonly descriptors = new Map<string, PluginDescriptor>()
	/** Per-plugin sequential chain tail — present only while a plugin runs sequentially. */
	private readonly queues = new Map<string, Promise<unknown>>()
	private readonly active = new Map<number, ActiveCall>()
	private callSeq = 0

	private ready = false
	private readyResolvers: (() => void)[] = []

	private readonly onInvocation?: (rec: InvocationRecord) => void
	/** Root under which each plugin's `extensions_data/<id>` dir lives. */
	private readonly dataDir?: string

	constructor(
		opts: {
			onInvocation?: (rec: InvocationRecord) => void
			dataDir?: string
		} = {}
	) {
		this.onInvocation = opts.onInvocation
		this.dataDir = opts.dataDir ?? process.env.SERENE_PUB_DATA_DIR
	}

	/** The capability grants for a plugin, or undefined when it has none. */
	private capabilityConfig(desc: PluginDescriptor): CapabilityConfig | undefined {
		const hasStorage = !!desc.storageQuotaBytes && !!this.dataDir
		const hasNetwork = !!desc.networkHosts && desc.networkHosts.length > 0
		if (!hasStorage && !hasNetwork) return undefined
		const config: CapabilityConfig = {}
		if (hasStorage) {
			const safe = desc.id.replace(/[^a-zA-Z0-9_.-]/g, "_")
			config.storageDir = path.join(this.dataDir!, "extensions_data", safe)
			config.quotaBytes = desc.storageQuotaBytes
		}
		if (hasNetwork) config.networkHosts = desc.networkHosts
		return config
	}

	/* ── registration / the dial ─────────────────────────────────────────── */

	register(desc: PluginDescriptor): void {
		if (!desc.backends.includes(desc.backend))
			throw new Error(
				`plugin '${desc.id}' set to backend '${desc.backend}' it does not support`
			)
		this.descriptors.set(desc.id, { ...desc })
	}

	unregister(pluginId: string): void {
		this.descriptors.delete(pluginId)
		this.queues.delete(pluginId)
		this.quickjs.unload(pluginId)
		const w = this.sesWorkers.get(pluginId)
		if (w) {
			void w.dispose()
			this.sesWorkers.delete(pluginId)
		}
	}

	/** Flip the security/speed dial. The plugin must support the target backend. */
	setBackend(pluginId: string, backend: RuntimeKind): void {
		const desc = this.descriptors.get(pluginId)
		if (!desc) throw new Error(`plugin '${pluginId}' is not registered`)
		if (!desc.backends.includes(backend))
			throw new Error(
				`plugin '${pluginId}' does not support backend '${backend}'`
			)
		if (desc.backend === backend) return
		// Drop the old runtime's copy; the new backend loads lazily on next call.
		this.runtimeFor(desc).unload(pluginId)
		if (desc.backend === "ses") {
			const w = this.sesWorkers.get(pluginId)
			if (w) {
				void w.dispose()
				this.sesWorkers.delete(pluginId)
			}
		}
		desc.backend = backend
	}

	/** Admin-force (or clear) sequential-only execution for a plugin. */
	setSequential(pluginId: string, sequential: boolean): void {
		const desc = this.descriptors.get(pluginId)
		if (!desc) throw new Error(`plugin '${pluginId}' is not registered`)
		desc.sequential = sequential
	}

	/* ── the startup ready-gate ──────────────────────────────────────────── */

	/**
	 * Whether startup has completed and non-lifecycle hooks may run without
	 * queueing. The pipeline reads this to decide whether to route plugin links
	 * at all — a turn that fires mid-boot runs as if extensions were absent
	 * rather than stalling on the ready-gate.
	 */
	isReady(): boolean {
		return this.ready
	}

	/** Called once, after all core startup tasks complete. Drains queued calls. */
	markReady(): void {
		if (this.ready) return
		this.ready = true
		const rs = this.readyResolvers
		this.readyResolvers = []
		for (const r of rs) r()
	}

	private whenReady(): Promise<void> {
		if (this.ready) return Promise.resolve()
		return new Promise((res) => this.readyResolvers.push(res))
	}

	/* ── dispatch ────────────────────────────────────────────────────────── */

	async callHook(
		pluginId: string,
		hookName: string,
		input: Record<string, unknown>,
		opts: CallOptions
	): Promise<HookRunResult> {
		const desc = this.descriptors.get(pluginId)
		const queuedAt = Date.now()
		if (!desc)
			return this.miss(pluginId, "unknown", hookName, opts, queuedAt)

		// Non-lifecycle calls wait until startup completes; lifecycle calls are
		// startup and proceed immediately.
		if (!opts.lifecycle) await this.whenReady()

		const run = () => this.dispatch(desc, hookName, input, opts, queuedAt)

		// Concurrency: concurrent by default; a sequential plugin chains its
		// calls one at a time. Lifecycle hooks always run sequentially.
		if (desc.sequential || opts.lifecycle) return this.sequential(desc.id, run)
		return run()
	}

	/** Snapshot of everything running right now — for the admin monitor. */
	activeInvocations(): ActiveCall[] {
		return [...this.active.values()].sort((a, b) => a.startedAt - b.startedAt)
	}

	/**
	 * Manually terminate one in-flight call (admin kill). For SES this
	 * terminates that plugin's worker; for QuickJS it disposes the shared
	 * runtime (every quickjs call in flight is killed — the cost of the shared
	 * worker, mitigated by QuickJS's cheap respawn).
	 */
	async killCall(callId: number): Promise<boolean> {
		const call = this.active.get(callId)
		if (!call) return false
		const desc = this.descriptors.get(call.pluginId)
		if (!desc) return false
		await this.runtimeFor(desc).dispose()
		if (desc.backend === "ses") this.sesWorkers.delete(call.pluginId)
		return true
	}

	async dispose(): Promise<void> {
		await this.quickjs.dispose()
		for (const w of this.sesWorkers.values()) await w.dispose()
		this.sesWorkers.clear()
		this.descriptors.clear()
		this.active.clear()
	}

	/* ── internals ──────────────────────────────────────────────────────── */

	private runtimeFor(desc: PluginDescriptor): PluginRuntime {
		if (desc.backend === "ses") {
			let w = this.sesWorkers.get(desc.id)
			if (!w) {
				w = new SesWorkerRuntime()
				this.sesWorkers.set(desc.id, w)
			}
			return w
		}
		return this.quickjs
	}

	private sequential<T>(pluginId: string, fn: () => Promise<T>): Promise<T> {
		const prev = this.queues.get(pluginId) ?? Promise.resolve()
		const next = prev.then(fn, fn)
		// Keep the chain alive even if a call rejects; the tail must not poison.
		this.queues.set(
			pluginId,
			next.then(
				() => undefined,
				() => undefined
			)
		)
		return next
	}

	private async dispatch(
		desc: PluginDescriptor,
		hookName: string,
		input: Record<string, unknown>,
		opts: CallOptions,
		queuedAt: number
	): Promise<HookRunResult> {
		const callId = ++this.callSeq
		const rt = this.runtimeFor(desc)
		const backend = desc.backend
		const mode: InvocationRecord["mode"] = opts.lifecycle
			? "lifecycle"
			: desc.sequential
				? "sequential"
				: "concurrent"

		if (!rt.has(desc.id)) {
			try {
				await rt.load(
					desc.id,
					desc.bundleSource,
					desc.bundleHash,
					this.capabilityConfig(desc)
				)
			} catch (e) {
				return this.record(
					{
						ok: false,
						reason: `failed to load bundle: ${String((e as Error)?.message || e)}`,
						logs: [],
						durationMs: Date.now() - queuedAt,
						backend,
						outcome: "load"
					},
					desc,
					hookName,
					opts,
					callId,
					mode,
					queuedAt,
					queuedAt
				)
			}
		}

		const startedAt = Date.now()
		const active: ActiveCall = {
			callId,
			pluginId: desc.id,
			pluginName: desc.name,
			hookName,
			backend,
			user: opts.user,
			lifecycle: !!opts.lifecycle,
			startedAt
		}
		this.active.set(callId, active)

		let result: HookRunResult
		try {
			result = await rt.invoke(
				{ pluginId: desc.id, hookName },
				{
					input,
					timeoutMs: opts.timeoutMs,
					seedLabel:
						opts.seedLabel ?? `${desc.id}:${hookName}:${callId}`,
					nowMs: opts.nowMs ?? startedAt,
					maxOutputBytes: opts.maxOutputBytes
				}
			)
		} finally {
			this.active.delete(callId)
		}

		return this.record(result, desc, hookName, opts, callId, mode, queuedAt, startedAt)
	}

	private record(
		result: HookRunResult,
		desc: PluginDescriptor,
		hookName: string,
		opts: CallOptions,
		callId: number,
		mode: InvocationRecord["mode"],
		queuedAt: number,
		startedAt: number
	): HookRunResult {
		const finishedAt = Date.now()
		this.onInvocation?.({
			callId,
			pluginId: desc.id,
			pluginName: desc.name,
			bundleHash: desc.bundleHash,
			hookName,
			backend: result.backend,
			mode,
			user: opts.user,
			runId: opts.runId,
			queuedAt,
			startedAt,
			finishedAt,
			durationMs: result.durationMs,
			ok: result.ok,
			outcome: result.ok ? "ok" : result.outcome,
			reason: result.ok ? undefined : result.reason
		})
		return result
	}

	private miss(
		pluginId: string,
		pluginName: string,
		hookName: string,
		opts: CallOptions,
		queuedAt: number
	): HookRunResult {
		const result: HookRunResult = {
			ok: false,
			reason: `plugin '${pluginId}' is not registered`,
			logs: [],
			durationMs: 0,
			backend: "quickjs",
			outcome: "missing"
		}
		this.onInvocation?.({
			callId: ++this.callSeq,
			pluginId,
			pluginName,
			bundleHash: "",
			hookName,
			backend: "quickjs",
			mode: opts.lifecycle ? "lifecycle" : "concurrent",
			user: opts.user,
			runId: opts.runId,
			queuedAt,
			startedAt: queuedAt,
			finishedAt: queuedAt,
			durationMs: 0,
			ok: false,
			outcome: "missing",
			reason: result.reason
		})
		return result
	}
}
