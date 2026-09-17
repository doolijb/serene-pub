import { describe, expect, test } from "vitest"
import {
	getCharacterLoreVisibility,
	type BindingLike
} from "./characterLoreVisibility"

const characterBinding: BindingLike = {
	id: 1,
	characterId: 10,
	character: { name: "Aria", nickname: null }
}

const characterBindingWithNickname: BindingLike = {
	id: 2,
	characterId: 11,
	character: { name: "Aria Longname", nickname: "Ari" }
}

// A persona is a character (0133) — its binding is a character binding like
// any other, just naming a character the user happens to voice. There is no
// separate `persona`/`personaId` shape left on `BindingLike` to fixture.
const personaFlavoredCharacterBinding: BindingLike = {
	id: 3,
	characterId: 20,
	character: { name: "Traveler", nickname: null }
}

const backgroundBinding: BindingLike = {
	id: 4,
	characterId: null
}

const allBindings = [
	characterBinding,
	characterBindingWithNickname,
	personaFlavoredCharacterBinding,
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

	test("a binding with no characterId is a background/NPC row, visible only to the Narrator", () => {
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

	test("a binding on a character one of the session's users voices still reports as a character binding — the session-persona visibility rule survives the merge, it just no longer has a kind of its own", () => {
		const v = getCharacterLoreVisibility(
			personaFlavoredCharacterBinding.id,
			allBindings
		)
		expect(v.kind).toBe("character")
		expect(v.label).toBe("Private to Traveler")
		expect(v.description).toContain("Traveler's perspective")
	})

	test("falls back to a generic noun when the bound character record is missing", () => {
		const v = getCharacterLoreVisibility(5, [{ id: 5, characterId: 99 }])
		expect(v.label).toBe("Private to this character")
	})
})
