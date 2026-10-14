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
 * face; absent, the card's avatar is. Personas are voiced, not cast, so
 * neither overlay touches them. The name is the one the session shows
 * everywhere else (nickname over name, as the header's cast discs and the
 * log's speaker labels have it); a retold name is not on this payload.
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
import type {
	SessionCharacterV1,
	SessionCharactersV1,
	SessionSceneImageV1
} from "@serene-pub/sdk"
import { avatarSrc } from "$lib/client/utils/media"
import {
	currentSpriteIn,
	resolveSprite,
	shownSpriteOf,
	spriteSrc,
	type HasSprites
} from "$lib/client/utils/sprites"
import type { ShownSprite } from "$lib/shared/sprites"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"

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
	sessionCharacters?: readonly {
		isActive?: boolean | null
		removedAt?: unknown
		position?: number | null
		character?: CharacterCard | null
	}[] | null
	sessionPersonas?: readonly {
		removedAt?: unknown
		position?: number | null
		persona?: CharacterCard | null
	}[] | null
	/** The cast's sprite-set picks, by character id (DESIGN-sprites §2.3). */
	spriteSetOverrides?: Readonly<Record<number, string>> | null
	/**
	 * The faces the session's lorebook cast retells, by character id: a
	 * `files` id, present only for a seat whose cast member retells its face.
	 */
	castFaces?: Readonly<Record<number, number>> | null
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
	const ms = typeof at === "number" ? at : at instanceof Date ? at.getTime() : Date.parse(at)
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
export function castIdsOf(session: CharactersSourceSession | null | undefined): number[] {
	const ids: number[] = []
	for (const link of session?.sessionCharacters ?? [])
		if (typeof link.character?.id === "number") ids.push(link.character.id)
	for (const link of session?.sessionPersonas ?? [])
		if (typeof link.persona?.id === "number") ids.push(link.persona.id)
	return ids
}

/** Stable by `position`; a row without one keeps its place in the payload. */
function byPosition<T extends { position?: number | null }>(rows: readonly T[]): T[] {
	return rows
		.map((row, at) => ({ row, at }))
		.sort(
			(a, b) =>
				(a.row.position ?? a.at) - (b.row.position ?? b.at) || a.at - b.at
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

interface Seat {
	card: CharacterCard & { id: number }
	isPersona: boolean
	/** Switched off in Participants: in the session, out of the turns (W6). */
	benched: boolean
}

function memberOf(
	{ card, isPersona, benched }: Seat,
	session: CharactersSourceSession,
	viewerUserId: number | null,
	voiced: number | null,
	sprites: ReadonlyMap<number, ShownSprite | null>,
	lastSpoke: ReadonlyMap<number, number | null>
): SessionCharacterV1 {
	const id = card.id
	const picked = isPersona ? null : (session.spriteSetOverrides?.[id] ?? null)
	const castFace = isPersona ? null : castFaceOf(session, id)
	const wanted = currentSpriteIn(sprites.get(id) ?? null, picked)
	const viewer = viewerUserId
	return {
		ref: `character:${id}`,
		characterId: id,
		isPersona,
		mine: isPersona && voiced === id,
		name: resolveCharacterName(card, ""),
		face: castFace ?? avatarSrc(card, { full: true }) ?? null,
		sprite: resolveSprite(card, wanted)
			? (spriteSrc(card, wanted, { full: true }) ?? null)
			: null,
		spriteSets: (card.spriteSets ?? []).map((s) => s.name),
		spriteSet: picked || cardSetOf(card),
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
		({ card, isPersona }) =>
			avatarSrc(card, { full: true }) === src ||
			avatarSrc(card) === src ||
			(!isPersona &&
				(castFaceOf(session, card.id) === src ||
					castFaceOf(session, card.id, {}) === src))
	)
	return { src, ref: seat ? `character:${seat.card.id}` : null }
}

/**
 * The section for the page's session: its characters still seated — a
 * benched one included, marked `benched` (W6: a reader that means "in the
 * scene" leaves it out) — then its personas still voiced, each once.
 */
export function projectCharacters(source: CharactersSource): SessionCharactersV1 {
	const session = source.session ?? {}
	const seats: Seat[] = []
	const seen = new Set<number>()
	const seat = (
		card: CharacterCard | null | undefined,
		isPersona: boolean,
		benched = false
	) => {
		if (typeof card?.id !== "number" || seen.has(card.id)) return
		seen.add(card.id)
		seats.push({ card: card as Seat["card"], isPersona, benched })
	}
	for (const link of byPosition(session.sessionCharacters ?? []))
		if (!link.removedAt) seat(link.character, false, link.isActive === false)
	for (const link of byPosition(session.sessionPersonas ?? []))
		if (!link.removedAt) seat(link.persona, true)

	const viewer = source.viewerUserId
	const theirs = seats.filter(
		(s) => s.isPersona && viewer != null && s.card.userId === viewer
	)
	const voiced =
		(theirs.find((s) => s.card.id === source.voicedPersonaId) ?? theirs[0])?.card.id ?? null
	const sprites =
		source.currentSprites ??
		currentSpritesOf(
			seats.map((s) => s.card.id),
			session.sessionMessages ?? []
		)
	const lastSpoke =
		source.lastSpoke ??
		lastSpokeOf(
			seats.map((s) => s.card.id),
			session.sessionMessages ?? []
		)
	return {
		members: seats.map((s) =>
			memberOf(s, session, viewer, voiced, sprites, lastSpoke)
		),
		sceneImages: {
			left: pinOf(source.sceneImages.left, seats, session),
			right: pinOf(source.sceneImages.right, seats, session)
		}
	}
}
