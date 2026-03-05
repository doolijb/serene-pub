import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import * as fsPromises from "fs/promises"
import * as path from "path"
import { fileTypeFromBuffer } from "file-type"
import extract from "png-chunks-extract"
import text from "png-chunk-text"
import { eq } from "drizzle-orm"

// ==================== Types ====================

interface CharacterCardV2 {
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

interface CharacterBook {
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

interface SillyTavernPersona {
	name: string
	avatar?: string
	description: string
	position?: number
}

interface ChatMessage {
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

interface ChatHeader {
	user_name: string
	character_name: string
	create_date: string
	chat_metadata?: Record<string, any>
}

interface GroupChat {
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

interface WorldInfo {
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
async function extractCharacterFromPNG(
	buffer: Buffer
): Promise<CharacterCardV2 | null> {
	try {
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
async function readCharacterFile(
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
 * Parse JSONL chat file
 */
async function parseChatFile(
	filePath: string
): Promise<{ header: ChatHeader; messages: ChatMessage[] } | null> {
	try {
		const content = await fsPromises.readFile(filePath, "utf8")
		const lines = content.trim().split("\n")

		if (lines.length === 0) {
			return null
		}

		const header = JSON.parse(lines[0]) as ChatHeader
		const messages = lines
			.slice(1)
			.map((line) => JSON.parse(line) as ChatMessage)

		return { header, messages }
	} catch (error) {
		console.error(`Error parsing chat file ${filePath}:`, error)
		return null
	}
}

/**
 * Normalize timestamp from various formats
 */
function normalizeTimestamp(timestamp: number | string): Date {
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

	// Fallback to Date parser
	return new Date(timestamp)
}

/**
 * Map SillyTavern activation strategy to Serene Pub group reply strategy
 */
function mapGroupReplyStrategy(strategy: string | undefined): string {
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

// ==================== Scan Handler ====================

export const importScanSillyTavern: Handler<
	Sockets.Import.SillyTavern.Scan.Params,
	Sockets.Import.SillyTavern.Scan.Response
> = {
	event: "import:sillytavern:scan",
	handler: async (socket, message, emitToUser) => {
		const userId = socket.user?.id
		if (!userId) {
			throw new Error("User not authenticated")
		}

		const { directoryPath } = message

		if (!directoryPath) {
			return {
				success: false,
				error: "Directory path is required"
			}
		}

		try {
			// Determine data directory path
			// Try both multi-user and legacy paths
			const possiblePaths = [
				path.join(directoryPath, "data", "default-user"),
				path.join(directoryPath, "data"),
				path.join(directoryPath, "public")
			]

			let dataDir: string | null = null
			for (const p of possiblePaths) {
				try {
					await fsPromises.access(p)
					dataDir = p
					break
				} catch {
					continue
				}
			}

			if (!dataDir) {
				return {
					success: false,
					error: "Could not find SillyTavern data directory. Please ensure you selected the correct directory."
				}
			}

			// Scan characters
			const charactersDir = path.join(dataDir, "characters")
			const characters: Array<{
				filename: string
				name: string
				selected: boolean
			}> = []

			try {
				const characterFiles = await fsPromises.readdir(charactersDir)

				for (const filename of characterFiles) {
					if (
						filename.endsWith(".png") ||
						filename.endsWith(".json")
					) {
						const filePath = path.join(charactersDir, filename)
						const card = await readCharacterFile(filePath)

						if (card?.data?.name) {
							characters.push({
								filename,
								name: card.data.name,
								selected: true
							})
						}
					}
				}
			} catch (error) {
				console.log("No characters directory found or empty")
			}

			// Scan personas (stored in settings.json)
			const personas: Array<{ name: string; selected: boolean }> = []

			try {
				const settingsPath = path.join(dataDir, "settings.json")
				const settingsContent = await fsPromises.readFile(
					settingsPath,
					"utf8"
				)
				const settings = JSON.parse(settingsContent)

				if (settings.power_user?.persona_descriptions) {
					for (const [name, description] of Object.entries(
						settings.power_user.persona_descriptions
					)) {
						if (
							typeof description === "object" &&
							description !== null
						) {
							personas.push({
								name: name,
								selected: true
							})
						}
					}
				}
			} catch (error) {
				console.log("No personas found in settings.json")
			}

			// Scan individual chats
			const chatsDir = path.join(dataDir, "chats")
			const chats: Array<{
				filename: string
				name: string
				characterNames: string[]
				isGroup: boolean
				selected: boolean
				disabled: boolean
				disabledReason?: string
			}> = []

			try {
				const chatDirs = await fsPromises.readdir(chatsDir, {
					withFileTypes: true
				})

				for (const dir of chatDirs) {
					if (dir.isDirectory()) {
						const characterName = dir.name
						const characterChatsDir = path.join(
							chatsDir,
							characterName
						)
						const chatFiles =
							await fsPromises.readdir(characterChatsDir)

						for (const chatFile of chatFiles) {
							if (chatFile.endsWith(".jsonl")) {
								const chatName = chatFile.replace(".jsonl", "")
								chats.push({
									filename: `${characterName}/${chatFile}`,
									name: chatName,
									characterNames: [characterName],
									isGroup: false,
									selected: true,
									disabled: false
								})
							}
						}
					}
				}
			} catch (error) {
				console.log("No chats directory found or empty")
			}

			// Scan group chats
			const groupsDir = path.join(dataDir, "groups")
			const groupChats: Array<{
				filename: string
				name: string
				memberNames: string[]
				selected: boolean
				disabled: boolean
				disabledReason?: string
			}> = []

			try {
				const groupFiles = await fsPromises.readdir(groupsDir)

				for (const groupFile of groupFiles) {
					if (groupFile.endsWith(".json")) {
						const groupPath = path.join(groupsDir, groupFile)
						const groupContent = await fsPromises.readFile(
							groupPath,
							"utf8"
						)
						const group = JSON.parse(groupContent) as GroupChat

						groupChats.push({
							filename: groupFile,
							name: group.name,
							memberNames: group.members.map((m) =>
								m.replace(/\.(png|json)$/, "")
							),
							selected: true,
							disabled: false
						})
					}
				}
			} catch (error) {
				console.log("No groups directory found or empty")
			}

			// Scan lorebooks/world info
			const worldsDir = path.join(dataDir, "worlds")
			const lorebooks: Array<{
				filename: string
				name: string
				selected: boolean
			}> = []

			try {
				const worldFiles = await fsPromises.readdir(worldsDir)

				for (const worldFile of worldFiles) {
					if (worldFile.endsWith(".json")) {
						const worldPath = path.join(worldsDir, worldFile)
						const worldContent = await fsPromises.readFile(
							worldPath,
							"utf8"
						)
						const world = JSON.parse(worldContent) as WorldInfo

						lorebooks.push({
							filename: worldFile,
							name: world.name || worldFile.replace(".json", ""),
							selected: true
						})
					}
				}
			} catch (error) {
				console.log("No worlds directory found or empty")
			}

			return {
				success: true,
				data: {
					characters,
					personas,
					chats,
					groupChats,
					lorebooks
				}
			}
		} catch (error) {
			console.error("Error scanning SillyTavern directory:", error)
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to scan directory"
			}
		}
	}
}

// ==================== Execute Import Handler ====================

export const importExecuteSillyTavern: Handler<
	Sockets.Import.SillyTavern.Execute.Params,
	Sockets.Import.SillyTavern.Execute.Response
> = {
	event: "import:sillytavern:execute",
	handler: async (socket, message, emitToUser) => {
		const userId = socket.user?.id
		if (!userId) {
			throw new Error("User not authenticated")
		}

		const { directoryPath, selectedData } = message

		if (!directoryPath || !selectedData) {
			return {
				success: false,
				error: "Directory path and selected data are required"
			}
		}

		try {
			// TODO: Implement actual import logic
			// This will involve:
			// 1. Reading selected files from directory
			// 2. Converting data to Serene Pub format
			// 3. Inserting into database
			// 4. Copying avatar/asset files

			return {
				success: false,
				error: "Import functionality not yet implemented. This is a draft version."
			}
		} catch (error) {
			console.error("Error executing import:", error)
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to execute import"
			}
		}
	}
}

// ==================== Register Handlers ====================

export function registerImportHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (socket: any, handler: Handler<any, any>, emitToUser: any) => void
) {
	register(socket, importScanSillyTavern, emitToUser)
	register(socket, importExecuteSillyTavern, emitToUser)
}
