/**
 * Shared utilities for parsing character cards (PNG, JPEG, WebP, JSON or CHARX)
 * Used by both character and persona import handlers
 */

import { CharacterCard, type SpecV3 } from "@lenml/char-card-reader"
import extract from "png-chunks-extract"
import encode from "png-chunks-encode"
import text from "png-chunk-text"
import { fileTypeFromBuffer } from "file-type"
import { unzipSync } from "fflate"
import { hasLorebookEntries } from "./lorebookImportMapper"
import {
	CARD_SPRITE_LIMITS,
	bytesOfDataUri,
	decodeBase64Capped,
	embeddedPathOf,
	extractCardSprites,
	spriteAssetsOf,
	type CardSprite,
	type ExtractedSprites
} from "./cardSprites"

/**
 * `png-chunks-extract`'s `extractChunks` reads each chunk's 32-bit declared
 * length and immediately does `new Uint8Array(length)` — BEFORE checking
 * whether the buffer actually has that many bytes remaining. A crafted PNG
 * (a normal-sized file with one chunk lying about its length, up to ~4GB)
 * can trigger a huge allocation from a tiny upload. This walks the same
 * chunk structure using only bounds checks (no allocation) and throws
 * before `extract()` ever gets a chance to over-allocate. Call this
 * immediately before every `extract(buffer)` call on untrusted input.
 */
export function validatePngChunkLengths(buffer: Buffer | Uint8Array): void {
	if (
		buffer.length < 8 ||
		buffer[0] !== 0x89 ||
		buffer[1] !== 0x50 ||
		buffer[2] !== 0x4e ||
		buffer[3] !== 0x47 ||
		buffer[4] !== 0x0d ||
		buffer[5] !== 0x0a ||
		buffer[6] !== 0x1a ||
		buffer[7] !== 0x0a
	) {
		throw new Error("Invalid .png file header")
	}

	let idx = 8
	while (idx < buffer.length) {
		if (idx + 8 > buffer.length) {
			throw new Error(
				".png file ended prematurely: truncated chunk header"
			)
		}
		const length =
			(buffer[idx] << 24) |
			(buffer[idx + 1] << 16) |
			(buffer[idx + 2] << 8) |
			buffer[idx + 3]
		const unsignedLength = length >>> 0
		// name(4) + data(unsignedLength) + crc(4)
		const chunkEnd = idx + 8 + unsignedLength + 4
		if (chunkEnd > buffer.length) {
			throw new Error(
				"Malformed .png: a chunk declares a length larger than the file"
			)
		}
		idx = chunkEnd
	}
}

/**
 * card.toSpecV3() is reliable for V2/V3 cards, but the underlying package's
 * field getters silently drop or corrupt a few fields for older (V1/
 * legacy) cards — which have no `spec`/`data` wrapper at all and fall
 * through to the getters' generic default case:
 *   - tags / alternate_greetings: the default-case getter hardcodes `[]`
 *     rather than ever checking raw_data, so a V1-ish card that happens to
 *     carry real tag/greeting data (some tools add these to otherwise-flat
 *     cards) has it silently discarded.
 *   - creation_date / modification_date / name / description: the
 *     default-case getter returns the literal string "unknown" instead of
 *     omitting the field when absent, which would otherwise get stored as
 *     if it were real data — for `name` in particular, this is how a file
 *     that isn't a character card at all (valid JSON, but none of the
 *     recognized fields) silently produces an "unknown"-named character
 *     instead of failing to import.
 * This re-derives just those fields from the card's own raw source data
 * (which always has the true original shape, V1-flat or V2/V3-nested,
 * regardless of what the getters do), so older-format cards import with
 * full fidelity instead of quietly losing data through getter defaults
 * that only really fit V2/V3.
 *
 * @throws Error if the card has no real name — see the `name` handling
 * above; a missing name means the input wasn't actually a character card.
 */
export function getRobustSpecV3Data(
	card: CharacterCard
): SpecV3.CharacterCardV3["data"] {
	const v3 = card.toSpecV3().data
	const raw = card.raw_data as any
	const rawTop = raw ?? {}
	const rawNested = raw?.data ?? {}

	const rawTags = rawNested.tags ?? rawTop.tags
	const tags = v3.tags?.length
		? v3.tags
		: Array.isArray(rawTags)
			? rawTags
			: []
	const rawAlternateGreetings =
		rawNested.alternate_greetings ?? rawTop.alternate_greetings
	const alternateGreetings = v3.alternate_greetings?.length
		? v3.alternate_greetings
		: Array.isArray(rawAlternateGreetings)
			? rawAlternateGreetings
			: []
	// Typed as `number` (an epoch timestamp) per spec, but the package's own
	// getter fallback for older cards returns the *string* "unknown" instead
	// of omitting the field when there's no real date — a runtime/type
	// mismatch in the library itself, hence the `typeof` check rather than a
	// same-type comparison.
	const creationDate =
		v3.creation_date && typeof v3.creation_date !== "string"
			? v3.creation_date
			: undefined
	const modificationDate =
		v3.modification_date && typeof v3.modification_date !== "string"
			? v3.modification_date
			: undefined
	// Same "unknown" placeholder-default quirk as the dates above, but for
	// name/description — checked against the raw source rather than assumed
	// fake outright, since a card could legitimately be raw-named "unknown".
	const name =
		v3.name === "unknown" &&
		rawNested.name === undefined &&
		rawTop.name === undefined
			? ""
			: v3.name
	const description =
		v3.description === "unknown" &&
		rawNested.description === undefined &&
		rawTop.description === undefined
			? ""
			: v3.description

	if (!name?.trim()) {
		throw new Error(
			"This file doesn't look like a valid character card — no character name was found."
		)
	}

	return {
		...v3,
		name,
		description,
		tags,
		alternate_greetings: alternateGreetings,
		creation_date: creationDate,
		modification_date: modificationDate
	}
}

export interface ParsedCharacterCard {
	card: CharacterCard
	avatarBuffer?: Buffer
	lorebook?: SpecV3.Lorebook
	/**
	 * Card assets this import did NOT keep, counted by asset type. Absent
	 * when there are none. See `unimportedAssets`.
	 */
	unimportedAssets?: Record<string, number>
	/**
	 * The card's sprites with their bytes (DESIGN-sprites §4) — CCv3
	 * `emotion`/`expression` assets, Serene Pub's `x_sp_sprite`, and RisuAI's
	 * older emotion pairs. Absent when the card carries none, or when parsed
	 * with `includeAvatar: false`.
	 */
	sprites?: CardSprite[]
}

/**
 * Count the card's assets that Serene Pub does not keep, by asset type.
 *
 * The V3 spec (§assets) lets an application ignore an asset it has no use
 * for, but says it MUST alert the user when it cannot keep the asset's data,
 * because a re-export will then leave it out. Serene Pub keeps exactly one
 * asset, the main icon, as the avatar; everything else is counted here so the
 * import can say so rather than dropping it silently. Sprites
 * (DESIGN-sprites §4) ARE kept now: pass what `extractCardSprites` took and
 * they are not counted.
 *
 * Covers both places a card carries assets: V3 `data.assets` (CHARX, and
 * RisuAI's PNG exports, which embed them as `chara-ext-asset_:` chunks) and
 * RisuAI's older `extensions.risuai.emotions` / `additionalAssets` pairs.
 */
export function unimportedAssets(
	raw: any,
	taken?: Pick<ExtractedSprites, "used" | "legacyUsed">
): Record<string, number> | undefined {
	const counts: Record<string, number> = {}
	const add = (type: unknown) => {
		const key = typeof type === "string" && type.trim() ? type.trim() : "other"
		counts[key] = (counts[key] ?? 0) + 1
	}
	const assets = raw?.data?.assets ?? raw?.assets
	if (Array.isArray(assets)) {
		const kept = mainIconAsset(raw)
		for (const asset of assets) {
			if (!asset || asset === kept || taken?.used.has(asset)) continue
			add(asset.type)
		}
	}
	const risu = raw?.data?.extensions?.risuai ?? raw?.extensions?.risuai
	if (Array.isArray(risu?.emotions)) {
		const left = risu.emotions.length - (taken?.legacyUsed ?? 0)
		for (let i = 0; i < left; i++) add("emotion")
	}
	if (Array.isArray(risu?.additionalAssets)) {
		for (let i = 0; i < risu.additionalAssets.length; i++) add("x-risu-asset")
	}
	return Object.keys(counts).length > 0 ? counts : undefined
}

/**
 * One sentence for the import toast naming what `unimportedAssets` counted.
 * Undefined when nothing was left behind.
 */
export function describeUnimportedAssets(
	counts: Record<string, number> | undefined
): string | undefined {
	if (!counts) return undefined
	const label: Record<string, [string, string]> = {
		emotion: ["emotion image", "emotion images"],
		expression: ["emotion image", "emotion images"],
		background: ["background", "backgrounds"],
		icon: ["alternate icon", "alternate icons"],
		user_icon: ["user icon", "user icons"]
	}
	const parts = Object.entries(counts).map(([type, n]) => {
		const [one, many] = label[type] ?? ["other asset", "other assets"]
		return `${n} ${n === 1 ? one : many}`
	})
	const total = Object.values(counts).reduce((a, b) => a + b, 0)
	const list =
		parts.length === 1
			? parts[0]
			: `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
	return `The card's ${list} ${total === 1 ? "was" : "were"} not imported, so exporting this character will leave ${total === 1 ? "it" : "them"} out.`
}

/**
 * Ceilings on what a CHARX is allowed to make us inflate. Both are checked
 * against the size the zip DECLARES before anything is decompressed, so a
 * small upload cannot expand into a huge allocation (a zip bomb). fflate
 * inflates into a buffer of exactly the declared size and never grows it,
 * so a header that under-declares truncates rather than allocating more.
 */
export const CHARX_LIMITS = {
	cardJsonBytes: 16 * 1024 * 1024,
	iconBytes: 32 * 1024 * 1024
}

/** A zip local-file header: "PK\x03\x04". CHARX is a plain zip. */
export function isZipBuffer(buffer: Buffer | Uint8Array): boolean {
	return (
		buffer.length >= 4 &&
		buffer[0] === 0x50 &&
		buffer[1] === 0x4b &&
		buffer[2] === 0x03 &&
		buffer[3] === 0x04
	)
}

/** Inflate exactly one named entry, refusing it if it declares more than `maxBytes`. */
function readZipEntry(
	buffer: Uint8Array,
	name: string,
	maxBytes: number
): Uint8Array | undefined {
	let tooLarge = false
	let files: Record<string, Uint8Array>
	try {
		files = unzipSync(buffer, {
			filter: (file) => {
				if (file.name !== name) return false
				if (file.originalSize > maxBytes) {
					tooLarge = true
					return false
				}
				return true
			}
		})
	} catch (e: any) {
		throw new Error(
			`This .charx file could not be read as a zip archive: ${e?.message || e}`
		)
	}
	if (tooLarge) {
		throw new Error(
			`This .charx file's "${name}" is larger than Serene Pub will unpack.`
		)
	}
	return files[name]
}

/**
 * Inflate several named entries in ONE pass, each refused if it declares more
 * than `maxEach`, and stopping once `maxTotal` declared bytes are taken.
 * Entries past a ceiling are simply absent from the result — a card's sprite
 * the import leaves behind, which `unimportedAssets` then counts.
 */
function readZipEntries(
	buffer: Uint8Array,
	names: ReadonlySet<string>,
	maxEach: number,
	maxTotal: number
): Map<string, Uint8Array> {
	if (names.size === 0) return new Map()
	let total = 0
	let files: Record<string, Uint8Array>
	try {
		files = unzipSync(buffer, {
			filter: (file) => {
				if (!names.has(file.name)) return false
				if (file.originalSize > maxEach) return false
				if (total + file.originalSize > maxTotal) return false
				total += file.originalSize
				return true
			}
		})
	} catch (e: any) {
		throw new Error(
			`This .charx file could not be read as a zip archive: ${e?.message || e}`
		)
	}
	return new Map(Object.entries(files))
}

/**
 * The URI of the card's main icon, per the V3 spec: the `icon` asset named
 * `main`, else the first `icon` asset. Undefined when the card declares none.
 */
function mainIconAsset(raw: any): any {
	const assets = raw?.data?.assets ?? raw?.assets
	if (!Array.isArray(assets)) return undefined
	const icons = assets.filter(
		(a: any) => a && a.type === "icon" && typeof a.uri === "string"
	)
	return icons.find((a: any) => a.name === "main") ?? icons[0]
}

function mainIconUri(raw: any): string | undefined {
	return mainIconAsset(raw)?.uri
}

/**
 * Read a CHARX container (Character Card V3 §CHARX): a zip with `card.json`
 * at its root, assets referenced as `embeded://<path inside the zip>` — the
 * spec's own spelling, and the correctly spelled form is tolerated too.
 *
 * The main icon becomes the avatar, and the card's sprites (`emotion`,
 * `expression` and `x_sp_sprite` assets) are returned for the import to store
 * (DESIGN-sprites §4). Other assets (backgrounds, alternate icons, a RisuAI
 * `module.risum`) are left behind and counted by `unimportedAssets`.
 * `ccdefault:` and remote `http(s)` icons are skipped — the first names no
 * file in a CHARX, and the second would make an import fetch a URL.
 */
export function readCharxContainer(
	buffer: Buffer | Uint8Array,
	opts?: { includeAvatar?: boolean }
): { raw: any; avatarBuffer?: Buffer; sprites?: ExtractedSprites } {
	const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.length)

	const cardBytes = readZipEntry(bytes, "card.json", CHARX_LIMITS.cardJsonBytes)
	if (!cardBytes) {
		throw new Error(
			"This .charx file has no card.json at its root, so it isn't a character card."
		)
	}
	let raw: any
	try {
		raw = JSON.parse(
			new TextDecoder("utf-8").decode(cardBytes).replace(/^\uFEFF/, "")
		)
	} catch {
		throw new Error("This .charx file's card.json is not valid JSON.")
	}

	if (!(opts?.includeAvatar ?? true)) return { raw }

	const uri = mainIconUri(raw)
	let avatarBuffer: Buffer | undefined
	const embedded = uri?.match(/^embedd?ed:\/\/\/?(.+)$/)
	if (embedded) {
		const path = embedded[1].replace(/\\/g, "/")
		const icon = readZipEntry(bytes, path, CHARX_LIMITS.iconBytes)
		if (icon) avatarBuffer = Buffer.from(icon)
	} else if (uri?.startsWith("data:")) {
		const base64 = uri.match(/^data:[^,]*;base64,(.*)$/s)?.[1]
		if (base64 && (base64.length * 3) / 4 <= CHARX_LIMITS.iconBytes) {
			avatarBuffer = Buffer.from(base64, "base64")
		}
	}

	// The card's sprites (DESIGN-sprites §4): every embedded path they name,
	// inflated in one pass under the card-wide ceilings.
	const paths = new Set<string>()
	for (const a of spriteAssetsOf(raw)) {
		const path = embeddedPathOf(a.uri)
		if (path) paths.add(path)
	}
	const entries = readZipEntries(
		bytes,
		paths,
		CARD_SPRITE_LIMITS.eachBytes,
		CARD_SPRITE_LIMITS.totalBytes
	)
	const sprites = extractCardSprites(raw, (uri) => {
		const path = embeddedPathOf(uri)
		if (path) {
			const entry = entries.get(path)
			return entry ? Buffer.from(entry) : null
		}
		return uri.startsWith("data:")
			? bytesOfDataUri(uri, CARD_SPRITE_LIMITS.eachBytes)
			: null
	})
	return { raw, avatarBuffer, sprites }
}

/**
 * The `chara-ext-asset_:<key>` tEXt chunks of a PNG card, by key — where a
 * RisuAI PNG export keeps the assets its `__asset:<key>` URIs name. The
 * values stay base64 until a sprite actually asks for one.
 */
export function pngAssetChunks(buffer: Buffer): Map<string, string> {
	const out = new Map<string, string>()
	if (buffer[0] !== 0x89 || buffer[1] !== 0x50) return out
	try {
		validatePngChunkLengths(buffer)
		for (const chunk of extract(buffer)) {
			if (chunk.name !== "tEXt") continue
			const { keyword, text: value } = text.decode(chunk.data)
			if (keyword?.startsWith("chara-ext-asset_:")) {
				out.set(keyword.slice("chara-ext-asset_:".length), value)
			}
		}
	} catch {
		// A PNG the card reader accepted but whose chunks do not walk: no
		// embedded assets, which is the honest answer.
	}
	return out
}

/**
 * Parse a character card from a buffer (PNG, JPEG, WebP, JSON or CHARX)
 * Extracts card instance, avatar, and lorebook if present
 *
 * @param buffer - Buffer containing the character card file (image, JSON or CHARX)
 * @param opts.includeAvatar - Default true. Set false to skip decoding the
 *   avatar into a Buffer — most real-world cards fall back to a whole-file
 *   re-encoded string for card.avatar (no explicit avatar field of their
 *   own), so this decodes what's often the entire file's base64
 *   representation. Worth skipping for callers (eg. CharaVault's
 *   content-safety check and description/lorebook-presence lookup) that
 *   never read avatarBuffer at all.
 * @returns ParsedCharacterCard with card instance, avatarBuffer, and lorebook (if present)
 * @throws Error if parsing fails
 */
export async function parseCharacterCard(
	buffer: Buffer,
	opts?: { includeAvatar?: boolean }
): Promise<ParsedCharacterCard> {
	// CharacterCard.from_file() only understands image formats (PNG/JPEG/WebP)
	// metadata — it throws "Unsupported image format" on a plain JSON buffer.
	// Sniff the actual file type so JSON character cards route to from_json()
	// instead. A CHARX is recognised by its zip magic before any of that: its
	// avatar comes from the archive's main icon, never from card.avatar.
	let card: CharacterCard
	let avatarBuffer: Buffer | undefined
	let avatarResolved = false
	let sprites: ExtractedSprites | undefined
	const wantSprites = opts?.includeAvatar ?? true
	if (isZipBuffer(buffer)) {
		const charx = readCharxContainer(buffer, opts)
		card = CharacterCard.from_json(charx.raw)
		avatarBuffer = charx.avatarBuffer
		avatarResolved = true
		sprites = charx.sprites
	} else {
		const fileType = await fileTypeFromBuffer(buffer)
		const isImage = fileType?.mime.startsWith("image/")
		card = isImage
			? await CharacterCard.from_file(buffer)
			: CharacterCard.from_json(JSON.parse(buffer.toString("utf8")))
		if (card && wantSprites) {
			// A RisuAI PNG keeps assets in `chara-ext-asset_:` chunks named by
			// `__asset:<key>`; a JSON card can only carry `data:` URIs and
			// RisuAI's raw base64 pairs.
			const chunks =
				fileType?.mime === "image/png" || fileType?.mime === "image/apng"
					? pngAssetChunks(buffer)
					: new Map<string, string>()
			sprites = extractCardSprites(card.raw_data, (uri) => {
				if (uri.startsWith("__asset:")) {
					const b64 = chunks.get(uri.slice("__asset:".length))
					return b64
						? decodeBase64Capped(b64, CARD_SPRITE_LIMITS.eachBytes)
						: null
				}
				return uri.startsWith("data:")
					? bytesOfDataUri(uri, CARD_SPRITE_LIMITS.eachBytes)
					: null
			})
		}
	}

	if (!card) {
		throw new Error("Failed to parse character card")
	}

	// Extract avatar if present
	if (!avatarResolved && (opts?.includeAvatar ?? true) && card.avatar) {
		// Avatar is base64 data URL - extract the buffer
		const base64Data = card.avatar.replace(/^data:image\/\w+;base64,/, "")
		avatarBuffer = Buffer.from(base64Data, "base64")
	}

	// Extract lorebook if present. card.character_book's getter is only
	// spec-aware for v2/v3 — for anything else (V1/legacy cards, which have
	// no `spec` field, or an image-embedded card explicitly tagged
	// "chara_card_v1") it unconditionally returns a hardcoded placeholder
	// (`{entries: [], ...}`) and never even looks at the real embedded
	// book. Reading raw_data directly sidesteps that entirely — V1 cards
	// keep character_book at the top level (from_file() spreads the parsed
	// PNG payload straight onto raw_data), while V2/V3 nest it under
	// raw_data.data, so checking both covers every shape. hasLorebookEntries
	// also tolerates the legacy object-keyed-by-index entries shape, not
	// just a real array, and correctly treats a genuinely bookless card
	// (including v2/v3's own placeholder) as absent rather than offering to
	// import an empty book for every single card.
	const rawData = card.raw_data as any
	const candidateBook =
		rawData?.character_book ??
		rawData?.data?.character_book ??
		card.character_book
	let lorebook: SpecV3.Lorebook | undefined
	if (candidateBook && hasLorebookEntries(candidateBook)) {
		lorebook = candidateBook as SpecV3.Lorebook
	}

	const unimported = unimportedAssets(card.raw_data, sprites)
	return {
		card,
		avatarBuffer,
		lorebook,
		...(unimported ? { unimportedAssets: unimported } : {}),
		...(sprites && sprites.sprites.length > 0
			? { sprites: sprites.sprites }
			: {})
	}
}

/**
 * Convenience function to parse character card from base64 string
 *
 * @param base64String - Base64-encoded character card file
 * @returns ParsedCharacterCard
 */
export async function parseCharacterCardFromBase64(
	base64String: string
): Promise<ParsedCharacterCard> {
	const buffer = Buffer.from(base64String, "base64")
	return parseCharacterCard(buffer)
}

/** Plain input for buildCharacterCardV3 — deliberately decoupled from the DB row shape. */
export interface CharacterCardV3Input {
	name: string
	description?: string | null
	personality?: string | null
	scenario?: string | null
	firstMessage?: string | null
	exampleDialogues?: string | string[] | null
	creatorNotes?: string | null
	systemPrompt?: string | null
	postHistoryInstructions?: string | null
	alternateGreetings?: string[] | null
	tags?: string[]
	creator?: string | null
	characterVersion?: string | null
	depthPrompt?: string | null
	depthPromptDepth?: number | null
	depthPromptRole?: string | null
	source?: string[] | null
	groupOnlyGreetings?: string[] | null
	aliases?: string[] | null
	summary?: string | null
	category?: string | null
	/** Stable per-row identity — see lorebooks.uuid for the export/import dedup rationale. */
	uuid: string
	/** The character's whole shared lorebook, embedded when the exporting user opts in — see charactersExportCard. */
	lorebook?: SpecV3.Lorebook
}

/**
 * Build a CharacterCard V3 JSON object from a character's data. Used for
 * both JSON export and PNG-embedded export (characters:exportCard). Serene
 * Pub exports V3 exclusively — V3 is a strict superset of V2 (same fields,
 * plus character_book/uuid support), so there's no separate V2 builder to
 * maintain.
 */
export function buildCharacterCardV3(character: CharacterCardV3Input) {
	return {
		spec: "chara_card_v3",
		spec_version: "3.0",
		data: {
			name: character.name,
			description: character.description || "",
			personality: character.personality || "",
			scenario: character.scenario || "",
			first_mes: character.firstMessage || "",
			mes_example:
				typeof character.exampleDialogues === "string"
					? character.exampleDialogues
					: (character.exampleDialogues || []).join("<START>"),
			creator_notes: character.creatorNotes || "",
			system_prompt: character.systemPrompt || "",
			post_history_instructions: character.postHistoryInstructions || "",
			alternate_greetings: character.alternateGreetings || [],
			tags: character.tags || [],
			creator: character.creator || "",
			character_version: character.characterVersion || "",
			...(character.lorebook
				? { character_book: character.lorebook }
				: {}),
			extensions: {
				depth_prompt: {
					prompt: character.depthPrompt || "",
					depth: character.depthPromptDepth || 4,
					role: character.depthPromptRole || "system"
				},
				...(character.source && character.source.length > 0
					? { source: character.source }
					: {}),
				...(character.groupOnlyGreetings &&
				character.groupOnlyGreetings.length > 0
					? { group_only_greetings: character.groupOnlyGreetings }
					: {}),
				serenepub: {
					uuid: character.uuid,
					...(character.aliases && character.aliases.length > 0
						? { aliases: character.aliases }
						: {}),
					...(character.summary
						? { summary: character.summary }
						: {}),
					...(character.category
						? { category: character.category }
						: {})
				}
			}
		}
	}
}

/**
 * Embed a character card JSON object into a PNG's tEXt chunks, replacing any
 * existing "chara"/"ccv3" chunk. Mirrors how SillyTavern and other tools
 * embed character data directly in the avatar PNG.
 */
export function embedCharacterCardInPng(
	pngBuffer: Buffer,
	cardData: unknown
): Buffer {
	validatePngChunkLengths(pngBuffer)
	const chunks = extract(pngBuffer)

	const base64Data = Buffer.from(JSON.stringify(cardData), "utf-8").toString(
		"base64"
	)
	const textChunk = text.encode("chara", base64Data)

	// Remove any existing "chara" or "ccv3" chunks
	const filteredChunks = chunks.filter((chunk) => {
		if (chunk.name === "tEXt") {
			const decoded = text.decode(chunk.data)
			return decoded.keyword !== "chara" && decoded.keyword !== "ccv3"
		}
		return true
	})

	// Insert the new chunk before the IEND chunk
	const iendIndex = filteredChunks.findIndex((chunk) => chunk.name === "IEND")
	if (iendIndex !== -1) {
		filteredChunks.splice(iendIndex, 0, textChunk)
	} else {
		filteredChunks.push(textChunk)
	}

	return Buffer.from(encode(filteredChunks))
}
