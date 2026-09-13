/**
 * Facts about entity extraction that BOTH sides need, and neither should
 * re-spell.
 *
 * Two values: the capability the entity star registers, and the idle-unload
 * default. ⚠ Neither may be re-spelled anywhere. A capability id is a PRIMARY
 * KEY value, and a default written out twice is a number that can be changed in
 * one place and not the other.
 *
 * Client-safe on purpose: the sidebar reads the capability to find the star, and
 * the server reads it through `$lib/server/ner/target`.
 */

/**
 * The transform `connection_defaults` keys the entity star by.
 *
 * ⚠ The server re-exports this as `NER_CAPABILITY` rather than declaring its
 * own. A second spelling of a PRIMARY KEY value is a row nothing ever matches
 * again.
 */
export const NER_CAPABILITY = "text->entities"

/** How long an idle entity model stays resident, when the row says nothing. */
export const DEFAULT_NER_TTL_MINUTES = 5

/**
 * ⚠ There is no `nerStarred()` beside `embeddingsStarred()`, and the asymmetry
 * is the point.
 *
 * Embeddings have five screens that ask "are they on", because with no star
 * there is no retrieval by meaning at all. Entity extraction has none: with no
 * star the lane runs on the gazetteer and the capitalisation heuristic, which is
 * a working state rather than an off one, so no screen has a reason to branch on
 * it. A predicate here would be the first invitation to write one.
 */
