/**
 * "Read in · rank 2 of 12 · matched umber · 218 of 900 tokens" — one run's
 * decision about one entry, said in one line.
 *
 * Every clause after the first is a fact the run may not have recorded, so the
 * line is built from what is there rather than padded with blanks: a figure
 * nobody measured must not appear as a zero.
 */
import { describe, expect, it } from "vitest"
import {
	ARCHIVED_SKIP_REASON,
	DISABLED_SKIP_REASON
} from "$lib/server/pipelines/ranking/keywordQuery"
import {
	ARCHIVED_REASON,
	DISABLED_REASON,
	readInFacts,
	readInLine
} from "./readIn"

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
				decisionLine: "the budget was full before it got there"
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

	const line = (facts: object) =>
		readInLine({
			sessionName: "The Open Door",
			decision: "considered",
			...facts
		})

	it("pins the skip reasons to the ranker's own constants", () => {
		expect(ARCHIVED_REASON).toBe(ARCHIVED_SKIP_REASON)
		expect(DISABLED_REASON).toBe(DISABLED_SKIP_REASON)
	})

	it("G7 store path: names the budget", () => {
		expect(line({ reason: "excluded_budget" })).toBe(
			"Not read in last turn · it was left out for budget"
		)
	})

	it("G7 store path: a pinned entry that did not fit", () => {
		expect(line({ reason: "excluded_pinned_token_limit" })).toBe(
			"Not read in last turn · it is pinned, but it did not fit"
		)
	})

	it("G5b store path: the rule's own sentence, one full stop off", () => {
		expect(
			line({
				reason: "excluded_ineligible",
				why: "Hild is not in the world at 3 Frost 1204."
			})
		).toBe(
			"Not read in last turn · Hild is not in the world at 3 Frost 1204"
		)
	})

	it("says weighed for a store code that names no gate", () => {
		expect(line({ reason: "excluded_other" })).toBe(
			"Not read in last turn · weighed and left out"
		)
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

	it("ranks the entry among the entries the run read in", () => {
		// The ranking store's meaning (L1): 7 and 4 went in; 9 was only weighed.
		expect(readInFacts(4, explanation as any)).toEqual(
			expect.objectContaining({ rank: 2, of: 2, tokens: 218 })
		)
	})

	it("gives an entry left out no rank, only its reason", () => {
		const facts = readInFacts(9, explanation as any)
		expect(facts.rank).toBeUndefined()
		expect(facts.of).toBeUndefined()
	})

	it("counts the room the whole retrieved context was given", () => {
		expect(readInFacts(4, explanation as any).budget).toBe(900)
	})

	it("leaves messages out of the ranking: they are not entries", () => {
		expect(readInFacts(4, explanation as any).tokens).toBe(218)
	})

	it("leaves a row nothing offered to the ranker out of the count", () => {
		expect(readInFacts(7, explanation as any).of).toBe(2)
	})

	it("carries the run's own sentence as the decision line", () => {
		expect(readInFacts(9, explanation as any).decisionLine).toBe(
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

	describe("the first gate, from the run", () => {
		const skipped = (id: number, reason?: string, enabled?: boolean) =>
			row({
				id,
				outcome: "skipped" as const,
				verdict: reason
					? `Never reached the ranker — ${reason}.`
					: "Never reached the ranker.",
				...(reason ? { skipReason: reason } : {}),
				...(enabled === undefined
					? {}
					: {
							entry: {
								enabled
							} as Sockets.Pipelines.RetrievalRow["entry"]
						})
			})
		const said = (rows: Sockets.Pipelines.RetrievalRow[]) =>
			readInLine({
				sessionName: "The Open Door",
				decision: "considered",
				...readInFacts(1, { rows, ranked: true } as any)
			})

		it("G2: archived", () => {
			expect(said([skipped(1, "entry is archived")])).toBe(
				"Not read in last turn · it is archived"
			)
		})

		it("G1: a disabled skip", () => {
			expect(said([skipped(1, "entry is disabled")])).toBe(
				"Not read in last turn · it is switched off"
			)
		})

		it("G5a: another speaker's character lore", () => {
			expect(
				said([skipped(1, "not visible to the current speaker")])
			).toBe(
				"Not read in last turn · it is another speaker's character lore"
			)
		})

		it("G6: a miss reason verbatim, with the score and threshold", () => {
			const reason =
				"no key matched in the last 4 messages, and its relevance scored 0.31 against a threshold of 0.5"
			expect(said([skipped(1, reason)])).toBe(
				`Not read in last turn · ${reason}`
			)
		})

		it("G1: a disabled skip with the base row on is off for a while", () => {
			expect(said([skipped(1, "entry is disabled", true)])).toBe(
				"Not read in last turn · it is off for a while at this point in the story"
			)
		})

		it("G1: a disabled skip with the base row off is switched off", () => {
			expect(said([skipped(1, "entry is disabled", false)])).toBe(
				"Not read in last turn · it is switched off"
			)
		})

		it("reads the raw reason from the row, whatever the verdict says", () => {
			expect(
				said([
					row({
						id: 1,
						outcome: "skipped",
						verdict: "Declined early: whatever.",
						skipReason: "entry is archived"
					})
				])
			).toBe("Not read in last turn · it is archived")
		})

		it("never parses the verdict: the old prefix without a skipReason names no gate", () => {
			expect(
				said([
					row({
						id: 1,
						outcome: "skipped",
						verdict: "Never reached the ranker — entry is archived."
					})
				])
			).toBe("Not read in last turn · weighed and left out")
		})

		it("a skipped row with no reason names no gate", () => {
			expect(said([skipped(1)])).toBe(
				"Not read in last turn · weighed and left out"
			)
		})

		it("G5b: a secret the speaker does not hold", () => {
			expect(
				said([
					row({
						id: 1,
						outcome: "excluded",
						reason: "excluded_ineligible",
						why: ["A secret the speaker does not hold."]
					})
				])
			).toBe("Not read in last turn · A secret the speaker does not hold")
		})

		it("G5b: a presence sentence keeps its capital", () => {
			expect(
				said([
					row({
						id: 1,
						outcome: "excluded",
						reason: "excluded_ineligible",
						why: ["Hild is not in the world at 3 Frost 1204."]
					})
				])
			).toBe(
				"Not read in last turn · Hild is not in the world at 3 Frost 1204"
			)
		})

		it("G7: a judged budget row keeps its verdict", () => {
			expect(
				said([
					row({
						id: 1,
						outcome: "excluded",
						reason: "excluded_budget",
						verdict: "The budget was full before it got there."
					})
				])
			).toBe(
				"Not read in last turn · The budget was full before it got there."
			)
		})

		it("catch-all: no row and no store facts", () => {
			expect(
				readInLine({
					sessionName: "The Open Door",
					decision: null,
					...readInFacts(1, { rows: [], ranked: true } as any)
				})
			).toBe("Not read in last turn · nothing reported on it")
		})
	})
})
