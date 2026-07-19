import { db } from "$lib/server/db"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import * as fsPromises from "fs/promises"
import * as path from "path"
import {
	getCharacterDataDir,
	handleCharacterAvatarUpload,
	uploadCharacterGalleryImage,
	listCharacterGallery,
	deleteCharacterGalleryImage
} from "../utils"
import { CharacterCard, type SpecV3 } from "@lenml/char-card-reader"
import { fileTypeFromBuffer } from "file-type"
import type { Handler } from "$lib/shared/events"
import {
	parseCharacterCardFromBase64,
	buildCharacterCardV2,
	embedCharacterCardInPng
} from "../utils/characterCardParser"
import { autoEnqueueCharacter } from "$lib/server/embedding/vectorizationQueue"
import { canViewCharacter } from "$lib/server/utils/chatAccess"
import { resolveCardSource, cachedSearch, resolveNsfwParam } from "$lib/server/cardSources"
import { CardSourceUnavailableError, CardSourceRateLimitedError } from "$lib/server/cardSources/types"

// Helper function to process tags for character creation/update. Tags are
// per-user (schema.tags.userId): lookups/creates must stay scoped to the
// calling user, both so one user's tag name never resolves to another
// user's tag row, and so a caller can never mutate tag associations on a
// character it doesn't own by supplying someone else's characterId — the
// resource-ownership check below guards that even though the actual
// character field update elsewhere is already ownership-scoped.
async function processCharacterTags(
	characterId: number,
	tagNames: string[],
	userId: number
) {
	const character = await db.query.characters.findFirst({
		where: (c, { and, eq }) =>
			and(eq(c.id, characterId), eq(c.userId, userId)),
		columns: { id: true }
	})
	if (!character) return

	// Get existing tags for this character that belong to the user
	const existingCharacterTags = await db.query.characterTags.findMany({
		where: eq(schema.characterTags.characterId, characterId),
		with: { tag: true }
	})
	const userCharacterTags = existingCharacterTags.filter(
		(ct) => ct.tag.userId === userId
	)
	const existingTagNames = userCharacterTags.map((ct) => ct.tag.name)

	// Normalize tag names for comparison
	const normalizedNewTags = (tagNames || [])
		.map((t) => t.trim())
		.filter((t) => t.length > 0)

	// Find tags to remove (exist in DB but not in new list)
	const tagsToRemove = userCharacterTags.filter(
		(ct) => !normalizedNewTags.includes(ct.tag.name)
	)

	// Find tags to add (exist in new list but not in DB)
	const tagsToAdd = normalizedNewTags.filter(
		(tagName) => !existingTagNames.includes(tagName)
	)

	// Remove tags that are no longer in the list
	if (tagsToRemove.length > 0) {
		const tagIdsToRemove = tagsToRemove.map((ct) => ct.tagId)
		await db
			.delete(schema.characterTags)
			.where(
				and(
					eq(schema.characterTags.characterId, characterId),
					inArray(schema.characterTags.tagId, tagIdsToRemove)
				)
			)
	}

	// Add new tags
	for (const tagName of tagsToAdd) {
		// Check if tag exists for this user
		let existingTag = await db.query.tags.findFirst({
			where: (t, { and, eq }) =>
				and(eq(t.name, tagName), eq(t.userId, userId))
		})

		// Create tag if it doesn't exist
		if (!existingTag) {
			const [newTag] = await db
				.insert(schema.tags)
				.values({
					name: tagName,
					userId
				})
				.returning()
			existingTag = newTag
		}

		// Link tag to character
		await db
			.insert(schema.characterTags)
			.values({
				characterId,
				tagId: existingTag.id
			})
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
		const userId = socket.user!.id
		const character = await db.query.characters.findFirst({
			where: (c, { eq }) => eq(c.id, params.id),
			with: {
				characterTags: {
					with: {
						tag: true
					}
				},
				user: {
					columns: { username: true, displayName: true }
				}
			}
		})

		const isOwner = character?.userId === userId
		if (
			character &&
			(isOwner || (await canViewCharacter(character.id, userId)))
		) {
			// Transform the character data to include tags as string array
			const characterWithTags = {
				...character,
				tags: character.characterTags.map((ct) => ct.tag.name),
				isOwner,
				ownerName: character.user?.displayName || character.user?.username || null
			}
			const { characterTags, user, ...characterWithoutTags } = characterWithTags

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
				await processCharacterTags(character.id, tags, socket.user!.id)
			}

			if (params.avatarFile) {
				await handleCharacterAvatarUpload({
					character,
					avatarFile: params.avatarFile
				})
			}

			autoEnqueueCharacter(character.id, character.name).catch(console.error)
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
			delete (data as any).createdAt
			delete (data as any).updatedAt
			delete (data as any).vectorizedAt
			delete (data as any).embedding
			delete (data as any).embeddingModel

			const [updated] = await db
				.update(schema.characters)
				.set({ ...data, embedding: null, embeddingModel: null, vectorizedAt: null })
				.where(
					and(
						eq(schema.characters.id, id),
						eq(schema.characters.userId, userId)
					)
				)
				.returning()

			if (!updated) {
				throw new Error("Character not found or not owned by user.")
			}

			// Process tags after character update
			await processCharacterTags(id, tags, userId)

			if (params.avatarFile) {
				await handleCharacterAvatarUpload({
					character: updated,
					avatarFile: params.avatarFile
				})
			}

			autoEnqueueCharacter(id, updated.name).catch(console.error)
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

		// character_tags.characterId already declares onDelete: "cascade" from
		// characters.id, so a separate manual delete here is redundant — and
		// was wrong: it ran unconditionally on any supplied id BEFORE this
		// ownership-scoped delete, so any user could wipe another user's
		// character's tag associations just by guessing the id, even though
		// the character row itself correctly survived (same bug class already
		// fixed for tags:delete).
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
				creator: data.creator || null,
				// Extract extensions
				source: data.extensions?.source || [],
				groupOnlyGreetings: data.extensions?.group_only_greetings || null,
				aliases: data.extensions?.serenepub?.aliases ?? data.extensions?.aliases ?? [],
				summary: data.extensions?.serenepub?.summary ?? null,
				category: data.extensions?.serenepub?.category ?? null,
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
				await processCharacterTags(character.id, data.tags, userId)
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
			const userId = socket.user!.id
			const sourceId = params.source ?? "github-serenepub"
			const source = resolveCardSource(sourceId)
			if (!source.supports("character")) {
				throw new CardSourceUnavailableError(
					`${source.label} does not support browsing characters`
				)
			}

			const nsfw = await resolveNsfwParam(userId)
			const { items, hasMore } = await cachedSearch(
				sourceId,
				{
					kind: "character",
					searchTerm: params.searchTerm,
					category: params.category,
					nsfw,
					sort: params.sort,
					hasBook: params.hasBook,
					creatorFilter: params.creatorFilter,
					cursor: params.cursor
				},
				{ userId }
			)

			const res: Sockets.Characters.SearchLibrary.Response = {
				characters: items,
				hasMore,
				requestId: params.requestId
			}
			emitToUser("characters:searchLibrary", res)
			return res
		} catch (error: any) {
			console.error("Character library search error:", error)
			emitToUser("characters:searchLibrary:error", {
				error:
					error instanceof CardSourceUnavailableError ||
					error instanceof CardSourceRateLimitedError
						? error.message
						: "Failed to search character library",
				unreachable: error instanceof CardSourceUnavailableError || undefined,
				rateLimited: error instanceof CardSourceRateLimitedError || undefined,
				retryAfterMs:
					error instanceof CardSourceRateLimitedError
						? error.retryAfterMs
						: undefined,
				requestId: params.requestId
			})
			throw error
		}
	}
}

export const charactersImportFromLibrary: Handler<Sockets.Characters.ImportFromLibrary.Params, Sockets.Characters.ImportFromLibrary.Response> = {
	event: "characters:importFromLibrary",
	handler: async (socket, params, emitToUser) => {
		try {
			const source = resolveCardSource(params.source)
			const buffer = await source.getCardBytes(params.ref, {
				userId: socket.user!.id
			})
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
				error:
					error instanceof CardSourceUnavailableError ||
					error instanceof CardSourceRateLimitedError
						? error.message
						: "Failed to import character from library"
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

			// Fetch the character with all its data — owner-only (export is a
			// data-extraction action, unlike viewing a character in a shared
			// chat, so this deliberately does NOT use canViewCharacter).
			const character = await db.query.characters.findFirst({
				where: and(
					eq(schema.characters.id, params.id),
					eq(schema.characters.userId, userId)
				),
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
			const charCardData = buildCharacterCardV2({
				...character,
				tags: character.characterTags?.map((ct) => ct.tag.name) || []
			})

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

				const blob = embedCharacterCardInPng(avatarBuffer, charCardData)
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

export const charactersListGallery: Handler<Sockets.Characters.ListGallery.Params, Sockets.Characters.ListGallery.Response> = {
	event: "characters:listGallery",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const images = await listCharacterGallery({ characterId: params.characterId, userId })
		const res: Sockets.Characters.ListGallery.Response = { images }
		emitToUser("characters:listGallery", res)
		return res
	}
}

export const charactersUploadGalleryImage: Handler<Sockets.Characters.UploadGalleryImage.Params, Sockets.Characters.UploadGalleryImage.Response> = {
	event: "characters:uploadGalleryImage",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const character = await db.query.characters.findFirst({
			where: (c, { and, eq }) => and(eq(c.id, params.characterId), eq(c.userId, userId))
		})
		if (!character) throw new Error("Character not found or access denied")

		const imgPath = await uploadCharacterGalleryImage({
			characterId: params.characterId,
			userId,
			imageFile: Buffer.from(params.imageFile as Uint8Array),
			mimeType: params.mimeType
		})

		const res: Sockets.Characters.UploadGalleryImage.Response = { success: true, path: imgPath }
		emitToUser("characters:uploadGalleryImage", res)
		await charactersListGallery.handler(socket, { characterId: params.characterId }, emitToUser)
		await charactersGet.handler(socket, { id: params.characterId }, emitToUser)
		return res
	}
}

export const charactersDeleteGalleryImage: Handler<Sockets.Characters.DeleteGalleryImage.Params, Sockets.Characters.DeleteGalleryImage.Response> = {
	event: "characters:deleteGalleryImage",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const character = await db.query.characters.findFirst({
			where: (c, { and, eq }) => and(eq(c.id, params.characterId), eq(c.userId, userId))
		})
		if (!character) throw new Error("Character not found or access denied")

		await deleteCharacterGalleryImage({ characterId: params.characterId, userId, path: params.path })

		const res: Sockets.Characters.DeleteGalleryImage.Response = { success: true }
		emitToUser("characters:deleteGalleryImage", res)
		await charactersListGallery.handler(socket, { characterId: params.characterId }, emitToUser)
		return res
	}
}

export const charactersSetAvatar: Handler<Sockets.Characters.SetAvatar.Params, Sockets.Characters.SetAvatar.Response> = {
	event: "characters:setAvatar",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const character = await db.query.characters.findFirst({
			where: (c, { and, eq }) => and(eq(c.id, params.characterId), eq(c.userId, userId))
		})
		if (!character) throw new Error("Character not found or access denied")

		const [updated] = await db
			.update(schema.characters)
			.set({ avatar: params.path })
			.where(and(eq(schema.characters.id, params.characterId), eq(schema.characters.userId, userId)))
			.returning()

		const res: Sockets.Characters.SetAvatar.Response = { character: updated }
		emitToUser("characters:setAvatar", res)
		await charactersGet.handler(socket, { id: params.characterId }, emitToUser)
		return res
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
	register(socket, charactersListGallery, emitToUser)
	register(socket, charactersUploadGalleryImage, emitToUser)
	register(socket, charactersDeleteGalleryImage, emitToUser)
	register(socket, charactersSetAvatar, emitToUser)
}
