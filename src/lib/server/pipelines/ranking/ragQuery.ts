/**
 * What a message looks like when it is used as a retrieval *query*.
 *
 * Not the same as what it looks like in the prompt. A query carries speaker
 * attribution in brackets and has its emphasis markers stripped, because the
 * embedding of "[Alice]: the wall fell" is closer to lore about Alice and about
 * walls than the embedding of "*the wall fell*" is to either.
 *
 * Extracted from `RagInfillEngine`, where it was private, so the pipeline
 * embeds the same strings. Two formattings of a query is two different sets of
 * retrieved results with no way to tell which is which.
 */

export interface QueryCast {
	chatCharacters?: readonly any[]
	chatPersonas?: readonly any[]
	removedChatCharacters?: readonly any[]
	removedChatPersonas?: readonly any[]
}

export interface QueryMessage {
	role?: string | null
	content?: string | null
	characterId?: number | null
	personaId?: number | null
}

/**
 * `[Speaker]: text`, with the speaker resolved through removed participants.
 *
 * The fallback chain is the same one `ChatMessageProcessor` walks and for the
 * same reason: a message from someone who has since left the chat still needs a
 * name, or every line they ever said embeds as though the narrator said it.
 */
export function formatMessageForQuery(
	msg: QueryMessage,
	cast: QueryCast
): string {
	let char = cast.chatCharacters?.find(
		(cc: any) => cc.character?.id === msg.characterId
	)?.character
	let persona = cast.chatPersonas?.find(
		(cp: any) => cp.persona?.id === msg.personaId
	)?.persona

	let removedName: string | undefined
	if (!char && msg.characterId) {
		const removed = cast.removedChatCharacters?.find(
			(cc: any) => cc.characterId === msg.characterId
		)
		char = removed?.character
		removedName ??= removed?.removedName ?? undefined
	}
	if (!persona && msg.personaId) {
		const removed = cast.removedChatPersonas?.find(
			(cp: any) => cp.personaId === msg.personaId
		)
		persona = removed?.persona
		removedName ??= removed?.removedName ?? undefined
	}

	const speaker =
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
	// window of zero therefore reads as "embed every message in the chat, one
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
