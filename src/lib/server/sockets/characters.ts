import { db } from "$lib/server/db"
import { and, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import * as fsPromises from "fs/promises"
import { getCharacterDataDir, handleCharacterAvatarUpload } from "../utils"
import { CharacterCard, type SpecV3 } from "@lenml/char-card-reader"
import { fileTypeFromBuffer } from "file-type"
import type { Handler } from "$lib/shared/events"

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
				creatorNotes: true
			},
			with: {
				characterTags: {
					with: {
						tag: true
					}
				}
			},
			where: (c, { eq }) => eq(c.userId, 1), // TODO: Replace with actual user id
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
				.values({ ...data, userId: 1 })
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
			const userId = 1 // Replace with actual userId
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
		const userId = 1 // Replace with actual userId

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
			// TODO: Fix this handler - the file structure needs to be updated
			// For now, just return empty array to prevent errors
			const res: Sockets.Characters.ImportCard.Response = {
				characters: []
			}
			emitToUser("characters:importCard", res)
			await charactersList.handler(socket, {}, emitToUser)
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
}
