/**
 * The Read in? test, said as one sentence.
 *
 * The test answers about one entry against one conversation, so the sentence
 * states the decision line first and the arithmetic after it — and every clause of
 * that arithmetic is optional, because the answer carries the figures the run
 * recorded and no others. A clause with nothing behind it is left out rather
 * than written as a zero.
 */
import { describe, expect, it } from "vitest"
import { GATE, readInFacts } from "./readIn"
import { signalFactsFrom, signalsResult } from "./signals"

describe("signalsResult — would be read in", () => {
	it("states the decision line, the match, the scores and the budget", () => {
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

	it("says only the decision line when the run recorded nothing else", () => {
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
			signalsResult({ read: false, decisionLine: "it is switched off" })
		).toBe("Would not be read in · it is switched off")
	})

	it("keeps the scores that were measured on the way to the no", () => {
		expect(
			signalsResult({
				read: false,
				lexical: 0.12,
				decisionLine: "the budget was full before it got there"
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

	/**
	 * Twelve entries read in, the one being asked about second best, and one
	 * more only weighed — which a rank never counts (L1).
	 */
	const twelve = () =>
		explanation({
			rows: [
				row({ key: "worldLore:1", id: 1, score: 0.9 }),
				row({ key: "worldLore:4", id: 4, score: 0.8 }),
				...Array.from({ length: 10 }, (_, i) =>
					row({
						key: `worldLore:${20 + i}`,
						id: 20 + i,
						score: 0.7 - i / 100
					})
				),
				row({
					key: "worldLore:40",
					id: 40,
					score: 0.1,
					outcome: "excluded"
				})
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
		expect(facts.decisionLine).toBe(
			"The budget was full before it got there."
		)
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

	const skipped = (reason: string, enabled?: boolean) =>
		row({
			outcome: "skipped",
			verdict: `Never reached the ranker — ${reason}.`,
			skipReason: reason,
			...(enabled === undefined
				? {}
				: {
						entry: {
							enabled
						} as Sockets.Pipelines.RetrievalRow["entry"]
					})
		})
	const lineOf = (
		explanationIn: Explanation,
		opts: {
			enabled?: boolean
			reading?: { off: boolean; pinned: boolean } | null
		} = {}
	) =>
		signalFactsFrom(explanationIn, { entryId: 4, enabled: true, ...opts })
			.decisionLine

	it("G1: a switched-off entry says so rather than unranked", () => {
		expect(lineOf(explanation(), { enabled: false })).toBe(
			"it is switched off"
		)
	})

	it("G2: archived", () => {
		expect(
			lineOf(explanation({ rows: [skipped("entry is archived")] }))
		).toBe("it is archived")
	})

	it("G3: off for a while, by the session's reading", () => {
		expect(
			lineOf(explanation(), { reading: { off: true, pinned: false } })
		).toBe("it is off for a while at this point in the story")
	})

	it("G3: off for a while, by a disabled skip with the base row on", () => {
		expect(
			lineOf(explanation({ rows: [skipped("entry is disabled")] }))
		).toBe("it is off for a while at this point in the story")
	})

	it("G4: a null reading names what null means", () => {
		const line = lineOf(explanation(), { reading: null })
		expect(line).toBe(GATE.notReadHere)
		expect(line).toContain("archived")
		// The line, clock and archived gates come before off.
		expect(lineOf(explanation(), { reading: null, enabled: false })).toBe(
			GATE.notReadHere
		)
	})

	it("off for a while: base on, reading off; switched off: base off, reading off", () => {
		const reading = { off: true, pinned: false }
		expect(lineOf(explanation(), { reading, enabled: true })).toBe(
			GATE.offForAWhile
		)
		expect(lineOf(explanation(), { reading, enabled: false })).toBe(
			GATE.off
		)
	})

	it("base off but on at the reading: the judged budget sentence stands", () => {
		const judged = explanation({
			rows: [
				row({
					outcome: "excluded",
					reason: "excluded_budget",
					verdict: "The budget was full before it got there."
				})
			]
		})
		for (const reading of [{ off: false, pinned: false }, undefined])
			expect(lineOf(judged, { enabled: false, reading })).toBe(
				"The budget was full before it got there."
			)
	})

	it("archived and off: archived comes first", () => {
		const ex = explanation({ rows: [skipped("entry is archived")] })
		expect(lineOf(ex, { enabled: false })).toBe("it is archived")
		expect(
			lineOf(ex, {
				enabled: false,
				reading: { off: true, pinned: false }
			})
		).toBe("it is archived")
	})

	it("reads the raw reason from the row, not from the verdict's wording", () => {
		const archived = row({
			outcome: "skipped",
			verdict: "Declined early: whatever.",
			skipReason: "entry is archived"
		})
		expect(lineOf(explanation({ rows: [archived] }))).toBe("it is archived")
		expect(
			readInFacts(4, explanation({ rows: [archived] })).decisionLine
		).toBe("it is archived")
		const old = row({
			outcome: "skipped",
			verdict: "Never reached the ranker — entry is archived."
		})
		expect(lineOf(explanation({ rows: [old] }))).toBeUndefined()
	})

	it("the line and the tab say the same sentence for one skipped row", () => {
		const cases: [string, boolean][] = [
			["entry is archived", true],
			["entry is disabled", true],
			["entry is disabled", false],
			["not visible to the current speaker", true],
			["no key matched in the last 4 messages", true]
		]
		for (const [reason, enabled] of cases) {
			const ex = explanation({ rows: [skipped(reason, enabled)] })
			expect(readInFacts(4, ex).decisionLine).toBe(
				signalFactsFrom(ex, { entryId: 4, enabled }).decisionLine
			)
		}
		expect(
			readInFacts(
				4,
				explanation({ rows: [skipped("entry is disabled")] })
			).decisionLine
		).toBe("it is switched off")
	})

	it("G5a: another speaker's character lore", () => {
		expect(
			lineOf(
				explanation({
					rows: [skipped("not visible to the current speaker")]
				})
			)
		).toBe("it is another speaker's character lore")
	})

	it("G5b: already shown in a slot of its own", () => {
		expect(
			lineOf(
				explanation({
					rows: [
						row({
							outcome: "excluded",
							reason: "excluded_ineligible",
							why: ["Already in the prompt in a slot of its own."]
						})
					]
				})
			)
		).toBe("Already in the prompt in a slot of its own")
	})

	it("G6: a miss reason verbatim", () => {
		const reason = "no key matched in the last 4 messages"
		expect(lineOf(explanation({ rows: [skipped(reason)] }))).toBe(reason)
	})

	it("G7: a judged budget row keeps its verdict", () => {
		expect(
			lineOf(
				explanation({
					rows: [
						row({
							outcome: "excluded",
							reason: "excluded_budget",
							verdict: "The budget was full before it got there."
						})
					]
				})
			)
		).toBe("The budget was full before it got there.")
	})

	it("says a turn that ranked nothing ranked nothing", () => {
		expect(lineOf(explanation({ ranked: false }))).toBe(
			"this turn ranked nothing at all"
		)
	})

	it("catch-all: no row, and the session's reading unknown or on", () => {
		expect(lineOf(explanation())).toBe("nothing reported on it")
		expect(
			lineOf(explanation(), { reading: { off: false, pinned: false } })
		).toBe("nothing reported on it")
	})

	it("names no gate for an entry that would be read in", () => {
		expect(
			lineOf(explanation({ rows: [row({})] }), {
				reading: { off: true, pinned: false }
			})
		).toBeUndefined()
	})
})
