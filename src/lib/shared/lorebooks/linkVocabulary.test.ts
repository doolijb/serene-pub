/**
 * One relationship, said from either end (plan places-graph §6.1, B3).
 *
 * `relationshipSentence` is the only reader of direction: the place editor's
 * Links list, the References panel, the prompt's "From here:" block and the
 * retrieval hop all say a relationship through it, so "A leads to B" can never
 * read backwards from B on one surface and forwards on another.
 */
import { describe, expect, it } from "vitest"
import * as vocabulary from "./linkVocabulary"
import {
	LINK_SUGGESTIONS,
	RELATIONSHIP_STATUSES,
	RELATIONSHIP_VISIBILITIES,
	relationshipReading,
	relationshipSentence,
	type RelationshipEndRef
} from "./linkVocabulary"
import { LOCATION_TYPE_ID, WORLD_LORE_TYPE_ID } from "$lib/shared/entries/types"

const GUARDROOM = 1
const HALL = 2
const CRYPT = 3

const names: Record<string, string> = {
	"entry:1": "the Guardroom",
	"entry:2": "the Drowned Hall",
	"entry:3": "the Crypt",
	"cast:7": "Verity"
}
const nameOf = (end: RelationshipEndRef) => names[`${end.kind}:${end.id}`]

const here = (id: number): RelationshipEndRef => ({ kind: "entry", id })

/** The rusted iron door: north out of the Guardroom, south back into it. */
const door = {
	from: { kind: "entry" as const, entryId: GUARDROOM },
	to: { kind: "entry" as const, entryId: HALL },
	relationshipType: "leads north to",
	reverseRelationshipType: "leads south to",
	name: "the rusted iron door"
}

describe("relationshipSentence — said from the `from` end", () => {
	it("leads with the relationship's name", () => {
		expect(relationshipSentence(door, here(GUARDROOM), nameOf)).toBe(
			"The rusted iron door leads north to the Drowned Hall."
		)
	})

	it("starts on the wording when the relationship is unnamed", () => {
		expect(
			relationshipSentence({ ...door, name: "" }, here(GUARDROOM), nameOf)
		).toBe("Leads north to the Drowned Hall.")
	})
})

describe("relationshipSentence — said from the `to` end", () => {
	it("reads through the reverse relationship type, naming the `from` end", () => {
		expect(relationshipSentence(door, here(HALL), nameOf)).toBe(
			"The rusted iron door leads south to the Guardroom."
		)
	})

	it("says a one-way relationship as a way in, not a way out", () => {
		expect(
			relationshipSentence(
				{ ...door, name: "", reverseRelationshipType: null },
				here(HALL),
				nameOf
			)
		).toBe("One way, into here from the Guardroom.")
	})

	it("names a one-way relationship that has a name", () => {
		expect(
			relationshipSentence(
				{ ...door, reverseRelationshipType: null },
				here(HALL),
				nameOf
			)
		).toBe("One way, into here from the Guardroom, by the rusted iron door.")
	})

	it("treats a blank reverse relationship type as one way", () => {
		expect(
			relationshipSentence(
				{ ...door, name: "", reverseRelationshipType: "  " },
				here(HALL),
				nameOf
			)
		).toBe("One way, into here from the Guardroom.")
	})

	it("keeps the way-in wording for a wire end that says it is a place", () => {
		expect(
			relationshipSentence(
				{
					...door,
					name: "",
					reverseRelationshipType: null,
					to: { kind: "entry", entryId: HALL, typeId: LOCATION_TYPE_ID }
				},
				here(HALL),
				nameOf
			)
		).toBe("One way, into here from the Guardroom.")
	})

	/**
	 * Review round: "into here" is a place's wording (§6.1). Said from an
	 * end that is not a place — an entry whose type says so, or a cast member
	 * — a one-way relationship is said as drawn, both ends named.
	 */
	it("says a one-way relationship into something that is not a place as drawn", () => {
		const keeper = {
			from: { kind: "cast" as const, bindingId: 7 },
			to: { kind: "entry" as const, entryId: CRYPT, typeId: WORLD_LORE_TYPE_ID },
			relationshipType: "owns",
			reverseRelationshipType: null,
			name: ""
		}
		expect(relationshipSentence(keeper, here(CRYPT), nameOf)).toBe(
			"Verity owns the Crypt."
		)
		expect(
			relationshipSentence({ ...keeper, name: "the old claim" }, here(CRYPT), nameOf)
		).toBe("Verity owns the Crypt, by the old claim.")
		const haunting = {
			from: { kind: "entry" as const, entryId: CRYPT, typeId: WORLD_LORE_TYPE_ID },
			to: { kind: "cast" as const, bindingId: 7 },
			relationshipType: "haunts",
			reverseRelationshipType: null,
			name: ""
		}
		expect(
			relationshipSentence(haunting, { kind: "cast", id: 7 }, nameOf)
		).toBe("The Crypt haunts Verity.")
	})

	/**
	 * Plan B4: a place's panel lists the cast members joined to it. A member
	 * is nowhere a way comes from, so "One way, into here from Verity" is a
	 * place's wording said of a person: it is said as drawn.
	 */
	it("says a member's one-way relationship into a place as drawn", () => {
		const resident = {
			from: { kind: "cast" as const, bindingId: 7 },
			to: { kind: "entry" as const, entryId: CRYPT, typeId: LOCATION_TYPE_ID },
			relationshipType: "lives in",
			reverseRelationshipType: null,
			name: ""
		}
		expect(relationshipSentence(resident, here(CRYPT), nameOf)).toBe(
			"Verity lives in the Crypt."
		)
		const lore = {
			...resident,
			from: { kind: "entry" as const, entryId: GUARDROOM, typeId: WORLD_LORE_TYPE_ID },
			relationshipType: "is sung of in"
		}
		expect(relationshipSentence(lore, here(CRYPT), nameOf)).toBe(
			"The Guardroom is sung of in the Crypt."
		)
	})
})

/**
 * Review round (B4/B5): a member's one-way relationship into a place is said
 * with both ends named from the place, so each offered wording must read as
 * a sentence after the member's name — and as a fragment from the member.
 */
describe("relationshipSentence — every cast↔entry suggestion reads from both ends", () => {
	const into = (type: string) => ({
		from: { kind: "cast" as const, bindingId: 7 },
		to: { kind: "entry" as const, entryId: CRYPT, typeId: LOCATION_TYPE_ID },
		relationshipType: type,
		reverseRelationshipType: null,
		name: ""
	})
	const verity: RelationshipEndRef = { kind: "cast", id: 7 }

	it("says each suggestion from the place with the member as its subject", () => {
		expect(
			LINK_SUGGESTIONS["cast-entry"].map((s) =>
				relationshipSentence(into(s.type), here(CRYPT), nameOf)
			)
		).toEqual([
			"Verity keeps the Crypt.",
			"Verity lives in the Crypt.",
			"Verity owns the Crypt.",
			"Verity was born in the Crypt.",
			"Verity died at the Crypt."
		])
	})

	it("says each suggestion from the member as a fragment under their name", () => {
		expect(
			LINK_SUGGESTIONS["cast-entry"].map((s) =>
				relationshipSentence(into(s.type), verity, nameOf)
			)
		).toEqual([
			"Keeps the Crypt.",
			"Lives in the Crypt.",
			"Owns the Crypt.",
			"Was born in the Crypt.",
			"Died at the Crypt."
		])
	})

	it("gives an unworded one its verb when both ends are named", () => {
		expect(relationshipSentence(into(""), here(CRYPT), nameOf)).toBe(
			"Verity is linked to the Crypt."
		)
		expect(relationshipSentence(into(""), verity, nameOf)).toBe(
			"Linked to the Crypt."
		)
	})

	it("never makes a name the subject of what is not a way", () => {
		const claimed = { ...into("owns"), name: "the old claim" }
		expect(relationshipSentence(claimed, verity, nameOf)).toBe(
			"Owns the Crypt, by the old claim."
		)
		expect(relationshipSentence(claimed, here(CRYPT), nameOf)).toBe(
			"Verity owns the Crypt, by the old claim."
		)
		// A way between places keeps its name up front: the door leads.
		expect(relationshipSentence(door, here(GUARDROOM), nameOf)).toMatch(
			/^The rusted iron door leads north to/
		)
	})
})

describe("relationshipSentence — whatever shape the ends arrive in", () => {
	it("reads the server's `{ kind, id }` ends as well as the wire's", () => {
		const link = {
			from: { kind: "entry" as const, id: CRYPT, name: "the Crypt" },
			to: { kind: "entry" as const, id: HALL, name: "the Drowned Hall" },
			relationshipType: "leads to",
			reverseRelationshipType: null,
			name: ""
		}
		expect(relationshipSentence(link, here(CRYPT), nameOf)).toBe(
			"Leads to the Drowned Hall."
		)
	})

	it("says a cast end by the name it is handed", () => {
		const keeper = {
			from: { kind: "cast" as const, bindingId: 7 },
			to: { kind: "entry" as const, entryId: CRYPT },
			relationshipType: "keeper of",
			reverseRelationshipType: null,
			name: ""
		}
		expect(
			relationshipSentence(keeper, { kind: "cast", id: 7 }, nameOf)
		).toBe("Keeper of the Crypt.")
	})

	it("says nothing from a thing that is neither end", () => {
		expect(relationshipSentence(door, here(CRYPT), nameOf)).toBeNull()
	})

	it("does not put a second full stop after a name that ends in one", () => {
		expect(
			relationshipSentence(
				{ ...door, name: "" },
				here(GUARDROOM),
				() => "St. Aubin's Ward."
			)
		).toBe("Leads north to St. Aubin's Ward.")
	})
})

describe("relationshipReading — which way a relationship reads from an end", () => {
	it("reads out from the `from` end, with its relationship type", () => {
		expect(relationshipReading(door, here(GUARDROOM))).toEqual({
			way: "out",
			wording: "leads north to",
			other: here(HALL)
		})
	})

	it("reads back from the `to` end, with the reverse relationship type", () => {
		expect(relationshipReading(door, here(HALL))).toEqual({
			way: "back",
			wording: "leads south to",
			other: here(GUARDROOM)
		})
	})

	it("reads a one-way relationship from its `to` end as inbound, with no wording", () => {
		expect(
			relationshipReading(
				{ ...door, reverseRelationshipType: null },
				here(HALL)
			)
		).toEqual({ way: "inbound", wording: null, other: here(GUARDROOM) })
	})

	it("is null from a thing that is neither end", () => {
		expect(relationshipReading(door, here(CRYPT))).toBeNull()
	})
})

describe("LINK_SUGGESTIONS — what the entry↔entry picker offers", () => {
	const offered = LINK_SUGGESTIONS["entry-entry"]
	const find = (type: string) => offered.find((s) => s.type === type)

	it("offers the symmetric wordings both ways, with the same words", () => {
		expect(find("connects to")?.reverse).toBe("connects to")
		expect(find("near")?.reverse).toBe("near")
	})

	it("offers the ways you only travel one way as one way", () => {
		expect(find("leads to")?.reverse).toBeUndefined()
		expect(find("runs past")?.reverse).toBeUndefined()
	})

	it("offers `is inside` / `holds` in place of `inside`", () => {
		expect(find("is inside")?.reverse).toBe("holds")
		expect(find("inside")).toBeUndefined()
	})

	it("never offers a reverse between two cast members", () => {
		for (const s of LINK_SUGGESTIONS["cast-cast"])
			expect("reverse" in s).toBe(false)
	})
})

describe("the travel gate is retired", () => {
	it("exports no list of travel wordings, and no reader of one", () => {
		expect("TRAVEL_LINK_TYPES" in vocabulary).toBe(false)
		expect("isTravelLinkType" in vocabulary).toBe(false)
	})
})

describe("status and visibility — one list each, read by every form", () => {
	it("lists the four statuses", () => {
		expect([...RELATIONSHIP_STATUSES]).toEqual([
			"active",
			"resolved",
			"broken",
			"evolved"
		])
	})

	it("lists the three visibilities, least known first", () => {
		expect([...RELATIONSHIP_VISIBILITIES]).toEqual([
			"secret",
			"acknowledged",
			"public"
		])
	})
})
