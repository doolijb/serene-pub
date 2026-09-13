/**
 * The `blocks` param: which sections a prompt is built from, and in what order.
 *
 * The assertion that carries the most weight is the dullest one — that the
 * declared default IS the shipped template's own order. Everything else in this
 * design rests on it: a configuration stores deviations, so "nobody touched it"
 * has to resolve to the prompt the install already had, and the only way that
 * stays true is for the declaration and the seeded story string to be checked
 * against each other rather than kept in step by hand.
 */

import { describe, it, expect } from "vitest"
import {
	SHIPPED_PROMPT_BLOCKS,
	SHIPPED_PROMPT_BLOCK_IDS,
	isShippedPromptBlocks,
	resolvePromptBlocks
} from "@serene-pub/sdk"
import {
	applyPromptBlocks,
	scanPromptBlocks
} from "$lib/server/pipelines/prompt/promptBlocks"
import { render } from "$lib/server/pipelines/prompt/assemble"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import {
	CORE_LIQUID_ENGINE,
	CORE_TEMPLATE_ENGINE
} from "$lib/shared/pipelines/templateEngines"

/** A story string shaped like the shipped one, small enough to read in a diff. */
const TEMPLATE =
	"{{#systemBlock}}\n" +
	"{{#if instructions}}\n{{{instructions}}}\n{{/if}}\n\n" +
	"{{#if characters}}\n{{{characters}}}\n{{/if}}\n\n" +
	"{{#if scenario}}\n{{{scenario}}}\n{{/if}}\n" +
	"{{/systemBlock}}"

const CONTEXT = {
	instructions: "INSTRUCTIONS",
	characters: "CHARACTERS",
	scenario: "SCENARIO"
}

const base = {
	allocation: {
		blocks: [],
		totalTokens: 0,
		budget: { total: 100, used: 0, remaining: 100 },
		groups: {}
	},
	engine: CORE_TEMPLATE_ENGINE,
	messages: []
}

/** The order the rendered prompt actually puts the three sections in. */
const orderOf = (rendered: string): string[] =>
	["INSTRUCTIONS", "CHARACTERS", "SCENARIO"]
		.filter((k) => rendered.includes(k))
		.sort((a, z) => rendered.indexOf(a) - rendered.indexOf(z))

describe("the declared default is the shipped order", () => {
	it("names exactly the blocks the shipped context template lays out, in its order", () => {
		const scan = scanPromptBlocks(
			SHIPPED_CONTEXT_TEMPLATE,
			CORE_TEMPLATE_ENGINE
		)
		expect(scan.sections.map((s) => s.id)).toEqual([
			...SHIPPED_PROMPT_BLOCK_IDS
		])
	})

	it("does not mistake the post-history reminder's own conditionals for blocks", () => {
		// `{{#if instructions}}` appears twice in the shipped template: once as
		// a prompt block and once inside `{{#with ../postHistory}}`, where it
		// means a different variable entirely. Reordering the second would move
		// the reminder's innards.
		const scan = scanPromptBlocks(
			SHIPPED_CONTEXT_TEMPLATE,
			CORE_TEMPLATE_ENGINE
		)
		expect(
			scan.sections.filter((s) => s.id === "instructions")
		).toHaveLength(1)
	})

	it("recognises the shipped pack as the shipped pack", () => {
		expect(isShippedPromptBlocks(SHIPPED_PROMPT_BLOCKS)).toBe(true)
		expect(
			isShippedPromptBlocks([...SHIPPED_PROMPT_BLOCKS].reverse())
		).toBe(false)
	})
})

describe("applying a pack", () => {
	it("leaves the template byte-identical when the pack is the shipped one", async () => {
		const untouched = await render({
			...base,
			template: SHIPPED_CONTEXT_TEMPLATE,
			templateContext: CONTEXT
		})
		const packed = await render({
			...base,
			template: SHIPPED_CONTEXT_TEMPLATE,
			templateContext: CONTEXT,
			blocks: SHIPPED_PROMPT_BLOCKS
		})
		expect(packed.rendered).toBe(untouched.rendered)
		expect(packed.notes).toBeUndefined()
	})

	it("renders the sections in the pack's order", async () => {
		const r = await render({
			...base,
			template: TEMPLATE,
			templateContext: CONTEXT,
			blocks: [
				{ id: "scenario" },
				{ id: "instructions" },
				{ id: "characters" }
			]
		})
		expect(orderOf(r.rendered!)).toEqual([
			"SCENARIO",
			"INSTRUCTIONS",
			"CHARACTERS"
		])
	})

	it("omits a block switched off, and one the pack does not list at all", async () => {
		const r = await render({
			...base,
			template: TEMPLATE,
			templateContext: CONTEXT,
			blocks: [
				{ id: "instructions", enabled: false },
				{ id: "characters", enabled: true }
			]
		})
		expect(orderOf(r.rendered!)).toEqual(["CHARACTERS"])
		expect(r.notes).toContainEqual(
			"prompt blocks left out: instructions, scenario."
		)
	})

	it("ignores a block this template does not render, and says so", async () => {
		const r = await render({
			...base,
			template: TEMPLATE,
			templateContext: CONTEXT,
			blocks: [
				{ id: "worldLore" },
				{ id: "characters" },
				{ id: "instructions" },
				{ id: "scenario" }
			]
		})
		// Ignored, never a refusal: the prompt is still rendered.
		expect(orderOf(r.rendered!)).toEqual([
			"CHARACTERS",
			"INSTRUCTIONS",
			"SCENARIO"
		])
		expect(r.notes).toContainEqual(
			"prompt blocks this context template does not render, ignored: worldLore."
		)
	})

	it("puts the effective order on the receipt", async () => {
		const r = await render({
			...base,
			template: TEMPLATE,
			templateContext: CONTEXT,
			blocks: [{ id: "scenario" }, { id: "characters" }]
		})
		expect(r.notes).toContainEqual(
			"prompt blocks, in order: scenario, characters."
		)
	})

	it("declines rather than orphaning text that sits between two blocks", async () => {
		const withProse =
			"{{#systemBlock}}\n" +
			"{{#if instructions}}\n{{{instructions}}}\n{{/if}}\n" +
			"Here is the cast:\n" +
			"{{#if characters}}\n{{{characters}}}\n{{/if}}\n" +
			"{{/systemBlock}}"
		const r = await render({
			...base,
			template: withProse,
			templateContext: CONTEXT,
			blocks: [{ id: "characters" }, { id: "instructions" }]
		})
		expect(orderOf(r.rendered!)).toEqual(["INSTRUCTIONS", "CHARACTERS"])
		expect(r.notes?.[0]).toContain("the prompt block order was not applied")
		expect(r.rendered).toContain("Here is the cast:")
	})

	it("reorders a Liquid story string too", () => {
		const liquid =
			"{% if instructions %}{{ instructions }}{% endif %}\n" +
			"{% if characters %}{{ characters }}{% endif %}"
		const applied = applyPromptBlocks(liquid, CORE_LIQUID_ENGINE, [
			{ id: "characters" },
			{ id: "instructions" }
		])
		expect(applied.template).toBe(
			"{% if characters %}{{ characters }}{% endif %}\n" +
				"{% if instructions %}{{ instructions }}{% endif %}"
		)
	})

	it("declines for an engine whose syntax it does not know, without failing the turn", () => {
		const applied = applyPromptBlocks(
			TEMPLATE,
			"acme:template/mustache@1",
			[{ id: "characters" }]
		)
		expect(applied.template).toBe(TEMPLATE)
		expect(applied.notes[0]).toContain("acme:template/mustache@1")
	})
})

describe("resolvePromptBlocks", () => {
	it("an absent pack is the template's own order", () => {
		expect(resolvePromptBlocks(undefined, ["a", "b"])).toEqual({
			order: ["a", "b"],
			unknown: [],
			dropped: [],
			changed: false
		})
	})

	it("a duplicate id keeps its first place and is dropped thereafter", () => {
		const r = resolvePromptBlocks(
			[{ id: "a" }, { id: "b" }, { id: "a" }],
			["a", "b"]
		)
		expect(r.order).toEqual(["a", "b"])
	})
})
