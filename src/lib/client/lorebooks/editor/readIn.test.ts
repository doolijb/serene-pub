/**
 * "Read in · rank 2 of 12 · matched umber · 218 of 900 tokens" — one run's
 * decision about one entry, said in one line.
 *
 * Every clause after the first is a fact the run may not have recorded, so the
 * line is built from what is there rather than padded with blanks: a figure
 * nobody measured must not appear as a zero.
 */
import { describe, expect, it } from "vitest"
import { readInFacts, readInLine } from "./readIn"

const row = (
	over: Partial<Sockets.Pipelines.RetrievalRow> & { id: number }
): Sockets.Pipelines.RetrievalRow => ({
	key: `${over.source ?? "worldLore"}:${over.id}`,
	source: "worldLore",
	sourceLabel: "World lore",
	title: `Entry ${over.id}`,
	outcome: "included",
	verdict: "It fitted the budget.",
	marker: "keyword",
	markerKind: "keyword",
	criteria: [],
	...over
})

describe("readInLine — a book nobody is reading", () => {
	it("says so, rather than saying the entry was left out", () => {
		expect(readInLine({ sessionName: null, decision: null })).toBe(
			"No session is reading this book"
		)
	})
})

describe("readInLine — read in", () => {
	it("says the rank, the match and the tokens, in that order", () => {
		expect(
			readInLine({
				sessionName: "The Open Door",
				decision: "fired",
				rank: 2,
				of: 12,
				matched: "umber",
				inMessage: 3,
				tokens: 218,
				budget: 900
			})
		).toBe(
			"Read in · rank 2 of 12 · matched umber in message 3 · 218 of 900 tokens"
		)
	})

	it("says only what the run recorded", () => {
		expect(
			readInLine({ sessionName: "The Open Door", decision: "fired" })
		).toBe("Read in")
	})

	it("leaves the message out when the run did not name one", () => {
		expect(
			readInLine({
				sessionName: "The Open Door",
				decision: "fired",
				matched: "umber"
			})
		).toBe("Read in · matched umber")
	})

	it("says the tokens alone when no ceiling was recorded", () => {
		expect(
			readInLine({
				sessionName: "The Open Door",
				decision: "fired",
				tokens: 218
			})
		).toBe("Read in · 218 tokens")
	})

	it("stops at the match on a narrow screen", () => {
		expect(
			readInLine(
				{
					sessionName: "The Open Door",
					decision: "fired",
					rank: 2,
					of: 12,
					matched: "umber",
					tokens: 218,
					budget: 900
				},
				{ short: true }
			)
		).toBe("Read in · rank 2 of 12 · matched umber")
	})
})

describe("readInLine — not read in", () => {
	it("gives the run's own reason when it has one", () => {
		expect(
			readInLine({
				sessionName: "The Open Door",
				decision: "considered",
				reason: "the budget was full before it got there"
			})
		).toBe(
			"Not read in last turn · the budget was full before it got there"
		)
	})

	it("says it was weighed when the run reported no reason", () => {
		expect(
			readInLine({
				sessionName: "The Open Door",
				decision: "considered"
			})
		).toBe("Not read in last turn · weighed and left out")
	})

	it("distinguishes an entry nothing reported on from one left out", () => {
		expect(
			readInLine({ sessionName: "The Open Door", decision: null })
		).toBe("Not read in last turn · nothing reported on it")
	})
})

describe("readInFacts — one entry's place in a run", () => {
	const explanation = {
		rows: [
			row({ id: 7, score: 0.9, tokens: 120 }),
			row({ id: 4, score: 0.6, tokens: 218 }),
			row({
				id: 9,
				score: 0.2,
				outcome: "excluded" as const,
				verdict: "The budget was full before it got there."
			}),
			row({ id: 4, source: "messages", score: 0.99 }),
			row({ id: 5, score: 0.8, outcome: "skipped" as const })
		],
		ranked: true,
		budget: { headline: "World lore", used: 338, total: 900 }
	}

	it("ranks the entry among the entries the run judged", () => {
		expect(readInFacts(4, explanation as any)).toEqual(
			expect.objectContaining({ rank: 2, of: 3, tokens: 218 })
		)
	})

	it("counts the room the whole retrieved context was given", () => {
		expect(readInFacts(4, explanation as any).budget).toBe(900)
	})

	it("leaves messages out of the ranking: they are not entries", () => {
		expect(readInFacts(4, explanation as any).tokens).toBe(218)
	})

	it("leaves a row nothing offered to the ranker out of the count", () => {
		expect(readInFacts(7, explanation as any).of).toBe(3)
	})

	it("carries the run's own verdict as the reason", () => {
		expect(readInFacts(9, explanation as any).reason).toBe(
			"The budget was full before it got there."
		)
	})

	it("names the keyword the run says matched", () => {
		const matched = readInFacts(4, {
			...explanation,
			rows: [
				row({
					id: 4,
					criteria: [
						{
							label: "Its keys",
							detail: "matched “umber” in the scanned messages",
							value: 0.81
						}
					]
				})
			]
		} as any).matched
		expect(matched).toBe("umber")
	})

	it("reports no figures for an entry the run never mentioned", () => {
		expect(readInFacts(99, explanation as any)).toEqual({ budget: 900 })
	})
})
