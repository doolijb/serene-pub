/**
 * Shared utilities for parsing character cards (PNG or JSON)
 * Used by both character and persona import handlers
 */

import { CharacterCard, type SpecV3 } from "@lenml/char-card-reader"

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
	// Parse character card using @lenml/char-card-reader
	const card = await CharacterCard.from_file(buffer)

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
