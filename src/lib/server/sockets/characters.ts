import { db } from "$lib/server/db"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import * as fsPromises from "fs/promises"
import * as path from "path"
import { getCharacterDataDir, handleCharacterAvatarUpload } from "../utils"
import { CharacterCard, type SpecV3 } from "@lenml/char-card-reader"
import { fileTypeFromBuffer } from "file-type"
import type { Handler } from "$lib/shared/events"
import extract from "png-chunks-extract"
import encode from "png-chunks-encode"
import text from "png-chunk-text"
import { parseCharacterCardFromBase64 } from "../utils/characterCardParser"

// Helper function to process tags for character creation/update
async function processCharacterTags(characterId: number, tagNames: string[]) {
	if (!tagNames || tagNames.length === 0) return

	// First, remove all existing tags for this character
	await db
		.delete(schema.characterTags)
		.where(eq(schema.characterTags.characterId, characterId))

	// Process each tag name
	const tagIds: number[] = []

	for (const tagName of tagNames) {
		if (!tagName.trim()) continue

		// Check if tag exists
		let existingTag = await db.query.tags.findFirst({
			where: eq(schema.tags.name, tagName.trim())
		})

		// Create tag if it doesn't exist
		if (!existingTag) {
			const [newTag] = await db
				.insert(schema.tags)
				.values({
					name: tagName.trim()
					// description and colorPreset will use database defaults
				})
				.returning()
			existingTag = newTag
		}

		tagIds.push(existingTag.id)
	}

	// Link all tags to the character
	if (tagIds.length > 0) {
		const characterTagsData = tagIds.map((tagId) => ({
			characterId,
			tagId
		}))

		await db
			.insert(schema.characterTags)
			.values(characterTagsData)
			.onConflictDoNothing() // In case of race conditions
	}
}

export const charactersList: Handler<Sockets.Characters.List.Params, Sockets.Characters.List.Response> = {
	event: "characters:list",
	handler: async (socket, params, emitToUser) => {
		const characterList = await db.query.characters.findMany({
			columns: {
				id: true,
				name: true,
				nickname: true,
				avatar: true,
				isFavorite: true,
				description: true,
				creatorNotes: true,
				embeddingModel: true
			},
			with: {
				characterTags: {
					with: {
						tag: true
					}
				}
			},
			where: (c, { eq }) => eq(c.userId, socket.user!.id),
			orderBy: (c, { asc }) => asc(c.id)
		})
		const res: Sockets.Characters.List.Response = { characterList }
		emitToUser("characters:list", res)
		return res
	}
}

export const charactersGet: Handler<Sockets.Characters.Get.Params, Sockets.Characters.Get.Response> = {
	event: "characters:get",
	handler: async (socket, params, emitToUser) => {
		const character = await db.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, params.id),
			with: {
				characterTags: {
					with: {
						tag: true
					}
				}
			}
		})
		if (character) {
			// Transform the character data to include tags as string array
			const characterWithTags = {
				...character,
				tags: character.characterTags.map((ct) => ct.tag.name)
			}
			const { characterTags, ...characterWithoutTags } = characterWithTags

			const res: Sockets.Characters.Get.Response = { character: characterWithoutTags }
			emitToUser("characters:get", res)
			return res
		}
		const res: Sockets.Characters.Get.Response = { character: null }
		emitToUser("characters:get", res)
		return res
	}
}

export const charactersCreate: Handler<Sockets.Characters.Create.Params, Sockets.Characters.Create.Response> = {
	event: "characters:create",
	handler: async (socket, params, emitToUser) => {
		try {
			const data = { ...params.character }
			const tags = (data as any).tags || []

			// Remove fields that shouldn't be in the database insert
			// @ts-ignore - Remove avatar from character data to avoid conflicts
			delete data.avatar 
			// @ts-ignore - Remove tags - will be handled separately
			delete (data as any).tags 

			const [character] = await db
				.insert(schema.characters)
				.values({ ...data, userId: socket.user!.id })
				.returning()

			// Process tags after character creation
			if (tags.length > 0) {
				await processCharacterTags(character.id, tags)
			}

			if (params.avatarFile) {
				await handleCharacterAvatarUpload({
					character,
					avatarFile: params.avatarFile
				})
			}

			await charactersList.handler(socket, {}, emitToUser)

			const res: Sockets.Characters.Create.Response = { character }
			emitToUser("characters:create", res)
			return res
		} catch (e: any) {
			console.error("Error creating character:", e)
			emitToUser("characters:create:error", {
				error: e.message || "Failed to create character."
			})
			throw e
		}
	}
}

export const charactersUpdate: Handler<Sockets.Characters.Update.Params, Sockets.Characters.Update.Response> = {
	event: "characters:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const data = { ...params.character }
			const id = data.id
			const userId = socket.user!.id
			const tags = (data as any).tags || []

			// Remove fields that shouldn't be in the database update
			if ("userId" in data) (data as any).userId = undefined
			if ("id" in data) (data as any).id = undefined
			// @ts-ignore - Remove avatar from character data to avoid conflicts
			delete data.avatar 
			// @ts-ignore - Remove tags - will be handled separately
			delete (data as any).tags 

			const [updated] = await db
				.update(schema.characters)
				.set(data)
				.where(
					and(
						eq(schema.characters.id, id),
						eq(schema.characters.userId, userId)
					)
				)
				.returning()

			// Process tags after character update
			await processCharacterTags(id, tags)

			if (params.avatarFile) {
				await handleCharacterAvatarUpload({
					character: updated,
					avatarFile: params.avatarFile
				})
			}

			const res: Sockets.Characters.Update.Response = { character: updated }
			await charactersList.handler(socket, {}, emitToUser)
			emitToUser("characters:update", res)
			return res
		} catch (e: any) {
			console.error("Error updating character:", e)
			emitToUser("characters:update:error", {
				error: e.message || "Failed to update character."
			})
			throw e
		}
	}
}

export const charactersDelete: Handler<Sockets.Characters.Delete.Params, Sockets.Characters.Delete.Response> = {
	event: "characters:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Delete character tags first (cascade should handle this, but being explicit)
		await db
			.delete(schema.characterTags)
			.where(eq(schema.characterTags.characterId, params.id))

		// Delete the character
		await db
			.delete(schema.characters)
			.where(
				and(
					eq(schema.characters.id, params.id),
					eq(schema.characters.userId, userId)
				)
			)
		
		// Delete the character data directory if it exists
		const avatarDir = getCharacterDataDir({
			characterId: params.id,
			userId
		})
		try {
			await fsPromises.rmdir(avatarDir, { recursive: true })
		} catch (err) {
			console.error("Error deleting character data directory:", err)
		}
		
		await charactersList.handler(socket, {}, emitToUser)
		
		// Emit the delete event
		const res: Sockets.Characters.Delete.Response = { success: "Character deleted successfully" }
		emitToUser("characters:delete", res)
		return res
	}
}

export const charactersImportCard: Handler<Sockets.Characters.ImportCard.Params, Sockets.Characters.ImportCard.Response> = {
	event: "characters:importCard",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Parse character card using shared utility
			const { card, avatarBuffer, lorebook } =
				await parseCharacterCardFromBase64(params.file)

			// Convert card to V3 spec to access data
			const specData = card.toSpecV3()
			const data = specData.data

			// Prepare character data for insertion
			const characterData: typeof schema.characters.$inferInsert = {
				userId,
				name: data.name || "Unnamed Character",
				nickname: data.nickname || null,
				description: data.description || "",
				personality: data.personality || null,
				scenario: data.scenario || null,
				firstMessage: data.first_mes || null,
				exampleDialogues: data.mes_example 
					? (Array.isArray(data.mes_example) 
						? data.mes_example 
						: [data.mes_example])
					: undefined,
				alternateGreetings: data.alternate_greetings || null,
				creatorNotes: data.creator_notes || null,
				postHistoryInstructions: data.post_history_instructions || null,
				characterVersion: data.character_version || null,
				// Extract extensions
			source: data.extensions?.source || [],
				groupOnlyGreetings: data.extensions?.group_only_greetings || null,
				isFavorite: false
			}

			// Create the character
			const [character] = await db
				.insert(schema.characters)
				.values(characterData)
				.returning()

			// Handle avatar upload if present
			if (avatarBuffer) {
				await handleCharacterAvatarUpload({
					character,
					avatarFile: avatarBuffer
				})
				
				// Refetch character to get updated avatar path
				const updatedCharacter = await db.query.characters.findFirst({
					where: eq(schema.characters.id, character.id)
				})
				if (updatedCharacter) {
					Object.assign(character, updatedCharacter)
				}
			}

			// Process tags if present
			if (data.tags && data.tags.length > 0) {
				await processCharacterTags(character.id, data.tags)
			}

			await charactersList.handler(socket, {}, emitToUser)
			
			const res: Sockets.Characters.ImportCard.Response = {
				character,
				book: lorebook ?? null
			}
			emitToUser("characters:importCard", res)
			return res
		} catch (e: any) {
			console.error("Error importing character card:", e)
			emitToUser("characters:importCard:error", {
				error: e.message || "Failed to import character card."
			})
			throw e
		}
	}
}

export const charactersSearchLibrary: Handler<Sockets.Characters.SearchLibrary.Params, Sockets.Characters.SearchLibrary.Response> = {
	event: "characters:searchLibrary",
	handler: async (socket, params, emitToUser) => {
		try {
			// Fetch characters YAML from GitHub
			const response = await fetch(
				"https://raw.githubusercontent.com/doolijb/serene-pub-chara-list/main/characters.yaml"
			)

			if (!response.ok) {
				throw new Error(`GitHub API error: ${response.status}`)
			}

			const yamlText = await response.text()

			// Parse YAML - simple parsing for flat character list
			const characters: Array<{
				name: string
				description: string
				tags: string[]
				author: string
				version: string
				spec: string
				file: string
				category: string
			}> = []

			const lines = yamlText.split("\n")
			let currentCard: any = null
			let inDescriptionBlock = false
			let descriptionBuffer = ""

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i]
				const trimmed = line.trim()

				// Card start (top level array item)
				if (trimmed.startsWith("- name:") && line.match(/^  - name:/)) {
					// Save previous card if exists
					if (currentCard) {
						if (inDescriptionBlock) {
							currentCard.description = descriptionBuffer.trim()
							inDescriptionBlock = false
							descriptionBuffer = ""
						}
						characters.push(currentCard)
					}
					currentCard = {
						name: trimmed.replace("- name:", "").trim(),
						description: "",
						tags: [],
						author: "",
						version: "",
						spec: "V3",
						file: "",
						category: "Uncategorized"
					}
				} else if (currentCard) {
					// Check for multiline description
					if (trimmed.startsWith("description:")) {
						const afterColon = trimmed.replace("description:", "").trim()
						if (afterColon === "|-" || afterColon === "|") {
							inDescriptionBlock = true
							descriptionBuffer = ""
						} else {
							currentCard.description = afterColon
						}
					} else if (inDescriptionBlock) {
						// Continue reading description block
						if (line.match(/^    [^ ]/) && !line.match(/^      /)) {
							// End of description block (next field at same level)
							currentCard.description = descriptionBuffer.trim()
							inDescriptionBlock = false
							descriptionBuffer = ""
							// Process this line as a new field
							i-- // Re-process this line
							continue
						} else if (line.match(/^      /)) {
							// Part of description
							descriptionBuffer += line.substring(6) + "\n"
						}
					} else if (trimmed.startsWith("tags:") && line.match(/^    tags:/)) {
						// Tags array follows
						let j = i + 1
						while (j < lines.length && lines[j].match(/^      - /)) {
							const tag = lines[j].trim().replace("- ", "")
							if (tag) currentCard.tags.push(tag)
							j++
						}
					} else if (trimmed.startsWith("author:") && line.match(/^    author:/)) {
						currentCard.author = trimmed.replace("author:", "").trim()
					} else if (trimmed.startsWith("version:") && line.match(/^    version:/)) {
						currentCard.version = trimmed.replace("version:", "").trim()
					} else if (trimmed.startsWith("file:") && line.match(/^    file:/)) {
						currentCard.file = trimmed.replace("file:", "").trim()
					} else if (trimmed.startsWith("category:") && line.match(/^    category:/)) {
						const cat = trimmed.replace("category:", "").trim()
						if (cat && cat !== "null") {
							currentCard.category = cat
						}
					}
				}
			}

			// Add last card
			if (currentCard) {
				if (inDescriptionBlock) {
					currentCard.description = descriptionBuffer.trim()
				}
				characters.push(currentCard)
			}

			// Filter by search term if provided
			let filteredCharacters = characters
			if (params.searchTerm) {
				const searchLower = params.searchTerm.toLowerCase()
				filteredCharacters = characters.filter(
					(c) =>
						c.name.toLowerCase().includes(searchLower) ||
						c.description.toLowerCase().includes(searchLower) ||
						c.category.toLowerCase().includes(searchLower) ||
						c.tags.some((t) => t.toLowerCase().includes(searchLower))
				)
			}

			const res: Sockets.Characters.SearchLibrary.Response = {
				characters: filteredCharacters
			}
			emitToUser("characters:searchLibrary", res)
			return res
		} catch (error: any) {
			console.error("Character library search error:", error)
			emitToUser("characters:searchLibrary:error", {
				error: "Failed to search character library"
			})
			throw error
		}
	}
}

export const charactersImportFromLibrary: Handler<Sockets.Characters.ImportFromLibrary.Params, Sockets.Characters.ImportFromLibrary.Response> = {
	event: "characters:importFromLibrary",
	handler: async (socket, params, emitToUser) => {
		try {
			// Fetch the character card file from GitHub
			const fileUrl = `https://raw.githubusercontent.com/doolijb/serene-pub-chara-list/main/${params.fileUrl}`
			const response = await fetch(fileUrl)

			if (!response.ok) {
				throw new Error(`Failed to fetch character file: ${response.status}`)
			}

			// Get the file as a buffer
			const arrayBuffer = await response.arrayBuffer()
			const buffer = Buffer.from(arrayBuffer)
			
			// Convert to base64 for the import handler
			const base64 = buffer.toString("base64")

			// Use the existing import handler
			const importResult = await charactersImportCard.handler(
				socket,
				{ file: base64 },
				emitToUser
			)

			const res: Sockets.Characters.ImportFromLibrary.Response = {
				character: importResult.character,
				book: importResult.book
			}
			emitToUser("characters:importFromLibrary", res)
			return res
		} catch (error: any) {
			console.error("Character import from library error:", error)
			emitToUser("characters:importFromLibrary:error", {
				error: "Failed to import character from library"
			})
			throw error
		}
	}
}

export const charactersExportCard: Handler<Sockets.Characters.ExportCard.Params, Sockets.Characters.ExportCard.Response> = {
	event: "characters:exportCard",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const format = params.format || "json"

			// Fetch the character with all its data
			const character = await db.query.characters.findFirst({
				where: eq(schema.characters.id, params.id),
				with: {
					characterTags: {
						with: {
							tag: true
						}
					}
				}
			})

			if (!character) {
				throw new Error("Character not found")
			}

			// Convert to CharacterCard V2 format
			const charCardData = {
				spec: "chara_card_v2",
				spec_version: "2.0",
				data: {
					name: character.name,
					description: character.description || "",
					personality: character.personality || "",
					scenario: character.scenario || "",
					first_mes: character.firstMessage || "",
					mes_example: typeof character.exampleDialogues === "string" 
						? character.exampleDialogues 
						: (character.exampleDialogues as string[] || []).join("<START>"),
					creator_notes: character.creatorNotes || "",
					system_prompt: character.systemPrompt || "",
					post_history_instructions: character.postHistoryInstructions || "",
					alternate_greetings: character.alternateGreetings || [],
					tags: character.characterTags?.map(ct => ct.tag.name) || [],
					creator: character.creator || "",
					character_version: character.characterVersion || "",
					extensions: {
						depth_prompt: {
							prompt: character.depthPrompt || "",
							depth: character.depthPromptDepth || 4,
							role: character.depthPromptRole || "system"
						},
						...(character.source && character.source.length > 0 ? { source: character.source } : {}),
						...(character.groupOnlyGreetings && character.groupOnlyGreetings.length > 0 
							? { group_only_greetings: character.groupOnlyGreetings } 
							: {})
					}
				}
			}

			if (format === "json") {
				// Export as JSON
				const jsonString = JSON.stringify(charCardData, null, 2)
				const blob = Buffer.from(jsonString, "utf-8")
				const filename = `${character.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`

				const res: Sockets.Characters.ExportCard.Response = {
					blob,
					filename
				}
				emitToUser("characters:exportCard", res)
				return res
			} else {
				// Export as PNG with embedded data
				if (!character.avatar) {
					throw new Error("Character has no avatar to embed data into")
				}

				// Read the avatar file
				const avatarDir = getCharacterDataDir({ characterId: params.id, userId })
				// Extract just the filename from the avatar path (it may contain full path)
				const avatarFilename = path.basename(character.avatar)
				const avatarPath = path.join(avatarDir, avatarFilename)
				const avatarBuffer = await fsPromises.readFile(avatarPath)

				// Extract existing PNG chunks
				const chunks = extract(avatarBuffer)

				// Create the character data in base64
				const jsonString = JSON.stringify(charCardData)
				const base64Data = Buffer.from(jsonString, "utf-8").toString("base64")

				// Create a tEXt chunk with the character data
				const textChunk = text.encode("chara", base64Data)

				// Remove any existing "chara" or "ccv3" chunks
				const filteredChunks = chunks.filter(chunk => {
					if (chunk.name === "tEXt") {
						const decoded = text.decode(chunk.data)
						return decoded.keyword !== "chara" && decoded.keyword !== "ccv3"
					}
					return true
				})

				// Insert the new chunk before the IEND chunk
				const iendIndex = filteredChunks.findIndex(chunk => chunk.name === "IEND")
				if (iendIndex !== -1) {
					filteredChunks.splice(iendIndex, 0, textChunk)
				} else {
					filteredChunks.push(textChunk)
				}

				// Encode back to PNG
				const blob = Buffer.from(encode(filteredChunks))
				const filename = `${character.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.png`

				const res: Sockets.Characters.ExportCard.Response = {
					blob,
					filename
				}
				emitToUser("characters:exportCard", res)
				return res
			}
		} catch (error: any) {
			console.error("Error exporting character card:", error)
			emitToUser("characters:exportCard:error", {
				error: error.message || "Failed to export character card."
			})
			throw error
		}
	}
}

// Registration function for all character handlers
export function registerCharacterHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (socket: any, handler: Handler<any, any>, emitToUser: (event: string, data: any) => void) => void
) {
	register(socket, charactersList, emitToUser)
	register(socket, charactersGet, emitToUser)
	register(socket, charactersCreate, emitToUser)
	register(socket, charactersUpdate, emitToUser)
	register(socket, charactersDelete, emitToUser)
	register(socket, charactersImportCard, emitToUser)
	register(socket, charactersExportCard, emitToUser)
	register(socket, charactersSearchLibrary, emitToUser)
	register(socket, charactersImportFromLibrary, emitToUser)
}
