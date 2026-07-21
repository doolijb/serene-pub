import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"

type ActiveCharacter = SelectChatCharacter & {
	character: SelectCharacter
	normalizedPosition: number
}

/**
 * Core due-character computation, shared by the flat "Ordered" strategy and
 * each per-user scope of the "User-Split" strategy (see getNextCharacterTurn
 * below) — the only difference between the two is *which* characters,
 * personas, and message history get passed in here: the whole chat's cast
 * for Ordered, or a single user's own slice of it for User-Split.
 *
 * Rule: a character who has never replied at all (within the given
 * `messages`) is always immediately due — this covers both a brand-new chat
 * and a character newly added to one that's already in progress. Otherwise,
 * let N = personaIds.length + characterIds.length. Look at the last N
 * messages — if every cast member appears at least once in that window, the
 * rotation is "healthy" (nobody's been silently dropped from the
 * conversation). A character is due if the rotation is healthy AND they have
 * no message in the last N-1 of those messages. When more than one character
 * is due, whoever's most recent reply is furthest back goes first.
 */
function computeDueCharacter({
	activeCharacters,
	personaIds,
	characterIds,
	messages
}: {
	activeCharacters: ActiveCharacter[]
	personaIds: number[]
	characterIds: number[]
	messages: SelectChatMessage[]
}): number | null {
	const castSize = personaIds.length + characterIds.length

	function lastReplyIndex(characterId: number): number {
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i]
			if (msg.role === "assistant" && msg.characterId === characterId) {
				return i
			}
		}
		return -1
	}

	// A character who has never replied at all is always due immediately,
	// regardless of the healthy-window check below — that check requires
	// every active character to already have a message in the recent window,
	// which a character who has never spoken can never satisfy on their own.
	// This covers both a brand-new chat (nobody in the cast has replied yet,
	// so no configured first/greeting message exists) and a character added
	// to an already-established chat (everyone else may be "healthy," but the
	// newcomer would otherwise be permanently skipped). Among characters
	// who've never replied, pick by position, so a brand-new chat still
	// starts with its first-listed character.
	const neverReplied = activeCharacters.filter(
		(cc) => lastReplyIndex(cc.character.id) === -1
	)
	if (neverReplied.length > 0) {
		return neverReplied[0].character.id
	}

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

/**
 * "User-Split" strategy: instead of one flat rotation across the whole
 * chat's cast, group personas and characters by the user who owns them
 * (persona.userId / character.userId), and let one user's own sub-cast
 * (their persona(s), then their characters) complete a full turn before the
 * next user's sub-cast gets one — rather than interleaving everyone's
 * personas and characters together regardless of who they belong to. E.g.
 * with user A (1 persona, 2 characters) and user B (2 personas, 2
 * characters), a full cycle goes A-persona, A-char, A-char, B-persona,
 * B-persona, B-char, B-char — not persona,persona,persona,char,char,char,char
 * like the flat "Ordered" strategy would produce.
 *
 * Which user is "due" is picked the same way computeDueCharacter picks a
 * due character: whoever's whole sub-cast (any of their personas or
 * characters) was least recently active in the full message history —
 * never-active counts as most overdue, ties broken by ascending userId so a
 * brand-new chat deterministically starts with its lowest-id user. Once a
 * user is selected, the character decision itself reuses
 * computeDueCharacter unchanged, but scoped to only that user's own
 * characters/personas and only their own slice of the message history — so
 * a quiet user elsewhere in the chat can never block or skew whether this
 * user's own characters are due.
 */
function getNextCharacterTurnUserSplit({
	activeCharacters,
	validChatPersonas,
	messages
}: {
	activeCharacters: ActiveCharacter[]
	validChatPersonas: (SelectChatPersona & { persona: SelectPersona })[]
	messages: SelectChatMessage[]
}): number | null {
	type UserGroup = {
		userId: number
		characters: ActiveCharacter[]
		personaIds: number[]
	}
	const groups = new Map<number, UserGroup>()
	function groupFor(userId: number): UserGroup {
		let group = groups.get(userId)
		if (!group) {
			group = { userId, characters: [], personaIds: [] }
			groups.set(userId, group)
		}
		return group
	}
	// Preserves activeCharacters' existing position ordering within each
	// group, since it's already sorted by position before this runs.
	for (const cc of activeCharacters) {
		groupFor(cc.character.userId).characters.push(cc)
	}
	for (const cp of validChatPersonas) {
		groupFor(cp.persona.userId).personaIds.push(cp.persona.id)
	}
	if (groups.size === 0) return null

	function lastActivityIndex(group: UserGroup): number {
		const characterIds = group.characters.map((cc) => cc.character.id)
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i]
			if (
				(msg.role === "assistant" &&
					msg.characterId != null &&
					characterIds.includes(msg.characterId)) ||
				(msg.role === "user" &&
					msg.personaId != null &&
					group.personaIds.includes(msg.personaId))
			) {
				return i
			}
		}
		return -1
	}

	let dueGroup: UserGroup | null = null
	let dueActivityIndex = Infinity
	for (const group of [...groups.values()].sort(
		(a, b) => a.userId - b.userId
	)) {
		const idx = lastActivityIndex(group)
		if (idx < dueActivityIndex) {
			dueActivityIndex = idx
			dueGroup = group
		}
	}
	if (!dueGroup || dueGroup.characters.length === 0) return null

	const groupCharacterIds = dueGroup.characters.map((cc) => cc.character.id)
	const scopedMessages = messages.filter(
		(m) =>
			(m.role === "assistant" &&
				m.characterId != null &&
				groupCharacterIds.includes(m.characterId)) ||
			(m.role === "user" &&
				m.personaId != null &&
				dueGroup!.personaIds.includes(m.personaId))
	)

	return computeDueCharacter({
		activeCharacters: dueGroup.characters,
		personaIds: dueGroup.personaIds,
		characterIds: groupCharacterIds,
		messages: scopedMessages
	})
}

/**
 * Determine which active character (if any) is due for a turn right now.
 * See computeDueCharacter for the "Ordered" (flat, default) rule, and
 * getNextCharacterTurnUserSplit for the "User-Split" rule.
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
export function getNextCharacterTurn(
	chat: {
		chatMessages: SelectChatMessage[]
		chatCharacters: (SelectChatCharacter & { character: SelectCharacter | null })[]
		chatPersonas: (SelectChatPersona & { persona: SelectPersona | null })[]
	},
	groupReplyStrategy?: string | null
): number | null {
	if (!chat.chatCharacters?.length || !chat.chatPersonas?.length) {
		return null
	}

	// character/persona can be null — chatCharacters.characterId and
	// chatPersonas.personaId are both nullable (onDelete: "set null"), so a
	// deleted-but-still-bound character/persona leaves a row with no linked
	// entity. Every current caller already filters these out first, but that
	// discipline isn't enforced by the type — guard here too so a future
	// caller that skips the filter can't crash on `.id` of null.
	const validChatCharacters = chat.chatCharacters.filter(
		(cc): cc is typeof cc & { character: SelectCharacter } =>
			cc.character !== null
	)
	const validChatPersonas = chat.chatPersonas.filter(
		(cp): cp is typeof cp & { persona: SelectPersona } => cp.persona !== null
	)
	if (!validChatCharacters.length || !validChatPersonas.length) {
		return null
	}

	// Sort by position (normalizing missing positions to array index), then
	// keep only active characters.
	const activeCharacters = validChatCharacters
		.slice()
		.map((cc, index) => ({
			...cc,
			normalizedPosition: cc.position ?? index
		}))
		.sort((a, b) => a.normalizedPosition - b.normalizedPosition)
		.filter((cc) => cc.isActive)

	if (activeCharacters.length === 0) return null

	// Narrator response messages (isNarratorResponse, characterId: null) are
	// narration, not a cast member's turn — excluded entirely rather than just
	// failing to match a character id, so they can't occupy a slot in the
	// recency windows below and skew the healthy-window/due checks for the
	// real cast.
	const messages = chat.chatMessages.filter(
		(m) => !m.isHidden && !m.isNarratorResponse
	)

	if (groupReplyStrategy === GroupReplyStrategies.USER_SPLIT) {
		return getNextCharacterTurnUserSplit({
			activeCharacters,
			validChatPersonas,
			messages
		})
	}

	const personaIds = validChatPersonas.map((cp) => cp.persona.id)
	const characterIds = activeCharacters.map((cc) => cc.character.id)

	return computeDueCharacter({ activeCharacters, personaIds, characterIds, messages })
}
