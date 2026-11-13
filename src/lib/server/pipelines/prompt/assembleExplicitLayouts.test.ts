/**
 * Explicit layout references (PLAN variable-layouts 2026-11-10, Render item 6):
 * `layout <key> "<reference>"` is written out ahead of the template, through
 * the row `world.ts` resolved for it, in both core engines; an unknown
 * reference renders the in-use layout and the receipt says so.
 */
import { beforeEach, describe, expect, it } from "vitest"
import { allocate, render } from "$lib/server/pipelines/prompt/assemble"
import {
	variableOfKey,
	prepareExplicitLayouts,
	rewriteLayoutCalls,
	VariableLayoutError,
	type ResolvedLayouts
} from "$lib/server/pipelines/entities/variableLayouts"
import {
	registerRenderer,
	_resetRenderers,
	CORE_TEMPLATE_ENGINE,
	CORE_LIQUID_ENGINE
} from "$lib/server/pipelines/prompt/renderers"
import type { Decision } from "$lib/server/pipelines/ranking/select"

const decision = (): Decision => ({
	candidate: {
		id: 1,
		source: "worldLore",
		tokens: 10,
		signals: {},
		payload: { name: "The Ashguard", content: 'Riders "of" <ash>.' }
	},
	score: 0.6,
	reason: "filled_scored",
	included: true,
	why: "scored 0.600, 10 tokens"
})

const WORLD_LORE = variableOfKey(undefined, "worldLore")!

const layouts = (references?: ResolvedLayouts[string] extends infer T ? any : never): ResolvedLayouts => ({
	worldLore: {
		variableId: WORLD_LORE,
		engine: CORE_TEMPLATE_ENGINE,
		source: "IN-USE:{{{json worldLore 0}}}",
		name: "Pub layout",
		origin: "own",
		reason: "pub",
		...(references ? { references } : {})
	}
})

const PROSE = {
	"core/prose@1": {
		engine: CORE_TEMPLATE_ENGINE,
		source: "PROSE:{{#each worldLore}}{{@key}}={{{this}}};{{/each}}",
		name: "Prose",
		origin: "shipped" as const
	}
}

const base = {
	allocation: allocate([decision()], { budgetTotal: 100 }),
	engine: CORE_TEMPLATE_ENGINE,
	messages: [] as any[]
}

describe("explicit layout references", () => {
	beforeEach(() => _resetRenderers())

	it("Handlebars: renders through the named layout, not the in-use one", async () => {
		const variables = layouts(PROSE)
		const bare = await render({ ...base, variables, template: "{{{worldLore}}}" })
		const named = await render({
			...base,
			variables,
			template: '{{{layout worldLore "core/prose@1"}}}'
		})
		expect(bare.rendered).toMatch(/^IN-USE:/)
		expect(named.rendered).toBe('PROSE:The Ashguard=Riders "of" <ash>.;')
	})

	it("Handlebars: {{layout …}} prints what {{{layout …}}} prints, and a subexpression works", async () => {
		const variables = layouts(PROSE)
		const triple = await render({
			...base,
			variables,
			template: "{{{layout worldLore 'core/prose@1'}}}"
		})
		const double = await render({
			...base,
			variables,
			template: '{{layout worldLore "core/prose@1"}}'
		})
		const inline = await render({
			...base,
			variables,
			template: '{{#if (layout worldLore "core/prose@1")}}YES{{/if}}'
		})
		expect(double.rendered).toBe(triple.rendered)
		expect(double.rendered).not.toContain("&quot;")
		expect(inline.rendered).toBe("YES")
	})

	it("Liquid: renders through the named layout, not the in-use one", async () => {
		const variables = layouts(PROSE)
		const bare = await render({
			...base,
			engine: CORE_LIQUID_ENGINE,
			variables,
			template: "{{ worldLore }}"
		})
		const named = await render({
			...base,
			engine: CORE_LIQUID_ENGINE,
			variables,
			template: '{{ worldLore | layout: "core/prose@1" }}'
		})
		expect(bare.rendered).toMatch(/^IN-USE:/)
		expect(named.rendered).toBe('PROSE:The Ashguard=Riders "of" <ash>.;')
	})

	it("the receipt lists the call with reason 'template' beside the ordinary use", async () => {
		const r = await render({
			...base,
			variables: layouts(PROSE),
			template: '{{{worldLore}}}\n{{{layout worldLore "core/prose@1"}}}'
		})
		expect(r.layouts).toEqual([
			expect.objectContaining({ key: "worldLore", layout: "Pub layout", reason: "pub" }),
			{
				key: "worldLore",
				variableId: WORLD_LORE,
				layout: "Prose",
				origin: "shipped",
				reason: "template"
			}
		])
	})

	it("an unknown reference at run time renders the in-use layout and records missingReference", async () => {
		const r = await render({
			...base,
			variables: layouts(),
			template: '{{{layout worldLore "core/nope@1"}}}'
		})
		expect(r.rendered).toMatch(/^IN-USE:/)
		expect(r.rendered).not.toContain("layout worldLore")
		expect(r.layouts).toEqual([
			expect.objectContaining({
				key: "worldLore",
				layout: "Pub layout",
				reason: "pub",
				missingReference: "core/nope@1"
			})
		])
	})

	it("a template with no layout call renders byte for byte as before, and carries no extra key", async () => {
		const seen: unknown[] = []
		registerRenderer("chariot.probe:v1@1", "chariot.probe", (ctx) => {
			seen.push(Object.keys(ctx.variables as object))
			return "ok"
		})
		const plain = await render({ ...base, variables: layouts(PROSE), template: "{{{worldLore}}}" })
		expect(plain.rendered).toBe('IN-USE:{"The Ashguard":"Riders \\"of\\" <ash>."}')
		expect(plain.layouts).toEqual([expect.objectContaining({ reason: "pub" })])
		await render({
			...base,
			engine: "chariot.probe:v1@1",
			variables: layouts(PROSE),
			template: "layout worldLore"
		})
		expect(seen[0]).not.toContain("\u0000layout-renders")
	})

	it("a plugin engine's template is left alone, even if it spells a layout call", async () => {
		let source = ""
		registerRenderer("chariot.probe:v1@1", "chariot.probe", (ctx) => {
			source = ctx.template
			return "ok"
		})
		await render({
			...base,
			engine: "chariot.probe:v1@1",
			variables: layouts(PROSE),
			template: '{{{layout worldLore "core/prose@1"}}}'
		})
		expect(source).toBe('{{{layout worldLore "core/prose@1"}}}')
	})

	it("a non-literal reference is never rendered raw: the helper refuses it in words", async () => {
		await expect(
			render({
				...base,
				variables: layouts(PROSE),
				template: "{{{layout worldLore someRef}}}"
			})
		).rejects.toThrow(/needs a variable's name and a quoted layout reference|was not written out/)
	})

	it("a key this step does not lay out is refused, naming the call", async () => {
		await expect(
			render({
				...base,
				variables: layouts(PROSE),
				template: '{{{layout characters "core/json@1"}}}'
			})
		).rejects.toThrow(/does not write out with a layout|names 'characters'/)
	})
})

describe("rewriteLayoutCalls", () => {
	it("rewrites each form to the key's name as a string, leaving the rest alone", () => {
		const hb = rewriteLayoutCalls(
			CORE_TEMPLATE_ENGINE,
			'A {{layout worldLore "r@1"}} B {{{ layout worldLore \'r@1\' }}} C {{#if (layout history "s@2")}}x{{/if}}'
		)
		expect(hb.template).toBe(
			'A {{layout "worldLore" "r@1"}} B {{{ layout "worldLore" \'r@1\' }}} C {{#if (layout "history" "s@2")}}x{{/if}}'
		)
		expect(hb.calls).toEqual([
			{ key: "worldLore", reference: "r@1" },
			{ key: "history", reference: "s@2" }
		])
		const lq = rewriteLayoutCalls(
			CORE_LIQUID_ENGINE,
			'{{ worldLore | layout: "r@1" }}{% assign x = history | layout: \'s@2\' %}'
		)
		expect(lq.template).toBe(
			'{{ "worldLore" | layout: "r@1" }}{% assign x = "history" | layout: \'s@2\' %}'
		)
	})

	it("a template without the word, or in another engine, is returned as it came", () => {
		expect(rewriteLayoutCalls(CORE_TEMPLATE_ENGINE, "{{{worldLore}}}").template).toBe("{{{worldLore}}}")
		const src = '{{{layout worldLore "r@1"}}}'
		expect(rewriteLayoutCalls("chariot.probe:v1@1", src).template).toBe(src)
	})

	it("a call spread over lines is still rewritten", () => {
		expect(
			rewriteLayoutCalls(CORE_TEMPLATE_ENGINE, '{{{layout\nworldLore\n"r@1"}}}').template
		).toBe('{{{layout\n"worldLore"\n"r@1"}}}')
	})

	it("throws a VariableLayoutError naming the call when a listed call cannot be rewritten", () => {
		// The parser reads a bracketed key; the rewrite does not, and never goes silent.
		expect(() =>
			rewriteLayoutCalls(CORE_TEMPLATE_ENGINE, '{{layout [worldLore] "r@1"}}')
		).toThrow(VariableLayoutError)
		expect(() =>
			rewriteLayoutCalls(CORE_TEMPLATE_ENGINE, '{{layout [worldLore] "r@1"}}')
		).toThrow(/layout worldLore "r@1"/)
	})

	it("prepareExplicitLayouts with no call does nothing", async () => {
		const r = await prepareExplicitLayouts({
			engine: CORE_TEMPLATE_ENGINE,
			template: "{{{worldLore}}}",
			layouts: undefined,
			valueOf: () => undefined,
			inUse: () => undefined
		})
		expect(r).toEqual({ template: "{{{worldLore}}}", uses: [] })
	})
})
