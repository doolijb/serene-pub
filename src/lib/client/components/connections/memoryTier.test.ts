import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
	DEFAULT_MEMORY_TIER,
	MEMORY_TIERS,
	MEMORY_TIER_KEY,
	fitFor,
	fitSentence,
	matchesTier,
	parseMemoryTier,
	readMemoryTier,
	tierBudget,
	tierLabel,
	writeMemoryTier
} from "./memoryTier"

const GIB = 1024 * 1024 * 1024

describe("tierBudget", () => {
	test("the four sizes are GiB, because cards are sold in GiB", () => {
		expect(tierBudget("4gb")).toBe(4 * GIB)
		expect(tierBudget("8gb")).toBe(8 * GIB)
		expect(tierBudget("12gb")).toBe(12 * GIB)
		expect(tierBudget("24gb")).toBe(24 * GIB)
	})
	test("Not sure has no budget at all", () => {
		expect(tierBudget("unsure")).toBeNull()
	})
	test("every tier has a label", () => {
		for (const tier of MEMORY_TIERS)
			expect(tierLabel(tier.value)).toBe(tier.label)
	})
})

describe("fitFor — three answers and a refusal", () => {
	test("a file inside the headroom fits", () => {
		expect(fitFor(4 * GIB, "8gb")).toBe("fits")
		// Exactly at 80% is still a fit.
		expect(fitFor(8 * GIB * 0.8, "8gb")).toBe("fits")
	})
	test("above the headroom but inside the card is tight", () => {
		expect(fitFor(7 * GIB, "8gb")).toBe("tight")
		expect(fitFor(8 * GIB, "8gb")).toBe("tight")
	})
	test("past the card is too big", () => {
		expect(fitFor(9 * GIB, "8gb")).toBe("too_big")
	})
	test("Not sure refuses to answer rather than guessing", () => {
		expect(fitFor(4 * GIB, "unsure")).toBe("unknown")
	})
	test("an unquoted size refuses too", () => {
		expect(fitFor(null, "8gb")).toBe("unknown")
		expect(fitFor(undefined, "8gb")).toBe("unknown")
		expect(fitFor(0, "8gb")).toBe("unknown")
		expect(fitFor(Number.NaN, "8gb")).toBe("unknown")
	})
})

describe("fitSentence", () => {
	test("names the tier, so the sentence stands alone", () => {
		expect(fitSentence("fits", "8gb")).toBe("Fits in 8 GB")
		expect(fitSentence("tight", "12gb")).toBe("Tight in 12 GB")
		expect(fitSentence("too_big", "4gb")).toBe("Too big for 4 GB")
	})
	test("unknown says nothing", () => {
		expect(fitSentence("unknown", "8gb")).toBeNull()
	})
})

describe("matchesTier — the YAML's own recommendation", () => {
	test("a recommendation at or under the card matches", () => {
		expect(matchesTier(8, "8gb")).toBe(true)
		expect(matchesTier(6, "8gb")).toBe(true)
	})
	test("over the card does not", () => {
		expect(matchesTier(12, "8gb")).toBe(false)
	})
	test("Not sure golds nothing", () => {
		expect(matchesTier(4, "unsure")).toBe(false)
	})
	test("an absent recommendation is not a match", () => {
		expect(matchesTier(null, "24gb")).toBe(false)
		expect(matchesTier(undefined, "24gb")).toBe(false)
	})
})

describe("parseMemoryTier", () => {
	test("keeps a known value", () => {
		expect(parseMemoryTier("12gb")).toBe("12gb")
	})
	test("anything else is the default", () => {
		expect(parseMemoryTier("64gb")).toBe(DEFAULT_MEMORY_TIER)
		expect(parseMemoryTier(null)).toBe(DEFAULT_MEMORY_TIER)
		expect(parseMemoryTier(undefined)).toBe(DEFAULT_MEMORY_TIER)
	})
})

describe("storage is a convenience, never a dependency", () => {
	const original = globalThis.localStorage
	afterEach(() => {
		if (original) globalThis.localStorage = original
		else delete (globalThis as any).localStorage
		vi.unstubAllGlobals()
	})

	test("round-trips through localStorage", () => {
		const store = new Map<string, string>()
		vi.stubGlobal("localStorage", {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v)
		})
		writeMemoryTier("12gb")
		expect(store.get(MEMORY_TIER_KEY)).toBe("12gb")
		expect(readMemoryTier()).toBe("12gb")
	})

	test("a throwing accessor reads as Not sure and writes silently", () => {
		vi.stubGlobal("localStorage", {
			get getItem(): never {
				throw new Error("site data blocked")
			},
			get setItem(): never {
				throw new Error("site data blocked")
			}
		})
		expect(readMemoryTier()).toBe(DEFAULT_MEMORY_TIER)
		expect(() => writeMemoryTier("8gb")).not.toThrow()
	})

	test("junk in storage reads as the default", () => {
		vi.stubGlobal("localStorage", {
			getItem: () => "a-lot",
			setItem: () => {}
		})
		expect(readMemoryTier()).toBe(DEFAULT_MEMORY_TIER)
	})
})
