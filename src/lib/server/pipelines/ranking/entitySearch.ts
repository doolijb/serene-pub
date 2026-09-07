/**
 * The third mechanism — `core:query/entity-search@1` (design §13.5).
 *
 * Given what the current window names, find the rows that name the same things.
 * A peer of the keyword and vector mechanisms rather than a signal bolted onto one,
 * which is plan Part 5's ruling: *"independent strategies that each query and
 * rank, then pass results down the pipe"*.
 *
 * Three consequences make it worth building properly:
 *
 *  1. **It is the mechanism keyless books work by.** Entity evidence is what
 *     admits an entry no author indexed — §4's whole argument, here as a source
 *     of candidates rather than as a gate inside another mechanism.
 *  2. **It searches messages**, which nothing else does. The vector mechanism is
 *     unwired on the shipped spec and the keyword mechanism only scans a bounded
 *     window for triggers, so this is the first retrieval over conversation
 *     history in the product.
 *  3. **It is deterministic and free.** No embedding model, no network — §11's
 *     zero-cost constraint holds outright.
 *
 * Nothing here reads a table. It takes the window's entities, the annotations
 * of a pool, and returns scores; `server/annotations` does the IO.
 *
 * ## Rarity comes from the entry pool, never from the messages
 *
 * Design §13.8, measured rather than reasoned. Taking idf over the conversation
 * is the intuitive move and it fails badly: on a short session nearly every word
 * appears once and therefore looks rare, so an entry about a pewterers' guild
 * scored as much shared vocabulary as the faction the scene was actually about,
 * on the strength of *"of"*, *"with"* and *"long"*. Rarity is a property of the
 * collection being searched, not of the query — so the message side is scored
 * with the **entries'** document frequencies too, not with its own.
 *
 * A consequence worth stating: a session whose lorebook has no entries has no
 * rarity information at all, so every candidate scores 0. That is the honest
 * answer — with nothing to compare against, no entity is more telling than
 * another — and it is what `buildEvidenceProfile` already does with an empty
 * pool.
 *
 * ## Noisy-or, and it is the same arithmetic the admission gate uses
 *
 * §13.8 again: combining evidence as a weighted sum leaves whichever term got
 * the smaller share unable to admit anything by itself, which put the
 * mechanism's own purpose out of reach. The saturating form below,
 * `1 - exp(-mass / reference)`, **is** a noisy-or — expanding it gives
 * `1 - Π exp(-rᵢ / reference)`, one independent piece of evidence per shared
 * entity — and it is the identical expression `evidence()` uses for its entity
 * term, so the mechanism and the gate cannot drift into disagreeing about the same
 * two rows.
 *
 * ## Sizing, deliberately (§13.10)
 *
 * Grading compresses what it adds: the term saturates near 0.63 for one rare
 * shared entity and 0.86 for two, so inherited at the lore band's
 * `entityCooccurrence` weight of 0.2 its live range would be about
 * `[0.13, 0.17]` where the binary signal it improves on spanned `{0, 0.2}` — more
 * correct and less influential at once. So this mechanism carries **its own weight**,
 * `DEFAULT_ENTITY_WEIGHT`, and the band's `entityCooccurrence` weight is left
 * alone for the keyword mechanism that parity pins.
 */

import { rarity, type Entity } from "$lib/server/pipelines/ranking/entities"
import { score, type Signals } from "$lib/server/pipelines/ranking/select"
import type {
	SignalWeights,
	RetrievalBand
} from "$lib/server/pipelines/ranking/weights"

/**
 * What one shared entity is worth, before the graded term compresses it.
 *
 * Anchored to `keyword`'s 0.35 rather than to `entityCooccurrence`'s 0.2, and
 * the anchor is the argument: *one thing the conversation is naming that not
 * every entry names* is about as much evidence as *one of this entry's authored
 * keys appearing*. The saturation then keeps it strictly below a full keyword
 * match — 0.22 for one rare shared entity, 0.30 for two, against 0.35 for an
 * entry whose every key fired — so **keys still guarantee and evidence still
 * only adds**, which is §4.1's whole promise, now expressed in the score
 * instead of only in the gate.
 *
 * Declared on the node as `entityWeight` so an install can move it; this is the
 * default, not a constant.
 */
export const DEFAULT_ENTITY_WEIGHT = 0.35

/**
 * Bands this mechanism puts candidates in that **no entry type declares**.
 *
 * ⚠ `sourceKind` totality, and the failure it guards is silent. The weight and
 * share maps are total over a closed union, so a mechanism emitting a band those maps
 * do not carry has its candidates scored against `undefined` and dropped — with
 * a green suite and nothing in the receipt. That is not hypothetical: history
 * was absent from every prompt between spec 1.8.0 and 1.10.0 exactly this way.
 *
 * `assertEntryDeclarations` already refuses the boot for a declared *entry type*
 * naming a band that does not exist, and this mechanism's lore candidates take their
 * band straight off that same declaration (`bandOfType`), so they are covered
 * by construction. `messages` is the one band this mechanism claims that no entry type
 * does — it is the transcript, which is not an entry — so it is named here and
 * checked by the same assertion rather than by a second one.
 */
export const RETRIEVAL_MECHANISM_BANDS: ReadonlyArray<{
	mechanism: string
	sourceKind: string
}> = [{ mechanism: "core:query/entity-search@1", sourceKind: "messages" }]

/** Per entity key, how many entries of the pool name it. */
export function entityDocFreq(
	pool: Iterable<readonly string[]>
): Map<string, number> {
	const df = new Map<string, number>()
	for (const keys of pool)
		for (const key of new Set(keys)) df.set(key, (df.get(key) ?? 0) + 1)
	return df
}

export interface EntityRarity {
	/** Per entity, `log((E + 1) / (df + 0.5))` over the entry pool. */
	weightOf: ReadonlyMap<string, number>
	/**
	 * The rarity of a thing exactly one entry names — the unit the score counts
	 * in.
	 *
	 * Absolute rather than a mean over what happens to be present, for
	 * `EvidenceProfile.referenceEntityRarity`'s reason: a mean makes the scale
	 * move with the pool, so a scene naming one thing every entry also names
	 * would divide by its own near-zero rarity and score full marks for the
	 * entity carrying the least information in the room.
	 */
	reference: number
}

/**
 * Rarity over the pool being searched.
 *
 * `entryCount` is the number of entries the pool holds, including those naming
 * nothing: an entity absent from every entry is not made rarer by there being
 * more entries it is absent from, but the collection size is what "rare" is
 * measured against and leaving silent entries out would shrink it dishonestly.
 */
export function entityRarity(
	docFreq: ReadonlyMap<string, number>,
	entryCount: number
): EntityRarity {
	const weightOf = new Map<string, number>()
	if (entryCount <= 0) return { weightOf, reference: 0 }
	for (const [key, df] of docFreq) weightOf.set(key, rarity(df, entryCount))
	return { weightOf, reference: rarity(1, entryCount) }
}

/**
 * How much evidence the shared entities are, in `[0, 1]`.
 *
 * Saturating, because naming two of the things under discussion is already as
 * much as this can say and a third proves nothing further — and an entity every
 * entry mentions has a rarity near zero and contributes almost nothing, which is
 * how the narrator's own name stops deciding anything.
 */
export function entityEvidence(
	shared: readonly string[],
	rarities: EntityRarity
): number {
	if (rarities.reference <= 0) return 0
	let mass = 0
	for (const key of new Set(shared)) mass += rarities.weightOf.get(key) ?? 0
	if (mass <= 0) return 0
	return 1 - Math.exp(-mass / rarities.reference)
}

/** One row the mechanism found, and why. */
export interface EntityHit<Id extends number | string = number> {
	id: Id
	source: RetrievalBand
	/** The distinct entities it shares with the window. */
	shared: string[]
	/** The graded, rarity-weighted overlap in `[0, 1]`. */
	evidence: number
	/** What `select` will rank it by — see the sizing note above. */
	score: number
}

export interface EntitySearchInput<Id extends number | string = number> {
	/** What the recent window named, in the pool's own vocabulary. */
	entities: readonly Entity[]
	/** The searchable rows: their identity, band, and the entities they name. */
	pool: ReadonlyArray<{
		id: Id
		source: RetrievalBand
		keys: readonly string[]
		/** `priority` on a lore entry; 1 means no bonus. */
		priority?: number
	}>
	/**
	 * The document frequencies rarity is taken over, and the size of that
	 * collection — **the entries, never the messages** (§13.8).
	 */
	rarities: EntityRarity
	/** Per band, so the priority bonus is the one the ranker would apply. */
	signalWeights: Record<RetrievalBand, SignalWeights>
	/** This mechanism's own strength. `DEFAULT_ENTITY_WEIGHT` unless told otherwise. */
	entityWeight?: number
}

/**
 * The rows that share an entity with the window, scored.
 *
 * Only rows sharing at least one are returned: a mechanism that returns everything
 * with a zero beside it is a pool, not a search, and `select` already has a way
 * of saying "nothing scored here".
 *
 * The score is `score()`'s own arithmetic with one weight substituted — the
 * mechanism's `entityWeight` in place of the band's `entityCooccurrence` — so a
 * candidate from here and a candidate from the keyword mechanism are on one scale,
 * and the priority bonus is applied by exactly the rule that applies it
 * elsewhere (absent priority means no bonus, never "absent means 1").
 */
export function entitySearch<Id extends number | string = number>(
	input: EntitySearchInput<Id>
): Array<EntityHit<Id>> {
	const wanted = new Set(input.entities.map((e) => e.key))
	if (wanted.size === 0) return []
	const entityWeight = input.entityWeight ?? DEFAULT_ENTITY_WEIGHT

	const out: Array<EntityHit<Id>> = []
	for (const row of input.pool) {
		const shared = [...new Set(row.keys)].filter((k) => wanted.has(k))
		if (shared.length === 0) continue
		const evidence = entityEvidence(shared, input.rarities)
		if (evidence <= 0) continue
		const signals: Signals = { entityCooccurrence: evidence }
		const weights = input.signalWeights[row.source]
		/**
		 * ⚠ A band the weight map does not carry is dropped, not scored.
		 *
		 * `score()` multiplies eight named weights, so a missing set makes
		 * every term `undefined * 0` — **NaN**, which sorts unpredictably and
		 * poisons `select`'s comparison rather than failing. `select` excludes
		 * such a candidate with `excluded_unknown_source`; this mechanism should not
		 * hand it one in the first place. `RETRIEVAL_MECHANISM_BANDS` and the boot
		 * assertion are what make this unreachable — this is the belt.
		 */
		if (!weights) continue
		out.push({
			id: row.id,
			source: row.source,
			shared,
			evidence,
			score: score(
				signals,
				{ ...weights, entityCooccurrence: entityWeight },
				row.priority ?? 1
			)
		})
	}
	// Best first, id ascending inside a tie: the cap downstream has to be
	// deterministic, or two runs over one session disagree about what was found.
	return out.sort(
		(a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id))
	)
}
