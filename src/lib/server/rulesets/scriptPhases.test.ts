/**
 * 🚧 Every ruleset script phase runs (PLAN-rulesets-authoring D2, ruling R4,
 * lane M2, 2026-10-22) — in QuickJS, as the derive pass always did: the
 * `effects` scripts lay bonuses and riders on for the events in play, the
 * `pre-roll` and `post-roll` scripts answer a check's asks, the `render`
 * scripts may replace a block's text. Each phase reads its typed envelope;
 * a script that fails, or returns what its phase does not take, is a
 * failure line with its phase — never fatal; nothing runs at prose.
 */

import { describe, expect, test } from "vitest"
import { defineAttributeSlot, defineRuleset, getRuleset, type RulesetDecl } from "@serene-pub/sdk"
import { earlyPhases, runApply, runApplyAsync, runResolve } from "./engine"
import { checkScriptDriver, renderBlocks, runEffectsScripts, runsPhase } from "./scripts"
import type { EngineInput, OwnerView } from "./types"

const ID = "test:ruleset/phases@1"
const GRIT = "test:slot/ph-grit@1"

function declare(): RulesetDecl {
	const existing = getRuleset(ID)
	if (existing) return existing
	defineAttributeSlot(GRIT, { type: "integer", label: { en: "Grit" }, descriptor: "Grit.", appliesTo: ["cast"], config: { min: 0, max: 10 }, default: 2 })
	return defineRuleset(ID, {
		name: { en: "Phases" },
		voice: { prose: "Phases, in words.", mechanics: "Phases decide." },
		conventions: { methods: { d6: { kind: "die-target", sides: 6 } }, time: { unit: "round" } },
		stats: [{ id: GRIT }],
		selectors: { dare: { kind: "check", base: "ph-grit" } },
		repertoires: [],
		scripts: [
			{ phase: "effects", priority: 1, seedKey: "test:script/ph-effects" },
			{ phase: "effects", priority: 2, seedKey: "test:script/ph-effects-bad" },
			{ phase: "pre-roll", priority: 1, seedKey: "test:script/ph-pre" },
			{ phase: "pre-roll", priority: 2, seedKey: "test:script/ph-pre-throws" },
			{ phase: "post-roll", priority: 1, seedKey: "test:script/ph-post" },
			{ phase: "render", priority: 1, seedKey: "test:script/ph-render" },
			{ phase: "render", priority: 2, seedKey: "test:script/ph-missing" }
		]
	})
}

/** ES5 the QuickJS host runs, `value` the envelope — as every seeded script is written. */
const SOURCES: Record<string, string> = {
	"test:script/ph-effects": `
var v = value || {};
var mods = [];
if (v.events.indexOf("use") >= 0) mods.push({ target: "dare", value: 1, label: "Steeled" });
return { modifies: mods, riders: ["Steeled: " + v.owner.name + " holds firm."], explain: "events " + v.events.join(",") + "; grit " + v.values["ph-grit"] };
`,
	"test:script/ph-effects-bad": `return { modifies: [{ target: "nowhere", value: 9 }], adjust: [{ target: "dare", by: 1 }] };`,
	"test:script/ph-pre": `
var c = value.check;
return { against: c.against + 1, explain: c.method.kind + " " + c.selector + " by " + c.by + ", terms " + c.terms.length };
`,
	"test:script/ph-pre-throws": `throw new Error("the omens are unclear");`,
	"test:script/ph-post": `
var c = value.check;
return { riders: [c.label + " came to " + c.rolled + ": " + (c.degree ? c.degree.id : "no verdict")], shift: c.degree && c.degree.id === "failure" ? 1 : 0 };
`,
	"test:script/ph-render": `
var b = value.blocks;
return { blocks: { voice: b.voice + " (rendered)", nope: "x" }, explain: "outcomes " + value.outcomes.length };
`
}
const deps = { loadSource: async (key: string) => SOURCES[key] ?? null, seed: "phases-test" }

const ann = (): OwnerView => ({
	key: "character:1",
	owner: { kind: "session_cast", id: 1 },
	name: "Ann",
	stats: [{ slotId: GRIT, selector: "ph-grit", type: "integer", value: 2, label: "Grit" }],
	repertoires: [],
	custom: [],
	bag: {}
})

const input = (over: Partial<EngineInput> = {}): EngineInput => ({
	ruleset: declare(),
	rigour: "mechanics",
	owners: [ann()],
	actions: {},
	deltas: [],
	elapsed: 0,
	ties: [],
	turn: 1,
	...over
})

/** A d6 whose next face is `face`. */
const d6 = (face: number) => () => (face - 1) / 6 + 0.001

describe("effects — laid on for the events in play, before anything is derived", () => {
	test("in QuickJS: the events, the values, the owner; a bonus and a rider; what it may not touch is a failure", async () => {
		const i = input({ deltas: [{ owner: "character:1", op: "use", check: "dare", against: 4 }] })
		const fx = await runEffectsScripts(null, i, deps)
		expect(fx["character:1"]!.modifies).toEqual([{ target: "dare", value: 1, label: "Steeled", seedKey: "test:script/ph-effects" }])
		expect(fx["character:1"]!.riders).toEqual([{ text: "Steeled: Ann holds firm.", seedKey: "test:script/ph-effects" }])
		expect(fx["character:1"]!.explain).toEqual([{ seedKey: "test:script/ph-effects", text: "events use; grit 2" }])
		// An unknown target is dropped with its reason; a step on a check it knows is taken.
		expect(fx["character:1"]!.failed).toEqual([{ seedKey: "test:script/ph-effects-bad", why: "modifies 'nowhere', which test:ruleset/phases@1 does not name — dropped" }])
		expect(fx["character:1"]!.adjust).toEqual([{ target: "dare", by: 1, seedKey: "test:script/ph-effects-bad" }])
		// Laid on: the check counts the bonus.
		const out = runApply({ ...i, effects: fx, random: d6(3) })
		expect(out.outcomes[0]!.check).toMatchObject({ total: 6, against: 4 })
		expect(out.facts.scriptsFailed).toEqual([{ owner: "character:1", phase: "effects", seedKey: "test:script/ph-effects-bad", why: expect.stringContaining("nowhere") }])
		expect(earlyPhases({ ...i, effects: fx }).get("character:1")!.riders).toContain("Steeled: Ann holds firm.")
	})
})

describe("pre-roll and post-roll — a check's asks, answered in QuickJS", () => {
	test("the target raised before the roll, a rider after; a script that throws is a failure line and the check still resolves", async () => {
		const i = input({ deltas: [{ owner: "character:1", op: "use", check: "dare", against: 4 }], random: d6(3) })
		const driver = await checkScriptDriver(null, i, deps)
		expect(driver.checkAsks).toEqual({ preRoll: true, postRoll: true })
		const out = await runApplyAsync({ ...i, checkAsks: driver.checkAsks }, driver.answer, "phases-test")
		expect(out.outcomes[0]!.check).toMatchObject({ natural: 3, total: 5, against: 5, method: "die-target" })
		expect(out.outcomes.map((o) => o.text)).toContain("Dare came to 5: success")
		expect(driver.explain).toEqual([{ phase: "pre-roll", seedKey: "test:script/ph-pre", owner: "character:1", text: "die-target dare by character:1, terms 1" }])
		expect(driver.failed).toEqual([{ phase: "pre-roll", seedKey: "test:script/ph-pre-throws", owner: "character:1", why: expect.stringContaining("the omens are unclear") }])
	})

	test("post-roll moves a failure a step up", async () => {
		const i = input({ deltas: [{ owner: "character:1", op: "use", check: "dare", against: 9 }], random: d6(1) })
		const driver = await checkScriptDriver(null, i, deps)
		const out = await runApplyAsync({ ...i, checkAsks: driver.checkAsks }, driver.answer, "phases-test")
		// 1 + 2 against 10 (9 raised by one): a failure, stepped up to a success.
		expect(out.outcomes[0]!.check).toMatchObject({ total: 3, against: 10, band: "success" })
	})
})

describe("render — what the model reads", () => {
	test("a block's text replaced at every depth; a block it names that is not there is a failure", async () => {
		const read = runResolve(input())
		const rendered = await renderBlocks(null, input(), read.blocks, read.outcomes, deps)
		expect(rendered.blocks.voice!.text).toBe("Phases decide. (rendered)")
		expect(rendered.blocks.voice!.depths).toEqual({ full: "Phases decide. (rendered)" })
		expect(rendered.explain).toEqual([{ phase: "render", seedKey: "test:script/ph-render", text: "outcomes 0" }])
		expect(rendered.failed).toEqual([
			{ phase: "render", seedKey: "test:script/ph-render", why: "replaces 'nope', which is no block this moment renders — dropped" },
			{ phase: "render", seedKey: "test:script/ph-missing", why: "no script with this seed key is installed (or it is switched off)" }
		])
	})
})

describe("nothing runs at prose", () => {
	test("Words only computes nothing: no phase runs", async () => {
		const prose = input({ rigour: "prose" })
		for (const phase of ["effects", "derived", "pre-roll", "post-roll", "render"]) expect(runsPhase(prose, phase)).toBe(false)
		expect(await runEffectsScripts(null, prose, deps)).toEqual({})
		expect((await checkScriptDriver(null, prose, deps)).checkAsks).toEqual({ preRoll: false, postRoll: false })
		const read = runResolve(prose)
		expect((await renderBlocks(null, prose, read.blocks, [], deps)).blocks).toBe(read.blocks)
	})
})
