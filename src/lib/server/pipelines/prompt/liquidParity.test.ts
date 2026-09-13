/**
 * Liquid renders what Handlebars renders, byte for byte.
 *
 * Core ships two template engines, and the claim that makes the second one safe
 * to offer is that a template ported from one to the other produces the *same
 * prompt* — not a similar one. Every fixture below is a hand port of a template
 * core actually ships, rendered against the same context object through the
 * same registry seam, and compared as bytes.
 *
 * ⚠ The Liquid sources here are **fixtures, not seeds.** Nothing in this file
 * changes a row: the shipped templates stay Handlebars, and these exist so a
 * change to either engine's configuration fails here rather than in somebody's
 * prompt.
 *
 * The Handlebars halves are imported, never retyped — a fixture that had its
 * own copy of the shipped template would go on passing after the real one
 * changed, which is the one way a parity test can be worse than none.
 */

import { describe, expect, it, beforeEach } from "vitest"
import {
	CORE_LIQUID_ENGINE,
	CORE_TEMPLATE_ENGINE,
	knownEngines,
	registerRenderer,
	releaseRenderer,
	renderTemplate,
	_resetRenderers
} from "./renderers"
import { SHIPPED_CONTEXT_TEMPLATE } from "$lib/server/pipelines/entities/contextTemplateDefaults"
import { DEFAULT_CONTEXT_TEMPLATE } from "$lib/server/db/legacyContextTemplate"
import { shippedRowsByKey } from "$lib/server/pipelines/entities/variableLayouts"
import { builtinCompletionTemplate } from "$lib/shared/constants/completionTemplates"
import {
	LEGACY_CONTEXT_TEMPLATE_LIQUID,
	LIQUID_LAYOUTS,
	SHIPPED_CONTEXT_TEMPLATE_LIQUID
} from "./liquidParity.fixtures"

// ── Fixtures ────────────────────────────────────────────────────────────────

const message = (
	id: number,
	role: string,
	name: string,
	text: string
): Record<string, unknown> => ({ id, role, name, message: text })

/** A context with something in every slot the shipped template reads. */
const fullContext = (): Record<string, unknown> => ({
	currentDate: "The current date in the story is 412-03-04.",
	instructions: 'Instructions:\n"""\nStay in character.\n"""',
	characters:
		'Assistant Characters (AI-controlled):\n```json\n[\n  {\n    "name": "Brannoc"\n  }\n]\n```',
	personas:
		'User Characters (player-controlled):\n```json\n[\n  {\n    "name": "Rell"\n  }\n]\n```',
	scenario: 'Scenario:\n"""\nA storm over the moor.\n"""',
	worldLore: 'World lore: \n```json\n{"Moor":"wet"}\n```',
	history: 'Story history:\n```json\n{"412-02":"the fire"}\n```',
	relationshipsPerspectives:
		'Your relationships:\n```json\n{\n "Rell": "wary"\n}\n```',
	relationshipsKnown:
		'How others regard you:\n```json\n{\n "howOthersRegardYou": {\n  "Rell": "wary"\n }\n}\n```',
	sessionMessages: [
		message(1, "user", "Rell", "Are you there?"),
		message(2, "assistant", "Brannoc", "I am."),
		// The seed/prefill placeholder: `id === -2` is what omits the closing
		// delimiter so the model continues this turn.
		message(-2, "assistant", "Brannoc", "")
	],
	injectionsByIndex: {},
	postHistory: {
		targetIndex: 2,
		hasContent: true,
		instructions: "Keep replies short.",
		charInstructions: "Brannoc never lies.",
		exampleDialogue: "Brannoc: Aye."
	}
})

/** Every optional slot empty — the shape a fresh install renders. */
const sparseContext = (): Record<string, unknown> => ({
	currentDate: "",
	instructions: "",
	characters: "",
	personas: "",
	scenario: "",
	worldLore: "",
	history: "",
	relationshipsPerspectives: "",
	relationshipsKnown: "",
	sessionMessages: [message(-2, "assistant", "Brannoc", "")],
	injectionsByIndex: {},
	postHistory: {
		targetIndex: 0,
		hasContent: false,
		instructions: "",
		charInstructions: "",
		exampleDialogue: ""
	}
})

/**
 * Every built-in framing, plus the role-array one.
 *
 * The block tags are the only place the two engines call into shared code, so
 * running the whole format table through both is what proves the call is the
 * same call rather than a lookalike.
 */
const FORMATS = [
	"vicuna",
	"chatml",
	"basic",
	"openai",
	"llama2_inst",
	"claude",
	"instruct",
	"split_session"
] as const

/** Render the same context through both engines and hand back both strings. */
async function both(
	handlebars: string,
	liquid: string,
	variables: Record<string, unknown>,
	format: string = "vicuna"
): Promise<[string, string]> {
	const completionTemplate = builtinCompletionTemplate(format)
	const ctx = { variables, promptFormat: format, completionTemplate }
	return [
		await renderTemplate(CORE_TEMPLATE_ENGINE, {
			...ctx,
			template: handlebars
		}),
		await renderTemplate(CORE_LIQUID_ENGINE, { ...ctx, template: liquid })
	]
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("the Liquid engine is core's second, not a plugin's", () => {
	beforeEach(() => _resetRenderers())

	it("is registered, owned by core", () => {
		expect(knownEngines()).toContainEqual({
			id: CORE_LIQUID_ENGINE,
			owner: "core"
		})
	})

	it("cannot be taken over by a plugin", () => {
		expect(() =>
			registerRenderer(CORE_LIQUID_ENGINE, "acme.x", () => "")
		).toThrow(/already rendered by 'core'/)
	})

	it("cannot be released", () => {
		releaseRenderer(CORE_LIQUID_ENGINE, "core")
		expect(knownEngines().map((e) => e.id)).toContain(CORE_LIQUID_ENGINE)
	})

	it("survives the test-only reset that drops plugin engines", () => {
		registerRenderer("acme.x:template/mustache@1", "acme.x", () => "")
		_resetRenderers()
		const ids = knownEngines().map((e) => e.id)
		expect(ids).toContain(CORE_LIQUID_ENGINE)
		expect(ids).toContain(CORE_TEMPLATE_ENGINE)
		expect(ids).not.toContain("acme.x:template/mustache@1")
	})
})

describe("the shipped context template renders identically in both engines", () => {
	for (const format of FORMATS)
		it(`is byte-identical under ${format}`, async () => {
			const [hbs, liquid] = await both(
				SHIPPED_CONTEXT_TEMPLATE,
				SHIPPED_CONTEXT_TEMPLATE_LIQUID,
				fullContext(),
				format
			)
			expect(liquid).toBe(hbs)
			// A pair of empty strings would satisfy the line above.
			expect(hbs).toContain("Brannoc")
		})

	it("is byte-identical with every optional slot empty", async () => {
		const [hbs, liquid] = await both(
			SHIPPED_CONTEXT_TEMPLATE,
			SHIPPED_CONTEXT_TEMPLATE_LIQUID,
			sparseContext()
		)
		expect(liquid).toBe(hbs)
	})

	it("omits the seed line's closing delimiter in both", async () => {
		const [hbs, liquid] = await both(
			SHIPPED_CONTEXT_TEMPLATE,
			SHIPPED_CONTEXT_TEMPLATE_LIQUID,
			fullContext(),
			"chatml"
		)
		expect(liquid).toBe(hbs)
		// The prompt must END at the seed line, unterminated, or the model
		// starts a new turn instead of continuing this one.
		expect(hbs.endsWith("<|im_end|>\n")).toBe(false)
		expect(hbs.trimEnd().endsWith("Brannoc:")).toBe(true)
	})

	it("places the post-history reminder at the same index in both", async () => {
		// Depth 2 from a three-message history: the reminder lands on the
		// FIRST message, not beside the seed.
		const variables = fullContext()
		;(variables.postHistory as Record<string, unknown>).targetIndex = 0
		const [hbs, liquid] = await both(
			SHIPPED_CONTEXT_TEMPLATE,
			SHIPPED_CONTEXT_TEMPLATE_LIQUID,
			variables
		)
		expect(liquid).toBe(hbs)
		expect(hbs.indexOf("Response reminder")).toBeLessThan(
			hbs.indexOf("Are you there?")
		)
	})

	it("renders nothing for the reminder when it has no content", async () => {
		const variables = fullContext()
		variables.postHistory = {
			targetIndex: 2,
			hasContent: false,
			instructions: "Keep replies short.",
			charInstructions: "",
			exampleDialogue: ""
		}
		const [hbs, liquid] = await both(
			SHIPPED_CONTEXT_TEMPLATE,
			SHIPPED_CONTEXT_TEMPLATE_LIQUID,
			variables
		)
		expect(liquid).toBe(hbs)
		expect(hbs).not.toContain("Response reminder")
	})

	it("places script injections at the same indices, in all three roles", async () => {
		const variables = fullContext()
		variables.injectionsByIndex = {
			0: [{ role: "system", content: "a system note" }],
			1: [
				{ role: "user", content: "a user note" },
				{ role: "assistant", content: "an assistant note" }
			]
		}
		const [hbs, liquid] = await both(
			SHIPPED_CONTEXT_TEMPLATE,
			SHIPPED_CONTEXT_TEMPLATE_LIQUID,
			variables
		)
		expect(liquid).toBe(hbs)
		expect(hbs).toContain("a system note")
		expect(hbs).toContain("an assistant note")
	})
})

describe("the frozen 0.5 context template renders identically in both engines", () => {
	it("is byte-identical", async () => {
		const variables = fullContext()
		// 0.5's one relationships variable, before the split.
		variables.speakerRelationships =
			'Your relationships:\n```json\n{\n "Rell": "wary"\n}\n```'
		const [hbs, liquid] = await both(
			DEFAULT_CONTEXT_TEMPLATE,
			LEGACY_CONTEXT_TEMPLATE_LIQUID,
			variables
		)
		expect(liquid).toBe(hbs)
		expect(hbs).toContain("Assistant Characters (AI-controlled):")
	})

	it("is byte-identical with every optional slot empty", async () => {
		const variables = sparseContext()
		variables.speakerRelationships = ""
		const [hbs, liquid] = await both(
			DEFAULT_CONTEXT_TEMPLATE,
			LEGACY_CONTEXT_TEMPLATE_LIQUID,
			variables
		)
		expect(liquid).toBe(hbs)
	})
})

describe("the shipped variable layouts render identically in both engines", () => {
	/** The shipped Handlebars source for `<key>/<variant>`. */
	const shipped = (id: string): string => {
		const [key, variant] = id.split("/")
		const row = shippedRowsByKey
			.get(key!)
			?.find((r) => r.variant === variant)
		if (!row) throw new Error(`no shipped layout ${id}`)
		return row.source
	}

	const cases: Array<[string, Record<string, unknown>]> = [
		["instructions/content", { instructions: "Stay in character." }],
		["instructions/wrapped", { instructions: "Stay in character." }],
		[
			"characters/content",
			{
				characters: [
					{
						name: "Brannoc",
						nickname: "Bran",
						description: "A ferryman.",
						personality: "Terse.",
						"extra lore": { Moor: "wet" }
					},
					{ name: "Rell" }
				]
			}
		],
		["characters/content", { characters: [] }],
		["characters/content", {}],
		[
			"personas/content",
			{ personas: [{ name: "Rell", description: "A traveller." }] }
		],
		[
			"worldLore/content",
			{ worldLore: { Moor: "wet", Ferry: { owner: "Brannoc" } } }
		],
		["worldLore/content", { worldLore: {} }],
		["worldLore/content", {}],
		[
			"worldLore/wrapped",
			{ worldLore: { Moor: "wet", Ferry: { owner: "Brannoc" } } }
		],
		[
			"relationshipsPerspectives/content",
			{ relationshipsPerspectives: { Rell: { regard: "wary" } } }
		],
		[
			"relationshipsKnown/content",
			{
				relationshipsKnown: {
					howOthersRegardYou: { Rell: "wary" },
					legendaryFigures: { Saint: "a rumour" }
				}
			}
		],
		[
			"relationshipsKnown/content",
			{ relationshipsKnown: { howOthersRegardYou: { Rell: "wary" } } }
		],
		[
			"relationshipsKnown/content",
			{ relationshipsKnown: { legendaryFigures: { Saint: "a rumour" } } }
		],
		["relationshipsKnown/content", { relationshipsKnown: {} }],
		["relationshipsKnown/content", {}],
		[
			"currentDate/content",
			{ currentDate: { year: 412, month: 3, day: 4 } }
		],
		// Month zero: present, and falsy. `isSet` exists for exactly this.
		["currentDate/content", { currentDate: { year: 412, month: 0 } }],
		["currentDate/content", { currentDate: { year: 412 } }],
		["currentDate/wrapped", { currentDate: { year: 412, month: 12 } }]
	]

	for (const [id, variables] of cases)
		it(`${id} ${JSON.stringify(variables).slice(0, 48)}`, async () => {
			const [hbs, liquid] = await both(
				shipped(id),
				LIQUID_LAYOUTS[id]!,
				variables
			)
			expect(liquid).toBe(hbs)
		})
})

describe("whitespace control", () => {
	it("trims the same way Handlebars' standalone stripping does", async () => {
		const variables = { a: "A", b: "", items: [{ n: "1" }, { n: "2" }] }
		const [hbs, liquid] = await both(
			"HEAD\n{{#if a}}\n{{{a}}}\n{{/if}}\n\n{{#if b}}\n{{{b}}}\n{{/if}}\n\n{{#each items}}\nline {{{this.n}}}\n{{/each}}\nTAIL",
			"HEAD\n{%- if a -%}\n{{ a }}\n{%- endif -%}\n\n{%- if b -%}\n{{ b }}\n{%- endif -%}\n\n{%- for item in items -%}\nline {{ item.n }}\n{%- endfor -%}\nTAIL",
			variables
		)
		expect(liquid).toBe(hbs)
		expect(hbs).toBe("HEAD\nA\n\n\nline 1\nline 2\nTAIL")
	})

	it("eats a literal space the same way `{{~#each}}` does", async () => {
		const variables = { xs: { a: 1, b: 2 } }
		const [hbs, liquid] = await both(
			"{ {{~#each xs}}{{@key}}{{#unless @last}},{{/unless}}{{/each~}} }",
			"{ {%- for pair in xs %}{{ pair[0] }}{% unless forloop.last %},{% endunless %}{% endfor -%} }",
			variables
		)
		expect(liquid).toBe(hbs)
		expect(hbs).toBe("{a,b}")
	})

	it("gates the last iteration the same way `@last` does", async () => {
		const [hbs, liquid] = await both(
			"{{#each xs}}{{this}}{{#if @last}}!{{/if}}{{/each}}",
			"{% for x in xs %}{{ x }}{% if forloop.last %}!{% endif %}{% endfor %}",
			{ xs: ["a", "b", "c"] }
		)
		expect(liquid).toBe(hbs)
		expect(hbs).toBe("abc!")
	})
})

describe("what the Liquid engine refuses", () => {
	for (const tag of ["include", "render", "layout"])
		it(`refuses {% ${tag} %} rather than reading a file`, async () => {
			await expect(
				renderTemplate(CORE_LIQUID_ENGINE, {
					template: `a\nb\n{% ${tag} "secrets" %}`,
					variables: {}
				})
			).rejects.toThrow(
				new RegExp(`'${tag}' is not available[\\s\\S]*line:3`)
			)
		})

	it("refuses an unknown filter instead of rendering the value unfiltered", async () => {
		await expect(
			renderTemplate(CORE_LIQUID_ENGINE, {
				template: "{{ x | jsonvalue }}",
				variables: { x: 1 }
			})
		).rejects.toThrow(/undefined filter: jsonvalue/)
	})

	it("renders an absent variable as empty, exactly as Handlebars does", async () => {
		const [hbs, liquid] = await both(
			"[{{{nothere}}}]",
			"[{{ nothere }}]",
			{}
		)
		expect(liquid).toBe(hbs)
		expect(hbs).toBe("[]")
	})

	it("does not escape its output", async () => {
		const [hbs, liquid] = await both("{{{q}}}", "{{ q }}", {
			q: '"quoted" <b> & """'
		})
		expect(liquid).toBe(hbs)
		expect(hbs).toBe('"quoted" <b> & """')
	})
})
