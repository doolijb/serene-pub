/**
 * Which edges are the **cast** graph.
 *
 * An endpoint is a cast binding or an entry, so "every relationship in this
 * lorebook" is a wider set than "every relationship between two characters".
 * The traversals that mean the second — the prompt's relationship sections, the
 * vectorizer, the export, the duplicate finder, the graph builder's seeds — each
 * say so here rather than discovering it as a null.
 *
 * ⚠ Two forms of one rule, and they must stay in step: the SQL predicate keeps
 * the rows out of the query, and the guard narrows the type for a caller that
 * already holds them.
 */

import { and, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** Both ends are bindings — the graph as it was before entries could be on it. */
export const castEdgeOnly = and(
	isNotNull(schema.narrativeRelationships.fromNodeId),
	isNotNull(schema.narrativeRelationships.toNodeId)
)!

/** The same rule for rows already in hand. */
export const isCastEdge = <
	T extends { fromNodeId: number | null; toNodeId: number | null }
>(
	row: T
): row is T & { fromNodeId: number; toNodeId: number } =>
	row.fromNodeId !== null && row.toNodeId !== null
