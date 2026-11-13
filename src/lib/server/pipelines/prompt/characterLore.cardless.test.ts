import { describe, expect, test } from "vitest"
import { isCharacterLoreEntryVisible } from "$lib/server/pipelines/prompt/characterLore"
import {
	buildSession,
	buildLorebook,
	characterLoreEntry,
	lorebookBinding
} from "$lib/server/pipelines/testing/fixtures"

/** ★4 (owner 2026-11-08): a background member is one not seated in this session. */
describe("isCharacterLoreEntryVisible — card-less speakers and background = not seated", () => {
	// M: card-less, seated. B1: carded, not seated. B2: card-less, not seated.
	const M = lorebookBinding({ id: 9, lorebookId: 1, characterId: null })
	const B1 = lorebookBinding({ id: 31, lorebookId: 1, characterId: 3 })
	const B2 = lorebookBinding({ id: 32, lorebookId: 1, characterId: null })
	const entryOf = (b: { id: number }, content: string) =>
		characterLoreEntry({ lorebookId: 1, lorebookBindingId: b.id, content })
	const eM = entryOf(M, "M's secret.")
	const eB1 = entryOf(B1, "B1's secret.")
	const eB2 = entryOf(B2, "B2's secret.")
	const unbound = characterLoreEntry({
		lorebookId: 1,
		lorebookBindingId: null as never,
		content: "World."
	})
	const session = (seatedMemberIds?: readonly number[]) =>
		Object.assign(
			buildSession({
				lorebookId: 1,
				lorebook: buildLorebook({
					id: 1,
					lorebookBindings: [M, B1, B2],
					characterLoreEntries: [eM, eB1, eB2]
				}),
				sessionCharacters: [
					{ castMemberId: M.id, character: null } as never
				]
			}),
			seatedMemberIds ? { seatedMemberIds } : {}
		)

	test("the card-less seat speaking (currentCastMemberId) sees its own member's entry", () => {
		expect(
			isCharacterLoreEntryVisible(eM, session([M.id]), null, M.id)
		).toBe(true)
	})

	test("another speaker does not see it", () => {
		expect(isCharacterLoreEntryVisible(eM, session([M.id]), 42, null)).toBe(
			false
		)
		expect(isCharacterLoreEntryVisible(eM, session([M.id]), null, 77)).toBe(
			false
		)
	})

	test("the narrator does not see a seated member's entry", () => {
		expect(
			isCharacterLoreEntryVisible(eM, session([M.id]), null, null)
		).toBe(false)
	})

	test("the narrator sees a not-seated member's entry, carded or card-less", () => {
		expect(
			isCharacterLoreEntryVisible(eB1, session([M.id]), null, null)
		).toBe(true)
		expect(
			isCharacterLoreEntryVisible(eB2, session([M.id]), null, null)
		).toBe(true)
	})

	test("no speaker sees a not-seated member's entry", () => {
		for (const e of [eB1, eB2]) {
			expect(
				isCharacterLoreEntryVisible(e, session([M.id]), 42, null)
			).toBe(false)
			expect(
				isCharacterLoreEntryVisible(e, session([M.id]), null, M.id)
			).toBe(false)
		}
	})

	test("an unbound entry is the narrator's only, a card-less speaker included", () => {
		expect(
			isCharacterLoreEntryVisible(unbound, session([M.id]), null, null)
		).toBe(true)
		expect(
			isCharacterLoreEntryVisible(unbound, session([M.id]), null, M.id)
		).toBe(false)
		expect(
			isCharacterLoreEntryVisible(unbound, session([M.id]), 42, null)
		).toBe(false)
	})

	test("without seatedMemberIds the old rule holds: a card-less binding is the narrator's, a carded one is not", () => {
		expect(isCharacterLoreEntryVisible(eB2, session(), null, null)).toBe(
			true
		)
		expect(isCharacterLoreEntryVisible(eM, session(), null, null)).toBe(
			true
		)
		expect(isCharacterLoreEntryVisible(eB1, session(), null, null)).toBe(
			false
		)
		expect(isCharacterLoreEntryVisible(eB2, session(), 42, null)).toBe(
			false
		)
	})
})
