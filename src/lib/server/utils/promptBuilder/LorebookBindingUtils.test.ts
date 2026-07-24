import { describe, expect, test } from "vitest"
import { populateLorebookEntryBindings } from "./LorebookBindingUtils"
import {
	buildChat,
	buildLorebook,
	character,
	lorebookBinding,
	worldLoreEntry
} from "./infillTestUtils"

describe("populateLorebookEntryBindings — @@decorator stripping", () => {
	test("strips a leading @@decorator line when the entry's lorebook matches the chat", () => {
		const entry = worldLoreEntry({
			lorebookId: 1,
			content: "@@position before_char\nActual lore content."
		})
		const chat = buildChat({
			lorebookId: 1,
			lorebook: buildLorebook({ id: 1, worldLoreEntries: [entry] })
		})
		const result = populateLorebookEntryBindings(entry, chat)
		expect(result.content).toBe("Actual lore content.")
	})

	test("still strips decorators even when the entry's lorebook doesn't match the chat (early-return path)", () => {
		// chat.lorebook.id (2) !== entry.lorebookId (1) — populateLorebookEntryBindings
		// returns early before any {{char:#}} binding substitution, but decorator
		// stripping must still have applied, since it runs unconditionally up front.
		const entry = worldLoreEntry({
			lorebookId: 1,
			content: "@@dont_activate\nActual lore content."
		})
		const chat = buildChat({
			lorebookId: 2,
			lorebook: buildLorebook({ id: 2 })
		})
		const result = populateLorebookEntryBindings(entry, chat)
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
		const chat = buildChat({
			lorebookId: 1,
			lorebook: buildLorebook({
				id: 1,
				lorebookBindings: [{ ...binding, character: char, persona: null }],
				worldLoreEntries: [entry]
			})
		})
		const result = populateLorebookEntryBindings(entry, chat)
		expect(result.content).toBe("Kestrel lives here.")
	})

	test("entries with no decorator lines render unaffected", () => {
		const entry = worldLoreEntry({
			lorebookId: 1,
			content: "Plain lore content with no decorators."
		})
		const chat = buildChat({
			lorebookId: 1,
			lorebook: buildLorebook({ id: 1, worldLoreEntries: [entry] })
		})
		const result = populateLorebookEntryBindings(entry, chat)
		expect(result.content).toBe("Plain lore content with no decorators.")
	})
})
