/**
 * The relationship mechanism's ordering: presence, then speaker, then recency.
 *
 * ⚠ **Lexicographic, and the arithmetic is what enforces it.** The ruling
 * (2026-09-10, Q1) is an order of questions, not a blend of three opinions —
 * *is the scene present for this*, then *is it the speaker's own*, then *how
 * recently did it change* — and the difference shows up in exactly the case a
 * happy-path fixture misses: the speaker's own tie, changed a minute ago, to
 * somebody who is not in the chat. Under any weighting where the lower terms
 * can outvote the higher one, that outranks a present bystander's decade-old
 * tie, and "presence first" quietly means "presence mostly".
 *
 * So the weights below are **sized to separate the bands**, not tuned:
 *
 *     0.6 · presence + 0.3 · speaker + 0.1 · recency,  recency ∈ (0, 1]
 *
 * `0.3 + 0.1 < 0.6` and `0.1 < 0.3`, so each term strictly dominates
 * everything under it, at every value either can take. Written as one number
 * rather than as a comparator because it leaves the node with a single
 * `presetScore` the ranker already knows what to do with — see
 * `core:query/relationship-search@1`'s binding — and because a receipt can then state the terms behind a number a
 * reader is looking at.
 *
 * ## Why recency is a rank and not an age
 *
 * `recency` is the row's **position** among the ties this turn walked, not its
 * age in hours. A half-life would need a constant nobody has an opinion about
 * and would make the same graph rank differently on Tuesday; a rank is stable,
 * needs no clock, and answers the question the ruling asks — *which of these
 * changed most recently* — exactly. It never reaches 0, so an old tie still
 * outranks nothing rather than being indistinguishable from an absent term.
 *
 * Ties in the timestamp — a rebuild writes a whole graph in one transaction, so
 * they are the common case — fall to the row id, which makes a replay of the
 * same turn produce the same order however the database returned the rows.
 */

/** What the ranking needs to know about one relationship, and nothing else. */
export interface RelationshipRankRow {
	/** `narrative_relationships.id`, and the deterministic tie-break. */
	id: number
	/** Somebody other than the speaker on this tie is in the session's cast. */
	present: boolean
	/** The speaking character is party to this tie. */
	touchesSpeaker: boolean
	/** When the row last changed, as epoch milliseconds. */
	updatedAt: number
}

/** What decided a row's place, as the receipt states it. */
export interface RelationshipRankReasons {
	present: boolean
	touchesSpeaker: boolean
	/** 1 is the most recently changed tie this turn walked. */
	recencyRank: number
	/** How many were walked, so the rank reads as "3rd of 11". */
	of: number
}

/**
 * The three weights, exported so a test can assert the domination rule rather
 * than re-typing the numbers it depends on.
 */
export const PRESENCE_WEIGHT = 0.6
export const SPEAKER_WEIGHT = 0.3
export const RECENCY_WEIGHT = 0.1

export type Ranked<T> = T & {
	/** The weighted sum above — what the query publishes as `presetScore`. */
	score: number
	rank: RelationshipRankReasons
	/** Its index in this result, which is `select`'s own tie-break. */
	position: number
}

/**
 * Order the ties, newest-first within each band.
 *
 * Pure and total: an empty graph ranks to an empty list, which is what an
 * install that never opened the narrative graph has.
 */
export function rankRelationships<T extends RelationshipRankRow>(
	rows: readonly T[]
): Ranked<T>[] {
	const of = rows.length
	if (of === 0) return []

	// The recency ordering, computed once. `id` ascending behind the timestamp
	// is the whole of the determinism claim — see the file header.
	const byRecency = [...rows].sort(
		(a, b) => b.updatedAt - a.updatedAt || a.id - b.id
	)
	const recencyRankOf = new Map<number, number>(
		byRecency.map((r, i) => [r.id, i + 1])
	)

	const scored = rows.map((row) => {
		const recencyRank = recencyRankOf.get(row.id) ?? of
		// (of - rank + 1) / of: 1 for the newest, 1/of for the oldest, never 0.
		const recency = (of - recencyRank + 1) / of
		return {
			row,
			recencyRank,
			score:
				(row.present ? PRESENCE_WEIGHT : 0) +
				(row.touchesSpeaker ? SPEAKER_WEIGHT : 0) +
				RECENCY_WEIGHT * recency
		}
	})

	// Score decides; the recency rank breaks a tie, and it already carries the
	// id, so nothing here depends on the order the rows arrived in.
	scored.sort((a, b) => b.score - a.score || a.recencyRank - b.recencyRank)

	return scored.map(({ row, recencyRank, score }, position) => ({
		...row,
		score,
		rank: {
			present: row.present,
			touchesSpeaker: row.touchesSpeaker,
			recencyRank,
			of
		},
		position
	}))
}

/**
 * The ceiling, in the vocabulary the two relationship queries already use.
 *
 * `undefined` and any negative number mean **no ceiling**, and `0` means leave
 * the section out altogether — the same three states `capRelationships` reads and
 * the same ones `relationshipSlots` declares, restated here rather than shared
 * because that function caps a keyed *section* and this caps a ranked list.
 * Counted in relationships, so a pair with three separate ties spends three.
 */
export function capRanked<T>(ranked: readonly T[], maxEntries: unknown): T[] {
	const cap = typeof maxEntries === "number" ? maxEntries : undefined
	if (cap === undefined || cap < 0) return [...ranked]
	if (cap === 0) return []
	return ranked.slice(0, cap)
}
