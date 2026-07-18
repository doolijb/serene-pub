import { describe, expect, test } from "vitest"
import { getNextCharacterTurn } from "./getNextCharacterTurn"

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

function chatCharacter(id: number, position: number, isActive = true) {
	return { position, isActive, character: { id } }
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

	test("returns null when an active character has no message in the healthy window, even if others are due (unhealthy rotation)", () => {
		// castSize = 2 personas + 2 characters = 4. Window = last 4 messages.
		// Character 20 never speaks anywhere in history, so it can never appear
		// in the window -> the rotation is never "healthy" -> null forever,
		// regardless of character 10's recency.
		const messages = [assistantMsg(10), userMsg(1), userMsg(2), assistantMsg(10)]
		const chat = buildChat({
			messages,
			characterIds: [10, 20],
			personaIds: [1, 2]
		})
		expect(getNextCharacterTurn(chat)).toBeNull()
	})

	test("healthy window precondition: a due character is only selected once every persona and character has appeared within the last castSize messages", () => {
		// Same cast as above, but now every cast member (persona 1, persona 2,
		// character 10, character 20) appears somewhere in the last 4 messages.
		const messages = [assistantMsg(10), assistantMsg(20), userMsg(1), userMsg(2)]
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
		const messages = [assistantMsg(1), userMsg(1, { isHidden: true }), userMsg(1)]
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
