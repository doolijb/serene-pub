/**
 * The summarize batch size: declared, resolved, and clamped to the window.
 *
 * `core:task/batch-messages@1` decides how much chat one draft is written
 * against. Three things have to be true of that decision and were not:
 *
 *  1. The declared `batchTokens` has to *mean* what it says — "how many tokens
 *     of chat each summarizing batch holds". The binding subtracted a 1500-token
 *     reserve from it, so an admin asking for 2048 got 548.
 *  2. It has to be clamped. Nothing read the sampling config at all, so a batch
 *     size above the model's window produced a prompt the model could not hold —
 *     the whole batch plus the reserve, sent at once, with no truncation
 *     anywhere on this path (`compilePrompt` returns early on an injected
 *     prompt, so `getContextTokenLimit()` never supersedes it).
 *  3. The clamp has to survive a window that is not a number. `ResolvedSampling`
 *     is `Record<string, unknown>` and coercion lives on the WRITE path, so a
 *     row storing `"8192"` hands this a string.
 *
 * Bigger is not better here: long-context models degrade in the middle, so the
 * default is a quality point and the clamp is a ceiling, not a target.
 */

import { describe, it, expect } from "vitest"
import { roughTokens } from "@serene-pub/sdk"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import {
	BATCH_RESERVE_TOKENS,
	DEFAULT_BATCH_TOKENS,
	MIN_BATCH_TOKENS
} from "$lib/server/utils/summarizer/batchBudget"

const binding = () => coreBindings()["core:task/batch-messages@1"]!

/** The binding's own per-message cost, restated so assertions can be exact. */
const cost = (m: { senderName: string; content: string }) =>
	roughTokens(JSON.stringify({ speaker: m.senderName, text: m.content })) + 5

const lines = (n: number, width = 200) =>
	Array.from({ length: n }, (_, i) => ({
		senderName: "Mira",
		content: `${i}: ${"the gate was sealed with old iron. ".repeat(width / 35)}`
	}))

/** The largest batch's chat cost — what has to fit beside the reserve. */
const widest = (batches: any[][]) =>
	Math.max(0, ...batches.map((b) => b.reduce((t, m) => t + cost(m), 0)))

async function run(input: Record<string, unknown>) {
	const result: any = await binding()(input, {} as any)
	return result
}

async function batchesOf(input: Record<string, unknown>) {
	const result = await run(input)
	expect(
		result?.kind,
		`expected batches, got ${result?.kind}: ${result?.reason ?? ""}`
	).not.toBe("halt")
	return (result.value?.batches ?? result.batches) as any[][]
}

describe("the batch size is clamped to the window the drafts are sent against", () => {
	it("never cuts a batch a 2k window cannot hold beside the reserve", async () => {
		// The live overflow. A 2k local model with an admin who raised the batch
		// size gets a prompt that cannot fit — no error, just a truncated or
		// refused call, once per batch.
		const batches = await batchesOf({
			messages: lines(60),
			params: { batchTokens: 8192 },
			sampling: { contextTokens: 2048 }
		})
		expect(widest(batches) + BATCH_RESERVE_TOKENS).toBeLessThanOrEqual(2048)
	})

	it("clamps a batch size above the window rather than honouring it", async () => {
		const batches = await batchesOf({
			messages: lines(120),
			params: { batchTokens: 32000 },
			sampling: { contextTokens: 4096 }
		})
		expect(widest(batches) + BATCH_RESERVE_TOKENS).toBeLessThanOrEqual(4096)
		// And it really is the window doing the clamping, not a coincidence of
		// message sizes: the cut is close to the ceiling, not far under it.
		expect(widest(batches)).toBeGreaterThan(
			4096 - BATCH_RESERVE_TOKENS - 400
		)
	})

	it("reads a window stored as a string, rather than substituting a default", async () => {
		// `ResolvedSampling` is `Record<string, unknown>` and is not coerced on
		// read — coercion is the write path's. A row holding "2048" must clamp
		// exactly as 2048 does.
		const messages = lines(60)
		const asString = await batchesOf({
			messages,
			params: { batchTokens: 8192 },
			sampling: { contextTokens: "2048" }
		})
		const asNumber = await batchesOf({
			messages,
			params: { batchTokens: 8192 },
			sampling: { contextTokens: 2048 }
		})
		expect(asString.map((b) => b.length)).toEqual(
			asNumber.map((b) => b.length)
		)
		// And both really clamped — identical-but-unclamped would satisfy the
		// line above while proving nothing.
		expect(widest(asString) + BATCH_RESERVE_TOKENS).toBeLessThanOrEqual(
			2048
		)
	})

	it("leaves the declared size alone when the window cannot be read at all", async () => {
		// Not a silent 4096: substituting one would re-budget every run whose
		// sampling row holds something this cannot parse, in the direction that
		// shrinks batches, with nothing anywhere saying so.
		const messages = lines(120)
		const unreadable = await batchesOf({
			messages,
			params: { batchTokens: 6000 },
			sampling: { contextTokens: "wide" }
		})
		const noWindow = await batchesOf({
			messages,
			params: { batchTokens: 6000 }
		})
		expect(unreadable.map((b) => b.length)).toEqual(
			noWindow.map((b) => b.length)
		)
		expect(widest(unreadable)).toBeGreaterThan(5000)
	})

	it("halts when the window is too small to hold the reserve at all", async () => {
		// Below this the window itself is the problem, and a batch floored at
		// some minimum would still overflow it. Saying so beats sending a prompt
		// that cannot fit.
		const result = await run({
			messages: lines(20),
			sampling: {
				contextTokens: BATCH_RESERVE_TOKENS + MIN_BATCH_TOKENS - 1
			}
		})
		expect(result?.kind).toBe("halt")
		expect(String(result?.reason)).toMatch(/context/i)
	})

	it("does not halt at exactly the smallest workable window", async () => {
		const batches = await batchesOf({
			messages: lines(20),
			sampling: { contextTokens: BATCH_RESERVE_TOKENS + MIN_BATCH_TOKENS }
		})
		expect(widest(batches) + BATCH_RESERVE_TOKENS).toBeLessThanOrEqual(
			BATCH_RESERVE_TOKENS + MIN_BATCH_TOKENS
		)
	})
})

describe("the declared batch size means what it says", () => {
	it("gives an admin the chat tokens they asked for, not that minus a reserve", async () => {
		const batches = await batchesOf({
			messages: lines(200),
			params: { batchTokens: 6000 },
			sampling: { contextTokens: 32768 }
		})
		expect(widest(batches)).toBeGreaterThan(5000)
		expect(widest(batches)).toBeLessThanOrEqual(6000)
	})

	it("falls back to the declared default when no size was configured", async () => {
		const batches = await batchesOf({
			messages: lines(200),
			sampling: { contextTokens: 32768 }
		})
		expect(widest(batches)).toBeLessThanOrEqual(DEFAULT_BATCH_TOKENS)
		expect(widest(batches)).toBeGreaterThan(DEFAULT_BATCH_TOKENS - 400)
	})

	it("does not grow the default to fill a large window", async () => {
		// The clamp is a ceiling, not a target — long-context models degrade in
		// the middle, so a bigger window buys a worse summary, not a better one.
		const small = await batchesOf({
			messages: lines(200),
			sampling: { contextTokens: 8192 }
		})
		const huge = await batchesOf({
			messages: lines(200),
			sampling: { contextTokens: 131072 }
		})
		expect(huge.map((b) => b.length)).toEqual(small.map((b) => b.length))
	})
})

/**
 * `minBatchMessages` — declared since the node was written, read by nothing
 * until R-12 (2026-09-16). "Never cut a batch smaller than this many messages":
 * a batch does not close below the floor however far over `batchTokens` it
 * runs, except the last one, which is whatever the source had left.
 */
describe("the minimum batch size means what it says", () => {
	/** Wide lines: at this width the token budget alone closes every batch at ONE message. */
	const wide = (n: number) => lines(n, 3000)
	/** A budget one wide line already exceeds, so the floor is the only thing keeping a batch open. */
	const tight = { batchTokens: MIN_BATCH_TOKENS, contextTokens: 131072 }

	it("at the declared default of 1 cuts exactly as it always did", async () => {
		const before = await batchesOf({
			messages: wide(6),
			params: { batchTokens: tight.batchTokens },
			sampling: { contextTokens: tight.contextTokens }
		})
		const explicit = await batchesOf({
			messages: wide(6),
			params: { batchTokens: tight.batchTokens, minBatchMessages: 1 },
			sampling: { contextTokens: tight.contextTokens }
		})
		// The token cut alone: one wide line per batch, six batches.
		expect(before.map((b) => b.length)).toEqual([1, 1, 1, 1, 1, 1])
		expect(explicit.map((b) => b.length)).toEqual(
			before.map((b) => b.length)
		)
	})

	it("never closes a batch below the floor, however far over budget it runs", async () => {
		const batches = await batchesOf({
			messages: wide(7),
			params: { batchTokens: tight.batchTokens, minBatchMessages: 3 },
			sampling: { contextTokens: tight.contextTokens }
		})
		// 3, 3, and the remainder — the source ran out, which is the one
		// condition under which a batch may be smaller than the floor.
		expect(batches.map((b) => b.length)).toEqual([3, 3, 1])
		// And every message is in exactly one batch, in order.
		expect(batches.flat().map((m) => m.content)).toEqual(
			wide(7).map((m) => m.content)
		)
	})

	it("is a floor, not a size: narrow lines still fill by tokens above it", async () => {
		const byTokens = await batchesOf({
			messages: lines(40),
			sampling: { contextTokens: 8192 }
		})
		const floored = await batchesOf({
			messages: lines(40),
			params: { minBatchMessages: 2 },
			sampling: { contextTokens: 8192 }
		})
		// Every token-cut batch here already holds more than two lines, so the
		// floor changes nothing.
		expect(byTokens.every((b) => b.length >= 2)).toBe(true)
		expect(floored.map((b) => b.length)).toEqual(
			byTokens.map((b) => b.length)
		)
	})

	it("treats 0, a negative or a non-number as the default floor of 1", async () => {
		for (const bad of [0, -4, "three", null, undefined])
			expect(
				(
					await batchesOf({
						messages: wide(4),
						params: {
							batchTokens: tight.batchTokens,
							minBatchMessages: bad
						},
						sampling: { contextTokens: tight.contextTokens }
					})
				).map((b) => b.length),
				`minBatchMessages: ${String(bad)}`
			).toEqual([1, 1, 1, 1])
	})
})
