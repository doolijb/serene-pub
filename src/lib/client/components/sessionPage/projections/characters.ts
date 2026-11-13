/**
 * 🚧 `characters.v1` (R76): the session's cast as a widget draws it, with the
 * portraits pinned beside the conversation riding along (⏳ until 0.7.0, W6)
 * — built from what the page already holds (the session payload, who is
 * looking, the page's pins).
 *
 * Pure: plain values in, a detached section out. The page wraps it in a
 * `$derived` and sets it under `SESSION_CHARACTERS_KEY`; a panel granted
 * `characters` hands it to its widget — on its ctx when native, posted when
 * remote — so both read ONE projection.
 *
 * **Cast over card.** Each member is the character card overlaid by what the
 * session's cast says of it, the cast winning wherever both speak. The session
 * payload carries two cast facts, so those are the two overlays here: the
 * cast member's sprite-set pick (`spriteSetOverrides` — the `session_cast`
 * sprite-set value, DESIGN-sprites §2.3), and the face a lorebook cast member
 * retells (`castFaces`, a `files` id by character id) — present, it is the
 * face; absent, the card's avatar is. A persona's seat reads its cast member
 * the same way (s27 S2c) — the payload's maps are keyed by the seated card's
 * id for a persona as for a character — except for the sprite-set pick, which
 * stays a character's (it is voiced, not seated). The name is the one the session shows
 * everywhere else (nickname over name, as the header's cast discs and the
 * log's speaker labels have it), the seat's cast member's own where it has
 * one (`castNames`, s27 S2), and its own sprite sets likewise (`castSpriteSets`).
 *
 * Every URL is resolved here exactly as the native Scene Portraits widget
 * resolves it (`avatarSrc`/`spriteSrc`, full size), so a pinned portrait is
 * matched to its member by the same strings.
 *
 * What this fixes over the native widget (R77):
 *  - `mine` is the persona the VIEWER is voicing — the composer's pick
 *    (`voicedPersonaId`), else the viewer's first — never merely the first
 *    persona listed, and never one of theirs they are not voicing;
 *  - `canChangeSpriteSet` is the server's own rule (`sessions:setSpriteSet`,
 *    `server/sockets/sprites.ts`): a seated character — never a persona,
 *    which is voiced, not seated — whose session or card the viewer owns.
 */
import {
	memberShownName,
	withMemberNames
} from "$lib/shared/lorebooks/memberIdentity"
import type {
	SessionCharacterV1,
	SessionCharactersV1,
	SessionSceneImageV1
} from "@serene-pub/sdk"
import { avatarSrc } from "$lib/client/utils/media"
import { seatRefOf, type PayloadSeat } from "./seatIdentity"
import {
	currentSpriteIn,
	resolveSprite,
	shownSpriteOf,
	spriteSrc,
	type HasSprites,
	type SessionSpriteSet
} from "$lib/client/utils/sprites"
import type { ShownSprite } from "$lib/shared/sprites"

/** A character card as the session payload joins it (a persona's too). */
export interface CharacterCard extends HasSprites {
	id?: number | null
	userId?: number | null
	name?: string | null
	nickname?: string | null
}

/** A line of the log, as far as a current sprite and a last line need it. */
export interface CharactersSourceMessage {
	id: number
	characterId?: number | null
	/** A persona's line names its persona here, not in `characterId`. */
	personaId?: number | null
	isHidden?: boolean | null
	metadata?: unknown
	/** When the line was written: an ISO string on the wire, a `Date` or ms in a test. */
	createdAt?: string | number | Date | null
}

/** The session payload (`sessions:get`), as this projection reads it. */
export interface CharactersSourceSession {
	/** The session's owner. */
	userId?: number | null
	sessionCharacters?:
		| readonly (PayloadSeat & {
				isActive?: boolean | null
				/** The seat's cast member (s27 S1); null while the seat holds only a card. */
				castMemberId?: number | null
				character?: CharacterCard | null
		  })[]
		| null
	sessionPersonas?:
		| readonly (PayloadSeat & {
				persona?: CharacterCard | null
				/** 🚧 False = the player seat is benched (owner 2026-11-10). */
				isActive?: boolean | null
				/** 🚧 The player's name for their seat in this session; wins over the member's name. */
				seatName?: string | null
		  })[]
		| null
	/** The cast's sprite-set picks, by character id (DESIGN-sprites §2.3). */
	spriteSetOverrides?: Readonly<Record<number, string>> | null
	/**
	 * The faces the session's lorebook cast retells, by character id: a
	 * `files` id, present only for a seat whose cast member retells its face.
	 */
	castFaces?: Readonly<Record<number, number>> | null
	/**
	 * The names the session's lorebook cast gives a seat in this book only,
	 * by character id; absent for a seat that keeps the card's.
	 */
	castNames?: Readonly<
		Record<number, { ownName: string | null; ownNickname: string | null }>
	> | null
	/**
	 * 🚧 The sprite sets the seat's cast member has of its own (with an image),
	 * by character id; absent for a seat that draws from the card's.
	 */
	castSpriteSets?: Readonly<Record<number, readonly SessionSpriteSet[]>> | null
	sessionMessages?: readonly CharactersSourceMessage[] | null
}

export interface CharactersSource {
	session: CharactersSourceSession | null | undefined
	/** Who is looking; null for nobody in particular. */
	viewerUserId: number | null
	/**
	 * The persona the viewer is voicing (the composer's pick); absent or null,
	 * the viewer's first persona in the session.
	 */
	voicedPersonaId?: number | null
	/** The page's own pins (`ScenePins`), never a copy of them. */
	sceneImages: { left: string | null; right: string | null }
	/**
	 * Each member's current sprite, when the caller has worked them out
	 * already (`currentSpritesOf`); absent, they are read off the log.
	 */
	currentSprites?: ReadonlyMap<number, ShownSprite | null>
	/**
	 * When each member last spoke, when the caller has worked it out already
	 * (`lastSpokeOf`); absent, it is read off the log.
	 */
	lastSpoke?: ReadonlyMap<number, number | null>
	/**
	 * The line a Dialogue box's reader is on (`show-line`), a message id: used
	 * to cut the log for the sprites, last lines and speaker this projection
	 * works out itself. Absent or null, the whole log.
	 */
	shownMessageId?: number | null
	/**
	 * The card id of who is speaking, when the caller has worked it out already
	 * (`speakerOf`); absent, it is read off the log.
	 */
	speakerId?: number | null
}

/**
 * The log as of the shown line: the rows at or before it. One ordering for the
 * cut — message id, the order the reading place moves in. A shown line that is
 * not among the loaded rows cuts nothing (the same array comes back): the cut
 * needs the line in the window.
 */
export function messagesAsOf<T extends { id: number }>(
	messages: readonly T[],
	shownMessageId: number | null | undefined
): readonly T[] {
	if (shownMessageId == null) return messages
	if (!messages.some((m) => m.id === shownMessageId)) return messages
	return messages.filter((m) => m.id <= shownMessageId)
}

/**
 * Who is speaking, as a card id: the writer (`characterId ?? personaId`) of
 * the shown line when one is shown and loaded — hidden or not, it is the line
 * on screen — else of the newest visible loaded line by id. Null when there is
 * none or the line names no card.
 */
export function speakerOf(
	messages: readonly CharactersSourceMessage[],
	shownMessageId?: number | null
): number | null {
	let line: CharactersSourceMessage | undefined
	if (shownMessageId != null)
		line = messages.find((m) => m.id === shownMessageId)
	if (!line)
		for (const m of messages)
			if (!m.isHidden && (!line || m.id > line.id)) line = m
	return line?.characterId ?? line?.personaId ?? null
}

/**
 * Each listed character's current sprite — the one on the newest visible
 * line it spoke — in one pass over the log.
 */
export function currentSpritesOf(
	ids: Iterable<number>,
	messages: readonly CharactersSourceMessage[]
): Map<number, ShownSprite | null> {
	const out = new Map<number, ShownSprite | null>()
	const newest = new Map<number, number>()
	for (const id of ids) out.set(id, null)
	for (const m of messages) {
		const id = m.characterId
		if (id == null || !out.has(id) || m.isHidden) continue
		if ((newest.get(id) ?? -Infinity) > m.id) continue
		const sprite = shownSpriteOf(m)
		if (!sprite) continue
		newest.set(id, m.id)
		out.set(id, sprite)
	}
	return out
}

/** A line's time in ms; null for one with no readable time. */
function msOf(at: CharactersSourceMessage["createdAt"]): number | null {
	if (at == null) return null
	const ms =
		typeof at === "number"
			? at
			: at instanceof Date
				? at.getTime()
				: Date.parse(at)
	return Number.isFinite(ms) ? ms : null
}

/**
 * When each listed member last spoke (W6) — the time of the newest visible
 * line it wrote: a character's by `characterId`, a persona's by
 * `personaId` — in one pass over the log; null for one that has spoken
 * none here.
 */
export function lastSpokeOf(
	ids: Iterable<number>,
	messages: readonly CharactersSourceMessage[]
): Map<number, number | null> {
	const out = new Map<number, number | null>()
	for (const id of ids) out.set(id, null)
	for (const m of messages) {
		if (m.isHidden) continue
		const id = m.characterId ?? m.personaId
		if (id == null || !out.has(id)) continue
		const at = msOf(m.createdAt)
		if (at === null) continue
		if ((out.get(id) ?? -Infinity) < at) out.set(id, at)
	}
	return out
}

/** Every card id the section seats, characters and personas alike. */
export function castIdsOf(
	session: CharactersSourceSession | null | undefined
): number[] {
	const ids: number[] = []
	for (const link of session?.sessionCharacters ?? [])
		if (typeof link.character?.id === "number") ids.push(link.character.id)
	for (const link of session?.sessionPersonas ?? [])
		if (typeof link.persona?.id === "number") ids.push(link.persona.id)
	return ids
}

/** Stable by `position`; a row without one keeps its place in the payload. */
function byPosition<T extends { position?: number | null }>(
	rows: readonly T[]
): T[] {
	return rows
		.map((row, at) => ({ row, at }))
		.sort(
			(a, b) =>
				(a.row.position ?? a.at) - (b.row.position ?? b.at) ||
				a.at - b.at
		)
		.map(({ row }) => row)
}

/** The card's default set: the flagged one, else the first. */
function cardSetOf(card: CharacterCard): string | null {
	const sets = card.spriteSets ?? []
	return (sets.find((s) => s.isDefault) ?? sets[0])?.name ?? null
}

/**
 * The face the cast retells for a seated character, full size — null when
 * the cast leaves the face to the card.
 */
export function castFaceOf(
	session: CharactersSourceSession,
	id: number,
	opts: { full?: boolean } = { full: true }
): string | null {
	const mediaId = session.castFaces?.[id]
	if (typeof mediaId !== "number") return null
	return avatarSrc({ avatarMediaId: mediaId }, opts) ?? null
}

/**
 * The name a seated character is shown by: the cast member's own name in
 * this book, else the card's (`memberShownName`).
 */
export function castNameOf(
	session: CharactersSourceSession,
	id: number,
	card: { name?: string | null; nickname?: string | null } | null | undefined,
	fallback = ""
): string {
	return memberShownName(session.castNames?.[id], card, fallback)
}

/**
 * 🚧 The seat's card as its cast member shows it (s27 S2): the member's own
 * name and nickname over the card's (`withMemberNames`), its own sprite sets
 * in place of the card's, and its retold face as the avatar. Keyed by the
 * seated card's id, as the payload is. The SAME object when the seat has
 * nothing of the member's. A persona seat's card goes through it as a
 * character seat's does (s27 S2c).
 */
export function seatCardAsShown<
	T extends HasSprites & {
		id?: number | null
		name?: string | null
		nickname?: string | null
	}
>(
	session:
		| Pick<
				CharactersSourceSession,
				"castNames" | "castFaces" | "castSpriteSets"
		  >
		| null
		| undefined,
	card: T
): T {
	const id = card.id
	if (typeof id !== "number") return card
	const named = withMemberNames(card, session?.castNames?.[id])
	const sets = session?.castSpriteSets?.[id]
	const face = session?.castFaces?.[id]
	if (named === card && !Array.isArray(sets) && typeof face !== "number")
		return card
	return {
		...named,
		...(Array.isArray(sets)
			? { spriteSets: sets as SessionSpriteSet[] }
			: {}),
		// As `withPortrait`: a stored media row, a preview or a baked URL
		// would each win over the id, so the face takes their place.
		...(typeof face === "number"
			? {
					avatarMediaId: face,
					avatarMedia: null,
					avatar: null,
					_avatar: null
				}
			: {})
	}
}

/**
 * 🚧 The session's character seats' cards, each as its cast member shows it
 * (`seatCardAsShown`), in payload order; a seat whose card is gone is left
 * out. Personas are not here: its callers list the cast a speaker is picked
 * from.
 */
export function seatCardsAsShown<C extends CharacterCard>(
	session:
		| (Pick<
				CharactersSourceSession,
				"castNames" | "castFaces" | "castSpriteSets"
		  > & {
				sessionCharacters?:
					| readonly { character?: C | null }[]
					| null
		  })
		| null
		| undefined
): C[] {
	const out: C[] = []
	for (const link of session?.sessionCharacters ?? [])
		if (link.character) out.push(seatCardAsShown(session, link.character))
	return out
}

interface Seat {
	/** The payload seat row this seat was read from, and the table it sits in (s27 S3). */
	row: PayloadSeat
	form: "character" | "player"
	card: CharacterCard & { id: number }
	/** The card as the seat's cast member shows it, a persona's seat included. */
	shown: CharacterCard & { id: number }
	isPersona: boolean
	/** Switched off in Participants: in the session, out of the turns (W6). */
	benched: boolean
	/** A persona seat's seat name, which wins over its cast member's name (★pT-1). */
	seatName?: string | null
}

/**
 * 🚧 The ref a seat answers to: the seat's own (`seatRefOf` — the host-filled
 * one, else today's form); ⏳ `character:<card id>` for a row that carries no
 * seat fields at all — a card-form payload, kept until S5 drops the card form.
 */
function refOfSeat({ row, form, card }: Seat): string {
	return seatRefOf(row, form) ?? `character:${card.id}`
}

function memberOf(
	seat: Seat,
	session: CharactersSourceSession,
	viewerUserId: number | null,
	voiced: number | null,
	sprites: ReadonlyMap<number, ShownSprite | null>,
	lastSpoke: ReadonlyMap<number, number | null>
): SessionCharacterV1 {
	const { card, shown, isPersona, benched, seatName, row } = seat
	const id = card.id
	const picked = isPersona ? null : (session.spriteSetOverrides?.[id] ?? null)
	const castFace = castFaceOf(session, id)
	const wanted = currentSpriteIn(sprites.get(id) ?? null, picked)
	const viewer = viewerUserId
	return {
		ref: refOfSeat(seat) as SessionCharacterV1["ref"],
		// The seat's member, only where the payload row says (`castMemberId`);
		// the card the member shows is the SDK's `cardId`, which only the host knows.
		...("castMemberId" in row ? { castMemberId: row.castMemberId ?? null } : {}),
		...(row.cardId !== undefined ? { cardId: row.cardId } : {}),
		characterId: id,
		isPersona,
		mine: isPersona && voiced === id,
		// A seat name wins over the member's name (★pT-1); with no member
		// name in play the card's name stands, as before.
		name:
			isPersona && seatName?.trim() && session.castNames?.[id]
				? seatName.trim()
				: castNameOf(session, id, card),
		face: castFace ?? avatarSrc(shown, { full: true }) ?? null,
		sprite: resolveSprite(shown, wanted)
			? (spriteSrc(shown, wanted, { full: true }) ?? null)
			: null,
		spriteSets: (shown.spriteSets ?? []).map((s) => s.name),
		spriteSet: picked || cardSetOf(shown),
		spriteSetOverride: picked || null,
		canChangeSpriteSet:
			!isPersona &&
			viewer != null &&
			(session.userId === viewer || card.userId === viewer),
		lastSpokeAt: lastSpoke.get(id) ?? null,
		// `galleryCount` is left out: the session payload carries no count,
		// and absent says "not known" where 0 would say "none".
		benched
	}
}

/**
 * A pinned portrait, with the member it pictures. A pin is stored as a bare
 * image URL, so it is matched by face: the full avatar a portrait shows, or
 * the thumbnail the Scene images tab pins — the cast's retold face as well as
 * the card's, since a pin made before or after the cast retold it shows one
 * or the other. An image pinned from a gallery pictures nobody the page can
 * name.
 */
function pinOf(
	src: string | null,
	cards: readonly Seat[],
	session: CharactersSourceSession
): SessionSceneImageV1 | null {
	if (!src) return null
	const seat = cards.find(
		({ card }) =>
			avatarSrc(card, { full: true }) === src ||
			avatarSrc(card) === src ||
			castFaceOf(session, card.id) === src ||
			castFaceOf(session, card.id, {}) === src
	)
	return {
		src,
		ref: seat ? (refOfSeat(seat) as SessionSceneImageV1["ref"]) : null
	}
}

/**
 * The section for the page's session: its characters still seated — a
 * benched one included, marked `benched` (W6: a reader that means "in the
 * scene" leaves it out) — then its personas still voiced, each once, a
 * benched player seat marked `benched` the same way (owner 2026-11-10).
 */
export function projectCharacters(
	source: CharactersSource
): SessionCharactersV1 {
	const session = source.session ?? {}
	const seats: Seat[] = []
	const seen = new Set<number>()
	const seat = (
		row: PayloadSeat,
		card: CharacterCard | null | undefined,
		isPersona: boolean,
		benched = false,
		seatName: string | null = null
	) => {
		if (typeof card?.id !== "number" || seen.has(card.id)) return
		seen.add(card.id)
		const seated = card as Seat["card"]
		seats.push({
			row,
			form: isPersona ? "player" : "character",
			card: seated,
			shown: seatCardAsShown(session, seated),
			isPersona,
			benched,
			seatName
		})
	}
	for (const link of byPosition(session.sessionCharacters ?? []))
		if (!link.removedAt)
			seat(link, link.character, false, link.isActive === false)
	for (const link of byPosition(session.sessionPersonas ?? []))
		if (!link.removedAt) seat(link, link.persona, true, link.isActive === false, link.seatName ?? null)

	const viewer = source.viewerUserId
	const theirs = seats.filter(
		(s) => s.isPersona && viewer != null && s.card.userId === viewer
	)
	const voiced =
		(theirs.find((s) => s.card.id === source.voicedPersonaId) ?? theirs[0])
			?.card.id ?? null
	const asOf = messagesAsOf(
		session.sessionMessages ?? [],
		source.shownMessageId
	)
	const sprites =
		source.currentSprites ??
		currentSpritesOf(
			seats.map((s) => s.card.id),
			asOf
		)
	const lastSpoke =
		source.lastSpoke ??
		lastSpokeOf(
			seats.map((s) => s.card.id),
			asOf
		)
	const speaker =
		source.speakerId !== undefined
			? source.speakerId
			: speakerOf(session.sessionMessages ?? [], source.shownMessageId)
	const speaking = seats.find((s) => s.card.id === speaker)
	return {
		members: seats.map((s) =>
			memberOf(s, session, viewer, voiced, sprites, lastSpoke)
		),
		speakerRef: speaking
			? (refOfSeat(speaking) as SessionCharactersV1["speakerRef"])
			: null,
		sceneImages: {
			left: pinOf(source.sceneImages.left, seats, session),
			right: pinOf(source.sceneImages.right, seats, session)
		}
	}
}
