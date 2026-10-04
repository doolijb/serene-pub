/**
 * How public an *inferred* relationship is allowed to claim to be.
 *
 * ## The default was the bug
 *
 * `narrative_relationships.visibility` defaults to `"acknowledged"` and every
 * edge already records the `sceneId` it came from. The provenance was written
 * and nothing read it, so an edge formed inside a private scene was born
 * asserting that its object *knows about it*. Plan §6 ruled the bound:
 *
 * | cast relation of the OBJECT (`toNode`) | bound |
 * |---|---|
 * | mentioned only — was not there | **secret** — B formed a view of A behind A's back; A does not know |
 * | present — both were there | **acknowledged** is defensible |
 * | — | **`public` is never inferred.** It is a claim about the world knowing, which no single scene establishes. It must be authored. |
 *
 * ## ⚠ A ceiling, never an assignment
 *
 * It caps what an inference may claim; it must never overwrite what an author
 * chose. Mentions are derived and **will recompute as the vocabulary improves**,
 * so an assignment would clobber deliberate intent repeatedly and silently.
 *
 * Two things make that structural rather than a convention a reviewer has to
 * remember:
 *
 *  1. **This function is only reachable from the inference.** The two authoring
 *     handlers — `narrativeGraph:createRelationship` and
 *     `narrativeGraph:updateRelationship` — write the column directly and never
 *     call it. A person can still set anything the enum allows.
 *  2. **A stored `public` is refused outright.** Rule 3 makes `public`
 *     unreachable by inference, so a row that holds it was authored *by
 *     construction* — there is no other way for the value to get there. The
 *     function returns `undefined` for it, meaning *write nothing*, so a
 *     re-scan of that edge leaves the widening exactly where the author put it.
 *     ⚠ Do not "simplify" this to `min(claim, ceiling)`: `min` would quietly
 *     demote every authored `public` to `acknowledged` on the next build, which
 *     is the failure this whole file exists to prevent.
 *
 * Rows written before this existed are left alone. Every one of them was
 * created under the wrong default, and tightening what a user may already have
 * seen is a decision for a person, not a side effect of a scan.
 */

import type { RelationshipVisibility } from "$lib/server/db/schema"
import { RELATIONSHIP_VISIBILITIES } from "$lib/shared/lorebooks/linkVocabulary"

/** The one list (`linkVocabulary.ts`), as a set to test a value against. */
export const VALID_RELATIONSHIP_VISIBILITIES = new Set<RelationshipVisibility>(
	RELATIONSHIP_VISIBILITIES
)

/**
 * Narrower first. The order the bound is taken over: the one list's own
 * order, least known first.
 */
const OPENNESS = Object.fromEntries(
	RELATIONSHIP_VISIBILITIES.map((visibility, rank) => [visibility, rank])
) as Record<RelationshipVisibility, number>

/**
 * An LLM's raw string, coerced onto the real union.
 *
 * Falls back to the column's own default rather than throwing: the proposal was
 * reviewed by a person before it got here, and a mistyped value must not cost
 * them the whole apply. It fails *closed* downstream too —
 * `graphContextFormatter`'s allowlist filter drops anything not in the union —
 * so an unrecognised value would otherwise be silently and permanently invisible.
 */
export function sanitizeRelationshipVisibility(
	value: string | undefined | null
): RelationshipVisibility {
	return VALID_RELATIONSHIP_VISIBILITIES.has(value as RelationshipVisibility)
		? (value as RelationshipVisibility)
		: "acknowledged"
}

/**
 * Where the object of the edge stood in the scene the edge came from.
 *
 * `unknown` is a real third answer, not a missing one: an edge with no scene
 * provenance (a direct history entry the build derived no cast for) has nothing
 * to be tightened *by*. It is bounded at `acknowledged` — the column's existing
 * default — rather than at `secret`, because inventing privacy from an absence
 * of evidence would silently hide edges that were never claimed to be private.
 * `public` is still refused: that rule holds everywhere, with or without a scene.
 */
export type ObjectPresence = "present" | "absent" | "unknown"

/**
 * The visibility an inference may write, or `undefined` for *leave it alone*.
 *
 * `claim` is what the inference itself proposed for THIS write. `stored` is the
 * value already on the row, for an update; omit it for an insert.
 */
export function inferredRelationshipVisibility(input: {
	claim: string | null | undefined
	objectPresence: ObjectPresence
}): RelationshipVisibility
export function inferredRelationshipVisibility(input: {
	claim: string | null | undefined
	objectPresence: ObjectPresence
	stored: RelationshipVisibility | null | undefined
}): RelationshipVisibility | undefined
export function inferredRelationshipVisibility(input: {
	claim: string | null | undefined
	objectPresence: ObjectPresence
	stored?: RelationshipVisibility | null
}): RelationshipVisibility | undefined {
	// 1. An author widened this edge. `public` is never inferred, so nothing
	//    else can have written it. Leave it.
	if (input.stored === "public") return undefined

	// 2. The bound the scene supports.
	const ceiling: RelationshipVisibility =
		input.objectPresence === "absent" ? "secret" : "acknowledged"

	// 3. The claim, capped. Never `public`, because no ceiling above is.
	const claim = sanitizeRelationshipVisibility(input.claim)
	return OPENNESS[claim] <= OPENNESS[ceiling] ? claim : ceiling
}
