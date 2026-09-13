/**
 * The cast board's sentences: one member's row, the board's heading, what is
 * outstanding, and how many of a member's relationships have happened yet.
 */
import { describe, expect, it } from "vitest"
import {
	castHeaderLine,
	castReadInLine,
	castRowSentence,
	moreLine,
	relationshipsAtMomentLine,
	reviewLine
} from "./castRelationships"

describe("castRowSentence — one member, in one line", () => {
	it("says the aliases, the state, the lore, the relationships and the mark", () => {
		expect(
			castRowSentence({
				aliases: ["the Archivist", "Keeper"],
				kind: "character",
				state: "active",
				loreCount: 4,
				relationshipCount: 5,
				readIn: true
			})
		).toBe(
			"the Archivist · Keeper · active · 4 lore entries · 5 relationships · read in"
		)
	})

	it("names a persona as the reader's own", () => {
		expect(
			castRowSentence({
				aliases: ["the traveller"],
				kind: "persona",
				state: "active",
				loreCount: 0,
				relationshipCount: 1,
				readIn: false
			})
		).toBe("the traveller · active · your persona · 1 relationship")
	})

	it("counts one lore entry in the singular", () => {
		expect(
			castRowSentence({
				aliases: [],
				kind: "background",
				state: "missing",
				loreCount: 1,
				relationshipCount: 0,
				readIn: false
			})
		).toBe("missing · 1 lore entry")
	})

	it("reads as the bare state for a member nothing is known about", () => {
		expect(
			castRowSentence({
				aliases: [],
				kind: "character",
				state: "deceased",
				loreCount: 0,
				relationshipCount: 0,
				readIn: false
			})
		).toBe("deceased")
	})

	it("falls back to active when the row carries no state", () => {
		expect(
			castRowSentence({
				aliases: [],
				kind: "character",
				state: "",
				loreCount: 0,
				relationshipCount: 0,
				readIn: false
			})
		).toBe("active")
	})
})

describe("castHeaderLine — the board, said out loud", () => {
	it("counts the cast, the suggestions and the duplicates", () => {
		expect(
			castHeaderLine({ members: 7, suggested: 2, duplicates: 1 })
		).toBe("Cast · 7 members · 2 suggested, 1 possible duplicate")
	})

	it("says only the cast when there is nothing to review", () => {
		expect(
			castHeaderLine({ members: 1, suggested: 0, duplicates: 0 })
		).toBe("Cast · 1 member")
	})

	it("counts duplicates in the plural and suggestions in the singular", () => {
		expect(
			castHeaderLine({ members: 4, suggested: 1, duplicates: 2 })
		).toBe("Cast · 4 members · 1 suggested, 2 possible duplicates")
	})
})

describe("reviewLine — what is outstanding, by name", () => {
	it("names the suggestions and the pair that may be one person", () => {
		expect(
			reviewLine({
				suggestions: ["Kestrel", "the Bellwarden"],
				duplicates: [["Dree", "Captain Dree"]]
			})
		).toBe(
			"2 suggestions · Kestrel, the Bellwarden · 1 duplicate · Dree / Captain Dree"
		)
	})

	it("says nothing when nothing is outstanding", () => {
		expect(reviewLine({ suggestions: [], duplicates: [] })).toBe("")
	})

	it("says only the half that has anything in it", () => {
		expect(reviewLine({ suggestions: ["Kestrel"], duplicates: [] })).toBe(
			"1 suggestion · Kestrel"
		)
	})
})

describe("relationshipsAtMomentLine — how much has happened by now", () => {
	it("counts what has happened against the whole", () => {
		expect(relationshipsAtMomentLine(3, 5)).toBe(
			"Relationships at this point 3 of 5"
		)
	})

	it("says nothing at now, where every edge has happened", () => {
		expect(relationshipsAtMomentLine(5, 5)).toBe("")
	})
})

describe("moreLine — the rest of a long list", () => {
	it("offers the rest", () => {
		expect(moreLine(1)).toBe("1 more · show all")
		expect(moreLine(3)).toBe("3 more · show all")
	})

	it("offers nothing when the list is all there", () => {
		expect(moreLine(0)).toBe("")
	})
})

describe("castReadInLine — what the newest run did with this member", () => {
	it("says the rank when a run recorded one", () => {
		expect(castReadInLine({ fired: true, rank: 1 })).toBe(
			"Read in · rank 1"
		)
	})

	it("says only that it was read in when nothing ranked it", () => {
		expect(castReadInLine({ fired: true })).toBe("Read in")
	})

	it("says nothing about a member no run reached", () => {
		expect(castReadInLine({ fired: false })).toBe("")
	})
})
