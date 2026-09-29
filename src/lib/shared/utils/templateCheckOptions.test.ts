/**
 * The checker parses with NAMES; the renderers register implementations. These
 * hold the two together, so a helper, tag or filter added to one engine and
 * not to `templateCheckOptions.ts` fails here instead of reaching an author as
 * "isn't a recognized helper" on a template that renders fine.
 */
import { describe, expect, it } from "vitest"
import Handlebars from "handlebars"
import {
	HANDLEBARS_BUILTIN_HELPERS,
	checkTemplateSource
} from "@serene-pub/sdk/template-check"
import { registerContextHandlebarsHelpers } from "./contextHandlebarsHelpers"
import { createContextLiquid } from "./contextLiquid"
import {
	CONTEXT_HANDLEBARS_HELPERS,
	CONTEXT_LIQUID_BLOCK_TAGS,
	CONTEXT_LIQUID_FILTERS,
	CONTEXT_LIQUID_REFUSED_TAGS,
	CONTEXT_TEMPLATE_CHECK
} from "./templateCheckOptions"
import {
	CORE_LIQUID_ENGINE,
	CORE_TEMPLATE_ENGINE
} from "$lib/shared/pipelines/templateEngines"

describe("the checker's names match what the engines register", () => {
	it("every Handlebars helper core registers is on the list, and nothing else", () => {
		const hbs = Handlebars.create()
		registerContextHandlebarsHelpers(hbs, { promptFormat: "" })
		const registered = Object.keys(hbs.helpers).filter(
			(h) => !HANDLEBARS_BUILTIN_HELPERS.includes(h)
		)
		expect(registered.sort()).toEqual([...CONTEXT_HANDLEBARS_HELPERS].sort())
	})

	it("every Liquid tag and filter core registers is on the list", () => {
		const liquid = createContextLiquid({ promptFormat: "" }) as unknown as {
			tags: Record<string, unknown>
			filters: Record<string, unknown>
		}
		for (const tag of [
			...CONTEXT_LIQUID_BLOCK_TAGS,
			...Object.keys(CONTEXT_LIQUID_REFUSED_TAGS)
		])
			expect(liquid.tags[tag], tag).toBeDefined()
		for (const filter of CONTEXT_LIQUID_FILTERS)
			expect(liquid.filters[filter], filter).toBeDefined()
	})

	it("the checker accepts what core renders, in both engines", () => {
		expect(
			checkTemplateSource(
				CORE_TEMPLATE_ENGINE,
				"{{#systemBlock}}{{{jsonValue x indent=1}}}{{pad (json x) 2}}{{#if (isSet x)}}{{/if}}{{/systemBlock}}",
				{ x: "any" },
				CONTEXT_TEMPLATE_CHECK
			)
		).toEqual([])
		expect(
			checkTemplateSource(
				CORE_LIQUID_ENGINE,
				"{% userBlock %}{{ x | jsonValue: 2 | pad: 2 }}{% enduserBlock %}",
				{ x: "any" },
				CONTEXT_TEMPLATE_CHECK
			)
		).toEqual([])
	})
})
