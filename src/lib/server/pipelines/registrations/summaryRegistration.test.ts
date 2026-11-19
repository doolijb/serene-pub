/**
 * 🚧 The pick rule of `summaryRegistrationIn`: a rules action is never a candidate; core's own action wins
 * wherever it sits; otherwise the first candidate in effective order; close-out ignores a switched-off one.
 */
import { describe, expect, test } from "vitest"
import type { EffectiveRegistration } from "@serene-pub/sdk"
import { summaryRegistrationIn } from "./summaryRegistration"

const reg = (action: string, key: string, mode = "on"): EffectiveRegistration =>
	({
		key,
		mode,
		pipeline: action.split("#")[0],
		trigger: { family: "action", action }
	}) as unknown as EffectiveRegistration

const CORE_WORLD = "core:spec/summarize-world#summarize-world"
const RULES_WORLD = "core:spec/rules-action#summarize-world"

describe("summaryRegistrationIn — the pick rule", () => {
	test("a rules action beside core's: core's wins; alone: none", () => {
		const core = reg(CORE_WORLD, "k-core")
		const rules = reg(RULES_WORLD, "a-rules")
		expect(summaryRegistrationIn([rules, core], "world")?.key).toBe("k-core")
		expect(summaryRegistrationIn([rules], "world")).toBeNull()
	})

	test("core's beside a genre's own wins in either namespace order", () => {
		for (const ns of ["acme", "zeta"]) {
			const core = reg(CORE_WORLD, "k-core")
			const own = reg(`${ns}:spec/own#summarize-world`, `${ns}-own`)
			expect(summaryRegistrationIn([own, core], "world")?.key).toBe("k-core")
			expect(summaryRegistrationIn([core, own], "world")?.key).toBe("k-core")
		}
	})

	test("a genre's own alone is found; a different kind is not", () => {
		const own = reg("acme:spec/own#summarize-world", "own")
		expect(summaryRegistrationIn([own], "world")?.key).toBe("own")
		expect(summaryRegistrationIn([own], "character")).toBeNull()
	})

	test("a switched-off summarize registration is returned; a switched-off close-out never shadows a live one", () => {
		expect(summaryRegistrationIn([reg(CORE_WORLD, "off", "off")], "world")?.key).toBe("off")
		const off = reg("core:spec/summarize-scene#close-out", "a-off", "off")
		const live = reg("acme:spec/own#close-out", "z-live")
		expect(summaryRegistrationIn([off, live], "close-out")?.key).toBe("z-live")
		expect(summaryRegistrationIn([off], "close-out")).toBeNull()
	})
})
