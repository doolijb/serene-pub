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
		const { sampleContext } = await import("$lib/server/pipelines/preview")
		const { allVariables } = await import("@serene-pub/sdk")
		const sample = sampleContext() as Record<string, unknown>

		for (const decl of allVariables())
			for (const key of Object.keys(decl.scope))
				expect(
					sample[key],
					`${key} missing from preview data`
				).toBeDefined()
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
