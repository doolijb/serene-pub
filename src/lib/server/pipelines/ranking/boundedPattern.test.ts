/**
 * Regex keys under a time bound (plan lorebooks-consolidation S3).
 *
 * The first two tests are the fail-first pair: before the bound, the first
 * spent about 2¹⁵ times longer than the bound allows (≈2 s at 25 `a`s, doubling
 * per character), and the second never returned at all.
 */

import { afterEach, describe, it, expect } from "vitest"
import {
	PATTERN_DEBT_MS,
	PATTERN_SCAN_BUDGET_MS,
	PATTERN_TASK_BUDGET_MS,
	PATTERN_TIME_BOUND_MS,
	forgetPatternCosts,
	patternBudget,
	patternIndex,
	patternKey,
	patternsNotRun,
	primePatterns,
	runBounded
} from "$lib/server/pipelines/ranking/boundedPattern"
import { matchIndexOf, type ScanWindow } from "$lib/server/pipelines/ranking/signals"
import { runawayPatternOf } from "$lib/shared/entries/runawayPattern"

const win = (raw: string): ScanWindow => ({ raw, lower: raw.toLowerCase() })
const regex = { matchMode: "regex" }

/** Generous: two bounds plus scheduling noise on a loaded machine. */
const WITHIN = PATTERN_TIME_BOUND_MS * 2 + 200

const timed = <T>(fn: () => T): [T, number] => {
	const started = performance.now()
	const out = fn()
	return [out, performance.now() - started]
}

afterEach(() => forgetPatternCosts())

describe("a regex key under the bound", () => {
	it("/(a+)+$/ against a string of a's and a '!' returns within the bound", () => {
		const [at, ms] = timed(() =>
			matchIndexOf("(a+)+$", regex, win(`${"a".repeat(25)}!`))
		)
		expect(at).toBe(-1)
		expect(ms).toBeLessThan(WITHIN)
	})

	it("the bound itself holds for a long one, with the heuristic out of the way", () => {
		// Straight into the runner, so this proves the watchdog and not the
		// write-side check: 50,000 a's is not a pattern anything could finish.
		const [out, ms] = timed(() =>
			runBounded([{ re: /(a+)+$/i, text: `${"a".repeat(50_000)}!` }])
		)
		expect(out).toEqual(["tripped"])
		expect(ms).toBeLessThan(WITHIN)
	})

	it("trips a slow key the heuristic misses, skips it after, and says so", () => {
		// Polynomial rather than exponential — no repeat nests — so the write
		// side lets it through; only the bound can stop it.
		const pattern = "\\d+\\d+\\d+\\d+x"
		expect(runawayPatternOf(pattern)).toBeNull()
		const window = win("1".repeat(3000))
		const [at, ms] = timed(() => matchIndexOf(pattern, regex, window))
		expect(at).toBe(-1)
		expect(ms).toBeLessThan(WITHIN)
		expect(patternsNotRun(window).get(patternKey(pattern, false))?.cause).toBe(
			"tripped"
		)
		// Remembered: the next window does not pay for it again.
		const next = win("1".repeat(3000))
		const [, again] = timed(() => matchIndexOf(pattern, regex, next))
		expect(again).toBeLessThan(5)
		expect(patternsNotRun(next).get(patternKey(pattern, false))?.cause).toBe(
			"tripped"
		)
	})

	it("stops running keys once one scan's time is spent", () => {
		const slow = Array.from({ length: 40 }, (_, i) => ({
			re: new RegExp(`\\d+\\d+\\d+\\d+x${i}`),
			text: "1".repeat(3000)
		}))
		const [out, ms] = timed(() => runBounded(slow))
		expect(ms).toBeLessThan(PATTERN_SCAN_BUDGET_MS + WITHIN)
		expect(out).toContain("budget")
		expect(out.filter((o) => o === "tripped").length).toBeLessThan(slow.length)
	})

	it("does not blame a key for time another key in its batch spent", () => {
		const out = runBounded([
			{ re: /\d+\d+\d+\d+x/, text: "1".repeat(3000) },
			{ re: /ember/, text: "the ember glows" }
		])
		expect(out).toEqual(["tripped", 4])
	})

	it("refuses a runaway pattern without running it, and records why", () => {
		const window = win(`${"a".repeat(25)}!`)
		expect(patternIndex(window, "(a+)+$", false)).toMatchObject({
			cause: "nestedRepeat"
		})
		expect(patternsNotRun(window).get(patternKey("(a+)+$", false))?.why).toContain(
			"repeats a group"
		)
	})
})

/** Let the event loop turn, as it does between two turns of a session. */
const nextTask = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * A job that takes `ms` of wall time, whatever the machine: its text is read
 * inside the timed run, and reading it waits. A slow key made of a slow
 * pattern would be slow by a different amount on every machine and under
 * every load; this is slow by exactly as much as the test says.
 */
const busyJob = (pattern: string, ms: number, text = "the ember glows") => ({
	re: new RegExp(pattern, "i"),
	key: patternKey(pattern, false),
	get text() {
		const until = performance.now() + ms
		while (performance.now() < until);
		return text
	}
})

describe("what a key may cost, once per process", () => {
	it("gives a key that trips once a second run, at once, on the same text", () => {
		// The first read of `text` is the runaway one, every later read is
		// five characters: a key that was slow once — V8's first, interpreted
		// run, or a garbage-collection pause landing inside it — and never again.
		const pattern = "\\d+\\d+\\d+\\d+x"
		let reads = 0
		const job = {
			re: new RegExp(pattern, "i"),
			key: patternKey(pattern, false),
			get text() {
				return reads++ === 0 ? "1".repeat(3000) : "1234x"
			}
		}
		expect(runBounded([job])).toEqual([0])
		expect(reads).toBe(2)
		// Not remembered as a trip: the next window that asks for it runs it.
		expect(patternIndex(win("the 1234x"), pattern, false)).toBe(4)
	})

	it("clears a trip with the fast runs after it, within one batch too", () => {
		const pattern = "\\d+\\d+\\d+\\d+x"
		const slowOnce = () => {
			let reads = 0
			return {
				re: new RegExp(pattern, "i"),
				key: patternKey(pattern, false),
				get text() {
					return reads++ === 0 ? "1".repeat(3000) : "1234x"
				}
			}
		}
		const fast = { re: new RegExp(pattern, "i"), key: patternKey(pattern, false), text: "1234x" }
		// Trip, run fast, run fast, trip: never two trips running.
		expect(runBounded([slowOnce(), fast, slowOnce()])).toEqual([0, 0, 0])
		expect(patternIndex(win("a 1234x"), pattern, false)).toBe(2)
	})

	it("skips a key that trips twice running", () => {
		const out = runBounded([
			{ re: /\d+\d+\d+\d+x/, text: "1".repeat(3000), key: "twice" },
			{ re: /\d+\d+\d+\d+x/, text: "1".repeat(3000), key: "twice" }
		])
		// The second job is answered without running: its key is done.
		expect(out).toEqual(["tripped", "tripped"])
	})

	it("skips a key that stays under the bound but is slow every run", () => {
		const pattern = "ember"
		// 8 ms a run: past the slow mark, a third of the bound, so no run
		// trips it — and seven of them are its whole debt.
		for (let run = 0; run < Math.ceil(PATTERN_DEBT_MS / 8); run++)
			expect(runBounded([busyJob(pattern, 8)])).toEqual([4])
		expect(patternIndex(win("ember"), pattern, false)).toMatchObject({ cause: "tripped" })
	})

	it("forgives a key its slow runs once it runs fast", () => {
		const pattern = "glow"
		for (let turn = 0; turn < 12; turn++) {
			// Slow, then fast: a fast run clears the debt, so a key slow only
			// on unlucky text (or under an unlucky pause) is not skipped for it.
			expect(runBounded([busyJob(pattern, 8)])).toEqual([10])
			expect(patternIndex(win("the embers glow"), pattern, false)).toBe(11)
		}
	})

	it("once a key is skipped, answers its other windows without running them", () => {
		const windows = Array.from({ length: 20 }, () => win("1".repeat(3000)))
		const [, ms] = timed(() =>
			primePatterns(
				windows,
				[
					{ pattern: "\\d+\\d+\\d+\\d+y", sensitive: false },
					{ pattern: "1{3}", sensitive: false }
				],
				patternBudget()
			)
		)
		// Two bounds for the key, then nothing: the other nineteen windows
		// did not each pay a bound, and the ordinary key was still run.
		expect(ms).toBeLessThan(WITHIN)
		for (const window of windows) {
			const notRun = patternsNotRun(window)
			expect(notRun.get(patternKey("\\d+\\d+\\d+\\d+y", false))?.cause).toBe("tripped")
			expect(notRun.has(patternKey("1{3}", false))).toBe(false)
		}
	})

	it("holds every scan of one task to the task's budget, and a new task to a new one", async () => {
		const slow = (tag: string) =>
			Array.from({ length: 40 }, (_, i) => busyJob(`glows|${tag}${i}`, 8))
		const ran = (out: unknown[]) => out.filter((o) => typeof o === "number").length
		// Two scans, each with a budget of its own, in one task.
		const first = runBounded(slow("a"), patternBudget())
		const second = runBounded(slow("b"), patternBudget())
		expect(first).toContain("budget")
		expect(ran(first)).toBeGreaterThan(ran(second))
		// What the task had left after the first, and at most one bound over.
		expect(ran(second) * 8).toBeLessThanOrEqual(
			PATTERN_TASK_BUDGET_MS - PATTERN_SCAN_BUDGET_MS + PATTERN_TIME_BOUND_MS + 8
		)
		await nextTask()
		expect(ran(runBounded(slow("c"), patternBudget()))).toBeGreaterThan(ran(second))
	})
})

describe("ordinary regex keys", () => {
	const window = win("The Ashguard rode past the embers of Hollowgate.")

	it("still match, at the right offset", () => {
		expect(matchIndexOf("\\b(ash|em)(guard|bers)\\b", regex, window)).toBe(4)
		expect(matchIndexOf("hollow\\w+", regex, window)).toBe(37)
		expect(matchIndexOf("\\bdragons?\\b", regex, window)).toBe(-1)
	})

	it("keep their case rules: the i flag, never a lowercased pattern", () => {
		expect(matchIndexOf("ASHGUARD", regex, window)).toBe(4)
		expect(matchIndexOf("ASHGUARD", { ...regex, caseSensitive: true }, window)).toBe(-1)
		expect(matchIndexOf("\\Bguard", regex, window)).toBe(7)
	})

	it("an invalid pattern still falls back to substring", () => {
		expect(matchIndexOf("ember(", regex, win("an ember( glows"))).toBe(3)
	})
})
