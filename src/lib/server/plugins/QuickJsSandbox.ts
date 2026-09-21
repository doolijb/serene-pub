/**
 * The QuickJS (quickjs-ng, WASM) plugin backend — the secure default.
 *
 * Third-party hook code runs inside a QuickJS interpreter compiled to WASM:
 * there are no host bindings in the guest, so nothing host-side is reachable
 * unless SP explicitly bridges it. The capability bridge's first capability is
 * **abort**: `ctx.signal` is an AbortSignal built inside the sandbox, and the
 * host fires it through a callback the program registers before the bundle is
 * evaluated. Enabling it meant enabling async hooks — a hook can only observe
 * an abort by being suspended at an `await` — so the host now drives the job
 * queue rather than refusing a thenable.
 *
 * That drive loop is also what lets the **network** permission live here rather
 * than on SES alone. A fetch cannot answer by value, so `bridgeFetch` hands the
 * guest a promise the *host* holds the resolvers for (`context.newPromise`) and
 * settles it when the real request lands; the loop pumps the job queue in the
 * gaps, which is what wakes the hook. Same allowlist, same SSRF re-validation
 * per redirect hop, same cancellation refusal — one `fetchHost.ts` source, so
 * neither backend can drift from the other's rules.
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
import {
	STORAGE_HOST_SOURCE,
	permissionKey,
	type PermissionConfig,
	type PluginRowChange
} from "./storageHost"
import { CRYPTO_HOST_SOURCE } from "./cryptoHost"
import { FETCH_HOST_SOURCE } from "./fetchHost"
import { hookCtxGrants } from "./hookCtx"
import type {
	HookRef,
	HookRunResult,
	InvokeOptions,
	PluginSandbox
} from "./types"

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/**
 * The per-call stop flags: one Int32 slot in a SharedArrayBuffer the host and
 * the evaluator both hold. Bit 1 asks the hook to wind itself down (the guest's
 * `ctx.signal`), bit 2 forces its interrupt. Defined once here and spliced into
 * the evaluator source below, so the two sides cannot drift apart.
 */
const STOP_ABORT = 1
const STOP_KILL = 2

interface StoredBundle {
	source: string
	hash: string
	config?: PermissionConfig
}

type EvalOutcome =
	| { ok: true; json: string; rows?: PluginRowChange[] | null }
	| {
			ok: false
			reason: string
			kind: "error" | "timeout" | "killed" | "load" | "missing"
	  }

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
	`const STOP_ABORT = ${STOP_ABORT}\nconst STOP_KILL = ${STOP_KILL}\n` +
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
// Marshal a host value into the guest, by value and to the bottom. Objects and
// arrays cross as fresh guest objects — the storage host answers with
// StorageUsage, WriteReceipt and RowPage, and a bridge that could only carry
// scalars would have silently returned undefined for every one of them.
//
// null and undefined stay distinct: a stored row value of null is not a missing
// row, and files.stat answers null where get answers undefined. The three
// constant handles are StaticLifetimes whose dispose() is a no-op, so the
// recursive caller can dispose uniformly without special-casing them.
function toGuest(context, r) {
	if (r === undefined) return context.undefined;
	if (r === null) return context.null;
	if (typeof r === "string") return context.newString(r);
	if (typeof r === "boolean") return r ? context.true : context.false;
	if (typeof r === "number") return context.newNumber(r);
	if (Array.isArray(r)) {
		var arr = context.newArray();
		for (var j = 0; j < r.length; j++) {
			var e = toGuest(context, r[j]);
			context.setProp(arr, j, e);
			e.dispose();
		}
		return arr;
	}
	if (typeof r === "object") {
		var obj = context.newObject();
		var ks = Object.keys(r);
		for (var k = 0; k < ks.length; k++) {
			var v = toGuest(context, r[ks[k]]);
			context.setProp(obj, ks[k], v);
			v.dispose();
		}
		return obj;
	}
	// A function or a symbol: nothing a host capability should be handing out,
	// and undefined is the honest answer rather than a half-marshalled one.
	return context.undefined;
}

// Bridge a worker-scope host object into the guest as a global of host
// functions. A member that is itself an object becomes a nested namespace
// (ctx.storage.files), so the guest sees the shape the host declares rather
// than a flattened one. A names list may pin the members to bridge; omitted, the
// host object's own keys are used — which is what keeps the storage bridge
// from drifting out of step with the store it bridges.
function bridgeObject(context, globalName, host, names) {
	var obj = buildBridge(context, host, names);
	context.setProp(context.global, globalName, obj);
	obj.dispose();
}
// One argument, guest handle -> host value. Shared by every bridge below so a
// capability cannot be handed a differently-marshalled argument depending on
// which bridge it went through.
function hostArg(context, h) {
	if (h === undefined) return undefined;
	var t = context.typeof(h);
	return t === "string" ? context.getString(h)
		: t === "number" ? context.getNumber(h)
		: t === "undefined" ? undefined
		: context.dump(h);
}
function buildBridge(context, host, names) {
	var obj = context.newObject();
	var keys = names || Object.keys(host);
	for (var ni = 0; ni < keys.length; ni++) {
		(function (name) {
			var member = host[name];
			if (member && typeof member === "object") {
				var nested = buildBridge(context, member, null);
				context.setProp(obj, name, nested);
				nested.dispose();
				return;
			}
			if (typeof member !== "function") return;
			var fn = context.newFunction(name, function () {
				var jsArgs = [];
				for (var i = 0; i < arguments.length; i++)
					jsArgs.push(hostArg(context, arguments[i]));
				// A thrown error (jail, quota, permission) propagates to the
				// guest as a real error, as it always has.
				return toGuest(context, member.apply(host, jsArgs));
			});
			context.setProp(obj, name, fn);
			fn.dispose();
		})(keys[ni]);
	}
	return obj;
}

// The network bridge — the one permission whose answer cannot cross by value.
//
// Every other bridged member is synchronous: the host computes, toGuest
// marshals, done. A fetch has not happened yet when the guest asks, and a host
// Promise is not a value QuickJS has any form for — toGuest would walk it as a
// plain object and hand back an empty one. So the direction is reversed: the
// *guest's* promise is created here (context.newPromise), the host keeps its
// resolvers, and the host settles it when the real fetch does. That is the piece
// that was missing; the drive loop below is what makes it work, because it pumps
// the job queue while the hook is parked at its await and so has somewhere to
// wake to.
//
// alive() is the frame guard, and the open set is what makes it safe. A hook
// that starts a fetch and returns (or is killed, or times out) without awaiting
// it leaves this in flight, and by the time it lands the context these handles
// belong to is gone — settling into it would be a use-after-free inside WASM.
// So the settle is dropped; but the resolve/reject handles cannot merely be
// abandoned, because they hold live QuickJS objects and JS_FreeRuntime asserts
// its GC list is empty. Every unsettled deferred is therefore tracked in the
// open set and disposed with the frame, before the context goes.
function bridgeFetch(context, hostFetch, alive, open) {
	var fn = context.newFunction("__fetch", function (urlHandle, optsHandle) {
		var url = hostArg(context, urlHandle);
		var optsJson = hostArg(context, optsHandle);
		// Started before the guest promise exists, so the no-grant refusal —
		// which throws rather than rejecting, exactly as it does on SES —
		// leaves no half-built promise behind.
		var pending = hostFetch(url, optsJson);
		var deferred = context.newPromise();
		open.add(deferred);
		pending.then(
			function (value) {
				if (!alive()) return;
				open.delete(deferred);
				var h = toGuest(context, value);
				// resolve() disposes the resolvers itself; the promise handle
				// was consumed by the VM when this function returned it.
				deferred.resolve(h);
				h.dispose();
			},
			function (e) {
				if (!alive()) return;
				open.delete(deferred);
				// Name and message both, so a refusal reads the same here as
				// the thrown Error a hook catches on SES.
				var h = context.newError({
					name: String((e && e.name) || "Error"),
					message: String((e && e.message) || e)
				});
				deferred.reject(h);
				h.dispose();
			}
		);
		return deferred.handle;
	});
	context.setProp(context.global, "__fetch", fn);
	fn.dispose();
}

// Why a call failed, decided from host-side truth first: the interrupt handler
// fires for exactly two reasons, and the flags say which. The message is only a
// hint — a hook can throw an Error that reads like an interrupt — so it decides
// nothing a flag can decide.
function classifyFailure(detail, flags, timeoutMs) {
	var message =
		detail && typeof detail === "object"
			? (detail.name || "Error") + ": " + (detail.message || "")
			: String(detail)
	if ((Atomics.load(flags, 0) & STOP_KILL) !== 0)
		return { ok: false, reason: "killed by the host", kind: "killed" }
	if (/interrupt/i.test(message))
		return {
			ok: false,
			reason: "timeout after " + timeoutMs + "ms",
			kind: "timeout"
		}
	return { ok: false, reason: message, kind: "error" }
}

// The plugin invocation harness — the stored bundle is wrapped so its hooks
// map is reachable, the seeded RNG / pinned clock are installed, and the whole
// result crosses as a JSON string. Kept in lockstep with QuickJsSandbox's
// contract on the host side.
// grants: what the host derived from the hook's kind (hookCtx.ts, R-3). A
// ctx member the kind is not granted is absent, not a stub that refuses, so
// Object.keys(ctx) says exactly what the hook may reach.
function buildProgram(source, hookName, inputJson, seedLabel, nowMs, grants) {
	return (
		'(async function () {\n' +
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
		// Every argument survives: the SDK declares log(level, message, detail?),
		// and the formatter is the prelude's — spliced just below, shared by both
		// backends so a hook cannot tell them apart by what its logs look like.
		'  log: function () { __logs.push(__fmtLog(arguments)); }' +
		(grants.storage ? ',\n  storage: __storageHost' : '') +
		// Byte-for-byte the SES line: init crosses as JSON, and the host
		// function behind __fetch answers with a guest promise (bridgeFetch
		// above). A hook must not be able to tell the two apart.
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
		// controller is the prelude's — nothing host-side crosses here, only a
		// callback the host can fire while the hook is suspended.
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
		// Async hooks run here: the host drives the job queue and fires
		// ctx.signal in the gaps between turns — the only moment a suspended
		// hook can observe one, and so the reason async had to be enabled.
		'if (__r && typeof __r.then === "function") __r = await __r;\n' +
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
		// Shared memory, not a message: a synchronous hook blocks this worker's
		// event loop, so a postMessage would sit in a queue the runaway call
		// never lets us drain — while the interrupt handler runs *between VM
		// instructions*, inside that blocked call, and can read the buffer at
		// any moment.
		// Defensive: a job without a slot would make Atomics.load throw inside
		// the interrupt handler, i.e. a worker crash in the one place that must
		// not have one. An unaddressable call simply runs to its deadline.
		const flags = new Int32Array(job.stopFlags || new SharedArrayBuffer(4))
		// This call's storage transaction: buffered until the hook returns, and
		// dropped with the frame on every other ending. The kill flag unwinds
		// the guest between VM instructions, which is precisely the moment a
		// write-through store would be caught half-done.
		// The host loaded this plugin's rows before it posted the job; they seed
		// the transaction's row projection, and its diff comes back with the
		// result for the host to commit. Nothing in here holds a database
		// handle. The one async permission that now exists on this backend —
		// fetch — reaches the network and never a database, so there is still
		// nothing in here that could use one.
		// Only for a kind granted storage (R-3): a task's call opens no
		// transaction and commits no rows.
		const tx =
			job.grants.storage && bundle.config && bundle.config.storageDir
				? makeStorageHost(bundle.config, job.rows, job.nowMs)
				: null
		const runtime = qjs.newRuntime()
		try {
			runtime.setMemoryLimit(job.memoryLimitBytes)
			const deadline = Date.now() + job.timeoutMs
			// The runtime is per call, so the interrupt is too: stopping this
			// hook stops this hook, and every other job on the shared worker
			// runs on untouched. The guest cannot catch it — QuickJS marks the
			// interrupt error uncatchable, so a try/catch cannot survive a kill.
			runtime.setInterruptHandler(function () {
				return (
					(Atomics.load(flags, 0) & STOP_KILL) !== 0 ||
					Date.now() > deadline
				)
			})
			const context = runtime.newContext()
			// The guest's own abort trigger, handed over by the program's
			// preamble. The host holds it, so a hook cannot revoke it.
			let fire = null
			// Whether this call's context is still standing. Read by the fetch
			// bridge's settle callbacks, which can land after any ending.
			let contextLive = true
			// Deferreds handed to the guest that have not settled yet.
			const openFetches = new Set()
			try {
				// The two permission-gated hosts are bridged only for a kind
				// granted them — absent from the ctx AND from the globals, so a
				// hook cannot reach past the ctx to a name the program never
				// mentions (R-3).
				if (job.grants.storage)
					bridgeObject(
						context,
						"__storageHost",
						tx ? tx.api : __DENIED_STORAGE
					)
				bridgeObject(context, "__crypto", makeCryptoHost(), [
					"randomBytes",
					"randomUUID"
				])
				// Network. The allowlist is the grant the host derived (never
				// the raw manifest), and the cancellation view is this call's
				// own abort flag — read live, so the refusal covers the first
				// request and every redirect hop after it.
				if (job.grants.fetch)
					bridgeFetch(
						context,
						fetchHostFor(bundle.config, function () {
							return (Atomics.load(flags, 0) & STOP_ABORT) !== 0
						}),
						function () {
							return contextLive
						},
						openFetches
					)
				const reg = context.newFunction(
					"__registerAbort",
					function (fnHandle) {
						if (!fire && context.typeof(fnHandle) === "function")
							fire = fnHandle.dup()
						return context.undefined
					}
				)
				context.setProp(context.global, "__registerAbort", reg)
				reg.dispose()
				const program = buildProgram(
					bundle.source,
					job.hookName,
					job.inputJson,
					job.seedLabel,
					job.nowMs,
					job.grants
				)
				const evaluated = context.evalCode(program)
				if (evaluated.error) {
					const detail = context.dump(evaluated.error)
					evaluated.error.dispose()
					return classifyFailure(detail, flags, job.timeoutMs)
				}
				// The program is an async IIFE, so this is a promise: drive the
				// job queue until it settles, and use the gaps — the only
				// moments the hook is suspended — to deliver an abort.
				const promise = evaluated.value
				try {
					let delivered = false
					for (;;) {
						const pendingJobs = runtime.executePendingJobs()
						if (pendingJobs.error) {
							const detail = context.dump(pendingJobs.error)
							pendingJobs.error.dispose()
							return classifyFailure(detail, flags, job.timeoutMs)
						}
						const state = context.getPromiseState(promise)
						if (state.type === "fulfilled") {
							const json = context.dump(state.value)
							// A non-promise value comes back as the very handle
							// we passed in; disposing it twice is a use-after-free.
							if (state.value !== promise) state.value.dispose()
							// The hook returned: only now do its writes become
							// real. A commit that cannot be applied throws, and
							// the worker reports the call as failed rather than
							// letting it pass as a success whose data never
							// landed. Files land here; the ROW diff only rides
							// back on the outcome, so a file commit that threw
							// carries no rows and the host commits none.
							const rows = tx ? tx.commit() : null
							return { ok: true, json: json, rows: rows }
						}
						if (state.type === "rejected") {
							const detail = context.dump(state.error)
							state.error.dispose()
							return classifyFailure(detail, flags, job.timeoutMs)
						}
						const f = Atomics.load(flags, 0)
						// Forced: nothing is waited for. The suspended frame
						// is abandoned and the whole per-call runtime goes with
						// it, below in the finally.
						if ((f & STOP_KILL) !== 0)
							return {
								ok: false,
								reason: "killed by the host",
								kind: "killed"
							}
						// Cooperative: the frame *is* suspended, which is
						// exactly what makes this safe — the hook wakes at its
						// own await point with its locals still in scope.
						if ((f & STOP_ABORT) !== 0 && !delivered && fire) {
							delivered = true
							const fired = context.callFunction(
								fire,
								context.undefined
							)
							// A throwing abort listener is the hook's own
							// problem; it keeps its deadline either way.
							if (fired.error) fired.error.dispose()
							else fired.value.dispose()
							continue
						}
						if (Date.now() > deadline)
							return {
								ok: false,
								reason: "timeout after " + job.timeoutMs + "ms",
								kind: "timeout"
							}
						// Yield the thread: the deadline has to keep advancing,
						// and this is where a concurrent job on this worker gets
						// its turn.
						await new Promise(function (r) {
							setTimeout(r, 1)
						})
					}
				} finally {
					promise.dispose()
				}
			} finally {
				// Before anything is disposed: a fetch still in flight settles
				// on a later turn of this worker's loop, and from here on there
				// is no context left for it to settle into.
				contextLive = false
				// Its resolvers are live guest objects even so, and the runtime
				// refuses to free while any survive.
				openFetches.forEach(function (d) {
					try { d.dispose() } catch (e) {}
				})
				openFetches.clear()
				if (fire) fire.dispose()
				context.dispose()
			}
		} finally {
			runtime.dispose()
			// Every ending that is not the commit above — killed, timed out,
			// threw, failed to load — drops the buffer unapplied. A no-op after
			// a commit, and the only other way a transaction can end.
			if (tx) tx.discard()
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

/* ── The host-side sandbox ───────────────────────────────────────────────── */

interface Pending {
	resolve: (o: EvalOutcome | { killed: true; reason: string }) => void
	/** The outer wall-clock backstop. Absent on the inline path, which has none. */
	killer?: NodeJS.Timeout
	/** This call's stop flags, the same slot the evaluator's interrupt reads. */
	flags: Int32Array
	/** The caller's handle for this call, when it gave one. */
	jobId?: string
}

export class QuickJsSandbox implements PluginSandbox {
	readonly kind = "quickjs" as const

	/** Host-side truth: what is loaded, so a respawned worker is re-hydrated. */
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
	private inlineEval: {
		store: (p: string, s: string, h: string, c?: PermissionConfig) => void
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
		if (!w) {
			this.inline().store(pluginId, bundleSource, bundleHash, config)
			return
		}
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
			memoryLimitBytes: this.memoryLimitBytes,
			rows: opts.rows,
			// Derived here, on the host, from the kind the caller named — the
			// worker never sees the kind, only what it grants (R-3). Throws on
			// a call that names none: a host bug, surfaced loudly, never a
			// typed hook failure.
			grants: hookCtxGrants(opts.kind)
		}

		const outcome = await this.evaluate(job, opts.timeoutMs, opts.jobId)
		return this.finish(outcome, started, opts.maxOutputBytes ?? 256 * 1024)
	}

	/**
	 * Fire one in-flight call's `ctx.signal`. Per-call and nothing more: the
	 * flag is raised here, and the evaluator's drive loop delivers it the next
	 * time that hook is suspended at an await. A hook that never suspends never
	 * sees it — which is the honest shape of cooperative cancellation, not a
	 * defect to work around.
	 */
	abort(jobId: string): boolean {
		const job = this.jobFor(jobId)
		if (!job) return false
		// `or`, not `store`: a kill flag already raised must not be lowered.
		Atomics.or(job.entry.flags, 0, STOP_ABORT)
		return true
	}

	/**
	 * Stop one in-flight call for certain — and only that one. The kill flag
	 * makes this call's own interrupt handler fire between VM instructions, so
	 * the hook unwinds wherever it is (the interrupt is uncatchable, so no
	 * `try`/`catch` survives it) and every other job on the shared sandbox keeps
	 * running. Nothing is disposed; the worker, the engine and every loaded
	 * bundle are untouched.
	 *
	 * The caller stops waiting immediately: the flag guarantees the call ends,
	 * so there is nothing to be gained by waiting for the evaluator to say so,
	 * and a late outcome for a settled job is ignored. No cooperative abort is
	 * fired first — this is the forced path, and a caller that wants the hook to
	 * wind itself down calls `abort`, waits, and only then kills.
	 */
	async kill(jobId: string): Promise<boolean> {
		const job = this.jobFor(jobId)
		if (!job) return false
		Atomics.or(job.entry.flags, 0, STOP_KILL)
		this.settle(job.id, { killed: true, reason: "the call was killed" })
		return true
	}

	async dispose(): Promise<void> {
		this.breakWorker("sandbox disposed")
		this.workerBroken = true
		this.loaded.clear()
		this.inlineEval = null
	}

	/* ── internals ──────────────────────────────────────────────────────── */

	/** The in-flight job a caller's handle addresses, if it is still running. */
	private jobFor(jobId: string): { id: number; entry: Pending } | undefined {
		const id = this.byJobId.get(jobId)
		if (id === undefined) return undefined
		const entry = this.pending.get(id)
		return entry ? { id, entry } : undefined
	}

	/**
	 * Resolve one pending job exactly once and forget it — the single exit for
	 * every way a call can end (the worker's answer, the backstop, a kill, a
	 * broken worker), so no path can resolve twice or strand an index entry.
	 */
	private settle(
		id: number,
		outcome: EvalOutcome | { killed: true; reason: string }
	): boolean {
		const entry = this.pending.get(id)
		if (!entry) return false
		this.pending.delete(id)
		if (entry.jobId !== undefined && this.byJobId.get(entry.jobId) === id)
			this.byJobId.delete(entry.jobId)
		if (entry.killer) clearTimeout(entry.killer)
		entry.resolve(outcome)
		return true
	}

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
					: outcome.kind === "killed"
						? "killed"
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

	private inline() {
		if (!this.inlineEval) {
			const shim = { exports: null as unknown }
			new Function("require", "module", EVALUATOR_SOURCE)(
				createRequire(import.meta.url),
				shim
			)
			this.inlineEval = shim.exports as QuickJsSandbox["inlineEval"]
			// re-hydrate anything already loaded
			for (const [id, b] of this.loaded)
				this.inlineEval!.store(id, b.source, b.hash, b.config)
		}
		return this.inlineEval!
	}

	private breakWorker(reason: string): void {
		const w = this.worker
		this.worker = null
		// Everything this worker was running dies with it, target and bystanders
		// alike — which is what makes it the backstop rather than a kill.
		for (const id of [...this.pending.keys()])
			this.settle(id, { ok: false, reason, kind: "error" })
		// Store acks are waiters too — an unsettled one hangs `load` forever.
		for (const settle of [...this.pendingLoads.values()]) settle()
		this.pendingLoads.clear()
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
				this.settle(msg.id, msg.outcome)
			})
			w.on("error", () => {
				this.workerBroken = true
				console.warn(
					"[plugins] QuickJS worker failed — falling back to in-process evaluation"
				)
				this.breakWorker(
					"the evaluation worker failed — retried inline"
				)
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
		job: Record<string, unknown>,
		timeoutMs: number,
		jobId?: string
	): Promise<EvalOutcome | { killed: true; reason: string }> {
		// One slot, allocated per call and handed to the evaluator with the job:
		// the runtime that runs it is per call too, so a flag can never address
		// the wrong hook, and there are no slots to recycle or collide.
		const stopFlags = new SharedArrayBuffer(4)
		const flags = new Int32Array(stopFlags)
		const w = this.ensureWorker()
		return await new Promise((resolve) => {
			const id = ++this.jobSeq
			const entry: Pending = {
				resolve: resolve as Pending["resolve"],
				flags,
				jobId
			}
			this.pending.set(id, entry)
			if (jobId !== undefined) this.byJobId.set(jobId, id)
			if (!w) {
				// The inline (debug) path has no worker and so no backstop — but
				// the flags are plain shared memory, so `abort` and `kill` reach
				// the same drive loop they do in the worker.
				try {
					this.inline()
						.run({ ...job, stopFlags })
						.then(
							(o) => this.settle(id, o),
							(e) =>
								this.settle(id, {
									ok: false,
									reason: String((e as Error)?.message || e),
									kind: "error"
								})
						)
				} catch (e) {
					this.settle(id, {
						ok: false,
						reason: String((e as Error)?.message || e),
						kind: "error"
					})
				}
				return
			}
			// The absolute backstop: the interrupt should fire first; if a gap
			// ever lets a hook run past it, the worker dies and the server does
			// not. Grace over the inner clock so a healthy near-deadline hook
			// is never killed by the outer one.
			entry.killer = setTimeout(() => {
				this.settle(id, {
					killed: true,
					reason: `timeout after ${timeoutMs}ms (worker killed)`
				})
				this.breakWorker(`killed after ${timeoutMs}ms — the hook hung`)
			}, timeoutMs + 1000)
			w.postMessage({ t: "run", id, job: { ...job, stopFlags } })
		})
	}
}
