/**
 * The semantic arm's ranking stages, as functions over their inputs.
 *
 * `RagInfillEngine` runs nine of these between "here are candidates" and "here
 * is what goes in the prompt", all inline in one 200-line block and all keyed to
 * module-level constants. The pipeline's vector arm did one of them — cosine
 * similarity — which is why a RAG parity fixture could not have passed: the two
 * paths were not computing the same thing, or anything close to it.
 *
 * Each stage is separate here for the same reason the keyword signals are: a
 * user asking "why did this entry not make it" is asking which stage dropped it,
 * and a single fused function can only answer "the score was too low".
 *
 * ## Why MMR needs a similarity matrix rather than the vectors
 *
 * Maximal Marginal Relevance is the one stage that needs to compare candidates
 * to *each other*, so it needs similarity between arbitrary pairs. The obvious
 * implementation carries each candidate's embedding along the edge, and that is
 * exactly what the host refuses to do — a vector is a few hundred floats, and
 * putting one on a data edge puts it in every downstream input and in the
 * receipt.
 *
 * So the host supplies a **pairwise similarity matrix** instead: N² numbers for
 * N candidates, which at a topK of ~36 is smaller than two raw embeddings, and
 * unlike an embedding it cannot be turned back into the source vector. The cost
 * is real and worth naming — it is quadratic, so a topK in the thousands would
 * need a different approach — but it keeps MMR a **Task**, which is the point:
 * diversity policy is exactly the kind of thing an installation should be able
 * to replace, and a version of this that ran host-side would be frozen.
 */

import type { SemanticParams } from "./weights"

export interface RagCandidate {
	id: number | string
	source: string
	score: number
	name?: string | null
	content?: string
	/** Author-set tier; 1 is Normal. Only lore carries one. */
	priority?: number
	[key: string]: unknown
}

/** `cos(i, j)` for candidates by index. Symmetric; the diagonal is unused. */
export type SimilarityMatrix = ReadonlyArray<ReadonlyArray<number>>

const keyOf = (c: RagCandidate) => `${c.source}:${c.id}`

/**
 * Reciprocal-rank fusion across several ranked lists.
 *
 * One list **per message** in a window: each recent line is embedded on its own
 * and scored against the candidate pool, and their ranks are fused. Fusing
 * ranks rather than scores is the same decision the keyword/vector merge makes
 * and for the same reason — two similarity scores from two different queries
 * are not on one scale.
 *
 * Note what this does *not* fuse: the current window and the recent window are
 * separate runs of the whole arm, concatenated by `mergeWindows`. See its note.
 */
export function rrfMerge(
	lists: ReadonlyArray<ReadonlyArray<RagCandidate>>,
	k: number
): RagCandidate[] {
	const merged = new Map<string, { item: RagCandidate; score: number }>()
	for (const list of lists)
		for (let rank = 0; rank < list.length; rank++) {
			const item = list[rank]!
			const key = keyOf(item)
			const contribution = 1 / (k + rank)
			const existing = merged.get(key)
			if (existing) existing.score += contribution
			else merged.set(key, { item, score: contribution })
		}
	return [...merged.values()].map(({ item, score }) => ({ ...item, score }))
}

/**
 * Rescale to [0, 1] against the best result.
 *
 * The threshold below is expressed as a fraction of the top score, so the two
 * only mean anything together — an absolute RRF score has no interpretation, it
 * depends on how many queries ran.
 */
export function normaliseToTop(
	candidates: readonly RagCandidate[]
): RagCandidate[] {
	const max = Math.max(...candidates.map((c) => c.score), 0)
	return candidates.map((c) => ({ ...c, score: max > 0 ? c.score / max : 0 }))
}

/**
 * Lift recent messages, because a semantically similar line from an hour ago is
 * usually less use than a slightly less similar one from the last exchange.
 *
 * Messages only. Lore has no position in the conversation to be recent *to*.
 */
export function recencyBoost(
	candidates: readonly RagCandidate[],
	messageOrder: ReadonlyArray<number | string>,
	params: Pick<SemanticParams, "recencyBoost" | "recencyDecay">
): RagCandidate[] {
	const total = messageOrder.length
	return candidates.map((c) => {
		if (c.source !== "message") return { ...c }
		const index = messageOrder.indexOf(c.id)
		// An id not in the window is treated as maximally old rather than
		// dropped: it was retrieved, so it is relevant; it is just not recent.
		const age = index >= 0 ? total - 1 - index : total
		const factor =
			1 + params.recencyBoost * Math.exp(-params.recencyDecay * age)
		return { ...c, score: c.score * factor }
	})
}

/**
 * Honour the author's priority tier.
 *
 * Mirrors the keyword arm's bonus deliberately: an author who marks an entry
 * High expects that to mean something in both modes, and pure similarity
 * ranking would silently ignore it. Lore only — history entries have no
 * priority column, in either mode.
 */
export function priorityBoost(
	candidates: readonly RagCandidate[],
	bonusPerTier: number
): RagCandidate[] {
	return candidates.map((c) => {
		if (c.source !== "worldLore" && c.source !== "characterLore")
			return { ...c }
		const tier = (c.priority ?? 1) - 1
		return tier > 0
			? { ...c, score: c.score + tier * bonusPerTier }
			: { ...c }
	})
}

/**
 * Drop the long tail.
 *
 * `max(floor, topScore × fraction)` — the two clauses answer different
 * questions. The floor rejects a turn where nothing is relevant at all; the
 * relative one rejects the tail of a turn where something is. Either alone
 * fails on the other's case.
 */
export function adaptiveThreshold(
	candidates: readonly RagCandidate[],
	params: Pick<SemanticParams, "thresholdMin" | "relativeThreshold">
): { kept: RagCandidate[]; threshold: number } {
	const top = Math.max(...candidates.map((c) => c.score), 0)
	const threshold = Math.max(
		params.thresholdMin,
		top * params.relativeThreshold
	)
	return { kept: candidates.filter((c) => c.score >= threshold), threshold }
}

/**
 * Maximal Marginal Relevance: relevance, minus similarity to what is already in.
 *
 * Without it, retrieval returns five paraphrases of the same fact and calls it
 * five results — which is the failure mode people describe as "RAG keeps
 * repeating itself". λ is the trade-off: 1 is pure relevance, 0 pure novelty.
 *
 * Greedy and O(n²) in the number of candidates, matching the original. The
 * `similarity` argument is indexed by position in `candidates` — the array
 * passed in, not any earlier set — so a caller filtering before this must
 * project its matrix onto the survivors. `rankSemantic` does exactly that.
 */
export function mmrRerank(
	candidates: readonly RagCandidate[],
	similarity: SimilarityMatrix,
	lambda: number
): RagCandidate[] {
	if (candidates.length <= 1) return [...candidates]

	const order = candidates
		.map((c, index) => ({ c, index }))
		.sort((a, b) => b.c.score - a.c.score)

	const selected = [order.shift()!]
	while (order.length > 0) {
		let bestAt = 0
		let best = -Infinity
		for (let i = 0; i < order.length; i++) {
			const candidate = order[i]!
			let maxSim = 0
			for (const sel of selected) {
				const sim = similarity[candidate.index]?.[sel.index] ?? 0
				if (sim > maxSim) maxSim = sim
			}
			const mmr = lambda * candidate.c.score - (1 - lambda) * maxSim
			if (mmr > best) {
				best = mmr
				bestAt = i
			}
		}
		selected.push(order.splice(bestAt, 1)[0]!)
	}
	return selected.map((s) => s.c)
}

/**
 * Cap how many of each source survive.
 *
 * Applied *after* reranking, so the cap takes the best of each source rather
 * than the first-arrived. Order is otherwise preserved: this filters, it does
 * not re-sort.
 */
export function perSourceBudget(
	candidates: readonly RagCandidate[],
	params: Pick<SemanticParams, "sourceBudget" | "defaultSourceBudget">
): { kept: RagCandidate[]; dropped: RagCandidate[] } {
	const counts: Record<string, number> = {}
	const kept: RagCandidate[] = []
	const dropped: RagCandidate[] = []
	for (const c of candidates) {
		const budget =
			params.sourceBudget[c.source] ?? params.defaultSourceBudget
		const count = counts[c.source] ?? 0
		if (count >= budget) {
			dropped.push(c)
			continue
		}
		counts[c.source] = count + 1
		kept.push(c)
	}
	return { kept, dropped }
}

export interface SemanticRankInput {
	/** One ranked list per query embedding, best first. */
	lists: ReadonlyArray<ReadonlyArray<RagCandidate>>
	/** `cos(i, j)` over the *fused* candidate set, by index. */
	similarity?: SimilarityMatrix
	/** Message ids in reading order, for the recency boost. */
	messageOrder?: ReadonlyArray<number | string>
	params: SemanticParams
	/** The keyword arm's per-tier priority bonus, so both modes agree. */
	priorityBonus: number
}

export interface SemanticRankResult {
	candidates: RagCandidate[]
	/** What each stage did, because "score too low" is not an answer. */
	diagnostics: {
		fused: number
		threshold: number
		belowThreshold: number
		overBudget: number
		kept: number
	}
}

/**
 * The whole arm, in order, as one call.
 *
 * The order is the original's and is not arbitrary: boosts apply before the
 * threshold (so a recent message can survive a cut it would otherwise fail),
 * the threshold applies before MMR (so diversity is chosen among things worth
 * having), and the budget applies last (so each source's cap takes its best).
 */
export function rankSemantic(input: SemanticRankInput): SemanticRankResult {
	const { params } = input

	const fused = rrfMerge(input.lists, params.rrfK)
	const normalised = normaliseToTop(fused)
	const boosted = priorityBoost(
		recencyBoost(normalised, input.messageOrder ?? [], params),
		input.priorityBonus
	)

	const { kept: aboveThreshold, threshold } = adaptiveThreshold(
		boosted,
		params
	)

	// The matrix is indexed against the fused set, and the threshold has just
	// removed some of it — so MMR is given the surviving rows under their
	// original indices rather than a renumbered matrix nobody could check.
	const indexOf = new Map(fused.map((c, i) => [keyOf(c), i]))
	const reranked = input.similarity
		? mmrRerank(
				aboveThreshold,
				remapSimilarity(input.similarity, aboveThreshold, indexOf),
				params.mmrLambda
			)
		: [...aboveThreshold].sort((a, b) => b.score - a.score)

	const { kept, dropped } = perSourceBudget(reranked, params)

	return {
		candidates: kept,
		diagnostics: {
			fused: fused.length,
			threshold,
			belowThreshold: boosted.length - aboveThreshold.length,
			overBudget: dropped.length,
			kept: kept.length
		}
	}
}

/** Project the fused-set matrix onto the surviving subset, in its own order. */
function remapSimilarity(
	similarity: SimilarityMatrix,
	subset: readonly RagCandidate[],
	indexOf: Map<string, number>
): SimilarityMatrix {
	const rows = subset.map((c) => indexOf.get(keyOf(c)) ?? -1)
	return rows.map((r) =>
		rows.map((c) => (r < 0 || c < 0 ? 0 : (similarity[r]?.[c] ?? 0)))
	)
}

/**
 * Concatenate several windows' results, first occurrence winning.
 *
 * **Not a fusion.** The current window and the recent window each run the whole
 * arm — fuse, boost, threshold, diversify, cap — and their outputs are then
 * appended in order, dropping anything already seen. It reads like something
 * RRF should handle and it is deliberately not:
 *
 * - the windows are *ranked against each other by construction*. What is being
 *   said now outranks what was being said a moment ago, always, and fusing
 *   would let a strong second-window match displace a weaker current one;
 * - each window has already had a threshold applied *relative to its own top
 *   result*, so their scores are no longer on a shared scale — fusing them
 *   would be the exact mistake the fusion inside each window exists to avoid.
 *
 * The first version of this module fused the two windows into one call. The
 * shape was right and the composition was wrong, which is the kind of error
 * that produces plausible output and no failure anywhere.
 */
export function mergeWindows(
	windows: ReadonlyArray<readonly RagCandidate[]>
): RagCandidate[] {
	const seen = new Set<string>()
	const merged: RagCandidate[] = []
	for (const window of windows)
		for (const candidate of window) {
			const key = keyOf(candidate)
			if (seen.has(key)) continue
			seen.add(key)
			merged.push(candidate)
		}
	return merged
}
