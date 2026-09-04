/**
 * Pool keys, and the one place that knows how to take them apart.
 *
 * A template's pool is `(node type, engine)` — two columns in the database,
 * indexed as two. This module owns the in-memory string spelling of that pair
 * and, crucially, its INVERSE.
 *
 * It lives in `shared` rather than beside the rest of the entity because the
 * composer is server-side while the splitter is needed by the admin template
 * form and the library page, and `$lib/server` is blocked from client import.
 * Splitting the pair across two modules would have been the third spelling of
 * one fact in a codebase that has already been bitten by the second — so the
 * pair lives here and `entities/contextTemplateDefaults.ts` re-exports the
 * composer for its ten existing importers.
 *
 * Imports nothing, deliberately: `config.ts` needs `poolKeyFor` and
 * `contextTemplates.ts` imports `config.ts`, a cycle this module cannot join.
 */

/**
 * Core's template engine — the one every install has.
 *
 * Duplicated as a literal in the library page and defined again server-side in
 * `prompt/renderers.ts`, which is how a template could be written for one engine
 * and rendered by another. It is the fallback for a pool key that names none,
 * and nothing else: `renderTemplate` no longer defaults, it throws.
 */
export const CORE_TEMPLATE_ENGINE = "core:template/handlebars@1"

/**
 * A node type id with its version stripped.
 *
 * `core:task/assemble@2` and `core:task/assemble@3` are the same pool. Which
 * variables a version supplies is the lint's business; fragmenting the pool on
 * a version bump would strand every template a user wrote against the old one,
 * with no way to move it across.
 */
export const poolKeyFor = (typeId: string): string => typeId.split("@")[0]!

/**
 * `#`, because both halves already contain colons.
 *
 * Split from the LAST occurrence, not the first: a node type id cannot contain
 * one but an engine id is not this module's to constrain.
 */
export const POOL_SEPARATOR = "#"

/**
 * The two halves of a context template's pool as one string, for an in-memory
 * `Map` key ONLY.
 *
 * The pool is `(node type, engine)`, because a template is a piece of writing
 * in a language: a Jinja story string and a Handlebars one both render the
 * assemble node's context and are not interchangeable for a second. Pooling on
 * the node type alone let either be selected into either slot, where it stored
 * cleanly and rendered its own markup as prose.
 *
 * ⚠ Never persist this and never query by it. `pipeline_context_templates`
 * stores the pool as TWO columns and indexes them as two; a stringified
 * composite would be a third spelling of the same fact that no index covers.
 */
export const contextPoolKeyFor = (nodeTypeId: string, engine: string): string =>
	`${poolKeyFor(nodeTypeId)}${POOL_SEPARATOR}${engine}`

/**
 * The inverse. Takes a composite key back to the two values a write needs.
 *
 * A key with no separator is a row whose pool nothing declares any more (a
 * disabled plugin's), and it falls back to the caller's default engine so it
 * still gets a heading rather than vanishing off a page whose whole job is to
 * show what exists.
 */
export function splitPoolKey(
	poolKey: string,
	fallbackEngine: string
): { poolId: string; engine: string } {
	const at = poolKey.lastIndexOf(POOL_SEPARATOR)
	if (at < 0) return { poolId: poolKey, engine: fallbackEngine }
	return {
		poolId: poolKey.slice(0, at),
		engine: poolKey.slice(at + 1)
	}
}
