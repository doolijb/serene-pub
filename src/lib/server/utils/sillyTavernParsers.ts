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

/*
 * SillyTavern's chat files, in SillyTavern's own words (NOMENCLATURE R5):
 * ST calls a conversation a *chat*. Each one imports as a Serene Pub session,
 * but these shapes describe ST's bytes and keep ST's names — the
 * `SillyTavern` prefix is what keeps them from colliding with our own
 * session and message types (R1).
 */

/** One message line of a SillyTavern chat `.jsonl`. */
export interface SillyTavernChatMessage {
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

/** The metadata line a SillyTavern chat `.jsonl` opens with. */
export interface SillyTavernChatHeader {
	user_name: string
	character_name: string
	create_date: string
	chat_metadata?: Record<string, any>
}

/**
 * A SillyTavern group, `groups/<id>.json`. Its current chat's history is
 * `group chats/<chat_id>.jsonl`; `chats` lists every chat the group has had.
 */
export interface SillyTavernGroup {
	id: string
	name: string
	members: string[]
	disabled_members?: string[]
	avatar_url?: string
	allow_self_responses?: boolean
	/** ST's `group_activation_strategy`: 0 natural, 1 list, 2 manual, 3 pooled. */
	activation_strategy?: number | string
	generation_mode?: number | string
	chat_metadata?: Record<string, any>
	chat_id?: string
	chats?: string[]
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
 * Parse a SillyTavern chat `.jsonl`: a metadata header line, then one line
 * per message. A group chat written by an older SillyTavern has no header —
 * its first line is already a message (it carries `mes`) — so it is kept as
 * one, under an empty header.
 */
export async function parseSillyTavernChatFile(filePath: string): Promise<{
	header: SillyTavernChatHeader
	messages: SillyTavernChatMessage[]
} | null> {
	try {
		const content = await fsPromises.readFile(filePath, "utf8")
		const lines = content
			.trim()
			.split("\n")
			.filter((line) => line.trim() !== "")

		if (lines.length === 0) {
			return null
		}

		const first = JSON.parse(lines[0])
		const headerless = typeof first?.mes === "string"
		const header: SillyTavernChatHeader = headerless
			? { user_name: "", character_name: "", create_date: "" }
			: (first as SillyTavernChatHeader)
		const messages = (headerless ? lines : lines.slice(1)).map(
			(line) => JSON.parse(line) as SillyTavernChatMessage
		)

		return { header, messages }
	} catch (error) {
		console.error(`Error parsing SillyTavern chat file ${filePath}:`, error)
		return null
	}
}

/**
 * The personas a SillyTavern `settings.json` declares.
 *
 * ST keys every persona by its AVATAR FILE in `User Avatars/`
 * (`"user-default.png"`), not by name: `power_user.personas` maps that file
 * to the persona's name, and `power_user.persona_descriptions` maps it to
 * `{ description, … }`. A key present in either map is a persona; one with no
 * name entry falls back to the file name without its extension.
 */
export function listSillyTavernPersonas(settings: any): SillyTavernPersona[] {
	const power = settings?.power_user ?? {}
	const names: Record<string, unknown> =
		power.personas && typeof power.personas === "object"
			? power.personas
			: {}
	const descriptions: Record<string, unknown> =
		power.persona_descriptions &&
		typeof power.persona_descriptions === "object"
			? power.persona_descriptions
			: {}
	const out: SillyTavernPersona[] = []
	for (const avatar of new Set([
		...Object.keys(names),
		...Object.keys(descriptions)
	])) {
		const named = names[avatar]
		const described = descriptions[avatar]
		const name =
			typeof named === "string" && named.trim()
				? named
				: avatar.replace(/\.[^./]+$/, "")
		const description =
			described && typeof described === "object"
				? String((described as any).description ?? "")
				: ""
		const position =
			described && typeof described === "object"
				? (described as any).position
				: undefined
		out.push({
			name,
			avatar,
			description,
			...(typeof position === "number" ? { position } : {})
		})
	}
	return out
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
/**
 * SillyTavern's group `activation_strategy`, as the next-speaker strategy
 * pin the imported session is rebound to — or null to inherit the respond
 * spec's own (round robin), which is where `list_order`, `pooled_order` and
 * the mention-driven `natural_order` all land: the closest thing core ships
 * to each. Only `manual` is a rebind.
 */
export function mapGroupReplyStrategy(
	strategy: number | string | undefined
): string | null {
	// ST writes the numeric enum (`group_activation_strategy.MANUAL` = 2);
	// the string form is accepted for hand-written files.
	return strategy === 2 || strategy === "manual"
		? "core:task/turn-manual@1"
		: null
}
