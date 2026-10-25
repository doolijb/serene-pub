/**
 * 🚧 A ruleset's actions (D6): each invokable function an action registration
 * of the one rules-action pipeline; a fired action read back to the inlet.
 */
import { describe, expect, it } from "vitest"
import { defineRuleset, type FunctionDecl } from "@serene-pub/sdk"
import { RULES_ACTION_SPEC, rulesActionKey, rulesActionPayload, rulesActionRegistrations, rulesActionsOf } from "./rulesActions"

const R = "test:ruleset/actions-unit@1"
const mod = (id: string, extra: Partial<FunctionDecl>): FunctionDecl =>
	({ id, name: { en: id }, meaning: { en: "m" }, kind: "changing", prose: "p", ...extra }) as FunctionDecl
const ruleset = defineRuleset(R, {
	name: { en: "Actions" },
	functions: [
		{ ref: "test:function/act-confess@1", key: "confess", module: mod("test:function/act-confess@1", { invokable: { label: { en: "Confess" }, form: { bold: { type: "boolean", label: { en: "Boldly" } } } } }) },
		{ ref: "test:function/act-tick@1", module: mod("test:function/act-tick@1", {}) },
		{ ref: "test:function/act-sneak@1", key: "skill.sneak", module: mod("test:function/act-sneak@1", { invokable: { label: { en: "Sneak" } } }) }
	]
})

describe("a ruleset's actions", () => {
	it("one per invokable function, its form the header's", () => {
		const actions = rulesActionsOf(ruleset)
		expect(actions.map((a) => [a.identity, a.function])).toEqual([
			[`${RULES_ACTION_SPEC}#confess`, "confess"],
			[`${RULES_ACTION_SPEC}#skill-sneak`, "skill.sneak"]
		])
		expect(actions[0]!.form).toMatchObject({ type: "object", properties: { bold: { type: "boolean" } } })
		expect(rulesActionKey("Skill.Sneak!")).toBe("skill-sneak")
	})
	it("as registrations of the rules-action pipeline, keyed so a preset may drop one", () => {
		const regs = rulesActionRegistrations(ruleset)
		expect(regs.map((r) => [r.key, r.pipeline, r.trigger])).toEqual([
			["rules-action#confess→rules-action", RULES_ACTION_SPEC, { family: "action", action: `${RULES_ACTION_SPEC}#confess` }],
			["rules-action#skill-sneak→rules-action", RULES_ACTION_SPEC, { family: "action", action: `${RULES_ACTION_SPEC}#skill-sneak` }]
		])
	})
	it("a fired action reads back to the inlet's payload", () => {
		expect(rulesActionPayload(ruleset, `${RULES_ACTION_SPEC}#skill-sneak`, { sessionId: 4, actor: "character:2", answer: null })).toEqual({
			session: { sessionId: 4 },
			actor: "character:2",
			function: "skill.sneak",
			answer: null,
			aimedAt: null
		})
		expect(rulesActionPayload(ruleset, `${RULES_ACTION_SPEC}#tick`, { sessionId: 4 })).toBeNull()
	})
})
