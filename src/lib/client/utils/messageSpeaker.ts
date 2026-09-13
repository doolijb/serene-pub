/**
 * Who a message's avatar and name belong to, resolved from the session's live
 * participant links.
 *
 * Pure and extracted from the session page so it can be tested: this is the one
 * lookup every rendered message goes through, so whether a character edit
 * reaches an open conversation is decided here plus whatever keeps
 * `sessionCharacters[].character` current.
 */

/** The participant links a session view holds. Structural, so both the full
 *  `sessions:get` payload and a test fixture satisfy it. */
export interface MessageSpeakerSource {
	sessionCharacters?: {
		characterId?: number | null
		character?: SelectCharacter | null
		removedName?: string | null
	}[]
	sessionPersonas?: {
		personaId?: number | null
		persona?: SelectPersona | null
		removedName?: string | null
	}[]
}

/**
 * Display-name precedence for a message's speaker: prefer the LIVE
 * character/persona if it still exists (so a rename — and an avatar change —
 * propagates to past messages too, same as everywhere else in the app), falling
 * back to the `removedName` snapshot taken at removal time only once the entity
 * is itself globally deleted (its FK on the sessionCharacters/sessionPersonas
 * row nulls out via onDelete: "set null").
 *
 * A removed-but-still-existing participant's row is found here too
 * (`sessionCharacters`/`sessionPersonas` stays unfiltered client-side, see
 * getSessionFromDB), so this already resolves the common case for free — the
 * removedName fallback only ever matters once `.character`/`.persona` is null.
 */
export function messageSpeaker(
	session: MessageSpeakerSource | null | undefined,
	msg: { characterId?: number | null; personaId?: number | null }
): SelectCharacter | SelectPersona | undefined {
	if (msg.personaId) {
		const cp = session?.sessionPersonas?.find(
			(p) => p.personaId === msg.personaId
		)
		return (
			cp?.persona ??
			(cp?.removedName
				? ({ name: cp.removedName } as SelectPersona)
				: undefined)
		)
	} else if (msg.characterId) {
		const cc = session?.sessionCharacters?.find(
			(c) => c.characterId === msg.characterId
		)
		return (
			cc?.character ??
			(cc?.removedName
				? ({ name: cc.removedName } as SelectCharacter)
				: undefined)
		)
	}
}
