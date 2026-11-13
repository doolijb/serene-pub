/**
 * What a message looks like when it is used as a retrieval *query*.
 *
 * Not the same as what it looks like in the prompt. A query carries speaker
 * attribution in brackets and has its emphasis markers stripped, because the
 * embedding of "[Alice]: the wall fell" is closer to lore about Alice and about
 * walls than the embedding of "*the wall fell*" is to either.
 *
 * Extracted from the 0.5 RAG path, where it was private, so the pipeline
 * embeds the same strings. Two formattings of a query is two different sets of
 * retrieved results with no way to tell which is which.
 */

export interface QueryCast {
	sessionCharacters?: readonly any[]
	sessionPersonas?: readonly any[]
	removedSessionCharacters?: readonly any[]
	removedSessionPersonas?: readonly any[]
}

export interface QueryMessage {
	role?: string | null
	content?: string | null
	characterId?: number | null
	personaId?: number | null
	/** 🚧 The speaker's cast member — a member id, never a card id. */
	castMemberId?: number | null
	/** The speaker reference as the history read carries it. */
	speaker?: string | null
	metadata?: { speaker?: unknown } | null
	isNarratorResponse?: boolean | null
}

/**
 * 🚧 The member a card-less CHARACTER line was spoken by, or null when the
 * line is not one. The rule: an assistant line with no card and no persona,
 * not narration, whose `metadata.speaker` (or the history read's top-level
 * `speaker`) is `seated-member:<id>` — or, with NO speaker stamp, whose
 * `castMemberId` is stamped. A stamp that names anyone else (`player-seat:`,
 * `user:`, `envoy:`) is never a character seat's line. The caller still
 * checks the member seats a card-less character seat of this session.
 */
export function cardlessLineMemberId(message: any): number | null {
	if (
		message?.role !== "assistant" ||
		message.characterId ||
		message.personaId ||
		message.isNarratorResponse
	)
		return null
	const stamp = message.metadata?.speaker ?? message.speaker
	if (typeof stamp === "string" && stamp.trim()) {
		const m = /^seated-member:(\d+)$/.exec(stamp.trim())
		return m ? Number(m[1]) : null
	}
	return typeof message.castMemberId === "number"
		? message.castMemberId
		: null
}

/** 🚧 A seat row with no card whose member is `memberId` (a card id never matches). */
export const isCardlessSeatOf = (cc: any, memberId: number): boolean =>
	cc?.castMemberId === memberId && !cc.characterId && !cc.character?.id

/**
 * `[Speaker]: text`, with the speaker resolved through removed participants.
 *
 * The fallback chain is the same one `SessionMessageProcessor` walks and for the
 * same reason: a message from someone who has since left the session still needs a
 * name, or every line they ever said embeds as though the narrator said it.
 */
export function formatMessageForQuery(
	msg: QueryMessage,
	cast: QueryCast
): string {
	// A card-less seat's `character` has no `id`: `undefined === undefined`
	// must never match a line that names no card.
	let char = cast.sessionCharacters?.find(
		(cc: any) =>
			msg.characterId != null && cc.character?.id === msg.characterId
	)?.character
	let persona = cast.sessionPersonas?.find(
		(cp: any) => cp.persona?.id === msg.personaId
	)?.persona

	let removedName: string | undefined
	if (!char && msg.characterId) {
		const removed = cast.removedSessionCharacters?.find(
			(cc: any) => cc.characterId === msg.characterId
		)
		char = removed?.character
		removedName ??= removed?.removedName ?? undefined
	}
	if (!persona && msg.personaId) {
		const removed = cast.removedSessionPersonas?.find(
			(cp: any) => cp.personaId === msg.personaId
		)
		persona = removed?.persona
		removedName ??= removed?.removedName ?? undefined
	}

	// 🚧 A card-less character seat's line: an assistant line with no card or
	// persona, not narration, stamped `seated-member:<id>` (or, unstamped, with
	// a `castMemberId`), named by the seat with no card whose member it is —
	// the departed ones too. A player's line never is.
	let cardless: any
	const memberId = cardlessLineMemberId(msg)
	if (memberId !== null) {
		const noCard = (cc: any) => isCardlessSeatOf(cc, memberId)
		cardless =
			cast.sessionCharacters?.find(noCard) ??
			cast.removedSessionCharacters?.find(noCard)
	}

	const speaker =
		(cardless?.character as any)?.nickname ||
		cardless?.character?.name ||
		cardless?.removedName ||
		(char as any)?.nickname ||
		char?.name ||
		persona?.name ||
		removedName ||
		msg.role ||
		"Unknown"

	// Leading and trailing asterisks per line: roleplay emphasis carries no
	// meaning for an embedding and moves the vector for no reason.
	const clean = (msg.content ?? "").replace(/^\*+|\*+$/gm, "").trim()
	return `[${speaker}]: ${clean}`
}

/**
 * The two query windows, newest last within each.
 *
 * `current` is what is being said now; `recent` is what was being said just
 * before. They are separate because they are different questions — see
 * `mergeWindows` for why their results are concatenated rather than fused.
 */
export function queryWindows(
	messages: readonly QueryMessage[],
	cast: QueryCast,
	params: { currentWindow: number; recentWindow: number }
): { current: string[]; recent: string[] } {
	const format = (m: QueryMessage) => formatMessageForQuery(m, cast)

	// `slice(-0)` is `slice(0)` — the **whole array**, not an empty one. A
	// window of zero therefore reads as "embed every message in the session, one
	// query each", which is the opposite of what setting it to zero means and
	// is expensive enough to notice as a hang rather than as a wrong answer.
	// Now that these are user-facing parameters, zero is a value someone will
	// type.
	const tail = (n: number) => (n > 0 ? messages.slice(-n) : [])

	const current = tail(params.currentWindow)
	const recent =
		params.currentWindow > 0
			? messages.slice(
					-(params.currentWindow + params.recentWindow),
					-params.currentWindow
				)
			: tail(params.recentWindow)

	return { current: current.map(format), recent: recent.map(format) }
}
