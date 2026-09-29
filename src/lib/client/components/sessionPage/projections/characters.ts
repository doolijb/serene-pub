/**
 * 🚧 `characters.v1` (R76): the session's cast as a widget draws it, with the
 * portraits pinned beside the conversation riding along — built from what the
 * page already holds (the session payload, who is looking, the page's pins).
 *
 * Pure: plain values in, a detached section out. The page wraps it in a
 * `$derived` and sets it under `SESSION_CHARACTERS_KEY`; a panel granted
 * `characters` hands it to its widget — on its ctx when native, posted when
 * remote — so both read ONE projection.
 *
 * **Cast over card.** Each member is the character card overlaid by what the
 * session's cast says of it, the cast winning wherever both speak. Today the
 * one cast fact the session payload carries is the cast member's sprite-set
 * pick (`spriteSetOverrides` — the `session_cast` sprite-set value,
 * DESIGN-sprites §2.3), so that is the one overlay here; the name is the one
 * the session shows everywhere else (nickname over name, as the header's cast
 * discs and the log's speaker labels have it) and the face is the card's.
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

/** A line of the log, as far as a current sprite needs it. */
export interface CharactersSourceMessage {
	id: number
	characterId?: number | null
	isHidden?: boolean | null
	metadata?: unknown
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

interface Seat {
	card: CharacterCard & { id: number }
	isPersona: boolean
}

function memberOf(
	{ card, isPersona }: Seat,
	session: CharactersSourceSession,
	viewerUserId: number | null,
	voiced: number | null,
	sprites: ReadonlyMap<number, ShownSprite | null>
): SessionCharacterV1 {
	const id = card.id
	const picked = isPersona ? null : (session.spriteSetOverrides?.[id] ?? null)
	const wanted = currentSpriteIn(sprites.get(id) ?? null, picked)
	const viewer = viewerUserId
	return {
		ref: `character:${id}`,
		characterId: id,
		isPersona,
		mine: isPersona && voiced === id,
		name: resolveCharacterName(card, ""),
		face: avatarSrc(card, { full: true }) ?? null,
		sprite: resolveSprite(card, wanted)
			? (spriteSrc(card, wanted, { full: true }) ?? null)
			: null,
		spriteSets: (card.spriteSets ?? []).map((s) => s.name),
		spriteSet: picked || cardSetOf(card),
		spriteSetOverride: picked || null,
		canChangeSpriteSet:
			!isPersona &&
			viewer != null &&
			(session.userId === viewer || card.userId === viewer)
	}
}

/**
 * A pinned portrait, with the member it pictures. A pin is stored as a bare
 * image URL, so it is matched by face: the full avatar a portrait shows, or
 * the thumbnail the Scene images tab pins. An image pinned from a gallery
 * pictures nobody the page can name.
 */
function pinOf(
	src: string | null,
	cards: readonly Seat[]
): SessionSceneImageV1 | null {
	if (!src) return null
	const seat = cards.find(
		({ card }) =>
			avatarSrc(card, { full: true }) === src || avatarSrc(card) === src
	)
	return { src, ref: seat ? `character:${seat.card.id}` : null }
}

/**
 * The section for the page's session: its characters still seated and
 * active, then its personas still voiced, each once.
 */
export function projectCharacters(source: CharactersSource): SessionCharactersV1 {
	const session = source.session ?? {}
	const seats: Seat[] = []
	const seen = new Set<number>()
	const seat = (card: CharacterCard | null | undefined, isPersona: boolean) => {
		if (typeof card?.id !== "number" || seen.has(card.id)) return
		seen.add(card.id)
		seats.push({ card: card as Seat["card"], isPersona })
	}
	for (const link of byPosition(session.sessionCharacters ?? []))
		if (link.isActive !== false && !link.removedAt) seat(link.character, false)
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
	return {
		members: seats.map((s) => memberOf(s, session, viewer, voiced, sprites)),
		sceneImages: {
			left: pinOf(source.sceneImages.left, seats),
			right: pinOf(source.sceneImages.right, seats)
		}
	}
}
