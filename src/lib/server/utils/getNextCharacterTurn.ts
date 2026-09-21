import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"

type ActiveCharacter = SelectSessionCharacter & {
	character: SelectCharacter
	normalizedPosition: number
}

/**
 * Core due-character computation, shared by the flat "Ordered" strategy and
 * each per-user scope of the "User-Split" strategy (see getNextCharacterTurn
 * below) — the only difference between the two is *which* characters,
 * personas, and message history get passed in here: the whole session's cast
 * for Ordered, or a single user's own slice of it for User-Split.
 *
 * Rule: a character who has never replied at all (within the given
 * `messages`) is always immediately due — this covers both a brand-new session
 * and a character newly added to one that's already in progress. Otherwise,
 * let N = personaIds.length + characterIds.length. A character is due when
 * they have no reply in the last N-1 messages; when more than one character
 * is due, whoever's most recent reply is furthest back goes first. When every
 * character has replied within those N-1 messages, nobody is due — it is the
 * persona's turn.
 *
 * That lookback is the whole rule. There is no precondition on the window's
 * shape: rows written outside the rotation — a character's form-answer lines,
 * two persona sends in a row, two manual triggers on one character — push the
 * other cast members further back and so make them due sooner, never leave
 * the rotation with nobody to pick. A precondition that demands every cast
 * member appear in the last N rows starves the session instead: once such
 * rows land, nobody is due, and nobody can speak to mend the window.
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
	messages: SelectSessionMessage[]
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
	// ahead of the lookback below. This covers both a brand-new session
	// (nobody in the cast has replied yet, so no configured first/greeting
	// message exists) and a character added to an already-established session
	// (the newcomer is owed a first turn before anyone is owed a repeat).
	// Among characters who've never replied, pick by position, so a brand-new
	// session still starts with its first-listed character.
	const neverReplied = activeCharacters.filter(
		(cc) => lastReplyIndex(cc.character.id) === -1
	)
	if (neverReplied.length > 0) {
		return neverReplied[0].character.id
	}

	// A character is due if they have no message in the last `castSize - 1`
	// messages — one full rotation minus the slot their own reply would take.
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
 * session's cast, group personas and characters by the user who owns them
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
 * brand-new session deterministically starts with its lowest-id user. Once a
 * user is selected, the character decision itself reuses
 * computeDueCharacter unchanged, but scoped to only that user's own
 * characters/personas and only their own slice of the message history — so
 * a quiet user elsewhere in the session can never block or skew whether this
 * user's own characters are due.
 */
function getNextCharacterTurnUserSplit({
	activeCharacters,
	validSessionPersonas,
	messages
}: {
	activeCharacters: ActiveCharacter[]
	validSessionPersonas: (SelectSessionPersona & { persona: SelectCharacter })[]
	messages: SelectSessionMessage[]
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
	for (const cp of validSessionPersonas) {
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
	session: {
		sessionMessages: SelectSessionMessage[]
		sessionCharacters: (SelectSessionCharacter & {
			character: SelectCharacter | null
		})[]
		sessionPersonas: (SelectSessionPersona & {
			persona: SelectCharacter | null
		})[]
	},
	groupReplyStrategy?: string | null
): number | null {
	if (
		!session.sessionCharacters?.length ||
		!session.sessionPersonas?.length
	) {
		return null
	}

	// character/persona can be null — sessionCharacters.characterId and
	// sessionPersonas.personaId are both nullable (onDelete: "set null"), so a
	// deleted-but-still-bound character/persona leaves a row with no linked
	// entity. Every current caller already filters these out first, but that
	// discipline isn't enforced by the type — guard here too so a future
	// caller that skips the filter can't crash on `.id` of null.
	// A removed-but-still-soft-present row (removedAt set) must never
	// participate in round-robin, even if isActive was somehow still true —
	// belt-and-suspenders alongside getPromptSessionFromDb's own filter, since
	// this function's session.sessionCharacters/sessionPersonas input isn't guaranteed
	// to always come from that one choke point.
	const validSessionCharacters = session.sessionCharacters.filter(
		(cc): cc is typeof cc & { character: SelectCharacter } =>
			cc.character !== null && !cc.removedAt
	)
	const validSessionPersonas = session.sessionPersonas.filter(
		(cp): cp is typeof cp & { persona: SelectCharacter } =>
			cp.persona !== null && !cp.removedAt
	)
	if (!validSessionCharacters.length || !validSessionPersonas.length) {
		return null
	}

	// Sort by position (normalizing missing positions to array index), then
	// keep only active characters.
	const activeCharacters = validSessionCharacters
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
	// lookback below and skew the due check for the real cast.
	const messages = session.sessionMessages.filter(
		(m) => !m.isHidden && !m.isNarratorResponse
	)

	if (groupReplyStrategy === GroupReplyStrategies.USER_SPLIT) {
		return getNextCharacterTurnUserSplit({
			activeCharacters,
			validSessionPersonas,
			messages
		})
	}

	const personaIds = validSessionPersonas.map((cp) => cp.persona.id)
	const characterIds = activeCharacters.map((cc) => cc.character.id)

	return computeDueCharacter({
		activeCharacters,
		personaIds,
		characterIds,
		messages
	})
}

/**
 * Which seated **envoy** is due (plans/29 R-18; U5g), or null.
 *
 * Envoys are not in the character rotation above — an envoy has no persona
 * to alternate with and a guide session has no characters at all — so the
 * rule is the simpler one a user/assistant exchange has: an envoy is due
 * when the newest message is not a reply (the person just spoke, or nobody
 * has yet), and the envoy that goes is the one whose last reply is furthest
 * back, first by seat position for those that never replied. An envoy's
 * reply is recognised by the reference its row carries (`metadata.speaker`,
 * `envoy:<slug>`), which is the row's only identity.
 *
 * `envoys` is the caller's to filter: this never picks an `on-action` envoy
 * because the caller never offers one (R-21 (6)).
 */
export function nextEnvoyTurn(
	envoys: ReadonlyArray<{ slug: string; position: number }>,
	messages: ReadonlyArray<{
		role: string
		isHidden?: boolean | null
		metadata?: unknown
	}>
): string | null {
	if (!envoys.length) return null
	const visible = messages.filter((m) => !m.isHidden)
	const newest = visible[visible.length - 1]
	if (newest && newest.role !== "user") return null
	const lastReplyAt = new Map<string, number>()
	visible.forEach((m, i) => {
		const ref = (m.metadata as { speaker?: unknown } | undefined)?.speaker
		if (typeof ref === "string" && ref.startsWith("envoy:"))
			lastReplyAt.set(ref.slice("envoy:".length), i)
	})
	const ordered = [...envoys].sort((a, b) => a.position - b.position)
	const never = ordered.find((e) => !lastReplyAt.has(e.slug))
	if (never) return never.slug
	return ordered.reduce((oldest, e) =>
		(lastReplyAt.get(e.slug) ?? -1) < (lastReplyAt.get(oldest.slug) ?? -1)
			? e
			: oldest
	).slug
}
