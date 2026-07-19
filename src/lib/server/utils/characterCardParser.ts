/**
 * Shared utilities for parsing character cards (PNG or JSON)
 * Used by both character and persona import handlers
 */

import { CharacterCard, type SpecV3 } from "@lenml/char-card-reader"
import extract from "png-chunks-extract"
import encode from "png-chunks-encode"
import text from "png-chunk-text"
import { fileTypeFromBuffer } from "file-type"

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
		const base64Data = card.avatar.replace(
			/^data:image\/\w+;base64,/,
			""
		)
		avatarBuffer = Buffer.from(base64Data, "base64")
	}

	// Extract lorebook if present
	let lorebook: SpecV3.Lorebook | undefined
	if (card.character_book) {
		lorebook = card.character_book as SpecV3.Lorebook
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

/** Plain input for buildCharacterCardV2 — deliberately decoupled from the DB row shape. */
export interface CharacterCardV2Input {
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
}

/**
 * Build a CharacterCard V2 JSON object from a character's data. Used for
 * both JSON export and PNG-embedded export (characters:exportCard).
 */
export function buildCharacterCardV2(character: CharacterCardV2Input) {
	return {
		spec: "chara_card_v2",
		spec_version: "2.0",
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
					...(character.aliases && character.aliases.length > 0
						? { aliases: character.aliases }
						: {}),
					...(character.summary ? { summary: character.summary } : {}),
					...(character.category ? { category: character.category } : {})
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
