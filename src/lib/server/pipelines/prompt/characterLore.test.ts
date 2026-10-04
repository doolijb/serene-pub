import { describe, expect, test } from "vitest"
import {
	castTagName,
	isCharacterLoreEntryVisible,
	populateLorebookEntryBindings
} from "$lib/server/pipelines/prompt/characterLore"
import {
	buildSession,
	buildLorebook,
	character,
	characterLoreEntry,
	lorebookBinding,
	worldLoreEntry
} from "$lib/server/pipelines/testing/fixtures"

describe("populateLorebookEntryBindings — @@decorator stripping", () => {
	test("strips a leading @@decorator line when the entry's lorebook matches the session", () => {
		const entry = worldLoreEntry({
			lorebookId: 1,
			content: "@@position before_char\nActual lore content."
		})
		const session = buildSession({
			lorebookId: 1,
			lorebook: buildLorebook({ id: 1, worldLoreEntries: [entry] })
		})
		const result = populateLorebookEntryBindings(entry, session)
		expect(result.content).toBe("Actual lore content.")
	})

	test("still strips decorators even when the entry's lorebook doesn't match the session (early-return path)", () => {
		// session.lorebook.id (2) !== entry.lorebookId (1) — populateLorebookEntryBindings
		// returns early before any {{char:#}} binding substitution, but decorator
		// stripping must still have applied, since it runs unconditionally up front.
		const entry = worldLoreEntry({
			lorebookId: 1,
			content: "@@dont_activate\nActual lore content."
		})
		const session = buildSession({
			lorebookId: 2,
			lorebook: buildLorebook({ id: 2 })
		})
		const result = populateLorebookEntryBindings(entry, session)
		expect(result.content).toBe("Actual lore content.")
	})

	test("decorator stripping and {{char:#}} binding substitution both apply to the same entry", () => {
		const char = character({ name: "Kestrel" })
		const binding = lorebookBinding({
			id: 5,
			lorebookId: 1,
			characterId: char.id,
			binding: "{{char:5}}"
		})
		const entry = worldLoreEntry({
			lorebookId: 1,
			content: "@@depth 3\n{{char:5}} lives here."
		})
		const session = buildSession({
			lorebookId: 1,
			lorebook: buildLorebook({
				id: 1,
				lorebookBindings: [
					{ ...binding, character: char, persona: null }
				],
				worldLoreEntries: [entry]
			})
		})
		const result = populateLorebookEntryBindings(entry, session)
		expect(result.content).toBe("Kestrel lives here.")
	})

	test("entries with no decorator lines render unaffected", () => {
		const entry = worldLoreEntry({
			lorebookId: 1,
			content: "Plain lore content with no decorators."
		})
		const session = buildSession({
			lorebookId: 1,
			lorebook: buildLorebook({ id: 1, worldLoreEntries: [entry] })
		})
		const result = populateLorebookEntryBindings(entry, session)
		expect(result.content).toBe("Plain lore content with no decorators.")
	})
})

/**
 * What a tag reads as (plan A19): the card's name, else the member's own —
 * which the pipeline host resolves at the session's reading before this runs
 * (`promptAtReading.int.test.ts` pins that half on the rendered prompt).
 */
describe("populateLorebookEntryBindings — a tag reads as its member", () => {
	const substitute = (
		bindings: Array<Record<string, unknown>>,
		content: string
	) => {
		const entry = worldLoreEntry({ lorebookId: 1, content })
		const session = buildSession({
			lorebookId: 1,
			lorebook: buildLorebook({
				id: 1,
				lorebookBindings: bindings as any,
				worldLoreEntries: [entry]
			})
		})
		return populateLorebookEntryBindings(entry, session).content
	}

	test("a member with no card reads as their own name", () => {
		const member = lorebookBinding({ id: 3, name: "The Ashguard" } as any)
		expect(
			substitute([{ ...member, character: null }], "{{char:3}} guards the gate.")
		).toBe("The Ashguard guards the gate.")
	})

	test("the card's nickname, then its name, win over the member's own", () => {
		const card = character({ name: "Verity Hale", nickname: "Verity" })
		const member = lorebookBinding({
			id: 4,
			characterId: card.id,
			name: "The keeper"
		} as any)
		expect(
			substitute([{ ...member, character: card }], "{{char:4}} waits.")
		).toBe("Verity waits.")
	})

	test("a member with no name and no card leaves the tag as written", () => {
		const member = lorebookBinding({ id: 5, name: "  " } as any)
		expect(
			substitute([{ ...member, character: null }], "{{char:5}} waits.")
		).toBe("{{char:5}} waits.")
	})

	test("a name holding another tag's text is not read as a tag again", () => {
		const a = lorebookBinding({ id: 6, name: "{{char:7}}" } as any)
		const b = lorebookBinding({ id: 7, name: "Brask" } as any)
		expect(
			substitute(
				[
					{ ...a, character: null },
					{ ...b, character: null }
				],
				"{{char:6}} and {{char:7}}"
			)
		).toBe("{{char:7}} and Brask")
	})
})

describe("isCharacterLoreEntryVisible — narrator visibility (decision 3)", () => {
	// A background/NPC binding: bound to no character (persona or otherwise).
	const npcBinding = lorebookBinding({
		id: 9,
		lorebookId: 1,
		characterId: null
	})

	function sessionWithNpcLore() {
		const entry = characterLoreEntry({
			lorebookId: 1,
			lorebookBindingId: npcBinding.id,
			content: "Secret NPC lore."
		})
		return {
			entry,
			session: buildSession({
				lorebookId: 1,
				lorebook: buildLorebook({
					id: 1,
					lorebookBindings: [npcBinding],
					characterLoreEntries: [entry]
				})
			})
		}
	}

	test("a background/NPC-bound entry is visible to the Narrator (no current character)", () => {
		const { entry, session } = sessionWithNpcLore()
		expect(isCharacterLoreEntryVisible(entry, session, null)).toBe(true)
	})

	test("a background/NPC-bound entry is invisible to any specific character", () => {
		const { entry, session } = sessionWithNpcLore()
		expect(isCharacterLoreEntryVisible(entry, session, 42)).toBe(false)
	})

	/**
	 * W3, ruled 2026-09-17. This read `false` for everyone, narrator included,
	 * and the consequence was a disappearance rather than a rule: a
	 * character-lore row nobody had bound yet never retrieved and never
	 * listed, with nothing saying why. A private entry nobody was bound to is
	 * the world's knowledge, not a secret — so it is the narrator's, on
	 * exactly the terms a background/NPC binding already was.
	 */
	const unbound = () => {
		const entry = characterLoreEntry({
			lorebookId: 1,
			lorebookBindingId: null,
			content: "Truly unbound lore."
		})
		return {
			entry,
			session: buildSession({
				lorebookId: 1,
				lorebook: buildLorebook({ id: 1, characterLoreEntries: [entry] })
			})
		}
	}

	test("an entry with no lorebookBindingId is the Narrator's — and the listing's", () => {
		const { entry, session } = unbound()
		expect(isCharacterLoreEntryVisible(entry, session, null)).toBe(true)
	})

	test("an unbound entry is invisible to every specific speaker", () => {
		const { entry, session } = unbound()
		expect(isCharacterLoreEntryVisible(entry, session, 42)).toBe(false)
		// The host's subject for a wired speaker naming nobody in the cast:
		// a value no binding can carry, so "this voice is nobody" does not
		// mean "this voice knows everything".
		expect(isCharacterLoreEntryVisible(entry, session, -1)).toBe(false)
	})

	test("an unbound entry from ANOTHER lorebook is still nobody's", () => {
		const { entry } = unbound()
		const session = buildSession({
			lorebookId: 2,
			lorebook: buildLorebook({ id: 2, characterLoreEntries: [] })
		})
		expect(isCharacterLoreEntryVisible(entry, session, null)).toBe(false)
	})

	test("an unbound entry in a session with no lorebook at all is nobody's", () => {
		const { entry } = unbound()
		const session = buildSession({ lorebookId: 1, lorebook: undefined })
		expect(isCharacterLoreEntryVisible(entry, session, null)).toBe(false)
	})
})

/**
 * A member's cards (plan A25): the linked card and every card a dated change
 * draws them with, on the binding as `memberCards` — what the host's read puts
 * there from `castMemberCards`. A seat holding any of them is that member.
 */
describe("a member's dated card (A25)", () => {
	const young = 11
	const keeper = 12
	const verity = lorebookBinding({
		id: 5,
		lorebookId: 1,
		characterId: young,
		memberCards: [young, keeper]
	} as any)
	const ashguard = lorebookBinding({
		id: 6,
		lorebookId: 1,
		characterId: null,
		memberCards: [keeper + 1]
	} as any)
	const secret = characterLoreEntry({
		lorebookId: 1,
		lorebookBindingId: verity.id,
		name: "Her secret",
		content: "She has the key."
	})
	const orders = characterLoreEntry({
		lorebookId: 1,
		lorebookBindingId: ashguard.id,
		content: "Hold the gate."
	})
	const session = (seated: number) =>
		buildSession({
			lorebookId: 1,
			lorebook: buildLorebook({
				id: 1,
				lorebookBindings: [verity, ashguard],
				characterLoreEntries: [secret, orders]
			}),
			sessionCharacters: [
				{ character: character({ id: seated, name: `Card ${seated}` }) }
			]
		})

	test("a speaker holding either card reads her private lore", () => {
		expect(isCharacterLoreEntryVisible(secret, session(keeper), keeper)).toBe(true)
		expect(isCharacterLoreEntryVisible(secret, session(young), young)).toBe(true)
		expect(isCharacterLoreEntryVisible(secret, session(keeper), 99)).toBe(false)
		expect(isCharacterLoreEntryVisible(secret, session(keeper), null)).toBe(false)
	})

	test("a background member's dated card reads their lore, and so does the narrator", () => {
		expect(isCharacterLoreEntryVisible(orders, session(keeper), keeper + 1)).toBe(true)
		expect(isCharacterLoreEntryVisible(orders, session(keeper), null)).toBe(true)
		expect(isCharacterLoreEntryVisible(orders, session(keeper), keeper)).toBe(false)
	})

})

/**
 * The name a cast member reads as — what the host's lore read puts on an
 * anchored row as `castMember`, and Assemble's `characterLore` prints beside
 * the entry.
 */
describe("castTagName", () => {
	test("a carded member reads as the card's nickname, else its name", () => {
		expect(castTagName({ name: "Verity", character: { name: "Verity Vane", nickname: "Vee" } })).toBe("Vee")
		expect(castTagName({ name: "Verity", character: { name: "Verity Vane" } })).toBe("Verity Vane")
	})

	test("a member with no card reads as its own name, and nobody as empty", () => {
		expect(castTagName({ name: "The Cook", character: null })).toBe("The Cook")
		expect(castTagName({ name: null, character: null })).toBe("")
	})
})
