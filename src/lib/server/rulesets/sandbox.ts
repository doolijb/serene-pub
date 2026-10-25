/**
 * 🚧 **The rules sandbox** — one QuickJS context per resolve (PLAN-rulesets-
 * functions D3, 2026-10-23).
 *
 * The pipeline's script host (`pipelines/scripts/host.ts`) evaluates one
 * self-contained program per job: a fresh runtime, the source, the answer,
 * gone. A ruleset's functions run many times a moment — every owner, every
 * phase, every check — so a resolve opens ONE context here, loads each
 * function module into it once (keyed by its content hash, the program
 * itself cached across resolves), calls its handlers as often as the moment
 * needs, and closes it. One **budget per turn** bounds the whole: every call
 * spends from it, and a call past what is left is refused before it starts.
 *
 * ## Same engine, same posture
 *
 * QuickJS in WASM, zero-callback: nothing host-side is bridged. The
 * evaluator below is one source string run by a worker (the default) or, if
 * the worker cannot start or `SP_SCRIPTS_INLINE=1`, in-process — byte-
 * identical code either way, exactly as the script host does it. Inside, the
 * interrupt handler enforces each call's deadline; outside, the worker's
 * wall clock kills a call that outlives it (and every context the worker
 * held — their later calls fail, which the rules degrade on, never halt).
 *
 * ## Determinism
 *
 * Every call is handed a seed label: `Math.random` (and `ctx.random`) is
 * re-seeded from it before the handler runs and `Date.now()` is pinned to 0,
 * so a call's rolls are a function of its label alone — whatever ran before
 * it in the context.
 *
 * ## The two module forms
 *
 *  · `module` — a function module's body (D1): handlers exported by phase
 *    name (`export function effects(ctx) { … }`); `decide`, `invoke` and
 *    `members` besides. A handler receives one envelope (`ctx`) and returns
 *    a plain value.
 *  · `legacy` — ⏳ a seeded script row read as a function module
 *    (`FunctionDecl.seedKey`): a function body handed `value` and `ctx`, as
 *    the pipeline's script steps are — the shape the rulesets' scripts took
 *    before functions.
 */

import { Worker } from "node:worker_threads"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"

/** The handlers a module body may export: the five phases, then deciding, invoking and a scope's members. */
export const MODULE_HANDLERS = ["effects", "derived", "before", "after", "render", "decide", "invoke", "members"] as const
export type ModuleHandler = (typeof MODULE_HANDLERS)[number]

/** The one budget a resolve spends (ms) — every call of every function, every phase. */
export const DEFAULT_TURN_BUDGET_MS = 1000
/** The most one call may take of it (ms) — one runaway handler never starves the rest. */
export const DEFAULT_CALL_CAP_MS = 250
const DEFAULT_MEMORY_BYTES = 64 * 1024 * 1024
const MAX_OUTPUT_BYTES = 256 * 1024

/* ── The evaluator: one source string, two hosts ───────────────────────── */

interface EvalJob {
	op: "open" | "eval" | "close"
	sid: string
	program?: string
	timeoutMs?: number
	memoryLimitBytes?: number
}

type EvalOutcome = { ok: true; json?: string; ms: number } | { ok: false; reason: string; ms: number }

/**
 * Self-contained CJS: `module.exports = async (job) => outcome`, holding a
 * context per session id between jobs. Kept as a string so the worker and
 * the inline fallback run byte-identical code.
 */
const EVALUATOR_SOURCE = String.raw`
const { getQuickJS } = require("quickjs-emscripten")
let enginePromise = null
const sessions = new Map()
module.exports = async function evaluate(job) {
	const started = Date.now()
	const done = (o) => Object.assign(o, { ms: Date.now() - started })
	if (job.op === "open") {
		const qjs = await (enginePromise ??= getQuickJS())
		const runtime = qjs.newRuntime()
		runtime.setMemoryLimit(job.memoryLimitBytes)
		const s = { runtime, context: null, deadline: 0 }
		runtime.setInterruptHandler(() => Date.now() > s.deadline)
		s.context = runtime.newContext()
		sessions.set(job.sid, s)
		return done({ ok: true })
	}
	const s = sessions.get(job.sid)
	if (job.op === "close") {
		if (s) {
			sessions.delete(job.sid)
			try { s.context.dispose() } catch (e) {}
			try { s.runtime.dispose() } catch (e) {}
		}
		return done({ ok: true })
	}
	if (!s) return done({ ok: false, reason: "the sandbox for this moment is gone" })
	if (typeof module.exports.onStart === "function") module.exports.onStart(job)
	s.deadline = Date.now() + job.timeoutMs
	const result = s.context.evalCode(job.program)
	if (result.error) {
		const detail = s.context.dump(result.error)
		result.error.dispose()
		const message =
			detail && typeof detail === "object"
				? (detail.name || "Error") + ": " + (detail.message || "")
				: String(detail)
		return done({ ok: false, reason: /interrupt/i.test(message) ? "timeout after " + job.timeoutMs + "ms" : message })
	}
	const json = s.context.dump(result.value)
	result.value.dispose()
	return done({ ok: true, json: typeof json === "string" ? json : JSON.stringify(json) })
}
`

const WORKER_SOURCE =
	EVALUATOR_SOURCE +
	String.raw`
const { parentPort } = require("worker_threads")
module.exports.onStart = (job) => parentPort.postMessage({ id: job.id, started: true })
parentPort.on("message", async (msg) => {
	try {
		const outcome = await module.exports({ ...msg.job, id: msg.id })
		parentPort.postMessage({ id: msg.id, outcome })
	} catch (e) {
		parentPort.postMessage({ id: msg.id, outcome: { ok: false, reason: String((e && e.message) || e), ms: 0 } })
	}
})
`

/* ── The pool: one worker, a wall-clock kill, an inline fallback ───────── */

interface PendingJob {
	job: EvalJob
	resolve: (o: EvalOutcome) => void
	killer: NodeJS.Timeout | null
}

let worker: Worker | null = null
/** Each worker's generation — a session opened in a killed worker is gone with it. */
let generation = 0
let workerBroken = false
let jobSeq = 0
const pending = new Map<number, PendingJob>()

let inlineEvaluate: ((job: EvalJob) => Promise<EvalOutcome>) | null = null
function inline(): (job: EvalJob) => Promise<EvalOutcome> {
	if (!inlineEvaluate) {
		const moduleShim = { exports: null as unknown }
		new Function("require", "module", EVALUATOR_SOURCE)(createRequire(import.meta.url), moduleShim)
		inlineEvaluate = moduleShim.exports as (job: EvalJob) => Promise<EvalOutcome>
	}
	return inlineEvaluate
}

/** Kill the worker; every job in it fails with `reason` (its contexts are gone with it). */
function breakWorker(reason: string): void {
	const w = worker
	worker = null
	generation++
	for (const [, entry] of pending) {
		if (entry.killer) clearTimeout(entry.killer)
		entry.resolve({ ok: false, reason, ms: 0 })
	}
	pending.clear()
	if (w) void w.terminate()
}

function arm(id: number): void {
	const entry = pending.get(id)
	if (!entry || entry.killer) return
	entry.killer = setTimeout(() => {
		pending.delete(id)
		entry.resolve({ ok: false, reason: `timeout after ${entry.job.timeoutMs}ms (sandbox killed)`, ms: entry.job.timeoutMs ?? 0 })
		breakWorker(`the sandbox was killed by a call that hung`)
	}, (entry.job.timeoutMs ?? 0) + 1000)
}

const useInline = (): boolean => workerBroken || process.env.SP_SCRIPTS_INLINE === "1"

function ensureWorker(): Worker | null {
	if (useInline()) return null
	if (worker) return worker
	try {
		const w = new Worker(WORKER_SOURCE, { eval: true })
		w.unref()
		w.on("message", (msg: { id: number; started?: true; outcome?: EvalOutcome }) => {
			if (w !== worker) return
			if (msg.started) return arm(msg.id)
			const entry = pending.get(msg.id)
			if (!entry) return
			pending.delete(msg.id)
			if (entry.killer) clearTimeout(entry.killer)
			entry.resolve(msg.outcome!)
		})
		w.on("error", () => {
			if (w !== worker) return
			workerBroken = true
			console.warn("[rulesets] the rules sandbox worker failed — running rules in-process")
			breakWorker("the rules sandbox worker failed")
		})
		worker = w
		return w
	} catch {
		workerBroken = true
		console.warn("[rulesets] the rules sandbox worker could not start — running rules in-process")
		return null
	}
}

/** Run one job — on the worker of generation `gen` when one is named, else inline. */
async function evaluate(job: EvalJob, gen: number | null): Promise<EvalOutcome> {
	if (gen === null) return inline()(job)
	if (gen !== generation || !ensureWorker()) return { ok: false, reason: "the rules sandbox was restarted — this moment's context is gone", ms: 0 }
	return await new Promise<EvalOutcome>((resolve) => {
		const id = ++jobSeq
		const entry: PendingJob = { job, resolve, killer: null }
		pending.set(id, entry)
		worker!.postMessage({ id, job })
	})
}

/* ── The programs ──────────────────────────────────────────────────────── */

/**
 * What a context holds before any module: the module table, the seeded
 * random stream, and `__call` — the one door a handler is called through,
 * fixed so no module can replace it.
 */
const PRELUDE = String.raw`
(function () {
	"use strict";
	var stringify = JSON.stringify, parse = JSON.parse;
	var modules = Object.create(null);
	function rngOf(label) {
		var h = 1779033703 ^ label.length;
		for (var i = 0; i < label.length; i++) {
			h = Math.imul(h ^ label.charCodeAt(i), 3432918353);
			h = (h << 13) | (h >>> 19);
		}
		h = Math.imul(h ^ (h >>> 16), 2246822507);
		h = Math.imul(h ^ (h >>> 13), 3266489909);
		var a = (h ^= h >>> 16) >>> 0;
		return function () {
			a |= 0;
			a = (a + 0x6d2b79f5) | 0;
			var t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}
	function define(key, made) { modules[key] = made; return "ok"; }
	function has(key) { return Object.prototype.hasOwnProperty.call(modules, key); }
	function call(key, handler, envJson, label) {
		var m = modules[key];
		if (!m) throw new Error("module not loaded");
		var logs = [];
		var random = rngOf(label);
		Math.random = random;
		Date.now = function () { return 0; };
		var env = parse(envJson);
		var out;
		if (handler === "legacy") {
			out = m.legacy(env, { random: random, log: function (x) { logs.push(String(x)); } });
		} else {
			var fn = m[handler];
			if (typeof fn !== "function") return stringify({ missing: true });
			if (env && typeof env === "object") {
				Object.defineProperty(env, "random", { value: random });
				Object.defineProperty(env, "log", { value: function (x) { logs.push(String(x)); } });
			}
			out = fn(env);
		}
		if (out && typeof out.then === "function") throw new Error("a handler answers at once — it is not async");
		return stringify(out === undefined ? { u: true, logs: logs } : { u: false, v: out, logs: logs });
	}
	function handlers(key) {
		var m = modules[key], out = [];
		for (var k in m) if (typeof m[k] === "function") out.push(k);
		return stringify(out);
	}
	Object.defineProperty(globalThis, "__rules", {
		value: Object.freeze({ define: define, has: has, call: call, handlers: handlers }),
		writable: false,
		configurable: false
	});
	return "ok";
})()
`

/** A module body's `export`s, as declarations its wrapper can see (`export function x` → `function x`). */
export function moduleBodyProgram(body: string): string {
	const stripped = body
		.replace(/(^|[\n;{}])(\s*)export\s*\{[^}]*\}\s*;?/g, "$1$2")
		.replace(/(^|[\n;{}])(\s*)export\s+(?=(?:async\s+)?function\b|const\b|let\b|var\b|class\b)/g, "$1$2")
	const picks = MODULE_HANDLERS.map((h) => `${h}: typeof ${h} === "function" ? ${h} : undefined`).join(", ")
	return `(function () {\n"use strict";\n${stripped}\n;return { ${picks} };\n})()`
}

/** ⏳ A seeded script's source as a module: a function body handed `value` and `ctx`. */
export const legacyProgram = (source: string): string => `({ legacy: function (value, ctx) {\n"use strict";\n${source}\n} })`

/** A program's content hash — the cache key of a module in a context and across contexts. */
export const sourceHash = (form: "module" | "legacy", source: string): string =>
	createHash("sha256").update(`${form}\n${source}`).digest("hex").slice(0, 24)

/** Programs, by hash, across resolves — a module is wrapped once per process. */
const programs = new Map<string, string>()
const PROGRAM_CACHE = 256
function programOf(form: "module" | "legacy", source: string, hash: string): string {
	let p = programs.get(hash)
	if (p === undefined) {
		p = `__rules.define(${JSON.stringify(hash)}, ${form === "module" ? moduleBodyProgram(source) : legacyProgram(source)})`
		if (programs.size >= PROGRAM_CACHE) programs.delete(programs.keys().next().value!)
		programs.set(hash, p)
	}
	return p
}

/* ── A session ─────────────────────────────────────────────────────────── */

export type SandboxCallResult = { ok: true; value: unknown; logs: string[]; ms: number; missing?: true } | { ok: false; reason: string; ms: number }

export interface SandboxOptions {
	/** The whole moment's budget (ms). Default `DEFAULT_TURN_BUDGET_MS`. */
	budgetMs?: number
	/** The most one call may take (ms). Default `DEFAULT_CALL_CAP_MS`. */
	callCapMs?: number
	memoryLimitBytes?: number
}

/** What the sandboxes did — for the receipt's facts and the tests. */
export const sandboxStats = { opened: 0, closed: 0, loads: 0, calls: 0 }

export interface RulesSandbox {
	/** Load a module once per context (by its hash); a second load is free. */
	load(form: "module" | "legacy", source: string): Promise<{ ok: true; key: string } | { ok: false; reason: string }>
	/** Call one handler of a loaded module with its envelope; `missing` when the module exports none of that name. */
	call(key: string, handler: ModuleHandler | "legacy", envelope: unknown, seedLabel: string): Promise<SandboxCallResult>
	/** What is left of the moment's budget (ms). */
	remaining(): number
	/** What the moment spent (ms) and how many calls it made. */
	spent(): { ms: number; calls: number; loads: number }
	close(): Promise<void>
}

let sessionSeq = 0

/**
 * 🚧 Open one context for a moment. Close it when the moment ends
 * (`withRulesSandbox` does): a context left open holds its memory until the
 * worker is restarted.
 */
export async function openRulesSandbox(opts: SandboxOptions = {}): Promise<RulesSandbox> {
	const budget = Math.max(1, opts.budgetMs ?? DEFAULT_TURN_BUDGET_MS)
	const cap = Math.max(1, opts.callCapMs ?? DEFAULT_CALL_CAP_MS)
	const sid = `rules:${process.pid}:${++sessionSeq}`
	const gen = useInline() || !ensureWorker() ? null : generation
	let left = budget
	let calls = 0
	let loads = 0
	let closed = false
	let broken: string | null = null
	const loaded = new Set<string>()
	const opened = await evaluate({ op: "open", sid, memoryLimitBytes: opts.memoryLimitBytes ?? DEFAULT_MEMORY_BYTES }, gen)
	if (!opened.ok) broken = opened.reason
	else {
		const pre = await evaluate({ op: "eval", sid, program: PRELUDE, timeoutMs: 1000 }, gen)
		if (!pre.ok) broken = pre.reason
	}
	sandboxStats.opened++

	const run = async (program: string): Promise<EvalOutcome> => {
		if (broken) return { ok: false, reason: broken, ms: 0 }
		if (left <= 0) return { ok: false, reason: `the turn's rules budget (${budget}ms) is spent`, ms: 0 }
		const timeoutMs = Math.max(1, Math.min(cap, Math.ceil(left)))
		const out = await evaluate({ op: "eval", sid, program, timeoutMs }, gen)
		left -= Math.max(out.ms, 0)
		if (!out.ok && /sandbox (was )?(killed|restarted)|is gone|worker failed/.test(out.reason)) broken = out.reason
		return out
	}

	return {
		async load(form, source) {
			const key = sourceHash(form, source)
			if (loaded.has(key)) return { ok: true, key }
			const out = await run(programOf(form, source, key))
			if (!out.ok) return { ok: false, reason: out.reason }
			loaded.add(key)
			loads++
			sandboxStats.loads++
			return { ok: true, key }
		},
		async call(key, handler, envelope, seedLabel) {
			if (!loaded.has(key)) return { ok: false, reason: "module not loaded in this moment's context", ms: 0 }
			let envJson: string
			try {
				envJson = JSON.stringify(envelope ?? null)
			} catch {
				return { ok: false, reason: "the envelope is not JSON", ms: 0 }
			}
			const program = `__rules.call(${JSON.stringify(key)}, ${JSON.stringify(handler)}, ${JSON.stringify(envJson)}, ${JSON.stringify(seedLabel)})`
			calls++
			sandboxStats.calls++
			const out = await run(program)
			if (!out.ok) return out
			const json = out.json ?? ""
			if (Buffer.byteLength(json, "utf8") > MAX_OUTPUT_BYTES)
				return { ok: false, reason: `output exceeds ${MAX_OUTPUT_BYTES} bytes — a handler answers, it does not balloon`, ms: out.ms }
			let parsed: { u?: boolean; v?: unknown; logs?: string[]; missing?: true }
			try {
				parsed = JSON.parse(json)
			} catch {
				return { ok: false, reason: "the handler returned a value JSON cannot carry", ms: out.ms }
			}
			if (parsed.missing) return { ok: true, value: undefined, logs: [], ms: out.ms, missing: true }
			return { ok: true, value: parsed.u ? undefined : parsed.v, logs: parsed.logs ?? [], ms: out.ms }
		},
		remaining: () => Math.max(0, left),
		spent: () => ({ ms: Math.max(0, budget - left), calls, loads }),
		async close() {
			if (closed) return
			closed = true
			sandboxStats.closed++
			await evaluate({ op: "close", sid }, gen).catch(() => undefined)
		}
	}
}

/** Open a context, run `fn` with it, close it whatever happens. */
export async function withRulesSandbox<T>(opts: SandboxOptions, fn: (sb: RulesSandbox) => Promise<T>): Promise<T> {
	const sb = await openRulesSandbox(opts)
	try {
		return await fn(sb)
	} finally {
		await sb.close()
	}
}

/**
 * 🚧 A moment's context, opened on its first use — so a moment whose
 * ruleset runs nothing in the sandbox opens none, and one that does opens
 * exactly one, however many phases reach for it.
 */
export function lazyRulesSandbox(opts: SandboxOptions = {}): RulesSandbox & { opened(): boolean } {
	let inner: Promise<RulesSandbox> | null = null
	let ready: RulesSandbox | null = null
	const get = () => (inner ??= openRulesSandbox(opts).then((sb) => (ready = sb)))
	return {
		load: async (form, source) => (await get()).load(form, source),
		call: async (key, handler, envelope, seedLabel) => (await get()).call(key, handler, envelope, seedLabel),
		remaining: () => (ready ? ready.remaining() : Math.max(0, opts.budgetMs ?? DEFAULT_TURN_BUDGET_MS)),
		spent: () => (ready ? ready.spent() : { ms: 0, calls: 0, loads: 0 }),
		opened: () => inner !== null,
		async close() {
			if (inner) await (await inner).close()
		}
	}
}
