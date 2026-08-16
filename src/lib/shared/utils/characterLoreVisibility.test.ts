import { describe, expect, test } from "vitest"
import {
	getCharacterLoreVisibility,
	type BindingLike
} from "./characterLoreVisibility"

const characterBinding: BindingLike = {
	id: 1,
	characterId: 10,
	personaId: null,
	character: { name: "Aria", nickname: null }
}

const characterBindingWithNickname: BindingLike = {
	id: 2,
	characterId: 11,
	personaId: null,
	character: { name: "Aria Longname", nickname: "Ari" }
}

const personaBinding: BindingLike = {
	id: 3,
	characterId: null,
	personaId: 20,
	persona: { name: "Traveler" }
}

const backgroundBinding: BindingLike = {
	id: 4,
	characterId: null,
	personaId: null
}

const allBindings = [
	characterBinding,
	characterBindingWithNickname,
	personaBinding,
	backgroundBinding
]

describe("getCharacterLoreVisibility", () => {
	test("null bindingId is unbound", () => {
		const v = getCharacterLoreVisibility(null, allBindings)
		expect(v.kind).toBe("unbound")
		expect(v.label).toBe("Unbound")
		expect(v.description).toContain("never be included")
	})

	test("undefined bindingId is unbound", () => {
		expect(getCharacterLoreVisibility(undefined, allBindings).kind).toBe(
			"unbound"
		)
	})

	test("a bindingId with no matching binding in the list is orphaned", () => {
		const v = getCharacterLoreVisibility(999, allBindings)
		expect(v.kind).toBe("orphaned")
		expect(v.description).toContain("no longer points")
	})

	test("a binding with neither characterId nor personaId is a background/NPC row, visible only to the Narrator", () => {
		const v = getCharacterLoreVisibility(backgroundBinding.id, allBindings)
		expect(v.kind).toBe("narrator")
		expect(v.label).toBe("Narrator only")
		expect(v.description).toContain("Narrator perspective")
	})

	test("a character binding is private to that character, by name", () => {
		const v = getCharacterLoreVisibility(characterBinding.id, allBindings)
		expect(v.kind).toBe("character")
		expect(v.label).toBe("Private to Aria")
		expect(v.description).toContain("Aria's perspective")
		expect(v.description).toContain("hidden from every other character")
	})

	test("a character binding prefers the character's nickname over their name", () => {
		const v = getCharacterLoreVisibility(
			characterBindingWithNickname.id,
			allBindings
		)
		expect(v.label).toBe("Private to Ari")
		expect(v.description).toContain("Ari's perspective")
	})

	test("a persona binding is private to that persona", () => {
		const v = getCharacterLoreVisibility(personaBinding.id, allBindings)
		expect(v.kind).toBe("persona")
		expect(v.label).toBe("Private to Traveler")
		expect(v.description).toContain("Traveler is the active persona")
	})

	test("falls back to a generic noun when the bound character/persona record is missing", () => {
		const v = getCharacterLoreVisibility(5, [
			{ id: 5, characterId: 99, personaId: null }
		])
		expect(v.label).toBe("Private to this character")
	})
})
