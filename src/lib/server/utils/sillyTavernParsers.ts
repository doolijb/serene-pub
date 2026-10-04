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
import {
	IMPORT_FILE_CAPS,
	cardFileTooLarge,
	megabytes
} from "$lib/shared/imports/fileCaps"
import { assertImportJsonShape } from "$lib/server/imports/jsonShape"

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

		// Every tEXt chunk is read, not only the first: an image a Stable
		// Diffusion UI made carries its `parameters` chunk ahead of the card's.
		// A V3 card (`ccv3`) wins over its V2 copy (`chara`), as the card
		// importer reads them (`characterCardParser.ts`).
		const cardChunks = chunks
			.filter((chunk) => chunk.name === "tEXt")
			.map((chunk) => {
				try {
					return text.decode(chunk.data)
				} catch {
					return null
				}
			})
		const decoded =
			cardChunks.find((c) => c?.keyword === "ccv3") ??
			cardChunks.find((c) => c?.keyword === "chara")

		if (decoded) {
			// Measured before it is decoded and parsed (plan S4), as every
			// other card's JSON is.
			if (
				(decoded.text.length * 3) / 4 >
				IMPORT_FILE_CAPS.cardJsonBytes
			) {
				throw new Error(
					`This card's JSON is larger than the ${megabytes(IMPORT_FILE_CAPS.cardJsonBytes)} Serene Pub will read.`
				)
			}
			const jsonString = Buffer.from(decoded.text, "base64").toString(
				"utf8"
			)
			assertImportJsonShape(jsonString, "This card's JSON")
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
		// The file's own size first (S4 review: it was read whole and only
		// the JSON inside measured). Refused like a damaged one: left out.
		const tooLarge = cardFileTooLarge(
			(await fsPromises.stat(filePath)).size
		)
		if (tooLarge) throw new Error(tooLarge)
		const buffer = await fsPromises.readFile(filePath)
		const fileType = await fileTypeFromBuffer(buffer)

		if (fileType?.mime === "image/png") {
			return await extractCharacterFromPNG(buffer)
		} else {
			// Try parsing as JSON — measured first (plan S4).
			if (buffer.length > IMPORT_FILE_CAPS.cardJsonBytes) {
				throw new Error(
					`This card's JSON is larger than the ${megabytes(IMPORT_FILE_CAPS.cardJsonBytes)} Serene Pub will read.`
				)
			}
			const jsonString = buffer.toString("utf8")
			assertImportJsonShape(jsonString, "This card's JSON")
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
 *
 * Null when there is no chat: the file is missing, or holds no lines. A line
 * that is not JSON is refused in a sentence naming it, never skipped: a chat
 * imported without one of its lines would read as whole. Any other read
 * failure (a permission, a directory) is thrown as it is, for the caller's
 * `importFailureSentence`.
 */
export async function parseSillyTavernChatFile(filePath: string): Promise<{
	header: SillyTavernChatHeader
	messages: SillyTavernChatMessage[]
} | null> {
	let content: string
	try {
		content = await fsPromises.readFile(filePath, "utf8")
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null
		throw error
	}
	const lines = content
		.split("\n")
		.map((text, i) => ({ text, number: i + 1 }))
		.filter(({ text }) => text.trim() !== "")
	if (lines.length === 0) return null

	const read = ({ text, number }: { text: string; number: number }) => {
		try {
			return JSON.parse(text)
		} catch {
			throw new Error(
				`Line ${number} of the chat file is not valid JSON, so the chat was not imported.`
			)
		}
	}
	const first = read(lines[0])
	const headerless = typeof first?.mes === "string"
	const header: SillyTavernChatHeader = headerless
		? { user_name: "", character_name: "", create_date: "" }
		: (first as SillyTavernChatHeader)
	const messages = (headerless ? lines : lines.slice(1)).map(
		(line) => read(line) as SillyTavernChatMessage
	)
	return { header, messages }
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

/** SillyTavern's own author's-note depth, for a chat that stored none — what it was placed at there. */
const ST_NOTE_DEPTH_DEFAULT = 4

/**
 * 🚧 A SillyTavern chat's **Author's Note** (its `chat_metadata`'s
 * `note_prompt`, `note_depth`, `note_interval`, `note_role`, `note_position`)
 * as a Chat session's author's note (AN1) — the `authorsNote` genre field's
 * value. Null when the chat carries no note text, so a chat without one
 * imports exactly as it did.
 *
 * ST's positions: `1` is in the chat at a depth, which is what the note here
 * is. `0` (after the scenario, in the prompt) and `2` (before the prompt) have
 * no counterpart — a session's note is always placed among the messages — so
 * the note keeps its depth and `importNote` says where it now goes. Roles are
 * ST's `extension_prompt_roles` (0 system, 1 user, 2 assistant), strings
 * accepted for hand-written files.
 */
export function authorsNoteFromChatMetadata(meta: Record<string, any> | null | undefined): {
	note: { text: string; depth: number; interval: number; role: "system" | "user" | "assistant" }
	importNote?: string
} | null {
	const text = typeof meta?.note_prompt === "string" ? meta.note_prompt : ""
	if (!text.trim()) return null
	const whole = (v: unknown, floor: number, fallback: number) => {
		const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v
		return typeof n === "number" && Number.isFinite(n) ? Math.max(floor, Math.floor(n)) : fallback
	}
	const r = meta?.note_role
	const role: "system" | "user" | "assistant" =
		r === 1 || r === "1" || r === "user"
			? "user"
			: r === 2 || r === "2" || r === "assistant"
				? "assistant"
				: "system"
	const position = meta?.note_position
	const inChat = position === undefined || position === null || position === 1 || position === "1"
	// The depth the chat had in SillyTavern, kept (owner ruling 2026-10-03:
	// the end is Serene Pub's DEFAULT, never a rewrite of a depth somebody
	// chose). A chat that never set one had SillyTavern's own default, 4.
	const depth = whole(meta?.note_depth, 0, ST_NOTE_DEPTH_DEFAULT)
	return {
		note: { text, depth, interval: whole(meta?.note_interval, 1, 1), role },
		...(inChat
			? {}
			: {
					importNote:
						"its author's note was placed outside the chat in SillyTavern; it now goes " +
						(depth === 0 ? "right before each reply" : `${depth} messages before each reply`)
				})
	}
}
