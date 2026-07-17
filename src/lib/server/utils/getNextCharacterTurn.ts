/**
 * Determine which active character (if any) is due for a turn right now.
 *
 * Rule: let N = active personas + active characters in the chat. Look at the
 * last N (non-hidden, non-World-Response) messages — if every cast member
 * (every persona, every character) appears at least once in that window, the
 * rotation is "healthy"
 * (nobody's been silently dropped from the conversation). A character is due
 * if the rotation is healthy AND they have no message in the last N-1 of
 * those messages. When more than one character is due, whoever's most recent
 * reply is furthest back (or who has never replied at all) goes first.
 *
 * This is intentionally stateless — recomputed fresh from message history on
 * every call, with no persisted "whose turn in this cycle" pointer. A manual
 * out-of-turn trigger (the "Trigger Character" picker, which bypasses this
 * function entirely and picks a specific character directly) can't corrupt
 * anything: the next automatic check just re-reads the updated history and
 * picks correctly from it. The previous implementation reset a "who's replied"
 * pool to empty on *any* persona message and always rescanned character
 * eligibility from position 0 — that's what let a manually-triggered
 * character get re-offered immediately afterward while another character,
 * still owed a turn from an earlier interrupted cycle, was silently skipped.
 */
export function getNextCharacterTurn(chat: {
	chatMessages: SelectChatMessage[]
	chatCharacters: (SelectChatCharacter & { character: SelectCharacter })[]
	chatPersonas: (SelectChatPersona & { persona: SelectPersona })[]
}): number | null {
	if (!chat.chatCharacters?.length || !chat.chatPersonas?.length) {
		return null
	}

	// Sort by position (normalizing missing positions to array index), then
	// keep only active characters.
	const activeCharacters = chat.chatCharacters
		.slice()
		.map((cc, index) => ({
			...cc,
			normalizedPosition: cc.position ?? index
		}))
		.sort((a, b) => a.normalizedPosition - b.normalizedPosition)
		.filter((cc) => cc.isActive)

	if (activeCharacters.length === 0) return null

	const personaIds = chat.chatPersonas.map((cp) => cp.persona.id)
	const characterIds = activeCharacters.map((cc) => cc.character.id)
	const castSize = personaIds.length + characterIds.length

	// World Response messages (isWorldResponse, characterId: null) are narration,
	// not a cast member's turn — excluded entirely rather than just failing to
	// match a character id, so they can't occupy a slot in the recency windows
	// below and skew the healthy-window/due checks for the real cast.
	const messages = chat.chatMessages.filter(
		(m) => !m.isHidden && !m.isWorldResponse
	)

	// Healthy-window check: has every cast member spoken at least once in the
	// last `castSize` messages?
	const recentWindow = messages.slice(Math.max(0, messages.length - castSize))
	const everyoneRecentlyActive =
		personaIds.every((pid) =>
			recentWindow.some(
				(msg) => msg.role === "user" && msg.personaId === pid
			)
		) &&
		characterIds.every((cid) =>
			recentWindow.some(
				(msg) => msg.role === "assistant" && msg.characterId === cid
			)
		)

	if (!everyoneRecentlyActive) return null

	// A character is due if they have no message in the last `castSize - 1`
	// messages — i.e. their last reply (if any) is at or before the edge of
	// the healthy window.
	const lookback = messages.slice(
		Math.max(0, messages.length - (castSize - 1))
	)

	function lastReplyIndex(characterId: number): number {
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i]
			if (msg.role === "assistant" && msg.characterId === characterId) {
				return i
			}
		}
		return -1
	}

	let dueCharacterId: number | null = null
	let dueLastReplyIndex = Infinity

	for (const cc of activeCharacters) {
		const characterId = cc.character.id
		const repliedRecently = lookback.some(
			(msg) => msg.role === "assistant" && msg.characterId === characterId
		)
		if (repliedRecently) continue

		const idx = lastReplyIndex(characterId)
		if (idx < dueLastReplyIndex) {
			dueLastReplyIndex = idx
			dueCharacterId = characterId
		}
	}

	return dueCharacterId
}
