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
import { senderRefOf } from "@serene-pub/sdk"
import {
	seatCardAsShown,
	type CharactersSourceSession
} from "$lib/client/components/sessionPage/projections/characters"
import {
	seatOfMessage,
	seatOfRef
} from "$lib/client/components/sessionPage/projections/seatIdentity"

/** The slug of an envoy's message — core's conversation reads it the same way. */
export { messageEnvoySlug }

export interface MessageSpeakerSource
	extends Pick<
		CharactersSourceSession,
		"castNames" | "castFaces" | "castSpriteSets"
	> {
	/**
	 * 🚧 Card-less seats shown as their cast member, by cast MEMBER id — never
	 * a card id, so never read through the card-keyed maps above.
	 */
	cardlessSeatShown?: Record<
		number,
		{ name: string; nickname: string | null; faceMediaId: number | null }
	>
	sessionCharacters?: {
		characterId?: number | null
		/** The seat's cast member (s27 S1). */
		castMemberId?: number | null
		character?: SelectCharacter | null
		removedName?: string | null
		/** The seat fields `seatOfMessage` orders by. */
		id?: number | null
		envoySlug?: string | null
		position?: number | null
		removedAt?: unknown
	}[]
	sessionPersonas?: {
		personaId?: number | null
		/** The seat's cast member (s27 S1). */
		castMemberId?: number | null
		position?: number | null
		/** A persona IS a character the user voices — same row shape. */
		persona?: SelectCharacter | null
		removedName?: string | null
		/**
		 * 🚧 The seat name: this player's character name in THIS session.
		 * Wins over the voiced card's name and the player label.
		 */
		seatName?: string | null
		/** 🚧 The seat's own id — what a card-less player seat's line names (`player-seat:<id>`). */
		id?: number | null
		/** 🚧 Whose seat it is. */
		userId?: number | null
		removedAt?: Date | string | null
		/** 🚧 The seat's portrait (PLAN-sheet §12): a file id that wins over the card's avatar on the seat's lines. */
		portraitMediaId?: number | null
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
		/** The speaker's seat member, stamped at write (s27 S1). */
		castMemberId?: number | null
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
		// The seat holding the line's cast member, else the one on its card.
		const cp = seatOfMessage(session, msg)?.seat as
			| NonNullable<MessageSpeakerSource["sessionPersonas"]>[number]
			| undefined
		// A seat name wins over the card's (the card still lends its face,
		// unless the seat has a portrait of its own). The card is the card as
		// its cast member shows it (s27 S2c, as a character seat's is): the
		// member's own names and face over the card's, keyed by the card's id.
		const seatName = cp?.seatName?.trim()
		const shown = cp?.persona
			? seatCardAsShown(session, cp.persona)
			: undefined
		const speaker = seatName
			? ({
					...(shown ?? {}),
					name: seatName,
					// The member's nickname would be read over the seat name.
					...(typeof cp?.persona?.id === "number" &&
					session?.castNames?.[cp.persona.id]
						? { nickname: null }
						: {})
				} as SelectCharacter)
			: (shown ??
				(cp?.removedName
					? ({ name: cp.removedName } as SelectCharacter)
					: undefined))
		return speaker ? withPortrait(speaker, cp?.portraitMediaId) : speaker
	} else if (msg.characterId) {
		const cc = seatOfMessage(session, msg)?.seat as
			| NonNullable<MessageSpeakerSource["sessionCharacters"]>[number]
			| undefined
		// A seated character speaks as its cast member shows it (s27 S2:
		// own name, face and sprite sets over the card's), keyed by card id.
		return (
			(cc?.character ? seatCardAsShown(session, cc.character) : undefined) ??
			(cc?.removedName
				? ({ name: cc.removedName } as SelectCharacter)
				: undefined)
		)
	} else if (msg.castMemberId != null) {
		// A card-less seat's line: no card column names it, so the seat does
		// (`seatOfMessage`), and its member is read by MEMBER id — never
		// through the card-keyed maps.
		const found = seatOfMessage(session, msg)
		if (!found) return undefined
		if (found.form === "player") {
			const seat = found.seat as NonNullable<
				MessageSpeakerSource["sessionPersonas"]
			>[number]
			// A seat name is the line's (`seatNameOf`); the member's own
			// name is for a seat with none.
			if (seat.personaId != null || seat.seatName?.trim()) return undefined
			const shown = cardlessShownOf(session, seat.castMemberId)
			return shown ? withPortrait(shown, seat.portraitMediaId) : undefined
		}
		const seat = found.seat as NonNullable<
			MessageSpeakerSource["sessionCharacters"]
		>[number]
		if (seat.character) return undefined
		return (
			cardlessShownOf(session, seat.castMemberId) ??
			(seat.removedName
				? ({ name: seat.removedName } as SelectCharacter)
				: undefined)
		)
	}
}

/**
 * The card-less seat's member as a speaker, in the character's shape so
 * every render site reads it as it reads a card: its name, nickname and face
 * (a media id, drawn as the card's face is). Undefined for no entry.
 */
function cardlessShownOf(
	session: MessageSpeakerSource | null | undefined,
	castMemberId: number | null | undefined
): SelectCharacter | undefined {
	const shown =
		castMemberId != null ? session?.cardlessSeatShown?.[castMemberId] : undefined
	if (!shown) return undefined
	return {
		name: shown.name,
		nickname: shown.nickname,
		description: "",
		...(shown.faceMediaId != null ? { avatarMediaId: shown.faceMediaId } : {})
	} as unknown as SelectCharacter
}

/**
 * 🚧 A speaker drawn with its seat's portrait (PLAN-sheet §12) when the
 * seat has one: the file id becomes the avatar every render site reads
 * (`avatarSrc`), over the card's. Unchanged without one.
 */
export function withPortrait<C extends object>(speaker: C, portraitMediaId: number | null | undefined): C {
	if (portraitMediaId == null) return speaker
	return { ...speaker, avatarMediaId: portraitMediaId, avatarMedia: null, avatar: null, _avatar: null }
}

/**
 * The player seat a person's line names (`metadata.speaker = player-seat:<id>`),
 * looked up by the ref (`seatOfRef`), never by an id parsed out of it.
 */
function playerSeatNamedBy(
	session: MessageSpeakerSource | null | undefined,
	msg: { personaId?: number | null; metadata?: unknown }
): NonNullable<MessageSpeakerSource["sessionPersonas"]>[number] | undefined {
	const sender = senderRefOf(msg)
	if (!sender?.startsWith("player-seat:")) return undefined
	const found = seatOfRef(session, sender)
	return found?.form === "player"
		? (found.seat as NonNullable<MessageSpeakerSource["sessionPersonas"]>[number])
		: undefined
}

/**
 * 🚧 The portrait of the card-less seat a person's line names
 * (`metadata.speaker = player-seat:<id>`), as a file id; undefined for any
 * other line or a seat with none.
 */
export function seatPortraitOf(
	session: MessageSpeakerSource | null | undefined,
	msg: { personaId?: number | null; metadata?: unknown }
): number | undefined {
	return playerSeatNamedBy(session, msg)?.portraitMediaId ?? undefined
}

/**
 * 🚧 The seat name a person's line with no persona takes: the seat the line
 * names (`metadata.speaker = player-seat:<id>`, stamped at send), never guessed
 * from who sent it — one player may hold two seats. Undefined for a line
 * from no card-less player seat, or from a seat with no name.
 */
export function seatNameOf(
	session: MessageSpeakerSource | null | undefined,
	msg: { personaId?: number | null; metadata?: unknown }
): string | undefined {
	const seat = playerSeatNamedBy(session, msg)
	return seat?.personaId == null ? seat?.seatName?.trim() || undefined : undefined
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
	/** 🚧 The player's seat name (`seatNameOf`): wins over everything. */
	seatName?: string | null
	playerLabel?: string | null
	memberName?: string | null
	/** The session's members: its owner plus its guests. */
	memberCount: number
}): { name: string; member?: string } | undefined {
	const seat = opts.seatName?.trim()
	if (seat) return { name: seat }
	const label = opts.playerLabel?.trim()
	const member = opts.memberName?.trim()
	if (label)
		return opts.memberCount > 1 && member
			? { name: label, member }
			: { name: label }
	return member ? { name: member } : undefined
}
