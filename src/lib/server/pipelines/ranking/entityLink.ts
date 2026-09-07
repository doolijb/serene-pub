/**
 * Mention → name linking — the fourth mechanism's arithmetic (retrieval plan phase 4).
 *
 * The scene said *"the captain"*; an entry is called *"Captain Vell"*. Neither
 * shares a character with the other in any way the lexical stack can see — no
 * key matches, no trigram folds one onto the other, and the gazetteer has
 * nothing to look up — so this is the mechanism that closes that gap and the
 * only one that does.
 *
 * Nothing here touches a vector. The cosine pass runs host-side for the reason
 * `vector_search`'s does — an embedding is a few hundred floats, and putting
 * one on a data edge puts it in every downstream input and in the receipt — so
 * what arrives is already `(entry, mention, name, similarity)`. This decides
 * which of those survive, in what order, and what the receipt says about them.
 *
 * ## Ruling R4 — links **rank**, they do not gate
 *
 * There is no similarity threshold anywhere in this file, and that is the
 * ruling rather than an omission: a cutoff would need per-corpus calibration,
 * and *"is 0.62 a match"* has no answer that survives changing the encoder.
 * What bounds the mechanism instead is a **count** — `maxLinks` — over links ranked
 * by match quality and, as the tie-break, by how recently the mention was
 * said. R4's *"proximity and match quality"*, with proximity deliberately left
 * out of the *score*: scaling by mention age would reintroduce exactly the
 * calibrated constant the ruling removes.
 *
 * ## And a link is a score contribution, never an admission
 *
 * This is enforced by the wiring rather than asserted here, and it is worth
 * saying where: the mechanism is handed the candidates the other mechanisms already
 * produced and may only emit ids that were in that list. It cannot put an
 * entry in the prompt; it can only change where an entry that was already
 * competing comes in the order. A confident wrong link therefore costs a
 * reordering and a visible line in the receipt, never a block of wrong lore
 * arriving from nowhere — which is the trade the plan makes when it says a
 * confident wrong link is worse than a miss.
 *
 * ## Why the receipt line is not optional
 *
 * A keyword hit explains itself: the word is in the text. A vector link does
 * not — an entry appears higher and nothing on the page says why. So every
 * link carries its own sentence, *"matched “the captain” → Captain Vell"*, and
 * a wrong one is then something a reader can see and correct rather than lore
 * appearing for no reason.
 */

import type { EntityNameKind } from "./entityNames"

/** One `(entry, mention, name)` comparison the host measured. */
export interface EntityLinkHit {
	entryId: number
	/** The mention as the window wrote it. */
	mention: string
	/** The name it was compared against. */
	name: string
	nameKind: EntityNameKind
	/**
	 * `cos(mention, name)`, clamped to `[0, 1]`.
	 *
	 * Clamped rather than rescaled: a negative cosine is *less alike than
	 * unrelated*, which is not evidence of anything and must not subtract from
	 * a score — the plan's rule that adding a mechanism may only add matches,
	 * one construct down.
	 */
	score: number
	/** How far through the window the mention sat, `0` first and `1` last. */
	position: number
}

/**
 * The best link per entry, ranked, capped.
 *
 * One link per entry and not one per mention: the signal answers *"is this
 * entry the thing the scene is describing"*, which is a maximum over the
 * descriptions the scene used, not a sum over them. Summing would let an entry
 * win by being vaguely near five unrelated phrases.
 *
 * `maxLinks` is applied last, over the ranked list, so the cap keeps the best
 * links rather than the first-arrived. `0` returns nothing, which is the mechanism's
 * off state — the `admitThreshold` / `maxRecursionDepth` convention.
 */
export function rankEntityLinks(
	hits: readonly EntityLinkHit[],
	maxLinks: number
): EntityLinkHit[] {
	if (!(maxLinks > 0)) return []
	const best = new Map<number, EntityLinkHit>()
	for (const hit of hits) {
		if (!(hit.score > 0)) continue
		const seen = best.get(hit.entryId)
		// Ties keep the earlier hit, so the order the host measured in decides
		// — deterministic, which the cap below requires or two runs over one
		// session disagree about what was linked.
		if (!seen || hit.score > seen.score) best.set(hit.entryId, hit)
	}
	return [...best.values()]
		.sort(
			(a, b) =>
				b.score - a.score ||
				b.position - a.position ||
				a.entryId - b.entryId
		)
		.slice(0, maxLinks)
}

/**
 * The sentence a reader gets.
 *
 * Curly quotes because every other receipt line in this codebase uses them,
 * and the arrow because *"matched X → Y"* reads as a resolution in a way
 * *"matched X to Y"* does not.
 */
export const linkNote = (hit: EntityLinkHit): string =>
	`matched “${hit.mention}” → ${hit.name}`
