/**
 * 🚧 Function uses (D1, D3): references resolved, roles bound (by the
 * ruleset, by tag), bodies found — never core's reserved ids', never one
 * whose pinned hash moved — seeded scripts read back for `scripts.ts`, and
 * the voice a ruleset that declares none reads with.
 */
import { describe, expect, it } from "vitest"
import { CORE_FUNCTION_IDS, defineRuleset, functionHash, NUMBER_ATTRIBUTE_KINDS, rulesetAttributeSlotId, type FunctionDecl } from "@serene-pub/sdk"
import { bindingKindRefusal, derivedVoice, functionUsesOf, legacyScriptsOf, modulesAt, newLedger, runEffectsFunctions, runsModules } from "./functionRun"
import { withRulesSandbox } from "./sandbox"
import type { EngineInput, OwnerView } from "./types"

const mod = (id: string, extra: Partial<FunctionDecl> = {}): FunctionDecl =>
	({ id, name: { en: id }, meaning: { en: "m" }, kind: "changing", prose: "p", ...extra }) as FunctionDecl

const restore = mod("test:function/fr-restore@1", {
	bindings: { what: { to: "attribute", tags: ["resource"] }, extra: { to: "attribute" } },
	prose: "{{what}} comes back each morning; {{extra}} too.",
	phases: ["effects"],
	body: "export function effects() { return {} }"
})
const ruleset = defineRuleset("test:ruleset/fr-unit@1", {
	name: { en: "Uses" },
	attributes: [
		{ id: "stamina", name: { en: "Stamina" }, kind: "pool", bounds: { max: 5 }, tags: ["resource"], prose: "How much they have left in them." },
		{ id: "coins", name: { en: "Coins" }, kind: "tally", tags: ["resource"], prose: "What they have saved." },
		{ id: "mood", name: { en: "Mood" }, kind: "label", prose: "How they feel." }
	],
	functions: [
		{ ref: restore.id, module: restore, bindings: { extra: "mood" } },
		{ ref: CORE_FUNCTION_IDS.dieTarget, key: "d6", options: { sides: 6 } },
		{
			ref: "test:function/fr-pinned@1",
			module: mod("test:function/fr-pinned@1", { phases: ["derived"], body: "export function derived() { return {} }" })
		}
	]
})

describe("a ruleset's function uses", () => {
	it("roles bound by the ruleset and by tag; reserved ids read, never run", () => {
		const [r, d6, pinned] = functionUsesOf(ruleset)
		expect(r!.bindings).toEqual({ what: { to: "attribute", ids: ["stamina", "coins"] }, extra: { to: "attribute", ids: ["mood"] } })
		expect(r!.body).toEqual({ form: "module", source: restore.body })
		expect(d6).toMatchObject({ key: "d6", kind: "deciding", options: { sides: 6 }, phases: [] })
		expect(d6!.body).toBeUndefined()
		expect(pinned!.phases).toEqual(["derived"])
		expect(modulesAt(ruleset, "effects").map((u) => u.key)).toEqual(["fr-restore"])
		expect(runsModules(ruleset)).toBe(true)
	})

	it("a carried module of a reserved id never runs its body; a pinned hash that moved never runs either", () => {
		const forged = mod(CORE_FUNCTION_IDS.dieTarget, { kind: "deciding", phases: ["after"], body: "export function after() { return { shift: 9 } }" })
		const pin = mod("test:function/fr-pin@1", { phases: ["effects"], body: "export function effects() { return {} }" })
		// A declaration as a document holds it (no registry door refuses it here).
		const r = {
			id: "test:ruleset/fr-guard@1",
			name: { en: "Guard" },
			functions: [
				{ ref: forged.id, module: forged },
				{ ref: pin.id, module: pin, hash: functionHash({ ...pin, body: "export function effects() { return { lines: ['old'] } }" }) }
			]
		}
		const [a, b] = functionUsesOf(r)
		expect(a!.body).toBeUndefined()
		expect(b!.findings.some((f) => f.includes("function-hash-moved"))).toBe(true)
		expect(b!.body).toBeUndefined()
		expect(modulesAt(r, "effects")).toEqual([])
	})

	it("⏳ a ruleset's seeded scripts, read back for scripts.ts in its phases' old names", () => {
		const legacy = defineRuleset("test:ruleset/fr-legacy@1", {
			name: { en: "Legacy" },
			functions: [
				{ ref: "test:function/fr-legacy-roll@1", module: mod("test:function/fr-legacy-roll@1", { kind: "changing", phases: ["before", "after"], seedKey: "test:script/fr-roll" }) }
			]
		})
		expect(legacyScriptsOf(legacy)).toEqual([
			{ phase: "pre-roll", priority: 0, seedKey: "test:script/fr-roll" },
			{ phase: "post-roll", priority: 0, seedKey: "test:script/fr-roll" }
		])
	})
})

describe("the voice a ruleset declares none of (R6, R9)", () => {
	it("each attribute's sentence, then each function's prose with its roles filled", () => {
		expect(derivedVoice(ruleset).split("\n")).toEqual([
			"Stamina: How much they have left in them.",
			"Coins: What they have saved.",
			"Mood: How they feel.",
			"Stamina, Coins comes back each morning; Mood too.",
			"p"
		])
	})
	it("a ruleset from scratch says nothing at all", () => {
		expect(derivedVoice(defineRuleset("test:ruleset/fr-scratch@1", { name: { en: "Scratch" } }))).toBe("")
	})
})

describe("🚧 a role is never handed what it does not take (RF fix 6, 2026-10-23)", () => {
	const sum = mod("test:function/fr-sum@1", {
		name: { en: "Sum" },
		bindings: {
			what: { to: "attribute", kinds: NUMBER_ATTRIBUTE_KINDS, tags: ["counted"], many: true, entryFields: true, label: { en: "The number" } }
		},
		prose: "{{what}} is added up.",
		phases: ["effects"],
		body: "export function effects(ctx) { return { lines: [JSON.stringify(ctx.bindings.what.values) + ' ' + Object.keys(ctx.bindings.what.fields || {}).join(',')] } }"
	})
	const typed = defineRuleset("test:ruleset/fr-typed@1", {
		name: { en: "Typed" },
		attributes: [
			{ id: "nerve", name: { en: "Nerve" }, kind: "pool", bounds: { max: 5 }, tags: ["counted"], prose: "Courage held back." },
			// Tagged as counted, but free text: the tag reaches it; the kind keeps it from a sum.
			{ id: "mood", name: { en: "Mood" }, kind: "text", tags: ["counted"], prose: "How they are, in their own words." }
		],
		entryTypes: [
			{
				id: "bond",
				name: { en: "Bond" },
				prose: "Two people and how they stand.",
				fields: { affection: { type: "integer", label: { en: "Affection" } }, note: { type: "string", label: { en: "Note" } } }
			}
		],
		functions: [{ ref: sum.id, module: sum }]
	})
	const [use] = functionUsesOf(typed)

	it("an attribute of a kind it does not take, a field of a type it does not take, a word where it takes numbers", () => {
		expect(bindingKindRefusal(typed, use!, "what", "nerve", 3)).toBeNull()
		expect(bindingKindRefusal(typed, use!, "what", "bond.affection")).toBeNull()
		expect(bindingKindRefusal(typed, use!, "what", "mood", "calm")).toBe(
			"'mood' is free text, and The number takes a number, a pool or a tally: it was not handed to fr-sum"
		)
		expect(bindingKindRefusal(typed, use!, "what", "bond.note")).toMatch(/^'bond\.note' is a string field, and The number takes a number, a pool or a tally or an entry's number or integer field/)
		// A number kind holding a word (a stored value gone wrong) is withheld too.
		expect(bindingKindRefusal(typed, use!, "what", "nerve", "three")).toMatch(/^'nerve' holds "three", which is no number/)
		expect(bindingKindRefusal(typed, use!, "what", "nerve", null)).toBeNull()
	})

	it("the body is handed null for it, and the run says why under the function's key", async () => {
		const owner: OwnerView = {
			key: "character:1",
			owner: { kind: "character", id: 1 } as never,
			name: "Wren",
			stats: [
				{ slotId: rulesetAttributeSlotId(typed.id, "nerve"), selector: "nerve", type: "integer", value: 2, label: "Nerve" },
				{ slotId: rulesetAttributeSlotId(typed.id, "mood"), selector: "mood", type: "text", value: "calm", label: "Mood" }
			] as never,
			repertoires: [],
			custom: [],
			bag: {}
		}
		const input = { ruleset: typed, rigour: "mechanics", owners: [owner], actions: {}, deltas: [], elapsed: 0, ties: [], turn: 1 } as unknown as EngineInput
		const ledger = newLedger()
		await withRulesSandbox({}, (sandbox) =>
			runEffectsFunctions(input, { sandbox, seed: "fr-typed" }, ledger, (o) => Object.fromEntries(o.stats.map((x) => [x.selector, x.value])) as never)
		)
		expect(ledger.lines.map((l) => l.text)).toEqual(['{"nerve":2,"mood":null}'])
		expect(ledger.failed).toEqual([
			{ phase: "effects", seedKey: "fr-sum", owner: "character:1", why: "'mood' is free text, and The number takes a number, a pool or a tally: it was not handed to fr-sum" }
		])
	}, 60_000)
})
