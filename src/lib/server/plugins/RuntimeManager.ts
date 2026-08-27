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
	/**
	 * The manifest-declared settings, resolved for the owning hook — secrets
	 * already plaintext (settingsHost.ts, 13 §6). Present only when the
	 * manifest declares a schema; merged into every hook's input as the
	 * reserved `settings` key at dispatch, so an admin's edit reaches the
	 * next call through re-registration and never a call in flight.
	 */
	settings?: Record<string, unknown>
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

/**
 * The single path segment a plugin id becomes under `extensions_data`. The
 * char filter alone is not enough — it keeps `.`, so an id of `..` or `.` (or an
 * empty id) would resolve *up* to the shared parent and widen the jail to every
 * plugin's data. Leading dots and the empty case collapse to `_`, and since
 * every path separator is already filtered out the result is always one inert
 * segment. Exported so the jail invariant is unit-tested directly.
 */
export function storageSegment(id: string): string {
	return id.replace(/[^a-zA-Z0-9_.-]/g, "_").replace(/^\.+/, "_") || "_"
}

export class RuntimeManager {
	private readonly quickjs = new QuickJsRuntime()
	private readonly sesWorkers = new Map<string, SesWorkerRuntime>()
	private readonly descriptors = new Map<string, PluginDescriptor>()
	/**
	 * What each runtime actually holds: the descriptor a plugin's loaded copy
	 * was built from. The single source of truth for "what is loaded" — every
	 * staleness test, host lookup and teardown reads it, so there is one place
	 * that can be wrong rather than five that can disagree.
	 */
	private readonly loaded = new Map<string, PluginDescriptor>()
	/** Calls in flight per plugin; absent means quiescent — nothing is touching it. */
	private readonly inFlight = new Map<string, number>()
	/** Plugins that went stale while busy; swapped the moment they drain. */
	private readonly staleWhileBusy = new Set<string>()
	/** Admin unloads requested while busy; released cold the moment they drain. */
	private readonly unloadWhenIdle = new Set<string>()
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
			// The id becomes one path segment under extensions_data; assert the
			// result stays under the root so a plugin id can never move its own
			// storage root (see `storageSegment`).
			const safe = storageSegment(desc.id)
			const base = path.join(this.dataDir!, "extensions_data")
			const dir = path.join(base, safe)
			if (!dir.startsWith(base + path.sep))
				throw new Error(
					`plugin '${desc.id}' resolved to an unsafe storage path`
				)
			config.storageDir = dir
			config.quotaBytes = desc.storageQuotaBytes
		}
		if (hasNetwork) config.networkHosts = desc.networkHosts
		return config
	}

	/* ── registration / the dial ─────────────────────────────────────────── */

	/**
	 * Install — or refresh — a plugin's projection. When the refresh changes
	 * what the runtime was handed at load (the bundle, the backend, or a
	 * capability grant), the loaded copy is swapped for one built from the new
	 * descriptor: **immediately** when the plugin is quiescent, otherwise the
	 * moment its last in-flight call drains, so work already running is never
	 * torn out from under. A plugin that was warm is re-loaded straight away
	 * rather than left cold for the next call to fault back in.
	 *
	 * The swap is promptness, not the guarantee: `dispatch` re-tests staleness
	 * at the point of use, which is what a call already in the queue goes
	 * through.
	 */
	register(desc: PluginDescriptor): void {
		if (!desc.backends.includes(desc.backend))
			throw new Error(
				`plugin '${desc.id}' set to backend '${desc.backend}' it does not support`
			)
		this.descriptors.set(desc.id, { ...desc })
		if (this.isStale(desc)) this.refresh(desc.id)
	}

	unregister(pluginId: string): void {
		// Descriptor first: `release` reads it to decide whether this plugin still
		// belongs on SES, and an uninstalled plugin belongs nowhere.
		this.descriptors.delete(pluginId)
		this.release(pluginId)
		this.staleWhileBusy.delete(pluginId)
		this.unloadWhenIdle.delete(pluginId)
		this.queues.delete(pluginId)
	}

	/**
	 * The admin's "unload now": drop the loaded copy — and a SES plugin's
	 * dedicated worker — while keeping the plugin registered, so the next call
	 * faults it back in cold. The memory-pressure lever, distinct from disable
	 * (which stops hooks firing at all) and from `unregister` (which forgets
	 * the plugin entirely).
	 *
	 * Same drain discipline as every other admin-facing change: immediate when
	 * the plugin is quiescent, otherwise the moment its last in-flight call
	 * settles — work already running keeps the copy it started on. An unload
	 * outranks a swap held for the same drain: both agree the stale copy goes,
	 * and cold is what was asked for — re-warming would undo the request in
	 * the same breath as honouring it.
	 *
	 * Unknown ids are a no-op, not an error: the list the admin clicked in may
	 * be a beat behind an uninstall, and "already gone" is the desired state.
	 */
	unload(pluginId: string): void {
		if (!this.descriptors.has(pluginId)) return
		if (this.inFlight.get(pluginId)) {
			this.unloadWhenIdle.add(pluginId)
			return
		}
		this.coldRelease(pluginId)
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
		desc.backend = backend
		// Same path as any other change to what the runtime was handed.
		this.refresh(pluginId)
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

		const run = () =>
			this.track(pluginId, () =>
				this.dispatch(pluginId, hookName, input, opts, queuedAt)
			)

		// Concurrency: concurrent by default; a sequential plugin chains its
		// calls one at a time. Lifecycle hooks always run sequentially.
		if (desc.sequential || opts.lifecycle) return this.sequential(desc.id, run)
		return run()
	}

	/** Whether a plugin has a loaded copy in its runtime right now (warm vs cold). */
	isWarm(pluginId: string): boolean {
		return this.loaded.has(pluginId)
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
		// Resolved from the *call*, never from the current descriptor. A backend
		// change can land while a call runs (and is deferred until it drains), so
		// the descriptor may name a runtime this call was never on — terminating
		// that one leaves the target running and tears down a bystander instead.
		const onSes = call.backend === "ses"
		const rt = onSes ? this.sesWorkers.get(call.pluginId) : this.quickjs
		if (!rt) return false
		await rt.dispose()
		// The runtime went wholesale, taking every copy it hosted with it: a SES
		// worker hosts only this plugin, the QuickJS runtime hosts them all.
		if (onSes) {
			this.sesWorkers.delete(call.pluginId)
			if (this.loaded.get(call.pluginId)?.backend === "ses")
				this.loaded.delete(call.pluginId)
		} else {
			for (const [id, held] of this.loaded)
				if (held.backend !== "ses") this.loaded.delete(id)
		}
		return true
	}

	async dispose(): Promise<void> {
		await this.quickjs.dispose()
		for (const w of this.sesWorkers.values()) await w.dispose()
		this.sesWorkers.clear()
		this.descriptors.clear()
		this.loaded.clear()
		this.staleWhileBusy.clear()
		this.unloadWhenIdle.clear()
		this.inFlight.clear()
		this.active.clear()
	}

	/* ── internals ──────────────────────────────────────────────────────── */

	/**
	 * The runtime that should *host* this descriptor, creating a SES plugin's
	 * dedicated worker if it has none. Load paths want this; release paths want
	 * `hostOf`, which never constructs.
	 */
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

	/**
	 * Everything the runtime is handed at load, as one comparable key: the
	 * bundle identity, the host backend, and the capability grants. Mirrors
	 * `capabilityConfig`'s own truthiness tests — a falsy quota (or no
	 * `dataDir`) is no storage, an absent host list is no network — so an inert
	 * difference like `undefined` vs `0` never forces a needless reload.
	 */
	private loadKey(desc: PluginDescriptor): string {
		return JSON.stringify([
			desc.bundleHash,
			desc.backend,
			this.dataDir ? desc.storageQuotaBytes || 0 : 0,
			desc.networkHosts ?? []
		])
	}

	/** Does what the runtime holds still match what this descriptor asks for? */
	private isStale(desc: PluginDescriptor): boolean {
		const held = this.loaded.get(desc.id)
		return !!held && this.loadKey(held) !== this.loadKey(desc)
	}

	/**
	 * The runtime holding a plugin's copy — a *lookup*, so it never conjures a
	 * SES worker the way `runtimeFor` does. Release paths must use this one:
	 * building a worker in order to unload nothing from it both wastes a thread
	 * and re-registers the very worker a backend flip just disposed.
	 */
	private hostOf(desc: PluginDescriptor): PluginRuntime | undefined {
		return desc.backend === "ses" ? this.sesWorkers.get(desc.id) : this.quickjs
	}

	/**
	 * The one way a loaded copy is dropped. Resolves the host from the descriptor
	 * the copy was *loaded under* — not the current one, which a backend flip has
	 * already moved — and clears the record with it, so no path can leave
	 * `loaded` claiming something that is gone. `unload` frees only this plugin's
	 * state: a call already executing runs to completion under the grants it
	 * started with, and the re-load lands on the next one.
	 *
	 * It also tears down a SES plugin's dedicated worker once nothing will host
	 * that plugin there again — it was uninstalled, or flipped off SES. Decided
	 * here from current state rather than passed in by the caller: a caller that
	 * gets such a flag wrong leaks a thread, and one did — `dispatch` released a
	 * flipped plugin without it, and by the time the deferred swap ran the record
	 * already read the new backend, so neither path disposed the worker.
	 */
	private release(pluginId: string): void {
		const held = this.loaded.get(pluginId)
		if (held) {
			this.hostOf(held)?.unload(pluginId)
			this.loaded.delete(pluginId)
		}
		if (this.descriptors.get(pluginId)?.backend !== "ses") {
			const w = this.sesWorkers.get(pluginId)
			if (w) {
				void w.dispose()
				this.sesWorkers.delete(pluginId)
			}
		}
	}

	/**
	 * `release`, plus the SES worker even when the plugin still *belongs* on
	 * SES. The swap paths keep that worker deliberately — they are about to
	 * re-warm into it — but an admin unload's whole point is the memory, and
	 * an empty dedicated thread is most of it. `runtimeFor` rebuilds one the
	 * next time a call needs it.
	 */
	private coldRelease(pluginId: string): void {
		this.release(pluginId)
		const w = this.sesWorkers.get(pluginId)
		if (w) {
			void w.dispose()
			this.sesWorkers.delete(pluginId)
		}
	}

	/**
	 * The one way a copy is loaded. Records the descriptor *before* awaiting, so
	 * a call arriving mid-load reuses this load instead of tearing it down and
	 * rebuilding it; a failure rolls the record back and rethrows, leaving the
	 * plugin cold rather than cached half-built.
	 */
	private async loadInto(rt: PluginRuntime, desc: PluginDescriptor): Promise<void> {
		this.loaded.set(desc.id, { ...desc })
		try {
			await rt.load(
				desc.id,
				desc.bundleSource,
				desc.bundleHash,
				this.capabilityConfig(desc)
			)
		} catch (e) {
			this.loaded.delete(desc.id)
			rt.unload(desc.id)
			throw e
		}
	}

	/**
	 * Apply a change to the loaded copy: now if the plugin is quiescent, else the
	 * moment its last call drains. Every admin-facing mutation — a re-register, a
	 * backend flip — comes through here, so "when does a change take effect" has
	 * one answer.
	 */
	private refresh(pluginId: string): void {
		if (this.inFlight.get(pluginId)) {
			this.staleWhileBusy.add(pluginId)
			return
		}
		this.swap(pluginId)
	}

	/** Drop the stale copy and, when it was warm, load its replacement at once. */
	private swap(pluginId: string): void {
		const held = this.loaded.get(pluginId)
		const next = this.descriptors.get(pluginId)
		this.release(pluginId)
		if (held && next) void this.warm(pluginId)
	}

	/** Re-load a plugin that was warm, so the new grants are live immediately. */
	private async warm(pluginId: string): Promise<void> {
		const desc = this.descriptors.get(pluginId)
		if (!desc || this.inFlight.get(pluginId) || this.loaded.has(pluginId)) return
		try {
			await this.loadInto(this.runtimeFor(desc), desc)
		} catch {
			// Stays cold on purpose: the next call retries and reports the
			// failure through the usual record instead of this path swallowing it.
		}
	}

	/**
	 * Count a call as in flight and, when a plugin's last one finishes, apply the
	 * swap held back while it was busy. The count spans the load phase as well as
	 * the invoke, and decrements on *every* exit — error, timeout, an admin kill,
	 * a run abandoned upstream — because every one of those settles the call (the
	 * runtime resolves its pending jobs and keeps a hard timeout backstop). So a
	 * deferred swap cannot be pinned by work that never comes back.
	 */
	private async track<T>(pluginId: string, fn: () => Promise<T>): Promise<T> {
		this.inFlight.set(pluginId, (this.inFlight.get(pluginId) ?? 0) + 1)
		try {
			return await fn()
		} finally {
			const left = (this.inFlight.get(pluginId) ?? 1) - 1
			if (left > 0) this.inFlight.set(pluginId, left)
			else {
				this.inFlight.delete(pluginId)
				// Unload outranks a held swap — see `unload`. Both flags clear
				// either way, so neither can fire twice on a later drain.
				if (this.unloadWhenIdle.delete(pluginId)) {
					this.staleWhileBusy.delete(pluginId)
					this.coldRelease(pluginId)
				} else if (this.staleWhileBusy.delete(pluginId))
					this.swap(pluginId)
			}
		}
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
		pluginId: string,
		hookName: string,
		input: Record<string, unknown>,
		opts: CallOptions,
		queuedAt: number
	): Promise<HookRunResult> {
		// Resolved here rather than carried in from `callHook`: a call can wait
		// on the ready-gate or behind the sequential queue, and an admin change
		// landing in that window has to apply to it. Dispatching the descriptor
		// the call captured would run — and re-install — revoked grants.
		const desc = this.descriptors.get(pluginId)
		if (!desc) return this.miss(pluginId, "unknown", hookName, opts, queuedAt)

		const callId = ++this.callSeq
		const rt = this.runtimeFor(desc)
		const backend = desc.backend
		const mode: InvocationRecord["mode"] = opts.lifecycle
			? "lifecycle"
			: desc.sequential
				? "sequential"
				: "concurrent"

		// The staleness question, asked at the point of use. `register` decides
		// the same thing eagerly for promptness, but this is the test that no
		// call can slip past — `load` is idempotent per bundle hash, so a changed
		// grant only lands if the stale copy is released first.
		if (this.isStale(desc)) this.release(pluginId)
		if (!this.loaded.has(pluginId)) {
			try {
				await this.loadInto(rt, desc)
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
					// `settings` is a reserved input key (12 §6), injected from
					// the descriptor resolved *now* — same staleness rule as
					// the grants above. Only when the manifest declares a
					// schema, so a settings-free plugin's input is unchanged.
					input: desc.settings
						? { ...input, settings: desc.settings }
						: input,
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
