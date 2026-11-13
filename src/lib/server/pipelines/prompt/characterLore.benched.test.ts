import { describe, expect, test } from "vitest"
import { isCharacterLoreEntryVisible } from "$lib/server/pipelines/prompt/characterLore"
import {
	buildSession,
	buildLorebook,
	characterLoreEntry,
	lorebookBinding
} from "$lib/server/pipelines/testing/fixtures"

/**
 * Owner 2026-11-10: benched is the one lore rule. A member whose seat is in play reads
 * as seated (its own lore); a benched one reads as background (the narrator's). The
 * binding's `nodeState` is not read; a removed or benched player seat unlocks nothing.
 */
describe("isCharacterLoreEntryVisible — benched reads as background", () => {
	const CARD = 3
	const MEMBER = 9
	const entry = characterLoreEntry({ lorebookId: 1, lorebookBindingId: MEMBER, content: "Its secret." })
	const session = (opts: {
		nodeState?: string
		seated?: boolean
		playerSeat?: Record<string, unknown>
	}) =>
		Object.assign(
			buildSession({
				lorebookId: 1,
				lorebook: buildLorebook({
					id: 1,
					lorebookBindings: [
						Object.assign(
							lorebookBinding({ id: MEMBER, lorebookId: 1, characterId: CARD }),
							opts.nodeState ? { nodeState: opts.nodeState } : {}
						)
					],
					characterLoreEntries: [entry]
				}),
				...(opts.playerSeat
					? { sessionPersonas: [{ castMemberId: MEMBER, persona: null, ...opts.playerSeat }] }
					: {})
			} as never),
			{ seatedMemberIds: opts.seated === false ? [] : [MEMBER] }
		)

	test("(a) a seat in play: its own seat reads it, the narrator does not", () => {
		const s = session({})
		expect(isCharacterLoreEntryVisible(entry, s, CARD, null)).toBe(true)
		expect(isCharacterLoreEntryVisible(entry, s, null, null)).toBe(false)
		expect(isCharacterLoreEntryVisible(entry, s, 42, null)).toBe(false)
	})

	test("(b) benched (no seat in play): the narrator reads it, its own seat does not", () => {
		const s = session({ seated: false })
		// An own-seat read still matches by card; the host never asks for a benched seat's turn,
		// so the contract here is the narrator's side.
		expect(isCharacterLoreEntryVisible(entry, s, null, null)).toBe(true)
		expect(isCharacterLoreEntryVisible(entry, s, 42, null)).toBe(false)
	})

	test("(c) a deceased nodeState on a seat in play is ignored: its own seat reads it, the narrator does not", () => {
		const s = session({ nodeState: "deceased" })
		expect(isCharacterLoreEntryVisible(entry, s, CARD, null)).toBe(true)
		expect(isCharacterLoreEntryVisible(entry, s, null, null)).toBe(false)
		expect(isCharacterLoreEntryVisible(entry, s, 42, null)).toBe(false)
	})

	test("(d) a removed player seat unlocks nothing; the narrator reads the background member", () => {
		const s = session({ seated: false, playerSeat: { removedAt: new Date() } })
		expect(isCharacterLoreEntryVisible(entry, s, 42, null)).toBe(false)
		expect(isCharacterLoreEntryVisible(entry, s, null, 77)).toBe(false)
		expect(isCharacterLoreEntryVisible(entry, s, null, null)).toBe(true)
	})

	test("(e) a benched player seat unlocks nothing; the narrator reads the background member", () => {
		const s = session({ seated: false, playerSeat: { isActive: false } })
		expect(isCharacterLoreEntryVisible(entry, s, 42, null)).toBe(false)
		expect(isCharacterLoreEntryVisible(entry, s, null, 77)).toBe(false)
		expect(isCharacterLoreEntryVisible(entry, s, null, null)).toBe(true)
	})

	test("a player seat in play still unlocks the member for every speaker", () => {
		const s = session({ playerSeat: { isActive: true, removedAt: null } })
		expect(isCharacterLoreEntryVisible(entry, s, 42, null)).toBe(true)
		expect(isCharacterLoreEntryVisible(entry, s, null, 77)).toBe(true)
	})
})
