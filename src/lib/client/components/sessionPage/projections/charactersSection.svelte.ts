/**
 * 🚧 The page's live `characters.v1` (`projectCharacters`), recomputed only
 * when something it shows can have changed.
 *
 * The page replaces its session payload wholesale on every streamed chunk, so
 * a section that read the whole payload would rebuild itself, and every
 * granted widget's wire would re-serialise it, once per token. Here the cast,
 * the owner and the sprite-set picks are each read as their own value (the
 * same references across a chunk), and the log only through the members'
 * current sprites, reduced to a string: a chunk that changes no member's
 * current sprite leaves the section exactly as it was.
 *
 * Construct during component init; the deriveds belong to the component.
 */
import { untrack } from "svelte"
import type { SessionCharactersV1 } from "@serene-pub/sdk"
import {
	castIdsOf,
	currentSpritesOf,
	projectCharacters,
	type CharactersSourceSession
} from "./characters"

export interface CharactersSectionInputs {
	/** The session the page is on. */
	sessionId(): number | null | undefined
	/** The payload the page holds, which may still be another session's. */
	session(): (CharactersSourceSession & { id?: number | null }) | null | undefined
	viewerUserId(): number | null
	voicedPersonaId(): number | null | undefined
	/** The page's own pins. */
	sceneImages(): { left: string | null; right: string | null }
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
	// Re-read on every chunk, but only a changed current sprite changes the key.
	const sprites = $derived(
		currentSpritesOf(
			castIdsOf({ sessionCharacters: characters, sessionPersonas: personas }),
			input.session()?.sessionMessages ?? []
		)
	)
	const spritesKey = $derived(JSON.stringify([...sprites]))
	const current = $derived.by(() => {
		const id = input.sessionId()
		if (id == null || loadedId !== id) return undefined
		void spritesKey
		return projectCharacters({
			session: {
				userId: owner,
				sessionCharacters: characters,
				sessionPersonas: personas,
				spriteSetOverrides: picks
			},
			viewerUserId: input.viewerUserId(),
			voicedPersonaId: input.voicedPersonaId(),
			sceneImages: input.sceneImages(),
			currentSprites: untrack(() => sprites)
		})
	})
	return {
		get current() {
			return current
		}
	}
}
