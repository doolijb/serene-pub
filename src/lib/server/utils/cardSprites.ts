/**
 * Sprites a character card carries — the card-boundary half of
 * DESIGN-sprites §4.
 *
 * Three places a card keeps them, and all three read here:
 *
 *  1. **CCv3 `data.assets`** of type `emotion` (SillyTavern also writes
 *     `expression`): the asset's `name` is the sprite label, and every such
 *     asset lands in the card's default set. In a CHARX the URI is
 *     `embeded://<path in the zip>`; in a RisuAI PNG it is `__asset:<n>`,
 *     pointing at a `chara-ext-asset_:<n>` tEXt chunk; anywhere it may be a
 *     `data:` URI.
 *  2. **`x_sp_sprite` assets** — Serene Pub's own export of NON-default sets
 *     (the spec reserves `x_` types for exactly this): `name` is
 *     `<set>/<label>`.
 *  3. **RisuAI's older `extensions.risuai.emotions`**: `[label, value]` pairs,
 *     the value raw base64 or `__asset:<key>`.
 *
 * "emotion" is the card's word (NOMENCLATURE R5); inside Serene Pub every one
 * of these is a **sprite** with a **sprite label**.
 *
 * ⚠ Untrusted input. Nothing here fetches a URL (an `http(s)` sprite is left
 * behind and counted), every image is capped before it is decoded, and the
 * whole card is capped too — `CARD_SPRITE_LIMITS`.
 */

import { normalizeSpriteName } from "$lib/shared/sprites"

/** One sprite a card carried, bytes in hand. */
export interface CardSprite {
	/** The set, for an `x_sp_sprite`; absent = the card's default set. */
	set?: string
	label: string
	bytes: Buffer
	filename?: string
}

export const CARD_SPRITE_LIMITS = {
	count: 512,
	eachBytes: 16 * 1024 * 1024,
	totalBytes: 256 * 1024 * 1024
}

/** Asset types that are sprites in the default set. */
export const SPRITE_ASSET_TYPES: ReadonlySet<string> = new Set([
	"emotion",
	"expression"
])

/** Serene Pub's own asset type for a sprite in a non-default set. */
export const SP_SPRITE_ASSET_TYPE = "x_sp_sprite"

/** Decode a base64 payload, refusing one that would exceed `maxBytes`. */
export function decodeBase64Capped(
	b64: string,
	maxBytes: number
): Buffer | null {
	const clean = b64.replace(/\s+/g, "")
	if ((clean.length * 3) / 4 > maxBytes) return null
	const buf = Buffer.from(clean, "base64")
	return buf.length > 0 ? buf : null
}

/** The bytes behind a `data:` URI, capped, or null. */
export function bytesOfDataUri(uri: string, maxBytes: number): Buffer | null {
	const b64 = uri.match(/^data:[^,]*;base64,(.*)$/s)?.[1]
	return b64 ? decodeBase64Capped(b64, maxBytes) : null
}

/** The zip path an `embeded://` (or correctly spelled) URI names, or null. */
export function embeddedPathOf(uri: unknown): string | null {
	if (typeof uri !== "string") return null
	const m = uri.trim().match(/^embedd?ed:\/\/\/?(.+)$/i)
	return m ? m[1].replace(/\\/g, "/") : null
}

interface SpriteAsset {
	asset: any
	set?: string
	label: string
	uri: string
}

/** The card's sprite assets, labelled, in card order. */
export function spriteAssetsOf(raw: any): SpriteAsset[] {
	const assets = raw?.data?.assets ?? raw?.assets
	if (!Array.isArray(assets)) return []
	// A Serene Pub CHARX names its default set here, so that set's variants
	// (exported as `x_sp_sprite`) file back into the DEFAULT set on import.
	const defaultSet = normalizeSpriteName(
		raw?.data?.extensions?.serenepub?.defaultSpriteSet
	)
	const out: SpriteAsset[] = []
	for (const asset of assets) {
		if (!asset || typeof asset.uri !== "string") continue
		const type = typeof asset.type === "string" ? asset.type.toLowerCase() : ""
		if (SPRITE_ASSET_TYPES.has(type)) {
			const label = normalizeSpriteName(asset.name)
			if (label) out.push({ asset, label, uri: asset.uri })
		} else if (type === SP_SPRITE_ASSET_TYPE) {
			const [rawSet, ...rest] = String(asset.name ?? "").split("/")
			const set = normalizeSpriteName(rawSet)
			const label = normalizeSpriteName(rest.join("/"))
			if (set && label)
				out.push({
					asset,
					...(set === defaultSet ? {} : { set }),
					label,
					uri: asset.uri
				})
		}
	}
	return out
}

/** RisuAI's older `[label, value]` emotion pairs. */
export function legacyRisuEmotionsOf(raw: any): [string, string][] {
	const risu = raw?.data?.extensions?.risuai ?? raw?.extensions?.risuai
	if (!Array.isArray(risu?.emotions)) return []
	return risu.emotions.filter(
		(e: unknown): e is [string, string] =>
			Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string"
	)
}

export interface ExtractedSprites {
	sprites: CardSprite[]
	/** The asset objects whose bytes were taken — `unimportedAssets` skips them. */
	used: Set<object>
	/** How many of the older RisuAI pairs were taken. */
	legacyUsed: number
}

/**
 * Pull every sprite a card carries, given a way to resolve an asset URI to
 * bytes in this container. `resolve` returns null for a URI it cannot serve
 * (a remote URL, a missing entry, an oversize image) and that sprite is left
 * behind — counted by `unimportedAssets`, never fetched.
 *
 * Each URI is resolved ONCE, and every sprite naming it shares those bytes: a
 * card may name one image for many labels, and a fresh decode or copy per
 * listing lets an 18 KB CHARX naming one 16 MB entry 512 times hold 268 MB
 * (S4 review). Nothing past the count ceiling is resolved at all. The
 * total ceiling still counts every listing, shared or not: the import hashes
 * each one (`createMedia`), so it bounds that work as well as the memory.
 */
export function extractCardSprites(
	raw: any,
	resolve: (uri: string) => Buffer | null
): ExtractedSprites {
	const out: ExtractedSprites = { sprites: [], used: new Set(), legacyUsed: 0 }
	let total = 0
	const resolved = new Map<string, Buffer | null>()
	const read = (key: string, load: () => Buffer | null): Buffer | null => {
		if (!resolved.has(key)) resolved.set(key, load())
		return resolved.get(key)!
	}
	const full = () => out.sprites.length >= CARD_SPRITE_LIMITS.count
	const take = (s: CardSprite): boolean => {
		if (s.bytes.length > CARD_SPRITE_LIMITS.eachBytes) return false
		if (total + s.bytes.length > CARD_SPRITE_LIMITS.totalBytes) return false
		total += s.bytes.length
		out.sprites.push(s)
		return true
	}

	for (const a of spriteAssetsOf(raw)) {
		if (full()) break
		const bytes = read(a.uri, () => resolve(a.uri))
		if (!bytes) continue
		const path = embeddedPathOf(a.uri)
		if (
			take({
				...(a.set ? { set: a.set } : {}),
				label: a.label,
				bytes,
				...(path ? { filename: path.split("/").pop() } : {})
			})
		)
			out.used.add(a.asset)
	}

	for (const [rawLabel, value] of legacyRisuEmotionsOf(raw)) {
		if (full()) break
		const label = normalizeSpriteName(rawLabel)
		if (!label) continue
		const bytes = read(value, () =>
			value.startsWith("__asset:")
				? resolve(value)
				: value.startsWith("data:")
					? bytesOfDataUri(value, CARD_SPRITE_LIMITS.eachBytes)
					: decodeBase64Capped(value, CARD_SPRITE_LIMITS.eachBytes)
		)
		if (bytes && take({ label, bytes })) out.legacyUsed++
	}
	return out
}
