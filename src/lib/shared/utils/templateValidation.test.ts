import { describe, expect, it } from "vitest"
import {
	canValidateEngine,
	parseTemplate,
	validateTemplateContext
} from "./templateValidation"
import {
	CORE_LIQUID_ENGINE,
	CORE_TEMPLATE_ENGINE
} from "$lib/shared/pipelines/templateEngines"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { SHIPPED_CONTEXT_TEMPLATE_LIQUID } from "$lib/server/pipelines/prompt/liquidParity.fixtures"

/** The names the assemble step actually supplies, near enough for a unit. */
const CONTRACT = [
	"currentDate",
	"instructions",
	"characters",
	"personas",
	"characterLore",
	"scenario",
	"worldLore",
	"history",
	"relationshipsPerspectives",
	"relationshipsKnown",
	"sessionMessages",
	"injectionsByIndex",
	"postHistory",
	// Chat's author's note: placed in the message loop beside postHistory.
	"authorsNote"
]

const ENGINES = [
	["Handlebars", CORE_TEMPLATE_ENGINE],
	["Liquid", CORE_LIQUID_ENGINE]
] as const

describe("parseTemplate", () => {
	it("accepts a template that parses, in either engine", () => {
		expect(parseTemplate(CORE_TEMPLATE_ENGINE, "{{#if a}}x{{/if}}")).toBe(
			null
		)
		expect(
			parseTemplate(CORE_LIQUID_ENGINE, "{% if a %}x{% endif %}")
		).toBe(null)
	})

	it("refuses a Handlebars block closed by the wrong tag, with the line", () => {
		const err = parseTemplate(
			CORE_TEMPLATE_ENGINE,
			"a\nb\n{{#if x}}{{/each}}"
		)
		expect(err?.message).toMatch(/if doesn't match each/)
		expect(err?.line).toBe(3)
	})

	it("refuses an unclosed Handlebars block, with the line it names", () => {
		const err = parseTemplate(CORE_TEMPLATE_ENGINE, "a\nb\n{{#if x}}\n")
		// Handlebars reports where it ran out of template, which is line 4.
		expect(err?.message).toMatch(/Parse error on line 4/)
		expect(err?.line).toBe(4)
	})

	it("refuses an unclosed Liquid tag, with the line", () => {
		const err = parseTemplate(CORE_LIQUID_ENGINE, "a\nb\n{% if %}\n")
		expect(err?.message).toMatch(/invalid value expression/)
		expect(err?.line).toBe(3)
	})

	it("refuses a Liquid template that tries to read a file", () => {
		const err = parseTemplate(CORE_LIQUID_ENGINE, 'x\n{% include "y" %}')
		expect(err?.message).toMatch(/'include' is not available/)
		expect(err?.line).toBe(2)
	})

	it("refuses a Liquid filter nobody registered", () => {
		const err = parseTemplate(CORE_LIQUID_ENGINE, "{{ x | jsonvalue }}")
		expect(err?.message).toMatch(/undefined filter: jsonvalue/)
	})

	it("says nothing about an engine it does not implement", () => {
		expect(
			parseTemplate("acme.x:template/mustache@1", "{{#not handlebars")
		).toBe(null)
		expect(canValidateEngine("acme.x:template/mustache@1")).toBe(false)
	})
})

describe("validateTemplateContext", () => {
	it("reports nothing against the shipped default, in either engine", () => {
		for (const [name, engine, source] of [
			["Handlebars", CORE_TEMPLATE_ENGINE, SHIPPED_CONTEXT_TEMPLATE],
			["Liquid", CORE_LIQUID_ENGINE, SHIPPED_CONTEXT_TEMPLATE_LIQUID]
		] as const) {
			const result = validateTemplateContext(engine, source, CONTRACT)
			expect(
				{ name, warnings: result.warnings.map((w) => w.name) },
				`${name} template`
			).toEqual({ name, warnings: [] })
			expect(result.checked).toBe(true)
			expect(result.error).toBe(null)
		}
	})

	for (const [name, engine] of ENGINES)
		describe(name, () => {
			const src = (hbs: string, liquid: string) =>
				engine === CORE_TEMPLATE_ENGINE ? hbs : liquid

			it("names a top-level variable nobody supplies, with its line", () => {
				const result = validateTemplateContext(
					engine,
					src(
						"a\n{{#if scenario}}{{{speakerRelationship}}}{{/if}}",
						"a\n{% if scenario %}{{ speakerRelationship }}{% endif %}"
					),
					CONTRACT
				)
				expect(result.warnings.map((w) => w.name)).toEqual([
					"speakerRelationship"
				])
				expect(result.warnings[0]!.line).toBe(2)
				expect(result.warnings[0]!.message).toMatch(
					/renders as nothing/
				)
			})

			it("does not report a loop item's own fields", () => {
				const result = validateTemplateContext(
					engine,
					src(
						"{{#each characters}}{{name}}{{nickname}}{{/each}}",
						"{% for c in characters %}{{ c.name }}{{ c.nickname }}{% endfor %}"
					),
					CONTRACT
				)
				expect(result.warnings).toEqual([])
			})

			it("does not report the loop binding itself", () => {
				const result = validateTemplateContext(
					engine,
					src(
						"{{#each sessionMessages as |m i|}}{{m.name}}{{i}}{{/each}}",
						"{% for m in sessionMessages %}{{ m.name }}{{ forloop.index0 }}{% endfor %}"
					),
					CONTRACT
				)
				expect(result.warnings).toEqual([])
			})

			it("does not report helper or filter names", () => {
				const result = validateTemplateContext(
					engine,
					src(
						"{{#if (and (eq currentDate.year 412) scenario)}}{{pad currentDate.month 2}}{{/if}}",
						"{% if currentDate.year == 412 and scenario %}{{ currentDate.month | pad: 2 }}{% endif %}"
					),
					CONTRACT
				)
				expect(result.warnings).toEqual([])
			})

			it("reports a name reached back out of a loop", () => {
				const result = validateTemplateContext(
					engine,
					src(
						"{{#each sessionMessages as |m i|}}{{#each (lookup ../injectionsByIndx i)}}{{{this.content}}}{{/each}}{{/each}}",
						"{% for m in sessionMessages %}{% for e in injectionsByIndx[forloop.index0] %}{{ e.content }}{% endfor %}{% endfor %}"
					),
					CONTRACT
				)
				expect(result.warnings.map((w) => w.name)).toEqual([
					"injectionsByIndx"
				])
			})

			it("reports a name once per place it appears", () => {
				const result = validateTemplateContext(
					engine,
					src("{{{nope}}}\n{{{nope}}}", "{{ nope }}\n{{ nope }}"),
					CONTRACT
				)
				expect(result.warnings.map((w) => w.line)).toEqual([1, 2])
			})

			it("does not analyse a template that does not parse", () => {
				const result = validateTemplateContext(
					engine,
					src("{{#if nope}}", "{% if %}"),
					CONTRACT
				)
				expect(result.error).not.toBe(null)
				expect(result.warnings).toEqual([])
				expect(result.checked).toBe(true)
			})
		})

	it("declines to check a plugin's engine rather than reporting it clean", () => {
		const result = validateTemplateContext(
			"acme.x:template/mustache@1",
			"{{ anything }}",
			CONTRACT
		)
		expect(result).toEqual({ error: null, warnings: [], checked: false })
	})
})
