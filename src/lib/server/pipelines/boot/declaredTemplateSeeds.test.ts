/**
 * The two vocabularies a manifest says a template row in, read as one (D-6).
 *
 * `templates` is the full `TemplateSeed`; `prompts` is D-1's narrower
 * `PromptDecl`, and it is the field `serene-pub build` writes from a
 * `defineExtension`. They are translated at this one point because the
 * projection that consumes them also **withdraws** what it did not see, so a
 * second reader writing the same table would have its rows withdrawn on the
 * next pass.
 */
import { describe, expect, it } from "vitest"
import { declaredTemplateSeeds } from "./registrySync"

describe("declaredTemplateSeeds", () => {
	it("reads a PromptDecl as a prompts template under the plugin's namespace", () => {
		expect(
			declaredTemplateSeeds(
				{
					prompts: [
						{
							nodeType: "core:task/build-template-context",
							slot: "prompts",
							slug: "tally-referee",
							label: { en: "Tally referee" },
							fields: { systemPrompt: "Count." }
						}
					]
				},
				"demo.unified"
			)
		).toEqual([
			{
				id: "demo.unified:template/tally-referee@1",
				kind: "prompts",
				nodeDefinitionId: "core:task/build-template-context",
				slot: "prompts",
				label: "Tally referee",
				body: { systemPrompt: "Count." }
			}
		])
	})

	it("keeps both fields, `templates` first", () => {
		const seeds = declaredTemplateSeeds(
			{
				templates: [
					{ id: "x.y:template/a@2", kind: "prompts", body: { a: "1" } }
				],
				prompts: [{ slug: "b", nodeType: "n", slot: "prompts", fields: {} }]
			},
			"x.y"
		)
		expect(seeds.map((s) => s.id)).toEqual([
			"x.y:template/a@2",
			"x.y:template/b@1"
		])
	})

	it("falls back to the slug when a prompt names no label", () => {
		const [seed] = declaredTemplateSeeds(
			{ prompts: [{ slug: "terse", nodeType: "n", slot: "prompts", fields: {} }] },
			"x.y"
		)
		expect(seed.label).toBe("terse")
	})

	it("drops an entry whose slug could not be a template name", () => {
		// A slug outside the name grammar would mint an id the projection
		// refuses anyway; dropped here so the refusal never names an id this
		// function invented rather than one the author wrote.
		expect(
			declaredTemplateSeeds(
				{
					prompts: [
						{ slug: "Not Kebab", nodeType: "n", slot: "prompts", fields: {} },
						{ slug: "", nodeType: "n", slot: "prompts", fields: {} },
						null,
						"nope"
					]
				},
				"x.y"
			)
		).toEqual([])
	})

	it("is tolerant of the json being anything", () => {
		expect(declaredTemplateSeeds(null, "x.y")).toEqual([])
		expect(declaredTemplateSeeds("nope", "x.y")).toEqual([])
		expect(declaredTemplateSeeds({ templates: "nope" }, "x.y")).toEqual([])
		expect(declaredTemplateSeeds({ prompts: { a: 1 } }, "x.y")).toEqual([])
	})
})
