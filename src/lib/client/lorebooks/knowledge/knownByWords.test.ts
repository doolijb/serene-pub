import { describe, expect, test } from "vitest"
import { knownByWords } from "./knownByWords"

type Row = Sockets.EntryKnowledge.Row
type Winner = Sockets.EntryKnowledge.Winner

const fmt = (m: { year: number }) => `Year ${m.year}`

function row(over: Partial<Row> = {}): Row {
	return {
		castMemberId: 1,
		name: "Mara",
		entryId: 9,
		known: true,
		winner: null,
		hand: null,
		overruled: null,
		placeEntry: false,
		...over
	}
}
function winner(over: Partial<Winner> = {}): Winner {
	return {
		tieId: 1,
		kind: "knows",
		relationshipType: "knows",
		hand: true,
		date: null,
		...over
	}
}
const words = (r: Row, marked = true) => knownByWords(r, marked, fmt)

describe("the result", () => {
	test("no winner: the mark decides", () => {
		expect(words(row({ known: true }), false).result).toBe(
			"Knows it: common knowledge"
		)
		expect(words(row({ known: false })).result).toBe("Does not know it")
	})
	test("a hand tie", () => {
		expect(words(row({ winner: winner(), hand: "knows" })).result).toBe(
			"Knows it"
		)
		expect(
			words(
				row({
					known: false,
					winner: winner({ kind: "kept_from" }),
					hand: "kept_from"
				})
			).result
		).toBe("Kept from it")
	})
	test("a dated tie says as of its date; undated says nothing more", () => {
		const dated = winner({ hand: false, date: { year: 4 } as any })
		expect(words(row({ winner: dated })).result).toBe(
			"Knows it, as of Year 4"
		)
		expect(
			words(
				row({ known: false, winner: { ...dated, kind: "kept_from" } })
			).result
		).toBe("Kept from it, as of Year 4")
		expect(
			words(row({ winner: winner({ hand: false, date: null }) })).result
		).toBe("Knows it")
		expect(
			words(
				row({
					known: false,
					winner: winner({
						hand: false,
						date: null,
						kind: "kept_from"
					})
				})
			).result
		).toBe("Kept from it")
	})
	test("play's kinds and an ordinary relationship", () => {
		expect(
			words(row({ winner: winner({ kind: "was_told", hand: false }) }))
				.result
		).toBe("Knows it: was told")
		expect(
			words(
				row({ winner: winner({ kind: "has_been_there", hand: false }) })
			).result
		).toBe("Knows it: has been there")
		expect(
			words(
				row({
					winner: winner({
						kind: null,
						relationshipType: "keeps",
						hand: false
					})
				})
			).result
		).toBe("Knows it: tied as “keeps”")
	})
	test("a place appends the standing exception to kept from only", () => {
		expect(
			words(
				row({
					known: false,
					placeEntry: true,
					winner: winner({ kind: "kept_from" }),
					hand: "kept_from"
				})
			).result
		).toBe("Kept from it, except while standing there")
		expect(
			words(row({ placeEntry: true, winner: winner(), hand: "knows" }))
				.result
		).toBe("Knows it")
	})
})

describe("the note", () => {
	test("none for Default or a hand tie that wins", () => {
		expect(words(row()).note).toBeNull()
		expect(
			words(
				row({
					known: false,
					winner: winner({ kind: "kept_from" }),
					hand: "kept_from"
				})
			).note
		).toBeNull()
	})
	test("a hand Kept from stands over a knowing tie", () => {
		const keeps = (over: Winner) =>
			words(
				row({
					hand: "kept_from",
					known: false,
					winner: winner({ kind: "kept_from" }),
					overruled: over
				})
			).note
		expect(keeps(winner({ kind: "was_told", hand: false }))).toBe(
			"Kept from stands over “was told”; set it back to Default and that tie wins again."
		)
		expect(keeps(winner({ kind: "has_been_there", hand: false }))).toBe(
			"Kept from stands over “has been there”; set it back to Default and that tie wins again."
		)
		expect(
			keeps(
				winner({ kind: null, relationshipType: "keeps", hand: false })
			)
		).toBe("Kept from stands over “keeps”; set it back to Default and that tie wins again.")
		expect(keeps(winner({ kind: "knows", hand: false }))).toBe(
			"Kept from stands over another “knows” tie; set it back to Default and that tie wins again."
		)
		expect(
			keeps(
				winner({
					kind: "knows",
					hand: false,
					date: { year: 8 } as any
				})
			)
		).toBe(
			"Kept from stands over a tie dated Year 8; set it back to Default and that tie wins again."
		)
	})
	test("a hand Knows stands over a kept from tie", () => {
		const knows = (over: Winner) =>
			words(
				row({
					hand: "knows",
					winner: winner(),
					overruled: over
				})
			).note
		expect(knows(winner({ kind: "kept_from", hand: false }))).toBe(
			"Knows stands over another “kept from” tie; set it back to Default and that tie wins again."
		)
		expect(
			knows(
				winner({
					kind: "kept_from",
					hand: false,
					date: { year: 7 } as any
				})
			)
		).toBe(
			"Knows stands over a tie dated Year 7; set it back to Default and that tie wins again."
		)
	})
	test("the old newer-wins sentences no longer occur", () => {
		const all = [
			row({
				hand: "kept_from",
				known: false,
				winner: winner({ kind: "kept_from" }),
				overruled: winner({ kind: "was_told", hand: false })
			}),
			row({
				hand: "knows",
				winner: winner(),
				overruled: winner({ kind: "kept_from", hand: false })
			})
		]
		for (const r of all) expect(words(r).note).not.toMatch(/wins\.$|newer/)
	})
	test("the same effect is no override", () => {
		expect(
			words(
				row({
					hand: "kept_from",
					known: false,
					winner: winner({ kind: "kept_from" }),
					overruled: winner({
						kind: "kept_from",
						hand: false,
						date: { year: 8 } as any
					})
				})
			).note
		).toBeNull()
		expect(
			words(
				row({
					hand: "knows",
					winner: winner(),
					overruled: winner({ kind: "was_told", hand: false })
				}),
				false
			).note
		).toBe(
			"Changes nothing until the entry is marked not common knowledge."
		)
		expect(
			words(
				row({
					hand: "knows",
					winner: winner(),
					overruled: winner({ kind: "was_told", hand: false })
				}),
				true
			).note
		).toBeNull()
	})
	test("knows changes nothing until the entry is marked", () => {
		const r = row({ hand: "knows", winner: winner() })
		expect(words(r, false).note).toBe(
			"Changes nothing until the entry is marked not common knowledge."
		)
		expect(words(r, true).note).toBeNull()
		const other = row({
			hand: "knows",
			winner: winner(),
			overruled: winner({ kind: "knows", hand: false })
		})
		expect(words(other, false).note).toBe(
			"Changes nothing until the entry is marked not common knowledge."
		)
	})
})
