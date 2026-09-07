/**
 * Assemble: allocation and rendering.
 *
 * The assertion that matters most is the one about excluded allocations
 * surviving into the allocated context. A user asking "why isn't my lore showing up" is asking
 * about something *absent*, so an allocation that lists only what made it
 * cannot answer them — which is the state of the world today.
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
	allocate,
	objectByRole,
	render,
	referencedVariables,
	type Allocation
} from "$lib/server/pipelines/prompt/assemble"
import { formatHistoryDateKey } from "$lib/server/pipelines/prompt/dateKeys"
import { entryDeclaration } from "$lib/server/entries/declarations"
import { HISTORY_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"
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

	it("keeps excluded allocations, because that is the question people ask", async () => {
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

	it("carries the score and the reason on the allocation itself", async () => {
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
	// The engine rides on `base` because it is required now: `render` takes a
	// concrete engine and `renderTemplate` throws on an absent one. These
	// templates are Handlebars, so they say so.
	const base = {
		allocation: allocate([decision()], { budgetTotal: 100 }),
		engine: CORE_TEMPLATE_ENGINE,
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

	it("excluded allocations do not reach the template", async () => {
		const r = await render({
			allocation: allocate([decision({ included: false })], {
				budgetTotal: 100
			}),
			engine: CORE_TEMPLATE_ENGINE,
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
		engine: CORE_TEMPLATE_ENGINE,
		messages: [] as any[]
	}

	it("refuses to render when no engine arrives, rather than assuming core's", async () => {
		// ⚠ This test used to assert the OPPOSITE — "a null engine means core's
		// default" — on the reading that the column was nullable so an
		// untouched config stayed distinguishable from a deliberate choice.
		//
		// That default is what let the delivery bug survive a release.
		// `world.ts` dereferenced a template row for its `source` and dropped
		// the `engine` beside it, so this branch was taken on EVERY run on
		// every install: every context template rendered in Handlebars whatever
		// it declared, silently, and a plugin's template would have reached the
		// model as raw markup. Both template tables store `engine` NOT NULL
		// now, so an absent one can only mean a caller lost it — a fault, and
		// raised as one.
		//
		// If this test ever goes red because somebody restored the fallback to
		// make it pass: that is the bug, not the fix.
		await expect(
			render({
				...base,
				engine: undefined as any,
				template: "{{budget.total}}"
			})
		).rejects.toThrow(/no template engine/i)
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
			await render({
				...base,
				engine: "nobody.owns:this@1",
				template: "x"
			})
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

/**
 * `objectByRole` — the type chooses the projection.
 *
 * The two bodies inside it are the two that were `objectByName` and
 * `objectByDate`; what moved is *which one runs*, from a hardcoded call site to
 * the declaration. So the assertions here are about the choosing, and about the
 * one thing the roles vocabulary does **not** buy: the order key's formatting,
 * which is still core's and is asserted against `formatHistoryDateKey` byte for
 * byte.
 */
const allocation = (over: Partial<Allocation> = {}): Allocation => ({
	source: "worldLore",
	id: 1,
	content: "content",
	tokens: 1,
	why: [],
	included: true,
	...over
})

const worldLoreRoles = entryDeclaration(WORLD_LORE_TYPE_ID)!.roles
const historyRoles = entryDeclaration(HISTORY_TYPE_ID)!.roles

describe("objectByRole", () => {
	it("keys by the title role, in arrival order, for a type that declares one", () => {
		const out = objectByRole(
			[
				allocation({ id: 1, name: "B", content: "second" }),
				allocation({ id: 2, name: "A", content: "first" })
			],
			worldLoreRoles
		)
		expect(Object.keys(out!)).toEqual(["B", "A"])
		expect(out).toEqual({ B: "second", A: "first" })
	})

	it("skips a titled block with no title and one with no content", () => {
		expect(
			objectByRole(
				[
					allocation({ id: 1, content: "orphaned" }),
					allocation({ id: 2, name: "Named", content: "" })
				],
				worldLoreRoles
			)
		).toBeUndefined()
	})

	it("returns undefined rather than {} so `{{#if worldLore}}` still skips", () => {
		// An empty object is truthy, which is the whole reason this is not `{}`.
		expect(objectByRole([], worldLoreRoles)).toBeUndefined()
	})

	it("sorts by the declared order keys and heads by the order key itself", () => {
		const dated = (
			year: number,
			month: number | null,
			day: number | null
		) =>
			allocation({
				source: "history",
				id: `${year}-${month}-${day}`,
				content: `${year}`,
				meta: { year, month, day }
			})
		const out = objectByRole(
			[dated(410, 3, null), dated(412, null, null), dated(410, 1, 5)],
			historyRoles
		)
		// Newest first, absent parts last — today's assembly sort, stated as
		// data on the type rather than as arithmetic in this module.
		expect(Object.keys(out!)).toEqual(["412", "410-03", "410-01-05"])
	})

	it("produces exactly what formatHistoryDateKey produced, over every precision", () => {
		// ⚠ The one thing roles do not buy: core formats the order key, and a
		// second ordered type wants a named policy rather than a branch. This
		// is the assertion that the generalisation did not move a byte.
		const cases = [
			{ year: 412, month: 3, day: 7 },
			{ year: 412, month: 3, day: null },
			{ year: 412, month: null, day: null },
			// The odd one, preserved deliberately: an absent middle part does
			// not terminate the key, it is skipped.
			{ year: 412, month: null, day: 5 },
			{ year: 0, month: 12, day: 31 }
		]
		for (const meta of cases) {
			const out = objectByRole(
				[allocation({ source: "history", content: "x", meta })],
				historyRoles
			)
			expect(Object.keys(out!)).toEqual([formatHistoryDateKey(meta)])
		}
	})

	it("skips blank-after-trim content for an ordered type, which the titled form does not", () => {
		// The two emptiness rules genuinely differ and are preserved rather
		// than tidied: tidying one is a change to what a prompt contains.
		expect(
			objectByRole(
				[
					allocation({
						source: "history",
						content: "   ",
						meta: { year: 1 }
					})
				],
				historyRoles
			)
		).toBeUndefined()
	})

	it("falls back to the titled form for a source no type declares", () => {
		expect(
			objectByRole([allocation({ name: "N", content: "c" })], undefined)
		).toEqual({ N: "c" })
	})
})
