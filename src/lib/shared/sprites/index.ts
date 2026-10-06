/**
 * Sprites — a card's labelled faces (DESIGN-sprites, ~/.claude/plans).
 *
 * Shared by the server and the client, so the one spelling of each rule lives
 * here: what a shown sprite records, how a sprite label is normalised, how a
 * SillyTavern filename becomes a label, and which label a line falls back to.
 *
 * Vocabulary (NOMENCLATURE §24 ledger, 2026-09-24):
 *   - **sprite** — one labelled image a card can show. A row, not a file.
 *   - **sprite label** — its name (`joy`, `swimsuit`), as the card authored it.
 *   - **sprite set** — a named group of a card's sprites (an outfit, an age).
 *   - **shown sprite** — the `{ set, label }` recorded on one line.
 *   - **current sprite** — a cast member's shown sprite on their newest line.
 *     Derived, never stored.
 *   - *emotion* is the CARD-BOUNDARY word only (the CCv3 asset type, and a
 *     classifier's output); it maps onto a sprite label at the boundary.
 */

/** Who chose a line's sprite. A person's choice is never overwritten by a picker. */
export type SpriteSource = "picker" | "person"

/**
 * The sprite one line showed. The SET is recorded with the label: a line shows
 * what the speaker wore when they said it, so scrolling back past an outfit
 * change keeps the old outfit on the old lines.
 */
export interface ShownSprite {
	set: string
	label: string
	source: SpriteSource
}

/** Where a sprite row came from. */
export type SpriteOrigin = "card" | "upload" | "sillytavern" | "generated"

/** One sprite as a payload carries it — an address, never a path. */
export interface SpriteView {
	id: number
	/** The sprite label. */
	label: string
	/** Order among the label's variants. */
	position: number
	source: SpriteOrigin
	/** Null for an **empty sprite**: a slot waiting for an image. */
	media: { id: number; uuid: string; rev: number; frame: unknown } | null
}

/** One sprite set, its sprites in (label, position) order. */
export interface SpriteSetView {
	id: number
	/** Normalised (`normalizeSpriteName`) — the key a cast amendment names. */
	name: string
	isDefault: boolean
	position: number
	sprites: SpriteView[]
}

/** The name given to a card's first set. */
export const DEFAULT_SPRITE_SET_NAME = "Default"

/**
 * The CCv3 default: an `emotion` asset named `neutral` is the fallback face
 * "if the application supports emotions" (SPEC_V3 §assets).
 */
export const NEUTRAL_SPRITE_LABEL = "neutral"

/**
 * The **standard set** the editor offers as empty slots: go_emotions' 28
 * labels, which is also SillyTavern's default expression list, so a pack
 * named for SillyTavern lands on these exactly. A starter, never a vocabulary
 * — a card's own labels are whatever it authored.
 */
export const STANDARD_SPRITE_LABELS: readonly string[] = [
	"admiration",
	"amusement",
	"anger",
	"annoyance",
	"approval",
	"caring",
	"confusion",
	"curiosity",
	"desire",
	"disappointment",
	"disapproval",
	"disgust",
	"embarrassment",
	"excitement",
	"fear",
	"gratitude",
	"grief",
	"joy",
	"love",
	"nervousness",
	"optimism",
	"pride",
	"realization",
	"relief",
	"remorse",
	"sadness",
	"surprise",
	"neutral"
]

/** Longest sprite label or set name kept. A card is untrusted input. */
export const MAX_SPRITE_NAME_LENGTH = 64

/**
 * Normalise a sprite label or set name: trim, collapse inner whitespace, fold
 * case, cap the length. Returns `""` for a name that is empty after that, which
 * callers treat as "no name".
 *
 * ⚠ Case-folded because every source disagrees on case (`Joy.png`, `joy`) and
 * a label is matched by equality everywhere — a picker's choice, a person's
 * override, a cast member's set. Nothing else is rewritten: `swimsuit (wet)`
 * stays itself, because the label is the author's word.
 */
export function normalizeSpriteName(name: unknown): string {
	if (typeof name !== "string") return ""
	return name
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase()
		.slice(0, MAX_SPRITE_NAME_LENGTH)
		.trim()
}

/**
 * The sprite label a SillyTavern sprite FILE carries: its name up to the first
 * `-` or `.`, which is SillyTavern's own rule (`endpoints/sprites.js`:
 * `/^(.+?)(?:[-\\.].*?)?$/`) — so `joy.png` and `joy-2.png` are both `joy`.
 */
export function spriteLabelFromFilename(filename: string): string {
	const base = filename.split(/[\\/]/).pop() ?? filename
	const match = base.match(/^(.+?)(?:[-.].*?)?$/)
	return normalizeSpriteName(match?.[1] ?? base)
}

/** One sprite as a picker or a renderer needs it. */
export interface SpriteChoice {
	set: string
	label: string
}

/**
 * The sprite a line falls back to when the one it asked for is not in the set
 * (DESIGN-sprites §2.3). **The set wins over the label**: the label in the
 * asked set → `neutral` in the asked set → the label in the default set →
 * `neutral` in the default set → nothing (the caller shows the avatar).
 *
 * Set first because the set is the slow, visible choice — an outfit, an age —
 * and the label a per-line mood: a character switched into armour whose
 * armour set has no "joy" should look like herself in armour, not jump back
 * into everyday clothes to smile. (Found walking the first build, 2026-09-24.)
 *
 * `has(set, label)` answers whether that set holds a sprite with an image.
 */
export function resolveSpriteFallback(
	wanted: SpriteChoice,
	defaultSet: string,
	has: (set: string, label: string) => boolean
): SpriteChoice | null {
	const tries: SpriteChoice[] = [
		wanted,
		{ set: wanted.set, label: NEUTRAL_SPRITE_LABEL },
		{ set: defaultSet, label: wanted.label },
		{ set: defaultSet, label: NEUTRAL_SPRITE_LABEL }
	]
	for (const t of tries) if (has(t.set, t.label)) return t
	return null
}

/** Narrow an unknown JSON value to a ShownSprite, or null. */
export function asShownSprite(value: unknown): ShownSprite | null {
	if (!value || typeof value !== "object") return null
	const v = value as Record<string, unknown>
	if (typeof v.set !== "string" || typeof v.label !== "string") return null
	const source: SpriteSource = v.source === "person" ? "person" : "picker"
	return { set: v.set, label: v.label, source }
}

/**
 * The metadata a line should carry after a sprite write (DESIGN-sprites
 * §5.2) — the one rule `core:outlet/show-sprite@1` applies, kept pure so it is
 * tested as a unit.
 *
 *  - The sprite lands on the ACTIVE swipe (`swipes.spriteHistory[currentIdx]`,
 *    kept parallel to `history`) and is mirrored to `metadata.sprite`.
 *  - A picker never overwrites a person's pick.
 *  - A picker's null pick writes nothing (`kept`): the line keeps what it
 *    shows. Only a person clears a line's sprite (2026-10-05, the
 *    `show-sprite` contract — the outlet now runs after every reply, faceless
 *    or not, so "chose nothing" must not read as "show nothing").
 *  - Writing what is already there is no write (`kept`).
 *
 * `pick` is untrusted (a port value): anything without a string set and label
 * is no pick — a person's clears the line's sprite, a picker's is kept.
 */
export function nextSpriteMetadata(
	metadata: Record<string, any> | null | undefined,
	pick: unknown,
	byPerson: boolean
): { kept: true; sprite: ShownSprite | null } | {
	kept: false
	sprite: ShownSprite | null
	metadata: Record<string, any>
} {
	const meta = metadata ?? {}
	const p = (pick ?? null) as { set?: unknown; label?: unknown } | null
	const set = normalizeSpriteName(p?.set)
	const label = normalizeSpriteName(p?.label)
	const next: ShownSprite | null =
		set && label ? { set, label, source: byPerson ? "person" : "picker" } : null
	const existing = asShownSprite(meta.sprite)
	if (!byPerson && (next === null || existing?.source === "person"))
		return { kept: true, sprite: existing }
	const same =
		(next === null && existing === null) ||
		(next !== null &&
			existing !== null &&
			next.set === existing.set &&
			next.label === existing.label &&
			next.source === existing.source)
	if (same) return { kept: true, sprite: existing }

	const out: Record<string, any> = { ...meta, sprite: next }
	const swipes = meta.swipes
	if (swipes && Array.isArray(swipes.history)) {
		const idx = typeof swipes.currentIdx === "number" ? swipes.currentIdx : 0
		const spriteHistory: (ShownSprite | null)[] = [
			...(Array.isArray(swipes.spriteHistory) ? swipes.spriteHistory : [])
		]
		while (spriteHistory.length < swipes.history.length) spriteHistory.push(null)
		spriteHistory.length = swipes.history.length
		if (idx >= 0 && idx < spriteHistory.length) spriteHistory[idx] = next
		out.swipes = { ...swipes, spriteHistory }
	}
	return { kept: false, sprite: next, metadata: out }
}
