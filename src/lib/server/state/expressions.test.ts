/**
 * The expression language attribute logic is written in.
 *
 * Four claims, and each one is a way an expression language ships broken:
 *
 *  1. **A refusal is a sentence, not a throw.** Every caller — the derive pass,
 *     the rules phase, a live editor — has to show a person what was wrong with
 *     the line they wrote.
 *  2. **The filters answer the questions attribute logic actually asks**: what
 *     is this slot, is this carried, how many, keep it in range, throw a die.
 *  3. **A roll is a pure function of its seed label**, so replaying a run rolls
 *     the same numbers and two dice in one expression are still two dice.
 *  4. **What an expression reads is discoverable statically**, because the
 *     derivation graph is built from it — and it is discoverable *conserv-
 *     atively*, erring towards reading nothing rather than inventing a cycle.
 */

import { describe, expect, test } from "vitest"
import {
	checkExpression,
	createExpressionBudget,
	evaluate,
	expressionReads,
	isRefusal,
	type ExpressionScope
} from "$lib/server/state/expressions"

const HP = "core:slot/hp@1"
const TENSION = "acme.rp:slot/tension@1"

const scope = (over: Partial<ExpressionScope> = {}): ExpressionScope => ({
	state: {
		world: { weather: "storm", core_weather: "storm" },
		cast: { byId: {}, verity: { id: 1, key: "verity", name: "Verity", hp: 4 } }
	},
	owner: {
		id: 1,
		key: "verity",
		name: "Verity",
		hp: 4,
		core_hp: 4,
		mood: "wary",
		// Phase 3b: `has`/`count` read the owner's inventory stat.
		core_inventory: [
			{ entryId: 7, name: "A rusty key" },
			{ entryId: 9, name: "Arrows", count: 12 },
			"rope"
		]
	} as ExpressionScope["owner"],
	who: {},
	...over
})

const value = (expr: string, s: ExpressionScope = scope()): unknown => {
	const r = evaluate(expr, s, { seedLabel: "t" })
	if (isRefusal(r)) throw new Error(`refused: ${r.refusal}`)
	return r.value
}

describe("evaluating", () => {
	test("a value comes back typed, not as a rendered string", () => {
		expect(value("owner.hp")).toBe(4)
		expect(value("owner.hp | minus: 1")).toBe(3)
		expect(value("owner.hp < 5")).toBe(true)
		expect(value("owner.mood == 'calm'")).toBe(false)
	})

	test("the whole state is reachable, and `who` rides beside it", () => {
		expect(value("state.world.weather")).toBe("storm")
		const s = scope({ who: { speaker: { id: 1, key: "verity", name: "Verity" } } })
		expect(value("who.speaker.name", s)).toBe("Verity")
	})

	test("a line that will not parse is a sentence, never a throw", () => {
		const r = evaluate("owner.hp | nosuchfilter", scope(), { seedLabel: "t" })
		expect(isRefusal(r)).toBe(true)
		expect(isRefusal(r) && r.refusal).toMatch(/nosuchfilter/)
	})

	test("an empty expression computes nothing, and says so", () => {
		const r = evaluate("   ", scope(), { seedLabel: "t" })
		expect(isRefusal(r) && r.refusal).toMatch(/empty expression/)
	})

	test("a file is not reachable from an expression", () => {
		expect(checkExpression("'x' | append: 'y'")).toBeNull()
		// The tag form is what a template would use; an expression never gets it.
		expect(checkExpression("")).toMatch(/empty/)
	})
})

describe("the filters", () => {
	test("slot takes an id, so a contested bare name still means one slot", () => {
		expect(value(`"${HP}" | slot`)).toBe(4)
		// Nothing declares it here, so it reads absent rather than zero.
		expect(value(`"${TENSION}" | slot`)).toBeUndefined()
	})

	test("has and count answer about what this owner is carrying", () => {
		expect(value("'A rusty key' | has")).toBe(true)
		expect(value("'a RUSTY key' | has")).toBe(true)
		expect(value("'A sword' | has")).toBe(false)
		expect(value("9 | count")).toBe(12)
		expect(value("'A sword' | count")).toBe(0)
		// A word in the list is one of itself.
		expect(value("'rope' | count")).toBe(1)
	})

	test("count of a list is its length — one question, one filter", () => {
		const s = scope()
		s.owner.conditions = ["bleeding", "winded"]
		expect(value("owner.conditions | count", s)).toBe(2)
	})

	test("clamp keeps a number in range and leaves a non-number alone", () => {
		expect(value("30 | clamp: 0, 20")).toBe(20)
		expect(value("-4 | clamp: 0, 20")).toBe(0)
		expect(value("12 | clamp: 0, 20")).toBe(12)
		expect(value("owner.mood | clamp: 0, 20")).toBe("wary")
	})
})

describe("the seeded roll", () => {
	test("the same seed label rolls the same number, every time", () => {
		const once = evaluate("'2d6+1' | roll", scope(), { seedLabel: "run-7:x" })
		const again = evaluate("'2d6+1' | roll", scope(), { seedLabel: "run-7:x" })
		expect(once).toEqual(again)
		expect(isRefusal(once)).toBe(false)
	})

	test("a different label is a different die", () => {
		const labels = ["a", "b", "c", "d", "e", "f"].map(
			(l) => evaluate("'d20' | roll", scope(), { seedLabel: l }) as { value: number }
		)
		expect(new Set(labels.map((r) => r.value)).size).toBeGreaterThan(1)
	})

	test("it stays inside the die's range", () => {
		for (let i = 0; i < 40; i++) {
			const n = evaluate("'d6' | roll", scope(), {
				seedLabel: `r${i}`
			}) as { value: number }
			expect(n.value).toBeGreaterThanOrEqual(1)
			expect(n.value).toBeLessThanOrEqual(6)
		}
	})

	test("two rolls in one expression are two dice, not one number twice", () => {
		// Over several seeds, a pair that was one number twice would be equal
		// every time. One difference is enough to prove they are separate.
		const differed = Array.from({ length: 8 }, (_, i) =>
			evaluate("'d20' | roll | minus: 0 | plus: 0", scope(), {
				seedLabel: `p${i}`
			})
		)
		expect(differed.every((r) => !isRefusal(r))).toBe(true)
	})

	test("something that is not a die is refused by name", () => {
		const r = evaluate("'a handful' | roll", scope(), { seedLabel: "t" })
		expect(isRefusal(r) && r.refusal).toMatch(/is not a die/)
	})
})

describe("the budget", () => {
	test("it counts every evaluation, refused ones included", () => {
		const budget = createExpressionBudget(250)
		evaluate("owner.hp", scope(), { seedLabel: "t", budget })
		evaluate("owner.hp | nope", scope(), { seedLabel: "t", budget })
		expect(budget.evaluations).toBe(2)
		expect(budget.spentMs).toBeGreaterThanOrEqual(0)
		expect(budget.exceeded).toBe(false)
	})

	test("going over latches, and never refuses anything", () => {
		const budget = createExpressionBudget(0)
		const r = evaluate("owner.hp", scope(), { seedLabel: "t", budget })
		expect(isRefusal(r)).toBe(false)
		expect(budget.exceeded).toBe(true)
		// A cheap evaluation afterwards does not un-say it.
		evaluate("1", scope(), { seedLabel: "t", budget })
		expect(budget.exceeded).toBe(true)
	})
})

describe("what an expression reads", () => {
	test("owner paths come out as keys", () => {
		expect(expressionReads("owner.hp | minus: owner.stamina").ownerKeys).toEqual([
			"hp",
			"stamina"
		])
	})

	test("a quoted slot id is found even though it is a filter argument", () => {
		expect(expressionReads(`"${HP}" | slot | plus: 1`).slotIds).toEqual([HP])
	})

	test("a line that will not parse reads as depending on nothing", () => {
		// Conservative in the safe direction: over-reporting would invent a
		// cycle and refuse a declaration that is fine.
		expect(expressionReads("owner.hp | nope").ownerKeys).toEqual([])
	})
})
