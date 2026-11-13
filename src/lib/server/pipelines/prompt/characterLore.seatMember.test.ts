import { describe, expect, test } from "vitest"
import { isCharacterLoreEntryVisible } from "$lib/server/pipelines/prompt/characterLore"
import {
	buildSession,
	buildLorebook,
	characterLoreEntry,
	lorebookBinding
} from "$lib/server/pipelines/testing/fixtures"

describe("isCharacterLoreEntryVisible — a player seat that seats the member (seat-cast S2)", () => {
	const binding = lorebookBinding({ id: 9, lorebookId: 1, characterId: null })
	const entry = characterLoreEntry({
		lorebookId: 1,
		lorebookBindingId: binding.id,
		content: "The player's own secret."
	})
	const withSeat = (seat: Record<string, unknown>) =>
		buildSession({
			lorebookId: 1,
			lorebook: buildLorebook({
				id: 1,
				lorebookBindings: [binding],
				characterLoreEntries: [entry]
			}),
			sessionPersonas: [seat as never]
		})

	test("visible to every speaker when a player seat seats the binding, whatever card it holds", () => {
		const session = withSeat({ castMemberId: binding.id, persona: null })
		expect(isCharacterLoreEntryVisible(entry, session, 42)).toBe(true)
		expect(isCharacterLoreEntryVisible(entry, session, null)).toBe(true)
	})

	test("a player seat seating another member leaves a background binding to the narrator", () => {
		const session = withSeat({ castMemberId: 77, persona: null })
		expect(isCharacterLoreEntryVisible(entry, session, 42)).toBe(false)
		expect(isCharacterLoreEntryVisible(entry, session, null)).toBe(true)
	})
})
