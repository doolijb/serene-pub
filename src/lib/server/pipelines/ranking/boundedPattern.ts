/**
 * Regex keys, run under a time bound (plan lorebooks-consolidation S3).
 *
 * A regex key never runs as a bare `new RegExp(key).exec(window)`: that is the
 * main thread of every turn with nothing between a catastrophic pattern and
 * the event loop, and `/(a+)+$/` over one long message stalls every user of the
 * install and the lorebook lock's nine-second heartbeat with it. Refusing such patterns on
 * write (`shared/entries/runawayPattern.ts`) cannot reach the rows written
 * before the refusal existed, nor the patterns its heuristic misses, so every
 * regex key is run here instead.
 *
 * **Why `vm` with a timeout, and not a worker or a linear-time engine.** No
 * linear-time engine is a dependency (re2 is a native module; V8's own
 * `--enable-experimental-regexp-engine` is a process flag and cannot run
 * lookbehind or backreferences, both of which real keys use). A worker would
 * make matching asynchronous, and matching sits under a dozen synchronous
 * scoring functions that are pure by design (F11). `vm.Script#runInContext`
 * with `timeout` is the one synchronous interrupt Node has: a watchdog thread
 * calls V8's `TerminateExecution`, which irregexp honours mid-backtrack, and
 * the call throws `ERR_SCRIPT_EXECUTION_TIMEOUT` instead of hanging.
 *
 * That watchdog is a thread started per call (~70 µs), so keys are run in
 * **batches** — every regex key of a scan in one call — and a batch that times
 * out resumes from the key it was interrupted on. A key is blamed only when it
 * was the first in its batch, i.e. when it alone ran for the whole bound.
 *
 * **What a key may cost, once per process.** Every run is timed, and a key
 * keeps a *debt*: the time of its runs past `PATTERN_SLOW_MS`, with a trip
 * counted at the whole bound. A run under that clears it. A key whose debt
 * reaches `PATTERN_DEBT_MS` is skipped until restart. So a key is skipped for
 * tripping twice running — never once: V8 runs a new regex in its interpreter
 * first, several times slower than every run after, and a pause for garbage
 * collection lands inside somebody's key; the second chance is taken at once,
 * on the same text — and so is a key that stays just under the bound, every
 * run, which the bound alone would never catch.
 *
 * **What a stretch of work may spend on patterns in all.** A scan — one
 * `keywordQuery` — has `PATTERN_SCAN_BUDGET_MS` across every window it primes
 * and every pass it makes, recursion included (`patternBudget`). And one
 * event-loop task has `PATTERN_TASK_BUDGET_MS` across every scan it runs,
 * because the lanes of one turn can resume from their reads in one microtask
 * drain and scan back to back. Past either, the rest of the keys are not run
 * *this time* and are reported. Nothing holds the event loop on patterns for
 * longer than the task budget plus one bound.
 */

import vm from "node:vm"
import {
	runawayPatternOf,
	type RunawayRule
} from "$lib/shared/entries/runawayPattern"

/**
 * How long one regex key may take against one window.
 *
 * A key that matches in the ordinary way does so in microseconds; the widest
 * scan window is some tens of kilobytes. Twenty-five milliseconds is three
 * orders of magnitude of headroom for a legitimate pattern and short enough
 * that the rare trip is not a visible pause.
 */
export const PATTERN_TIME_BOUND_MS = 25

/**
 * A run of one key over one window slower than this is a slow run, and goes
 * on the key's debt. Two orders of magnitude over an ordinary key's cost.
 */
export const PATTERN_SLOW_MS = 5

/**
 * The debt at which a key is skipped until restart: two trips running, or
 * about ten slow runs with no fast one between them.
 */
export const PATTERN_DEBT_MS = PATTERN_TIME_BOUND_MS * 2

/**
 * How long one scan may spend on regex keys, in all.
 *
 * A book with a hundred runaway keys the heuristic misses would otherwise cost
 * a hundred bounds on its first turn. Past this, the scan's remaining regex
 * keys are not run *this turn*; the debts already paid are remembered, so
 * each turn gets further until none remain. An ordinary book's keys take a
 * few milliseconds of it.
 */
export const PATTERN_SCAN_BUDGET_MS = 200

/**
 * How long one event-loop task may spend on regex keys, across every scan it
 * runs. A little over one scan's: the lock heartbeat's slack is a second, and
 * a turn runs up to five scans.
 */
export const PATTERN_TASK_BUDGET_MS = 250

/** One scan's time for patterns, shared by every window and pass it primes. */
export interface PatternBudget {
	spentMs: number
}

/** A fresh budget: one per scan (`keywordQuery` makes one and passes it down). */
export const patternBudget = (): PatternBudget => ({ spentMs: 0 })

/** Why a regex key was not run. */
export type PatternNotRun =
	| { cause: RunawayRule; why: string }
	| { cause: "tripped"; why: string }
	| { cause: "budget"; why: string }

/** The pattern does not compile: the matcher falls back to substring (`:1583`). */
export const PATTERN_INVALID = -2

const TRIPPED_WHY =
	"it took too long to check, more than once, so it is skipped until the app restarts"
const BUDGET_WHY =
	"the patterns before it used up this turn's time for patterns, so it was not checked"

type Outcome = number | PatternNotRun

/** A job's text and pattern: `sensitive` decides both, as `matchIndexOf` does. */
const flagsOf = (sensitive: boolean) => (sensitive ? "" : "i")
const cacheKey = (pattern: string, sensitive: boolean) =>
	`${sensitive ? "s" : "i"}\u0000${pattern}`

// ── Process-wide memory ─────────────────────────────────────────────────────

const MEMO_CEILING = 10_000

/** Compiled once per (pattern, flags); null when it does not compile. */
const compiled = new Map<string, RegExp | null>()
/** Keys whose debt reached `PATTERN_DEBT_MS`: never run again until restart. */
const tripped = new Set<string>()
/** Each key's slow time since its last fast run, in ms. */
const debts = new Map<string, number>()

function compile(pattern: string, sensitive: boolean): RegExp | null {
	const key = cacheKey(pattern, sensitive)
	let re = compiled.get(key)
	if (re === undefined) {
		try {
			re = new RegExp(pattern, flagsOf(sensitive))
		} catch {
			re = null
		}
		if (compiled.size >= MEMO_CEILING) compiled.clear()
		compiled.set(key, re)
	}
	return re
}

/** Add to a key's debt; true when that makes it a key never run again. */
function charge(key: string, ms: number): boolean {
	const owed = (debts.get(key) ?? 0) + ms
	if (owed < PATTERN_DEBT_MS) {
		if (debts.size >= MEMO_CEILING) debts.clear()
		debts.set(key, owed)
		return false
	}
	debts.delete(key)
	if (tripped.size >= MEMO_CEILING) tripped.clear()
	tripped.add(key)
	return true
}

// ── The task's budget ───────────────────────────────────────────────────────

/**
 * Pattern time spent in the current event-loop task. Cleared by the
 * `setImmediate` the first charge of a task schedules, which runs only once
 * the task and every microtask it queued are done — i.e. once the event loop
 * has had its turn.
 */
let taskSpentMs = 0
let taskClearing = false

function chargeTask(ms: number): void {
	taskSpentMs += ms
	if (taskClearing) return
	taskClearing = true
	setImmediate(() => {
		taskSpentMs = 0
		taskClearing = false
	}).unref()
}

const outOfTime = (budget: PatternBudget) =>
	budget.spentMs >= PATTERN_SCAN_BUDGET_MS ||
	taskSpentMs >= PATTERN_TASK_BUDGET_MS

// ── Per-window memory ───────────────────────────────────────────────────────

/** The window shape this needs — `ScanWindow`'s two texts. */
export interface PatternText {
	raw: string
	lower: string
}

interface WindowState {
	/**
	 * Answers by pattern, one map per sensitivity — two maps rather than one
	 * keyed `flags + pattern`, because the matcher looks a key up once per
	 * entry per window and building that string on every lookup was most of
	 * what this module cost a scan.
	 */
	insensitive: Map<string, Outcome>
	sensitive: Map<string, Outcome>
	/** The scan's budget, from the priming: one scan, one budget. */
	budget: PatternBudget
}

const windows = new WeakMap<PatternText, WindowState>()

const stateOf = (window: PatternText, budget?: PatternBudget): WindowState => {
	let state = windows.get(window)
	if (!state) {
		state = {
			insensitive: new Map(),
			sensitive: new Map(),
			budget: budget ?? patternBudget()
		}
		windows.set(window, state)
	}
	return state
}

const answersOf = (state: WindowState, sensitive: boolean) =>
	sensitive ? state.sensitive : state.insensitive

// ── The bounded run ─────────────────────────────────────────────────────────

interface Job {
	re: RegExp
	text: string
	/**
	 * Its process-wide key (`patternKey`), for debts and trips. Defaults to
	 * one built from `re` — for the tests, which hand the runner a literal.
	 */
	key?: string
}

/**
 * The loop that runs inside the watchdog. `r.at` is written before each job,
 * so a timeout says which job it interrupted — written on every turn of the
 * loop rather than in a `finally`, because a terminated script runs no
 * `finally`. A job with an answer already (its key tripped earlier in the
 * batch) is passed over. Each job's time goes in `took`, for its key's debt.
 *
 * ⚠ The context's global is read ONCE, into locals. Every read of a
 * contextified global goes through an interceptor, and `run.jobs[run.at]`
 * in the loop condition and body made the loop seven times slower than the
 * same loop outside `vm` (measured: 42 ms against 6 ms for 60,000 jobs). The
 * clock costs about another 3 ms on those 60,000.
 */
const LOOP = new vm.Script(
	`{
		const r = run, jobs = r.jobs, out = r.out, took = r.took, now = r.now
		let last = now()
		for (let at = r.at; at < jobs.length; at++) {
			if (out[at] !== undefined) continue
			r.at = at
			const job = jobs[at]
			const m = job.re.exec(job.text)
			out[at] = m === null ? -1 : m.index
			const t = now()
			took[at] = t - last
			last = t
		}
		r.at = jobs.length
	}`,
	{ filename: "serene-pub:boundedPattern" }
)

let context: vm.Context | null = null
const contextOf = () => (context ??= vm.createContext({ run: null }))
const now = performance.now.bind(performance)

const TIMEOUT = "ERR_SCRIPT_EXECUTION_TIMEOUT"

/**
 * Run each job's pattern over its text, each under `PATTERN_TIME_BOUND_MS`,
 * with all the time spent charged to `budget` and to the task.
 *
 * Returns, per job: the match index, `-1`, `PATTERN_INVALID` when `exec`
 * itself threw (a stack overflow in a pathological pattern — the matcher's
 * substring fallback, as before), `"tripped"` or `"budget"`. A key that trips
 * is run again at once, alone, unless that trip settled its debt; once a key
 * is skipped, its later jobs in the batch are answered `"tripped"` unrun.
 *
 * Exported for the tests, which drive a runaway pattern straight into it past
 * the heuristic to prove the bound itself holds.
 */
export function runBounded(
	jobs: readonly Job[],
	budget: PatternBudget = patternBudget()
): Array<number | "tripped" | "budget"> {
	const out: Array<number | "tripped" | "budget"> = new Array(jobs.length)
	if (jobs.length === 0) return out
	const keys = jobs.map((j) => j.key ?? cacheKey(j.re.source, !j.re.ignoreCase))
	const took = new Float64Array(jobs.length)
	const ctx = contextOf()
	const run = { at: 0, jobs, out, took, now }
	/** Answer every job of a key that will not be run again. */
	const skipKey = (key: string, from: number) => {
		for (let k = from; k < jobs.length; k++)
			if (out[k] === undefined && keys[k] === key) out[k] = "tripped"
	}
	/**
	 * Debts are settled in job order as jobs finish — before a trip is
	 * charged — so a fast run between two trips of one key clears the first,
	 * in a batch as across batches.
	 */
	let settled = 0
	const settleTo = (end: number) => {
		settleDebts(out, took, keys, settled, end)
		settled = Math.max(settled, end)
	}
	let from = 0
	while (from < jobs.length) {
		if (outOfTime(budget)) {
			for (let k = from; k < jobs.length; k++) out[k] ??= "budget"
			break
		}
		run.at = from
		ctx.run = run
		const started = now()
		try {
			LOOP.runInContext(ctx, { timeout: PATTERN_TIME_BOUND_MS })
			const spent = now() - started
			budget.spentMs += spent
			chargeTask(spent)
			break
		} catch (e) {
			const spent = now() - started
			budget.spentMs += spent
			chargeTask(spent)
			const at = run.at
			settleTo(at)
			if (out[at] !== undefined) {
				// Stopped between one job's answer and the next job's start:
				// nobody was mid-match, so nobody is blamed.
				from = at + 1
			} else if ((e as { code?: string })?.code === TIMEOUT) {
				// First in its batch: it alone ran for the whole bound. Any
				// later job was interrupted on someone else's time, and gets a
				// batch of its own to prove itself in — as does a first trip,
				// which is run again from where it stopped.
				if (at === from && charge(keys[at]!, PATTERN_TIME_BOUND_MS)) {
					out[at] = "tripped"
					skipKey(keys[at]!, at + 1)
					from = at + 1
				} else from = at
			} else {
				out[at] = PATTERN_INVALID
				from = at + 1
			}
		} finally {
			ctx.run = null
		}
	}
	settleTo(jobs.length)
	return out
}

/**
 * Put each finished job's time on its key: a slow run adds to the debt (and
 * may make the key one never run again), a fast one clears it.
 */
function settleDebts(
	out: ReadonlyArray<number | "tripped" | "budget">,
	took: Float64Array,
	keys: readonly string[],
	from: number,
	to: number
): void {
	for (let k = from; k < to; k++) {
		if (typeof out[k] !== "number") continue
		const key = keys[k]!
		if (tripped.has(key)) continue
		if (took[k]! > PATTERN_SLOW_MS) charge(key, took[k]!)
		else debts.delete(key)
	}
}

// ── The matcher's door ──────────────────────────────────────────────────────

/** A regex key as a scan asks for it. */
export interface PatternRequest {
	pattern: string
	sensitive: boolean
}

/**
 * Run every request against every window in one batch, and remember the
 * answers on the windows — so the matcher's per-key lookups that follow are
 * reads.
 *
 * `budget` is the scan's (`patternBudget`): the per-message windows of
 * `buildLastRefMap`, every pass and its condition window, all charge one.
 * Requests already answered for a window, runaway patterns, tripped keys and
 * patterns that do not compile are settled without running anything.
 */
export function primePatterns(
	texts: readonly PatternText[],
	requests: Iterable<PatternRequest>,
	budget: PatternBudget
): void {
	const wanted = new Map<string, PatternRequest>()
	for (const r of requests) wanted.set(cacheKey(r.pattern, r.sensitive), r)
	if (wanted.size === 0 || texts.length === 0) return

	// Judged once per pattern, not once per window: the per-message windows
	// of `buildLastRefMap` are a hundred windows over the same keys.
	const answered: Array<[PatternRequest, Outcome]> = []
	const runnable: Array<{ r: PatternRequest; re: RegExp; key: string }> = []
	for (const [key, r] of wanted) {
		const settled = settle(r, key)
		if (settled !== undefined) answered.push([r, settled])
		else runnable.push({ r, re: compile(r.pattern, r.sensitive)!, key })
	}

	const jobs: Job[] = []
	const slots: Slot[] = []
	for (const window of texts) {
		const state = stateOf(window, budget)
		for (const [r, outcome] of answered) {
			const answers = answersOf(state, r.sensitive)
			if (!answers.has(r.pattern)) answers.set(r.pattern, outcome)
		}
		for (const { r, re, key } of runnable) {
			const answers = answersOf(state, r.sensitive)
			if (answers.has(r.pattern)) continue
			jobs.push({ re, text: r.sensitive ? window.raw : window.lower, key })
			slots.push({ answers, pattern: r.pattern })
		}
	}
	record(runBounded(jobs, budget), slots)
}

/**
 * Where one regex key first matches a window: an index, `-1`,
 * `PATTERN_INVALID` for the substring fallback, or why it was not run.
 *
 * A read when the window was primed; otherwise a batch of one, under the same
 * bound and the window's own budget.
 */
export function patternIndex(
	window: PatternText,
	pattern: string,
	sensitive: boolean
): Outcome {
	const state = stateOf(window)
	const answers = answersOf(state, sensitive)
	const known = answers.get(pattern)
	if (known !== undefined) return known
	const key = cacheKey(pattern, sensitive)
	const settled = settle({ pattern, sensitive }, key)
	if (settled !== undefined) {
		answers.set(pattern, settled)
		return settled
	}
	const [only] = runBounded(
		[
			{
				re: compile(pattern, sensitive)!,
				text: sensitive ? window.raw : window.lower,
				key
			}
		],
		state.budget
	)
	record([only!], [{ answers, pattern }])
	return answers.get(pattern)!
}

/** Answered without running: a runaway pattern, a tripped key, no compile. */
function settle(r: PatternRequest, key: string): Outcome | undefined {
	const runaway = runawayPatternOf(r.pattern)
	if (runaway) return { cause: runaway.rule, why: runaway.why }
	if (tripped.has(key)) return { cause: "tripped", why: TRIPPED_WHY }
	if (compile(r.pattern, r.sensitive) === null) return PATTERN_INVALID
	return undefined
}

/** Where one job's answer goes. */
interface Slot {
	answers: Map<string, Outcome>
	pattern: string
}

function record(
	out: ReadonlyArray<number | "tripped" | "budget">,
	slots: readonly Slot[]
): void {
	for (let k = 0; k < slots.length; k++) {
		const { answers, pattern } = slots[k]!
		const result = out[k]
		if (result === "tripped") answers.set(pattern, { cause: "tripped", why: TRIPPED_WHY })
		else if (result === "budget")
			// Not remembered past this window: it did nothing wrong, and the
			// next turn runs it.
			answers.set(pattern, { cause: "budget", why: BUDGET_WHY })
		else answers.set(pattern, result ?? -1)
	}
}

/**
 * The regex keys a window did not run, and why, keyed as `patternIndex` keys
 * them. What a scan reads back for its receipt.
 */
export function patternsNotRun(
	window: PatternText
): ReadonlyMap<string, PatternNotRun> {
	const out = new Map<string, PatternNotRun>()
	const state = windows.get(window)
	if (!state) return out
	for (const sensitive of [false, true])
		for (const [pattern, result] of answersOf(state, sensitive))
			if (typeof result === "object") out.set(cacheKey(pattern, sensitive), result)
	return out
}

/** The key `patternsNotRun` files a request under. */
export const patternKey = cacheKey

/**
 * Tests only: forget every key's debt and trip, and the task's spend, so one
 * test's slow keys are not the next one's.
 */
export function forgetPatternCosts(): void {
	tripped.clear()
	debts.clear()
	taskSpentMs = 0
}
