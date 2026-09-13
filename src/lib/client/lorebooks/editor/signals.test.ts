/**
 * The Read in? test, said as one sentence.
 *
 * The test answers about one entry against one conversation, so the sentence
 * states the verdict first and the arithmetic after it — and every clause of
 * that arithmetic is optional, because the answer carries the figures the run
 * recorded and no others. A clause with nothing behind it is left out rather
 * than written as a zero.
 */
import { describe, expect, it } from "vitest"
import { signalFactsFrom, signalsResult } from "./signals"

describe("signalsResult — would be read in", () => {
	it("states the verdict, the match, the scores and the budget", () => {
		expect(
			signalsResult({
				read: true,
				rank: 2,
				of: 12,
				matched: "umber",
				inMessage: 3,
				lexical: 0.81,
				semantic: 0.64,
				tokens: 218,
				budget: 900,
				headroom: 4
			})
		).toBe(
			"Would be read in, rank 2 of 12 · Matched umber in message 3 · " +
				"lexical 0.81 · semantic 0.64 · Within budget, 218 of 900 tokens, " +
				"4 entries ahead of the ceiling"
		)
	})

	it("says only the verdict when the run recorded nothing else", () => {
		expect(signalsResult({ read: true })).toBe("Would be read in")
	})

	it("names one score without inventing the other", () => {
		expect(signalsResult({ read: true, lexical: 0.81 })).toBe(
			"Would be read in · lexical 0.81"
		)
	})

	it("says the tokens without a ceiling nobody recorded", () => {
		expect(signalsResult({ read: true, tokens: 218 })).toBe(
			"Would be read in · Within budget, 218 tokens"
		)
	})
})

describe("signalsResult — would not be read in", () => {
	it("always arrives with a reason", () => {
		expect(
			signalsResult({ read: false, reason: "it is switched off" })
		).toBe("Would not be read in · it is switched off")
	})

	it("keeps the scores that were measured on the way to the no", () => {
		expect(
			signalsResult({
				read: false,
				lexical: 0.12,
				reason: "the budget was full before it got there"
			})
		).toBe(
			"Would not be read in · the budget was full before it got there · " +
				"lexical 0.12"
		)
	})
})

/**
 * The board's figures come out of the turn's own account of itself.
 *
 * ⚠ **A rank is a place among the entries the turn judged**, and a budget line
 * is a share of what the turn was given — neither exists in a payload carrying
 * one entry's row, which is why the board asks for the whole explanation.
 */
describe("signalFactsFrom — the turn, as facts", () => {
	type Explanation = NonNullable<
		Sockets.Pipelines.RunExplain.Response["explanation"]
	>

	const explanation = (over: Partial<Explanation> = {}): Explanation => ({
		rows: [],
		bands: [],
		notes: [],
		warnings: [],
		ranked: true,
		omitted: 0,
		...over
	})

	const row = (
		over: Partial<Sockets.Pipelines.RetrievalRow>
	): Sockets.Pipelines.RetrievalRow => ({
		key: "worldLore:4",
		id: 4,
		source: "worldLore",
		sourceLabel: "World lore",
		title: "Umber City",
		outcome: "included",
		verdict: "It fitted the budget.",
		marker: "keyword",
		markerKind: "keyword",
		criteria: [],
		...over
	})

	/** Twelve judged entries, with the one being asked about second best. */
	const twelve = () =>
		explanation({
			rows: [
				row({ key: "worldLore:1", id: 1, score: 0.9 }),
				row({ key: "worldLore:4", id: 4, score: 0.8 }),
				...Array.from({ length: 10 }, (_, i) =>
					row({
						key: `worldLore:${20 + i}`,
						id: 20 + i,
						score: 0.7 - i / 100,
						outcome: "excluded"
					})
				)
			]
		})

	it("says where the turn ranked it, and out of how many", () => {
		const facts = signalFactsFrom(twelve(), { entryId: 4, enabled: true })
		expect(facts).toEqual(
			expect.objectContaining({ read: true, rank: 2, of: 12 })
		)
		expect(signalsResult(facts)).toBe("Would be read in, rank 2 of 12")
	})

	it("reads an included row as a yes", () => {
		expect(
			signalFactsFrom(explanation({ rows: [row({})] }), {
				entryId: 4,
				enabled: true
			}).read
		).toBe(true)
	})

	it("reads an excluded row as a no, with the run's own reason", () => {
		const facts = signalFactsFrom(
			explanation({
				rows: [
					row({
						outcome: "excluded",
						verdict: "The budget was full before it got there."
					})
				]
			}),
			{ entryId: 4, enabled: true }
		)
		expect(facts.read).toBe(false)
		expect(facts.reason).toBe("The budget was full before it got there.")
	})

	it("separates the two scores by what the criterion measured", () => {
		const facts = signalFactsFrom(
			explanation({
				rows: [
					row({
						criteria: [
							{
								label: "Its keys",
								detail: "matched “umber” in the scanned messages",
								value: 0.81
							},
							{
								label: "Similar in meaning",
								detail: "it is about what the conversation is about",
								value: 0.64
							}
						],
						tokens: 218
					})
				],
				budget: { headline: "World lore", used: 218, total: 900 }
			}),
			{ entryId: 4, enabled: true }
		)
		expect(facts).toEqual(
			expect.objectContaining({
				lexical: 0.81,
				semantic: 0.64,
				matched: "umber",
				tokens: 218,
				budget: 900
			})
		)
	})

	it("says how much room the band had left, where one was recorded", () => {
		const bands = (cap: number) => [
			{
				source: "worldLore",
				label: "World lore",
				allocated: 900,
				used: 218,
				entries: 4,
				cap,
				dropped: 0
			}
		]
		expect(
			signalFactsFrom(explanation({ rows: [row({})], bands: bands(8) }), {
				entryId: 4,
				enabled: true
			}).headroom
		).toBe(4)
		// A cap of 0 is a band that recorded no ceiling, never a full one.
		expect(
			signalFactsFrom(explanation({ rows: [row({})], bands: bands(0) }), {
				entryId: 4,
				enabled: true
			}).headroom
		).toBeUndefined()
	})

	it("says a switched-off entry is switched off rather than unranked", () => {
		expect(
			signalFactsFrom(explanation(), { entryId: 4, enabled: false })
				.reason
		).toBe("it is switched off")
	})

	it("distinguishes a turn that ranked nothing from an entry nobody offered", () => {
		expect(
			signalFactsFrom(explanation(), { entryId: 4, enabled: true }).reason
		).toBe("nothing reported on it")
		expect(
			signalFactsFrom(explanation({ ranked: false }), {
				entryId: 4,
				enabled: true
			}).reason
		).toBe("this turn ranked nothing at all")
	})
})
