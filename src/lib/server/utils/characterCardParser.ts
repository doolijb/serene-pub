/**
 * Shared utilities for parsing character cards (PNG or JSON)
 * Used by both character and persona import handlers
 */

import { CharacterCard, type SpecV3 } from "@lenml/char-card-reader"
import extract from "png-chunks-extract"
import encode from "png-chunks-encode"
import text from "png-chunk-text"
import { fileTypeFromBuffer } from "file-type"
import { hasLorebookEntries } from "./lorebookImportMapper"

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

	const tags = v3.tags?.length
		? v3.tags
		: (rawNested.tags ?? rawTop.tags ?? [])
	const alternateGreetings = v3.alternate_greetings?.length
		? v3.alternate_greetings
		: (rawNested.alternate_greetings ?? rawTop.alternate_greetings ?? [])
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
}

/**
 * Parse a character card from a buffer (PNG or JSON)
 * Extracts card instance, avatar, and lorebook if present
 *
 * @param buffer - Buffer containing the character card file (PNG or JSON)
 * @returns ParsedCharacterCard with card instance, avatarBuffer, and lorebook (if present)
 * @throws Error if parsing fails
 */
export async function parseCharacterCard(
	buffer: Buffer
): Promise<ParsedCharacterCard> {
	// CharacterCard.from_file() only understands image formats (PNG/JPEG/WebP)
	// metadata — it throws "Unsupported image format" on a plain JSON buffer.
	// Sniff the actual file type so JSON character cards route to from_json()
	// instead.
	const fileType = await fileTypeFromBuffer(buffer)
	const card = fileType?.mime.startsWith("image/")
		? await CharacterCard.from_file(buffer)
		: CharacterCard.from_json(JSON.parse(buffer.toString("utf8")))

	if (!card) {
		throw new Error("Failed to parse character card")
	}

	// Extract avatar if present
	let avatarBuffer: Buffer | undefined
	if (card.avatar) {
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

	return {
		card,
		avatarBuffer,
		lorebook
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
