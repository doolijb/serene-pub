/**
 * The SES (Hardened JavaScript) plugin backend — the faster fallback.
 *
 * Third-party hook code runs on full V8 inside a SES `Compartment`: frozen
 * primordials, no ambient authority, only the endowments SP hands in. It is
 * faster than QuickJS and can run the plugin's own WebAssembly, at the cost of
 * a weaker confinement primitive — which is why it is the opt-in side of the
 * security/speed dial, never the default.
 *
 * Two hard differences from `QuickJsRuntime`, both from SES's nature:
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
 * Foundation scope matches QuickJS: zero-callback, synchronous hooks, one
 * evaluator, fresh Compartment per call. `Math.random`/`Date.now` are omitted
 * by SES and cannot be reassigned (frozen), so determinism is via `ctx.random`
 * / `ctx.now` only — a hook that reaches for the globals is a parity risk the
 * conformance harness flags.
 */

import { Worker } from "node:worker_threads"
import { AMBIENT_PRELUDE } from "./prelude"
import {
	STORAGE_HOST_SOURCE,
	capabilityKey,
	type CapabilityConfig
} from "./storageHost"
import { FETCH_HOST_SOURCE } from "./fetchHost"
import { CRYPTO_HOST_SOURCE } from "./cryptoHost"
import type {
	HookRef,
	HookRunResult,
	InvokeOptions,
	PluginRuntime
} from "./types"

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

interface StoredBundle {
	source: string
	hash: string
	config?: CapabilityConfig
}

type EvalOutcome =
	| { ok: true; json: string }
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
	return { read: d, write: d, exists: d, remove: d, list: d, size: d };
})();
var __DENIED_FETCH = function () { throw new Error("network: permission not granted"); };
const { parentPort } = require("worker_threads")
const bundles = new Map()

function buildProgram(source, hookName, inputJson, seedLabel, nowMs) {
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
		'  log: function (m) { __logs.push(String(m)); },\n' +
		'  storage: __storage,\n' +
		'  fetch: function (url, opts) { return __fetch(url, opts ? JSON.stringify(opts) : undefined); }\n' +
		'};\n' +
		__PRELUDE + '\n' +
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
			// A fresh Compartment per call: no ambient authority, only frozen
			// intrinsics; every call starts from the same clean world.
			const compartment = new Compartment({ __storage: harden(bundle.config && bundle.config.storageDir ? makeStorageHost(bundle.config) : __DENIED_STORAGE), __fetch: harden(bundle.config && bundle.config.networkHosts ? makeFetchHost(bundle.config.networkHosts) : __DENIED_FETCH), __crypto: harden(makeCryptoHost()) })
			const program = buildProgram(
				bundle.source,
				job.hookName,
				job.inputJson,
				job.seedLabel,
				job.nowMs
			)
			const json = await compartment.evaluate(program)
			parentPort.postMessage({ id: msg.id, outcome: { ok: true, json } })
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

interface Pending {
	resolve: (o: EvalOutcome | { killed: true; reason: string }) => void
	killer: NodeJS.Timeout
}

export class SesWorkerRuntime implements PluginRuntime {
	readonly kind = "ses" as const

	private readonly loaded = new Map<string, StoredBundle>()
	private worker: Worker | null = null
	private workerBroken = false
	private jobSeq = 0
	private readonly pending = new Map<number, Pending>()
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
		config?: CapabilityConfig
	): Promise<void> {
		const prev = this.loaded.get(pluginId)
		// Identical bytes *and* identical grants. Anything else has to re-store:
		// a narrowed capability arriving with the same bundle must not be
		// discarded as a no-op, whatever the caller's own bookkeeping believes.
		if (
			prev &&
			prev.hash === bundleHash &&
			capabilityKey(prev.config) === capabilityKey(config)
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
			nowMs: opts.nowMs
		}

		const outcome = await new Promise<
			EvalOutcome | { killed: true; reason: string }
		>((resolve) => {
			const id = ++this.jobSeq
			// SES has no inner interrupt: the wall-clock kill IS the deadline.
			const killer = setTimeout(() => {
				this.pending.delete(id)
				this.breakWorker(`terminated after ${opts.timeoutMs}ms — the hook hung`)
				resolve({
					killed: true,
					reason: `timeout after ${opts.timeoutMs}ms (worker terminated)`
				})
			}, opts.timeoutMs)
			this.pending.set(id, { resolve, killer })
			w.postMessage({ t: "run", id, job })
		})

		return this.finish(outcome, started, opts.maxOutputBytes ?? 256 * 1024)
	}

	async dispose(): Promise<void> {
		this.breakWorker("runtime disposed")
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
		outcome: EvalOutcome | { killed: true; reason: string },
		started: number,
		maxOutputBytes: number
	): HookRunResult {
		if ("killed" in outcome)
			return this.mkFail(outcome.reason, "timeout", started)
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
			__async?: boolean
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
		if (parsed.__miss) return this.mkFail("no such hook", "missing", started)
		if (parsed.__async)
			return this.mkFail(
				"async hooks require the capability bridge (not yet enabled)",
				"error",
				started
			)
		return {
			ok: true,
			value: parsed.u ? undefined : parsed.v,
			logs: parsed.logs ?? [],
			durationMs: Date.now() - started,
			backend: this.kind
		}
	}

	private breakWorker(reason: string): void {
		const w = this.worker
		this.worker = null
		for (const [, entry] of this.pending) {
			clearTimeout(entry.killer)
			entry.resolve({ ok: false, reason, kind: "error" })
		}
		this.pending.clear()
		// Store acks are waiters too — an unsettled one hangs `load` forever.
		for (const settle of [...this.pendingLoads.values()]) settle()
		this.pendingLoads.clear()
		if (w) void w.terminate()
	}

	private ensureWorker(): Worker | null {
		if (this.workerBroken) return null
		if (this.worker) return this.worker
		try {
			const w = new Worker(WORKER_SOURCE, { eval: true })
			w.unref()
			w.on("message", (msg: { id: number; outcome?: EvalOutcome }) => {
				if (!msg || msg.outcome === undefined) return
				const entry = this.pending.get(msg.id)
				if (!entry) return
				this.pending.delete(msg.id)
				clearTimeout(entry.killer)
				entry.resolve(msg.outcome)
			})
			w.on("error", () => {
				this.workerBroken = true
				console.warn(
					"[plugins] SES worker failed — this backend is unavailable"
				)
				this.breakWorker("the SES worker failed")
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
