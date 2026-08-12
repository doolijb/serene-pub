/**
 * Three lists have to agree whenever a template variable is added, and nothing
 * connects them: TemplateContext (the type), KNOWN_TOP_LEVEL_FIELDS (this
 * linter's vocabulary) and mockTemplateContext (the editor's live preview).
 *
 * Adding `speakerRelationships` to the type but not the linter is exactly what
 * happened — the runtime worked, and the editor reported
 * "isn't a recognized field at this scope" against the shipped default
 * template. Missing it from the preview data is quieter still: the block just
 * renders empty while you are editing it.
 */
import { describe, expect, test } from "vitest"
import { parseContextTemplate, lintContextTemplate } from "./contextConfigCards"

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

	test("the editor preview supplies both graph fields", async () => {
		// Covers the fields this rewrite touched rather than the whole
		// vocabulary — not every recognised name is a data field.
		const { buildMockTemplateContext } = await import(
			"$lib/server/utils/promptBuilder/mockTemplateContext"
		)
		const mock: any = buildMockTemplateContext()
		for (const field of ["narrativeGraph", "speakerRelationships"]) {
			expect(
				mock[field],
				`${field} missing from preview data`
			).toBeTruthy()
		}
	})
})
