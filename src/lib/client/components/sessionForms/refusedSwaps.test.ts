import { describe, expect, it } from "vitest"
import { refusedSwapsSentence } from "./refusedSwaps"

describe("refusedSwapsSentence", () => {
	it("says nothing when every swap was seated", () => {
		expect(refusedSwapsSentence({})).toBeNull()
		expect(refusedSwapsSentence({ refusedSwaps: [] })).toBeNull()
	})
	it("names each refused step with the setter's reason", () => {
		const s = refusedSwapsSentence({
			refusedSwaps: [
				{ spec: "core:spec/chat-turn-order", node: "strategy", definition: "x@1", reason: "not offered" }
			]
		})
		expect(s).toMatch(/^One setting could not be applied, so that step uses/)
		expect(s).toContain("Strategy: not offered")
	})
})
