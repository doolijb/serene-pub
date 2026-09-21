import { describe, expect, test } from "vitest"
import {
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
