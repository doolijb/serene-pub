/**
 * Three lists used to have to agree whenever a template variable was added, and
 * nothing connected them: `TemplateContext` (the type), `KNOWN_TOP_LEVEL_FIELDS`
 * (this linter's vocabulary) and `mockTemplateContext` (the editor's preview).
 *
 * They did not stay in agreement. `speakerRelationships` was added to the type
 * and not the linter, so the editor reported "isn't a recognized field at this
 * scope" **against the shipped default template**. The preview drifted more
 * quietly still: it rendered `worldLore` as an array of objects at indent 2
 * where the real path emits a keyed object, minified — a shape no prompt has
 * ever contained.
 *
 * Both now read the **variable registry**, so the question this file asks has
 * changed. It is no longer "do the lists agree" but "is the connection still
 * there" — a regression would be someone reintroducing a hand-written list, and
 * the test for that is that a name nobody declares is not recognised.
 */
import { describe, expect, test } from "vitest"
import {
	parseContextTemplate,
	lintContextTemplate,
	lintVariableTemplate
} from "./contextConfigCards"

const unrecognized = (template: string) =>
	lintContextTemplate(parseContextTemplate(template).cards).filter((i) =>
		/isn't a recognized field/.test(i.message)
	)

describe("template field vocabulary", () => {
	test("speakerRelationships lints clean", () => {
		expect(
			unrecognized(
				"{{#if speakerRelationships}}\n```json\n{{{speakerRelationships}}}\n```\n{{/if}}"
			)
		).toEqual([])
	})

	test("narrativeGraph stays recognized after being dropped from the default template", () => {
		// It is no longer in the shipped template, but the variable itself is
		// still supported — anyone with a cloned template using it must not
		// start seeing lint errors just because the default stopped using it.
		expect(unrecognized("{{{narrativeGraph}}}")).toEqual([])
	})

	test("the linter still rejects a genuinely unknown field", () => {
		// Guards against "fixing" a vocabulary gap by disabling the check.
		expect(unrecognized("{{{noSuchFieldAtAll}}}").length).toBeGreaterThan(0)
	})

	test("every declared variable is recognized, without being listed here", async () => {
		// The connection itself. Adding a variable to the registry must make the
		// linter accept it with no edit to `contextConfigCards.ts` — that is the
		// whole point of reading the declarations, and the property a
		// well-meaning "let me just add it to the list" refactor would remove.
		const { allVariables } = await import("@serene-pub/sdk")
		for (const decl of allVariables())
			for (const key of Object.keys(decl.scope))
				expect(
					unrecognized(`{{{${key}}}}`),
					`${key} is declared but not recognized`
				).toEqual([])
	})

	test("the preview supplies every name the linter recognizes as a variable", async () => {
		// The third list, now also derived. A name the linter accepts and the
		// preview does not supply renders as an empty block while you edit it —
		// quieter than a lint error and harder to attribute.
		//
		// `toBeDefined` is not enough to catch that, and used to be all this
		// asserted. A layout renders its own heading and fences before it
		// interpolates anything, so a variable whose sample went missing still
		// comes back as a defined, non-empty-looking string — the assertion
		// passed with `sampleValues` returning `{}` for every declaration,
		// which is the exact failure the comment above describes. Check the
		// value that goes *into* the render as well as what comes out.
		const { sampleContext } = await import("$lib/server/pipelines/prompt/preview")
		const { allVariables, sampleValues } = await import("@serene-pub/sdk")
		const sample = sampleContext() as Record<string, unknown>

		for (const decl of allVariables()) {
			const values = sampleValues(decl)
			for (const key of Object.keys(decl.scope)) {
				expect(
					values[key],
					`${key} is declared but its declaration samples no value for it`
				).toBeDefined()
				expect(
					sample[key],
					`${key} missing from preview data`
				).toBeDefined()
			}
		}
	})
})

describe("linting one layout against its own scope", () => {
	test("accepts what the variable declares", () => {
		expect(
			lintVariableTemplate("{{{json characters 2}}}", {
				characters: "any"
			})
		).toEqual([])
	})

	test("catches the singular/plural slip that renders nothing", () => {
		// The failure this lint exists for: `character` is not in scope, so the
		// loop runs zero times, the layout produces an empty string, and the
		// reply arrives with no cast in it. No error anywhere at run time.
		const issues = lintVariableTemplate(
			"{{#each character}}{{this.name}}{{/each}}",
			{ characters: "any" }
		)
		expect(issues.length).toBeGreaterThan(0)
		expect(issues[0].message).toMatch(/character/)
	})

	test("does not lend a layout the context template's vocabulary", () => {
		// A layout for `characters` has exactly one name in scope. Accepting
		// `scenario` here would accept a layout that renders nothing.
		expect(
			lintVariableTemplate("{{{scenario}}}", { characters: "any" }).length
		).toBeGreaterThan(0)
	})

	test("reports a syntax error rather than throwing", () => {
		const issues = lintVariableTemplate("{{#each characters}}", {
			characters: "any"
		})
		expect(issues.length).toBeGreaterThan(0)
	})
})

/**
 * Path lint — what the schema bought.
 *
 * The old lint compared a whole dotted expression against a set of *root*
 * names, and gave up entirely at the first `{{#each}}`. That combination had
 * both failure modes at once: it flagged correct nested paths at the root, and
 * it checked nothing at all inside a loop, which is the only place a template
 * writes a nested path in the first place.
 */
describe("path lint", () => {
	const CHARACTERS = {
		characters: {
			type: "list" as const,
			of: {
				type: "object" as const,
				fields: {
					name: { type: "string" as const },
					nickname: { type: "string" as const, optional: true },
					"extra lore": {
						type: "record" as const,
						of: { type: "string" as const }
					}
				}
			}
		}
	}
	const messages = (src: string, scope = CHARACTERS) =>
		lintVariableTemplate(src, scope).map((i) => i.message)

	test("a correct path inside an each is not flagged", () => {
		expect(
			messages("{{#each characters}}{{this.name}}{{/each}}")
		).toEqual([])
	})

	// The case the whole slice exists for. Before this it rendered empty and
	// said nothing.
	test("a misspelled path inside an each is caught", () => {
		const m = messages("{{#each characters}}{{this.nickanme}}{{/each}}")
		expect(m.length).toBe(1)
		expect(m[0]).toMatch(/'this\.nickanme' does not exist/)
	})

	test("a bare name inside an each resolves against the element", () => {
		expect(messages("{{#each characters}}{{name}}{{/each}}")).toEqual([])
		expect(
			messages("{{#each characters}}{{nmae}}{{/each}}").length
		).toBe(1)
	})

	test("block params are bound to the element type", () => {
		expect(
			messages("{{#each characters as |c|}}{{c.name}}{{/each}}")
		).toEqual([])
		const m = messages("{{#each characters as |c|}}{{c.nmae}}{{/each}}")
		expect(m.length).toBe(1)
		expect(m[0]).toMatch(/'c\.nmae' does not exist/)
	})

	test("the index param is bound but carries no shape to check", () => {
		expect(
			messages("{{#each characters as |c i|}}{{i}}{{c.name}}{{/each}}")
		).toEqual([])
	})

	test("a nested each resolves through its parent context", () => {
		expect(
			messages(
				"{{#each characters}}{{#each this.[extra lore]}}{{this}}{{/each}}{{/each}}"
			)
		).toEqual([])
	})

	test("with narrows the context too", () => {
		expect(
			messages("{{#with characters}}{{length}}{{/with}}")
		).toEqual([])
	})

	test("../ walks back out to the enclosing context", () => {
		expect(
			messages("{{#each characters}}{{../characters.length}}{{/each}}")
		).toEqual([])
	})

	// An each's else branch runs when the collection was empty, so it is back
	// in the outer context rather than the element one.
	test("an each's else branch is linted in the outer context", () => {
		expect(
			messages("{{#each characters}}{{name}}{{else}}{{characters.length}}{{/each}}")
		).toEqual([])
	})

	test("reading a field straight off a list says to loop instead", () => {
		const m = messages("{{characters.name}}")
		expect(m.length).toBe(1)
		expect(m[0]).toMatch(/is a list, so it is reached by position/)
	})

	// Every shipped layout is of this form, and skipping any expression with a
	// space in it meant none of them were checked.
	test("a helper's path argument is checked", () => {
		expect(messages("{{{json characters 2}}}")).toEqual([])
		const m = messages("{{{json characterz 2}}}")
		expect(m.length).toBe(1)
		expect(m[0]).toMatch(/"characterz" isn't a recognized field/)
	})

	// A finding that only says "wrong" makes the author go hunting. The schema
	// knows what exists there, so it can say what was probably meant.
	test("a near-miss carries the name it was probably meant to be", () => {
		expect(
			messages("{{#each characters}}{{this.nickanme}}{{/each}}")[0]
		).toMatch(/Did you mean "nickname"\?/)
		expect(messages("{{characterz}}")[0]).toMatch(/Did you mean "characters"\?/)
	})

	test("nothing near enough adds no guess", () => {
		expect(messages("{{completelyUnrelated}}")[0]).not.toMatch(/Did you mean/)
	})

	test("a subexpression is left alone rather than guessed at", () => {
		expect(
			messages("{{#if (and characters somethingElse)}}x{{/if}}")
		).toEqual([])
	})

	test("what the declaration cannot describe stays unchecked", () => {
		expect(
			messages("{{#each anything}}{{this.whatever.deep}}{{/each}}", {
				anything: "any"
			} as never)
		).toEqual([])
	})
})

describe("the shipped templates lint clean", () => {
	// The end-to-end guard against false positives. A lint that flags the
	// defaults is one every user sees an error from on a fresh install, and
	// the previous version of this lint did exactly that to any root-level
	// dotted path.
	test("every shipped variable layout lints clean against its own scope", async () => {
		const { SHIPPED_VARIABLE_TEMPLATES } = await import(
			"$lib/server/pipelines/entities/variableLayouts"
		)
		const { getVariable } = await import("@serene-pub/sdk")
		for (const t of SHIPPED_VARIABLE_TEMPLATES) {
			const decl = getVariable(t.variableId)
			expect(decl, `${t.variableId} is not declared`).toBeDefined()
			expect(
				lintVariableTemplate(t.source, decl!.scope).map((i) => i.message),
				`${t.variableId} (${t.name})`
			).toEqual([])
		}
	})

	test("the shipped context template lints clean", async () => {
		const { SHIPPED_CONTEXT_TEMPLATE } = await import(
			"$lib/server/pipelines/entities/contextTemplateDefaults"
		)
		expect(
			lintContextTemplate(
				parseContextTemplate(SHIPPED_CONTEXT_TEMPLATE).cards
			).map((i) => i.message)
		).toEqual([])
	})

	test("a root-level dotted path into a structural field is not flagged", () => {
		// It was, until the walk replaced the whole-string set lookup:
		// `{{postHistory.instructions}}` compared "postHistory.instructions"
		// against a set containing "postHistory".
		expect(unrecognized("{{postHistory.instructions}}")).toEqual([])
		expect(unrecognized("{{chatMessages.0.message}}")).toEqual([])
	})
})
