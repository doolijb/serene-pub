/**
 * The engine ids core ships, spelled once.
 *
 * A template carries its engine as data (both template tables store `engine`
 * NOT NULL), and three unrelated layers need to name core's engines by id: the
 * server registry that owns the renderers (`prompt/renderers.ts`), the pool key
 * that pairs an engine with a node type (`poolKey.ts`), and the admin editor,
 * which is client code and cannot import either. Before this module the id was
 * a literal in each of them — the arrangement that lets a template be written
 * for one engine and rendered by another.
 *
 * A leaf: imports nothing, so `poolKey.ts` can take it without joining the
 * `config.ts` → `contextTemplates.ts` cycle it documents.
 */

/** Handlebars. The column default, and what every seeded row is written in. */
export const CORE_TEMPLATE_ENGINE = "core:template/handlebars@1"

/**
 * Liquid, core's second engine.
 *
 * Beside Handlebars, not instead of it: existing rows and the column default
 * are untouched, and which engine a new template gets is chosen when it is
 * created.
 */
export const CORE_LIQUID_ENGINE = "core:template/liquid@1"

/**
 * Both, in the order a picker should offer them.
 *
 * Core's engines are the ones no plugin may claim or release, so this list is
 * also the answer to "may this be taken over" — see `registerRenderer`.
 */
export const CORE_TEMPLATE_ENGINES = [
	CORE_TEMPLATE_ENGINE,
	CORE_LIQUID_ENGINE
] as const

export const isCoreTemplateEngine = (engineId: string): boolean =>
	(CORE_TEMPLATE_ENGINES as readonly string[]).includes(engineId)

/**
 * What a slot says about the languages it accepts, in either spelling.
 *
 * Structural rather than an import of `SlotDecl`: this module is a leaf, and
 * the same two fields arrive here from the SDK descriptor, from a projected
 * `Decl` row and from the socket payload the client reads.
 */
export interface EngineDecl {
	engine?: string
	engines?: readonly string[]
}

/**
 * Every engine a slot accepts, most-preferred first.
 *
 * The set supersedes the singular, the singular is a one-element set, and a
 * slot that declares neither accepts core's — which is what the column default
 * has always meant. An empty array declares nothing rather than accepting
 * nothing, because a slot no template can ever satisfy is a picker that is
 * permanently empty with no way to be given anything.
 */
export function acceptedEngines(decl: EngineDecl): string[] {
	if (decl.engines?.length) return [...decl.engines]
	return [decl.engine ?? CORE_TEMPLATE_ENGINE]
}

/**
 * The engine a NEW template in this slot is written in: the first accepted.
 *
 * Order is meaning, not presentation. A slot's first engine is what every
 * caller resolves when nothing asks for another, so re-ordering the list
 * changes what an untouched install produces.
 */
export const defaultEngineOf = (decl: EngineDecl): string =>
	acceptedEngines(decl)[0]!

/**
 * An engine id as the name of a language.
 *
 * `core:template/handlebars@1` is a pinned id nobody chose; "Handlebars" is the
 * word on the page they are looking at. Falls back to the raw id when the shape
 * is not the familiar one, because a plugin may publish anything and a
 * confident wrong guess reads worse than an id.
 */
export const languageOf = (engineId: string): string => {
	const name = engineId.split("/")[1]?.split("@")[0]
	if (!name) return engineId
	return name.charAt(0).toUpperCase() + name.slice(1)
}
