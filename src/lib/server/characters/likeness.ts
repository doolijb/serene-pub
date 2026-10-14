/**
 * 🚧 A character's **likeness** (DESIGN-image-generation §5): how to *draw*
 * them — a **likeness image** (the reference a picture model is shown), a
 * **likeness prompt** (a tag line of their look) and a **likeness negative**
 * (what to keep out of the picture).
 *
 * Not the avatar (the card's identity image — the likeness image only
 * *defaults* to it), not a sprite, and not the description (prose for the
 * language model).
 *
 * ## Where it lives
 *
 * Column-free, in `characters.extensions.serenepub.likeness`, so it travels
 * with the card (the dowry precedent). Export writes it (`exportedExtensions`
 * keeps it); import reads ours, and when ours is absent reads SillyTavern's
 * `extensions.sd_character_prompt { positive, negative }` into the prompt and
 * the negative — one direction only (R5): nothing here ever writes ST's key.
 *
 * `imageMediaId` is a **role pointer** like `avatarMediaId`, but a plain
 * number with no foreign key: a stale id renders missing, which is the media
 * table's rule. The media permission check still decides who sees it.
 *
 * Pure: no database, no socket.
 */

import type { CharacterLikenessInput } from "$lib/shared/characters/likeness"

/** What is stored, every part optional (the wire's shape). */
export type CharacterLikeness = CharacterLikenessInput

/** What a reader gets: the image resolved to the avatar when unset. */
export interface ResolvedLikeness {
	/** The likeness image, else the avatar, else null. */
	imageMediaId: number | null
	/** True when `imageMediaId` is the avatar standing in. */
	imageIsAvatar: boolean
	prompt: string
	negative: string
}

/** Ceilings on what a card may carry; longer text is cut, not refused. */
export const LIKENESS_LIMITS = Object.freeze({
	promptChars: 2000,
	negativeChars: 2000
} as const)

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

const cleanText = (v: unknown, max: number): string | undefined => {
	if (typeof v !== "string") return undefined
	const t = v.trim().slice(0, max)
	return t ? t : undefined
}

const cleanId = (v: unknown): number | undefined =>
	typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : undefined

/**
 * A likeness from untrusted input (a card, a socket): unknown keys dropped,
 * text trimmed and capped, a bad id treated as absent. `null` when nothing
 * is left — "no likeness" is the absence of the key, never an empty object.
 */
export function sanitizeLikeness(raw: unknown): CharacterLikeness | null {
	if (!isPlainObject(raw)) return null
	const out: CharacterLikeness = {}
	const id = cleanId(raw.imageMediaId)
	if (id !== undefined) out.imageMediaId = id
	const prompt = cleanText(raw.prompt, LIKENESS_LIMITS.promptChars)
	if (prompt !== undefined) out.prompt = prompt
	const negative = cleanText(raw.negative, LIKENESS_LIMITS.negativeChars)
	if (negative !== undefined) out.negative = negative
	return Object.keys(out).length ? out : null
}

/** The stored likeness off a character row's `extensions`, sanitized. */
export function readLikeness(
	extensions: unknown
): CharacterLikeness | null {
	if (!isPlainObject(extensions)) return null
	const sp = extensions.serenepub
	return isPlainObject(sp) ? sanitizeLikeness(sp.likeness) : null
}

/**
 * `extensions` with the likeness set (or removed, for `null`), every other
 * key — ours and another tool's — kept as it was. Never mutates its input.
 */
export function withLikeness(
	extensions: unknown,
	likeness: CharacterLikeness | null
): Record<string, unknown> {
	const base = isPlainObject(extensions) ? { ...extensions } : {}
	const sp = isPlainObject(base.serenepub) ? { ...base.serenepub } : {}
	const clean = sanitizeLikeness(likeness)
	if (clean) sp.likeness = clean
	else delete sp.likeness
	if (Object.keys(sp).length) base.serenepub = sp
	else delete base.serenepub
	return base
}

/**
 * The likeness a card brings on import, from its V3 `data.extensions`:
 * `serenepub.likeness` when present, else SillyTavern's
 * `sd_character_prompt { positive, negative }` read into prompt and negative
 * (R5 — one direction). `null` when the card carries neither.
 */
export function likenessFromCardExtensions(
	ext: unknown
): CharacterLikeness | null {
	if (!isPlainObject(ext)) return null
	const ours = isPlainObject(ext.serenepub)
		? sanitizeLikeness(ext.serenepub.likeness)
		: null
	if (ours) return ours
	const st = ext.sd_character_prompt
	if (!isPlainObject(st)) return null
	return sanitizeLikeness({ prompt: st.positive, negative: st.negative })
}

/**
 * A character's likeness, resolved: the likeness image falls back to the
 * avatar. Takes the row (or anything carrying `extensions` and
 * `avatarMediaId`).
 */
export function likenessOf(character: {
	extensions?: unknown
	avatarMediaId?: number | null
}): ResolvedLikeness {
	const stored = readLikeness(character?.extensions)
	const avatar = cleanId(character?.avatarMediaId) ?? null
	const own = stored?.imageMediaId ?? null
	return {
		imageMediaId: own ?? avatar,
		imageIsAvatar: own === null && avatar !== null,
		prompt: stored?.prompt ?? "",
		negative: stored?.negative ?? ""
	}
}
