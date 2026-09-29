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
import { messageEnvoySlug } from "@serene-pub/core-catalog/conversation"

/** The slug of an envoy's message — core's conversation reads it the same way. */
export { messageEnvoySlug }

export interface MessageSpeakerSource {
	sessionCharacters?: {
		characterId?: number | null
		character?: SelectCharacter | null
		removedName?: string | null
	}[]
	sessionPersonas?: {
		personaId?: number | null
		/** A persona IS a character the user voices — same row shape. */
		persona?: SelectCharacter | null
		removedName?: string | null
	}[]
	/**
	 * The session's envoys (plans/29 R-18; U5g), off `sessions:view` —
	 * display text already in the viewer's language. An envoy's row names
	 * it by reference (`metadata.speaker = envoy:<slug>`) and holds no
	 * `characterId`, so this list is where its name and image come from.
	 */
	envoys?: {
		slug: string
		name: string
		description?: string
		image?: string
		/**
		 * The genre's fallback envoy: the pipeline's own voice, whose name a
		 * line nobody claims renders under (`ownVoiceName`, R5).
		 */
		fallback?: boolean
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
	msg: {
		characterId?: number | null
		personaId?: number | null
		metadata?: unknown
	}
): SelectCharacter | undefined {
	// An envoy's line (U5g): no row to link, so the face is the declaration's
	// — synthesised in the character's shape so every render site reads it
	// as it reads a character. `avatar` is a URL or data: URI `avatarSrc`
	// hands back verbatim. A slug absent from the view's list (the genre
	// stopped declaring it) renders under its slug — never a placeholder.
	const envoySlug = messageEnvoySlug(msg)
	if (envoySlug) {
		const envoy = session?.envoys?.find((e) => e.slug === envoySlug)
		return {
			name: envoy?.name ?? envoySlug,
			description: envoy?.description ?? "",
			...(envoy?.image ? { avatar: envoy.image } : {})
		} as unknown as SelectCharacter
	}
	if (msg.personaId) {
		const cp = session?.sessionPersonas?.find(
			(p) => p.personaId === msg.personaId
		)
		return (
			cp?.persona ??
			(cp?.removedName
				? ({ name: cp.removedName } as SelectCharacter)
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

/**
 * The name a person's own line takes when no persona speaks for it (lair
 * re-plan R4): the genre's `playerLabel` — "Dungeon Master", or the session's
 * override, already resolved (`resolvePlayerLabel`) — with the member's own
 * name as `member` only when the session has more than one member, so a
 * shared table can still tell whose line it is ("Dungeon Master · jody").
 * With no label, the member's name, as before (B11). Undefined when there is
 * nothing to name it by.
 *
 * Never stamped on the row: the page calls this at render, so a rename
 * relabels every line.
 */
export function personLineName(opts: {
	playerLabel?: string | null
	memberName?: string | null
	/** The session's members: its owner plus its guests. */
	memberCount: number
}): { name: string; member?: string } | undefined {
	const label = opts.playerLabel?.trim()
	const member = opts.memberName?.trim()
	if (label)
		return opts.memberCount > 1 && member
			? { name: label, member }
			: { name: label }
	return member ? { name: member } : undefined
}
