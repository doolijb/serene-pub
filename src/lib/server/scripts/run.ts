/**
 * The script execution contract (18 §6).
 *
 * One function, `runScript`, and everything about the tier's safety and replay
 * properties is a property of it: what crosses the boundary, what the clocks
 * are, what the script may reach, and what happens when it misbehaves.
 *
 * ## The boundary is a serialization boundary
 *
 * JSON in, JSON out. Never object handles, never host functions beyond the two
 * whitelisted primitives-only callables. The escape-via-reference class of bug
 * has nothing to walk to, which is worth more than any individual hardening
 * item — those catch known tricks, this one removes the category.
 *
 * ## Least privilege at the data level
 *
 * Only a script's **declared ins** are serialized in, and only its **declared
 * outs** come back (§6a). That is enforcement rather than documentation: a
 * script may consult a variable and still have no power to rewrite it, and a
 * return carrying an undeclared key fails that link *loudly, naming the key*
 * rather than being stripped — a silent strip is an edit that stores cleanly
 * and does nothing, which is the exact defect class the config layer exists to
 * refuse.
 */

import { seededRandom } from "@serene-pub/sdk"
import {
	DEFAULT_MEMORY_BYTES,
	DEFAULT_TIMEOUT_MS,
	WALL_CLOCK_FACTOR,
	scriptEngine
} from "$lib/server/scripts/engine"

export interface ScriptRunRequest {
	/** The function body a user pasted. */
	source: string
	/**
	 * The declared ins, already narrowed to what this script asked for.
	 *
	 * The caller narrows rather than this function, because "what the hook
	 * offers" and "what this script declared" are two different facts and only
	 * the caller holds both.
	 */
	input: Record<string, unknown>
	/**
	 * The declared outs. A return carrying anything else is an error, not a
	 * silent strip.
	 *
	 * Empty for a `verdict` operation — those never write the bag — in which
	 * case `verdict` on the result carries what the hook consumes.
	 */
	declaredOut?: readonly string[]
	/** `verdict` operations return a value instead of merging one (18 §5). */
	semantics?: "transform" | "verdict"
	/** The run seed, so `ctx.random` and `Math.random` replay. */
	seed?: string
	/** The run's recorded start, so `Date.now()` and `new Date()` replay. */
	startedAt?: number
	timeoutMs?: number
	memoryBytes?: number
	/** §6: `max(4 × input, 64 KB)` unless the caller narrows it. */
	maxOutputBytes?: number
}

export interface ScriptRunResult {
	result: "ok" | "err"
	/**
	 * The declared outs the script returned, ready to merge into the flowing
	 * bag. Empty on passthrough and on error.
	 */
	value: Record<string, unknown>
	/** A `verdict` operation's answer — never merged, consumed by the hook. */
	verdict?: unknown
	/** True when the script returned nothing: the cheapest possible filter. */
	passthrough: boolean
	/** Why it failed, in words a user can act on. Absent when `result` is ok. */
	reason?: string
	/** `ctx.log` lines, for the receipt (S5). */
	logs: string[]
	durationMs: number
}

const MIN_OUTPUT_CEILING = 64 * 1024

/**
 * The prelude, evaluated before the user's body.
 *
 * Everything here exists to remove ambient nondeterminism, because a script
 * that cannot replay makes the receipt a lie. There is deliberately nothing
 * else to reach: QuickJS ships no `fetch`, no timers, no `console` and no
 * filesystem, so the surface is the intrinsics plus what this adds.
 *
 * `Date` is replaced rather than just `Date.now`, because `new Date()` is the
 * spelling people actually write in a "only at night" script and leaving it
 * live would make that script work and not replay — the worst of the three
 * possible outcomes.
 */
const PRELUDE = `
(function () {
	var T = __startedAt;
	var _D = Date;
	function D(a, b, c, d, e, f, g) {
		if (!(this instanceof D)) return _D(T);
		switch (arguments.length) {
			case 0: return new _D(T);
			case 1: return new _D(a);
			case 2: return new _D(a, b);
			case 3: return new _D(a, b, c);
			case 4: return new _D(a, b, c, d);
			case 5: return new _D(a, b, c, d, e);
			case 6: return new _D(a, b, c, d, e, f);
			default: return new _D(a, b, c, d, e, f, g);
		}
	}
	D.prototype = _D.prototype;
	D.now = function () { return T };
	D.parse = _D.parse;
	D.UTC = _D.UTC;
	globalThis.Date = D;
	// Remapped, not removed. A script using Math.random is not doing anything
	// wrong — it just must not be the one thing in a replayed run that differs.
	Math.random = function () { return ctx.random() };
})();
`

/**
 * Run one script.
 *
 * Never throws for a script's own misbehaviour: a throw, a timeout, an
 * allocation bomb or an undeclared out-key all come back as `result: 'err'`
 * with a reason, because S2 says a failing link degrades like an optional node
 * — tolerated, not hidden. A slop filter with a typo must never cost somebody
 * their reply, and must never vanish silently either.
 *
 * It *will* throw if the engine itself cannot start, which is not a script
 * problem and should not be reported as one.
 */
export async function runScript(
	req: ScriptRunRequest
): Promise<ScriptRunResult> {
	const started = Date.now()
	const logs: string[] = []
	const declaredOut = req.declaredOut ?? []
	const semantics = req.semantics ?? "transform"
	const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS
	const inputJson = JSON.stringify(req.input ?? {}) ?? "{}"
	const ceiling =
		req.maxOutputBytes ?? Math.max(4 * inputJson.length, MIN_OUTPUT_CEILING)

	const fail = (reason: string): ScriptRunResult => ({
		result: "err",
		value: {},
		passthrough: false,
		reason,
		logs,
		durationMs: Date.now() - started
	})

	const QuickJS = await scriptEngine()
	const runtime = QuickJS.newRuntime()
	runtime.setMemoryLimit(req.memoryBytes ?? DEFAULT_MEMORY_BYTES)

	// The interrupt is the clock that stops things. The wall reading below it
	// only *detects* that this one failed — it cannot preempt a synchronous
	// `evalCode`, and saying otherwise would be a comment that reads like a
	// second layer of protection and is not one. See `WALL_CLOCK_FACTOR`.
	const deadline = started + timeoutMs
	const wallDeadline = started + timeoutMs * WALL_CLOCK_FACTOR
	runtime.setInterruptHandler(() => Date.now() > deadline)

	const context = runtime.newContext()
	try {
		const random = seededRandom(req.seed ?? "seed:0")

		// The two whitelisted callables, primitives only in and out. `ctx` is
		// the only host object in scope and it holds nothing else — there is no
		// service to walk from.
		const ctxObj = context.newObject()

		const randomFn = context.newFunction("random", () =>
			context.newNumber(random())
		)
		context.setProp(ctxObj, "random", randomFn)
		randomFn.dispose()

		const logFn = context.newFunction("log", (msg) => {
			// Coerced and capped here rather than trusted: a log line is the
			// one thing a script can put straight into a receipt, so its size
			// is the host's decision.
			const s = context.dump(msg)
			logs.push(String(s === undefined ? "" : s).slice(0, 2000))
			return context.undefined
		})
		context.setProp(ctxObj, "log", logFn)
		logFn.dispose()

		context.setProp(context.global, "ctx", ctxObj)
		ctxObj.dispose()

		const startedAtVal = context.newNumber(req.startedAt ?? started)
		context.setProp(context.global, "__startedAt", startedAtVal)
		startedAtVal.dispose()

		const prelude = context.evalCode(PRELUDE)
		if (prelude.error) {
			const why = context.dump(prelude.error)
			prelude.error.dispose()
			return fail(`the sandbox prelude failed: ${describe(why)}`)
		}
		prelude.value.dispose()

		// The user's text is a **function body**, so `return` means what it
		// looks like it means and a bare `return` is the cheapest possible
		// filter. Declared ins are destructured into scope by name; they arrive
		// as clones by construction, because they crossed a JSON boundary to
		// get here (the graph rule, DECOMPOSITION §6).
		const names = Object.keys(req.input ?? {})
		const binding = names.length
			? `let { ${names.join(", ")} } = __in;`
			: ""
		const wrapped =
			`(function (__in) {\n${binding}\n${req.source}\n})` +
			`(${inputJson})`

		const evaluated = context.evalCode(wrapped, "script.js")
		if (evaluated.error) {
			const why = context.dump(evaluated.error)
			evaluated.error.dispose()
			// Past the wall reading means the interrupt did not fire when it
			// should have — an engine problem, not a script one, and it must
			// not be reported as an ordinary timeout or nobody will look.
			if (Date.now() > wallDeadline)
				return fail(
					`the script ran ${Date.now() - started}ms against a ${timeoutMs}ms budget: ` +
						`the sandbox interrupt did not fire. This is an engine fault rather ` +
						`than a fault in the script.`
				)
			return fail(describe(why))
		}

		const returned = context.dump(evaluated.value)
		evaluated.value.dispose()

		// Nothing returned is a passthrough, not an empty write. The difference
		// matters: an empty write would clear every declared out.
		if (returned === undefined)
			return {
				result: "ok",
				value: {},
				passthrough: true,
				logs,
				durationMs: Date.now() - started
			}

		const outJson = JSON.stringify(returned)
		if (outJson !== undefined && outJson.length > ceiling)
			return fail(
				`the script returned ${outJson.length} bytes, over its ceiling of ${ceiling}. ` +
					`A script's only weapon is its output, so it is bounded like network input.`
			)

		if (semantics === "verdict")
			return {
				result: "ok",
				value: {},
				verdict: returned,
				passthrough: false,
				logs,
				durationMs: Date.now() - started
			}

		if (
			returned === null ||
			typeof returned !== "object" ||
			Array.isArray(returned)
		)
			return fail(
				`a transform must return an object naming the variables it rewrites, or nothing at all. ` +
					`This returned ${Array.isArray(returned) ? "an array" : typeof returned}.`
			)

		const bag = returned as Record<string, unknown>
		const undeclared = Object.keys(bag).filter(
			(k) => !declaredOut.includes(k)
		)
		if (undeclared.length)
			return fail(
				`the script returned '${undeclared[0]}', which it does not declare as an output. ` +
					`Add it to the script's writes, or stop returning it — silently dropping it ` +
					`would be an edit that saves cleanly and changes nothing.`
			)

		return {
			result: "ok",
			value: bag,
			passthrough: false,
			logs,
			durationMs: Date.now() - started
		}
	} catch (err) {
		// An allocation bomb surfaces here on some builds rather than as an
		// evaluation error, and either way it is the script's failure and not
		// the host's.
		return fail(err instanceof Error ? err.message : String(err))
	} finally {
		// Disposed in `finally` and in this order. A leaked context is a leaked
		// WASM allocation, and the memory cap is per context — leak enough of
		// them and the cap protects nothing.
		context.dispose()
		runtime.dispose()
	}
}

/**
 * A thrown value as a sentence.
 *
 * QuickJS dumps an error as a plain object; a script may also throw a string, a
 * number, or nothing recognisable. All of those end up in a receipt line that a
 * user reads, so none of them may render as `[object Object]`.
 */
function describe(v: unknown): string {
	if (v && typeof v === "object") {
		const e = v as { name?: unknown; message?: unknown }
		if (typeof e.message === "string")
			return e.name === "InternalError" && e.message === "interrupted"
				? "the script ran too long and was interrupted"
				: `${typeof e.name === "string" ? `${e.name}: ` : ""}${e.message}`
		try {
			return JSON.stringify(v) ?? String(v)
		} catch {
			return String(v)
		}
	}
	return String(v)
}
