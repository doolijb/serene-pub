import { describe, expect, test } from "vitest"
import { getNextCharacterTurn } from "./getNextCharacterTurn"
import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"

// getNextCharacterTurn only reads:
//   chatMessages: { role, personaId, characterId, isHidden, isNarratorResponse }[]
//   chatCharacters: { position, isActive, character: { id } }[]
//   chatPersonas: { persona: { id } }[]
// so fixtures below are plain objects with exactly those fields, cast via
// `as any` since the real Select* types carry many more required columns.

function userMsg(personaId: number, overrides: Record<string, any> = {}) {
	return {
		role: "user",
		personaId,
		characterId: null,
		isHidden: false,
		isNarratorResponse: false,
		...overrides
	}
}

function assistantMsg(
	characterId: number,
	overrides: Record<string, any> = {}
) {
	return {
		role: "assistant",
		personaId: null,
		characterId,
		isHidden: false,
		isNarratorResponse: false,
		...overrides
	}
}

function narratorResponseMsg(overrides: Record<string, any> = {}) {
	return {
		role: "assistant",
		personaId: null,
		characterId: null,
		isHidden: false,
		isNarratorResponse: true,
		...overrides
	}
}

function chatCharacter(
	id: number,
	position: number,
	isActive = true,
	removedAt: Date | null = null
) {
	return { position, isActive, removedAt, character: { id } }
}

function chatPersona(id: number) {
	return { persona: { id } }
}

function buildChat({
	messages,
	characterIds,
	personaIds
}: {
	messages: any[]
	characterIds: number[]
	personaIds: number[]
}) {
	return {
		chatMessages: messages,
		chatCharacters: characterIds.map((id, i) => chatCharacter(id, i)),
		chatPersonas: personaIds.map((id) => chatPersona(id))
	} as any
}

describe("getNextCharacterTurn", () => {
	test("returns null when there are no active characters", () => {
		const chat = buildChat({
			messages: [userMsg(1)],
			characterIds: [],
			personaIds: [1]
		})
		expect(getNextCharacterTurn(chat)).toBeNull()
	})

	test("returns null when there are no personas", () => {
		const chat = buildChat({
			messages: [assistantMsg(1)],
			characterIds: [1],
			personaIds: []
		})
		expect(getNextCharacterTurn(chat)).toBeNull()
	})

	// Round-9 audit fix: a soft-removed chatCharacters row (removedAt set)
	// must never participate in round-robin, even if isActive was somehow
	// still true — belt-and-suspenders alongside getPromptChatFromDb's own
	// choke-point filter, since this function's input isn't guaranteed to
	// always come from that one query.
	test("never selects a character with removedAt set, even if isActive is true", () => {
		const chat = {
			chatMessages: [],
			chatCharacters: [
				chatCharacter(1, 0, true, new Date()),
				chatCharacter(2, 1, true, null)
			],
			chatPersonas: [chatPersona(1)]
		} as any
		// Both have never replied, so ordinarily character 1 (position 0)
		// would be picked first — but it's removed, so character 2 must win.
		expect(getNextCharacterTurn(chat)).toBe(2)
	})

	test("returns null when the only character is removed", () => {
		const chat = {
			chatMessages: [],
			chatCharacters: [chatCharacter(1, 0, true, new Date())],
			chatPersonas: [chatPersona(1)]
		} as any
		expect(getNextCharacterTurn(chat)).toBeNull()
	})

	test("a character who has never replied is immediately due, even mid-conversation (not stuck behind the healthy-window check)", () => {
		// castSize = 2 personas + 2 characters = 4. Window = last 4 messages.
		// Character 20 never speaks anywhere in history. The old behavior
		// required every cast member to already appear in the window before
		// anyone could be picked, which made this permanently null — a
		// character added to an in-progress chat could never get a first
		// turn. Character 20 must win regardless of character 10's recency.
		const messages = [
			assistantMsg(10),
			userMsg(1),
			userMsg(2),
			assistantMsg(10)
		]
		const chat = buildChat({
			messages,
			characterIds: [10, 20],
			personaIds: [1, 2]
		})
		expect(getNextCharacterTurn(chat)).toBe(20)
	})

	test("healthy window precondition: a due character is only selected once every persona and character has appeared within the last castSize messages", () => {
		// Same cast as above, but now every cast member (persona 1, persona 2,
		// character 10, character 20) appears somewhere in the last 4 messages.
		const messages = [
			assistantMsg(10),
			assistantMsg(20),
			userMsg(1),
			userMsg(2)
		]
		const chat = buildChat({
			messages,
			characterIds: [10, 20],
			personaIds: [1, 2]
		})
		// lookback = last 3: [assistant(20), user(1), user(2)]. Character 10 is
		// absent from lookback -> due. Character 20 is present -> not due.
		expect(getNextCharacterTurn(chat)).toBe(10)
	})

	test("minimal chat (1 persona + 1 character): character is due once it has no message in the last castSize - 1 (= 1) messages", () => {
		const messages = [assistantMsg(1), userMsg(1)]
		const chat = buildChat({
			messages,
			characterIds: [1],
			personaIds: [1]
		})
		expect(getNextCharacterTurn(chat)).toBe(1)
	})

	test("minimal chat (1 persona + 1 character): character is not due immediately after its own most recent reply", () => {
		const messages = [userMsg(1), assistantMsg(1)]
		const chat = buildChat({
			messages,
			characterIds: [1],
			personaIds: [1]
		})
		expect(getNextCharacterTurn(chat)).toBeNull()
	})

	test("due rule: a character due if it has no message in the last castSize - 1 messages, verified against a non-due sibling", () => {
		// 2 personas, 2 characters. castSize = 4, lookback = last 3.
		const messages = [
			assistantMsg(10), // character 10's last reply - falls outside lookback
			assistantMsg(20), // character 20's last reply - inside lookback
			userMsg(1),
			userMsg(2)
		]
		const chat = buildChat({
			messages,
			characterIds: [10, 20],
			personaIds: [1, 2]
		})
		expect(getNextCharacterTurn(chat)).toBe(10)
	})

	test("the due scan is not simply 'first active character' - a later-position character is correctly identified as due while earlier-position ones are not", () => {
		// 1 persona, 3 characters at positions 0 (id 10), 1 (id 20), 2 (id 30).
		// castSize = 4, lookback = last 3.
		const messages = [
			assistantMsg(30), // character 30's only reply - falls outside lookback
			assistantMsg(10),
			assistantMsg(20),
			userMsg(1)
		]
		const chat = buildChat({
			messages,
			characterIds: [10, 20, 30],
			personaIds: [1]
		})
		// Healthy window (last 4, i.e. the whole array): all of persona 1,
		// character 10, 20, and 30 appear -> healthy.
		// Lookback (last 3): assistant(10), assistant(20), user(1) -> characters
		// 10 and 20 both replied recently (not due); character 30 - positioned
		// *first* in the array, checked *first* in the loop - is absent from
		// lookback and is the one actually due. This confirms the loop scans all
		// active characters and picks by recency, not by iteration/position order.
		expect(getNextCharacterTurn(chat)).toBe(30)
	})

	// Note on the "most overdue wins" tie-break described in getNextCharacterTurn's
	// docstring: exhaustive brute-force search (2-4 cast members, message
	// histories up to length 8, every combination of user/assistant turns) found
	// no input for which more than one active character is simultaneously "due"
	// while the healthy-window precondition holds. This is a structural
	// invariant of the implementation: `recentWindow` (last castSize messages)
	// and `lookback` (last castSize - 1 messages) are both suffixes of the same
	// `messages` array, so they differ by at most exactly one message (the
	// window's oldest entry). Since a due character's only qualifying
	// window-membership message must be that single differing slot, at most one
	// active character can satisfy "present in window, absent from lookback" at
	// once. The dueLastReplyIndex comparison loop is therefore defensive/
	// future-proofing code under the current one-message-per-turn model; the
	// test above instead verifies its selection is correct and
	// position-independent for the one due candidate that *can* legitimately
	// arise.

	test("Narrator response messages are excluded from the rotation window entirely", () => {
		// 1 persona, 1 character. A narrator-response message (isNarratorResponse,
		// characterId: null) sits between the character's reply and now - it
		// must not occupy a slot in the healthy-window/lookback checks.
		const messages = [assistantMsg(1), narratorResponseMsg(), userMsg(1)]
		const chat = buildChat({
			messages,
			characterIds: [1],
			personaIds: [1]
		})
		// After filtering, effective history is [assistant(1), user(1)] - same
		// as the minimal due case.
		expect(getNextCharacterTurn(chat)).toBe(1)
	})

	test("hidden messages are excluded from the rotation window entirely", () => {
		const messages = [
			assistantMsg(1),
			userMsg(1, { isHidden: true }),
			userMsg(1)
		]
		const chat = buildChat({
			messages,
			characterIds: [1],
			personaIds: [1]
		})
		// After filtering, effective history is [assistant(1), user(1)].
		expect(getNextCharacterTurn(chat)).toBe(1)
	})

	test("inactive characters are never selected, even if otherwise due", () => {
		const messages = [assistantMsg(1), userMsg(1)]
		const chat = {
			chatMessages: messages,
			chatCharacters: [
				{ position: 0, isActive: false, character: { id: 1 } }
			],
			chatPersonas: [chatPersona(1)]
		} as any
		expect(getNextCharacterTurn(chat)).toBeNull()
	})
})

// Fixtures below mirror userMsg/assistantMsg/chatCharacter/chatPersona/buildChat
// above, but additionally carry a userId on each character/persona so the
// "User-Split" strategy has ownership info to group by.

function chatCharacterWithUser(
	id: number,
	position: number,
	userId: number,
	isActive = true
) {
	return { position, isActive, character: { id, userId } }
}

function chatPersonaWithUser(id: number, userId: number) {
	return { persona: { id, userId } }
}

function buildUserSplitChat({
	messages,
	characters,
	personas
}: {
	messages: any[]
	characters: {
		id: number
		position: number
		userId: number
		isActive?: boolean
	}[]
	personas: { id: number; userId: number }[]
}) {
	return {
		chatMessages: messages,
		chatCharacters: characters.map((c) =>
			chatCharacterWithUser(
				c.id,
				c.position,
				c.userId,
				c.isActive ?? true
			)
		),
		chatPersonas: personas.map((p) => chatPersonaWithUser(p.id, p.userId))
	} as any
}

describe("getNextCharacterTurn - User-Split strategy", () => {
	// Worked example from the feature request: user 1 owns 1 persona (id 1)
	// and 2 characters (ids 10, 20); user 2 owns 2 personas (ids 2, 3) and 2
	// characters (ids 30, 40). A full cycle should complete user 1's whole
	// sub-cast before moving to user 2's, rather than flattening everyone's
	// personas/characters together.
	const user1Characters = [
		{ id: 10, position: 0, userId: 1 },
		{ id: 20, position: 1, userId: 1 }
	]
	const user2Characters = [
		{ id: 30, position: 2, userId: 2 },
		{ id: 40, position: 3, userId: 2 }
	]
	const allCharacters = [...user1Characters, ...user2Characters]
	const allPersonas = [
		{ id: 1, userId: 1 },
		{ id: 2, userId: 2 },
		{ id: 3, userId: 2 }
	]

	test("bootstraps with the lowest userId's group, then the first character by position within it", () => {
		const chat = buildUserSplitChat({
			messages: [],
			characters: allCharacters,
			personas: allPersonas
		})
		expect(
			getNextCharacterTurn(chat, GroupReplyStrategies.USER_SPLIT)
		).toBe(10)
	})

	test("a user's whole sub-cast is offered (never-replied bootstrap) before the rotation ever moves to the next user", () => {
		// Both of user 1's characters have now replied, but neither of user 2's
		// personas nor characters have said anything at all. User 2's group is
		// therefore the most overdue (never active) and becomes due - and within
		// it, its never-replied characters win immediately, same as the
		// never-replied bootstrap rule for the flat "Ordered" strategy.
		const messages = [assistantMsg(10), assistantMsg(20)]
		const chat = buildUserSplitChat({
			messages,
			characters: allCharacters,
			personas: allPersonas
		})
		expect(
			getNextCharacterTurn(chat, GroupReplyStrategies.USER_SPLIT)
		).toBe(30)
	})

	test("a quiet other user's interleaved messages don't block or skew this user's own healthy-window/due calculation", () => {
		// user1: persona 1, characters 10 (pos 0) and 20 (pos 1) - castSize 3.
		// user2: persona 2, character 30 (pos 2) - castSize 2.
		const characters = [
			{ id: 10, position: 0, userId: 1 },
			{ id: 20, position: 1, userId: 1 },
			{ id: 30, position: 2, userId: 2 }
		]
		const personas = [
			{ id: 1, userId: 1 },
			{ id: 2, userId: 2 }
		]
		const messages = [
			assistantMsg(10), // [0] user1: C1's only reply
			assistantMsg(30), // [1] user2: C3 replies
			userMsg(1), // [2] user1: P1 speaks
			assistantMsg(20), // [3] user1: C2 replies
			assistantMsg(30), // [4] user2: C3 replies again, keeping user2 "recent"
			userMsg(2) // [5] user2: P2 speaks, now user2's last activity (5) > user1's (3)
		]
		// user1's last activity is index 3, user2's is index 5 - user1 is more
		// overdue and becomes the due group. Scoped to only user1's own
		// messages ([0]=C1, [2]=P1, [3]=C2), the rotation is healthy (everyone
		// in {persona 1, char 10, char 20} appears in that 3-message window),
		// and character 10's last reply is further back (scoped index 0) than
		// character 20's (scoped index 2) - so 10 is due, not 20. If user2's
		// interleaved messages weren't filtered out of the scoped history, this
		// would compute a different (wrong) answer.
		const chat = buildUserSplitChat({ messages, characters, personas })
		expect(
			getNextCharacterTurn(chat, GroupReplyStrategies.USER_SPLIT)
		).toBe(10)
	})

	test("a user with characters but no persona of their own can still be selected as the due group", () => {
		const characters = [
			{ id: 10, position: 0, userId: 1 }, // user 1: no personas at all
			{ id: 20, position: 1, userId: 2 }
		]
		const personas = [{ id: 2, userId: 2 }]
		const chat = buildUserSplitChat({ messages: [], characters, personas })
		// Both groups tie at "never active" -> ascending userId picks user 1,
		// whose only character (never replied) is immediately due.
		expect(
			getNextCharacterTurn(chat, GroupReplyStrategies.USER_SPLIT)
		).toBe(10)
	})

	test("due-group tie-break sorts by ascending userId, independent of position/insertion order", () => {
		const characters = [
			{ id: 99, position: 0, userId: 5 },
			{ id: 11, position: 1, userId: 2 }
		]
		const personas = [
			{ id: 1, userId: 5 },
			{ id: 2, userId: 2 }
		]
		const chat = buildUserSplitChat({ messages: [], characters, personas })
		expect(
			getNextCharacterTurn(chat, GroupReplyStrategies.USER_SPLIT)
		).toBe(11)
	})
})
