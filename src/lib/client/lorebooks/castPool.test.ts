/**
 * The cast, as arithmetic — pure, so who is listed and what hangs off them is
 * covered without a component harness.
 */
import { describe, expect, it } from "vitest"
import {
	castPool,
	castPoolItem,
	filterCast,
	loreByMember,
	toCastMember,
	unanchoredLore,
	type CastRow
} from "./castPool"
import { CAST_KIND, needsKeywords } from "./poolFilter"

function row(over: Partial<CastRow> & { id: number }): CastRow {
	return { binding: `{{char:${over.id}}}`, ...over }
}

const carded = row({
	id: 1,
	characterId: 10,
	character: { nickname: "Bram", name: "Bramwell Ashe" },
	aliases: ["the Blacksmith"],
	nodeState: "active"
})
// A persona is a character binding whose card is flagged as one of the
// reader's own personas — not a second kind of link.
const personaRow = row({
	id: 2,
	characterId: 20,
	character: { name: "The Traveller", isPersona: true },
	nodeState: "missing"
})
const background = row({
	id: 3,
	name: "The Innkeeper",
	aliases: ["Old Tam"],
	absorbedAliases: ["Tam", "Old Tam"],
	summary: "Keeps the only bed in town."
})

describe("toCastMember — one row, as the list reads it", () => {
	it("prefers a linked character's nickname over its full name", () => {
		expect(toCastMember(carded).name).toBe("Bram")
	})

	it("falls back to the character's name when there is no nickname", () => {
		expect(
			toCastMember(
				row({ id: 4, characterId: 11, character: { name: "Sable" } })
			).name
		).toBe("Sable")
	})

	it("names a persona row by its character card", () => {
		expect(toCastMember(personaRow).name).toBe("The Traveller")
	})

	it("names a background row by its own name", () => {
		expect(toCastMember(background).name).toBe("The Innkeeper")
	})

	it("falls back to the tag rather than rendering nothing", () => {
		// `name` is NOT NULL DEFAULT '', so an unlinked row can carry an empty
		// string, and an empty heading is unclickable.
		expect(toCastMember(row({ id: 5, name: "" })).name).toBe("{{char:5}}")
	})

	it("says which of the three kinds a row is", () => {
		expect(toCastMember(carded).kind).toBe("character")
		expect(toCastMember(personaRow).kind).toBe("persona")
		expect(toCastMember(background).kind).toBe("background")
	})

	it("unions aliases with absorbed ones, keeping each once", () => {
		expect(toCastMember(background).aliases).toEqual(["Old Tam", "Tam"])
	})

	it("reads state and visibility as active and normal when absent", () => {
		const member = toCastMember(row({ id: 6, name: "Nobody" }))
		expect(member.state).toBe("active")
		expect(member.visibility).toBe("normal")
	})

	it("carries the tag the content refers to it by", () => {
		expect(toCastMember(carded).tag).toBe("{{char:1}}")
	})
})

describe("filterCast — search over name and aliases", () => {
	const members = [carded, personaRow, background].map(toCastMember)

	it("returns everyone for an empty query", () => {
		expect(filterCast(members, "   ").map((m) => m.id)).toEqual([1, 2, 3])
	})

	it("matches a name, ignoring case", () => {
		expect(filterCast(members, "bram").map((m) => m.id)).toEqual([1])
	})

	it("matches an alias the name does not contain", () => {
		expect(filterCast(members, "blacksmith").map((m) => m.id)).toEqual([1])
	})

	it("matches an absorbed alias too", () => {
		expect(filterCast(members, "tam").map((m) => m.id)).toEqual([3])
	})

	it("matches nobody rather than everybody when nothing hits", () => {
		expect(filterCast(members, "nonesuch")).toEqual([])
	})
})

describe("loreByMember — a member's page lists their anchored lore", () => {
	const entries = [
		{ id: 100, lorebookBindingId: 1, name: "Her forge" },
		{ id: 101, lorebookBindingId: 3, name: "The cellar" },
		{ id: 102, lorebookBindingId: 1, name: "The scar" },
		{ id: 103, lorebookBindingId: null, name: "Loose" }
	]

	it("groups entries under the member they are anchored to", () => {
		const grouped = loreByMember(entries)
		expect(grouped.get(1)?.map((e) => e.id)).toEqual([100, 102])
		expect(grouped.get(3)?.map((e) => e.id)).toEqual([101])
	})

	it("leaves an unanchored entry out of every group", () => {
		expect([...loreByMember(entries).values()].flat()).not.toContainEqual(
			entries[3]
		)
	})

	it("collects the unanchored entries, which belong to nobody's page", () => {
		expect(unanchoredLore(entries).map((e) => e.id)).toEqual([103])
	})
})

describe("castPool — the list column and what hangs off each row", () => {
	const entries = [
		{ id: 100, lorebookBindingId: 1 },
		{ id: 101, lorebookBindingId: 3 }
	]

	it("narrows the members and keeps every group addressable", () => {
		const pool = castPool([carded, personaRow, background], entries, "tam")
		expect(pool.members.map((m) => m.id)).toEqual([3])
		expect(pool.lore.get(3)?.map((e) => e.id)).toEqual([101])
		// Narrowing the list is not narrowing the book: a member filtered out
		// of view still owns their lore.
		expect(pool.lore.get(1)?.map((e) => e.id)).toEqual([100])
	})

	it("holds every member when nothing is searched", () => {
		expect(
			castPool([carded, personaRow, background], entries).members.map(
				(m) => m.id
			)
		).toEqual([1, 2, 3])
	})

	it("reports lore anchored to nobody", () => {
		const pool = castPool(
			[carded],
			[...entries, { id: 102, lorebookBindingId: null }]
		)
		expect(pool.unanchored.map((e) => e.id)).toEqual([102])
	})
})

/** Note 12: Everything lists the people too. */
describe("castPoolItem", () => {
	it("lists a member under the cast kind, opening nothing but Cast", () => {
		const row = castPoolItem(
			{
				id: 4,
				name: "Mara",
				binding: "{{char:4}}",
				aliases: ["the ferrywoman"],
				summary: "Keeps the crossing."
			},
			undefined,
			undefined
		)
		expect(row).toMatchObject({
			key: "cast#4",
			kind: CAST_KIND,
			name: "Mara",
			castKind: "background",
			pinned: false,
			off: false,
			archived: false,
			parentKey: null,
			keys: []
		})
		// Search reads content, so a member is found by alias too.
		expect(row.content).toContain("the ferrywoman")
		// No keywords to need: a member is no keyword chore.
		expect(needsKeywords(row)).toBe(false)
	})

	it("names a carded member by the card they read as at the moment", () => {
		const row = castPoolItem(
			{
				id: 5,
				characterId: 9,
				character: { name: "Old card" }
			},
			"Swapped card",
			"/avatar.png"
		)
		expect(row.name).toBe("Swapped card")
		expect(row.castKind).toBe("character")
		expect(row.avatar).toBe("/avatar.png")
	})
})
