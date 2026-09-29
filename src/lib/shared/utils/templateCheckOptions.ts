/**
 * What core's two template engines register, as NAMES — the input the SDK's
 * template checker (`@serene-pub/sdk/template-check`, typed templates P4)
 * parses with.
 *
 * The checker parses only; core still renders with its own engines
 * (`contextHandlebarsHelpers.ts`, `contextLiquid.ts`), and both of those read
 * their registrations from here, so what the checker accepts and what the
 * renderer knows cannot drift apart. A leaf: imports nothing at run time, so
 * the editor can reach it without pulling a renderer into the client.
 */

import type { TemplateCheckOptions } from "@serene-pub/sdk/template-check"

/**
 * Every Handlebars helper `registerContextHandlebarsHelpers` registers, beyond
 * Handlebars' own. `contextHandlebarsHelpers.test.ts` holds the two together.
 */
export const CONTEXT_HANDLEBARS_HELPERS = [
	"eq",
	"ne",
	"and",
	"or",
	"pad",
	"isSet",
	"json",
	"jsonValue",
	"systemBlock",
	"assistantBlock",
	"userBlock"
] as const

/** Liquid's `{% name %}…{% endname %}` role wrappers — the Handlebars block helpers' names. */
export const CONTEXT_LIQUID_BLOCK_TAGS = [
	"systemBlock",
	"assistantBlock",
	"userBlock"
] as const

/** Liquid filters core adds — the Handlebars inline helpers', as filters. */
export const CONTEXT_LIQUID_FILTERS = ["pad", "json", "jsonValue"] as const

/**
 * Liquid tags refused at PARSE time, with the sentence that says why: a
 * context template is a row in a table, and there is no file for it to pull in.
 */
export const CONTEXT_LIQUID_REFUSED_TAGS: Readonly<Record<string, string>> =
	Object.fromEntries(
		["include", "render", "layout"].map((name) => [
			name,
			`'${name}' is not available: a context template is a row in a table, ` +
				`so there is no file for it to pull in. Put the shared text in the ` +
				`template itself.`
		])
	)

/** Characters one Liquid `parse()` may consume — a template is a row, not a corpus. */
export const LIQUID_PARSE_LIMIT = 1_000_000

/** The checker's input for core's engines. One object, so the checker's Liquid is built once. */
export const CONTEXT_TEMPLATE_CHECK: TemplateCheckOptions = {
	helpers: CONTEXT_HANDLEBARS_HELPERS,
	liquid: {
		blockTags: CONTEXT_LIQUID_BLOCK_TAGS,
		filters: CONTEXT_LIQUID_FILTERS,
		refusedTags: CONTEXT_LIQUID_REFUSED_TAGS,
		parseLimit: LIQUID_PARSE_LIMIT
	}
}

/** The same, for a scope with untyped sources (`templateScopeReport().untyped`). */
export const templateCheckWith = (
	untyped: readonly string[] | undefined
): TemplateCheckOptions =>
	untyped?.length
		? { ...CONTEXT_TEMPLATE_CHECK, untyped }
		: CONTEXT_TEMPLATE_CHECK
