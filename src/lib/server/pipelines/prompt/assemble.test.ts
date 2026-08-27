/**
 * Assemble: allocation and rendering.
 *
 * The assertion that matters most is the one about excluded blocks surviving
 * into the allocation. A user asking "why isn't my lore showing up" is asking
 * about something *absent*, so an allocation that lists only what made it
 * cannot answer them — which is the state of the world today.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
	allocate,
	render,
	referencedVariables
} from "$lib/server/pipelines/prompt/assemble"
import { wrapFor } from "$lib/server/pipelines/entities/variableLayouts"
import type { Decision } from "$lib/server/pipelines/ranking/select"
import {
	registerRenderer,
	_resetRenderers,
	TemplateEngineError,
	CORE_TEMPLATE_ENGINE
} from "$lib/server/pipelines/prompt/renderers"

const decision = (over: Partial<Decision> = {}): Decision => ({
	candidate: {
		id: 1,
		source: "worldLore",
		tokens: 10,
		signals: {},
		payload: {
			name: "The Ashguard",
			content: "An order of oathbound riders."
		}
	},
	score: 0.6,
	reason: "filled_scored",
	included: true,
	why: "scored 0.600, 10 tokens",
	...over
})

describe("allocation", () => {
	it("sums only what was included", async () => {
		const a = allocate(
			[
				decision(),
				decision({ included: false, reason: "excluded_token_limit" })
			],
			{ budgetTotal: 100 }
		)
		expect(a.totalTokens).toBe(10)
		expect(a.budget.remaining).toBe(90)
	})

	it("keeps excluded blocks, because that is the question people ask", async () => {
		const a = allocate(
			[
				decision({
					included: false,
					reason: "excluded_budget",
					why: "cap reached"
				})
			],
			{ budgetTotal: 100 }
		)
		expect(a.blocks).toHaveLength(1)
		expect(a.blocks[0]!.included).toBe(false)
		expect(a.blocks[0]!.why.join(" ")).toMatch(/cap reached/)
	})

	it("carries the score and the reason on the block itself", async () => {
		// Not derived at render time: the numbers exist upstream and nowhere else
		// once the selection loop has moved on.
		const a = allocate([decision()], { budgetTotal: 100 })
		expect(a.blocks[0]!.why.join(" ")).toMatch(/score 0\.600/)
		expect(a.blocks[0]!.why).toContain("filled_scored")
	})

	it("never reports negative headroom", async () => {
		const a = allocate(
			[decision({ candidate: { ...decision().candidate, tokens: 500 } })],
			{
				budgetTotal: 100
			}
		)
		expect(a.budget.remaining).toBe(0)
	})
})

describe("rendering", () => {
	const base = {
		allocation: allocate([decision()], { budgetTotal: 100 }),
		messages: [{ id: 1, role: "user", content: "hello" }]
	}

	it("gives world lore to the template as name-keyed JSON", async () => {
		// Not an array. The default story strings render `{{{worldLore}}}` and
		// expect `{"<name>": "<content>"}` — this test used to assert an array
		// iterated with `{{#each}}`, which is what the code did and what the
		// templates do not. The parity corpus caught it: a variable with the
		// right name and the wrong shape still renders, and the prompt is
		// quietly missing its lore.
		const r = await render({ ...base, template: "{{{worldLore}}}" })
		// Through its shipped layout, which since 0.6 carries the heading and
		// fence the context template used to write. The shape under them is
		// what this test is about and is unchanged: a name-keyed object.
		const lore = { "The Ashguard": "An order of oathbound riders." }
		expect(r.rendered).toBe(wrapFor("worldLore")!(JSON.stringify(lore)))
	})

	it("omits world lore entirely when nothing was included", async () => {
		// `undefined`, not `"{}"` — a template writing `{{#if worldLore}}` has
		// to see the same falsiness the legacy engines produced, and an empty
		// object is truthy.
		const r = await render({
			...base,
			allocation: allocate([], { budgetTotal: 100 }),
			template: "{{#if worldLore}}HAS{{else}}NONE{{/if}}"
		})
		expect(r.rendered).toBe("NONE")
	})

	it("exposes blocks under the names existing templates already use", async () => {
		// Renaming a variable would silently break every custom story string, and
		// the user's template is the migration's input.
		const r = await render({
			...base,
			template: "{{#each sessionMessages}}{{this.content}}{{/each}}"
		})
		expect(r.rendered).toBe("hello")
	})

	it("excluded blocks do not reach the template", async () => {
		const r = await render({
			allocation: allocate([decision({ included: false })], {
				budgetTotal: 100
			}),
			messages: [],
			template: "[{{#each worldLore}}{{this}}{{/each}}]"
		})
		expect(r.rendered).toBe("[]")
	})

	it("hands the budget to the template, so a story string can react to it", async () => {
		const r = await render({ ...base, template: "{{budget.remaining}}" })
		expect(r.rendered).toBe("90")
	})

	it("a split-session format yields role-tagged messages rather than one string", async () => {
		// Decided here rather than by the caller, so the preview and the send
		// cannot disagree about which shape they are comparing.
		const r = await render({
			...base,
			promptFormat: "split_session",
			template: "<|im_start|>system\nhi<|im_end|>"
		})
		expect(r.rendered).toBeUndefined()
		expect(Array.isArray(r.messages)).toBe(true)
	})

	it("reports what the template referenced", async () => {
		const r = await render({
			...base,
			template:
				"{{system}} {{#each worldLore}}{{this}}{{/each}} {{budget.total}}"
		})
		expect(r.usedVariables).toContain("system")
		expect(r.usedVariables).toContain("worldLore")
		expect(r.usedVariables).toContain("budget.total")
	})

	it("prompts land as template variables", async () => {
		const r = await render({
			...base,
			prompts: { systemPrompt: "You are a narrator." },
			template: "{{systemPrompt}}"
		})
		expect(r.rendered).toBe("You are a narrator.")
	})
})

describe("variable extraction", () => {
	it("finds dotted paths and each-blocks, and ignores this", async () => {
		expect(
			referencedVariables("{{a.b}} {{#each xs}}{{this}}{{/each}}")
		).toEqual(["a.b", "xs"])
	})

	it("an empty template references nothing", async () => {
		expect(referencedVariables("")).toEqual([])
	})
})

describe("the engine is data, not an assumption", () => {
	beforeEach(() => _resetRenderers())

	const base = {
		allocation: allocate([decision()], { budgetTotal: 100 }),
		messages: [] as any[]
	}

	it("a null engine means core's default", async () => {
		// The column is nullable for exactly this reason: an untouched config is
		// distinguishable from one a user deliberately set to core's engine.
		const r = await render({
			...base,
			engine: null,
			template: "{{budget.total}}"
		})
		expect(r.rendered).toBe("100")
	})

	it("an extension can register its own engine and render its own templates", async () => {
		registerRenderer("chariot.mustache:v1@1", "chariot.mustache", (ctx) =>
			ctx.template.replace(
				"<<total>>",
				String((ctx.variables as any).budget.total)
			)
		)
		const r = await render({
			...base,
			engine: "chariot.mustache:v1@1",
			template: "budget is <<total>>"
		})
		expect(r.rendered).toBe("budget is 100")
	})

	it("an unknown engine refuses rather than rendering as Handlebars", async () => {
		// A fallback would mostly "work" — emitting the foreign syntax intact —
		// and send a model a prompt full of markup nobody meant to include.
		await expect(
			render({ ...base, engine: "nobody.owns:this@1", template: "x" })
		).rejects.toThrow(/no renderer for template engine/)
	})

	it("the refusal names what is registered, so the fix is visible", async () => {
		try {
			await render({ ...base, engine: "nobody.owns:this@1", template: "x" })
		} catch (e) {
			expect((e as Error).message).toMatch(
				/core:template\/handlebars@1 \(core\)/
			)
		}
	})

	it("nobody can take over an engine somebody else owns", async () => {
		// Including core's. A plugin that could redefine how everyone's templates
		// render would change every prompt on the instance without appearing in
		// any spec.
		expect(() =>
			registerRenderer(CORE_TEMPLATE_ENGINE, "chariot.sneaky", () => "")
		).toThrow(TemplateEngineError)

		registerRenderer("chariot.a:engine@1", "chariot.a", () => "")
		expect(() =>
			registerRenderer("chariot.a:engine@1", "chariot.b", () => "")
		).toThrow(/already rendered by 'chariot.a'/)
	})
})
