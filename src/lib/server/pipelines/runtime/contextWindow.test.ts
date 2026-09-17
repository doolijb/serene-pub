/**
 * The one window computation (R-8) — the rules, stated as tests.
 *
 * The integration half — that the budget node, the dispatch and the panel all
 * call it and agree — is `utils/replyRoad.int.test.ts`. This pins the
 * arithmetic itself, because a function three callers share is a function
 * whose off-by-one reaches three places at once.
 */

import { describe, expect, it } from "vitest"
import {
	contextBudgetFrom,
	contextWindowFrom,
	replyReserveFrom
} from "./contextWindow"

describe("the window", () => {
	it("is the sampling config's Context Tokens where it is switched on", () => {
		expect(contextWindowFrom({ contextTokens: 8192 })).toBe(8192)
	})

	it("reads a numeric string as the number it spells — stored values are not coerced on read", () => {
		expect(contextWindowFrom({ contextTokens: "8192" })).toBe(8192)
	})

	it("is 4096 when the parameter is switched off, which is what 'the user did not say' has always meant", () => {
		expect(contextWindowFrom({})).toBe(4096)
		expect(contextWindowFrom(null)).toBe(4096)
		expect(contextWindowFrom({ contextTokens: "" })).toBe(4096)
		expect(contextWindowFrom({ contextTokens: 0 })).toBe(4096)
	})

	it("is capped by the model's own window where the model states one (0114)", () => {
		expect(
			contextWindowFrom({ contextTokens: 16384 }, { contextWindow: 8192 })
		).toBe(8192)
		// …and not raised by it: a config asking for less than the model holds
		// is a choice somebody made.
		expect(
			contextWindowFrom({ contextTokens: 4096 }, { contextWindow: 8192 })
		).toBe(4096)
		// Null on every row the backfill created — nothing moves.
		expect(
			contextWindowFrom({ contextTokens: 16384 }, { contextWindow: null })
		).toBe(16384)
	})
})

describe("the reply's reserve", () => {
	it("is Response Tokens, else 512", () => {
		expect(replyReserveFrom({ responseTokens: 200 })).toBe(200)
		expect(replyReserveFrom({})).toBe(512)
	})
})

describe("the budget", () => {
	it("is (window − reserve) × (1 − margin), floored, never negative", () => {
		const b = contextBudgetFrom({
			sampling: { contextTokens: 8192, responseTokens: 512 }
		})
		expect(b).toEqual({
			window: 8192,
			reserved: 512,
			total: 7296,
			remaining: 7296,
			available: 7296
		})
		expect(
			contextBudgetFrom({
				sampling: { contextTokens: 300, responseTokens: 512 }
			}).available
		).toBe(0)
	})

	it("takes the node's own margin, and its declared default otherwise", () => {
		expect(
			contextBudgetFrom({
				sampling: { contextTokens: 8192, responseTokens: 512 },
				safetyMargin: 0
			}).available
		).toBe(7680)
		expect(
			contextBudgetFrom({
				sampling: { contextTokens: 8192, responseTokens: 512 },
				safetyMargin: "not a number"
			}).available
		).toBe(7296)
	})

	it("sizes to the model's window through the same cap the dispatch applies", () => {
		const b = contextBudgetFrom({
			sampling: { contextTokens: 16384, responseTokens: 200 },
			connection: { contextWindow: 2048 }
		})
		expect(b.window).toBe(2048)
		expect(b.available).toBe(Math.floor((2048 - 200) * 0.95))
	})
})
