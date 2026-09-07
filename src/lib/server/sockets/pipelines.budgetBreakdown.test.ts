/**
 * What is eating the budget — `explainRetrieval`'s band breakdown (T1).
 *
 * Pure, and asserted against hand-written receipts for the same reason the
 * retrieval projection's own test is: the whole point of `explainRetrieval`
 * taking its entries as an argument is that "what does this receipt mean" can
 * be answered without a database, a run, or a pipeline.
 *
 * What is pinned here is the part that would go wrong quietly. A breakdown
 * that stated a share against the wrong denominator, counted one entry twice
 * because two gather branches both admitted it, or invented a ceiling for a
 * run that halted before assembly would still render a full-looking table —
 * and a table is precisely what a reader will believe. Every assertion below
 * is a sentence or a figure somebody would otherwise act on.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("$lib/server/db", () => ({
	db: {},
	getCryptoSecretKey: () => "budget-breakdown-test-secret"
}))

async function explain(r: any) {
	const { explainRetrieval } = await import("./pipelines")
	return explainRetrieval(r, new Map(), { entriesRead: false })
}

/** One decision, at the granularity the ranker publishes them. */
const decision = (
	id: number,
	source: string,
	tokens: number,
	included = true
) => ({
	candidate: {
		id,
		source,
		tokens,
		signals: { keyword: 1 },
		payload: { name: `#${id}` }
	},
	score: 1,
	reason: included ? "filled_scored" : "excluded_budget",
	included,
	why: `scored 1.000, ${tokens} tokens`
})

const rankNode = (decisions: any[], groups: any = {}) => ({
	nodeKey: "rank",
	seq: 1,
	output: { decisions, groups }
})

/** Assemble's own node, which is where the ceiling is recorded. */
const assembleNode = (total: number, used: number) => ({
	nodeKey: "assemble",
	seq: 2,
	output: {
		budget: { total, used, remaining: Math.max(0, total - used) }
	}
})

describe("explainRetrieval — the budget, said before it is tabulated", () => {
	it("names the band taking the room, and states the share of what retrieval spent", async () => {
		const out = await explain({
			nodes: [
				rankNode(
					[
						decision(1, "worldLore", 600),
						decision(2, "history", 200),
						decision(3, "messages", 200)
					],
					{
						worldLore: {
							allocated: 800,
							used: 600,
							entries: 1,
							cap: 8
						},
						history: {
							allocated: 400,
							used: 200,
							entries: 1,
							cap: 4
						},
						messages: {
							allocated: 400,
							used: 200,
							entries: 1,
							cap: 20
						}
					}
				)
			]
		})
		// The finding first, the figure second — the same rule the rows follow.
		expect(out.budget!.headline).toBe(
			"World lore is taking most of the retrieved context — 60% of its 1000 tokens."
		)
		// ⚠ "the retrieved context", never "the prompt". The system prompt, the
		// persona and the instructions sit outside every one of these bands, so
		// a share stated against the prompt would be a bigger claim than the
		// receipt can support.
		expect(out.budget!.headline).not.toMatch(/your prompt|of the prompt/)
		expect(out.budget!.used).toBe(1000)
	})

	it("puts the same arithmetic on every band, as a share of one whole", async () => {
		const out = await explain({
			nodes: [
				rankNode(
					[
						decision(1, "worldLore", 750),
						decision(2, "history", 250)
					],
					{
						worldLore: {
							allocated: 800,
							used: 750,
							entries: 1,
							cap: 8
						},
						history: {
							allocated: 400,
							used: 250,
							entries: 1,
							cap: 4
						}
					}
				)
			]
		})
		const world = out.bands.find((b) => b.source === "worldLore")!
		const history = out.bands.find((b) => b.source === "history")!
		expect(world.share).toBeCloseTo(0.75, 5)
		expect(history.share).toBeCloseTo(0.25, 5)
		expect(world.share! + history.share!).toBeCloseTo(1, 5)
	})

	it("says “the largest share” rather than “most” when no band has half", async () => {
		const out = await explain({
			nodes: [
				rankNode(
					[
						decision(1, "worldLore", 400),
						decision(2, "history", 350),
						decision(3, "messages", 250)
					],
					{
						worldLore: {
							allocated: 0,
							used: 400,
							entries: 1,
							cap: 0
						},
						history: {
							allocated: 0,
							used: 350,
							entries: 1,
							cap: 0
						},
						messages: {
							allocated: 0,
							used: 250,
							entries: 1,
							cap: 0
						}
					}
				)
			]
		})
		expect(out.budget!.headline).toBe(
			"World lore is taking the largest share of the retrieved context — 40% of its 1000 tokens."
		)
	})

	it("sums the per-item token counts when the ranker recorded no groups", async () => {
		// The counts are on every decision; `groups` is the ranker's own
		// ledger of the same numbers and a receipt can reach here without it.
		// A breakdown that needed the ledger would report nothing at all.
		const out = await explain({
			nodes: [
				rankNode([
					decision(1, "worldLore", 300),
					decision(2, "worldLore", 100),
					decision(3, "history", 100),
					decision(4, "history", 500, false)
				])
			]
		})
		const world = out.bands.find((b) => b.source === "worldLore")!
		expect(world.used).toBe(400)
		expect(world.entries).toBe(2)
		// The excluded 500 never occupied the prompt and is not in the total.
		expect(out.budget!.used).toBe(500)
		expect(out.budget!.headline).toBe(
			"World lore is taking most of the retrieved context — 80% of its 500 tokens."
		)
	})

	it("counts an entry once when two gather branches both admitted it", async () => {
		// Two branches can decide the same row; it occupies the prompt once.
		// Counting it twice would make one band look like it was eating room
		// it never took, which is the whole figure this panel exists to state.
		const out = await explain({
			nodes: [
				{
					nodeKey: "rank-lore",
					seq: 1,
					output: { decisions: [decision(1, "worldLore", 400)] }
				},
				{
					nodeKey: "rank-vector",
					seq: 2,
					output: {
						decisions: [
							decision(1, "worldLore", 400),
							decision(9, "history", 100)
						]
					}
				}
			]
		})
		expect(out.budget!.used).toBe(500)
		expect(out.bands.find((b) => b.source === "worldLore")!.used).toBe(400)
	})

	it("reads the ceiling off assemble rather than inventing one from the bands", async () => {
		const out = await explain({
			nodes: [
				rankNode([decision(1, "worldLore", 600)], {
					worldLore: { allocated: 800, used: 600, entries: 1, cap: 8 }
				}),
				assembleNode(2000, 600)
			]
		})
		expect(out.budget!.total).toBe(2000)
		expect(out.budget!.remaining).toBe(1400)
		expect(out.budget!.detail).toBe(
			"The retrieved context filled 600 of the 2000 tokens set aside for it, leaving 1400 spare."
		)
	})

	it("says nothing about a ceiling on a run that never reached assembly", async () => {
		// ⚠ A ceiling summed from `allocated` would report every halted run as
		// exactly full, which is a claim about the context window nobody made.
		const out = await explain({
			nodes: [
				rankNode([decision(1, "worldLore", 600)], {
					worldLore: { allocated: 800, used: 600, entries: 1, cap: 8 }
				})
			]
		})
		expect(out.budget!.total).toBeUndefined()
		expect(out.budget!.remaining).toBeUndefined()
		expect(out.budget!.detail).toBeUndefined()
		expect(out.budget!.used).toBe(600)
	})

	it("tells “nothing was recorded” apart from “nothing was retrieved”", async () => {
		// A compacted receipt, or a halt before retrieval, recorded no budget
		// at all — and an empty breakdown there reads as "nothing came in"
		// when the truth is "nothing was written down". That is the
		// distinction `ranked` already exists for, and it is answered with
		// silence.
		const nothingRecorded = await explain({ compact: true })
		expect(nothingRecorded.budget).toBeUndefined()
		expect(nothingRecorded.ranked).toBe(false)

		// A run that ranked and admitted nothing is the other case, and it has
		// a finding to state rather than a silence to keep.
		const nothingAdmitted = await explain({
			nodes: [
				rankNode([decision(1, "worldLore", 900, false)], {
					worldLore: { allocated: 800, used: 0, entries: 0, cap: 8 }
				})
			]
		})
		expect(nothingAdmitted.ranked).toBe(true)
		expect(nothingAdmitted.budget!.headline).toBe(
			"Nothing retrieved reached this prompt, so no source is using any of its room."
		)
		expect(nothingAdmitted.budget!.used).toBe(0)
		// A share of nothing is a division that did not happen, not a zero.
		expect(nothingAdmitted.bands.every((b) => b.share === undefined)).toBe(
			true
		)
	})

	it("reports a band that spent nothing as spending nothing, not as absent", async () => {
		const out = await explain({
			nodes: [
				rankNode([decision(1, "worldLore", 500)], {
					worldLore: {
						allocated: 800,
						used: 500,
						entries: 1,
						cap: 8
					},
					characterLore: { allocated: 0, used: 0, entries: 0, cap: 4 }
				})
			]
		})
		const character = out.bands.find((b) => b.source === "characterLore")!
		expect(character.share).toBe(0)
		expect(out.budget!.headline).toBe(
			"World lore is the only thing retrieval put in this prompt — 500 tokens."
		)
	})
})
