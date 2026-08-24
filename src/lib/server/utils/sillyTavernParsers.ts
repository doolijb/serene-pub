/**
 * Pure parsing/normalization helpers for SillyTavern data imports.
 * Kept free of DB and SvelteKit imports so they can be unit tested in
 * isolation from the rest of the import pipeline in ../sockets/import.ts.
 */

import * as fsPromises from "fs/promises"
import { fileTypeFromBuffer } from "file-type"
import extract from "png-chunks-extract"
import text from "png-chunk-text"
import { validatePngChunkLengths } from "./characterCardParser"

// ==================== Types ====================

export interface CharacterCardV2 {
	spec: string
	spec_version: string
	data: {
		name: string
		description: string
		personality: string
		scenario: string
		first_mes: string
		mes_example: string
		creator_notes?: string
		system_prompt?: string
		post_history_instructions?: string
		alternate_greetings?: string[]
		character_book?: CharacterBook
		tags?: string[]
		creator?: string
		character_version?: string
		extensions?: Record<string, any>
	}
}

export interface CharacterBook {
	name?: string
	description?: string
	scan_depth?: number
	token_budget?: number
	recursive_scanning?: boolean
	extensions?: Record<string, any>
	entries: Array<{
		keys: string[]
		content: string
		extensions?: Record<string, any>
		enabled: boolean
		insertion_order: number
		case_sensitive?: boolean
		name?: string
		priority?: number
		id?: number
		comment?: string
		selective?: boolean
		secondary_keys?: string[]
		constant?: boolean
		position?: "before_char" | "after_char"
	}>
}

export interface SillyTavernPersona {
	name: string
	avatar?: string
	description: string
	position?: number
}

export interface SessionMessage {
	name: string
	is_user: boolean
	is_name?: boolean
	send_date: number | string
	mes: string
	swipes?: string[]
	swipe_id?: number
	extra?: Record<string, any>
	is_system?: boolean
}

export interface SessionHeader {
	user_name: string
	character_name: string
	create_date: string
	chat_metadata?: Record<string, any>
}

export interface GroupSession {
	id: string
	name: string
	members: string[]
	disabled_members?: string[]
	avatar_url?: string
	allow_self_responses?: boolean
	activation_strategy?: string
	generation_mode?: string
	chat_metadata?: Record<string, any>
	created?: number
}

export interface WorldInfo {
	name: string
	description?: string
	scan_depth?: number
	token_budget?: number
	recursive_scanning?: boolean
	entries: Array<{
		uid: number
		key: string[]
		keysecondary?: string[]
		comment: string
		content: string
		constant: boolean
		selective: boolean
		order: number
		position: number | string
		disable: boolean
		excludeRecursion?: boolean
		probability?: number
		useProbability?: boolean
		group?: string
		scanDepth?: number
		caseSensitive?: boolean
		matchWholeWords?: boolean
	}>
	extensions?: Record<string, any>
}

// ==================== Utility Functions ====================

/**
 * Extract JSON from PNG character card
 */
export async function extractCharacterFromPNG(
	buffer: Buffer
): Promise<CharacterCardV2 | null> {
	try {
		validatePngChunkLengths(buffer)
		const chunks = extract(buffer)

		// Look for V2 format (chara) or V3 format (ccv3)
		const textChunk = chunks.find((chunk) => chunk.name === "tEXt")

		if (!textChunk) {
			return null
		}

		const decoded = text.decode(textChunk.data)

		if (decoded.keyword === "chara" || decoded.keyword === "ccv3") {
			const jsonString = Buffer.from(decoded.text, "base64").toString(
				"utf8"
			)
			return JSON.parse(jsonString)
		}

		return null
	} catch (error) {
		console.error("Error extracting character from PNG:", error)
		return null
	}
}

/**
 * Read character file (PNG or JSON)
 */
export async function readCharacterFile(
	filePath: string
): Promise<CharacterCardV2 | null> {
	try {
		const buffer = await fsPromises.readFile(filePath)
		const fileType = await fileTypeFromBuffer(buffer)

		if (fileType?.mime === "image/png") {
			return await extractCharacterFromPNG(buffer)
		} else {
			// Try parsing as JSON
			const jsonString = buffer.toString("utf8")
			return JSON.parse(jsonString)
		}
	} catch (error) {
		console.error(`Error reading character file ${filePath}:`, error)
		return null
	}
}

/**
 * Parse JSONL session file
 */
export async function parseSessionFile(
	filePath: string
): Promise<{ header: SessionHeader; messages: SessionMessage[] } | null> {
	try {
		const content = await fsPromises.readFile(filePath, "utf8")
		const lines = content.trim().split("\n")

		if (lines.length === 0) {
			return null
		}

		const header = JSON.parse(lines[0]) as SessionHeader
		const messages = lines
			.slice(1)
			.map((line) => JSON.parse(line) as SessionMessage)

		return { header, messages }
	} catch (error) {
		console.error(`Error parsing session file ${filePath}:`, error)
		return null
	}
}

/**
 * Normalize timestamp from various formats
 */
export function normalizeTimestamp(timestamp: number | string): Date {
	if (typeof timestamp === "number") {
		return new Date(timestamp)
	}

	// Try parsing various string formats
	// Format: "YYYY-MM-DD @HH'h' MM'm' SS's' MSms"
	const match = timestamp.match(
		/(\d{4})-(\d{2})-(\d{2}) @(\d+)h (\d+)m (\d+)s (\d+)ms/
	)
	if (match) {
		const [, year, month, day, hour, minute, second, ms] = match
		return new Date(
			parseInt(year),
			parseInt(month) - 1,
			parseInt(day),
			parseInt(hour),
			parseInt(minute),
			parseInt(second),
			parseInt(ms)
		)
	}

	// Fallback to Date parser. Node's V8 rejects a 12-hour time with no space
	// before am/pm (eg. "3:45pm") even though it accepts "3:45 pm" — and
	// ST's send_date is commonly a toLocaleString()-style string in exactly
	// that no-space form — so insert the space before handing off.
	const spaced = timestamp.replace(/(\d)(am|pm)\b/i, "$1 $2")
	return new Date(spaced)
}

/**
 * Map SillyTavern activation strategy to Serene Pub group reply strategy
 */
export function mapGroupReplyStrategy(strategy: string | undefined): string {
	switch (strategy) {
		case "manual":
			return "MANUAL"
		case "natural_order":
			return "NATURAL"
		case "list_order":
		case "pooled_order":
			return "ORDERED"
		default:
			return "ORDERED"
	}
}
