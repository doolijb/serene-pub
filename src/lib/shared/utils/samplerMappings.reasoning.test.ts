/**
 * The reasoning half of the key maps, and the table every adapter reads.
 *
 * ## What this pins, and why it is not the adapters' own tests
 *
 * Two different readers use these maps, and they ask different questions. Each
 * adapter asks "what does this backend call the thing" while it builds a
 * request; the sampling config panel asks `getSupportedSamplers` "will the
 * connection a person is likely to run this against honour it at all", and
 * draws "not sent to this backend" beside every field the answer excludes. The
 * panel's note is therefore only as true as the map, and nothing in an
 * adapter's test can see it.
 *
 * The level table is here for the reason it exists at all: `medium` must mean
 * the same number of tokens whichever service answered, and a per-adapter copy
 * would be three answers the day somebody tuned one.
 */

import { describe, expect, test } from "vitest"
import { textSamplingSchema } from "@serene-pub/sdk"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	REASONING_KEYS,
	REASONING_LEVEL_BUDGET,
	getSupportedSamplers,
	isReasoningKey,
	reasoningBudgetFor,
	reasoningOf
} from "./samplerMappings"

describe("what the config panel says a backend will honour", () => {
	test("every text connection type honours the reasoning level", () => {
		// Six services, six spellings, one vocabulary name. A type missing from
		// this list is one whose panel would say "not sent to this backend"
		// above a control that IS sent.
		for (const type of [
			CONNECTION_TYPE.OPENAI,
			CONNECTION_TYPE.OLLAMA,
			CONNECTION_TYPE.LM_STUDIO,
			CONNECTION_TYPE.LLAMACPP,
			CONNECTION_TYPE.KOBOLDCPP,
			CONNECTION_TYPE.KOBOLDCPP_MANAGED,
			CONNECTION_TYPE.ANTHROPIC
		])
			expect(getSupportedSamplers(type), type).toContain("reasoning")
	})

	test("only the services that count in tokens claim the budget", () => {
		// The panel's note is the only warning a person gets before setting a
		// number that cannot travel, so an over-claim here is worse than none.
		for (const type of [
			CONNECTION_TYPE.LLAMACPP,
			CONNECTION_TYPE.ANTHROPIC
		])
			expect(getSupportedSamplers(type), type).toContain(
				"reasoningBudget"
			)
		for (const type of [
			CONNECTION_TYPE.OPENAI,
			CONNECTION_TYPE.OLLAMA,
			CONNECTION_TYPE.LM_STUDIO,
			CONNECTION_TYPE.KOBOLDCPP,
			CONNECTION_TYPE.KOBOLDCPP_MANAGED
		])
			expect(getSupportedSamplers(type), type).not.toContain(
				"reasoningBudget"
			)
	})

	test("both names are ones the vocabulary actually declares", () => {
		// A key map entry naming a sampler no shape declares is unreachable:
		// nothing can enable it, so the mapping can never fire.
		for (const key of REASONING_KEYS) {
			expect(textSamplingSchema[key], key).toBeDefined()
			expect(isReasoningKey(key)).toBe(true)
		}
		expect(isReasoningKey("temperature")).toBe(false)
	})
})

describe("reading a resolved config", () => {
	test("a config that did not enable it answers with nothing", () => {
		// Absence is the contract every adapter's "today's bytes" rests on.
		expect(reasoningOf({ temperature: 0.7 })).toEqual({})
	})

	test("a level the vocabulary does not declare is not a level", () => {
		// A row written by a newer build, or hand-edited: read as nothing
		// rather than forwarded as a word a service would refuse.
		expect(reasoningOf({ reasoning: "maximum" })).toEqual({})
		expect(reasoningOf({ reasoning: 3 })).toEqual({})
	})

	test("a budget is a whole non-negative number or nothing", () => {
		expect(
			reasoningOf({ reasoning: "low", reasoningBudget: 2048.6 })
		).toEqual({ level: "low", budget: 2049 })
		expect(reasoningOf({ reasoning: "low", reasoningBudget: -1 })).toEqual({
			level: "low"
		})
		expect(
			reasoningOf({ reasoning: "low", reasoningBudget: "big" })
		).toEqual({ level: "low" })
	})

	test("a number somebody typed beats the level's translation", () => {
		expect(reasoningBudgetFor("medium")).toBe(REASONING_LEVEL_BUDGET.medium)
		expect(reasoningBudgetFor("medium", 500)).toBe(500)
		// Zero is a choice, not an absence — `?? ` rather than `||` is what
		// makes that true.
		expect(reasoningBudgetFor("high", 0)).toBe(0)
	})
})
