import { describe, expect, test } from "vitest"
import { getNextCharacterTurn } from "./getNextCharacterTurn"
import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"

// getNextCharacterTurn only reads:
//   sessionMessages: { role, personaId, characterId, isHidden, isNarratorResponse }[]
//   sessionCharacters: { position, isActive, character: { id } }[]
//   sessionPersonas: { persona: { id } }[]
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

function sessionCharacter(
	id: number,
	position: number,
	isActive = true,
	removedAt: Date | null = null
) {
	return { position, isActive, removedAt, character: { id } }
}

function sessionPersona(id: number) {
	return { persona: { id } }
}

function buildSession({
	messages,
	characterIds,
	personaIds
}: {
	messages: any[]
	characterIds: number[]
	personaIds: number[]
}) {
	return {
		sessionMessages: messages,
		sessionCharacters: characterIds.map((id, i) => sessionCharacter(id, i)),
		sessionPersonas: personaIds.map((id) => sessionPersona(id))
	} as any
}

describe("getNextCharacterTurn", () => {
	test("returns null when there are no active characters", () => {
		const session = buildSession({
			messages: [userMsg(1)],
			characterIds: [],
			personaIds: [1]
		})
		expect(getNextCharacterTurn(session)).toBeNull()
	})

	test("returns null when there are no personas", () => {
		const session = buildSession({
			messages: [assistantMsg(1)],
			characterIds: [1],
			personaIds: []
		})
		expect(getNextCharacterTurn(session)).toBeNull()
	})

	// Round-9 audit fix: a soft-removed sessionCharacters row (removedAt set)
	// must never participate in round-robin, even if isActive was somehow
	// still true — belt-and-suspenders alongside getPromptSessionFromDb's own
	// choke-point filter, since this function's input isn't guaranteed to
	// always come from that one query.
	test("never selects a character with removedAt set, even if isActive is true", () => {
		const session = {
			sessionMessages: [],
			sessionCharacters: [
				sessionCharacter(1, 0, true, new Date()),
				sessionCharacter(2, 1, true, null)
			],
			sessionPersonas: [sessionPersona(1)]
		} as any
		// Both have never replied, so ordinarily character 1 (position 0)
		// would be picked first — but it's removed, so character 2 must win.
		expect(getNextCharacterTurn(session)).toBe(2)
	})

	test("returns null when the only character is removed", () => {
		const session = {
			sessionMessages: [],
			sessionCharacters: [sessionCharacter(1, 0, true, new Date())],
			sessionPersonas: [sessionPersona(1)]
		} as any
		expect(getNextCharacterTurn(session)).toBeNull()
	})

	test("a character who has never replied is immediately due, even mid-conversation", () => {
		// castSize = 2 personas + 2 characters = 4, lookback = last 3.
		// Character 20 never speaks anywhere in history, so it is due ahead
		// of the lookback — a character added to an in-progress session gets
		// a first turn at once. Character 20 must win regardless of character
		// 10's recency.
		const messages = [
			assistantMsg(10),
			userMsg(1),
			userMsg(2),
			assistantMsg(10)
		]
		const session = buildSession({
			messages,
			characterIds: [10, 20],
			personaIds: [1, 2]
		})
		expect(getNextCharacterTurn(session)).toBe(20)
	})

	test("no window precondition: a character absent from the last castSize - 1 messages is due even when another cast member is missing from the last castSize messages entirely", () => {
		// Same cast as above. Persona 2 has not spoken anywhere in the last 4
		// messages (persona 1 sent twice in a row). The lookback alone decides:
		// last 3 = [assistant(20), user(1), user(1)]. Character 10 is absent
		// from lookback -> due. Character 20 is present -> not due. A rule
		// that first required every cast member in the last 4 would answer
		// null here, and keep answering null, since nobody could speak to
		// mend the window.
		const messages = [
			assistantMsg(10),
			assistantMsg(20),
			userMsg(1),
			userMsg(1)
		]
		const session = buildSession({
			messages,
			characterIds: [10, 20],
			personaIds: [1, 2]
		})
		expect(getNextCharacterTurn(session)).toBe(10)
	})

	test("minimal session (1 persona + 1 character): character is due once it has no message in the last castSize - 1 (= 1) messages", () => {
		const messages = [assistantMsg(1), userMsg(1)]
		const session = buildSession({
			messages,
			characterIds: [1],
			personaIds: [1]
		})
		expect(getNextCharacterTurn(session)).toBe(1)
	})

	test("minimal session (1 persona + 1 character): character is not due immediately after its own most recent reply", () => {
		const messages = [userMsg(1), assistantMsg(1)]
		const session = buildSession({
			messages,
			characterIds: [1],
			personaIds: [1]
		})
		expect(getNextCharacterTurn(session)).toBeNull()
	})

	test("due rule: a character due if it has no message in the last castSize - 1 messages, verified against a non-due sibling", () => {
		// 2 personas, 2 characters. castSize = 4, lookback = last 3.
		const messages = [
			assistantMsg(10), // character 10's last reply - falls outside lookback
			assistantMsg(20), // character 20's last reply - inside lookback
			userMsg(1),
			userMsg(2)
		]
		const session = buildSession({
			messages,
			characterIds: [10, 20],
			personaIds: [1, 2]
		})
		expect(getNextCharacterTurn(session)).toBe(10)
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
		const session = buildSession({
			messages,
			characterIds: [10, 20, 30],
			personaIds: [1]
		})
		// Lookback (last 3): assistant(10), assistant(20), user(1) -> characters
		// 10 and 20 both replied recently (not due); character 30 - positioned
		// *first* in the array, checked *first* in the loop - is absent from
		// lookback and is the one actually due. This confirms the loop scans all
		// active characters and picks by recency, not by iteration/position order.
		expect(getNextCharacterTurn(session)).toBe(30)
	})

	// Rows written outside the rotation — a character's form-answer lines
	// (written by `adventure-answer` with a characterId), two persona sends
	// in a row, two manual "Trigger Character" presses on one character — can
	// push more than one character out of the lookback at once. Then the
	// "most overdue wins" tie-break in computeDueCharacter's docstring is what
	// decides, and the rotation heals one reply at a time: the furthest-back
	// character goes, then the next, then it is the persona's turn. The three
	// tests below walk each shape through to the persona's turn.

	test("form-answer lines outside the rotation: the furthest-back character is due, then the other, then the persona", () => {
		// Cast of 2 (Elara = 10, Tom = 20) + 1 persona (Rook = 1): castSize 3,
		// lookback = last 2. Elara's two form-answer lines land as her rows,
		// then the persona sends twice. Tom's last reply (index 1) is further
		// back than Elara's (index 3), so Tom is due first.
		const messages = [
			assistantMsg(10), // Elara
			assistantMsg(20), // Tom
			assistantMsg(10), // Elara's form answer
			assistantMsg(10), // Elara's form answer
			userMsg(1),
			userMsg(1)
		]
		const cast = { characterIds: [10, 20], personaIds: [1] }
		expect(getNextCharacterTurn(buildSession({ messages, ...cast }))).toBe(
			20
		)

		// Tom replies. Lookback = [user(1), assistant(20)]: Elara is absent
		// and due.
		messages.push(assistantMsg(20))
		expect(getNextCharacterTurn(buildSession({ messages, ...cast }))).toBe(
			10
		)

		// Elara replies. Lookback = [assistant(20), assistant(10)]: everyone
		// has spoken within the window, so nobody is due — the persona's turn.
		messages.push(assistantMsg(10))
		expect(
			getNextCharacterTurn(buildSession({ messages, ...cast }))
		).toBeNull()
	})

	test("two consecutive persona sends: the furthest-back character is due, then the other, then the persona", () => {
		// castSize 3, lookback = last 2. After [Elara, Tom, persona, persona]
		// the lookback is two persona rows: both characters are absent, and
		// Elara (index 0) is further back than Tom (index 1).
		const messages = [
			assistantMsg(10),
			assistantMsg(20),
			userMsg(1),
			userMsg(1)
		]
		const cast = { characterIds: [10, 20], personaIds: [1] }
		expect(getNextCharacterTurn(buildSession({ messages, ...cast }))).toBe(
			10
		)

		messages.push(assistantMsg(10))
		expect(getNextCharacterTurn(buildSession({ messages, ...cast }))).toBe(
			20
		)

		messages.push(assistantMsg(20))
		expect(
			getNextCharacterTurn(buildSession({ messages, ...cast }))
		).toBeNull()
	})

	test("double manual trigger on one character: the other character is due, then nobody, until the persona speaks", () => {
		// castSize 3, lookback = last 2. Tom is triggered twice by hand after
		// the persona's send. Lookback = [Tom, Tom]: Elara is absent and due.
		const messages = [
			assistantMsg(10),
			userMsg(1),
			assistantMsg(20),
			assistantMsg(20)
		]
		const cast = { characterIds: [10, 20], personaIds: [1] }
		expect(getNextCharacterTurn(buildSession({ messages, ...cast }))).toBe(
			10
		)

		// Elara replies. Lookback = [Tom, Elara]: nobody is due — the
		// persona's turn.
		messages.push(assistantMsg(10))
		expect(
			getNextCharacterTurn(buildSession({ messages, ...cast }))
		).toBeNull()

		// The persona sends. Lookback = [Elara, persona]: Tom is due.
		messages.push(userMsg(1))
		expect(getNextCharacterTurn(buildSession({ messages, ...cast }))).toBe(
			20
		)
	})

	test("Narrator response messages are excluded from the rotation window entirely", () => {
		// 1 persona, 1 character. A narrator-response message (isNarratorResponse,
		// characterId: null) sits between the character's reply and now - it
		// must not occupy a slot in the lookback.
		const messages = [assistantMsg(1), narratorResponseMsg(), userMsg(1)]
		const session = buildSession({
			messages,
			characterIds: [1],
			personaIds: [1]
		})
		// After filtering, effective history is [assistant(1), user(1)] - same
		// as the minimal due case.
		expect(getNextCharacterTurn(session)).toBe(1)
	})

	test("hidden messages are excluded from the rotation window entirely", () => {
		const messages = [
			assistantMsg(1),
			userMsg(1, { isHidden: true }),
			userMsg(1)
		]
		const session = buildSession({
			messages,
			characterIds: [1],
			personaIds: [1]
		})
		// After filtering, effective history is [assistant(1), user(1)].
		expect(getNextCharacterTurn(session)).toBe(1)
	})

	test("inactive characters are never selected, even if otherwise due", () => {
		const messages = [assistantMsg(1), userMsg(1)]
		const session = {
			sessionMessages: messages,
			sessionCharacters: [
				{ position: 0, isActive: false, character: { id: 1 } }
			],
			sessionPersonas: [sessionPersona(1)]
		} as any
		expect(getNextCharacterTurn(session)).toBeNull()
	})
})

// Fixtures below mirror userMsg/assistantMsg/sessionCharacter/sessionPersona/buildSession
// above, but additionally carry a userId on each character/persona so the
// "User-Split" strategy has ownership info to group by.

function sessionCharacterWithUser(
	id: number,
	position: number,
	userId: number,
	isActive = true
) {
	return { position, isActive, character: { id, userId } }
}

function sessionPersonaWithUser(id: number, userId: number) {
	return { persona: { id, userId } }
}

function buildUserSplitSession({
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
		sessionMessages: messages,
		sessionCharacters: characters.map((c) =>
			sessionCharacterWithUser(
				c.id,
				c.position,
				c.userId,
				c.isActive ?? true
			)
		),
		sessionPersonas: personas.map((p) =>
			sessionPersonaWithUser(p.id, p.userId)
		)
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
		const session = buildUserSplitSession({
			messages: [],
			characters: allCharacters,
			personas: allPersonas
		})
		expect(
			getNextCharacterTurn(session, GroupReplyStrategies.USER_SPLIT)
		).toBe(10)
	})

	test("a user's whole sub-cast is offered (never-replied bootstrap) before the rotation ever moves to the next user", () => {
		// Both of user 1's characters have now replied, but neither of user 2's
		// personas nor characters have said anything at all. User 2's group is
		// therefore the most overdue (never active) and becomes due - and within
		// it, its never-replied characters win immediately, same as the
		// never-replied bootstrap rule for the flat "Ordered" strategy.
		const messages = [assistantMsg(10), assistantMsg(20)]
		const session = buildUserSplitSession({
			messages,
			characters: allCharacters,
			personas: allPersonas
		})
		expect(
			getNextCharacterTurn(session, GroupReplyStrategies.USER_SPLIT)
		).toBe(30)
	})

	test("a quiet other user's interleaved messages don't block or skew this user's own due calculation", () => {
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
		// messages ([0]=C1, [2]=P1, [3]=C2), the lookback (last 2) is
		// [P1, C2]: character 10 is absent and due, character 20 is present
		// and not. If user2's
		// interleaved messages weren't filtered out of the scoped history, this
		// would compute a different (wrong) answer.
		const session = buildUserSplitSession({
			messages,
			characters,
			personas
		})
		expect(
			getNextCharacterTurn(session, GroupReplyStrategies.USER_SPLIT)
		).toBe(10)
	})

	test("a user with characters but no persona of their own can still be selected as the due group", () => {
		const characters = [
			{ id: 10, position: 0, userId: 1 }, // user 1: no personas at all
			{ id: 20, position: 1, userId: 2 }
		]
		const personas = [{ id: 2, userId: 2 }]
		const session = buildUserSplitSession({
			messages: [],
			characters,
			personas
		})
		// Both groups tie at "never active" -> ascending userId picks user 1,
		// whose only character (never replied) is immediately due.
		expect(
			getNextCharacterTurn(session, GroupReplyStrategies.USER_SPLIT)
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
		const session = buildUserSplitSession({
			messages: [],
			characters,
			personas
		})
		expect(
			getNextCharacterTurn(session, GroupReplyStrategies.USER_SPLIT)
		).toBe(11)
	})
})
