/**
 * 🚧 A character's **likeness** as the wire and the card editor carry it
 * (DESIGN-image-generation §5). The server's `characters/likeness.ts` owns
 * the rules; this is the shape and the one read a client needs.
 *
 * Not the avatar, not a sprite, not the description.
 */

/** Stored in `characters.extensions.serenepub.likeness`; every part optional. */
export interface CharacterLikenessInput {
	/** The likeness image's `files` row; absent means "use the avatar". */
	imageMediaId?: number
	/** The likeness prompt — a tag line of the character's look. */
	prompt?: string
	/** The likeness negative — what to keep out of the picture. */
	negative?: string
}

/** The stored likeness off a character's `extensions`, unvalidated but shaped. */
export function likenessOfExtensions(
	extensions: unknown
): CharacterLikenessInput {
	const sp = (extensions as { serenepub?: { likeness?: unknown } } | null)
		?.serenepub
	const raw = sp?.likeness
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
	const l = raw as Record<string, unknown>
	return {
		...(typeof l.imageMediaId === "number"
			? { imageMediaId: l.imageMediaId }
			: {}),
		...(typeof l.prompt === "string" ? { prompt: l.prompt } : {}),
		...(typeof l.negative === "string" ? { negative: l.negative } : {})
	}
}
