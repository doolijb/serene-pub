/**
 * The entity mechanism's arithmetic, with no database anywhere near it.
 *
 * Every assertion here is one of design §13.8's measured constraints written
 * down, because each of them contradicts the obvious choice and each was
 * arrived at by running a corpus rather than by reading code:
 *
 *   - rarity over the **entries**, never over the messages;
 *   - evidence combined as a **noisy-or**, never as a weighted sum;
 *   - the mechanism's own weight, because grading *compresses* what it adds (§13.10).
 */

import { describe, expect, it } from "vitest"
import {
	DEFAULT_ENTITY_WEIGHT,
	RETRIEVAL_MECHANISM_BANDS,
	entityDocFreq,
	entityEvidence,
	entityRarity,
	entitySearch
} from "$lib/server/pipelines/ranking/entitySearch"
import {
	DEFAULT_SIGNAL_WEIGHTS,
	type RetrievalBand
} from "$lib/server/pipelines/ranking/weights"
import type { Entity } from "$lib/server/pipelines/ranking/entities"

const named = (...keys: string[]): Entity[] =>
	keys.map((key) => ({
		key,
		text: key,
		tier: "gazetteer",
		count: 1,
		spans: []
	}))

/** Ten entries: one names the rare thing, every one of them names the common. */
const pool = new Map<number, string[]>([
	[1, ["entry:rare", "character:common"]],
	...Array.from(
		{ length: 9 },
		(_, i) => [i + 2, ["character:common"]] as [number, string[]]
	)
])
const rarities = entityRarity(entityDocFreq(pool.values()), pool.size)

const search = (
	entities: Entity[],
	rows: Array<{ id: number; source: RetrievalBand; priority?: number }>,
	entityWeight?: number
) =>
	entitySearch({
		entities,
		pool: rows.map((r) => ({ ...r, keys: pool.get(r.id) ?? [] })),
		rarities,
		signalWeights: DEFAULT_SIGNAL_WEIGHTS,
		entityWeight
	})

describe("rarity is a property of the pool being searched", () => {
	it("weighs a thing every entry names at almost nothing", () => {
		// Not zero — the smoothed form stays strictly positive so that "this
		// proves little" never becomes "this proves the opposite" when summed.
		const common = rarities.weightOf.get("character:common")!
		const rare = rarities.weightOf.get("entry:rare")!
		expect(common).toBeGreaterThan(0)
		expect(common).toBeLessThan(rare / 3)
	})

	it("scores an entry sharing only the common name near zero", () => {
		const [hit] = search(named("character:common"), [
			{ id: 5, source: "worldLore" }
		])
		expect(hit!.evidence).toBeLessThan(0.15)
	})

	it("scores an entry sharing the rare one strongly", () => {
		const [hit] = search(named("entry:rare"), [
			{ id: 1, source: "worldLore" }
		])
		expect(hit!.evidence).toBeGreaterThan(0.6)
	})

	it("has no scale at all when the pool is empty, and says so with a zero", () => {
		// A pool of nothing has no rarity information, so no entity is more
		// telling than another — the same answer `buildEvidenceProfile` gives.
		const none = entityRarity(new Map(), 0)
		expect(entityEvidence(["entry:rare"], none)).toBe(0)
	})
})

describe("evidence saturates rather than accumulating", () => {
	it("combines two shared entities as a noisy-or, not a sum", () => {
		const one = entityEvidence(["entry:rare"], rarities)
		const two = entityEvidence(["entry:rare", "character:common"], rarities)
		// Strictly more than either alone, and strictly less than their sum:
		// `1 - Π(1 - pᵢ)`, which is what keeps the result inside [0, 1] so a
		// threshold and a weight keep one meaning.
		expect(two).toBeGreaterThan(one)
		expect(two).toBeLessThan(
			one + entityEvidence(["character:common"], rarities)
		)
		expect(two).toBeLessThan(1)
	})

	it("counts a repeated entity once", () => {
		expect(
			entityEvidence(["entry:rare", "entry:rare"], rarities)
		).toBeCloseTo(entityEvidence(["entry:rare"], rarities), 12)
	})
})

describe("the mechanism sizes its own contribution", () => {
	it("scores on its own weight rather than on the band it lands in", () => {
		// §13.10, measured: the graded term saturates near 0.63 for one rare
		// shared entity, so at the band's original 0.2 its live range would
		// have been about [0.13, 0.17] — narrower than the {0, 0.2} of the
		// binary signal it improves on. Grading without re-weighting is more
		// correct and less influential at once.
		//
		// ⚠ **The band caught up.** World lore's `entityCooccurrence` weight is
		// 0.35 now, for this mechanism's exact reason: the keyword scan's own entity
		// signal became the same graded measure (plan phase 3) and was resized
		// with it, so the two agree by argument rather than by coincidence.
		// This still declares its own weight — the mechanism has to be sizeable
		// without moving a signal weight that also governs character lore's
		// unrelated presence question — and the assertions below say what that
		// weight buys rather than that it differs from a number that has since
		// moved.
		const [hit] = search(named("entry:rare"), [
			{ id: 1, source: "worldLore" }
		])
		expect(hit!.score).toBeCloseTo(
			hit!.evidence * DEFAULT_ENTITY_WEIGHT,
			10
		)
		// Sized above the band character lore uses for its own binary
		// presence signal, which is the weight the mechanism must *not* inherit.
		expect(DEFAULT_ENTITY_WEIGHT).toBeGreaterThan(
			DEFAULT_SIGNAL_WEIGHTS.characterLore.entityCooccurrence
		)
	})

	it("stays below a full keyword match, so keys still guarantee", () => {
		// The anchor the default is chosen against: one thing the conversation
		// is naming is worth about as much as one of an entry's own keys
		// firing, and the saturation keeps it strictly under.
		const [hit] = search(named("entry:rare"), [
			{ id: 1, source: "worldLore" }
		])
		expect(hit!.score).toBeLessThan(
			DEFAULT_SIGNAL_WEIGHTS.worldLore.keyword
		)
	})

	it("scores the messages band, which the shipped weights give a zero", () => {
		// The reason the weight is the mechanism's own rather than the band's:
		// `DEFAULT_SIGNAL_WEIGHTS.messages.entityCooccurrence` is 0, so a
		// candidate scored through the band would be inert in exactly the band
		// this mechanism exists to reach.
		expect(DEFAULT_SIGNAL_WEIGHTS.messages.entityCooccurrence).toBe(0)
		const [hit] = search(named("entry:rare"), [
			{ id: 1, source: "messages" }
		])
		expect(hit!.score).toBeGreaterThan(0)
	})

	it("a weight of zero leaves it finding things and ranking them last", () => {
		const [hit] = search(
			named("entry:rare"),
			[{ id: 1, source: "worldLore" }],
			0
		)
		expect(hit!.evidence).toBeGreaterThan(0)
		expect(hit!.score).toBe(0)
	})

	it("applies the author's priority bonus by the rule that applies it elsewhere", () => {
		const plain = search(named("entry:rare"), [
			{ id: 1, source: "worldLore", priority: 1 }
		])[0]!
		const boosted = search(named("entry:rare"), [
			{ id: 1, source: "worldLore", priority: 3 }
		])[0]!
		expect(boosted.score - plain.score).toBeCloseTo(
			2 * DEFAULT_SIGNAL_WEIGHTS.worldLore.priorityBonus,
			10
		)
	})

	it("gives history no priority bonus, because history declares no priority", () => {
		// ⚠ Absent means no bonus, never "absent means 1 and gets the bonus".
		// Enforced here by the band's own `priorityBonus: 0` rather than by a
		// branch, which is the same route `score()` takes.
		const plain = search(named("entry:rare"), [
			{ id: 1, source: "history", priority: 1 }
		])[0]!
		const boosted = search(named("entry:rare"), [
			{ id: 1, source: "history", priority: 3 }
		])[0]!
		expect(boosted.score).toBe(plain.score)
	})
})

describe("what the mechanism returns", () => {
	it("returns nothing when the window named nothing", () => {
		expect(search([], [{ id: 1, source: "worldLore" }])).toEqual([])
	})

	it("returns only rows that share an entity", () => {
		const hits = search(named("entry:rare"), [
			{ id: 1, source: "worldLore" },
			{ id: 2, source: "worldLore" }
		])
		expect(hits.map((h) => h.id)).toEqual([1])
	})

	it("orders best first and breaks ties deterministically", () => {
		// Two runs over one session that disagree about what the scene is about
		// are worse than either answer, so the tie-break is on identity.
		const hits = search(named("character:common"), [
			{ id: 4, source: "worldLore" },
			{ id: 2, source: "worldLore" },
			{ id: 3, source: "worldLore" }
		])
		expect(hits.map((h) => h.id)).toEqual([2, 3, 4])
	})

	it("names which entities carried a hit, for the receipt", () => {
		const [hit] = search(named("entry:rare", "character:common"), [
			{ id: 1, source: "worldLore" }
		])
		expect([...hit!.shared].sort()).toEqual([
			"character:common",
			"entry:rare"
		])
	})
})

describe("sourceKind totality", () => {
	it("declares every band the mechanism claims that no entry type does", () => {
		// ⚠ The failure this guards is silent: a band the weight and share maps
		// do not carry means candidates scored against `undefined` and dropped
		// with a green suite. `assertEntryDeclarations` refuses the boot over
		// this list; here it is checked against the map itself.
		for (const { sourceKind } of RETRIEVAL_MECHANISM_BANDS)
			expect(Object.keys(DEFAULT_SIGNAL_WEIGHTS)).toContain(sourceKind)
		expect(RETRIEVAL_MECHANISM_BANDS.map((b) => b.sourceKind)).toContain(
			"messages"
		)
	})
})
