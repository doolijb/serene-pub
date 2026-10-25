/**
 * 🚧 A registration's `when` is judged by the SDK's `evaluateCondition`
 * (lane 2): `any`, `not` and the any-member `*` segment — which the
 * enabled-when list cannot say — and the annex, published by owner.
 */
import { describe, expect, it } from "vitest"
import { withConditions } from "./sessionActions"
import { publishedAnnex } from "./publishedValues"

const doc = (over: Record<string, unknown> = {}) =>
	({
		session: { generating: false, fields: {}, openForm: null },
		state: { world: { weather: "storm" }, cast: { byId: { "1": { hp: 0 }, "2": { hp: 7 } } } },
		sprites: { byId: {} },
		backdrop: { set: false, mediaId: null },
		annex: publishedAnnex({ "acme.dice": { armed: true }, "core:revision-points": { 1: {} } }),
		...over
	}) as never

const open = { enabled: true, itemPredicates: [] }

describe("a registration's when (R31)", () => {
	it("absent: the verdict stands", () => {
		expect(withConditions(open, undefined, doc())).toEqual(open)
	})

	it("any, not, and some member", () => {
		expect(withConditions(open, { any: [{ on: "state.world.weather", equals: "sun" }, { on: "state.world.weather", equals: "storm" }] }, doc()).enabled).toBe(true)
		expect(withConditions(open, { not: { on: "state.world.weather", equals: "storm" } }, doc()).enabled).toBe(false)
		expect(withConditions(open, { on: "state.cast.byId.*.hp", gt: 5 }, doc()).enabled).toBe(true)
		expect(withConditions(open, { on: "state.cast.byId.*.hp", gt: 9 }, doc()).enabled).toBe(false)
	})

	it("the first failing leaf's reason is the sentence", () => {
		const v = withConditions(
			open,
			{ all: [{ on: "state.world.weather", equals: "storm" }, { on: "session.generating", equals: true, reason: { en: "Only while it speaks." } }] } as never,
			doc()
		)
		expect(v.enabled).toBe(false)
		expect(JSON.stringify(v.reason)).toContain("Only while it speaks.")
	})

	it("an item condition with no row is handed to the client as the list it is", () => {
		const v = withConditions(open, { on: "item.isNewest", equals: true } as never, doc())
		expect(v.enabled).toBe(true)
		expect(v.itemPredicates).toEqual([expect.objectContaining({ on: "item.isNewest" })])
	})

	it("the annex is published by owner, dots written _, without its revision points", () => {
		expect(publishedAnnex({ "acme.dice": { armed: true }, "core:revision-points": { 1: {} } })).toEqual({ acme_dice: { armed: true } })
		expect(withConditions(open, { on: "annex.acme_dice.armed", truthy: true }, doc()).enabled).toBe(true)
	})
})
