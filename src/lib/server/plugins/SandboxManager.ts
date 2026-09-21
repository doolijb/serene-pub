/**
 * The orchestration layer. SP Core's entire touchpoint is
 * `manager.callHook(...)`; the manager decides *which* backend runs it, keeps
 * the sandboxes warm, enforces the concurrency and lifecycle rules, exposes the
 * live registry the admin monitor reads, and emits an observability record for
 * every invocation. It is unopinionated about the backend — it only ever talks
 * to the `PluginSandbox` contract.
 *
 * Topology (from the SES-vs-QuickJS asymmetry): QuickJS is interruptible, so a
 * single shared QuickJS sandbox hosts every quickjs plugin. SES can only be
 * stopped by terminating its worker, so each SES plugin gets **its own** SES
 * worker — a kill's blast radius is one extension, never all of them.
 *
 * Stopping is per *call*, not per plugin: `abortCall` fires one hook's
 * `ctx.signal` and `killCall` forces one hook to stop, on either backend and
 * without disposing anything. The residual asymmetry is SES's alone and is
 * documented at `PluginSandbox.kill`.
 *
 * Those two are primitives with no opinion about each other; *sequencing* them
 * is this layer's job and lives in `hookGrace.ts` — abort, wait the run's one
 * budget, then kill — reached through `stopRun` below. The manager also holds
 * the one deadline the sandbox cannot always keep for itself: see the overrun
 * backstop in `dispatch`.
 */

import path from "node:path"
import { QuickJsSandbox } from "./QuickJsSandbox"
import { SesWorkerSandbox } from "./SesWorkerSandbox"
import { HookGracePolicy, type RunStop } from "./hookGrace"
import {
	rowQuotaFor,
	type PermissionConfig,
	type PluginRowSnapshotEntry
} from "./storageHost"
import type { PluginRowPort } from "./rowStore"
import type { HookRunResult, PluginSandbox, SandboxKind } from "./types"
import { hookCtxGrants, type HookCtxKind } from "./hookCtx"

/** What the manager needs to know about an installed, enabled plugin. Persisted
 * elsewhere; the manager holds the projection it dispatches against. */
export interface PluginDescriptor {
	id: string
	/** Human name — carried so logs and the monitor read well and outlive it. */
	name: string
	bundleSource: string
	bundleHash: string
	/** Backends the conformance harness certified this bundle runs on. */
	backends: SandboxKind[]
	/** The active backend (the security/speed dial). Must be in `backends`. */
	backend: SandboxKind
	/** Sequential-only: manifest-declared, or admin-forced. Concurrent otherwise. */
	sequential: boolean
	/**
	 * The scoped-storage grant, if the plugin's manifest declares one — the
	 * quota in bytes. Absent = storage denied. The manager derives the private
	 * directory (`<dataDir>/extensions_data/<id>`) and passes both to the
	 * sandbox at load; the plugin never sees the path.
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
	/**
	 * The hook ctx kind (`hookCtx.ts`, plans/29 R-3) — what the hook's `ctx`
	 * carries. Each of the six dispatchers names its own; `callHook` throws
	 * on a call without one rather than defaulting.
	 */
	kind: HookCtxKind
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
	backend: SandboxKind
	user?: string
	lifecycle: boolean
	startedAt: number
	/**
	 * The pipeline run this call fired within, when it had one. Carried on the
	 * live record rather than only in the log because it is the *grouping* the
	 * grace policy stops by: cancelling a run has to find the calls it started,
	 * and this is the only place that association exists while they run.
	 */
	runId?: string
}

/** The observability record emitted for every completed invocation. Identity is
 * denormalized (name + hash) so the row stays meaningful after uninstall. */
export interface InvocationRecord {
	callId: number
	pluginId: string
	pluginName: string
	bundleHash: string
	hookName: string
	backend: SandboxKind
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

/**
 * How far past its own `timeoutMs` a call is allowed to go before *this* layer
 * stops it, per call, without being asked.
 *
 * ⚠ This is not a second deadline for the hook. It is the fix for a starvation
 * the shared QuickJS worker makes possible: one job spinning synchronously
 * holds that thread, so a *different* job parked in its drive loop cannot run
 * the loop that would notice its own deadline. The sandbox's fallback for a
 * job whose inner deadline never fires is its wall-clock backstop at
 * `timeoutMs + 1000`, and that backstop terminates the whole worker — so a
 * hook that overran by starvation takes down the spinner, every other plugin
 * sharing the sandbox, and the loaded bundles with it.
 *
 * Killing the starved call *per job* is strictly better and needs no
 * cooperation from the blocked thread at all: QuickJS's kill is a shared-memory
 * flag plus a host-side settle, so it lands while the thread is still held, and
 * settling clears the sandbox's own backstop before it can fire. This value is
 * therefore chosen to be comfortably under that 1000ms — half of it — so the
 * per-job stop always wins the race, and comfortably over the round trip a
 * healthy call needs to report its own timeout, so a call the sandbox *did*
 * stop keeps its honest `timeout` outcome.
 *
 * No grace is offered here, and that is the point: a call at this instant has
 * already had every millisecond of the budget its caller asked for. Grace is
 * what `hookGrace.ts` gives a hook whose run was cancelled early — time it was
 * never promised. This is the opposite case.
 *
 * On SES it is inert by construction: that backend's own deadline terminates
 * its worker at exactly `timeoutMs`, so nothing is left to overrun. The inline
 * QuickJS debug path (`SP_PLUGINS_INLINE=1`), which has no backstop at all,
 * gains one.
 */
export const HOOK_DEADLINE_SLACK_MS = 500

export class SandboxManager {
	private readonly quickjs = new QuickJsSandbox()
	private readonly sesWorkers = new Map<string, SesWorkerSandbox>()
	private readonly descriptors = new Map<string, PluginDescriptor>()
	/**
	 * What each sandbox actually holds: the descriptor a plugin's loaded copy
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
	/** Per-call overrun backstops — see `HOOK_DEADLINE_SLACK_MS`. */
	private readonly overruns = new Map<number, ReturnType<typeof setTimeout>>()
	/**
	 * Why core stopped a call, for the calls core stopped. The sandbox's own
	 * reason has to be generic — it does not know what a call was doing or who
	 * asked — so the policy that decided to stop it says so here, and `record`
	 * puts that sentence on the invocation log instead.
	 */
	private readonly stopReasons = new Map<number, string>()
	/**
	 * Abort → wait → kill, sequenced in one place. It reaches back through
	 * these three ports and nothing else, so the policy stays testable without
	 * a sandbox and the manager keeps the primitives.
	 */
	private readonly grace = new HookGracePolicy({
		callsOfRun: (runId) =>
			[...this.active.values()]
				.filter((c) => c.runId === runId)
				.map((c) => c.callId),
		// Both are fired and forgotten from a timer, so both swallow: an
		// unhandled rejection out here would be a stop attempt taking the
		// process with it.
		abort: (callId) => {
			void this.abortCall(callId).catch(() => {})
		},
		kill: (callId, reason) => {
			void this.killCall(callId, reason).catch(() => {})
		}
	})

	private ready = false
	private readyResolvers: (() => void)[] = []

	private readonly onInvocation?: (rec: InvocationRecord) => void
	/** Root under which each plugin's `extensions_data/<id>` dir lives. */
	private readonly dataDir?: string
	/**
	 * The row half of `ctx.storage`, as a port rather than a db handle: the
	 * manager stays database-free, and a manager built without one simply runs
	 * every hook with no rows — which is what the sandbox already does for a
	 * plugin that has no storage grant, so there is no second behaviour to
	 * reason about. See `rowStore.ts` for why the host does this work at all.
	 */
	private readonly rows?: PluginRowPort

	constructor(
		opts: {
			onInvocation?: (rec: InvocationRecord) => void
			dataDir?: string
			rows?: PluginRowPort
		} = {}
	) {
		this.onInvocation = opts.onInvocation
		this.dataDir = opts.dataDir ?? process.env.SERENE_PUB_DATA_DIR
		this.rows = opts.rows
	}

	/** The permission grants for a plugin, or undefined when it has none. */
	private permissionConfig(
		desc: PluginDescriptor
	): PermissionConfig | undefined {
		const hasStorage = !!desc.storageQuotaBytes && !!this.dataDir
		const hasNetwork = !!desc.networkHosts && desc.networkHosts.length > 0
		if (!hasStorage && !hasNetwork) return undefined
		const config: PermissionConfig = {}
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
			// Derived here, at grant-derivation, for the same reason the quota
			// itself is clamped there: a manifest declares one storage number
			// and everything else about the grant is computed from it.
			config.rowQuotaBytes = rowQuotaFor(desc.storageQuotaBytes!)
		}
		if (hasNetwork) config.networkHosts = desc.networkHosts
		return config
	}

	/* ── registration / the dial ─────────────────────────────────────────── */

	/**
	 * Install — or refresh — a plugin's projection. When the refresh changes
	 * what the sandbox was handed at load (the bundle, the backend, or a
	 * permission grant), the loaded copy is swapped for one built from the new
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
	setBackend(pluginId: string, backend: SandboxKind): void {
		const desc = this.descriptors.get(pluginId)
		if (!desc) throw new Error(`plugin '${pluginId}' is not registered`)
		if (!desc.backends.includes(backend))
			throw new Error(
				`plugin '${pluginId}' does not support backend '${backend}'`
			)
		if (desc.backend === backend) return
		desc.backend = backend
		// Same path as any other change to what the sandbox was handed.
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
		// A programming error, not a hook failure: thrown here, before the
		// gate and the queue, so the dispatcher that forgot its kind hears it
		// on the first call rather than as a `load` outcome in the log.
		hookCtxGrants(opts.kind)
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
		if (desc.sequential || opts.lifecycle)
			return this.sequential(desc.id, run)
		return run()
	}

	/** Whether a plugin has a loaded copy in its sandbox right now (warm vs cold). */
	isWarm(pluginId: string): boolean {
		return this.loaded.has(pluginId)
	}

	/** Snapshot of everything running right now — for the admin monitor. */
	activeInvocations(): ActiveCall[] {
		return [...this.active.values()].sort(
			(a, b) => a.startedAt - b.startedAt
		)
	}

	/**
	 * Ask one in-flight call to stop itself: its `ctx.signal` fires and the hook,
	 * if it is awaiting anything, wakes at its own await point and winds down in
	 * its own frame — transaction, temp files and locals all still in scope — and
	 * returns normally. A returning hook is just a returning hook; nothing here
	 * treats it specially, and the call's result is an ordinary success.
	 *
	 * So this asks, and only the hook can answer. Whether it did is observable
	 * exactly one way: it returned in time. When it does not, `killCall` is what
	 * comes next — and the wait between the two is `hookGrace.ts`, reached
	 * through `stopRun`. This method stays the bare ask, which is what the
	 * admin monitor's own button wants: a person watching the call decide for
	 * themselves when to escalate.
	 */
	async abortCall(callId: number): Promise<boolean> {
		const sandbox = this.sandboxOfCall(callId)
		return sandbox ? sandbox.abort(String(callId)) : false
	}

	/**
	 * Stop one in-flight call for certain (the admin kill). Per call on both
	 * backends and no longer a `dispose`: killing a hook stops that hook, never
	 * its whole plugin and never every plugin sharing a sandbox.
	 *
	 * QuickJS is interrupted at the call, so the rest of the shared sandbox runs
	 * on untouched. SES has no interrupt point, so its forced stop is still the
	 * worker — the blast radius is that one plugin's other in-flight calls, and
	 * `PluginSandbox.kill` says so at the interface rather than leaving a caller
	 * to assume parity that V8 cannot give.
	 *
	 * `reason` is what the invocation log will say instead of the sandbox's
	 * own generic sentence. Optional, because an admin pressing Kill in the
	 * monitor *is* the explanation; core's automatic stops pass one, so a hook
	 * killed for overrunning its deadline stays distinguishable from one killed
	 * because its run was cancelled.
	 */
	async killCall(callId: number, reason?: string): Promise<boolean> {
		const sandbox = this.sandboxOfCall(callId)
		if (!sandbox) return false
		// Recorded before the kill, because the kill is what makes the call
		// settle: after awaiting it, `dispatch` may already have read this.
		if (reason) this.stopReasons.set(callId, reason)
		return await sandbox.kill(String(callId))
	}

	/**
	 * A run was stopped: put every hook it started through the grace policy.
	 *
	 * Fire-and-forget by design. Cancelling a run must return at once — the
	 * person pressing the button is waiting on the UI, not on somebody's
	 * extension — so the winding-down happens behind it, and the grace is never
	 * latency anybody sees.
	 */
	stopRun(runId: string, stop: RunStop): void {
		this.grace.cancelRun(runId, stop)
	}

	/**
	 * A run left the registry, so nothing more will arrive under its id and the
	 * policy can drop what it remembered about it. Always paired with
	 * `stopRun`, in the run's own `finally` — a record kept forever is the leak
	 * this exists to prevent.
	 */
	forgetRun(runId: string): void {
		this.grace.forget(runId)
	}

	/**
	 * The sandbox a call is actually running on. Resolved from the *call*, never
	 * from the current descriptor: a backend change can land while a call runs
	 * (and is deferred until it drains), so the descriptor may name a sandbox
	 * this call was never on — stopping that one leaves the target running and
	 * hits a bystander instead.
	 */
	private sandboxOfCall(callId: number): PluginSandbox | undefined {
		const call = this.active.get(callId)
		if (!call) return undefined
		return call.backend === "ses"
			? this.sesWorkers.get(call.pluginId)
			: this.quickjs
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
		// Every timer this layer owns, so a disposed manager cannot wake up
		// later and try to stop a call in a sandbox that no longer exists.
		for (const t of this.overruns.values()) clearTimeout(t)
		this.overruns.clear()
		this.stopReasons.clear()
		this.grace.dispose()
	}

	/* ── internals ──────────────────────────────────────────────────────── */

	/**
	 * The sandbox that should *host* this descriptor, creating a SES plugin's
	 * dedicated worker if it has none. Load paths want this; release paths want
	 * `hostOf`, which never constructs.
	 */
	private sandboxFor(desc: PluginDescriptor): PluginSandbox {
		if (desc.backend === "ses") {
			let w = this.sesWorkers.get(desc.id)
			if (!w) {
				w = new SesWorkerSandbox()
				this.sesWorkers.set(desc.id, w)
			}
			return w
		}
		return this.quickjs
	}

	/**
	 * Everything the sandbox is handed at load, as one comparable key: the
	 * bundle identity, the host backend, and the permission grants. Mirrors
	 * `permissionConfig`'s own truthiness tests — a falsy quota (or no
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

	/** Does what the sandbox holds still match what this descriptor asks for? */
	private isStale(desc: PluginDescriptor): boolean {
		const held = this.loaded.get(desc.id)
		return !!held && this.loadKey(held) !== this.loadKey(desc)
	}

	/**
	 * The sandbox holding a plugin's copy — a *lookup*, so it never conjures a
	 * SES worker the way `sandboxFor` does. Release paths must use this one:
	 * building a worker in order to unload nothing from it both wastes a thread
	 * and re-registers the very worker a backend flip just disposed.
	 */
	private hostOf(desc: PluginDescriptor): PluginSandbox | undefined {
		return desc.backend === "ses"
			? this.sesWorkers.get(desc.id)
			: this.quickjs
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
	 * an empty dedicated thread is most of it. `sandboxFor` rebuilds one the
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
	private async loadInto(
		sandbox: PluginSandbox,
		desc: PluginDescriptor
	): Promise<void> {
		this.loaded.set(desc.id, { ...desc })
		try {
			await sandbox.load(
				desc.id,
				desc.bundleSource,
				desc.bundleHash,
				this.permissionConfig(desc)
			)
		} catch (e) {
			this.loaded.delete(desc.id)
			sandbox.unload(desc.id)
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
		if (!desc || this.inFlight.get(pluginId) || this.loaded.has(pluginId))
			return
		try {
			await this.loadInto(this.sandboxFor(desc), desc)
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
	 * sandbox resolves its pending jobs and keeps a hard timeout backstop). So a
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
		if (!desc)
			return this.miss(pluginId, "unknown", hookName, opts, queuedAt)

		const callId = ++this.callSeq
		const sandbox = this.sandboxFor(desc)
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
				await this.loadInto(sandbox, desc)
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

		// This plugin's rows, read before the call and handed in with the job.
		// Loaded here, beside the bundle load and before `startedAt`, because it
		// is setup rather than hook time — and failed the same way a bundle load
		// is: a hook that ran against an empty snapshot would read `undefined`
		// for keys it wrote yesterday and act on it.
		let rows: PluginRowSnapshotEntry[] | undefined
		if (this.rows && desc.storageQuotaBytes && this.dataDir) {
			try {
				rows = await this.rows.load(desc.id)
			} catch (e) {
				return this.record(
					{
						ok: false,
						reason: `failed to read extension rows: ${String((e as Error)?.message || e)}`,
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
			startedAt,
			runId: opts.runId
		}
		this.active.set(callId, active)
		// The overrun backstop (see `HOOK_DEADLINE_SLACK_MS`). Armed for every
		// call, because which one will be starved is not knowable in advance,
		// and cleared on every exit below.
		this.overruns.set(
			callId,
			setTimeout(
				() =>
					void this.killCall(
						callId,
						`killed: overran its ${opts.timeoutMs}ms deadline ` +
							`and the sandbox had not stopped it ` +
							`${HOOK_DEADLINE_SLACK_MS}ms later`
					).catch(() => {}),
				opts.timeoutMs + HOOK_DEADLINE_SLACK_MS
			)
		)

		let result: HookRunResult
		try {
			const invoked = sandbox.invoke(
				{ pluginId: desc.id, hookName },
				{
					kind: opts.kind,
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
					maxOutputBytes: opts.maxOutputBytes,
					rows,
					// The address `abortCall`/`killCall` stop this call by. The
					// call id is already the manager's handle for it, and the
					// live monitor's — one name for one call, end to end.
					jobId: String(callId)
				}
			)
			// After the invoke, never before: the sandbox registers the job
			// under `jobId` inside `invoke`, so a call asked to stop while it
			// was still only *about* to start would have nothing to signal and
			// the ask would be silently dropped. A run cancelled between this
			// call being queued and it reaching the sandbox is the ordinary
			// case, not an exotic one — it is what a fold's next link does.
			if (opts.runId) this.grace.adopt(opts.runId, callId)
			result = await invoked
		} finally {
			this.active.delete(callId)
			const overrun = this.overruns.get(callId)
			if (overrun) {
				clearTimeout(overrun)
				this.overruns.delete(callId)
			}
			// The call has settled, however it ended. Told to the policy here
			// so a hook that returned inside its run's grace is out of the reap
			// set before the reap can reach it.
			this.grace.settled(callId)
		}

		// The row half of the commit, and the ordering is a decision rather
		// than an accident.
		//
		// By the time this line runs the sandbox has ALREADY applied its files:
		// it commits them the instant `evaluate` resolves, inside the worker,
		// which is the only place a killed hook's writes can be made
		// all-or-nothing. So the two stores commit in the order files-then-rows,
		// and what that buys is:
		//  - rows are atomic (one transaction);
		//  - files are per-file atomic, as they always were;
		//  - **the two are not atomic with respect to each other**, and the
		//    window is exactly here: a process death between the sandbox's file
		//    apply and this transaction leaves FILES AHEAD OF ROWS.
		//
		// That direction is chosen. Orphaned bytes are self-healing — the next
		// call sees no row, redoes the work and overwrites the file — where rows
		// ahead of files is a dangling reference an extension has to be written
		// to survive. The alternative order (stage files, commit rows, then
		// rename) would put the file apply *after* the result has crossed the
		// worker boundary, which opens a window in which a call reported as
		// `killed` has nonetheless committed rows — and "a killed hook commits
		// nothing" is the guarantee the whole transaction exists for.
		//
		// A file commit that threw never reaches here: it fails the call inside
		// the worker and carries no `rowChanges`, so rows can never land for a
		// call whose files did not.
		if (result.ok && result.rowChanges?.length && this.rows) {
			try {
				await this.rows.commit(desc.id, result.rowChanges)
			} catch (e) {
				// The hook believes its rows landed and they did not. That is a
				// failed call, not a success with a footnote — the same ruling
				// the file half makes when its own commit cannot be applied.
				result = {
					ok: false,
					reason:
						`the hook returned but its rows could not be committed — ` +
						String((e as Error)?.message || e),
					logs: result.logs,
					durationMs: result.durationMs,
					backend: result.backend,
					outcome: "error"
				}
			}
		}
		// Consumed here and nowhere else: the diff is transport between the
		// sandbox and this line, and no caller above the manager has any use for
		// it or any right to re-apply it.
		if (result.ok && result.rowChanges) {
			const { rowChanges: _committed, ...rest } = result
			result = rest
		}

		// Why core stopped it, when core stopped it. Only ever replaces the
		// reason on a call that was actually killed: a hook that woke on its
		// abort and returned is an ordinary success and says nothing about it.
		const stopped = this.stopReasons.get(callId)
		this.stopReasons.delete(callId)
		if (stopped && !result.ok && result.outcome === "killed")
			result = { ...result, reason: stopped }

		return this.record(
			result,
			desc,
			hookName,
			opts,
			callId,
			mode,
			queuedAt,
			startedAt
		)
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
