/**
 * `spriteSrc` — the ONE client answer to "which face does this character show
 * here?" (DESIGN-sprites §7). Called at the three display seams — Scene
 * Portraits, message avatars, the header's cast discs — and nowhere else, so
 * the fallback order lives in one place:
 *
 *   the wanted sprite → `neutral` in the wanted set → the same label in the
 *   default set → `neutral` in the default set → the avatar.
 *
 * The set wins over the label (`resolveSpriteFallback`).
 *
 * It reads the `spriteSets` the session payload joins onto each cast
 * character (`SESSION_SPRITE_SETS`, server/sockets/sessions.ts). A character
 * loaded without them simply shows its avatar.
 *
 * ⚠ URLs are built with `mediaRevUrl`, the same builder `avatarSrc` uses, so
 * a sprite URL and an avatar URL for the same file are the same STRING —
 * pinned scene images are matched to cast members by URL equality.
 */

import { avatarSrc, mediaRevUrl, type HasAvatar } from "$lib/client/utils/media"
import {
	asShownSprite,
	resolveSpriteFallback,
	type ShownSprite,
	type SpriteChoice
} from "$lib/shared/sprites"

/** A sprite as the session payload carries it. */
export interface SessionSprite {
	label: string
	position: number
	file: { uuid: string; rev: number } | null
}

/** A set as the session payload carries it. */
export interface SessionSpriteSet {
	name: string
	isDefault: boolean
	sprites: SessionSprite[]
}

/** A character that may carry its sprite sets. */
export type HasSprites = HasAvatar & {
	spriteSets?: SessionSpriteSet[] | null
}

/** The default set's name, or the first set's when none is flagged. */
function defaultSetName(sets: SessionSpriteSet[]): string | null {
	return (sets.find((s) => s.isDefault) ?? sets[0])?.name ?? null
}

/** The variants under (set, label) that have a file, in order. */
function variantsOf(
	sets: SessionSpriteSet[],
	choice: SpriteChoice
): SessionSprite[] {
	const set = sets.find((s) => s.name === choice.set)
	if (!set) return []
	return set.sprites
		.filter((p) => p.label === choice.label && p.file)
		.sort((a, b) => a.position - b.position)
}

/**
 * Resolve a wanted sprite to the one that will actually be drawn, applying
 * the fallback order. Null when the character has nothing to fall back to
 * (the caller draws the avatar).
 */
export function resolveSprite(
	character: HasSprites | null | undefined,
	wanted: SpriteChoice | null
): SpriteChoice | null {
	const sets = character?.spriteSets ?? []
	if (sets.length === 0) return null
	const def = defaultSetName(sets)
	if (!def) return null
	const want = wanted ?? { set: def, label: "neutral" }
	return resolveSpriteFallback(
		want,
		def,
		(set, label) => variantsOf(sets, { set, label }).length > 0
	)
}

/**
 * The URL to draw for `character` showing `wanted`.
 *
 * `variantKey` picks among a label's variants deterministically — a message id
 * rotates them across lines while one line always shows the same image (a
 * re-render never changes a face). Omitted: the first variant.
 */
export function spriteSrc(
	character: HasSprites | null | undefined,
	wanted: SpriteChoice | null,
	opts?: { full?: boolean; variantKey?: number }
): string | undefined {
	const chosen = resolveSprite(character, wanted)
	if (chosen) {
		const variants = variantsOf(character!.spriteSets!, chosen)
		const pick =
			variants[
				opts?.variantKey !== undefined
					? Math.abs(opts.variantKey) % variants.length
					: 0
			]
		if (pick?.file) {
			return mediaRevUrl(pick.file.uuid, pick.file.rev, { full: opts?.full })
		}
	}
	return avatarSrc(character ?? {}, { full: opts?.full })
}

/** A message's shown sprite, from its metadata. */
export function shownSpriteOf(message: {
	metadata?: unknown
}): ShownSprite | null {
	const meta = message?.metadata as { sprite?: unknown } | undefined
	return asShownSprite(meta?.sprite)
}

/**
 * A character's **current sprite**: the shown sprite on the newest visible
 * line it spoke, among the messages loaded. Derived, never stored
 * (DESIGN-sprites §3.3) — a swipe, a delete or a hide moves it with no write.
 *
 * `messages` may be in any order; the highest id wins.
 */
export function currentSpriteOf(
	characterId: number,
	messages: readonly {
		id: number
		characterId?: number | null
		isHidden?: boolean | null
		metadata?: unknown
	}[]
): ShownSprite | null {
	let best: { id: number; sprite: ShownSprite } | null = null
	for (const m of messages) {
		if (m.characterId !== characterId || m.isHidden) continue
		const sprite = shownSpriteOf(m)
		if (sprite && (!best || m.id > best.id)) best = { id: m.id, sprite }
	}
	return best?.sprite ?? null
}

/**
 * The current sprite, in the outfit the SESSION changed to (DESIGN-sprites
 * §2.3): the newest line's sprite label, drawn from `overrideSet` when the
 * session overrides the character's set — so a portrait redraws at once, and
 * `spriteSrc`'s fallback covers a label the new set lacks. With no line yet,
 * the override set's `neutral`.
 */
export function currentSpriteIn(
	current: { set: string; label: string } | null,
	overrideSet: string | null | undefined
): { set: string; label: string } | null {
	if (!overrideSet) return current
	return { set: overrideSet, label: current?.label ?? "neutral" }
}
