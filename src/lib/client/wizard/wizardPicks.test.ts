import { describe, expect, test } from "vitest"
import {
	characterPickOptions,
	characterStepOffers,
	ownStarterCharacter,
	personaPickExcludes,
	pickedRow
} from "./wizardPicks"
import { starterCharacterCreate } from "$lib/shared/characters/starterCharacter"

const character = (id: number, isPersona = false) => ({
	id,
	name: `Character ${id}`,
	isPersona
})

describe("characterPickOptions", () => {
	test("offers every character, uncapped, in the list's order", () => {
		const library = Array.from({ length: 13 }, (_, i) => character(i + 1))
		const offered = characterPickOptions(library, null)
		expect(offered).toHaveLength(13)
		expect(offered.map((c) => c.id)).toEqual(library.map((c) => c.id))
	})

	test("leaves out the personas", () => {
		const offered = characterPickOptions(
			[character(1), character(2, true), character(3)],
			null
		)
		expect(offered.map((c) => c.id)).toEqual([1, 3])
	})

	test("leaves out the character chosen to play as", () => {
		// Who you are's picker can widen to every character, so the one
		// played as may be an unflagged character.
		const offered = characterPickOptions(
			[character(1), character(2), character(3)],
			2
		)
		expect(offered.map((c) => c.id)).toEqual([1, 3])
	})

	test("drops rows without an id", () => {
		expect(
			characterPickOptions(
				[{ id: null, name: "Draft", isPersona: false }, character(4)],
				null
			)
		).toEqual([character(4)])
	})

	test("offers nothing on an empty library", () => {
		expect(characterPickOptions([], null)).toEqual([])
	})
})

describe("personaPickExcludes", () => {
	test("hides the character the AI plays", () => {
		expect(personaPickExcludes(5)).toEqual([5])
	})

	test("hides nothing before a character is chosen", () => {
		expect(personaPickExcludes(null)).toEqual([])
	})
})

describe("pickedRow", () => {
	const rows = [character(1), character(2)]

	test("is the chosen row", () => {
		expect(pickedRow(rows, 2)).toEqual(character(2))
	})

	test("is null before anything is chosen", () => {
		expect(pickedRow(rows, null)).toBeNull()
	})

	test("is null when the chosen row is not in the list", () => {
		// Deleted, or a new row whose list push has not landed yet: the step
		// shows Choose again rather than a row it cannot draw.
		expect(pickedRow(rows, 9)).toBeNull()
	})
})

describe("characterStepOffers", () => {
	const starterRow = (id: number, extra: Record<string, unknown> = {}) => ({
		id,
		...starterCharacterCreate(),
		...extra
	})

	test("offers the starter first on an empty library", () => {
		expect(characterStepOffers([], null)).toEqual([
			"starter",
			"create",
			"library",
			"import"
		])
	})

	test("puts the starter before Choose a character", () => {
		expect(characterStepOffers([character(1)], null)).toEqual([
			"starter",
			"choose",
			"create",
			"library",
			"import"
		])
	})

	test("drops the starter once the person has an unchanged copy", () => {
		expect(characterStepOffers([starterRow(7)], null)).toEqual([
			"choose",
			"create",
			"library",
			"import"
		])
	})

	test("offers the starter again when the copy was edited", () => {
		const edited = starterRow(7, { description: "Someone else now." })
		expect(characterStepOffers([edited], null)).toContain("starter")
	})

	test("a persona or shared row does not count as having it", () => {
		const persona = starterRow(7, { isPersona: true })
		const shared = starterRow(8, { isSharedWithMe: true })
		expect(characterStepOffers([persona, shared], null)).toContain(
			"starter"
		)
	})
})

describe("ownStarterCharacter", () => {
	test("is the unchanged row", () => {
		const row = { id: 3, ...starterCharacterCreate() }
		expect(ownStarterCharacter([character(1), row])).toBe(row)
	})

	test("is null without one", () => {
		expect(ownStarterCharacter([character(1)])).toBeNull()
	})
})
