/**
 * Rank fusion for the retrieval mechanisms.
 *
 * ## ⚠ What this module used to be, and why none of it is left
 *
 * It was the per-entry retrieval **gate**: `lorebook_entries.retrieval_strategy`
 * held `keyword`, `rag` or `both`, and `strategyOf` / `eligibleFor` / `armNote`
 * turned that column into a rule about which mechanism was allowed to surface which
 * entry. Migration **0204** dropped the column and this file lost the half that
 * read it. Both halves went together on purpose: a resolver with no column to
 * resolve is a dead knob, and a dead knob here is an invitation to put the
 * column back.
 *
 * The reason is the retrieval plan's second governing rule, one level down from
 * where migration 0203 applied it:
 *
 * > **An unavailable mechanism subtracts a signal. It never reroutes, disables
 * > a path, or excludes a candidate. Adding a model may only add matches;
 * > removing one may only lose them.**
 *
 * 0203 culled the *node's* `retrievalMode`, which answered for entries that had
 * declared nothing. This column was the same shape with an author's hand on it:
 * `keyword` kept an entry out of the vector mechanism with a model loaded and a cosine
 * of 1 — a mechanism switched off for one candidate, which is an exclusion
 * however small its scope. The shape had already shipped broken twice, most
 * recently with three tests asserting the emptying as correct behaviour, and the
 * rule is stated as an absolute because of it.
 *
 * Two of the three values had also stopped differing. `rag` meant "find by
 * meaning, and by keyword as well" and `both` meant "run both mechanisms and fuse
 * their rankings"; respond 1.17.0 removed the fusion as the wrong operation on
 * disjoint lanes, and the mechanisms have contributed additively to one score
 * ever since. So the enum offered the same answer twice and, for the third,
 * a switch-off.
 *
 * Dropping it destroyed nothing. There was no editor control for the column and
 * never had been — nothing under `src/lib/client` has ever named it in the
 * repository's history, no importer set it, and the one writer was a socket
 * payload no form sent. Every entry any user ever created was NULL, which
 * `strategyOf` resolved to `rag`, which is what every entry is now.
 *
 * ## ⚠ If per-entry mechanism preference is wanted again, it comes back as
 * **weights**, not as a gate
 *
 * The want behind `keyword` was real — *"this entry is a name, match it
 * literally; do not let a paraphrase drag it in"*. That is a statement about how
 * much each mechanism's evidence should count for one entry, and the axis for it
 * already exists: mechanism weights (keyword / semantic / name) live in
 * `ranking/weights.ts` and are set per pipeline today. The successor is the same
 * concept at a second scope — an entry may lean on or away from a mechanism, and
 * a lean of zero is as far as it goes.
 *
 * One concept at two scopes, rather than a gate at one scope and weights at the
 * other. It keeps the rule above intact by construction: a weight of zero
 * removes a *signal's contribution*, and the candidate stays in the pool where
 * every other mechanism can still find it and the receipt can still explain it.
 * A gate removes the candidate, and nothing downstream can tell that it existed.
 *
 * ## What is left here
 *
 * Reciprocal-rank fusion, and the check for the case it cannot do anything with.
 * The module keeps its filename; the contents are now only the fusion half.
 */

export interface RankedItem {
	id: number | string
	source: string
}

/**
 * The RRF constant, in one place.
 *
 * Both the keyword/vector fusion and the semantic mechanism's per-message fusion
 * default to it. `SemanticParams.rrfK` still overrides it per node, which is
 * what makes it configurable; this is the number that applies when nobody
 * said otherwise.
 */
export const RRF_K = 60

/** Identity across mechanisms: the three lore tables have independent sequences. */
const rankKey = (item: RankedItem) => `${item.source}:${item.id}`

/**
 * Reciprocal-rank fusion over several orderings — the one implementation.
 *
 * **Not an average of the two scores**, and that is the whole point. Keyword
 * scores are a weighted sum in roughly [0, 1.5]; RAG scores are a normalised
 * RRF value in [0, 1] against a per-run adaptive threshold. Averaging lets
 * whichever mechanism happens to be more generous dominate, and the user cannot tell
 * which one that was on any given turn.
 *
 * Rank fusion is scale-free: only the *ordering* within each mechanism matters.
 *
 * ## The convention, and why this one
 *
 * `1 / (k + rank)` with **rank counted from 0**, so the top of a list
 * contributes `1/60` at the default k. There were two implementations of this
 * in the ranker and they disagreed by exactly one: the semantic mechanism's fusion
 * used `1 / (k + rank)` and this one used `1 / (k + rank + 1)`, so the same top
 * hit was worth 1/60 in one and 1/61 in the other. Same algorithm, two
 * denominators, and nothing anywhere said which was meant.
 *
 * The 0-based form wins on evidence rather than taste. It is what
 * the 0.5 RAG path computed, so it is what the frozen RAG parity goldens
 * record — changing the semantic mechanism to the other convention would move the
 * gate that measures 0.6 against 0.5, which is the one thing the gate must not
 * be adjusted to accommodate. (Cormack's paper writes `1 / (k + r)` over
 * 1-based ranks, which is the `+ 1` form; the difference is equivalent to
 * running with `k - 1`, and at k = 60 it is not a difference anyone can
 * observe in an ordering.)
 *
 * `k = 60` is the paper's constant and the value the RAG engine already used.
 * It flattens the difference between ranks 1 and 2 less than a smaller k would,
 * which is what stops a single mechanism's top hit from automatically winning.
 * ⚠ `k` must be at least 1: at k = 0 a rank-0 item divides by zero.
 *
 * Returns **insertion order**, not score order — first list first, each new key
 * appended where it was first seen. That is load-bearing for the semantic mechanism,
 * whose similarity matrix is indexed against the fused set; `fuseRanks` sorts
 * on top of it.
 */
export function rrf<T extends RankedItem>(
	orderings: ReadonlyArray<ReadonlyArray<T>>,
	k = RRF_K
): Array<{ item: T; score: number; ranks: number[] }> {
	const byKey = new Map<string, { item: T; score: number; ranks: number[] }>()

	orderings.forEach((ordering, orderingIndex) => {
		ordering.forEach((item, rank) => {
			const key = rankKey(item)
			const existing = byKey.get(key)
			const contribution = 1 / (k + rank)
			if (existing) {
				existing.score += contribution
				existing.ranks[orderingIndex] = rank
			} else {
				const ranks: number[] = []
				ranks[orderingIndex] = rank
				byKey.set(key, { item, score: contribution, ranks })
			}
		})
	})

	return [...byKey.values()]
}

/**
 * `rrf`, sorted best first.
 *
 * An item found by both mechanisms outranks one found by either alone at the same
 * rank: agreement between two independent signals is itself evidence. That is
 * the same argument the additive score makes one layer up, which is why the
 * per-entry gate above could go without anything taking its place.
 *
 * ⚠ Fusion only means that when the orderings **overlap**. Handed disjoint
 * lists — three lore lanes, say, where an entry belongs to exactly one — every
 * key appears once, every score collapses to one list position, and the result
 * is concatenation with a fabricated score attached. `disjointOrderings` below
 * is how a caller detects that; `core:task/concat-candidates@1` is what such a
 * caller wanted instead.
 */
export function fuseRanks<T extends RankedItem>(
	orderings: ReadonlyArray<ReadonlyArray<T>>,
	k = RRF_K
): Array<{ item: T; score: number; ranks: number[] }> {
	return rrf(orderings, k).sort((a, b) => b.score - a.score)
}

/**
 * Did no item appear in more than one of these orderings?
 *
 * The signature of the misuse above, and cheap enough to check on every fusion.
 * Fewer than two non-empty orderings is **not** disjoint: one mechanism returning
 * nothing is an ordinary turn (no embedding model, no keyword match), and
 * complaining about it would train the reader to ignore the complaint.
 */
export function disjointOrderings<T extends RankedItem>(
	orderings: ReadonlyArray<ReadonlyArray<T>>
): boolean {
	const nonEmpty = orderings.filter((o) => o.length > 0)
	if (nonEmpty.length < 2) return false
	const seen = new Set<string>()
	for (const ordering of nonEmpty)
		for (const item of ordering) {
			const key = rankKey(item)
			if (seen.has(key)) return false
			seen.add(key)
		}
	return true
}
