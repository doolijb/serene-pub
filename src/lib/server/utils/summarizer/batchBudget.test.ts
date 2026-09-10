/**
 * The batch-budget arithmetic, pinned.
 *
 * The binding-level tests in `pipelines/runtime/summarizeBatchBudget.test.ts`
 * prove the cut honours this; these prove the numbers themselves, including the
 * two constants that are *decisions* rather than mechanics — a default and a
 * floor both move behaviour for every install without moving a line of logic, so
 * each is asserted as a literal here and can only change deliberately.
 */

import { describe, it, expect } from "vitest"
import {
	BATCH_RESERVE_TOKENS,
	DEFAULT_BATCH_TOKENS,
	MIN_BATCH_TOKENS,
	contextWindowOf,
	declaredBatchTokens,
	resolveBatchBudget
} from "./batchBudget"

describe("the constants are choices, not mechanics", () => {
	it("keeps 0.5's effective batch as the default", () => {
		// 0.5 cut at `4096 - 1500 = 2596` tokens of chat and that is a
		// defensible quality point; 2560 is the same point at a round 2.5 Ki.
		// Changing this re-tunes every summarization run on every install.
		expect(DEFAULT_BATCH_TOKENS).toBe(2560)
		expect(BATCH_RESERVE_TOKENS).toBe(1500)
		expect(MIN_BATCH_TOKENS).toBe(256)
	})
})

describe("reading the window off an un-coerced sampling value", () => {
	it("takes a number", () => {
		expect(contextWindowOf({ contextTokens: 8192 })).toBe(8192)
	})

	it("takes the numeric string the write path's convention allows", () => {
		// ⚠ `ResolvedSampling` is `Record<string, unknown>` and coercion lives on
		// the WRITE path, so a stored "8192" arrives here as a string.
		expect(contextWindowOf({ contextTokens: "8192" })).toBe(8192)
		expect(contextWindowOf({ contextTokens: " 8192 " })).toBe(8192)
		expect(contextWindowOf({ contextTokens: 8192.7 })).toBe(8192)
	})

	it("reports 'not stated' rather than inventing a window", () => {
		// Each of these used to be laundered into 4096 by an `as number` cast or
		// a `|| 4096`. Substituting one here would re-budget every install whose
		// row holds something unparseable, in the direction that shrinks batches,
		// with nothing anywhere saying so.
		for (const contextTokens of [
			undefined,
			null,
			"",
			"   ",
			"wide",
			NaN,
			Infinity,
			0,
			-1,
			{},
			[]
		])
			expect(
				contextWindowOf({ contextTokens }),
				`${JSON.stringify(contextTokens)} was read as a window`
			).toBeNull()
		expect(contextWindowOf(undefined)).toBeNull()
		expect(contextWindowOf(null)).toBeNull()
	})
})

describe("reading the declared size", () => {
	it("falls back to the declared default when it is unusable", () => {
		for (const v of [undefined, null, "", "big", NaN, 0, -5])
			expect(declaredBatchTokens(v)).toBe(DEFAULT_BATCH_TOKENS)
	})

	it("takes a number or the string spelling of one", () => {
		expect(declaredBatchTokens(6000)).toBe(6000)
		expect(declaredBatchTokens("6000")).toBe(6000)
		expect(declaredBatchTokens(1)).toBe(1)
	})
})

describe("the budget", () => {
	it("is the declared size when no window was stated", () => {
		expect(resolveBatchBudget({ batchTokens: 6000 })).toEqual({
			fits: true,
			tokens: 6000,
			window: null,
			clamped: false
		})
	})

	it("is the declared size when the window can hold it beside the reserve", () => {
		expect(
			resolveBatchBudget({
				batchTokens: 2560,
				sampling: { contextTokens: 8192 }
			})
		).toEqual({ fits: true, tokens: 2560, window: 8192, clamped: false })
	})

	it("is the window minus the reserve when the declared size exceeds it", () => {
		expect(
			resolveBatchBudget({
				batchTokens: 32000,
				sampling: { contextTokens: 4096 }
			})
		).toEqual({ fits: true, tokens: 2596, window: 4096, clamped: true })
	})

	it("fits exactly at the boundary rather than one token over it", () => {
		const smallest = BATCH_RESERVE_TOKENS + MIN_BATCH_TOKENS
		expect(
			resolveBatchBudget({ sampling: { contextTokens: smallest } })
		).toMatchObject({ fits: true, tokens: MIN_BATCH_TOKENS })
		expect(
			resolveBatchBudget({ sampling: { contextTokens: smallest - 1 } })
		).toMatchObject({ fits: false, window: smallest - 1 })
	})

	it("says why a window too small to summarize against cannot be used", () => {
		const result = resolveBatchBudget({
			batchTokens: 2560,
			sampling: { contextTokens: 1024 }
		})
		expect(result.fits).toBe(false)
		if (result.fits) return
		// Names the number the person has to change and the number to change it
		// to — a halt that only says "too small" sends them looking.
		expect(result.reason).toContain("1024")
		expect(result.reason).toContain(
			String(BATCH_RESERVE_TOKENS + MIN_BATCH_TOKENS)
		)
	})

	it("never scales the declared size up to fill a large window", () => {
		// The clamp is a ceiling, not a target — long-context models degrade in
		// the middle, so a 128k window must not buy a 100k batch.
		expect(
			resolveBatchBudget({ sampling: { contextTokens: 131072 } })
		).toMatchObject({ tokens: DEFAULT_BATCH_TOKENS, clamped: false })
	})
})
