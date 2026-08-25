/**
 * The QuickJS (quickjs-ng, WASM) plugin backend — the secure default.
 *
 * Third-party hook code runs inside a QuickJS interpreter compiled to WASM:
 * there are no host bindings in the guest, so nothing host-side is reachable
 * unless SP explicitly bridges it (the capability bridge lands separately —
 * this foundation is deliberately **zero-callback**, exactly like the Scripts
 * sandbox: a hook receives a value and returns a value, and the whole job
 * crosses as strings).
 *
 * The design mirrors `pipelines/scripts/host.ts`: one pooled worker holds the
 * WASM module warm, each invocation gets a **fresh QuickJS runtime + context**
 * (clean per-call isolation, zero state leak), the interrupt handler enforces
 * the inner deadline between VM instructions, and a wall-clock kill terminates
 * a stuck worker as the outer backstop. `SP_PLUGINS_INLINE=1` forces the
 * in-process path (no backstop) for debugging. One evaluator source string
 * runs on both hosts, so the two paths can never drift.
 */

import { Worker } from "node:worker_threads"
import { createRequire } from "node:module"
import { AMBIENT_PRELUDE } from "./prelude"
import { STORAGE_HOST_SOURCE, type CapabilityConfig } from "./storageHost"
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
	| { ok: false; reason: string; kind: "error" | "timeout" | "load" | "missing" }

/* ── The evaluator: one self-contained source, two hosts ─────────────────── */

/**
 * A CJS module string: `module.exports = { store, drop, run }`. It owns the
 * QuickJS engine and a `bundles` map, so the worker and the inline fallback
 * share identical loading + evaluation behaviour. Nothing host-side leaks in.
 */
const EVALUATOR_SOURCE =
	"const __PRELUDE = " +
	JSON.stringify(AMBIENT_PRELUDE) +
	";\n" +
	String.raw`
const { getQuickJS } = require("quickjs-emscripten")
let enginePromise = null
const bundles = new Map()
` +
	STORAGE_HOST_SOURCE +
	CRYPTO_HOST_SOURCE +
	String.raw`
var __DENIED_STORAGE = (function () {
	function d() { throw new Error("storage: permission not granted"); }
	return { read: d, write: d, exists: d, remove: d, list: d, size: d };
})();
// Bridge a worker-scope host object into the guest as a global of host
// functions. Args/returns marshal as strings/numbers/bools/arrays; a thrown
// error (jail, quota) propagates to the guest as a real error.
function bridgeObject(context, globalName, host, names) {
	var obj = context.newObject();
	for (var ni = 0; ni < names.length; ni++) {
		(function (name) {
			var fn = context.newFunction(name, function () {
				var jsArgs = [];
				for (var i = 0; i < arguments.length; i++) {
					var h = arguments[i];
					var t = context.typeof(h);
					jsArgs.push(
						t === "string" ? context.getString(h)
						: t === "number" ? context.getNumber(h)
						: t === "undefined" ? undefined
						: context.dump(h)
					);
				}
				var r = host[name].apply(host, jsArgs);
				if (r === null || r === undefined) return context.undefined;
				if (typeof r === "string") return context.newString(r);
				if (typeof r === "boolean") return r ? context.true : context.false;
				if (typeof r === "number") return context.newNumber(r);
				if (Array.isArray(r)) {
					var arr = context.newArray();
					for (var j = 0; j < r.length; j++) {
						var e = typeof r[j] === "number"
							? context.newNumber(r[j])
							: context.newString(String(r[j]));
						context.setProp(arr, j, e);
						e.dispose();
					}
					return arr;
				}
				return context.undefined;
			});
			context.setProp(obj, name, fn);
			fn.dispose();
		})(names[ni]);
	}
	context.setProp(context.global, globalName, obj);
	obj.dispose();
}

// The plugin invocation harness — the stored bundle is wrapped so its hooks
// map is reachable, the seeded RNG / pinned clock are installed, and the whole
// result crosses as a JSON string. Kept in lockstep with QuickJsRuntime's
// contract on the host side.
function buildProgram(source, hookName, inputJson, seedLabel, nowMs) {
	return (
		'(function () {\n' +
		'"use strict";\n' +
		'var __logs = [];\n' +
		// one algorithm, one source — a roll is a pure function of the label
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
		// QuickJS lets us also pin the globals (a bonus SES cannot offer since
		// they are frozen); the canonical, cross-backend surface is ctx.*.
		'Math.random = __rng;\n' +
		'Date.now = function () { return ' + Math.floor(nowMs) + '; };\n' +
		'var __input = JSON.parse(' + JSON.stringify(inputJson) + ');\n' +
		'var ctx = {\n' +
		'  random: __rng,\n' +
		'  now: function () { return ' + Math.floor(nowMs) + '; },\n' +
		'  log: function (m) { __logs.push(String(m)); },\n' +
		'  storage: __storageHost,\n' +
		// Network is async — it lives on the SES backend only (see fetchHost).
		'  fetch: function () { throw new Error("network (fetch) requires the SES backend"); }\n' +
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
		// Foundation: zero-callback, synchronous hooks only. Async/capability
		// hooks arrive with the bridge; a thenable is refused here, loudly.
		'if (__r && typeof __r.then === "function") return JSON.stringify({ __async: true });\n' +
		'return JSON.stringify(__r === undefined\n' +
		'  ? { u: true, logs: __logs }\n' +
		'  : { u: false, v: __r, logs: __logs });\n' +
		'})()'
	)
}

module.exports = {
	store: function (pluginId, source, hash, config) {
		bundles.set(pluginId, { source: source, hash: hash, config: config })
	},
	drop: function (pluginId) {
		bundles.delete(pluginId)
	},
	run: async function (job) {
		const bundle = bundles.get(job.pluginId)
		if (!bundle)
			return { ok: false, reason: "plugin not loaded", kind: "missing" }
		const qjs = await (enginePromise || (enginePromise = getQuickJS()))
		const runtime = qjs.newRuntime()
		try {
			runtime.setMemoryLimit(job.memoryLimitBytes)
			const deadline = Date.now() + job.timeoutMs
			runtime.setInterruptHandler(function () {
				return Date.now() > deadline
			})
			const context = runtime.newContext()
			try {
				bridgeObject(
					context,
					"__storageHost",
					bundle.config && bundle.config.storageDir
						? makeStorageHost(bundle.config)
						: __DENIED_STORAGE,
					["read", "write", "exists", "remove", "list", "size"]
				)
				bridgeObject(context, "__crypto", makeCryptoHost(), [
					"randomBytes",
					"randomUUID"
				])
				const program = buildProgram(
					bundle.source,
					job.hookName,
					job.inputJson,
					job.seedLabel,
					job.nowMs
				)
				const result = context.evalCode(program)
				if (result.error) {
					const detail = context.dump(result.error)
					result.error.dispose()
					const message =
						detail && typeof detail === "object"
							? (detail.name || "Error") +
								": " +
								(detail.message || "")
							: String(detail)
					// The bundle itself failing to evaluate is a load fault;
					// an interrupt is a timeout; anything else is the hook.
					const kind = /interrupt/i.test(message)
						? "timeout"
						: "error"
					return {
						ok: false,
						reason:
							kind === "timeout"
								? "timeout after " + job.timeoutMs + "ms"
								: message,
						kind: kind
					}
				}
				const json = context.dump(result.value)
				result.value.dispose()
				return { ok: true, json: json }
			} finally {
				context.dispose()
			}
		} finally {
			runtime.dispose()
		}
	}
}
`

const WORKER_SOURCE =
	EVALUATOR_SOURCE +
	String.raw`
const { parentPort } = require("worker_threads")
parentPort.on("message", async (msg) => {
	try {
		if (msg.t === "store") {
			module.exports.store(msg.pluginId, msg.source, msg.hash, msg.config)
			parentPort.postMessage({ id: msg.id, ack: true })
			return
		}
		if (msg.t === "drop") {
			module.exports.drop(msg.pluginId)
			return
		}
		if (msg.t === "run") {
			const outcome = await module.exports.run(msg.job)
			parentPort.postMessage({ id: msg.id, outcome })
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

/* ── The host-side runtime ───────────────────────────────────────────────── */

interface Pending {
	resolve: (o: EvalOutcome) => void
	killer: NodeJS.Timeout
}

export class QuickJsRuntime implements PluginRuntime {
	readonly kind = "quickjs" as const

	/** Host-side truth: what is loaded, so a respawned worker is re-hydrated. */
	private readonly loaded = new Map<string, StoredBundle>()
	private worker: Worker | null = null
	private workerBroken = false
	private jobSeq = 0
	private readonly pending = new Map<number, Pending>()
	private inlineEval: {
		store: (p: string, s: string, h: string, c?: CapabilityConfig) => void
		drop: (p: string) => void
		run: (job: unknown) => Promise<EvalOutcome>
	} | null = null

	private readonly memoryLimitBytes: number

	constructor(opts: { memoryLimitBytes?: number } = {}) {
		this.memoryLimitBytes = opts.memoryLimitBytes ?? 64 * 1024 * 1024
	}

	async load(
		pluginId: string,
		bundleSource: string,
		bundleHash: string,
		config?: CapabilityConfig
	): Promise<void> {
		const prev = this.loaded.get(pluginId)
		if (prev && prev.hash === bundleHash) return // idempotent on identical bytes
		this.loaded.set(pluginId, {
			source: bundleSource,
			hash: bundleHash,
			config
		})
		const w = this.ensureWorker()
		if (!w) {
			this.inline().store(pluginId, bundleSource, bundleHash, config)
			return
		}
		await new Promise<void>((resolve) => {
			const id = ++this.jobSeq
			const once = (msg: { id: number; ack?: boolean }) => {
				if (msg.id !== id) return
				w.off("message", once)
				resolve()
			}
			w.on("message", once)
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
		this.inlineEval?.drop(pluginId)
		this.worker?.postMessage({ t: "drop", pluginId })
	}

	async invoke(hook: HookRef, opts: InvokeOptions): Promise<HookRunResult> {
		const started = Date.now()

		for (const name of Object.keys(opts.input))
			if (!IDENT.test(name))
				return this.mkFail(
					`variable '${name}' is not a bindable identifier`,
					"load",
					started,
					[]
				)

		if (!this.loaded.has(hook.pluginId))
			return this.mkFail(
				`plugin '${hook.pluginId}' is not loaded`,
				"missing",
				started,
				[]
			)

		const job = {
			pluginId: hook.pluginId,
			hookName: hook.hookName,
			inputJson: JSON.stringify(opts.input),
			seedLabel: opts.seedLabel,
			nowMs: opts.nowMs,
			timeoutMs: opts.timeoutMs,
			memoryLimitBytes: this.memoryLimitBytes
		}

		const outcome = await this.evaluate(job, opts.timeoutMs)
		return this.finish(outcome, started, opts.maxOutputBytes ?? 256 * 1024)
	}

	async dispose(): Promise<void> {
		this.breakWorker("runtime disposed")
		this.workerBroken = true
		this.loaded.clear()
		this.inlineEval = null
	}

	/* ── internals ──────────────────────────────────────────────────────── */

	private mkFail(
		reason: string,
		outcome: "error" | "timeout" | "killed" | "load" | "missing",
		started: number,
		logs: string[]
	): HookRunResult {
		return {
			ok: false,
			reason,
			logs,
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
			return this.mkFail(outcome.reason, "killed", started, [])
		if (!outcome.ok)
			return this.mkFail(
				outcome.reason,
				outcome.kind === "timeout"
					? "timeout"
					: outcome.kind === "missing"
						? "missing"
						: outcome.kind === "load"
							? "load"
							: "error",
				started,
				[]
			)
		if (Buffer.byteLength(outcome.json, "utf8") > maxOutputBytes)
			return this.mkFail(
				`output exceeds ${maxOutputBytes} bytes`,
				"error",
				started,
				[]
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
				started,
				[]
			)
		}
		if (parsed.__miss)
			return this.mkFail("no such hook", "missing", started, [])
		if (parsed.__async)
			return this.mkFail(
				"async hooks require the capability bridge (not yet enabled)",
				"error",
				started,
				[]
			)
		return {
			ok: true,
			value: parsed.u ? undefined : parsed.v,
			logs: parsed.logs ?? [],
			durationMs: Date.now() - started,
			backend: this.kind
		}
	}

	private inline() {
		if (!this.inlineEval) {
			const shim = { exports: null as unknown }
			new Function("require", "module", EVALUATOR_SOURCE)(
				createRequire(import.meta.url),
				shim
			)
			this.inlineEval = shim.exports as QuickJsRuntime["inlineEval"]
			// re-hydrate anything already loaded
			for (const [id, b] of this.loaded)
				this.inlineEval!.store(id, b.source, b.hash, b.config)
		}
		return this.inlineEval!
	}

	private breakWorker(reason: string): void {
		const w = this.worker
		this.worker = null
		for (const [, entry] of this.pending) {
			clearTimeout(entry.killer)
			entry.resolve({ ok: false, reason, kind: "error" })
		}
		this.pending.clear()
		if (w) void w.terminate()
	}

	private ensureWorker(): Worker | null {
		if (this.workerBroken || process.env.SP_PLUGINS_INLINE === "1")
			return null
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
					"[plugins] QuickJS worker failed — falling back to in-process evaluation"
				)
				this.breakWorker("the evaluation worker failed — retried inline")
			})
			this.worker = w
			// re-hydrate bundles into the fresh worker
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

	private async evaluate(
		job: unknown,
		timeoutMs: number
	): Promise<EvalOutcome | { killed: true; reason: string }> {
		const w = this.ensureWorker()
		if (!w) {
			try {
				return await this.inline().run(job)
			} catch (e) {
				return {
					ok: false,
					reason: String((e as Error)?.message || e),
					kind: "error"
				}
			}
		}
		return await new Promise((resolve) => {
			const id = ++this.jobSeq
			// The absolute backstop: the interrupt should fire first; if a gap
			// ever lets a hook run past it, the worker dies and the server does
			// not. Grace over the inner clock so a healthy near-deadline hook
			// is never killed by the outer one.
			const killer = setTimeout(() => {
				this.pending.delete(id)
				this.breakWorker(`killed after ${timeoutMs}ms — the hook hung`)
				resolve({
					killed: true,
					reason: `timeout after ${timeoutMs}ms (worker killed)`
				})
			}, timeoutMs + 1000)
			this.pending.set(id, { resolve: resolve as Pending["resolve"], killer })
			w.postMessage({ t: "run", id, job })
		})
	}
}
