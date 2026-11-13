/**
 * ★6 (PLAN variable-layouts 2026-11-10, Render item 7): a laid-out value
 * prints the same in `{{x}}` and `{{{x}}}` — for core's Handlebars engine only.
 */
import { beforeEach, describe, expect, it } from "vitest"
import Handlebars from "handlebars"
import { allocate, render, laidOutSafeFor } from "$lib/server/pipelines/prompt/assemble"
import { laidOutForHandlebars } from "$lib/server/pipelines/entities/variableLayouts"
import { LAID_OUT_CONTEXT_KEYS } from "$lib/server/pipelines/prompt/templateContext"
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
		payload: { name: "The \"Ashguard\" <order>", content: "Riders & {{oaths}}." }
	},
	score: 0.6,
	reason: "filled_scored",
	included: true,
	why: "scored 0.600, 10 tokens"
})

const base = {
	allocation: allocate([decision()], { budgetTotal: 100 }),
	engine: CORE_TEMPLATE_ENGINE,
	messages: [] as any[]
}

describe("laid-out values are marked safe for core's Handlebars", () => {
	beforeEach(() => _resetRenderers())

	it("{{x}} prints what {{{x}}} prints, for a value with quotes, angle brackets, ampersands and braces", async () => {
		const triple = await render({ ...base, template: "{{{worldLore}}}" })
		const double = await render({ ...base, template: "{{worldLore}}" })
		expect(triple.rendered).toContain('"')
		expect(triple.rendered).toContain("<order>")
		expect(triple.rendered).toContain("&")
		expect(double.rendered).toBe(triple.rendered)
		expect(double.rendered).not.toContain("&quot;")
	})

	it("the keys Assemble receives from the template context are laid out too", async () => {
		const templateContext = { characters: '[{"name":"A<B"}]' }
		const triple = await render({ ...base, templateContext, template: "{{{characters}}}" })
		const double = await render({ ...base, templateContext, template: "{{characters}}" })
		expect(double.rendered).toBe('[{"name":"A<B"}]')
		expect(double.rendered).toBe(triple.rendered)
	})

	it("a whole template, or a prompt block, that is only one laid-out key renders as a string", async () => {
		const templateContext = { characters: '[{"name":"A<B"}]' }
		const whole = await render({ ...base, templateContext, template: "{{{characters}}}" })
		expect(typeof whole.rendered).toBe("string")
		const block = await render({
			...base,
			templateContext,
			template: "{{#systemBlock}}{{{characters}}}{{/systemBlock}}"
		})
		expect(typeof block.rendered).toBe("string")
		expect(block.rendered).toContain('[{"name":"A<B"}]')
	})

	it("a key that was not laid out still escapes", async () => {
		const templateContext = { char: 'Al"ice <3' }
		const r = await render({ ...base, templateContext, template: "{{char}}|{{{char}}}" })
		expect(r.rendered).toBe('Al&quot;ice &lt;3|Al"ice <3')
	})

	it("an empty laid-out key keeps {{#if}} false", async () => {
		const templateContext = { scenario: "" }
		const r = await render({
			...base,
			templateContext,
			template: "{{#if scenario}}HAS{{else}}NONE{{/if}}"
		})
		expect(r.rendered).toBe("NONE")
	})

	it("a plugin engine receives plain strings, exactly as before", async () => {
		let seen: unknown
		registerRenderer("chariot.probe:v1@1", "chariot.probe", (ctx) => {
			seen = (ctx.variables as any).worldLore
			return "ok"
		})
		await render({ ...base, engine: "chariot.probe:v1@1", template: "x" })
		expect(typeof seen).toBe("string")
	})

	it("Liquid, which never escapes, receives plain strings too", async () => {
		const r = await render({
			...base,
			engine: CORE_LIQUID_ENGINE,
			template: "{{ worldLore }}"
		})
		expect(r.rendered).toContain('"')
	})
})

describe("laidOutForHandlebars / laidOutSafeFor", () => {
	it("marks a non-empty string, leaves an empty string, undefined and structures alone", () => {
		expect(laidOutForHandlebars("a<b")).toBeInstanceOf(Handlebars.SafeString)
		expect(laidOutForHandlebars("")).toBe("")
		expect(laidOutForHandlebars(undefined)).toBeUndefined()
		const obj = { a: 1 }
		expect(laidOutForHandlebars(obj)).toBe(obj)
	})

	it("only touches the named keys, and only for core's Handlebars engine", () => {
		const scope = { characters: "x<y", char: "p<q", scenario: "" }
		const marked = laidOutSafeFor(CORE_TEMPLATE_ENGINE, scope, ["characters", "scenario"])
		expect(marked.characters).toBeInstanceOf(Handlebars.SafeString)
		expect(marked.scenario).toBe("")
		expect(marked.char).toBe("p<q")
		expect(scope.characters).toBe("x<y")
		expect(laidOutSafeFor(CORE_LIQUID_ENGINE, scope, ["characters"])).toBe(scope)
		expect(laidOutSafeFor("chariot.x@1", scope, ["characters"])).toBe(scope)
	})

	it("the template context's laid-out key list is the keys buildTemplateContext lays out", () => {
		expect(new Set(LAID_OUT_CONTEXT_KEYS).size).toBe(LAID_OUT_CONTEXT_KEYS.length)
		expect(LAID_OUT_CONTEXT_KEYS).toContain("characters")
		expect(LAID_OUT_CONTEXT_KEYS).not.toContain("char")
	})
})
