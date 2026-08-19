/**
 * Which retrieval arm may surface which entry (DECOMPOSITION §4).
 *
 * The ruling: an entry declares `keyword`, `rag` (with keyword fallback) or
 * `both`, and the default is `rag`. This module is that ruling as code, and it
 * is deliberately tiny — the interesting part is not the logic, it is that the
 * decision lives on the **entry** rather than on the pipeline, so a user can
 * read it off the thing they are editing.
 *
 * The fallback deserves its own note because it is the one place this differs
 * from a naive reading of the rule. An entry set to `rag` on an instance with
 * no embedding model is **still findable by keyword**. The alternative is
 * retrieving nothing, which presents to a user as "the bot forgot my lore" and
 * sends them to the wrong screen entirely — they go looking at their lorebook
 * rather than at their embedding configuration. The receipt records which arm
 * actually ran, so the fallback is visible rather than mysterious (16 §2).
 */

export type RetrievalStrategy = "keyword" | "rag" | "both"

/** NULL in the column means the default, which is `rag`. */
export const strategyOf = (entry: {
	retrievalStrategy?: string | null
}): RetrievalStrategy => (entry.retrievalStrategy as RetrievalStrategy) ?? "rag"

export interface ArmAvailability {
	/** False when there is no embedding model, or vectors are stale. */
	vectorSearchAvailable: boolean
}

export type Arm = "keyword" | "vector"

/**
 * May this arm surface this entry?
 *
 * Note the asymmetry: `rag` becomes keyword-eligible when vectors are
 * unavailable, but `keyword` never becomes vector-eligible. A user who said
 * "keyword only" said it about semantics, not about availability, and quietly
 * widening that would surface entries they deliberately narrowed.
 */
export function eligibleFor(
	entry: { retrievalStrategy?: string | null },
	arm: Arm,
	availability: ArmAvailability
): boolean {
	const strategy = strategyOf(entry)
	if (strategy === "both") return true
	if (strategy === "keyword") return arm === "keyword"

	// strategy === "rag"
	return arm === "vector"
		? availability.vectorSearchAvailable
		: !availability.vectorSearchAvailable
}

/** What the receipt should say about how an entry was found. */
export function armNote(
	entry: { retrievalStrategy?: string | null },
	arm: Arm,
	availability: ArmAvailability
): string {
	const strategy = strategyOf(entry)
	if (
		strategy === "rag" &&
		arm === "keyword" &&
		!availability.vectorSearchAvailable
	)
		return "set to rag, matched by keyword because no embedding model is available"
	if (strategy === "both") return `set to both, matched by ${arm}`
	return `set to ${strategy}, matched by ${arm}`
}

// ── Combining the two arms ──────────────────────────────────────────────────

export interface RankedItem {
	id: number | string
	source: string
}

/**
 * Reciprocal-rank fusion over two orderings.
 *
 * **Not an average of the two scores**, and that is the whole point. Keyword
 * scores are a weighted sum in roughly [0, 1.5]; RAG scores are a normalised
 * RRF value in [0, 1] against a per-run adaptive threshold. Averaging lets
 * whichever arm happens to be more generous dominate, and the user cannot tell
 * which one that was on any given turn.
 *
 * Rank fusion is scale-free: only the *ordering* within each arm matters. It is
 * also not a new mechanism here — `RagInfillEngine` already fuses its own two
 * query passes this way (`:132-149`), so this is one implementation used twice
 * rather than a second idea.
 *
 * `k = 60` is the constant from the original RRF paper and the value already in
 * use in the RAG engine. It flattens the difference between ranks 1 and 2 less
 * than a smaller k would, which is what stops a single arm's top hit from
 * automatically winning.
 */
export function fuseRanks<T extends RankedItem>(
	orderings: ReadonlyArray<ReadonlyArray<T>>,
	k = 60
): Array<{ item: T; score: number; ranks: number[] }> {
	const byKey = new Map<string, { item: T; score: number; ranks: number[] }>()

	orderings.forEach((ordering, orderingIndex) => {
		ordering.forEach((item, rank) => {
			const key = `${item.source}:${item.id}`
			const existing = byKey.get(key)
			const contribution = 1 / (k + rank + 1)
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

	// Sorted by fused score. An item found by both arms outranks one found by
	// either alone at the same rank, which is the behaviour "both" is asking
	// for: agreement between two independent signals is itself evidence.
	return [...byKey.values()].sort((a, b) => b.score - a.score)
}
