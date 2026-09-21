/**
 * The SES (Hardened JavaScript) plugin backend — the faster fallback.
 *
 * Third-party hook code runs on full V8 inside a SES `Compartment`: frozen
 * primordials, no ambient authority, only the endowments SP hands in. It is
 * faster than QuickJS and can run the plugin's own WebAssembly, at the cost of
 * a weaker confinement primitive — which is why it is the opt-in side of the
 * security/speed dial, never the default.
 *
 * Two hard differences from `QuickJsSandbox`, both from SES's nature:
 *  1. **No inline fallback.** `lockdown()` is process-wide and irreversible;
 *     running SES in-process would harden the whole server. SES only ever runs
 *     in a worker. If the worker cannot start, this backend is unavailable and
 *     the manager falls back to QuickJS.
 *  2. **No inner interrupt.** V8 cannot preempt hostile JS below the thread, so
 *     a runaway hook is stopped only by terminating the worker. The wall-clock
 *     kill is therefore the *sole* deadline, and a kill's blast radius is every
 *     plugin sharing the worker — which is why the manager gives each extension
 *     its own SES worker.
 *
 * Scope matches QuickJS: one evaluator, fresh Compartment per call.
 * `Math.random`/`Date.now` are omitted by SES and cannot be reassigned
 * (frozen), so determinism is via `ctx.random` / `ctx.now` only — a hook that
 * reaches for the globals is a parity risk the conformance harness flags.
 *
 * The same asymmetry decides cancellation, and it is the one place a caller has
 * to know which backend it is on. `abort` is per job on both: the worker posts
 * the message, and a hook suspended at an await wakes on its own `ctx.signal`.
 * `kill` is not — with no interrupt point, terminating the worker is the only
 * forced stop there is, so it takes this plugin's other in-flight calls with it
 * (see `PluginSandbox.kill`).
 *
 * That blast radius is what makes the storage transaction (`storageHost`) load
 * bearing here rather than a nicety: a killed SES call is a thread that ceases
 * to exist mid-statement, so the only way its writes can be all-or-nothing is
 * for them never to have touched the disk until it returned. The commit is the
 * line right after `evaluate` resolves, and there is deliberately nowhere else
 * a transaction can end.
 */

import { Worker } from "node:worker_threads"
import { AMBIENT_PRELUDE } from "./prelude"
import {
	STORAGE_HOST_SOURCE,
	permissionKey,
	type PermissionConfig,
	type PluginRowChange
} from "./storageHost"
import { FETCH_HOST_SOURCE } from "./fetchHost"
import { CRYPTO_HOST_SOURCE } from "./cryptoHost"
import { hookCtxGrants } from "./hookCtx"
import type {
	HookRef,
	HookRunResult,
	InvokeOptions,
	PluginSandbox
} from "./types"

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

interface StoredBundle {
	source: string
	hash: string
	config?: PermissionConfig
}

type EvalOutcome =
	| { ok: true; json: string; rows?: PluginRowChange[] | null }
	| { ok: false; reason: string; kind: "error" | "load" | "missing" }

const WORKER_SOURCE =
	"const __PRELUDE = " +
	JSON.stringify(AMBIENT_PRELUDE) +
	";\n" +
	String.raw`
require("ses")
// Defaults are the strict, standard posture: frozen intrinsics, stacks hidden
// from the guest, Date.now/Math.random omitted from compartments.
lockdown()
` +
	STORAGE_HOST_SOURCE +
	FETCH_HOST_SOURCE +
	CRYPTO_HOST_SOURCE +
	String.raw`
var __DENIED_STORAGE = (function () {
	function d() { throw new Error("storage: permission not granted"); }
	// Every method the real store has, refusing by name — a plugin without the
	// grant must hear "permission not granted", never "is not a function".
	var files = { list: d, stat: d, read: d, write: d, delete: d, deleteAll: d };
	return { usage: d, get: d, keys: d, query: d, put: d, delete: d, deleteAll: d, files: files, read: d, write: d, exists: d, remove: d, list: d, size: d };
})();
const { parentPort } = require("worker_threads")
const bundles = new Map()
// Each in-flight job's cancellation state, by job id: the fire-callback its
// program registered, and whether the abort has already been delivered. Held out
// here, so a hook cannot revoke its own abort or lie about having one — and per
// job, so aborting one call leaves every other call in this worker running. The
// flag is what the fetch host reads: once it is set, this call may finish what
// it is doing but may not start new outbound work.
const jobs = new Map()

// grants: what the host derived from the hook's kind (hookCtx.ts, R-3). A
// ctx member the kind is not granted is absent, not a stub that refuses, so
// Object.keys(ctx) says exactly what the hook may reach.
function buildProgram(source, hookName, inputJson, seedLabel, nowMs, grants) {
	return (
		'(async function () {\n' +
		'"use strict";\n' +
		'var __logs = [];\n' +
		'var __rng = (function (label) {\n' +
		'  var h = 1779033703 ^ label.length;\n' +
		'  for (var i = 0; i < label.length; i++) {\n' +
		'    h = Math.imul(h ^ label.charCodeAt(i), 3432918353);\n' +
		'    h = (h << 13) | (h >>> 19);\n' +
		'  }\n' +
		'  h = Math.imul(h ^ (h >>> 16), 2246822507);\n' +
		'  h = Math.imul(h ^ (h >>> 13), 3266489909);\n' +
		'  var a = (h ^= h >>> 16) >>> 0;\n' +
		'  return function () {\n' +
		'    a |= 0; a = (a + 0x6d2b79f5) | 0;\n' +
		'    var t = Math.imul(a ^ (a >>> 15), 1 | a);\n' +
		'    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;\n' +
		'    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;\n' +
		'  };\n' +
		'})(' + JSON.stringify(seedLabel) + ');\n' +
		// SES freezes Math/Date — provide the deterministic stream through ctx,
		// never by reassigning a frozen intrinsic (which would throw).
		'var __input = JSON.parse(' + JSON.stringify(inputJson) + ');\n' +
		'var ctx = {\n' +
		'  random: __rng,\n' +
		'  now: function () { return ' + Math.floor(nowMs) + '; },\n' +
		// Every argument survives: the SDK declares log(level, message, detail?),
		// and the formatter is the prelude's — spliced just below, shared by both
		// backends so a hook cannot tell them apart by what its logs look like.
		'  log: function () { __logs.push(__fmtLog(arguments)); }' +
		(grants.storage ? ',\n  storage: __storage' : '') +
		(grants.fetch ? ',\n  fetch: function (url, opts) { return __fetch(url, opts ? JSON.stringify(opts) : undefined); }' : '') +
		'\n};\n' +
		__PRELUDE + '\n' +
		// The SDK's ExtensionStorage shape, put on after the prelude because
		// that is where the one adapter lives (see prelude.ts): promises for
		// the members the SDK declares as promises, Uint8Array for file bytes,
		// and the older six passed through synchronously.
		(grants.storage ? 'ctx.storage = __wrapStorage(ctx.storage);\n' : '') +
		// The abort capability, wired *before* the bundle is evaluated: the
		// first registration wins, so a hook cannot displace its own abort. The
		// controller is the prelude's — an AbortSignal cannot cross a worker
		// boundary, and a host one endowed here would be a live host object.
		'var __ac = new AbortController();\n' +
		'ctx.signal = __ac.signal;\n' +
		'__registerAbort(function () { __ac.abort(); });\n' +
		'var module = { exports: {} };\n' +
		'var exports = module.exports;\n' +
		'(function (module, exports) {\n' + source + '\n})(module, exports);\n' +
		'var __e = module.exports || {};\n' +
		'var __hooks = __e.hooks || (__e.default && __e.default.hooks) || {};\n' +
		'var __fn = __hooks[' + JSON.stringify(hookName) + '];\n' +
		'if (typeof __fn !== "function") return JSON.stringify({ __miss: true });\n' +
		'var __r = __fn(__input, ctx);\n' +
		// SES runs on real V8: async hooks and awaited capabilities (fetch) work.
		'if (__r && typeof __r.then === "function") __r = await __r;\n' +
		'return JSON.stringify(__r === undefined\n' +
		'  ? { u: true, logs: __logs }\n' +
		'  : { u: false, v: __r, logs: __logs });\n' +
		'})()'
	)
}

parentPort.on("message", async (msg) => {
	try {
		if (msg.t === "store") {
			bundles.set(msg.pluginId, {
				source: msg.source,
				hash: msg.hash,
				config: msg.config
			})
			parentPort.postMessage({ id: msg.id, ack: true })
			return
		}
		if (msg.t === "drop") {
			bundles.delete(msg.pluginId)
			return
		}
		if (msg.t === "abort") {
			// Delivered only when this worker's loop is free — which is exactly
			// when the hook is parked on an await and can be woken. A hook in a
			// synchronous loop never lets this message be read, and that is the
			// same failure mode from outside: it did not return in time.
			const state = jobs.get(msg.id)
			if (!state) return
			// Flagged before the guest is told, so a hook whose abort listener
			// reaches straight for the network is already refused. The other way
			// round, "handles abort" would buy a hook the whole grace to keep
			// fetching in.
			state.aborted = true
			// A throwing abort listener is the hook's own problem; the call
			// keeps its deadline either way.
			if (state.fire) { try { state.fire() } catch (e) {} }
			return
		}
		if (msg.t === "run") {
			const job = msg.job
			const bundle = bundles.get(job.pluginId)
			if (!bundle) {
				parentPort.postMessage({
					id: msg.id,
					outcome: { ok: false, reason: "plugin not loaded", kind: "missing" }
				})
				return
			}
			const state = { aborted: false, fire: null }
			jobs.set(msg.id, state)
			// This call's storage transaction. Every write it makes is buffered
			// in here and applied only if it returns — so a kill, which on this
			// backend is the whole thread going away, cannot leave a prefix of
			// them on disk.
			// The host loaded this plugin's rows before it posted the job; they
			// seed the transaction's row projection, and its diff comes back
			// with the result for the host to commit. Nothing in here holds a
			// database handle, and nothing in here needs one.
			// Only for a kind granted storage (R-3): a task's call opens no
			// transaction and commits no rows.
			const tx = job.grants.storage && bundle.config && bundle.config.storageDir ? makeStorageHost(bundle.config, job.rows, job.nowMs) : null
			// A fresh Compartment per call: no ambient authority, only frozen
			// intrinsics; every call starts from the same clean world. The two
			// permission-gated hosts are endowed only for a kind granted them —
			// absent from the ctx AND from the globals, so a hook cannot reach
			// past the ctx to a name the program never mentions (R-3).
			const endowments = { __crypto: harden(makeCryptoHost()), __registerAbort: harden(function (fn) { if (typeof fn === "function" && !state.fire) state.fire = fn }) }
			if (job.grants.storage) endowments.__storage = harden(tx ? tx.api : __DENIED_STORAGE)
			if (job.grants.fetch) endowments.__fetch = harden(fetchHostFor(bundle.config, function () { return state.aborted }))
			const compartment = new Compartment(endowments)
			const program = buildProgram(
				bundle.source,
				job.hookName,
				job.inputJson,
				job.seedLabel,
				job.nowMs,
				job.grants
			)
			try {
				const json = await compartment.evaluate(program)
				// The hook returned: only now do its writes become real. A
				// commit that cannot be applied throws, and the catch below
				// reports the call as failed rather than letting it pass as a
				// success whose data never landed. Files land here; the ROW diff
				// only rides back on the outcome, so a file commit that threw
				// carries no rows and the host commits none.
				const rows = tx ? tx.commit() : null
				parentPort.postMessage({ id: msg.id, outcome: { ok: true, json, rows } })
			} finally {
				jobs.delete(msg.id)
				if (tx) tx.discard()
			}
		}
	} catch (e) {
		parentPort.postMessage({
			id: msg.id,
			outcome: {
				ok: false,
				reason: String((e && e.message) || e),
				kind: "error"
			}
		})
	}
})
`

/**
 * How a call ended when it was stopped from outside rather than by the hook.
 * The two are the same event to the worker — it dies — and different facts to
 * the caller: one overran its deadline, the other was killed.
 */
interface Stopped {
	killed: true
	reason: string
	outcome: "timeout" | "killed"
}

interface Pending {
	resolve: (o: EvalOutcome | Stopped) => void
	killer: NodeJS.Timeout
	/** The caller's handle for this call, when it gave one. */
	jobId?: string
}

export class SesWorkerSandbox implements PluginSandbox {
	readonly kind = "ses" as const

	private readonly loaded = new Map<string, StoredBundle>()
	private worker: Worker | null = null
	private workerBroken = false
	private jobSeq = 0
	private readonly pending = new Map<number, Pending>()
	/**
	 * The caller's handle for a call → the internal job id, so `abort` and
	 * `kill` can address one in-flight job. Two id spaces on purpose: the
	 * internal one is this sandbox's message sequence (store acks share it),
	 * the external one is whatever the dispatcher already calls the call.
	 */
	private readonly byJobId = new Map<string, number>()
	/**
	 * Store acks awaiting the worker, by job id. Registered here — rather than
	 * left as a bare promise — because `pending` only covers run jobs, and a
	 * store ack that never settles leaves `load` awaiting forever: it strands
	 * the caller's call, and with it everything the manager gates on that call
	 * finishing. The bundle stays in `loaded`, so a respawned worker re-hydrates
	 * it and the settled load is honest about where things stand.
	 */
	private readonly pendingLoads = new Map<number, () => void>()

	async load(
		pluginId: string,
		bundleSource: string,
		bundleHash: string,
		config?: PermissionConfig
	): Promise<void> {
		const prev = this.loaded.get(pluginId)
		// Identical bytes *and* identical grants. Anything else has to re-store:
		// a narrowed permission arriving with the same bundle must not be
		// discarded as a no-op, whatever the caller's own bookkeeping believes.
		if (
			prev &&
			prev.hash === bundleHash &&
			permissionKey(prev.config) === permissionKey(config)
		)
			return
		this.loaded.set(pluginId, {
			source: bundleSource,
			hash: bundleHash,
			config
		})
		const w = this.ensureWorker()
		if (!w) return // unavailable; invoke will report it
		await new Promise<void>((resolve) => {
			const id = ++this.jobSeq
			const onMsg = (msg: { id: number; ack?: boolean }) => {
				if (msg.id === id) settle()
			}
			const settle = () => {
				w.off("message", onMsg)
				this.pendingLoads.delete(id)
				resolve()
			}
			this.pendingLoads.set(id, settle)
			w.on("message", onMsg)
			w.postMessage({
				t: "store",
				id,
				pluginId,
				source: bundleSource,
				hash: bundleHash,
				config
			})
		})
	}

	has(pluginId: string): boolean {
		return this.loaded.has(pluginId)
	}

	unload(pluginId: string): void {
		this.loaded.delete(pluginId)
		this.worker?.postMessage({ t: "drop", pluginId })
	}

	async invoke(hook: HookRef, opts: InvokeOptions): Promise<HookRunResult> {
		const started = Date.now()

		for (const name of Object.keys(opts.input))
			if (!IDENT.test(name))
				return this.mkFail(
					`variable '${name}' is not a bindable identifier`,
					"load",
					started
				)

		if (!this.loaded.has(hook.pluginId))
			return this.mkFail(
				`plugin '${hook.pluginId}' is not loaded`,
				"missing",
				started
			)

		const w = this.ensureWorker()
		if (!w)
			return this.mkFail(
				"the SES worker could not start — this backend is unavailable",
				"load",
				started
			)

		const job = {
			pluginId: hook.pluginId,
			hookName: hook.hookName,
			inputJson: JSON.stringify(opts.input),
			seedLabel: opts.seedLabel,
			nowMs: opts.nowMs,
			rows: opts.rows,
			// Derived here, on the host, from the kind the caller named — the
			// worker never sees the kind, only what it grants (R-3). Throws on
			// a call that names none: a host bug, surfaced loudly, never a
			// typed hook failure.
			grants: hookCtxGrants(opts.kind)
		}

		const outcome = await new Promise<EvalOutcome | Stopped>((resolve) => {
			const id = ++this.jobSeq
			// SES has no inner interrupt: the wall-clock kill IS the deadline.
			const killer = setTimeout(() => {
				this.settle(id, {
					killed: true,
					reason: `timeout after ${opts.timeoutMs}ms (worker terminated)`,
					outcome: "timeout"
				})
				void this.breakWorker(
					`terminated after ${opts.timeoutMs}ms — the hook hung`
				)
			}, opts.timeoutMs)
			this.pending.set(id, { resolve, killer, jobId: opts.jobId })
			if (opts.jobId !== undefined) this.byJobId.set(opts.jobId, id)
			w.postMessage({ t: "run", id, job })
		})

		return this.finish(outcome, started, opts.maxOutputBytes ?? 256 * 1024)
	}

	/**
	 * Fire one in-flight call's `ctx.signal`. Per call, and the same shape a
	 * hook sees on QuickJS: the message reaches the worker only while its loop
	 * is free, which is precisely when the hook is suspended at an await and
	 * able to wake. A hook that never suspends never sees it.
	 */
	abort(jobId: string): boolean {
		const id = this.byJobId.get(jobId)
		if (id === undefined || !this.pending.has(id)) return false
		this.worker?.postMessage({ t: "abort", id })
		return true
	}

	/**
	 * Stop one in-flight call for certain — at the cost of this worker, because
	 * V8 offers no interrupt point below the thread and termination is the only
	 * forced stop SES has. A SES worker hosts one plugin, so the blast radius is
	 * that plugin's *other* in-flight calls: they settle as `killed` too, naming
	 * this one. **This is not per job, and no later change can make it so** —
	 * only the cooperative `abort` above is.
	 *
	 * The cooperative abort goes first, but it is a courtesy with no guarantee:
	 * the message is queued to a worker that is about to be terminated, so only
	 * a hook already parked at an await could be reached in that window, and
	 * nothing waits to find out. A caller that wants the hook to have a real
	 * chance calls `abort`, waits, and only then kills.
	 *
	 * The sandbox itself survives: `loaded` is host-side truth, so the next call
	 * builds a fresh worker and re-stores every bundle into it.
	 */
	async kill(jobId: string): Promise<boolean> {
		const id = this.byJobId.get(jobId)
		if (id === undefined || !this.pending.has(id)) return false
		this.worker?.postMessage({ t: "abort", id })
		this.settle(id, {
			killed: true,
			reason: "the call was killed",
			outcome: "killed"
		})
		// Awaited: when this resolves the thread is genuinely gone, which is the
		// whole promise a forced kill makes.
		await this.breakWorker(
			`the worker was terminated to kill call '${jobId}'`,
			"killed"
		)
		return true
	}

	async dispose(): Promise<void> {
		void this.breakWorker("sandbox disposed")
		this.workerBroken = true
		this.loaded.clear()
	}

	/* ── internals ──────────────────────────────────────────────────────── */

	private mkFail(
		reason: string,
		outcome: "error" | "timeout" | "killed" | "load" | "missing",
		started: number
	): HookRunResult {
		return {
			ok: false,
			reason,
			logs: [],
			durationMs: Date.now() - started,
			backend: this.kind,
			outcome
		}
	}

	private finish(
		outcome: EvalOutcome | Stopped,
		started: number,
		maxOutputBytes: number
	): HookRunResult {
		if ("killed" in outcome)
			return this.mkFail(outcome.reason, outcome.outcome, started)
		if (!outcome.ok)
			return this.mkFail(
				outcome.reason,
				outcome.kind === "missing"
					? "missing"
					: outcome.kind === "load"
						? "load"
						: "error",
				started
			)
		if (Buffer.byteLength(outcome.json, "utf8") > maxOutputBytes)
			return this.mkFail(
				`output exceeds ${maxOutputBytes} bytes`,
				"error",
				started
			)
		let parsed: {
			u?: boolean
			v?: unknown
			logs?: string[]
			__miss?: boolean
		}
		try {
			parsed = JSON.parse(outcome.json)
		} catch {
			return this.mkFail(
				"hook returned a value JSON cannot carry",
				"error",
				started
			)
		}
		if (parsed.__miss)
			return this.mkFail("no such hook", "missing", started)
		return {
			ok: true,
			value: parsed.u ? undefined : parsed.v,
			logs: parsed.logs ?? [],
			durationMs: Date.now() - started,
			backend: this.kind,
			// What the hook decided about its rows, for the manager to commit.
			// A call that ended any other way carries nothing, which is what
			// makes "a killed hook commits neither half" true.
			rowChanges: outcome.rows ?? undefined
		}
	}

	/**
	 * Resolve one pending job exactly once and forget it — the single exit for
	 * every way a call can end (the worker's answer, the deadline, a kill, a
	 * broken worker), so no path can resolve twice or strand an index entry.
	 */
	private settle(id: number, outcome: EvalOutcome | Stopped): boolean {
		const entry = this.pending.get(id)
		if (!entry) return false
		this.pending.delete(id)
		if (entry.jobId !== undefined && this.byJobId.get(entry.jobId) === id)
			this.byJobId.delete(entry.jobId)
		clearTimeout(entry.killer)
		entry.resolve(outcome)
		return true
	}

	/**
	 * Terminate the worker, settling everything it was running — this is the
	 * blast radius, and every caller of it is choosing to pay for it. `stop`
	 * says what the survivors are told: a worker that failed or timed out is an
	 * error to them, a worker terminated to kill a call is a kill.
	 *
	 * Resolves when the thread is actually gone, so a caller that has promised a
	 * forced stop can wait for one.
	 */
	private breakWorker(
		reason: string,
		stop: "error" | "killed" = "error"
	): Promise<void> {
		const w = this.worker
		this.worker = null
		for (const id of [...this.pending.keys()])
			this.settle(
				id,
				stop === "killed"
					? { killed: true, reason, outcome: "killed" }
					: { ok: false, reason, kind: "error" }
			)
		// Store acks are waiters too — an unsettled one hangs `load` forever.
		for (const settle of [...this.pendingLoads.values()]) settle()
		this.pendingLoads.clear()
		return w ? w.terminate().then(() => undefined) : Promise.resolve()
	}

	private ensureWorker(): Worker | null {
		if (this.workerBroken) return null
		if (this.worker) return this.worker
		try {
			const w = new Worker(WORKER_SOURCE, { eval: true })
			w.unref()
			w.on("message", (msg: { id: number; outcome?: EvalOutcome }) => {
				if (!msg || msg.outcome === undefined) return
				this.settle(msg.id, msg.outcome)
			})
			w.on("error", () => {
				this.workerBroken = true
				console.warn(
					"[plugins] SES worker failed — this backend is unavailable"
				)
				void this.breakWorker("the SES worker failed")
			})
			this.worker = w
			for (const [id, b] of this.loaded)
				w.postMessage({
					t: "store",
					pluginId: id,
					source: b.source,
					hash: b.hash,
					config: b.config
				})
			return w
		} catch {
			this.workerBroken = true
			return null
		}
	}
}
