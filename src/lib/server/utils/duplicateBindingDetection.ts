/**
 * Proactive duplicate-binding detection — surfaces likely-duplicate pairs
 * after a graph build/extend so a user doesn't have to notice them by
 * eyeballing the Bindings tab. See the merge plan's "2a. Proactive
 * duplicate detection".
 *
 * Scope is deliberately name/alias matching only (reusing the exact same
 * namesMatch() fuzzy check the extraction pipeline already uses) — not the
 * plan's secondary "summary text overlap" signal. A review-and-confirm
 * feature is only useful if it's trusted; a text-similarity heuristic
 * without careful tuning risks enough false positives to make users start
 * ignoring the whole affordance. Worth adding later against real usage
 * data, not as a first pass.
 */

import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import type { PgliteDatabase } from "drizzle-orm/pglite"
import { collectAliases, namesMatch } from "./summarizer/availableSceneCast"

type DbLike = PgliteDatabase<typeof schema>

async function defaultDb(): Promise<DbLike> {
	return (await import("$lib/server/db")).db
}

export interface DuplicateCandidate {
	bindingIdA: number
	bindingIdB: number
	nameA: string
	nameB: string
}

function pairKey(a: number, b: number): string {
	return a < b ? `${a}:${b}` : `${b}:${a}`
}

// The nested loop below is O(n^2) with a fuzzy (Levenshtein-based) match per
// pair — synchronous JS on Node's single event loop. Most real lorebooks are
// far smaller than this; above it, detection is skipped rather than blocking
// every connected user's socket handling for tens of millions of
// comparisons. Tune against real usage data if this proves too low.
export const MAX_BINDINGS_FOR_DUPLICATE_DETECTION = 300

export async function findDuplicateCandidates(
	lorebookId: number,
	dbInstance?: DbLike
): Promise<DuplicateCandidate[]> {
	const db = dbInstance ?? (await defaultDb())

	const [bindings, relationships, dismissed] = await Promise.all([
		db.query.lorebookBindings.findMany({
			where: eq(schema.lorebookBindings.lorebookId, lorebookId)
		}),
		db.query.narrativeRelationships.findMany({
			where: eq(schema.narrativeRelationships.lorebookId, lorebookId)
		}),
		db.query.dismissedDuplicatePairs.findMany({
			where: eq(schema.dismissedDuplicatePairs.lorebookId, lorebookId)
		})
	])

	if (bindings.length > MAX_BINDINGS_FOR_DUPLICATE_DETECTION) {
		console.warn(
			`findDuplicateCandidates: skipping detection for lorebook ${lorebookId} — ${bindings.length} bindings exceeds the ${MAX_BINDINGS_FOR_DUPLICATE_DETECTION} cap.`
		)
		return []
	}

	const dismissedKeys = new Set(
		dismissed.map((d) => pairKey(d.bindingIdA, d.bindingIdB))
	)
	const relatedKeys = new Set(
		relationships.map((r) => pairKey(r.fromNodeId, r.toNodeId))
	)

	const candidates: DuplicateCandidate[] = []
	for (let i = 0; i < bindings.length; i++) {
		for (let j = i + 1; j < bindings.length; j++) {
			const a = bindings[i]
			const b = bindings[j]

			// Two real characters/personas are always distinct individuals —
			// the same eligibility rule the absorb handler's guard enforces.
			// A bound + unbound pair IS eligible: an unbound ghost duplicating
			// a bound character is the single most common real case (the
			// plan's own motivating example), so restricting candidates to
			// unbound-vs-unbound would miss it entirely.
			const aIsBound = a.characterId != null || a.personaId != null
			const bIsBound = b.characterId != null || b.personaId != null
			if (aIsBound && bIsBound) continue

			const key = pairKey(a.id, b.id)
			if (dismissedKeys.has(key)) continue
			if (relatedKeys.has(key)) continue

			// Canonical name prepended on top of the mandated alias union —
			// the name is this caller's own addition, not part of it.
			const aNames = [a.name, ...collectAliases(a)]
			const bNames = [b.name, ...collectAliases(b)]
			const isMatch = aNames.some((an) =>
				bNames.some((bn) => namesMatch(an, bn))
			)
			if (!isMatch) continue

			candidates.push({
				bindingIdA: a.id,
				bindingIdB: b.id,
				nameA: a.name,
				nameB: b.name
			})
		}
	}
	return candidates
}
