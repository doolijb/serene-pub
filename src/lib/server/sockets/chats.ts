import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, asc, count, desc, eq, inArray, lt, or } from "drizzle-orm"
import { runBindingNodeCheck } from "$lib/server/utils/bindingNodeCheck"
import { generateResponse } from "../utils/generateResponse"
import { getNextCharacterTurn } from "$lib/server/utils/getNextCharacterTurn"
import type { BaseConnectionAdapter } from "../connectionAdapters/BaseConnectionAdapter"
import { getConnectionAdapter } from "../utils/getConnectionAdapter"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"
import { InterpolationEngine } from "../utils/promptBuilder"
import { dev } from "$app/environment"
import type { Handler } from "$lib/shared/events"
import { getUserConfigurations } from "../utils/getUserConfigurations"
import {
	broadcastToChatUsers,
	createChatBroadcaster
} from "./utils/broadcastHelpers"

// ===== SECURITY HELPERS =====

/**
 * Check if user owns the chat or is a guest in the chat
 */
async function checkChatAccess(
	chatId: number,
	userId: number
): Promise<{ isOwner: boolean; isGuest: boolean; hasAccess: boolean }> {
	const chat = await db.query.chats.findFirst({
		where: eq(schema.chats.id, chatId),
		columns: { userId: true }
	})

	if (!chat) {
		return { isOwner: false, isGuest: false, hasAccess: false }
	}

	const isOwner = chat.userId === userId

	// Check if user is a guest
	const guestRecord = await db.query.chatGuests.findFirst({
		where: (cg, { and, eq }) =>
			and(eq(cg.chatId, chatId), eq(cg.userId, userId))
	})

	const isGuest = !!guestRecord
	const hasAccess = isOwner || isGuest

	return { isOwner, isGuest, hasAccess }
}

/**
 * Check if user owns a character
 */
async function checkCharacterOwnership(
	characterId: number,
	userId: number
): Promise<boolean> {
	const character = await db.query.characters.findFirst({
		where: (c, { and, eq }) =>
			and(eq(c.id, characterId), eq(c.userId, userId)),
		columns: { id: true }
	})

	return !!character
}

/**
 * Check if user owns a persona
 */
async function checkPersonaOwnership(
	personaId: number,
	userId: number
): Promise<boolean> {
	const persona = await db.query.personas.findFirst({
		where: (p, { and, eq }) =>
			and(eq(p.id, personaId), eq(p.userId, userId)),
		columns: { id: true }
	})

	return !!persona
}

/**
 * Check if user can edit a chat message
 * - Chat owners can edit any message
 * - Character/persona owners can edit messages from their characters/personas
 */
async function checkMessageEditPermission(
	messageId: number,
	userId: number
): Promise<boolean> {
	const message = await db.query.chatMessages.findFirst({
		where: eq(schema.chatMessages.id, messageId),
		columns: { chatId: true, characterId: true, personaId: true }
	})

	if (!message) return false

	// Check chat access
	const chatAccess = await checkChatAccess(message.chatId, userId)
	if (chatAccess.isOwner) return true // Chat owner can edit any message

	// Check if user owns the character that created the message
	if (message.characterId) {
		return await checkCharacterOwnership(message.characterId, userId)
	}

	// Check if user owns the persona that created the message
	if (message.personaId) {
		return await checkPersonaOwnership(message.personaId, userId)
	}

	return false
}

// Helper function to process tags for chat creation/update
async function processChatTags(
	chatId: number,
	tagNames: string[],
	userId: number
) {
	// Get existing tags for this chat that belong to the user
	const existingChatTags = await db.query.chatTags.findMany({
		where: eq(schema.chatTags.chatId, chatId),
		with: {
			tag: true
		}
	})

	// Filter to only tags that belong to this user
	const userChatTags = existingChatTags.filter(
		(ct) => ct.tag.userId === userId
	)
	const existingTagNames = userChatTags.map((ct) => ct.tag.name)

	// Normalize tag names for comparison
	const normalizedNewTags = (tagNames || [])
		.map((t) => t.trim())
		.filter((t) => t.length > 0)

	// Find tags to remove (exist in DB but not in new list)
	const tagsToRemove = userChatTags.filter(
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
			.delete(schema.chatTags)
			.where(
				and(
					eq(schema.chatTags.chatId, chatId),
					inArray(schema.chatTags.tagId, tagIdsToRemove)
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

		// Link tag to chat
		await db
			.insert(schema.chatTags)
			.values({
				chatId,
				tagId: existingTag.id
			})
			.onConflictDoNothing()
	}
}

// --- Global map for active adapters ---
export const activeAdapters = new Map<string, BaseConnectionAdapter>()

export const chatsListHandler: Handler<
	Sockets.Chats.List.Params,
	Sockets.Chats.List.Response
> = {
	event: "chats:list",
	async handler(socket, params, emitToUser) {
		const userId = socket.user!.id
		// chats:list only returns ROLEPLAY chats
		// Use chats:listAssistant for assistant chats
		const chatType = ChatTypes.ROLEPLAY
		console.log("Fetching chats for user:", userId, "chatType:", chatType)

		// First, find all chats where the current user is a guest
		const guestChats = await db.query.chatGuests.findMany({
			where: eq(schema.chatGuests.userId, userId),
			columns: {
				chatId: true
			}
		})

		const guestChatIds = guestChats.map((gc) => gc.chatId)
		console.log("User is guest in chat IDs:", guestChatIds)

		// Build the where clause: user owns the chat OR user is a guest in the chat
		// AND filter by chat type
		const whereCondition = (c, { or, eq, inArray, and }) =>
			guestChatIds.length > 0
				? and(
						or(eq(c.userId, userId), inArray(c.id, guestChatIds)),
						eq(c.chatType, chatType)
					)
				: and(eq(c.userId, userId), eq(c.chatType, chatType))

		const chatsList = await db.query.chats.findMany({
			with: {
				chatCharacters: {
					with: {
						character: {
							columns: {
								id: true,
								name: true,
								shortDescription: true,
								avatar: true,
								visibility: true
							}
						}
					},
					orderBy: asc(schema.chatCharacters.position)
				},
				chatPersonas: {
					with: {
						persona: {
							columns: {
								id: true,
								name: true,
								shortDescription: true,
								avatar: true,
								visibility: true
							}
						}
					},
					orderBy: asc(schema.chatPersonas.position)
				},
				chatTags: {
					with: {
						tag: true
					}
				}
			},
			where: whereCondition,
			orderBy: desc(schema.chats.updatedAt)
		})

		// Add canEdit property to each chat
		const chatsWithEditPermission = chatsList.map((chat) => ({
			...chat,
			canEdit: chat.userId === userId // User can edit only if they own the chat
		}))

		const response = { chatList: chatsWithEditPermission }
		emitToUser("chats:list", response)
		return response
	}
}

export const chatsCreateHandler: Handler<
	Sockets.Chats.Create.Params,
	Sockets.Chats.Create.Response
> = {
	event: "chats:create",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const tags = params.tags || []
		const personaIds = params.personaIds || []
		const characterIds = params.characterIds || []
		const characterPositions = params.characterPositions || {}

		// Remove tags from chat data as it will be handled separately
		const chatDataWithoutTags = { ...params.chat }

		const chatData: InsertChat = {
			...chatDataWithoutTags,
			userId,
			isGroup: characterIds.length > 1
		}
		const [newChat] = await db
			.insert(schema.chats)
			.values(chatData)
			.returning()

		// Process tags after chat creation
		if (tags.length > 0) {
			await processChatTags(newChat.id, tags, userId)
		}

		// Batch insert personas
		if (personaIds.length > 0) {
			await db.insert(schema.chatPersonas).values(
				personaIds.map((personaId, i) => ({
					chatId: newChat.id,
					personaId,
					position: i
				}))
			)
		}

		// Batch insert characters
		if (characterIds.length > 0) {
			await db.insert(schema.chatCharacters).values(
				characterIds.map((characterId) => ({
					chatId: newChat.id,
					characterId,
					position: characterPositions[characterId] || 0
				}))
			)
		}
		// Insert a first message for every character assigned to the chat, ordered by position
		const chatCharacters = await db.query.chatCharacters.findMany({
			where: (cc, { eq }) => eq(cc.chatId, newChat.id),
			with: { character: true },
			orderBy: (cc, { asc }) => asc(cc.position ?? 0)
		})
		const chatPersona = await db.query.chatPersonas.findFirst({
			where: (cp, { eq, and, isNotNull }) =>
				and(eq(cp.chatId, newChat.id), isNotNull(cp.personaId)),
			with: { persona: true },
			orderBy: (cp, { asc }) => asc(cp.position ?? 0)
		})
		for (const cc of chatCharacters) {
			if (!cc.character) continue
			const greetings = buildCharacterFirstChatMessage({
				character: cc.character,
				persona: chatPersona?.persona,
				isGroup: !!newChat.isGroup
			})
			if (greetings.length > 0) {
				const newMessage: InsertChatMessage = {
					userId,
					chatId: newChat.id,
					personaId: null,
					characterId: cc.character.id,
					role: "assistant",
					content: greetings[0],
					isGenerating: false,
					metadata: {
						isGreeting: true,
						swipes: {
							currentIdx: 0,
							history: greetings as any // Patch: force string[]
						}
					}
				}
				await db.insert(schema.chatMessages).values(newMessage)
			}
		}

		// Fetch the complete chat with messages
		const resChat = await getChatFromDB(newChat.id, userId)
		if (!resChat) throw new Error("Failed to fetch created chat")

		await chatsListHandler.handler(socket, {}, emitToUser) // Refresh chat list
		const res: Sockets.Chats.Create.Response = { chat: resChat as any }
		emitToUser("chats:create", res)
		return res
	}
}

export async function chat(
	socket: any,
	message: Sockets.Chat.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = socket.user!.id
	const limit = message.limit || 25
	const offset = message.offset || 0

	const chat = await getChatFromDB(message.id, userId, limit, offset)
	if (chat) {
		// Get total message count for pagination
		const totalMessages = await db.query.chatMessages.findMany({
			where: (cm, { eq }) => eq(cm.chatId, message.id)
		})

		const hasMore = offset + limit < totalMessages.length

		const res: Sockets.Chat.Response = {
			chat: chat as any,
			pagination: {
				total: totalMessages.length,
				hasMore
			}
		}
		emitToUser("chat", res)
	}
}

export const getChat = chat

// Helper to get chat with userId
async function getChatFromDB(
	chatId: number,
	userId: number,
	limit?: number,
	offset?: number,
	beforeId?: number
) {
	// Check if user has access (owner or guest)
	const chatAccess = await checkChatAccess(chatId, userId)
	if (!chatAccess.hasAccess) {
		return null
	}

	const res = db.query.chats.findFirst({
		where: (c, { eq }) => eq(c.id, chatId),
		with: {
			chatPersonas: {
				with: { persona: true },
				orderBy: (cp, { asc }) => asc(cp.position)
			},
			chatCharacters: { with: { character: true } },
			chatMessages: {
				where: beforeId != null
					? (cm) => lt(cm.id, beforeId)
					: undefined,
				orderBy: (cm, { desc }) => desc(cm.id),
				limit: limit,
				offset: beforeId != null ? undefined : offset
			},
			chatTags: {
				with: {
					tag: true
				}
			},
			chatGuests: {
				with: {
					user: true
				}
			}
		}
	})

	// Drizzle may not properly handle orderby,
	// Lets sort it manually
	const chat = await res
	if (chat) {
		// Order the chatCharacters by position
		chat.chatCharacters.sort(
			(a, b) => (a.position ?? 0) - (b.position ?? 0)
		)
		// Sort chatPersonas by position if it exists
		if (chat.chatPersonas) {
			chat.chatPersonas.sort(
				(a, b) => (a.position ?? 0) - (b.position ?? 0)
			)
		}
		// Sort messages by id ascending (oldest first) for correct display order
		// When paginating, we fetched newest first (DESC) but want to display oldest first
		chat.chatMessages.sort((a, b) => a.id - b.id)

		// Transform chat tags to include tags as string array
		const chatWithTags = {
			...chat,
			tags: chat.chatTags?.map((ct) => ct.tag.name) || []
		}
		return chatWithTags
	}
	return chat
}

// Returns complete chat data for prompt compilation
async function getPromptChatFromDb(chatId: number, userId: number) {
	// Check if user has access (owner or guest)
	const chatAccess = await checkChatAccess(chatId, userId)
	if (!chatAccess.hasAccess) {
		return null
	}

	const chat = await db.query.chats.findFirst({
		where: (c, { eq }) => eq(c.id, chatId),
		with: {
			chatMessages: {
				where: (cm, { eq }) => eq(cm.isHidden, false),
				orderBy: (cm, { asc }) => asc(cm.id)
			},
			chatCharacters: {
				with: {
					character: {
						// with: { lorebook: true }
					}
				},
				orderBy: (cc, { asc }) => asc(cc.position ?? 0)
			},
			chatPersonas: {
				with: {
					persona: {
						// with: { lorebook: true }
					}
				},
				orderBy: (cp, { asc }) => asc(cp.position ?? 0)
			},
			lorebook: {
				with: {
					lorebookBindings: {
						with: { character: true, persona: true }
					},
					worldLoreEntries: true,
					characterLoreEntries: {
						with: {
							lorebookBinding: {
								with: {
									character: true,
									persona: true
								}
							}
						}
					},
					historyEntries: true
				}
			}
		}
	})

	if (chat) {
		// Order the chatCharacters by position
		chat.chatCharacters.sort(
			(a, b) => (a.position ?? 0) - (b.position ?? 0)
		)
		// Sort chatPersonas by position if it exists
		if (chat.chatPersonas) {
			chat.chatPersonas.sort(
				(a, b) => (a.position ?? 0) - (b.position ?? 0)
			)
		}
	}
	return chat
}

export const chatsDeleteHandler: Handler<
	Sockets.Chats.Delete.Params,
	Sockets.Chats.Delete.Response
> = {
	event: "chats:delete",
	async handler(socket, params, emitToUser) {
		try {
			const userId = socket.user!.id

			console.log("[chats:delete] Received params:", params)
			console.log("[chats:delete] Params type:", typeof params)
			console.log(
				"[chats:delete] Params keys:",
				Object.keys(params || {})
			)

			// Check if user has access to delete this chat (only owners can delete)
			const chatAccess = await checkChatAccess(params.id, userId)

			console.log("[chats:delete] Chat access check:", {
				chatId: params.id,
				userId,
				isOwner: chatAccess.isOwner,
				isGuest: chatAccess.isGuest,
				hasAccess: chatAccess.hasAccess
			})

			if (!chatAccess.hasAccess || !chatAccess.isOwner) {
				throw new Error(
					"Access denied. Only chat owners can delete chats."
				)
			}

			await db.delete(schema.chats).where(eq(schema.chats.id, params.id))

			// Emit to user with the deleted chat ID so frontend can update
			emitToUser("chats:delete", {
				success: "Chat deleted successfully",
				id: params.id
			})

			return { success: "Chat deleted successfully", id: params.id }
		} catch (error) {
			throw error
		}
	}
}

export const chatsGetHandler: Handler<
	Sockets.Chats.Get.Params,
	Sockets.Chats.Get.Response
> = {
	event: "chats:get",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const limit = params.limit ?? 25
			const beforeId = params.beforeId

			// Check if user has access to this chat (both owners and guests can get)
			const chatAccess = await checkChatAccess(params.id, userId)
			if (!chatAccess.hasAccess) {
				const res: Sockets.Chats.Get.Response = {
					chat: null,
					messages: null
				}
				emitToUser("chats:get", res)
				return res
			}

			const chatData = await getChatFromDB(params.id, userId, limit, undefined, beforeId)

			if (!chatData) {
				const res: Sockets.Chats.Get.Response = {
					chat: null,
					messages: null
				}
				emitToUser("chats:get", res)
				return res
			}

			// Count total messages for pagination metadata
			const [{ total }] = await db
				.select({ total: count() })
				.from(schema.chatMessages)
				.where(eq(schema.chatMessages.chatId, params.id))

			const loadedCount = (chatData as any).chatMessages.length
			const hasMore = beforeId != null
				? loadedCount === limit  // cursor mode: full page implies more exist
				: total > limit          // initial load: more exist than we fetched

			const drafts = (chatData as any).drafts as Record<string, string> | null | undefined
			const userDraft = drafts?.[String(userId)] || null

			const res: Sockets.Chats.Get.Response = {
				chat: chatData as any,
				messages: (chatData as any).chatMessages || null,
				pagination: { total, hasMore },
				beforeId,
				userDraft
			}
			emitToUser("chats:get", res)
			return res
		} catch (error: any) {
			console.error("Error fetching chat:", error)
			emitToUser("chats:get:error", {
				error: "Failed to fetch chat"
			})
			throw error
		}
	}
}

export const chatsSaveDraftHandler: Handler<
	Sockets.Chats.SaveDraft.Params,
	Sockets.Chats.SaveDraft.Response
> = {
	event: "chats:saveDraft",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const chatAccess = await checkChatAccess(params.chatId, userId)
		if (!chatAccess.hasAccess) {
			return { success: false }
		}

		const existing = await db.query.chats.findFirst({
			where: eq(schema.chats.id, params.chatId),
			columns: { drafts: true }
		})
		const drafts: Record<string, string> = { ...(existing?.drafts ?? {}) }
		if (params.content) {
			drafts[String(userId)] = params.content
		} else {
			delete drafts[String(userId)]
		}
		await db
			.update(schema.chats)
			.set({ drafts })
			.where(eq(schema.chats.id, params.chatId))

		return { success: true }
	}
}

// ─── Binding + Node check utilities (Flow 1 + 2) ────────────────────────────

/**
 * After a chat is saved with a lorebook:
 * - Quietly create bindings for chars/personas that don't have one yet.
 * - Emit bindingCheck:result for any orphaned bindings (bindings without a char/persona).
 * - Emit bindingCheck:nodeResult for bindings that need a node linked.
 */
async function runLorebookBindingCheck(
	chatId: number,
	lorebookId: number,
	emitToUser: (event: string, data: any) => void
): Promise<void> {
	const [chatChars, chatPersonas, existingBindings] = await Promise.all([
		db.query.chatCharacters.findMany({
			where: eq(schema.chatCharacters.chatId, chatId),
			columns: { characterId: true }
		}),
		db.query.chatPersonas.findMany({
			where: eq(schema.chatPersonas.chatId, chatId),
			columns: { personaId: true }
		}),
		db.query.lorebookBindings.findMany({
			where: eq(schema.lorebookBindings.lorebookId, lorebookId)
		})
	])

	const bindingsByChar = new Map(existingBindings.filter((b) => b.characterId).map((b) => [b.characterId!, b]))
	const bindingsByPersona = new Map(existingBindings.filter((b) => b.personaId).map((b) => [b.personaId!, b]))

	// Flow 1a: Create missing bindings for chars/personas
	const nextIndex = existingBindings.length + 1
	let tokenCounter = nextIndex

	for (const { characterId } of chatChars) {
		if (!characterId || bindingsByChar.has(characterId)) continue
		const token = `{{char:${tokenCounter++}}}`
		const [created] = await db
			.insert(schema.lorebookBindings)
			.values({ lorebookId, characterId, binding: token })
			.returning()
		bindingsByChar.set(characterId, created)
		existingBindings.push(created)
	}

	for (const { personaId } of chatPersonas) {
		if (!personaId || bindingsByPersona.has(personaId)) continue
		const token = `{{char:${tokenCounter++}}}`
		const [created] = await db
			.insert(schema.lorebookBindings)
			.values({ lorebookId, personaId, binding: token })
			.returning()
		bindingsByPersona.set(personaId, created)
		existingBindings.push(created)
	}

	// Flow 1b: Collect orphaned bindings (no char or persona)
	const orphaned = existingBindings.filter((b) => !b.characterId && !b.personaId)
	if (orphaned.length > 0) {
		const unboundChars = chatChars
			.filter((c) => c.characterId && !bindingsByChar.get(c.characterId))
			.map((c) => ({ type: "character" as const, id: c.characterId!, name: "" }))
		const unboundPersonas = chatPersonas
			.filter((p) => p.personaId && !bindingsByPersona.get(p.personaId))
			.map((p) => ({ type: "persona" as const, id: p.personaId!, name: "" }))

		const bindingCheckRes: Sockets.BindingCheck.Result.Response = {
			lorebookId,
			chatId,
			unboundEntities: [...unboundChars, ...unboundPersonas],
			orphanedBindings: orphaned.map((b) => ({ id: b.id, binding: b.binding }))
		}
		emitToUser("bindingCheck:result", bindingCheckRes)
	}

	// Flow 2: For each binding with no narrative node, check for unlinked nodes
	await runBindingNodeCheck(lorebookId, existingBindings, emitToUser)
}

export const chatsUpdateHandler: Handler<
	Sockets.Chats.Update.Params,
	Sockets.Chats.Update.Response
> = {
	event: "chats:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Check if user has access to update this chat
			const chatAccess = await checkChatAccess(params.chat.id!, userId)
			if (!chatAccess.hasAccess) {
				emitToUser("chats:update:error", {
					error: "Access denied. Only chat owners can update chats."
				})
				throw new Error(
					"Access denied. Only chat owners can update chats."
				)
			}

			const tags = params.tags || params.chat.tags || []

			// Remove tags from chat data as it will be handled separately
			const chatDataWithoutTags = { ...params.chat }
			delete chatDataWithoutTags.tags

			// Update the chat
			await db
				.update(schema.chats)
				.set({
					...chatDataWithoutTags,
					updatedAt: new Date().toISOString()
				})
				.where(eq(schema.chats.id, params.chat.id!))

			// Process tags after chat update
			await processChatTags(params.chat.id!, tags, userId)

			// Sync chatCharacters if provided
			if (params.characterIds !== undefined) {
				const existingCCs = await db.query.chatCharacters.findMany({
					where: (cc, { eq }) => eq(cc.chatId, params.chat.id!)
				})
				const existingCharacterIds = new Set(existingCCs.map((cc) => cc.characterId).filter((id): id is number => id !== null))
				const newCharacterIds = new Set(params.characterIds)

				for (const cc of existingCCs) {
					if (cc.characterId === null) continue
					if (!newCharacterIds.has(cc.characterId)) {
						await db.delete(schema.chatCharacters).where(
							and(eq(schema.chatCharacters.chatId, params.chat.id!), eq(schema.chatCharacters.characterId, cc.characterId))
						)
					}
				}
				for (let i = 0; i < params.characterIds.length; i++) {
					const characterId = params.characterIds[i]
					const position = (params.characterPositions ?? {})[characterId] ?? i
					if (existingCharacterIds.has(characterId)) {
						await db.update(schema.chatCharacters)
							.set({ position })
							.where(and(eq(schema.chatCharacters.chatId, params.chat.id!), eq(schema.chatCharacters.characterId, characterId)))
					} else {
						await db.insert(schema.chatCharacters).values({ chatId: params.chat.id!, characterId, position })
					}
				}
				await db.update(schema.chats)
					.set({ isGroup: params.characterIds.length > 1 })
					.where(eq(schema.chats.id, params.chat.id!))
			}

			// Sync chatPersonas if provided
			if (params.personaIds !== undefined) {
				const existingCPs = await db.query.chatPersonas.findMany({
					where: (cp, { eq }) => eq(cp.chatId, params.chat.id!)
				})
				const existingPersonaIds = new Set(existingCPs.map((cp) => cp.personaId).filter((id): id is number => id !== null))
				const newPersonaIds = new Set(params.personaIds)

				for (const cp of existingCPs) {
					if (cp.personaId === null) continue
					if (!newPersonaIds.has(cp.personaId)) {
						await db.delete(schema.chatPersonas).where(
							and(eq(schema.chatPersonas.chatId, params.chat.id!), eq(schema.chatPersonas.personaId, cp.personaId))
						)
					}
				}
				for (let i = 0; i < params.personaIds.length; i++) {
					const personaId = params.personaIds[i]
					if (!existingPersonaIds.has(personaId)) {
						await db.insert(schema.chatPersonas).values({ chatId: params.chat.id!, personaId, position: i })
					}
				}
			}

			// Fetch updated chat
			const updatedChat = await getChatFromDB(params.chat.id!, userId)
			if (!updatedChat) {
				throw new Error("Failed to fetch updated chat")
			}

			const res: Sockets.Chats.Update.Response = {
				chat: updatedChat as any
			}
			emitToUser("chats:update", res)
			await chatsListHandler.handler(socket, {}, emitToUser) // Refresh chat list

			// Flow 1+2: binding and node checks (fire-and-forget, errors are non-fatal)
			const lorebookId = (updatedChat as any).lorebookId
			if (lorebookId) {
				runLorebookBindingCheck(params.chat.id!, lorebookId, emitToUser).catch(console.error)
			}

			return res
		} catch (error: any) {
			console.error("Error updating chat:", error)
			emitToUser("chats:update:error", {
				error: "Failed to update chat"
			})
			throw error
		}
	}
}

export const chatsAddPersonaHandler: Handler<
	Sockets.Chats.AddPersona.Params,
	Sockets.Chats.AddPersona.Response
> = {
	event: "chats:addPersona",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { chatId, personaId } = params

			// Check if user has access to this chat
			const chatAccess = await checkChatAccess(chatId, userId)
			if (!chatAccess.hasAccess) {
				const res: Sockets.Chats.AddPersona.Response = {
					success: false,
					error: "Access denied. Chat not found or no permission to access."
				}
				emitToUser("chats:addPersona", res)
				return res
			}

			// Check if user owns the persona they're trying to add
			const ownsPersona = await checkPersonaOwnership(personaId, userId)
			if (!ownsPersona) {
				const res: Sockets.Chats.AddPersona.Response = {
					success: false,
					error: "Access denied. You can only add personas you own."
				}
				emitToUser("chats:addPersona", res)
				return res
			}

			// Check if persona is already in the chat
			const existingChatPersona = await db.query.chatPersonas.findFirst({
				where: and(
					eq(schema.chatPersonas.chatId, chatId),
					eq(schema.chatPersonas.personaId, personaId)
				)
			})

			if (existingChatPersona) {
				const res: Sockets.Chats.AddPersona.Response = {
					success: false,
					error: "This persona is already in the chat."
				}
				emitToUser("chats:addPersona", res)
				return res
			}

			// Get the next position
			const maxPosition = await db
				.select({ maxPos: schema.chatPersonas.position })
				.from(schema.chatPersonas)
				.where(eq(schema.chatPersonas.chatId, chatId))
				.orderBy(desc(schema.chatPersonas.position))
				.limit(1)

			const nextPosition = maxPosition[0]?.maxPos
				? maxPosition[0].maxPos + 1
				: 0

			// Add persona to chat
			await db.insert(schema.chatPersonas).values({
				chatId,
				personaId,
				position: nextPosition
			})

			// Broadcast updated chat to all participants
			const updatedChat = await getChatFromDB(chatId, userId)
			if (updatedChat) {
				await broadcastToChatUsers(socket.io, chatId, "chats:get", {
					chat: updatedChat as any,
					messages: (updatedChat as any).chatMessages || null
				})
			}

			const res: Sockets.Chats.AddPersona.Response = {
				success: true
			}
			emitToUser("chats:addPersona", res)
			return res
		} catch (error: any) {
			console.error("Error adding persona to chat:", error)
			const res: Sockets.Chats.AddPersona.Response = {
				success: false,
				error: "Failed to add persona to chat"
			}
			emitToUser("chats:addPersona:error", res)
			throw error
		}
	}
}

export const chatsAddGuestHandler: Handler<
	Sockets.Chats.AddGuest.Params,
	Sockets.Chats.AddGuest.Response
> = {
	event: "chats:addGuest",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { chatId, guestUserId } = params

			// Only chat owner can add guests
			const chatAccess = await checkChatAccess(chatId, userId)
			if (!chatAccess.isOwner) {
				const res: Sockets.Chats.AddGuest.Response = {
					success: false,
					error: "Access denied. Only chat owners can add guests."
				}
				emitToUser("chats:addGuest", res)
				return res
			}

			// Check if guest is already in the chat
			const existingGuest = await db.query.chatGuests.findFirst({
				where: and(
					eq(schema.chatGuests.chatId, chatId),
					eq(schema.chatGuests.userId, guestUserId)
				)
			})

			if (existingGuest) {
				const res: Sockets.Chats.AddGuest.Response = {
					success: false,
					error: "This user is already a guest in the chat."
				}
				emitToUser("chats:addGuest", res)
				return res
			}

			// Add guest to chat
			await db.insert(schema.chatGuests).values({
				chatId,
				userId: guestUserId,
				isPlayer: true
			})

			// Broadcast updated chat to all participants
			const updatedChat = await getChatFromDB(chatId, userId)
			if (updatedChat) {
				await broadcastToChatUsers(socket.io, chatId, "chats:get", {
					chat: updatedChat as any,
					messages: (updatedChat as any).chatMessages || null
				})
			}

			const res: Sockets.Chats.AddGuest.Response = {
				success: true
			}
			emitToUser("chats:addGuest", res)
			return res
		} catch (error: any) {
			console.error("Error adding guest to chat:", error)
			const res: Sockets.Chats.AddGuest.Response = {
				success: false,
				error: "Failed to add guest to chat"
			}
			emitToUser("chats:addGuest:error", res)
			throw error
		}
	}
}

export const chatsRemoveGuestHandler: Handler<
	Sockets.Chats.RemoveGuest.Params,
	Sockets.Chats.RemoveGuest.Response
> = {
	event: "chats:removeGuest",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { chatId, guestUserId } = params

			// Only chat owner can remove guests
			const chatAccess = await checkChatAccess(chatId, userId)
			if (!chatAccess.isOwner) {
				const res: Sockets.Chats.RemoveGuest.Response = {
					success: false,
					error: "Access denied. Only chat owners can remove guests."
				}
				emitToUser("chats:removeGuest", res)
				return res
			}

			// Remove guest from chat
			await db
				.delete(schema.chatGuests)
				.where(
					and(
						eq(schema.chatGuests.chatId, chatId),
						eq(schema.chatGuests.userId, guestUserId)
					)
				)

			// Broadcast updated chat to all remaining participants
			const updatedChat = await getChatFromDB(chatId, userId)
			if (updatedChat) {
				await broadcastToChatUsers(socket.io, chatId, "chats:get", {
					chat: updatedChat as any,
					messages: (updatedChat as any).chatMessages || null
				})
			}

			// Also notify the removed guest that they've been removed
			socket.io.to(`user_${guestUserId}`).emit("chats:removedAsGuest", {
				chatId
			})

			const res: Sockets.Chats.RemoveGuest.Response = {
				success: true
			}
			emitToUser("chats:removeGuest", res)
			return res
		} catch (error: any) {
			console.error("Error removing guest from chat:", error)
			const res: Sockets.Chats.RemoveGuest.Response = {
				success: false,
				error: "Failed to remove guest from chat"
			}
			emitToUser("chats:removeGuest:error", res)
			throw error
		}
	}
}

export const chatsBranchHandler: Handler<
	Sockets.Chats.Branch.Params,
	Sockets.Chats.Branch.Response
> = {
	event: "chats:branch",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { chatId, messageId, title } = params

			// Check if user has access to this chat
			const chatAccess = await checkChatAccess(chatId, userId)
			if (!chatAccess.hasAccess) {
				const res: Sockets.Chats.Branch.Response = {
					error: "Access denied. Chat not found or no permission to access."
				}
				emitToUser("chats:branch", res)
				return res
			}

			// Get the original chat with all relations
			const originalChat = await db.query.chats.findFirst({
				where: eq(schema.chats.id, chatId),
				with: {
					chatCharacters: {
						orderBy: asc(schema.chatCharacters.position)
					},
					chatPersonas: {
						orderBy: asc(schema.chatPersonas.position)
					},
					chatGuests: true,
					chatTags: true
				}
			})

			if (!originalChat) {
				const res: Sockets.Chats.Branch.Response = {
					error: "Original chat not found"
				}
				emitToUser("chats:branch", res)
				return res
			}

			// Verify the message exists and get its position
			const branchMessage = await db.query.chatMessages.findFirst({
				where: and(
					eq(schema.chatMessages.id, messageId),
					eq(schema.chatMessages.chatId, chatId)
				)
			})

			if (!branchMessage) {
				const res: Sockets.Chats.Branch.Response = {
					error: "Branch message not found"
				}
				emitToUser("chats:branch", res)
				return res
			}

			// Create the new chat with only the properties that exist in the schema
			const newChatData: InsertChat = {
				name: title,
				scenario: originalChat.scenario,
				userId: originalChat.userId,
				isGroup: originalChat.isGroup,
				groupReplyStrategy: originalChat.groupReplyStrategy,
				metadata: originalChat.metadata,
				lorebookId: originalChat.lorebookId
			}

			const [newChat] = await db
				.insert(schema.chats)
				.values(newChatData)
				.returning()

			// Copy chat characters
			for (const chatCharacter of (originalChat as any).chatCharacters) {
				await db.insert(schema.chatCharacters).values({
					chatId: newChat.id,
					characterId: chatCharacter.characterId,
					position: chatCharacter.position,
					isActive: chatCharacter.isActive,
					visibility: chatCharacter.visibility
				})
			}

			// Copy chat personas
			for (const chatPersona of (originalChat as any).chatPersonas) {
				await db.insert(schema.chatPersonas).values({
					chatId: newChat.id,
					personaId: chatPersona.personaId,
					position: chatPersona.position
				})
			}

			// Copy chat guests
			for (const chatGuest of (originalChat as any).chatGuests) {
				await db.insert(schema.chatGuests).values({
					chatId: newChat.id,
					userId: chatGuest.userId
				})
			}

			// Copy chat tags
			for (const chatTag of (originalChat as any).chatTags) {
				await db.insert(schema.chatTags).values({
					chatId: newChat.id,
					tagId: chatTag.tagId
				})
			}

			// Get all messages up to and including the branch message
			const allMessages = await db.query.chatMessages.findMany({
				where: eq(schema.chatMessages.chatId, chatId),
				orderBy: asc(schema.chatMessages.id)
			})

			// Filter messages up to and including the branch message
			const messagesToCopy = allMessages.filter(
				(msg) => msg.id <= messageId
			)

			// Copy messages
			for (const message of messagesToCopy) {
				const newMessageData: InsertChatMessage = {
					chatId: newChat.id,
					userId: message.userId,
					personaId: message.personaId,
					characterId: message.characterId,
					role: message.role,
					content: message.content,
					isHidden: message.isHidden,
					isGenerating: false, // Always set to false for copied messages
					metadata: message.metadata
				}

				await db.insert(schema.chatMessages).values(newMessageData)
			}

			// Fetch the complete new chat with messages
			const branchedChat = await getChatFromDB(newChat.id, userId)
			if (!branchedChat) {
				throw new Error("Failed to fetch branched chat")
			}

			// Refresh chat list
			await chatsListHandler.handler(socket, {}, emitToUser)

			const res: Sockets.Chats.Branch.Response = {
				chat: branchedChat as any
			}
			emitToUser("chats:branch", res)
			return res
		} catch (error: any) {
			console.error("Error branching chat:", error)
			const res: Sockets.Chats.Branch.Response = {
				error: "Failed to branch chat"
			}
			emitToUser("chats:branch:error", res)
			throw error
		}
	}
}

export const chatMessagesSendPersonaMessageHandler: Handler<
	Sockets.ChatMessages.SendPersonaMessage.Params,
	Sockets.ChatMessages.SendPersonaMessage.Response
> = {
	event: "chatMessages:sendPersonaMessage",
	handler: async (socket, params, emitToUser) => {
		try {
			const { chatId, personaId, content } = params
			const userId = socket.user!.id

			// Check if user has access to this chat (both owners and guests can send messages)
			const chatAccess = await checkChatAccess(chatId, userId)
			if (!chatAccess.hasAccess) {
				const res: Sockets.ChatMessages.SendPersonaMessage.Response = {
					chatMessage: undefined,
					error: "Access denied. Chat not found or no permission to access."
				}
				emitToUser("chatMessages:sendPersonaMessage", res)
				return res
			}

			// Check if user owns the persona they're trying to use
			if (personaId) {
				const canUsePersona = await checkPersonaOwnership(
					personaId,
					userId
				)
				if (!canUsePersona) {
					const res: Sockets.ChatMessages.SendPersonaMessage.Response =
						{
							chatMessage: undefined,
							error: "Access denied. You can only send messages with personas you own."
						}
					emitToUser("chatMessages:sendPersonaMessage", res)
					return res
				}
			}

			// Check if chat exists
			const chat = await getPromptChatFromDb(chatId, userId)
			if (!chat) {
				const res: Sockets.ChatMessages.SendPersonaMessage.Response = {
					chatMessage: undefined,
					error: "Chat not found"
				}
				emitToUser("chatMessages:sendPersonaMessage", res)
				return res
			}

			// Create the new message
			const newMessage: InsertChatMessage = {
				userId,
				chatId,
				personaId: personaId || null,
				role: "user",
				content
			}

			const [inserted] = await db
				.insert(schema.chatMessages)
				.values(newMessage)
				.returning()

			const res: Sockets.ChatMessages.SendPersonaMessage.Response = {
				chatMessage: inserted as any
			}
			emitToUser("chatMessages:sendPersonaMessage", res)

			// Broadcast chatMessage to all chat participants
			await broadcastToChatUsers(
				socket.io,
				inserted.chatId,
				"chatMessage",
				{ chatMessage: inserted }
			)

			// Check if this is effectively a 1-on-1 chat (only 1 active character)
			const activeCharacterCount = chat.chatCharacters.filter(
				(cc: any) => cc.isActive
			).length

			if (activeCharacterCount === 1) {
				console.log(
					`[sendPersonaMessage] Triggering single character response for 1:1 chat ${chatId} (${activeCharacterCount} active character)`
				)
				// Trigger character response generation
				await triggerGenerateMessageHandler.handler(
					socket,
					{ chatId, once: true },
					emitToUser
				)
			}

			return res
		} catch (error: any) {
			console.error("Error sending persona message:", error)
			const res: Sockets.ChatMessages.SendPersonaMessage.Response = {
				chatMessage: undefined,
				error: "Failed to send message"
			}
			emitToUser("chatMessages:sendPersonaMessage:error", res)
			throw error
		}
	}
}

export const chatMessagesUpdateHandler: Handler<
	Sockets.ChatMessages.Update.Params,
	Sockets.ChatMessages.Update.Response
> = {
	event: "chatMessages:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const { id, content, isHidden } = params
			const userId = socket.user!.id

			// Get the existing message to check metadata
			const [existingMessage] = await db
				.select()
				.from(schema.chatMessages)
				.where(
					and(
						eq(schema.chatMessages.id, id),
						eq(schema.chatMessages.userId, userId)
					)
				)

			if (!existingMessage) {
				const res: Sockets.ChatMessages.Update.Response = {
					chatMessage: undefined,
					error: "Message not found"
				}
				emitToUser("chatMessages:update", res)
				return res
			}

			// Build the update object dynamically
			const updates: Partial<typeof schema.chatMessages.$inferInsert> = {}
			if (content !== undefined) {
				updates.content = content
				// Content changed — clear the embedding so the vectorization queue re-embeds it
				updates.embedding = null
				updates.embeddingModel = null

				// Also update the swipe history if it exists
				const metadata = existingMessage.metadata as any
				if (
					metadata?.swipes?.history &&
					Array.isArray(metadata.swipes.history)
				) {
					const currentIdx = metadata.swipes.currentIdx ?? 0
					// Update the content in the swipes history at the current index
					const updatedHistory = [...metadata.swipes.history]
					if (currentIdx >= 0 && currentIdx < updatedHistory.length) {
						updatedHistory[currentIdx] = content
					}

					updates.metadata = {
						...metadata,
						swipes: {
							...metadata.swipes,
							history: updatedHistory
						}
					}
				}
			}
			if (isHidden !== undefined) updates.isHidden = isHidden

			// Update the message
			const [updated] = await db
				.update(schema.chatMessages)
				.set(updates)
				.where(
					and(
						eq(schema.chatMessages.id, id),
						eq(schema.chatMessages.userId, userId)
					)
				)
				.returning()

			if (!updated) {
				const res: Sockets.ChatMessages.Update.Response = {
					chatMessage: undefined,
					error: "Message not found"
				}
				emitToUser("chatMessages:update", res)
				return res
			}

			const res: Sockets.ChatMessages.Update.Response = {
				chatMessage: updated as any
			}
			emitToUser("chatMessages:update", res)

			// Broadcast chatMessage to all chat participants
			await broadcastToChatUsers(
				socket.io,
				updated.chatId,
				"chatMessage",
				{ chatMessage: updated }
			)

			return res
		} catch (error: any) {
			console.error("Error updating chat message:", error)
			const res: Sockets.ChatMessages.Update.Response = {
				chatMessage: undefined,
				error: "Failed to update message"
			}
			emitToUser("chatMessages:update:error", res)
			throw error
		}
	}
}

export const chatMessagesDeleteHandler: Handler<
	Sockets.ChatMessages.Delete.Params,
	Sockets.ChatMessages.Delete.Response
> = {
	event: "chatMessages:delete",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// First get the message to check permissions
			const message = await db.query.chatMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, params.id)
			})

			if (!message) {
				const res: Sockets.ChatMessages.Delete.Response = {
					error: "Message not found"
				}
				emitToUser("chatMessages:delete", res)
				return res
			}

			// Check if user can edit this message (based on message edit permissions)
			const canEdit = await checkMessageEditPermission(params.id, userId)
			if (!canEdit) {
				const res: Sockets.ChatMessages.Delete.Response = {
					error: "Access denied. You can only delete messages from your own characters/personas or if you own the chat."
				}
				emitToUser("chatMessages:delete", res)
				return res
			}

			// Delete the message
			await db
				.delete(schema.chatMessages)
				.where(eq(schema.chatMessages.id, params.id))

			const res: Sockets.ChatMessages.Delete.Response = {
				success: "Message deleted successfully"
			}
			emitToUser("chatMessages:delete", res)

			// Emit chats:get to refresh the entire chat after deletion
			await chatsGetHandler.handler(
				socket,
				{ id: message.chatId },
				emitToUser
			)

			return res
		} catch (error: any) {
			console.error("Error deleting chat message:", error)
			const res: Sockets.ChatMessages.Delete.Response = {
				error: "Failed to delete message"
			}
			emitToUser("chatMessages:delete:error", res)
			throw error
		}
	}
}

export const chatMessagesRegenerateHandler: Handler<
	Sockets.ChatMessages.Regenerate.Params,
	Sockets.ChatMessages.Regenerate.Response
> = {
	event: "chatMessages:regenerate",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Get the message to regenerate first
			const messageToRegenerate = await db.query.chatMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, params.id)
			})

			if (!messageToRegenerate) {
				const res: Sockets.ChatMessages.Regenerate.Response = {
					chatMessage: undefined,
					error: "Message not found"
				}
				emitToUser("chatMessages:regenerate", res)
				return res
			}

			// Check if user owns the chat (only chat owners can regenerate)
			const chatAccess = await checkChatAccess(
				messageToRegenerate.chatId,
				userId
			)
			if (!chatAccess.hasAccess || !chatAccess.isOwner) {
				const res: Sockets.ChatMessages.Regenerate.Response = {
					chatMessage: undefined,
					error: "Access denied. Only chat owners can regenerate messages."
				}
				emitToUser("chatMessages:regenerate", res)
				return res
			}

			// Get current metadata and clear function-calling related flags
			// BUT preserve the reasoning so it can be displayed with the final response
			const currentMetadata = (messageToRegenerate.metadata as any) || {}
			const cleanedMetadata = {
				...currentMetadata,
				waitingForFunctionSelection: undefined
				// Keep reasoning: it will be displayed in the pre-content section
			}

			// Clear the content, metadata flags, and set as generating
			const [updated] = await db
				.update(schema.chatMessages)
				.set({
					content: "",
					isGenerating: true,
					metadata: cleanedMetadata
				})
				.where(eq(schema.chatMessages.id, params.id))
				.returning()

			const res: Sockets.ChatMessages.Regenerate.Response = {
				chatMessage: updated as any
			}
			emitToUser("chatMessages:regenerate", res)

			// Broadcast chatMessage to all chat participants
			await broadcastToChatUsers(
				socket.io,
				updated.chatId,
				"chatMessage",
				{ chatMessage: updated }
			)

			// Start generating the response
			await generateResponse({
				socket,
				emitToUser,
				chatId: messageToRegenerate.chatId,
				userId,
				generatingMessage: updated as any
			})

			return res
		} catch (error: any) {
			console.error("Error regenerating chat message:", error)
			const res: Sockets.ChatMessages.Regenerate.Response = {
				chatMessage: undefined,
				error: "Failed to regenerate message"
			}
			emitToUser("chatMessages:regenerate:error", res)
			throw error
		}
	}
}

export const chatMessagesContinueHandler: Handler<
	Sockets.ChatMessages.Continue.Params,
	Sockets.ChatMessages.Continue.Response
> = {
	event: "chatMessages:continue",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Get the message to continue first
			const messageToContinue = await db.query.chatMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, params.id)
			})

			if (!messageToContinue) {
				const res: Sockets.ChatMessages.Continue.Response = {
					chatMessage: undefined,
					error: "Message not found"
				}
				emitToUser("chatMessages:continue", res)
				return res
			}

			// Check if user owns the chat (only chat owners can continue)
			const chatAccess = await checkChatAccess(
				messageToContinue.chatId,
				userId
			)
			if (!chatAccess.hasAccess || !chatAccess.isOwner) {
				const res: Sockets.ChatMessages.Continue.Response = {
					chatMessage: undefined,
					error: "Access denied. Only chat owners can continue messages."
				}
				emitToUser("chatMessages:continue", res)
				return res
			}

			// Get current metadata and preserve it
			const currentMetadata = (messageToContinue.metadata as any) || {}

			// Set as generating but KEEP existing content
			// The content will be used as a prefix in generateResponse
			const [updated] = await db
				.update(schema.chatMessages)
				.set({
					isGenerating: true,
					metadata: currentMetadata
				})
				.where(eq(schema.chatMessages.id, params.id))
				.returning()

			const res: Sockets.ChatMessages.Continue.Response = {
				chatMessage: updated as any
			}
			emitToUser("chatMessages:continue", res)

			// Broadcast chatMessage to all chat participants
			await broadcastToChatUsers(
				socket.io,
				updated.chatId,
				"chatMessage",
				{ chatMessage: updated }
			)

			// Start generating the response continuation
			await generateResponse({
				socket,
				emitToUser,
				chatId: messageToContinue.chatId,
				userId,
				generatingMessage: updated as any
			})

			return res
		} catch (error: any) {
			console.error("Error continuing chat message:", error)
			const res: Sockets.ChatMessages.Continue.Response = {
				chatMessage: undefined,
				error: "Failed to continue message"
			}
			emitToUser("chatMessages:continue:error", res)
			throw error
		}
	}
}

export const chatMessagesSwipeLeftHandler: Handler<
	Sockets.ChatMessages.SwipeLeft.Params,
	Sockets.ChatMessages.SwipeLeft.Response
> = {
	event: "chatMessages:swipeLeft",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Get the message first to check chat access
			const message = await db.query.chatMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, params.id)
			})

			if (!message) {
				const res: Sockets.ChatMessages.SwipeLeft.Response = {
					chatMessage: undefined,
					error: "Message not found"
				}
				emitToUser("chatMessages:swipeLeft", res)
				return res
			}

			if (message.isGenerating) {
				const res: Sockets.ChatMessages.SwipeLeft.Response = {
					chatMessage: undefined,
					error: "Message is still generating, please wait."
				}
				emitToUser("chatMessages:swipeLeft", res)
				return res
			}

			if (message.isHidden) {
				const res: Sockets.ChatMessages.SwipeLeft.Response = {
					chatMessage: undefined,
					error: "Message is hidden, cannot swipe left."
				}
				emitToUser("chatMessages:swipeLeft", res)
				return res
			}

			if (message.role !== "assistant") {
				const res: Sockets.ChatMessages.SwipeLeft.Response = {
					chatMessage: undefined,
					error: "Only assistant messages can be swiped."
				}
				emitToUser("chatMessages:swipeLeft", res)
				return res
			}

			// Check if user owns the chat (only chat owners can swipe)
			const chatAccess = await checkChatAccess(message.chatId, userId)
			if (!chatAccess.hasAccess || !chatAccess.isOwner) {
				const res: Sockets.ChatMessages.SwipeLeft.Response = {
					chatMessage: undefined,
					error: "Access denied. Only chat owners can swipe messages."
				}
				emitToUser("chatMessages:swipeLeft", res)
				return res
			}

			let isOnFirstSwipe = false

			// Check if metadata.swipes, if not, initialize it
			const data: SelectChatMessage = {
				...message,
				metadata: {
					...message.metadata,
					swipes: {
						currentIdx: null,
						history: [],
						...(message.metadata?.swipes || {})
					}
				}
			}

			// Check if we are on the first swipe (idx=0|null) (or if there are no swipes)
			if (
				!data.metadata!.swipes!.history.length ||
				data.metadata!.swipes!.currentIdx === null ||
				data.metadata!.swipes!.currentIdx === 0
			) {
				isOnFirstSwipe = true
			}

			// If we are on the first swipe, return an error
			if (isOnFirstSwipe) {
				const res: Sockets.ChatMessages.SwipeLeft.Response = {
					chatMessage: undefined,
					error: "Already on the first swipe, cannot swipe left."
				}
				emitToUser("chatMessages:swipeLeft", res)
				return res
			}

			// If not on the first swipe, update the current index and content
			data.metadata!.swipes!.currentIdx =
				(data.metadata!.swipes!.currentIdx || 0) - 1
			data.content =
				data.metadata!.swipes!.history[
					data.metadata!.swipes!.currentIdx
				] || ""
			// Sync active thinking to the new swipe slot
			data.metadata!.thinking =
				(data.metadata!.swipes!.thinkingHistory as any)?.[
					data.metadata!.swipes!.currentIdx
				] ?? null

			// Update the chat message in the database
			delete data.id
			const [updated] = await db
				.update(schema.chatMessages)
				.set({ ...data })
				.where(eq(schema.chatMessages.id, message.id))
				.returning()

			if (!updated) {
				const res: Sockets.ChatMessages.SwipeLeft.Response = {
					chatMessage: undefined,
					error: "Failed to update chat message."
				}
				emitToUser("chatMessages:swipeLeft", res)
				return res
			}

			const res: Sockets.ChatMessages.SwipeLeft.Response = {
				chatMessage: updated as any
			}
			emitToUser("chatMessages:swipeLeft", res)

			// Broadcast chatMessage to all chat participants
			await broadcastToChatUsers(
				socket.io,
				updated.chatId,
				"chatMessage",
				{ chatMessage: updated }
			)

			return res
		} catch (error: any) {
			console.error("Error swiping left chat message:", error)
			const res: Sockets.ChatMessages.SwipeLeft.Response = {
				chatMessage: undefined,
				error: "Failed to swipe left"
			}
			emitToUser("chatMessages:swipeLeft:error", res)
			throw error
		}
	}
}

export const chatMessagesSwipeRightHandler: Handler<
	Sockets.ChatMessages.SwipeRight.Params,
	Sockets.ChatMessages.SwipeRight.Response
> = {
	event: "chatMessages:swipeRight",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Get the message first to check chat access
			const message = await db.query.chatMessages.findFirst({
				where: (cm, { eq }) => eq(cm.id, params.id)
			})

			if (!message) {
				const res: Sockets.ChatMessages.SwipeRight.Response = {
					chatMessage: undefined,
					error: "Message not found"
				}
				emitToUser("chatMessages:swipeRight", res)
				return res
			}
			// Check if user owns the chat (only chat owners can swipe)
			const chatAccess = await checkChatAccess(message.chatId, userId)
			if (!chatAccess.hasAccess || !chatAccess.isOwner) {
				const res: Sockets.ChatMessages.SwipeRight.Response = {
					chatMessage: undefined,
					error: "Access denied. Only chat owners can swipe messages."
				}
				emitToUser("chatMessages:swipeRight", res)
				return res
			}

			let isOnLastSwipe = false

			// Check if metadata.swipes, if not, initialize it
			const data: SelectChatMessage = {
				...message,
				metadata: {
					...message.metadata,
					swipes: {
						currentIdx: null,
						history: [],
						...(message.metadata?.swipes || {})
					}
				}
			}

			// Check if we are on the last swipe (or if there are no swipes)
			if (
				!data.metadata!.swipes!.history.length ||
				data.metadata!.swipes!.currentIdx === null
			) {
				isOnLastSwipe = true
			} else {
				isOnLastSwipe =
					data.metadata!.swipes!.currentIdx ===
					data.metadata!.swipes!.history.length - 1
			}

			if (!isOnLastSwipe) {
				// If not on the last swipe, just update the current index and content
				data.metadata!.swipes!.currentIdx =
					(data.metadata!.swipes!.currentIdx || 0) + 1
				data.content =
					data.metadata!.swipes!.history[
						data.metadata!.swipes!.currentIdx
					] || ""
				// Sync active thinking to the new swipe slot
				data.metadata!.thinking =
					(data.metadata!.swipes!.thinkingHistory as any)?.[
						data.metadata!.swipes!.currentIdx
					] ?? null
			} else {
				if (data.metadata!.swipes!.currentIdx === null) {
					data.metadata!.swipes!.currentIdx = 0
					data.metadata!.swipes!.history.push(data.content)
					// Keep thinkingHistory in sync when initialising swipes for the first time
					const th: (string | null)[] =
						(data.metadata!.swipes! as any).thinkingHistory || []
					while (th.length < data.metadata!.swipes!.history.length) th.push(null)
					;(data.metadata!.swipes! as any).thinkingHistory = th
				}
				// Now increment the current index and push a new empty generation slot
				data.metadata!.swipes!.currentIdx += 1
				data.content = "" // Clear the message content
				data.isGenerating = true // Set generating state to true
				// Push the new empty content to history
				data.metadata!.swipes!.history.push("") // Add an empty string to history
				// Push a matching null into thinkingHistory to keep lengths equal
				const th: (string | null)[] =
					(data.metadata!.swipes! as any).thinkingHistory || []
				while (th.length < data.metadata!.swipes!.history.length - 1) th.push(null)
				th.push(null)
				;(data.metadata!.swipes! as any).thinkingHistory = th
				// Clear active thinking — new slot has no thinking yet
				data.metadata!.thinking = null
			}

			delete data.id

			// Update the chat message in the database
			const [updated] = await db
				.update(schema.chatMessages)
				.set({ ...data })
				.where(eq(schema.chatMessages.id, message.id))
				.returning()

			if (!updated) {
				const res: Sockets.ChatMessages.SwipeRight.Response = {
					chatMessage: undefined,
					error: "Failed to update chat message."
				}
				emitToUser("chatMessages:swipeRight", res)
				return res
			}

			const res: Sockets.ChatMessages.SwipeRight.Response = {
				chatMessage: updated as any
			}
			emitToUser("chatMessages:swipeRight", res)

			if (!updated.isGenerating) {
				// If the message is not generating, broadcast the updated chatMessage
				await broadcastToChatUsers(
					socket.io,
					updated.chatId,
					"chatMessage",
					{ chatMessage: updated }
				)
				return res
			}

			// If the message is generating, we need to start generating a response
			await broadcastToChatUsers(
				socket.io,
				updated.chatId,
				"chatMessage",
				{ chatMessage: updated }
			)

			await generateResponse({
				socket,
				emitToUser,
				chatId: message.chatId,
				userId,
				generatingMessage: updated as any
			})

			return res
		} catch (error: any) {
			console.error("Error swiping right chat message:", error)
			const res: Sockets.ChatMessages.SwipeRight.Response = {
				chatMessage: undefined,
				error: "Failed to swipe right"
			}
			emitToUser("chatMessages:swipeRight:error", res)
			throw error
		}
	}
}

export const chatsGetResponseOrderHandler: Handler<
	Sockets.Chats.GetResponseOrder.Params,
	Sockets.Chats.GetResponseOrder.Response
> = {
	event: "chats:getResponseOrder",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const chat = await getPromptChatFromDb(params.chatId, userId)

			if (!chat) {
				const res: Sockets.Chats.GetResponseOrder.Response = {
					chatId: params.chatId,
					nextCharacterId: null,
					characterIds: []
				}
				emitToUser("chats:getResponseOrder", res)
				return res
			}

			// Get next character turn using existing logic
			const nextCharacterId = getNextCharacterTurn(
				{
					chatMessages: chat.chatMessages,
					chatCharacters: chat.chatCharacters
						.filter((cc) => cc.character !== null && cc.isActive)
						.sort(
							(a, b) => (a.position ?? 0) - (b.position ?? 0)
						) as any,
					chatPersonas: chat.chatPersonas.filter(
						(cp) => cp.persona !== null
					) as any
				},
				{ triggered: false }
			)

			const res: Sockets.Chats.GetResponseOrder.Response = {
				chatId: params.chatId,
				nextCharacterId: nextCharacterId,
				characterIds: [] // Empty array for now, can be populated later if needed
			}
			emitToUser("chats:getResponseOrder", res)
			return res
		} catch (error: any) {
			console.error("Error getting chat response order:", error)
			const res: Sockets.Chats.GetResponseOrder.Response = {
				chatId: params.chatId,
				nextCharacterId: null,
				characterIds: []
			}
			emitToUser("chats:getResponseOrder", res)
			throw error
		}
	}
}

export const chatMessagesCancelHandler: Handler<
	Sockets.ChatMessages.Cancel.Params,
	Sockets.ChatMessages.Cancel.Response
> = {
	event: "chatMessages:cancel",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Find messages being generated for this chat
			const generatingMessages = await db.query.chatMessages.findMany({
				where: (cm, { and, eq }) =>
					and(
						eq(cm.chatId, params.chatId),
						eq(cm.isGenerating, true),
						eq(cm.userId, userId)
					)
			})

			// Stop generation for all messages in this chat
			for (const message of generatingMessages) {
				// If there's an active adapter, try to abort it FIRST
				if (message.adapterId) {
					const adapter = activeAdapters.get(message.adapterId)
					if (adapter) {
						try {
							adapter.abort()
							// Remove adapter from active adapters map
							activeAdapters.delete(message.adapterId)
						} catch (e) {
							// Silent fail for abort
							console.warn("Failed to abort adapter:", e)
						}
					}
				}

				// Then update the database
				await db
					.update(schema.chatMessages)
					.set({
						isGenerating: false,
						adapterId: null
					})
					.where(eq(schema.chatMessages.id, message.id))
			}

			const res: Sockets.ChatMessages.Cancel.Response = {
				success: `Cancelled ${generatingMessages.length} generating messages`
			}
			emitToUser("chatMessages:cancel", res)

			// Emit chats:get to refresh all messages after cancellation
			if (generatingMessages.length > 0) {
				await chatsGetHandler.handler(
					socket,
					{ id: params.chatId },
					emitToUser
				)
			}

			return res
		} catch (error: any) {
			console.error("Error cancelling chat messages:", error)
			const res: Sockets.ChatMessages.Cancel.Response = {
				error: "Failed to cancel messages"
			}
			emitToUser("chatMessages:cancel:error", res)
			throw error
		}
	}
}

export const chatMessageHandler: Handler<
	Sockets.ChatMessage.Call,
	Sockets.ChatMessage.Response
> = {
	event: "chatMessage",
	handler: async (socket, params, emitToUser) => {
		try {
			if (params.chatMessage) {
				// If chatMessage object is provided, emit it directly
				const res: Sockets.ChatMessage.Response = {
					chatMessage: params.chatMessage
				}
				emitToUser("chatMessage", res)
				return res
			} else if (params.id) {
				// If id is provided, fetch from database
				const chatMessage = await db.query.chatMessages.findFirst({
					where: (m, { eq }) => eq(m.id, params.id!)
				})
				if (!chatMessage) {
					const res: Sockets.ChatMessage.Response = {
						error: "Chat message not found."
					}
					emitToUser("chatMessage:error", res)
					throw new Error("Chat message not found")
				}
				const res: Sockets.ChatMessage.Response = { chatMessage }
				emitToUser("chatMessage", res)
				return res
			} else {
				const res: Sockets.ChatMessage.Response = {
					error: "Must provide either id or chatMessage."
				}
				emitToUser("chatMessage:error", res)
				throw new Error("Must provide either id or chatMessage")
			}
		} catch (error: any) {
			console.error("Error in chatMessage handler:", error)
			const res: Sockets.ChatMessage.Response = {
				error: "Failed to get chat message"
			}
			emitToUser("chatMessage:error", res)
			throw error
		}
	}
}

export async function chatMessage(
	socket: any,
	message: Sockets.ChatMessage.Call,
	emitToUser: (event: string, data: any) => void
) {
	if (message.chatMessage) {
		// If chatMessage object is provided, emit it directly
		const res: Sockets.ChatMessage.Response = {
			chatMessage: message.chatMessage
		}
		emitToUser("chatMessage", res)
		return
	} else if (message.id) {
		// If id is provided, fetch from database
		const chatMessage = await db.query.chatMessages.findFirst({
			where: (m, { eq }) => eq(m.id, message.id!)
		})
		if (!chatMessage) {
			emitToUser("error", { error: "Chat message not found." })
			return
		}
		const res: Sockets.ChatMessage.Response = { chatMessage }
		emitToUser("chatMessage", res)
		return
	} else {
		emitToUser("error", { error: "Must provide either id or chatMessage." })
	}
}

// Builds the chatMessage history for the first chat message of a character, with history swipes for the user to choose from
function buildCharacterFirstChatMessage({
	character,
	persona,
	isGroup
}: {
	character: SelectCharacter
	persona: SelectPersona | undefined | null
	isGroup: boolean
}): string[] {
	if (dev) {
		console.log(
			"Building first chat message for character:",
			character.name,
			"with persona:",
			persona?.name
		)
	}
	const history: string[] = []
	const engine = new InterpolationEngine()
	const context = engine.createInterpolationContext({
		currentCharacterName: character.nickname || character.name,
		currentPersonaName: persona?.name || "User"
	})
	if (dev) {
		console.log("Interpolation context:", context)
	}
	if (!isGroup || !character.groupOnlyGreetings?.length) {
		if (character.firstMessage) {
			const interpolated = engine.interpolateString(
				character.firstMessage.trim(),
				context
			)!
			if (dev) {
				console.log(
					"Interpolated firstMessage:",
					character.firstMessage.trim(),
					"->",
					interpolated
				)
			}
			history.push(interpolated)
		}
		if (character.alternateGreetings) {
			history.push(
				...character.alternateGreetings.map((g) => {
					const interpolated = engine.interpolateString(
						g.trim(),
						context
					)!
					if (dev) {
						console.log(
							"Interpolated alternateGreeting:",
							g.trim(),
							"->",
							interpolated
						)
					}
					return interpolated
				})
			)
		}
	} else if (character.groupOnlyGreetings?.length) {
		// If this is a group chat, use only group greetings
		history.push(
			...character.groupOnlyGreetings.map((g) => {
				const interpolated = engine.interpolateString(
					g.trim(),
					context
				)!
				if (dev) {
					console.log(
						"Interpolated groupOnlyGreeting:",
						g.trim(),
						"->",
						interpolated
					)
				}
				return interpolated
			})
		)
	} else {
		// Fallback firstMessage if no greetings are available
		history.push(
			`Sits down at the table, "I didn't think you'd show up so soon."`
		)
	}
	return history
}

// =============================================
// TYPE-SAFE CHAT HANDLERS
// =============================================

/**
 * Type-safe handler for calculating prompt token count
 */
export const promptTokenCountHandler: Handler<
	Sockets.Chats.PromptTokenCount.Params,
	Sockets.Chats.PromptTokenCount.Response
> = {
	event: "chats:promptTokenCount",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// // Only admin users can get prompt token count
			// if (!socket.user!.isAdmin) {
			// 	return {
			// 		error: "Access denied. Only admin users can get prompt token count."
			// 	}
			// }

			// Check if user has access to this chat
			const chatAccess = await checkChatAccess(params.chatId, userId)
			if (!chatAccess.hasAccess) {
				return {
					error: "Access denied. Chat not found or no permission to access."
				}
			}

			const chat = await getPromptChatFromDb(params.chatId, userId)
			if (!chat) {
				return {
					error: "Error Generating Prompt Token Count: Chat not found."
				}
			}

			const user = await db.query.users.findFirst({
				where: (u, { eq }) => eq(u.id, userId)
			})

			// Get system-default configurations with fallbacks
			let { connection, sampling, contextConfig, promptConfig } =
				await getUserConfigurations(userId)

			// Apply per-chat connection/sampling overrides when set
			if ((chat as any).connectionId) {
				const chatConnection = await db.query.connections.findFirst({
					where: (c, { eq }) => eq(c.id, (chat as any).connectionId)
				})
				if (chatConnection) connection = chatConnection
			}
			if ((chat as any).samplingConfigId) {
				const chatSampling = await db.query.samplingConfigs.findFirst({
					where: (sc, { eq }) => eq(sc.id, (chat as any).samplingConfigId)
				})
				if (chatSampling) sampling = chatSampling
			}

			if (!connection) {
				return {
					error: "No AI connection configured. Please set up a connection first."
				}
			}

			if (!chat || !user) {
				return {
					error: "Incomplete configuration, failed to calculate token count."
				}
			}

			let chatForPrompt = {
				...chat,
				chatMessages: [...chat.chatMessages]
			}

			const currentCharacterId = getNextCharacterTurn(
				{
					chatMessages: chat.chatMessages,
					chatCharacters: chat.chatCharacters
						.filter(
							(cc: any) =>
								cc && cc.character != null && cc.isActive
						)
						.sort(
							(a, b) => (a.position ?? 0) - (b.position ?? 0)
						) as any,
					chatPersonas: chat.chatPersonas.filter(
						(cp: any) => cp && cp.persona != null
					) as any
				},
				{ triggered: true }
			)

			if (!currentCharacterId) {
				return { error: "No character available for prompt." }
			}

			const { Adapter } = getConnectionAdapter(connection.type)

			const tokenCounter = new TokenCounters((connection as any).tokenCounter || TokenCounterOptions.ESTIMATE)
			const contextThresholdPercent = 0.8

			const adapter = new Adapter({
				chat: chatForPrompt,
				connection: connection,
				sampling: sampling,
				contextConfig: contextConfig,
				promptConfig: promptConfig,
				currentCharacterId,
				tokenCounter,
				tokenLimit: 4096,
				contextThresholdPercent
			})

			const promptResult = await adapter.compilePrompt({})

			// Return the compiled prompt in the correct format
			emitToUser("chats:promptTokenCount", promptResult)
			return promptResult
		} catch (error) {
			console.error("Error in promptTokenCountHandler:", error)
			return {
				error: "Failed to calculate prompt token count."
			}
		}
	}
}

/**
 * Type-safe handler for triggering message generation
 */
export const triggerGenerateMessageHandler: Handler<
	Sockets.Chats.TriggerGenerateMessage.Params,
	Sockets.Chats.TriggerGenerateMessage.Response
> = {
	event: "chats:triggerGenerateMessage",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const msgLimit = 10
			let currentMsg = 1
			let triggered =
				params.triggered !== undefined ? params.triggered : false
			let ok = true

			console.log(
				`[triggerGenerateMessage] Starting generation for chat ${params.chatId}, once: ${params.once}, characterId: ${params.characterId}, triggered: ${triggered}`
			)

			while (currentMsg <= msgLimit && ok) {
				let chat = await getPromptChatFromDb(params.chatId, userId)
				if (!chat) {
					return {
						error: "Error Triggering Chat Message: Chat not found."
					}
				}

				// Check if there are any ongoing generations before starting a new one
				const hasGeneratingMessages = chat.chatMessages.some(
					(msg) => msg.isGenerating
				)
				if (hasGeneratingMessages) {
					console.log(
						"Generation already in progress, stopping trigger loop"
					)
					break
				}

				// Get active characters
				const activeCharacters = chat.chatCharacters.filter(
					(cc) => cc.character !== null && cc.isActive
				)

				// Find the next character who should reply
				const nextCharacterId =
					params.characterId ||
					getNextCharacterTurn(
						{
							chatMessages: chat.chatMessages,
							chatCharacters: activeCharacters.sort(
								(a, b) => (a.position ?? 0) - (b.position ?? 0)
							) as any,
							chatPersonas: chat.chatPersonas.filter(
								(cp) => cp.persona !== null
							) as any
						},
						{ triggered }
					)

				// Check if this is a triggered response when all characters have already responded
				if (triggered && nextCharacterId) {
					// Check with triggered: false to see if any character needs a normal turn
					const normalTurnCharacterId = getNextCharacterTurn(
						{
							chatMessages: chat.chatMessages,
							chatCharacters: activeCharacters.sort(
								(a, b) => (a.position ?? 0) - (b.position ?? 0)
							) as any,
							chatPersonas: chat.chatPersonas.filter(
								(cp) => cp.persona !== null
							) as any
						},
						{ triggered: false }
					)

					if (!normalTurnCharacterId) {
						// All characters have had their normal turn
						// For triggered mode, we should only generate ONE response
						console.log(
							`[triggerGenerateMessage] Triggered mode: All characters have responded, allowing ONE triggered response`
						)

						// After generating this ONE message, we need to ensure the loop stops
						// We'll do this by setting params.once = true for triggered responses
						if (!params.once) {
							params.once = true
							console.log(
								`[triggerGenerateMessage] Setting once=true to prevent triggered response loop`
							)
						}
					} else {
						// Some characters still need their normal turn
						console.log(
							`[triggerGenerateMessage] Normal turn mode: Character ${normalTurnCharacterId} needs to respond`
						)
					}
				}

				if (!nextCharacterId) {
					break
				}

				if (chat && chat.chatCharacters.length > 0 && nextCharacterId) {
					const nextCharacter = chat.chatCharacters.find(
						(cc) =>
							cc.character && cc.character.id === nextCharacterId
					)
					if (!nextCharacter || !nextCharacter.character) break

					const assistantMessage: InsertChatMessage = {
						userId,
						chatId: params.chatId,
						personaId: null,
						characterId: nextCharacter.character.id,
						content: "",
						role: "assistant",
						isGenerating: true
					}

					const [generatingMessage] = await db
						.insert(schema.chatMessages)
						.values(assistantMessage)
						.returning()

					if (emitToUser) {
						await broadcastToChatUsers(
							socket.io,
							generatingMessage.chatId,
							"chatMessage",
							{ chatMessage: generatingMessage }
						)
						// chatMessage was already broadcasted above, no need for duplicate emission
					}

					ok = await generateResponse({
						socket,
						emitToUser,
						chatId: params.chatId,
						userId,
						generatingMessage: generatingMessage as any
					})

					// If generation was aborted, stop the loop
					if (!ok) {
						console.log(
							"Generation was aborted, stopping trigger loop"
						)
						break
					}

					console.log(
						`[triggerGenerateMessage] Message ${currentMsg}/${msgLimit} generated successfully=${ok}, once: ${params.once}`
					)
				}

				// If once is true, exit after the first message
				if (params.once) {
					// Re-fetch chat to get updated message list
					const updatedChat = await getPromptChatFromDb(
						params.chatId,
						userId
					)
					if (!updatedChat) break

					// Check if we're in triggered mode with all characters having responded
					const updatedActiveCharacters =
						updatedChat.chatCharacters.filter(
							(cc) => cc.character !== null && cc.isActive
						)
					const normalTurnCharacterId = getNextCharacterTurn(
						{
							chatMessages: updatedChat.chatMessages,
							chatCharacters: updatedActiveCharacters.sort(
								(a, b) => (a.position ?? 0) - (b.position ?? 0)
							) as any,
							chatPersonas: updatedChat.chatPersonas.filter(
								(cp) => cp.persona !== null
							) as any
						},
						{ triggered: false }
					)

					if (triggered && !normalTurnCharacterId) {
						// In triggered mode with all characters responded - stop after one
						console.log(
							`[triggerGenerateMessage] Breaking loop due to once=true in triggered mode`
						)
						break
					} else if (!triggered) {
						// In normal mode with once=true - also stop after one
						console.log(
							`[triggerGenerateMessage] Breaking loop due to once=true parameter`
						)
						break
					}
					// Otherwise, continue to let all characters take their normal turn
				}

				currentMsg++
			}

			return { success: true }
		} catch (error) {
			console.error("Error in triggerGenerateMessageHandler:", error)
			return {
				error: "Failed to trigger message generation."
			}
		}
	}
}

/**
 * Type-safe handler for toggling chat character active status
 */
export const toggleChatCharacterActiveHandler: Handler<
	Sockets.Chats.ToggleChatCharacterActive.Params,
	Sockets.Chats.ToggleChatCharacterActive.Response
> = {
	event: "chats:toggleChatCharacterActive",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			const chat = await db.query.chats.findFirst({
				where: (c, { eq, and }) =>
					and(eq(c.id, params.chatId), eq(c.userId, userId)),
				with: {
					chatCharacters: {
						where: (cc, { eq }) =>
							eq(cc.characterId, params.characterId)
					}
				}
			})

			if (!chat) {
				return {
					chatId: params.chatId,
					characterId: params.characterId,
					isActive: false,
					error: "Error toggling character active: Chat not found."
				}
			}

			if (!chat.chatCharacters || chat.chatCharacters.length === 0) {
				return {
					chatId: params.chatId,
					characterId: params.characterId,
					isActive: false,
					error: "Chat character not found."
				}
			}

			const chatCharacter = chat.chatCharacters[0]
			const newActiveStatus = !chatCharacter.isActive

			await db
				.update(schema.chatCharacters)
				.set({ isActive: newActiveStatus })
				.where(
					and(
						eq(
							schema.chatCharacters.characterId,
							params.characterId
						),
						eq(schema.chatCharacters.chatId, params.chatId)
					)
				)

			// Refresh chat data
			if (emitToUser) {
				await getChat(socket, { id: chat.id }, emitToUser)
			}

			return {
				chatId: params.chatId,
				characterId: params.characterId,
				isActive: newActiveStatus
			}
		} catch (error) {
			console.error("Error in toggleChatCharacterActiveHandler:", error)
			return {
				chatId: params.chatId,
				characterId: params.characterId,
				isActive: false,
				error: "Failed to toggle character active status."
			}
		}
	}
}

/**
 * Type-safe handler for updating chat character visibility
 */
export const updateChatCharacterVisibilityHandler: Handler<
	Sockets.Chats.UpdateChatCharacterVisibility.Params,
	Sockets.Chats.UpdateChatCharacterVisibility.Response
> = {
	event: "chats:updateChatCharacterVisibility",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			const chat = await db.query.chats.findFirst({
				where: (c, { eq, and }) =>
					and(eq(c.id, params.chatId), eq(c.userId, userId)),
				with: {
					chatCharacters: {
						where: (cc, { eq }) =>
							eq(cc.characterId, params.characterId)
					}
				}
			})

			if (!chat) {
				return {
					chatId: params.chatId,
					characterId: params.characterId,
					visibility: params.visibility,
					error: "Error updating character visibility: Chat not found."
				}
			}

			if (!chat.chatCharacters || chat.chatCharacters.length === 0) {
				return {
					chatId: params.chatId,
					characterId: params.characterId,
					visibility: params.visibility,
					error: "Chat character not found."
				}
			}

			// Update visibility in database
			await db
				.update(schema.chatCharacters)
				.set({ visibility: params.visibility })
				.where(
					and(
						eq(
							schema.chatCharacters.characterId,
							params.characterId
						),
						eq(schema.chatCharacters.chatId, params.chatId)
					)
				)

			// Refresh chat data
			if (emitToUser) {
				await getChat(socket, { id: chat.id }, emitToUser)
			}

			return {
				chatId: params.chatId,
				characterId: params.characterId,
				visibility: params.visibility
			}
		} catch (error) {
			console.error(
				"Error in updateChatCharacterVisibilityHandler:",
				error
			)
			return {
				chatId: params.chatId,
				characterId: params.characterId,
				visibility: params.visibility,
				error: "Failed to update character visibility."
			}
		}
	}
}

/**
 * Handler for saving a character draft to the database
 */
export const assistantSaveDraftHandler: Handler<
	{ chatId: number },
	{ success: boolean; characterId?: number; error?: string }
> = {
	event: "assistant:saveDraft",
	description: "Save character draft from chat metadata to characters table",
	async handler(data, { socket, userId, emitToUser }) {
		try {
			const { chatId } = data

			// Get the chat
			const chat = await db.query.chats.findFirst({
				where: and(
					eq(schema.chats.id, chatId),
					eq(schema.chats.ownerId, userId)
				)
			})

			if (!chat) {
				throw new Error("Chat not found or access denied")
			}

			// Get the draft from metadata (now a JSON column)
			const metadata = chat.metadata || {}

			const draft = metadata?.dataEditor?.create?.characters?.[0]

			if (!draft) {
				throw new Error("No character draft found in chat metadata")
			}

			// Validate the draft one final time
			const { assistantCreateCharacterSchema } = await import(
				"$lib/server/db/zodSchemas"
			)
			const validationResult =
				assistantCreateCharacterSchema.safeParse(draft)

			if (!validationResult.success) {
				console.error(
					"Draft validation failed:",
					validationResult.error
				)
				return {
					success: false,
					error: "Draft validation failed. Please review the errors."
				}
			}

			// Create the character
			const [newCharacter] = await db
				.insert(schema.characters)
				.values({
					name: draft.name,
					description: draft.description,
					nickname: draft.nickname || null,
					personality: draft.personality || null,
					scenario: draft.scenario || null,
					firstMessage: draft.firstMessage || null,
					alternateGreetings: draft.alternateGreetings || null,
					exampleDialogues: draft.exampleDialogues || null,
					creatorNotes: draft.creatorNotes || null,
					groupOnlyGreetings: draft.groupOnlyGreetings || null,
					postHistoryInstructions:
						draft.postHistoryInstructions || null,
					source: draft.source || null,
					characterVersion: draft.characterVersion || null,
					ownerId: userId,
					favorite: false
				})
				.returning()

			console.log("Character created from draft:", newCharacter.id)

			// Link the character to the chat
			await db.insert(schema.chatsToCharacters).values({
				chatId,
				characterId: newCharacter.id,
				isActive: true,
				isVisible: true
			})

			// Clear the draft from metadata
			const updatedMetadata = {
				...metadata,
				dataEditor: {
					...metadata.dataEditor,
					create: {
						...metadata.dataEditor?.create,
						characters: []
					}
				}
			}

			await db
				.update(schema.chats)
				.set({ metadata: updatedMetadata })
				.where(eq(schema.chats.id, chatId))

			console.log("Draft cleared from chat metadata")

			// Emit success event
			emitToUser("assistant:draftSaved", {
				chatId,
				characterId: newCharacter.id,
				character: newCharacter
			})

			// Reload the chat to show the new character
			socket.emit("chats:get", { id: chatId })

			return {
				success: true,
				characterId: newCharacter.id
			}
		} catch (error) {
			console.error("Error saving draft:", error)
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to save character draft"
			}
		}
	}
}

// Registration function for all chat handlers
export function registerChatHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, chatsListHandler, emitToUser)
	register(socket, chatsCreateHandler, emitToUser)
	register(socket, chatsDeleteHandler, emitToUser)
	register(socket, chatsGetHandler, emitToUser)
	register(socket, chatsSaveDraftHandler, emitToUser)
	register(socket, chatsUpdateHandler, emitToUser)
	register(socket, chatsAddPersonaHandler, emitToUser)
	register(socket, chatsAddGuestHandler, emitToUser)
	register(socket, chatsRemoveGuestHandler, emitToUser)
	register(socket, chatsBranchHandler, emitToUser)
	register(socket, chatMessagesSendPersonaMessageHandler, emitToUser)
	register(socket, chatMessagesUpdateHandler, emitToUser)
	register(socket, chatMessagesDeleteHandler, emitToUser)
	register(socket, chatMessagesRegenerateHandler, emitToUser)
	register(socket, chatMessagesContinueHandler, emitToUser)
	register(socket, chatMessagesSwipeLeftHandler, emitToUser)
	register(socket, chatMessagesSwipeRightHandler, emitToUser)
	register(socket, chatsGetResponseOrderHandler, emitToUser)
	register(socket, chatMessagesCancelHandler, emitToUser)
	register(socket, chatMessageHandler, emitToUser)
	register(socket, promptTokenCountHandler, emitToUser)
	register(socket, triggerGenerateMessageHandler, emitToUser)
	register(socket, toggleChatCharacterActiveHandler, emitToUser)
	register(socket, updateChatCharacterVisibilityHandler, emitToUser)
	register(socket, assistantSaveDraftHandler, emitToUser)
}
