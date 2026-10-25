/**
 * 🚧 Scopes and visibility (D4): core's four scopes answered natively; who
 * sees a thing by where it sits, an exposed thing by all; who may change a
 * value (`changedBy`).
 */
import { describe, expect, it } from "vitest"
import { CORE_SCOPE_IDS, defineRuleset, rulesetAttributeSlotId } from "@serene-pub/sdk"
import { changedByAllows, coreScopeMembers, visibleTo } from "./scopes"

const owner = (key: string, bag: Record<string, unknown> = {}) => ({ key, name: key, bag }) as never
const input = {
	owners: [owner("world"), owner("character:1", { location: { entryId: 9 } }), owner("character:2", { location: { entryId: 9 } }), owner("character:3", { location: "the docks" })],
	ties: [{ id: 1, from: "character:1", to: "character:3", type: "sibling" }]
} as never

describe("core's scopes, natively", () => {
	it("everyone, aimed at, within a tie, the same place", () => {
		expect(coreScopeMembers(input, CORE_SCOPE_IDS.everyone, null)).toEqual(["character:1", "character:2", "character:3", "world"])
		expect(coreScopeMembers(input, CORE_SCOPE_IDS.aimedAt, "character:1", { aimedAt: "character:2" })).toEqual(["character:2"])
		expect(coreScopeMembers(input, CORE_SCOPE_IDS.aimedAt, "character:1", { aimedAt: "character:9" })).toEqual([])
		expect(coreScopeMembers(input, CORE_SCOPE_IDS.withinTie, "character:3")).toEqual(["character:1"])
		expect(coreScopeMembers(input, CORE_SCOPE_IDS.samePlace, "character:1")).toEqual(["character:1", "character:2"])
		expect(coreScopeMembers(input, CORE_SCOPE_IDS.samePlace, "character:3")).toEqual(["character:3"])
		expect(coreScopeMembers(input, "acme:function/beside@1", "character:1")).toBeUndefined()
	})
})

describe("who sees a thing", () => {
	const members = async (scope: string, subject: string | null) => coreScopeMembers(input, scope, subject) ?? []
	it("by its visibility word, the game master always, an exposed thing by all", async () => {
		expect(await visibleTo(undefined, null, "character:1")).toBe(true)
		expect(await visibleTo("everyone", "character:2", "character:1")).toBe(true)
		expect(await visibleTo("holder", "character:1", "character:1")).toBe(true)
		expect(await visibleTo("holder", "character:2", "character:1")).toBe(false)
		expect(await visibleTo("holder", null, "character:1")).toBe(false)
		expect(await visibleTo("holder", "character:2", "character:1", { exposed: true })).toBe(true)
		expect(await visibleTo("gm", "character:1", "character:1")).toBe(false)
		expect(await visibleTo("gm", "gm", "character:1")).toBe(true)
	})
	it("by a scope: its members of the holder", async () => {
		expect(await visibleTo(CORE_SCOPE_IDS.samePlace, "character:2", "character:1", { members })).toBe(true)
		expect(await visibleTo(CORE_SCOPE_IDS.samePlace, "character:3", "character:1", { members })).toBe(false)
		expect(await visibleTo(CORE_SCOPE_IDS.samePlace, null, "character:1", { members })).toBe(false)
		expect(await visibleTo(CORE_SCOPE_IDS.everyone, null, "character:1", { members })).toBe(true)
	})
})

describe("who may change a value", () => {
	const R = "test:ruleset/changed-by-unit@1"
	const ruleset = defineRuleset(R, {
		name: { en: "Changed by" },
		attributes: [
			{ id: "name-tag", name: { en: "Name tag" }, kind: "label", changedBy: ["holder"], prose: "What they go by." },
			{ id: "score", name: { en: "Score" }, kind: "number", changedBy: ["rules", "gm"], prose: "The score." },
			{ id: "free", name: { en: "Free" }, kind: "number", prose: "Anyone's." }
		]
	})
	const slot = (a: string) => rulesetAttributeSlotId(R, a)
	it("as the attribute says; nothing said, anyone; the game master where the holder may", () => {
		expect(changedByAllows(ruleset, slot("name-tag"), "rules")).toBe(false)
		expect(changedByAllows(ruleset, slot("name-tag"), "holder")).toBe(true)
		expect(changedByAllows(ruleset, slot("name-tag"), "gm")).toBe(true)
		expect(changedByAllows(ruleset, slot("score"), "rules")).toBe(true)
		expect(changedByAllows(ruleset, slot("score"), "holder")).toBe(false)
		expect(changedByAllows(ruleset, slot("free"), "holder")).toBe(true)
		expect(changedByAllows(ruleset, "core:slot/hp@1", "rules")).toBe(true)
	})
})
