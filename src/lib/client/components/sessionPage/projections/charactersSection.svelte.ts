/**
 * 🚧 The page's live `characters.v1` (`projectCharacters`), recomputed only
 * when something it shows can have changed.
 *
 * The page replaces its session payload wholesale on every streamed chunk, so
 * a section that read the whole payload would rebuild itself, and every
 * granted widget's wire would re-serialise it, once per token. Here the cast,
 * the owner, the sprite-set picks and the cast's faces are each read as their own value (the
 * same references across a chunk), and the log only through the members'
 * current sprites and last lines' times (W6), each reduced to a string: a
 * chunk that changes neither leaves the section exactly as it was — a
 * streamed line keeps its time, so only a new line moves it.
 *
 * Construct during component init; the deriveds belong to the component.
 */
import { untrack } from "svelte"
import type { SessionCharactersV1 } from "@serene-pub/sdk"
import { shownLineOf } from "../requests/showLine"
import {
	castIdsOf,
	currentSpritesOf,
	lastSpokeOf,
	messagesAsOf,
	projectCharacters,
	speakerOf,
	type CharactersSourceSession
} from "./characters"

const NO_CAST_FACES: Readonly<Record<number, number>> = Object.freeze({})
const NO_CAST_NAMES: NonNullable<CharactersSourceSession["castNames"]> =
	Object.freeze({})
const NO_CAST_SPRITE_SETS: NonNullable<
	CharactersSourceSession["castSpriteSets"]
> = Object.freeze({})

export interface CharactersSectionInputs {
	/** The session the page is on. */
	sessionId(): number | null | undefined
	/** The payload the page holds, which may still be another session's. */
	session(): (CharactersSourceSession & { id?: number | null }) | null | undefined
	viewerUserId(): number | null
	voicedPersonaId(): number | null | undefined
	/** The page's own pins. */
	sceneImages(): { left: string | null; right: string | null }
	/**
	 * The line a Dialogue box's reader is on (a message id), or null; the
	 * page's `show-line` answer for this session when not given.
	 */
	shownLine?(): number | null
}

/** The page's live section: read `current`. */
export function charactersSection(input: CharactersSectionInputs): {
	readonly current: SessionCharactersV1 | undefined
} {
	const loadedId = $derived(input.session()?.id)
	const owner = $derived(input.session()?.userId)
	const characters = $derived(input.session()?.sessionCharacters)
	const personas = $derived(input.session()?.sessionPersonas)
	const picks = $derived(input.session()?.spriteSetOverrides)
	// One shared empty when the payload carries none, so a chunk keeps the reference.
	const castFaces = $derived(input.session()?.castFaces ?? NO_CAST_FACES)
	// The book member's own names (§0-D), the same shared empty when none.
	const castNames = $derived(input.session()?.castNames ?? NO_CAST_NAMES)
	// The member's own sprite sets (s27 S2), the same shared empty when none.
	const castSpriteSets = $derived(
		input.session()?.castSpriteSets ?? NO_CAST_SPRITE_SETS
	)
	const shownLine = $derived(
		input.shownLine ? input.shownLine() : shownLineOf(input.sessionId())
	)
	// The log as of the shown line (the same array when none is shown).
	const asOf = $derived(
		messagesAsOf(input.session()?.sessionMessages ?? [], shownLine)
	)
	// Re-read on every chunk, but only a changed current sprite changes the key.
	const sprites = $derived(
		currentSpritesOf(
			castIdsOf({ sessionCharacters: characters, sessionPersonas: personas }),
			asOf
		)
	)
	const spritesKey = $derived(JSON.stringify([...sprites]))
	const lastSpoke = $derived(
		lastSpokeOf(
			castIdsOf({ sessionCharacters: characters, sessionPersonas: personas }),
			asOf
		)
	)
	const lastSpokeKey = $derived(JSON.stringify([...lastSpoke]))
	// A primitive, so a chunk that moves no speaker leaves the section alone.
	const speakerId = $derived(
		speakerOf(input.session()?.sessionMessages ?? [], shownLine)
	)
	const current = $derived.by(() => {
		const id = input.sessionId()
		if (id == null || loadedId !== id) return undefined
		void spritesKey
		void lastSpokeKey
		const speaker = speakerId
		return projectCharacters({
			session: {
				userId: owner,
				sessionCharacters: characters,
				sessionPersonas: personas,
				spriteSetOverrides: picks,
				castFaces,
				castNames,
				castSpriteSets
			},
			viewerUserId: input.viewerUserId(),
			voicedPersonaId: input.voicedPersonaId(),
			sceneImages: input.sceneImages(),
			currentSprites: untrack(() => sprites),
			lastSpoke: untrack(() => lastSpoke),
			speakerId: speaker
		})
	})
	return {
		get current() {
			return current
		}
	}
}
