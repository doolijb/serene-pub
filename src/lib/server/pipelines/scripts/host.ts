/**
 * The script sandbox — QuickJS in WASM, evaluated off the event loop (18 §7).
 *
 * The interpreter runs inside WASM linear memory: even an interpreter bug can
 * only corrupt its own sandbox, and nothing host-side is reachable unless
 * explicitly bridged. Since the pool landed, nothing is bridged at all: the
 * evaluation is **zero-callback** — the seeded RNG and the `ctx.log` collector
 * live *inside* the sandbox program, and the whole job crosses as strings.
 * That is what makes the worker pool trivial rather than an RPC protocol, and
 * it removes the last host functions the escape analysis had to reason about.
 *
 * ## One evaluator, two hosts — never two implementations
 *
 * `EVALUATOR_SOURCE` is a self-contained CJS module string. The worker
 * evaluates it (`new Worker(code, { eval: true })`); the inline fallback
 * evaluates the *same string* via `new Function`. A copy per host is exactly
 * the drift this codebase keeps finding, so there is one string and two ways
 * to run it. Same rule for the RNG: one algorithm, embedded in the program
 * template, used identically wherever the program executes — a script's rolls
 * are a pure function of its seed label, whatever thread ran it.
 *
 * ## The clocks (18 §7)
 *
 * Inside: the interrupt handler enforces the deadline between VM instructions
 * — verified to fire inside regex backtracking on this engine build (the
 * abuse corpus carries the probe). Outside: the pool's wall-clock kill
 * terminates a stuck worker and respawns it — the absolute backstop, for the
 * day an engine bump reopens a gap between the clocks. `SP_SCRIPTS_INLINE=1`
 * forces the inline path (no backstop) for debugging.
 *
 * ## The contract (18 §6)
 *
 * The source is a **function body**. Declared variables arrive as `const`
 * bindings; extras ride on `ctx`; `return` publishes; returning nothing means
 * passthrough. `Math.random` and `ctx.random` are the label-seeded stream and
 * `Date.now()` is pinned to the run's recorded start, so a script that stamps
 * time-of-day still replays byte-identically.
 */

import { Worker } from "node:worker_threads"
import { createRequire } from "node:module"

export interface ScriptRunSuccess {
	ok: true
	/** `undefined` when the script returned nothing — passthrough. */
	value: unknown
	logs: string[]
	durationMs: number
}

export interface ScriptRunFailure {
	ok: false
	reason: string
	logs: string[]
	durationMs: number
}

export type ScriptRunResult = ScriptRunSuccess | ScriptRunFailure

export interface RunScriptOptions {
	/** The function body. */
	source: string
	/** Declared in-variables, JSON-serializable, bound as consts by name. */
	vars: Record<string, unknown>
	/** Read-only context beyond the ports — exposed on `ctx`, never bindable as outs. */
	extras?: Record<string, unknown>
	/**
	 * The seed label for this evaluation's random stream (18 §6). The PRNG
	 * itself lives inside the sandbox program — one algorithm, one source —
	 * so the same label yields the same rolls on any thread, any replay.
	 */
	seedLabel: string
	/** What `Date.now()` answers — the run's recorded start, for replay. */
	nowMs: number
	/** The inner clock (F36). */
	timeoutMs?: number
	/** WASM linear memory cap. */
	memoryLimitBytes?: number
	/** Ceiling on the serialized return — a script's only weapon is its output. */
	maxOutputBytes?: number
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/* ── The evaluator: one source string, two hosts ───────────────────────── */

interface EvalJob {
	program: string
	timeoutMs: number
	memoryLimitBytes: number
}

type EvalOutcome = { ok: true; json: string } | { ok: false; reason: string }

/**
 * Self-contained CJS: `module.exports = async (job) => outcome`. Everything
 * the evaluation needs is in the job; nothing host-side is reachable. Kept as
 * a string so the worker and the inline fallback run byte-identical code.
 */
const EVALUATOR_SOURCE = String.raw`
const { getQuickJS } = require("quickjs-emscripten")
let enginePromise = null
module.exports = async function evaluate(job) {
	const qjs = await (enginePromise ??= getQuickJS())
	const runtime = qjs.newRuntime()
	try {
		runtime.setMemoryLimit(job.memoryLimitBytes)
		const deadline = Date.now() + job.timeoutMs
		runtime.setInterruptHandler(() => Date.now() > deadline)
		const context = runtime.newContext()
		try {
			const result = context.evalCode(job.program)
			if (result.error) {
				const detail = context.dump(result.error)
				result.error.dispose()
				const message =
					detail && typeof detail === "object"
						? (detail.name || "Error") + ": " + (detail.message || "")
						: String(detail)
				return {
					ok: false,
					reason: /interrupt/i.test(message)
						? "timeout after " + job.timeoutMs + "ms"
						: message
				}
			}
			const json = context.dump(result.value)
			result.value.dispose()
			return { ok: true, json }
		} finally {
			context.dispose()
		}
	} finally {
		runtime.dispose()
	}
}
`

const WORKER_SOURCE =
	EVALUATOR_SOURCE +
	String.raw`
const { parentPort } = require("worker_threads")
parentPort.on("message", async (msg) => {
	try {
		const outcome = await module.exports(msg.job)
		parentPort.postMessage({ id: msg.id, outcome })
	} catch (e) {
		parentPort.postMessage({
			id: msg.id,
			outcome: { ok: false, reason: String((e && e.message) || e) }
		})
	}
})
`

/* ── The pool: one worker, wall-clock kill, inline fallback ────────────── */

let worker: Worker | null = null
let workerBroken = false
let jobSeq = 0
const pending = new Map<
	number,
	{ resolve: (o: EvalOutcome) => void; killer: NodeJS.Timeout }
>()

let inlineEvaluate: ((job: EvalJob) => Promise<EvalOutcome>) | null = null
function inline(): (job: EvalJob) => Promise<EvalOutcome> {
	if (!inlineEvaluate) {
		const moduleShim = { exports: null as unknown }
		new Function("require", "module", EVALUATOR_SOURCE)(
			createRequire(import.meta.url),
			moduleShim
		)
		inlineEvaluate = moduleShim.exports as (
			job: EvalJob
		) => Promise<EvalOutcome>
	}
	return inlineEvaluate
}

/** Terminate everything in flight — a stuck script kills the worker, not the server. */
function breakWorker(reason: string): void {
	const w = worker
	worker = null
	for (const [, entry] of pending) {
		clearTimeout(entry.killer)
		entry.resolve({ ok: false, reason })
	}
	pending.clear()
	if (w) void w.terminate()
}

function ensureWorker(): Worker | null {
	if (workerBroken || process.env.SP_SCRIPTS_INLINE === "1") return null
	if (worker) return worker
	try {
		const w = new Worker(WORKER_SOURCE, { eval: true })
		w.unref()
		w.on("message", (msg: { id: number; outcome: EvalOutcome }) => {
			const entry = pending.get(msg.id)
			if (!entry) return
			pending.delete(msg.id)
			clearTimeout(entry.killer)
			entry.resolve(msg.outcome)
		})
		w.on("error", () => {
			// A worker that cannot even start is an environment problem, not a
			// per-script one: fall back to inline for the process's lifetime,
			// loudly once. The sandbox itself is identical either way.
			workerBroken = true
			console.warn(
				"[scripts] evaluation worker failed — falling back to in-process evaluation"
			)
			breakWorker("the evaluation worker failed — retried inline")
		})
		worker = w
		return w
	} catch {
		workerBroken = true
		console.warn(
			"[scripts] evaluation worker could not start — running scripts in-process"
		)
		return null
	}
}

async function evaluate(job: EvalJob): Promise<EvalOutcome> {
	const w = ensureWorker()
	if (!w) return inline()(job)
	return await new Promise<EvalOutcome>((resolve) => {
		const id = ++jobSeq
		// The absolute backstop (18 §7): the interrupt should fire first; if
		// an engine gap ever lets a script run past it, the worker dies and
		// the server does not. Grace over the inner clock so a healthy
		// near-deadline eval is never killed by the outer one.
		const killer = setTimeout(() => {
			pending.delete(id)
			breakWorker(`killed after ${job.timeoutMs}ms — the evaluation hung`)
			resolve({
				ok: false,
				reason: `timeout after ${job.timeoutMs}ms (worker killed)`
			})
		}, job.timeoutMs + 1000)
		pending.set(id, { resolve, killer })
		w.postMessage({ id, job })
	})
}

/* ── The program: contract, RNG and log capture in one template ────────── */

function buildProgram(opts: RunScriptOptions): string {
	const bindings = Object.keys(opts.vars)
		.map((k) => `const ${k} = __vars[${JSON.stringify(k)}];`)
		.join("\n")
	return `
		(function () {
			"use strict";
			var __logs = [];
			// The scripts RNG: one algorithm, one source, wherever the program
			// runs — a roll is a pure function of the seed label (18 §6).
			var __rng = (function (label) {
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
			})(${JSON.stringify(opts.seedLabel)});
			var __parsed = JSON.parse(${JSON.stringify(JSON.stringify(opts.vars))});
			var __extras = JSON.parse(${JSON.stringify(JSON.stringify(opts.extras ?? {}))});
			var ctx = Object.assign(
				{
					random: __rng,
					log: function (m) { __logs.push(String(m)); }
				},
				__extras
			);
			Math.random = __rng;
			Date.now = function () { return ${Math.floor(opts.nowMs)}; };
			var __fn = function (__vars) {
				${bindings}
				${opts.source}
			};
			var __r = __fn(__parsed);
			return JSON.stringify(
				__r === undefined
					? { u: true, logs: __logs }
					: { u: false, v: __r, logs: __logs }
			);
		})()
	`
}

export async function runScriptSource(
	opts: RunScriptOptions
): Promise<ScriptRunResult> {
	const started = Date.now()
	const fail = (reason: string, logs: string[] = []): ScriptRunFailure => ({
		ok: false,
		reason,
		logs,
		durationMs: Date.now() - started
	})

	for (const name of Object.keys(opts.vars))
		if (!IDENT.test(name))
			return fail(
				`variable '${name}' is not a bindable identifier — a declared ` +
					`read has to be a plain name`
			)

	const timeoutMs = opts.timeoutMs ?? 250
	const outcome = await evaluate({
		program: buildProgram(opts),
		timeoutMs,
		memoryLimitBytes: opts.memoryLimitBytes ?? 64 * 1024 * 1024
	})

	if (!outcome.ok) return fail(outcome.reason)

	const max = opts.maxOutputBytes ?? 256 * 1024
	if (Buffer.byteLength(outcome.json, "utf8") > max)
		return fail(
			`output exceeds ${max} bytes — a script rewrites a value, it does not balloon one`
		)

	let parsed: { u: boolean; v?: unknown; logs?: string[] }
	try {
		parsed = JSON.parse(outcome.json)
	} catch {
		return fail("script returned a value JSON cannot carry")
	}

	return {
		ok: true,
		value: parsed.u ? undefined : parsed.v,
		logs: parsed.logs ?? [],
		durationMs: Date.now() - started
	}
}
