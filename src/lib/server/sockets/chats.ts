import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, asc, count, desc, eq, inArray, isNull, lt, or } from "drizzle-orm"
import {
	syncLorebookBindingsForCharacter,
	syncLorebookBindingsForPersona
} from "$lib/server/utils/characterBindingSync"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import { generateResponse } from "../utils/generateResponse"
import { getNextCharacterTurn } from "$lib/server/utils/getNextCharacterTurn"
import { getConnectionAdapter } from "../utils/getConnectionAdapter"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"
import { ChatCharacterVisibility } from "$lib/shared/constants/ChatCharacterVisibility"
import { InterpolationEngine } from "../utils/promptBuilder"
import { dev } from "$app/environment"
import type { Handler } from "$lib/shared/events"
import { getUserConfigurations } from "../utils/getUserConfigurations"
import { resolveTaskConfig } from "../utils/resolveTaskConfig"
import { resolveNarratorPromptConfig } from "../utils/resolveNarratorPromptConfig"
import { llmQueue } from "../utils/llmQueue"
import {
	broadcastToChatUsers,
	createChatBroadcaster
} from "./utils/broadcastHelpers"
import { checkChatAccess } from "$lib/server/utils/chatAccess"
import {
	resolveCharacterName,
	resolvePersonaName
} from "$lib/shared/utils/resolveCharacterName"
import { withChatTriggerLock } from "$lib/server/utils/chatTriggerLock"
import { findOrCreateTagId } from "$lib/server/utils/tags"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import type { PgliteDatabase, PgliteTransaction } from "drizzle-orm/pglite"

type Executor =
	| PgliteDatabase<typeof schema>
	| PgliteTransaction<
			typeof schema,
			ExtractTablesWithRelations<typeof schema>
	  >
import {
	MAX_CHAT_MESSAGE_LENGTH,
	MAX_NARRATOR_INSTRUCTIONS_LENGTH
} from "$lib/shared/constants/MessageLimits"

// ===== SECURITY HELPERS =====

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
 * Batch version of checkCharacterOwnership — returns the subset of the given
 * ids actually owned by userId. Used to validate newly-added chatCharacters
 * without an ownership query per id.
 */
async function checkCharactersOwnership(
	characterIds: number[],
	userId: number
): Promise<Set<number>> {
	if (characterIds.length === 0) return new Set()
	const owned = await db.query.characters.findMany({
		where: (c, { and, eq, inArray }) =>
			and(inArray(c.id, characterIds), eq(c.userId, userId)),
		columns: { id: true }
	})
	return new Set(owned.map((c) => c.id))
}

/**
 * Batch version of checkPersonaOwnership.
 */
async function checkPersonasOwnership(
	personaIds: number[],
	userId: number
): Promise<Set<number>> {
	if (personaIds.length === 0) return new Set()
	const owned = await db.query.personas.findMany({
		where: (p, { and, eq, inArray }) =>
			and(inArray(p.id, personaIds), eq(p.userId, userId)),
		columns: { id: true }
	})
	return new Set(owned.map((p) => p.id))
}

/**
 * lorebooks is a strictly per-user table — a chat's lorebookId must belong
 * to the requesting user, or a chat could pull another user's private
 * lore into its prompts and its binding-sync writes.
 */
async function checkLorebookOwnership(
	lorebookId: number,
	userId: number
): Promise<boolean> {
	const lorebook = await db.query.lorebooks.findFirst({
		where: (l, { and, eq }) => and(eq(l.id, lorebookId), eq(l.userId, userId)),
		columns: { id: true }
	})
	return !!lorebook
}

/**
 * Check if user can edit/swipe/regenerate a chat message.
 * - Persona messages: only the owner of that specific persona — NOT even the
 *   chat owner, since a persona is another participant's own
 *   self-representation in the chat, not something the chat owner controls.
 * - Character messages: the chat owner (broad control over the shared "AI"
 *   character outputs) OR whoever owns that specific character (so a guest
 *   who brought their own character into the chat can edit/swipe its
 *   messages too).
 */
async function checkMessageEditPermission(
	messageId: number,
	userId: number
): Promise<boolean> {
	const message = await db.query.chatMessages.findFirst({
		where: eq(schema.chatMessages.id, messageId),
		columns: {
			chatId: true,
			characterId: true,
			personaId: true,
			isNarratorResponse: true
		}
	})

	if (!message) return false

	const chatAccess = await checkChatAccess(message.chatId, userId)
	if (!chatAccess.hasAccess) return false

	if (message.personaId) {
		return await checkPersonaOwnership(message.personaId, userId)
	}

	if (message.characterId) {
		if (chatAccess.isOwner) return true
		return await checkCharacterOwnership(message.characterId, userId)
	}

	// Narrator response messages aren't owned by any persona/character — only
	// the chat owner controls them (nobody guest-owns "the narrator").
	if (message.isNarratorResponse) return chatAccess.isOwner

	return false
}

// Helper function to process tags for chat creation/update
async function processChatTags(
	chatId: number,
	tagNames: string[],
	userId: number,
	dbOrTx: Executor = db
) {
	// Get existing tags for this chat that belong to the user
	const existingChatTags = await dbOrTx.query.chatTags.findMany({
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
		await dbOrTx
			.delete(schema.chatTags)
			.where(
				and(
					eq(schema.chatTags.chatId, chatId),
					inArray(schema.chatTags.tagId, tagIdsToRemove)
				)
			)
	}

	// Add new tags — findOrCreateTagId adopts an existing case-insensitive
	// match instead of duplicating it (tags_user_id_name_unique).
	for (const tagName of tagsToAdd) {
		const tagId = await findOrCreateTagId(userId, tagName, dbOrTx)
		if (tagId == null) continue

		// Link tag to chat
		await dbOrTx
			.insert(schema.chatTags)
			.values({
				chatId,
				tagId
			})
			.onConflictDoNothing()
	}
}

/**
 * The actual chats:list query, pulled out of the handler below so it can be
 * called for a user who isn't the current socket's own caller — e.g. pushing
 * a fresh list to a user who was just added/removed as a guest by someone
 * else's request. Reusing chatsListHandler.handler itself for that would
 * mean building a synthetic socket/emitToUser standing in for a real caller,
 * which only works until the handler ever reads something else off socket
 * (auth context, query params) — an invisible break at that point. This way
 * there's nothing to keep honest: both call sites just call a plain function
 * and emit the result themselves.
 */
async function buildChatsListFor(
	userId: number
): Promise<Sockets.Chats.List.Response> {
	// chats:list only returns ROLEPLAY chats
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

		const chatsList = await db.query.chats.findMany({
			with: {
				chatCharacters: {
					with: {
						// `character` columns are limited to id/name/avatar — no
						// shortDescription/visibility column exists on the
						// characters table (visibility lives on chatCharacters
						// itself, included automatically alongside this relation).
						character: {
							columns: {
								id: true,
								name: true,
								avatar: true
							}
						}
					},
					orderBy: asc(schema.chatCharacters.position)
				},
				chatPersonas: {
					with: {
						// Same trimmed subset as `character` above — no
						// shortDescription/visibility column exists on personas.
						persona: {
							columns: {
								id: true,
								name: true,
								avatar: true
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
			// Build the where clause: user owns the chat OR user is a guest in
			// the chat, AND filter by chat type. Inlined (rather than a
			// standalone const) so drizzle's contextual typing can infer the
			// callback's parameter types.
			where: (c, { or, eq, inArray, and }) =>
				guestChatIds.length > 0
					? and(
							or(
								eq(c.userId, userId),
								inArray(c.id, guestChatIds)
							),
							eq(c.chatType, chatType)
						)
					: and(eq(c.userId, userId), eq(c.chatType, chatType)),
			orderBy: desc(schema.chats.updatedAt)
		})

		// isOwner/isGuest let the client show the right menu affordances:
		// owners get full edit + delete, guests get a scoped edit (characters/
		// personas/guests only — enforced server-side in chatsUpdateHandler,
		// not just hidden client-side). canEdit kept for back-compat meaning
		// "can open the edit menu at all" (owner or guest), not "owns the chat".
		const chatsWithEditPermission = chatsList.map((chat) => {
			const isOwner = chat.userId === userId
			const isGuest = !isOwner && guestChatIds.includes(chat.id)
			return {
				...chat,
				isOwner,
				isGuest,
				canEdit: isOwner || isGuest,
				// chatCharacters/chatPersonas rows can have a null character/
				// persona when the linked row was deleted (the FK is nullable,
				// onDelete: "set null") — filter those out, matching the same
				// fix in generateResponse.ts.
				chatCharacters: chat.chatCharacters.filter(
					(
						cc
					): cc is typeof cc & {
						character: NonNullable<typeof cc.character>
					} => cc.character !== null
				),
				chatPersonas: chat.chatPersonas.filter(
					(
						cp
					): cp is typeof cp & {
						persona: NonNullable<typeof cp.persona>
					} => cp.persona !== null
				)
			}
		})

	return { chatList: chatsWithEditPermission }
}

export const chatsListHandler: Handler<
	Sockets.Chats.List.Params,
	Sockets.Chats.List.Response
> = {
	event: "chats:list",
	async handler(socket, params, emitToUser) {
		const response = await buildChatsListFor(socket.user!.id)
		emitToUser("chats:list", response)
		return response
	}
}

export const chatsTypingHandler: Handler<
	Sockets.Chats.Typing.Params,
	Sockets.Chats.Typing.Response
> = {
	event: "chats:typing",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const chatAccess = await checkChatAccess(params.chatId, userId)
		if (!chatAccess.hasAccess) {
			const res: Sockets.Chats.Typing.Response = { success: false }
			return res
		}

		const persona = await db.query.personas.findFirst({
			where: eq(schema.personas.id, params.personaId),
			columns: { id: true, name: true }
		})
		if (!persona) {
			const res: Sockets.Chats.Typing.Response = { success: false }
			return res
		}

		// Fire-and-forget broadcast — receiving clients own their own 10s
		// expiry, so there's no matching "stopped typing" event to send.
		await broadcastToChatUsers(
			socket.io,
			params.chatId,
			"chats:userTyping",
			{
				chatId: params.chatId,
				personaId: persona.id,
				personaName: persona.name
			} satisfies Sockets.Chats.UserTyping.Response
		)

		const res: Sockets.Chats.Typing.Response = { success: true }
		return res
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

		// A new chat has no existing characters/personas to diff against — every
		// id supplied here must belong to the requesting user.
		if (characterIds.length > 0) {
			const ownedCharacterIds = await checkCharactersOwnership(
				characterIds,
				userId
			)
			if (ownedCharacterIds.size !== characterIds.length) {
				throw new Error(
					"Access denied. You can only add characters you own."
				)
			}
		}
		if (personaIds.length > 0) {
			const ownedPersonaIds = await checkPersonasOwnership(
				personaIds,
				userId
			)
			if (ownedPersonaIds.size !== personaIds.length) {
				throw new Error(
					"Access denied. You can only add personas you own."
				)
			}
		}
		if (params.chat.lorebookId != null) {
			const ownsLorebook = await checkLorebookOwnership(
				params.chat.lorebookId,
				userId
			)
			if (!ownsLorebook) {
				throw new Error(
					"Access denied. You can only attach a lorebook you own."
				)
			}
		}

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

// Helper to get chat with userId
//
// No `offset` param: drizzle-orm's relational query config only allows
// `offset` at the query root (DBQueryConfig's TIsRoot check), not inside a
// nested `with.chatMessages` relation like this one — and the only caller
// that ever passed a real offset was the legacy chat()/getChat() function,
// which has been removed (see the "getChat emits under an event name
// nothing listens for" comments elsewhere in this file). Every remaining
// caller relies on `beforeId` cursor pagination instead.
async function getChatFromDB(
	chatId: number,
	userId: number,
	limit?: number,
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
				where:
					beforeId != null ? (cm) => lt(cm.id, beforeId) : undefined,
				orderBy: (cm, { desc }) => desc(cm.id),
				limit: limit
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
			// Removed-participant rows are deliberately excluded here (unlike
			// getChatFromDB, which stays unfiltered for client display) —
			// this function's result feeds the entire prompt-building
			// pipeline (generateResponse.ts's adapter construction,
			// promptBuilder, RagInfillEngine, KeywordInfillEngine all derive
			// their chat from this one query), and a removed participant's
			// row flowing into that pipeline unfiltered would mean a
			// character removed from the chat could still be presented to
			// the model as present/available.
			chatCharacters: {
				where: (cc, { isNull }) => isNull(cc.removedAt),
				with: {
					character: {
						// with: { lorebook: true }
					}
				},
				orderBy: (cc, { asc }) => asc(cc.position ?? 0)
			},
			chatPersonas: {
				where: (cp, { isNull }) => isNull(cp.removedAt),
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

		// Separate query (not a second `with` on the same relation, which
		// Drizzle's relational query builder doesn't support) so historical
		// message-speaker resolution (ContentProcessors.ts's
		// ChatMessageProcessor, RagInfillEngine.ts's formatMessageForQuery)
		// can still find a removed participant's name — see
		// BasePromptChat.removedChatCharacters/removedChatPersonas.
		const [removedChatCharacters, removedChatPersonas] = await Promise.all(
			[
				db.query.chatCharacters.findMany({
					where: (cc, { eq, and, isNotNull }) =>
						and(eq(cc.chatId, chatId), isNotNull(cc.removedAt)),
					with: { character: true }
				}),
				db.query.chatPersonas.findMany({
					where: (cp, { eq, and, isNotNull }) =>
						and(eq(cp.chatId, chatId), isNotNull(cp.removedAt)),
					with: { persona: true }
				})
			]
		)
		;(chat as any).removedChatCharacters = removedChatCharacters
		;(chat as any).removedChatPersonas = removedChatPersonas
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

			const chatData = await getChatFromDB(
				params.id,
				userId,
				limit,
				beforeId
			)

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
			const hasMore =
				beforeId != null
					? loadedCount === limit // cursor mode: full page implies more exist
					: total > limit // initial load: more exist than we fetched

			const drafts = (chatData as any).drafts as
				| Record<string, string>
				| null
				| undefined
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

// ─── Binding check utility (Flow 1) ─────────────────────────────────────────
// Flow 2 (node-linking, bindingCheck:nodeResult / NodeLinkerModal) is gone —
// see the lorebookBindings/narrativeNodes merge plan. A binding IS the
// graph row now, so there's no separate "node" to reconcile it with.

/**
 * After a chat is saved with a lorebook:
 * - Quietly create bindings for chars/personas that don't have one yet.
 * - Emit bindingCheck:result for any orphaned bindings (bindings without a char/persona).
 */
async function runLorebookBindingCheck(
	chatId: number,
	lorebookId: number,
	emitToUser: (event: string, data: any) => void
): Promise<void> {
	const [chatChars, chatPersonas, existingBindings] = await Promise.all([
		db.query.chatCharacters.findMany({
			where: and(
				eq(schema.chatCharacters.chatId, chatId),
				isNull(schema.chatCharacters.removedAt)
			),
			columns: { characterId: true }
		}),
		db.query.chatPersonas.findMany({
			where: and(
				eq(schema.chatPersonas.chatId, chatId),
				isNull(schema.chatPersonas.removedAt)
			),
			columns: { personaId: true }
		}),
		db.query.lorebookBindings.findMany({
			where: eq(schema.lorebookBindings.lorebookId, lorebookId)
		})
	])

	const bindingsByChar = new Map(
		existingBindings
			.filter((b) => b.characterId)
			.map((b) => [b.characterId!, b])
	)
	const bindingsByPersona = new Map(
		existingBindings
			.filter((b) => b.personaId)
			.map((b) => [b.personaId!, b])
	)

	// Flow 1a: Create missing bindings for chars/personas. Each binding's
	// token is derived from the lorebook's own per-lorebook counter (never
	// reused after a delete) — never a recomputed max/count, which is what
	// let deleted binding numbers get silently reused before.
	for (const { characterId } of chatChars) {
		if (!characterId || bindingsByChar.has(characterId)) continue
		const created = await db.transaction(async (tx) => {
			const token = await deriveNextBindingToken(lorebookId, tx)
			const [inserted] = await tx
				.insert(schema.lorebookBindings)
				.values({ lorebookId, characterId, binding: token })
				.returning()
			return inserted
		})
		await syncLorebookBindingsForCharacter(characterId)
		bindingsByChar.set(characterId, created)
		existingBindings.push(created)
	}

	for (const { personaId } of chatPersonas) {
		if (!personaId || bindingsByPersona.has(personaId)) continue
		const created = await db.transaction(async (tx) => {
			const token = await deriveNextBindingToken(lorebookId, tx)
			const [inserted] = await tx
				.insert(schema.lorebookBindings)
				.values({ lorebookId, personaId, binding: token })
				.returning()
			return inserted
		})
		await syncLorebookBindingsForPersona(personaId)
		bindingsByPersona.set(personaId, created)
		existingBindings.push(created)
	}

	// Flow 1b: Collect orphaned bindings (no char or persona)
	const orphaned = existingBindings.filter(
		(b) => !b.characterId && !b.personaId
	)
	if (orphaned.length > 0) {
		const unboundChars = chatChars
			.filter((c) => c.characterId && !bindingsByChar.get(c.characterId))
			.map((c) => ({
				type: "character" as const,
				id: c.characterId!,
				name: ""
			}))
		const unboundPersonas = chatPersonas
			.filter((p) => p.personaId && !bindingsByPersona.get(p.personaId))
			.map((p) => ({
				type: "persona" as const,
				id: p.personaId!,
				name: ""
			}))

		const bindingCheckRes: Sockets.BindingCheck.Result.Response = {
			lorebookId,
			chatId,
			unboundEntities: [...unboundChars, ...unboundPersonas],
			orphanedBindings: orphaned.map((b) => ({
				id: b.id,
				binding: b.binding
			}))
		}
		emitToUser("bindingCheck:result", bindingCheckRes)
	}
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

			// Guests may manage characters/personas on a chat (further
			// ownership-checked below) but never chat-level settings — name,
			// scenario, lorebook, connection/sampling/prompt overrides, tags,
			// response mode, etc. Enforced here server-side rather than only
			// hiding those fields client-side, since this event is reachable
			// directly regardless of what the UI shows.
			if (chatAccess.isOwner) {
				const tags = params.tags || []

				// lorebookId needs an ownership check (lorebooks is strictly
				// per-user) before it's accepted — everything else here is
				// either owner-only data or a reference to an admin-managed
				// global table (connections/samplingConfigs/promptConfigs/
				// narratorPromptConfigs), which needs no such check.
				if (params.chat.lorebookId != null) {
					const ownsLorebook = await checkLorebookOwnership(
						params.chat.lorebookId,
						userId
					)
					if (!ownsLorebook) {
						throw new Error(
							"Access denied. You can only attach a lorebook you own."
						)
					}
				}

				// Explicit allowlist, not a spread of the full client payload
				// (Params.chat is UpdateChat = Partial<SelectChat>, so a bare
				// spread would also accept id/userId/isGroup/createdAt —
				// isGroup is recomputed separately below when characterIds is
				// provided, never client-settable directly here). Tags are
				// handled separately via Params.tags, not this table.
				const {
					name,
					chatType,
					scenario,
					metadata,
					groupReplyStrategy,
					drafts,
					lorebookId,
					connectionId,
					samplingConfigId,
					promptConfigId,
					narratorPromptConfigId
				} = params.chat
				await db
					.update(schema.chats)
					.set({
						...(name !== undefined ? { name } : {}),
						...(chatType !== undefined ? { chatType } : {}),
						...(scenario !== undefined ? { scenario } : {}),
						...(metadata !== undefined ? { metadata } : {}),
						...(groupReplyStrategy !== undefined
							? { groupReplyStrategy }
							: {}),
						...(drafts !== undefined ? { drafts } : {}),
						...(lorebookId !== undefined ? { lorebookId } : {}),
						...(connectionId !== undefined ? { connectionId } : {}),
						...(samplingConfigId !== undefined
							? { samplingConfigId }
							: {}),
						...(promptConfigId !== undefined ? { promptConfigId } : {}),
						...(narratorPromptConfigId !== undefined
							? { narratorPromptConfigId }
							: {}),
						updatedAt: new Date().toISOString()
					})
					.where(eq(schema.chats.id, params.chat.id!))

				// Process tags after chat update
				await processChatTags(params.chat.id!, tags, userId)
			}

			// Sync chatCharacters if provided
			if (params.characterIds !== undefined) {
				const existingCCs = await db.query.chatCharacters.findMany({
					where: (cc, { eq }) => eq(cc.chatId, params.chat.id!),
					with: { character: true }
				})
				// Diffing/ownership decisions below are all against currently
				// *active* participants — a removed row must not block a
				// re-add, and must not be silently "removed" again.
				const activeCCs = existingCCs.filter((cc) => !cc.removedAt)
				const existingCharacterIds = new Set(
					activeCCs
						.map((cc) => cc.characterId)
						.filter((id): id is number => id !== null)
				)
				const newCharacterIds = new Set(params.characterIds)

				// Only characters the requesting user owns can be newly added —
				// already-linked characters (eg. added by another participant)
				// are left alone regardless of who owns them.
				const characterIdsToAdd = params.characterIds.filter(
					(id) => !existingCharacterIds.has(id)
				)
				if (characterIdsToAdd.length > 0) {
					const ownedCharacterIds = await checkCharactersOwnership(
						characterIdsToAdd,
						userId
					)
					if (ownedCharacterIds.size !== characterIdsToAdd.length) {
						emitToUser("chats:update:error", {
							error: "Access denied. You can only add characters you own."
						})
						throw new Error(
							"Access denied. Attempted to add a character not owned by the user."
						)
					}
				}

				// Removal is a soft delete, not a hard delete, so past
				// messages can still resolve who spoke them. Guests may only
				// remove characters they themselves own; the chat owner may
				// remove anyone's. A row the caller isn't permitted to touch
				// is simply left alone (not removed, no error), matching
				// this handler's existing per-row tolerance.
				for (const cc of activeCCs) {
					if (cc.characterId === null) continue
					if (!newCharacterIds.has(cc.characterId)) {
						const canRemove =
							chatAccess.isOwner ||
							cc.character?.userId === userId
						if (!canRemove) continue
						await db
							.update(schema.chatCharacters)
							.set({
								removedAt: new Date(),
								removedName: resolveCharacterName(
									cc.character,
									"Unknown"
								),
								isActive: false
							})
							.where(
								and(
									eq(
										schema.chatCharacters.chatId,
										params.chat.id!
									),
									eq(
										schema.chatCharacters.characterId,
										cc.characterId
									)
								)
							)
					}
				}
				for (let i = 0; i < params.characterIds.length; i++) {
					const characterId = params.characterIds[i]
					const position =
						(params.characterPositions ?? {})[characterId] ?? i
					if (existingCharacterIds.has(characterId)) {
						await db
							.update(schema.chatCharacters)
							.set({ position })
							.where(
								and(
									eq(
										schema.chatCharacters.chatId,
										params.chat.id!
									),
									eq(
										schema.chatCharacters.characterId,
										characterId
									)
								)
							)
					} else {
						// Upsert, not insert: the target character may already
						// have a soft-removed row for this chat (chatId +
						// characterId is uniquely indexed), in which case this
						// re-add must revive it rather than violate that index.
						await db
							.insert(schema.chatCharacters)
							.values({
								chatId: params.chat.id!,
								characterId,
								position
							})
							.onConflictDoUpdate({
								target: [
									schema.chatCharacters.chatId,
									schema.chatCharacters.characterId
								],
								set: {
									position,
									removedAt: null,
									removedName: null,
									isActive: true
								}
							})
					}
				}
				await db
					.update(schema.chats)
					.set({ isGroup: params.characterIds.length > 1 })
					.where(eq(schema.chats.id, params.chat.id!))
			}

			// Sync chatPersonas if provided
			if (params.personaIds !== undefined) {
				const existingCPs = await db.query.chatPersonas.findMany({
					where: (cp, { eq }) => eq(cp.chatId, params.chat.id!),
					with: { persona: true }
				})
				const activeCPs = existingCPs.filter((cp) => !cp.removedAt)
				const existingPersonaIds = new Set(
					activeCPs
						.map((cp) => cp.personaId)
						.filter((id): id is number => id !== null)
				)
				const newPersonaIds = new Set(params.personaIds)

				// Only personas the requesting user owns can be newly added —
				// already-linked personas (eg. added by another participant)
				// are left alone regardless of who owns them.
				const personaIdsToAdd = params.personaIds.filter(
					(id) => !existingPersonaIds.has(id)
				)
				if (personaIdsToAdd.length > 0) {
					const ownedPersonaIds = await checkPersonasOwnership(
						personaIdsToAdd,
						userId
					)
					if (ownedPersonaIds.size !== personaIdsToAdd.length) {
						emitToUser("chats:update:error", {
							error: "Access denied. You can only add personas you own."
						})
						throw new Error(
							"Access denied. Attempted to add a persona not owned by the user."
						)
					}
				}

				// Soft delete, same rule as characters above: guests may only
				// remove personas they own; the chat owner may remove anyone's.
				for (const cp of activeCPs) {
					if (cp.personaId === null) continue
					if (!newPersonaIds.has(cp.personaId)) {
						const canRemove =
							chatAccess.isOwner || cp.persona?.userId === userId
						if (!canRemove) continue
						await db
							.update(schema.chatPersonas)
							.set({
								removedAt: new Date(),
								removedName: resolvePersonaName(
									cp.persona,
									"Unknown"
								)
							})
							.where(
								and(
									eq(
										schema.chatPersonas.chatId,
										params.chat.id!
									),
									eq(
										schema.chatPersonas.personaId,
										cp.personaId
									)
								)
							)
					}
				}
				for (let i = 0; i < params.personaIds.length; i++) {
					const personaId = params.personaIds[i]
					if (existingPersonaIds.has(personaId)) {
						await db
							.update(schema.chatPersonas)
							.set({ position: i })
							.where(
								and(
									eq(
										schema.chatPersonas.chatId,
										params.chat.id!
									),
									eq(schema.chatPersonas.personaId, personaId)
								)
							)
					} else {
						// Upsert: revive a soft-removed row if one exists for
						// this chatId + personaId rather than violating the
						// unique index on that pair.
						await db
							.insert(schema.chatPersonas)
							.values({
								chatId: params.chat.id!,
								personaId,
								position: i
							})
							.onConflictDoUpdate({
								target: [
									schema.chatPersonas.chatId,
									schema.chatPersonas.personaId
								],
								set: {
									position: i,
									removedAt: null,
									removedName: null
								}
							})
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
				runLorebookBindingCheck(
					params.chat.id!,
					lorebookId,
					emitToUser
				).catch(console.error)
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

			// A soft-deleted user still has a real row (the FK alone wouldn't
			// catch this), so check explicitly rather than silently adding a
			// guest who can never actually authenticate as themselves again.
			//
			// This check and the "already a guest" one below deliberately
			// share one generic error message rather than their own specific
			// ones. Distinguishing "doesn't exist" from "already a guest"
			// from success lets any chat owner (this is ownership-gated, not
			// admin-gated) binary-search valid user IDs on a multi-account
			// instance they otherwise have no visibility into — the picker
			// UI's own `users:list` call is admin-gated, but this handler
			// itself has never been, so a non-admin owner could still reach
			// this via a direct socket emission. A generic message closes
			// that oracle without changing the ownership check above, which
			// doesn't leak anything about other users.
			const guestUser = await db.query.users.findFirst({
				where: (u, { eq }) => eq(u.id, guestUserId),
				columns: { id: true, isDeleted: true }
			})
			if (!guestUser || guestUser.isDeleted) {
				const res: Sockets.Chats.AddGuest.Response = {
					success: false,
					error: "Unable to add this guest."
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
					error: "Unable to add this guest."
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

			// Push a fresh chat list to the newly-added guest — they aren't in
			// the chat's own broadcast room yet (they haven't opened it), so
			// without this their sidebar wouldn't show the new chat until a
			// manual refresh/reconnect.
			const guestChatsList = await buildChatsListFor(guestUserId)
			socket.io.to(`user_${guestUserId}`).emit("chats:list", guestChatsList)

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

			// Push a fresh chat list to the removed guest so the chat
			// disappears from their sidebar without a manual refresh.
			const guestChatsList = await buildChatsListFor(guestUserId)
			socket.io.to(`user_${guestUserId}`).emit("chats:list", guestChatsList)

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

			// Branching deep-copies the full message history into a brand
			// new chat, unbounded by any rate limit — owner-only, same as
			// delete/guest-management, so a guest can't repeatedly grow the
			// owner's storage with chats they never asked for. A guest
			// wanting their "own" copy can start a new chat with the same
			// cast instead.
			const chatAccess = await checkChatAccess(chatId, userId)
			if (!chatAccess.isOwner) {
				const res: Sockets.Chats.Branch.Response = {
					error: "Access denied. Only chat owners can branch chats."
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

			// Get all messages up to and including the branch message
			const allMessages = await db.query.chatMessages.findMany({
				where: eq(schema.chatMessages.chatId, chatId),
				orderBy: asc(schema.chatMessages.id)
			})
			const messagesToCopy = allMessages.filter(
				(msg) => msg.id <= messageId
			)

			// Everything below writes a brand-new chat and its full copied
			// history — wrapped in one transaction so a crash or thrown error
			// partway through (e.g. server restart mid-copy) can't leave an
			// orphaned, half-copied branch chat visible in the chat list.
			const newChat = await db.transaction(async (tx) => {
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

				const [newChat] = await tx
					.insert(schema.chats)
					.values(newChatData)
					.returning()

				// Removed participants aren't copied into the branch at all —
				// a soft-removed row resurrecting as active in the new chat
				// would undo the whole point of removing them.
				const chatCharacters = (
					originalChat as any
				).chatCharacters.filter((cc: any) => !cc.removedAt)
				if (chatCharacters.length > 0) {
					await tx.insert(schema.chatCharacters).values(
						chatCharacters.map((chatCharacter: any) => ({
							chatId: newChat.id,
							characterId: chatCharacter.characterId,
							position: chatCharacter.position,
							isActive: chatCharacter.isActive,
							visibility: chatCharacter.visibility
						}))
					)
				}

				const chatPersonas = (originalChat as any).chatPersonas.filter(
					(cp: any) => !cp.removedAt
				)
				if (chatPersonas.length > 0) {
					await tx.insert(schema.chatPersonas).values(
						chatPersonas.map((chatPersona: any) => ({
							chatId: newChat.id,
							personaId: chatPersona.personaId,
							position: chatPersona.position
						}))
					)
				}

				const chatGuests = (originalChat as any).chatGuests
				if (chatGuests.length > 0) {
					await tx.insert(schema.chatGuests).values(
						chatGuests.map((chatGuest: any) => ({
							chatId: newChat.id,
							userId: chatGuest.userId
						}))
					)
				}

				const chatTags = (originalChat as any).chatTags
				if (chatTags.length > 0) {
					await tx.insert(schema.chatTags).values(
						chatTags.map((chatTag: any) => ({
							chatId: newChat.id,
							tagId: chatTag.tagId
						}))
					)
				}

				if (messagesToCopy.length > 0) {
					await tx.insert(schema.chatMessages).values(
						messagesToCopy.map(
							(message) =>
								({
									chatId: newChat.id,
									userId: message.userId,
									personaId: message.personaId,
									characterId: message.characterId,
									role: message.role,
									content: message.content,
									isHidden: message.isHidden,
									isGenerating: false, // Always set to false for copied messages
									metadata: message.metadata
								}) satisfies InsertChatMessage
						)
					)
				}

				return newChat
			})

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

/**
 * Re-points a removed (soft-deleted) chat participant's message history to a
 * new character/persona, and makes the new one an active participant — the
 * "adopt this removed participant's history" flow paired with the soft
 * delete in chatsUpdateHandler. Permission mirrors the removal path: the
 * chat owner can reassign anyone's removed slot; a non-owner can only
 * reassign a removed slot they themselves originally owned (once the
 * underlying entity is globally deleted there's no more "original owner" to
 * check against, so only the chat owner can act at that point).
 */
export const chatsReassignRemovedParticipantHandler: Handler<
	Sockets.Chats.ReassignRemovedParticipant.Params,
	Sockets.Chats.ReassignRemovedParticipant.Response
> = {
	event: "chats:reassignRemovedParticipant",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { chatId, type, oldId, newId } = params

			const chatAccess = await checkChatAccess(chatId, userId)
			if (!chatAccess.hasAccess) {
				const res: Sockets.Chats.ReassignRemovedParticipant.Response = {
					error: "Access denied. Chat not found or no permission to access."
				}
				emitToUser("chats:reassignRemovedParticipant", res)
				return res
			}

			if (oldId === newId) {
				const res: Sockets.Chats.ReassignRemovedParticipant.Response = {
					error: "Cannot reassign a removed participant to themselves — re-add them normally instead."
				}
				emitToUser("chats:reassignRemovedParticipant", res)
				return res
			}

			if (type === "character") {
				const removedCC = await db.query.chatCharacters.findFirst({
					where: (cc, { and, eq, isNotNull }) =>
						and(
							eq(cc.chatId, chatId),
							eq(cc.characterId, oldId),
							isNotNull(cc.removedAt)
						),
					with: { character: true }
				})
				if (!removedCC) {
					const res: Sockets.Chats.ReassignRemovedParticipant.Response =
						{ error: "Removed character not found in this chat." }
					emitToUser("chats:reassignRemovedParticipant", res)
					return res
				}

				const canReassign =
					chatAccess.isOwner ||
					removedCC.character?.userId === userId
				if (!canReassign) {
					const res: Sockets.Chats.ReassignRemovedParticipant.Response =
						{
							error: "Access denied. Only the chat owner or this character's original owner can reassign it."
						}
					emitToUser("chats:reassignRemovedParticipant", res)
					return res
				}

				const ownsNewTarget = await checkCharacterOwnership(
					newId,
					userId
				)
				if (!ownsNewTarget) {
					const res: Sockets.Chats.ReassignRemovedParticipant.Response =
						{
							error: "Access denied. You can only reassign to a character you own."
						}
					emitToUser("chats:reassignRemovedParticipant", res)
					return res
				}

				// Atomic: bulk-reassign history, upsert the new active
				// participant, and remove the old slot all-or-nothing. A
				// crash between these steps would otherwise either leave
				// messages repointed with the old removed row still
				// lingering, or — the dangerous ordering — delete the old
				// row while messages still reference it, which nulls out
				// via onDelete: "set null" and reverts to "Unknown": the
				// exact data loss this handler exists to prevent.
				await db.transaction(async (tx) => {
					await tx
						.update(schema.chatMessages)
						.set({ characterId: newId })
						.where(
							and(
								eq(schema.chatMessages.chatId, chatId),
								eq(schema.chatMessages.characterId, oldId)
							)
						)
					await tx
						.insert(schema.chatCharacters)
						.values({
							chatId,
							characterId: newId,
							position: removedCC.position ?? 0
						})
						.onConflictDoUpdate({
							target: [
								schema.chatCharacters.chatId,
								schema.chatCharacters.characterId
							],
							set: {
								removedAt: null,
								removedName: null,
								isActive: true
							}
						})
					await tx
						.delete(schema.chatCharacters)
						.where(
							and(
								eq(schema.chatCharacters.chatId, chatId),
								eq(schema.chatCharacters.characterId, oldId)
							)
						)
				})
			} else {
				const removedCP = await db.query.chatPersonas.findFirst({
					where: (cp, { and, eq, isNotNull }) =>
						and(
							eq(cp.chatId, chatId),
							eq(cp.personaId, oldId),
							isNotNull(cp.removedAt)
						),
					with: { persona: true }
				})
				if (!removedCP) {
					const res: Sockets.Chats.ReassignRemovedParticipant.Response =
						{ error: "Removed persona not found in this chat." }
					emitToUser("chats:reassignRemovedParticipant", res)
					return res
				}

				const canReassign =
					chatAccess.isOwner || removedCP.persona?.userId === userId
				if (!canReassign) {
					const res: Sockets.Chats.ReassignRemovedParticipant.Response =
						{
							error: "Access denied. Only the chat owner or this persona's original owner can reassign it."
						}
					emitToUser("chats:reassignRemovedParticipant", res)
					return res
				}

				const ownsNewTarget = await checkPersonaOwnership(
					newId,
					userId
				)
				if (!ownsNewTarget) {
					const res: Sockets.Chats.ReassignRemovedParticipant.Response =
						{
							error: "Access denied. You can only reassign to a persona you own."
						}
					emitToUser("chats:reassignRemovedParticipant", res)
					return res
				}

				await db.transaction(async (tx) => {
					await tx
						.update(schema.chatMessages)
						.set({ personaId: newId })
						.where(
							and(
								eq(schema.chatMessages.chatId, chatId),
								eq(schema.chatMessages.personaId, oldId)
							)
						)
					await tx
						.insert(schema.chatPersonas)
						.values({
							chatId,
							personaId: newId,
							position: removedCP.position ?? 0
						})
						.onConflictDoUpdate({
							target: [
								schema.chatPersonas.chatId,
								schema.chatPersonas.personaId
							],
							set: { removedAt: null, removedName: null }
						})
					await tx
						.delete(schema.chatPersonas)
						.where(
							and(
								eq(schema.chatPersonas.chatId, chatId),
								eq(schema.chatPersonas.personaId, oldId)
							)
						)
				})
			}

			const updatedChat = await getChatFromDB(chatId, userId)
			const res: Sockets.Chats.ReassignRemovedParticipant.Response = {
				success: true,
				chat: updatedChat as any
			}
			emitToUser("chats:reassignRemovedParticipant", res)
			if (updatedChat) {
				await broadcastToChatUsers(socket.io, chatId, "chats:get", {
					chat: updatedChat as any,
					messages: (updatedChat as any).chatMessages || null
				})
			}
			return res
		} catch (error: any) {
			console.error("Error reassigning removed chat participant:", error)
			const res: Sockets.Chats.ReassignRemovedParticipant.Response = {
				error: "Failed to reassign removed participant."
			}
			emitToUser("chats:reassignRemovedParticipant:error", res)
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

			if (content && content.length > MAX_CHAT_MESSAGE_LENGTH) {
				const res: Sockets.ChatMessages.SendPersonaMessage.Response = {
					chatMessage: undefined,
					error: `Message too long (max ${MAX_CHAT_MESSAGE_LENGTH.toLocaleString()} characters).`
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

			// Round-robin no longer waits for every persona to speak before letting
			// a character go — a persona can freely speak between two characters'
			// turns. getNextCharacterTurn decides per-character, from message
			// recency, whether anyone is actually due right now (see
			// getNextCharacterTurn.ts), so this is safe to call after every
			// persona message: it's a no-op if nobody's due yet.
			await triggerGenerateMessageHandler.handler(
				socket,
				{ chatId },
				emitToUser
			)

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

			// Persona messages: only that persona's owner. Character messages:
			// the chat owner or that character's owner. See
			// checkMessageEditPermission for the full rationale.
			const canEdit = await checkMessageEditPermission(id, userId)
			if (!canEdit) {
				const res: Sockets.ChatMessages.Update.Response = {
					chatMessage: undefined,
					error: "You don't have permission to edit this message"
				}
				emitToUser("chatMessages:update:error", res)
				return res
			}

			// Get the existing message to check metadata
			const [existingMessage] = await db
				.select()
				.from(schema.chatMessages)
				.where(eq(schema.chatMessages.id, id))

			if (!existingMessage) {
				const res: Sockets.ChatMessages.Update.Response = {
					chatMessage: undefined,
					error: "Message not found"
				}
				emitToUser("chatMessages:update", res)
				return res
			}

			if (
				content !== undefined &&
				content.length > MAX_CHAT_MESSAGE_LENGTH
			) {
				const res: Sockets.ChatMessages.Update.Response = {
					chatMessage: undefined,
					error: `Message too long (max ${MAX_CHAT_MESSAGE_LENGTH.toLocaleString()} characters).`
				}
				emitToUser("chatMessages:update:error", res)
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
				.where(eq(schema.chatMessages.id, id))
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
					id: params.id,
					error: "Message not found"
				}
				emitToUser("chatMessages:delete", res)
				return res
			}

			// Check if user can edit this message (based on message edit permissions)
			const canEdit = await checkMessageEditPermission(params.id, userId)
			if (!canEdit) {
				const res: Sockets.ChatMessages.Delete.Response = {
					id: params.id,
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
				id: params.id,
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
				id: params.id,
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

			// Get the message to regenerate first — needed to learn chatId,
			// which is the lock key, before we can acquire it.
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

			return await withChatTriggerLock(
				messageToRegenerate.chatId,
				async () => {
					// Chat owner or the character's owner (character messages), or the
					// persona's owner (persona messages) — see checkMessageEditPermission.
					const canEdit = await checkMessageEditPermission(
						params.id,
						userId
					)
					if (!canEdit) {
						const res: Sockets.ChatMessages.Regenerate.Response = {
							chatMessage: undefined,
							error: "Access denied. You don't have permission to regenerate this message."
						}
						emitToUser("chatMessages:regenerate", res)
						return res
					}

					// Freshness guard, re-checked now that the lock is held — a
					// queued call must see whatever the call ahead of it in line
					// already committed, not a stale pre-lock snapshot. Mirrors
					// triggerGenerateMessageHandler's own in-lock check.
					const alreadyGenerating =
						await db.query.chatMessages.findFirst({
							where: (cm, { and, eq }) =>
								and(
									eq(cm.chatId, messageToRegenerate.chatId),
									eq(cm.isGenerating, true)
								)
						})
					if (alreadyGenerating) {
						const res: Sockets.ChatMessages.Regenerate.Response = {
							chatMessage: undefined,
							error: "A response is already generating in this chat."
						}
						emitToUser("chatMessages:regenerate:error", res)
						return res
					}

					const currentMetadata =
						(messageToRegenerate.metadata as any) || {}

					// Clear the content and set as generating
					const [updated] = await db
						.update(schema.chatMessages)
						.set({
							content: "",
							isGenerating: true,
							generationStage: "queued",
							error: null,
							metadata: currentMetadata
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
				}
			)
		} catch (error: any) {
			console.error("Error regenerating chat message:", error)
			const res: Sockets.ChatMessages.Regenerate.Response = {
				chatMessage: undefined,
				error:
					error instanceof Error
						? error.message
						: "Failed to regenerate message"
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

			// Get the message to continue first — needed to learn chatId,
			// which is the lock key, before we can acquire it.
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

			return await withChatTriggerLock(
				messageToContinue.chatId,
				async () => {
					// Chat owner or the character's owner — see checkMessageEditPermission.
					const canEdit = await checkMessageEditPermission(
						params.id,
						userId
					)
					if (!canEdit) {
						const res: Sockets.ChatMessages.Continue.Response = {
							chatMessage: undefined,
							error: "Access denied. You don't have permission to continue this message."
						}
						emitToUser("chatMessages:continue", res)
						return res
					}

					// Freshness guard, re-checked now that the lock is held — see
					// the identical comment in chatMessagesRegenerateHandler.
					const alreadyGenerating =
						await db.query.chatMessages.findFirst({
							where: (cm, { and, eq }) =>
								and(
									eq(cm.chatId, messageToContinue.chatId),
									eq(cm.isGenerating, true)
								)
						})
					if (alreadyGenerating) {
						const res: Sockets.ChatMessages.Continue.Response = {
							chatMessage: undefined,
							error: "A response is already generating in this chat."
						}
						emitToUser("chatMessages:continue:error", res)
						return res
					}

					// Get current metadata and preserve it
					const currentMetadata =
						(messageToContinue.metadata as any) || {}

					// Set as generating but KEEP existing content
					// The content will be used as a prefix in generateResponse
					const [updated] = await db
						.update(schema.chatMessages)
						.set({
							isGenerating: true,
							generationStage: "queued",
							error: null,
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
				}
			)
		} catch (error: any) {
			console.error("Error continuing chat message:", error)
			const res: Sockets.ChatMessages.Continue.Response = {
				chatMessage: undefined,
				error:
					error instanceof Error
						? error.message
						: "Failed to continue message"
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

			// Regenerate/Continue/SwipeRight all wrap their mutation in the
			// per-chat generation lock; without it here, a SwipeRight/
			// Regenerate/Continue racing against a concurrent SwipeLeft on
			// the same message could have its isGenerating/queueItemId
			// state clobbered back to the stale pre-read values below.
			return await withChatTriggerLock(message.chatId, async () => {
				// Chat owner or the character's owner — see checkMessageEditPermission.
				const canEdit = await checkMessageEditPermission(
					params.id,
					userId
				)
				if (!canEdit) {
					const res: Sockets.ChatMessages.SwipeLeft.Response = {
						chatMessage: undefined,
						error: "Access denied. You don't have permission to swipe this message."
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
					data.metadata!.swipes!.thinkingHistory?.[
						data.metadata!.swipes!.currentIdx
					] ?? null

				// Update the chat message in the database (drop `id` — it's the
				// primary key, not an updatable column, and isn't optional on
				// SelectChatMessage so `delete` can't be used here)
				const { id: _id, ...dataWithoutId } = data
				const [updated] = await db
					.update(schema.chatMessages)
					.set({ ...dataWithoutId })
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
			})
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

			// Get the message first — needed to learn chatId, which is the
			// lock key, before we can acquire it.
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

			return await withChatTriggerLock(message.chatId, async () => {
				// Chat owner or the character's owner — see checkMessageEditPermission.
				const canEdit = await checkMessageEditPermission(
					params.id,
					userId
				)
				if (!canEdit) {
					const res: Sockets.ChatMessages.SwipeRight.Response = {
						chatMessage: undefined,
						error: "Access denied. You don't have permission to swipe this message."
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
						data.metadata!.swipes!.thinkingHistory?.[
							data.metadata!.swipes!.currentIdx
						] ?? null
				} else {
					// About to start a brand-new generation — freshness guard,
					// re-checked now that the lock is held, matching
					// regenerate/continue. Pure swipe navigation (the branch
					// above) never reaches here, so it's never blocked by an
					// unrelated in-flight generation elsewhere in the chat.
					const alreadyGenerating =
						await db.query.chatMessages.findFirst({
							where: (cm, { and, eq }) =>
								and(
									eq(cm.chatId, message.chatId),
									eq(cm.isGenerating, true)
								)
						})
					if (alreadyGenerating) {
						const res: Sockets.ChatMessages.SwipeRight.Response = {
							chatMessage: undefined,
							error: "A response is already generating in this chat."
						}
						emitToUser("chatMessages:swipeRight:error", res)
						return res
					}

					if (data.metadata!.swipes!.currentIdx === null) {
						data.metadata!.swipes!.currentIdx = 0
						data.metadata!.swipes!.history.push(data.content)
						// Keep thinkingHistory in sync when initialising swipes for the first time
						const th: (string | null)[] =
							data.metadata!.swipes!.thinkingHistory || []
						while (th.length < data.metadata!.swipes!.history.length)
							th.push(null)
						data.metadata!.swipes!.thinkingHistory = th
					}
					// Now increment the current index and push a new empty generation slot
					data.metadata!.swipes!.currentIdx += 1
					data.content = "" // Clear the message content
					data.isGenerating = true // Set generating state to true
					data.generationStage = "queued"
					data.error = null
					data.queueItemId = null
					// Push the new empty content to history
					data.metadata!.swipes!.history.push("") // Add an empty string to history
					// Push a matching null into thinkingHistory to keep lengths equal
					const th: (string | null)[] =
						data.metadata!.swipes!.thinkingHistory || []
					while (th.length < data.metadata!.swipes!.history.length - 1)
						th.push(null)
					th.push(null)
					data.metadata!.swipes!.thinkingHistory = th
					// Clear active thinking — new slot has no thinking yet
					data.metadata!.thinking = null
				}

				// Drop `id` — it's the primary key, not an updatable column, and
				// isn't optional on SelectChatMessage so `delete` can't be used.
				const { id: _id, ...dataWithoutId } = data

				// Update the chat message in the database
				const [updated] = await db
					.update(schema.chatMessages)
					.set({ ...dataWithoutId })
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
			})
		} catch (error: any) {
			console.error("Error swiping right chat message:", error)
			const res: Sockets.ChatMessages.SwipeRight.Response = {
				chatMessage: undefined,
				error:
					error instanceof Error
						? error.message
						: "Failed to swipe right"
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
				chat.groupReplyStrategy
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

			const chatAccess = await checkChatAccess(params.chatId, userId)
			if (!chatAccess.hasAccess) {
				throw new Error("Chat not found")
			}

			// THE VERY FIRST THING this handler does: unconditionally flip the
			// clicked message off "generating" and broadcast it — scoped only by
			// message id + chatId, never by isGenerating/userId matching. This
			// must never be contingent on the upstream LLM actually stopping, on
			// queue state, or on a row's stamped userId matching whoever clicked
			// Stop (previously required cm.userId === socket.user.id, which
			// silently no-op'd the whole handler whenever that didn't match,
			// leaving the message stuck "generating" forever — e.g. while still
			// in the "loading model" preflight stage). Everything below this is
			// best-effort cleanup of the actual upstream generation.
			const targetIds = new Set<number>()
			if (params.id) targetIds.add(params.id)

			// Also sweep every other message this chat currently has marked as
			// generating, so a group chat with multiple in-flight generations
			// (or a client that didn't pass an id) is fully covered too.
			const generatingMessages = await db.query.chatMessages.findMany({
				where: (cm, { and, eq }) =>
					and(eq(cm.chatId, params.chatId), eq(cm.isGenerating, true))
			})
			for (const message of generatingMessages) targetIds.add(message.id)

			for (const id of targetIds) {
				const [updated] = await db
					.update(schema.chatMessages)
					.set({
						isGenerating: false,
						generationStage: null,
						queueItemId: null,
						error: null
					})
					.where(
						and(
							eq(schema.chatMessages.id, id),
							eq(schema.chatMessages.chatId, params.chatId)
						)
					)
					.returning()
				if (updated) {
					await broadcastToChatUsers(
						socket.io,
						params.chatId,
						"chatMessage",
						{
							chatMessage: updated
						}
					)
				}
			}

			// Best-effort: ask the queue to cancel the actual upstream runs we
			// knew about. Fires the adapter's abort() internally and, if the run
			// doesn't respond in time, force-detaches it so the queue can proceed
			// regardless. Never throws. Purely cleanup — the UI is already fixed.
			for (const message of generatingMessages) {
				if (message.queueItemId) {
					llmQueue.cancel(message.queueItemId)
				}
			}

			const res: Sockets.ChatMessages.Cancel.Response = {
				success: `Cancelled ${targetIds.size} generating message(s)`
			}
			emitToUser("chatMessages:cancel", res)

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
				// Fetched by message id alone — without this check, any
				// authenticated user could read any message on the instance
				// (including debugMeta's full compiled prompt) just by
				// guessing/incrementing ids.
				const chatAccess = await checkChatAccess(
					chatMessage.chatId,
					socket.user!.id
				)
				if (!chatAccess.hasAccess) {
					const res: Sockets.ChatMessage.Response = {
						error: "Access denied. Chat not found or no permission to access."
					}
					emitToUser("chatMessage:error", res)
					throw new Error("Access denied.")
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
		currentCharacterName: resolveCharacterName(character),
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

			// This is the live "draft preview" handler (fired while typing) —
			// fail fast on oversized content before any DB work, same as the
			// persisted send/update paths.
			if (
				params.content &&
				params.content.length > MAX_CHAT_MESSAGE_LENGTH
			) {
				const res: Sockets.Chats.PromptTokenCount.Response = {
					error: `Message too long (max ${MAX_CHAT_MESSAGE_LENGTH.toLocaleString()} characters).`
				}
				emitToUser("chats:promptTokenCount", res)
				return res
			}

			// Check if user has access to this chat
			const chatAccess = await checkChatAccess(params.chatId, userId)
			if (!chatAccess.hasAccess) {
				const res: Sockets.Chats.PromptTokenCount.Response = {
					error: "Access denied. Chat not found or no permission to access."
				}
				emitToUser("chats:promptTokenCount", res)
				return res
			}

			const chat = await getPromptChatFromDb(params.chatId, userId)
			if (!chat) {
				const res: Sockets.Chats.PromptTokenCount.Response = {
					error: "Error Generating Prompt Token Count: Chat not found."
				}
				emitToUser("chats:promptTokenCount", res)
				return res
			}

			const user = await db.query.users.findFirst({
				where: (u, { eq }) => eq(u.id, userId)
			})

			// Get context/prompt config from user settings; resolve connection+sampling via
			// resolveTaskConfig (chat override → prompt config override → system default)
			const { contextConfig, promptConfig } =
				await getUserConfigurations(userId)
			const { connection, sampling } = await resolveTaskConfig({
				taskType: "chat",
				promptConfigId: promptConfig?.id,
				chatId: chat.id
			})

			if (!connection) {
				const res: Sockets.Chats.PromptTokenCount.Response = {
					error: "No AI connection configured. Please set up a connection first."
				}
				emitToUser("chats:promptTokenCount", res)
				return res
			}
			if (!sampling) {
				const res: Sockets.Chats.PromptTokenCount.Response = {
					error: "No sampling config configured. Please set up a sampling config first."
				}
				emitToUser("chats:promptTokenCount", res)
				return res
			}

			if (!chat || !user) {
				const res: Sockets.Chats.PromptTokenCount.Response = {
					error: "Incomplete configuration, failed to calculate token count."
				}
				emitToUser("chats:promptTokenCount", res)
				return res
			}

			// chatCharacters/chatPersonas rows can have a null character/persona
			// when the linked row was deleted (the FK is nullable, onDelete:
			// "set null") — filter those out, matching the same fix in
			// generateResponse.ts/chatsListHandler.
			const activeChatCharacters = chat.chatCharacters.filter(
				(
					cc
				): cc is typeof cc & {
					character: NonNullable<typeof cc.character>
				} => cc.character !== null && cc.isActive
			)
			const chatCharactersWithCharacter = chat.chatCharacters.filter(
				(
					cc
				): cc is typeof cc & {
					character: NonNullable<typeof cc.character>
				} => cc.character !== null
			)
			const chatPersonasWithPersona = chat.chatPersonas.filter(
				(
					cp
				): cp is typeof cp & {
					persona: NonNullable<typeof cp.persona>
				} => cp.persona !== null
			)

			// The caller (the chat page's live "draft compiled prompt" preview)
			// sends the not-yet-sent draft text via params.content/personaId/role
			// specifically so this preview can reflect what would actually be
			// sent if the user hit Send right now — including whose turn becomes
			// due as a result. Without splicing it in here, this preview only
			// ever sees already-persisted history, so as soon as the last real
			// message is a character reply (i.e. it's the user's turn to type)
			// it permanently reports "No character available" regardless of what
			// the user drafts, since nothing is actually due until their draft
			// is accounted for.
			const messagesWithDraft = params.content?.trim()
				? [
						...chat.chatMessages,
						{
							id: -1,
							chatId: params.chatId,
							userId,
							characterId: null,
							personaId: params.personaId ?? null,
							role: params.role || "user",
							isNarratorResponse: false,
							content: params.content,
							createdAt: new Date().toISOString(),
							updatedAt: new Date(),
							isEdited: false,
							metadata: {},
							isGenerating: false,
							generationStage: null,
							error: null,
							queueItemId: null,
							isHidden: false,
							debugMeta: null,
							embedding: null,
							embeddingModel: null,
							vectorizedAt: null
						} as SelectChatMessage
					]
				: chat.chatMessages

			let chatForPrompt = {
				...chat,
				chatMessages: messagesWithDraft,
				chatCharacters: chatCharactersWithCharacter,
				chatPersonas: chatPersonasWithPersona
			}

			const currentCharacterId = getNextCharacterTurn(
				{
					chatMessages: messagesWithDraft,
					chatCharacters: activeChatCharacters.sort(
						(a, b) => (a.position ?? 0) - (b.position ?? 0)
					),
					chatPersonas: chatPersonasWithPersona
				},
				chat.groupReplyStrategy
			)

			if (!currentCharacterId) {
				const res: Sockets.Chats.PromptTokenCount.Response = {
					error: "No character available for prompt."
				}
				emitToUser("chats:promptTokenCount", res)
				return res
			}

			const { Adapter } = await getConnectionAdapter(connection.type)

			const tokenCounter = new TokenCounters(
				(connection as any).tokenCounter || TokenCounterOptions.ESTIMATE
			)
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
			const res: Sockets.Chats.PromptTokenCount.Response = {
				error: "Failed to calculate prompt token count."
			}
			emitToUser("chats:promptTokenCount", res)
			return res
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
	handler: async (socket, params, emitToUser) =>
		withChatTriggerLock(params.chatId, async () => {
			try {
				const userId = socket.user!.id
				const msgLimit = 10
				let currentMsg = 1
				let ok = true

				// An explicit characterId means a client pressed "Trigger
				// Character" — an out-of-turn generation aimed at a specific
				// character. That is owner-only. getPromptChatFromDb below
				// admits guests too (checkChatAccess is owner-OR-guest), and
				// unlike regenerate/continue/swipe this path had no permission
				// check of its own, so a guest in a shared chat could emit
				// this event directly and drive generations in someone else's
				// chat. It was gated only by the client hiding the tab.
				//
				// Scoped to the explicit-characterId case on purpose: the
				// automatic round-robin call after a persona message (see
				// chatMessagesSendPersonaMessageHandler) invokes this handler
				// with no characterId, and guests are supposed to be able to
				// speak and get replies in a chat shared with them.
				if (params.characterId) {
					const access = await checkChatAccess(params.chatId, userId)
					if (!access.hasAccess) {
						// Matches the "Chat not found" the lookup below would
						// have produced — a missing chat and an inaccessible
						// one stay indistinguishable.
						return {
							error: "Error Triggering Chat Message: Chat not found."
						}
					}
					if (!access.isOwner) {
						return {
							error: "Access denied. Only the chat owner can trigger a specific character."
						}
					}
				}

				console.log(
					`[triggerGenerateMessage] Starting generation for chat ${params.chatId}, once: ${params.once}, characterId: ${params.characterId}`
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

					// Find the next character who should reply — an explicit
					// characterId always wins (manual out-of-turn trigger, and the
					// only way a "Manual" chat ever advances at all). Otherwise ask
					// getNextCharacterTurn who's actually due right now, but only for
					// non-"Manual" chats — a "Manual" chat's whole point is that nobody
					// auto-advances, so calls with no explicit characterId (e.g. the
					// automatic re-check after every persona message) are a no-op.
					const nextCharacterId =
						params.characterId ||
						(chat.groupReplyStrategy !== GroupReplyStrategies.MANUAL
							? getNextCharacterTurn(
									{
										chatMessages: chat.chatMessages,
										chatCharacters: activeCharacters.sort(
											(a, b) =>
												(a.position ?? 0) -
												(b.position ?? 0)
										) as any,
										chatPersonas: chat.chatPersonas.filter(
											(cp) => cp.persona !== null
										) as any
									},
									chat.groupReplyStrategy
								)
							: null)

					if (!nextCharacterId) {
						break
					}

					if (
						chat &&
						chat.chatCharacters.length > 0 &&
						nextCharacterId
					) {
						const nextCharacter = chat.chatCharacters.find(
							(cc) =>
								cc.character &&
								cc.character.id === nextCharacterId
						)
						if (!nextCharacter || !nextCharacter.character) break

						const assistantMessage: InsertChatMessage = {
							userId,
							chatId: params.chatId,
							personaId: null,
							characterId: nextCharacter.character.id,
							content: "",
							role: "assistant",
							isGenerating: true,
							generationStage: "queued"
						}

						const [generatingMessage] = await db
							.insert(schema.chatMessages)
							.values(assistantMessage)
							.returning()

						// emitToUser is always provided by the handler dispatcher (see
						// Handler in $lib/shared/events.ts — non-optional), so this
						// unconditionally broadcasts.
						await broadcastToChatUsers(
							socket.io,
							generatingMessage.chatId,
							"chatMessage",
							{ chatMessage: generatingMessage }
						)
						// chatMessage was already broadcasted above, no need for duplicate emission

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
					if (params.once) break

					currentMsg++
				}

				return { success: true }
			} catch (error) {
				console.error("Error in triggerGenerateMessageHandler:", error)
				return {
					error: "Failed to trigger message generation."
				}
			}
		})
}

// "Narrator" — a manually-triggered, non-character narration/environment
// response. Deliberately does NOT touch chat.chatCharacters or
// getNextCharacterTurn at all: since a narrator message is never a
// chatCharacters row, it's automatically excluded from round-robin with no
// extra exclusion logic needed.
export const triggerNarratorResponseHandler: Handler<
	Sockets.Chats.TriggerNarratorResponse.Params,
	Sockets.Chats.TriggerNarratorResponse.Response
> = {
	event: "chats:triggerNarratorResponse",
	handler: async (socket, params, emitToUser) =>
		withChatTriggerLock(params.chatId, async () => {
			try {
				const userId = socket.user!.id

				if (
					params.instructions &&
					params.instructions.length >
						MAX_NARRATOR_INSTRUCTIONS_LENGTH
				) {
					return {
						error: `Narrator instructions too long (max ${MAX_NARRATOR_INSTRUCTIONS_LENGTH} characters).`
					}
				}

				// Owner-only, same reasoning as the character trigger above:
				// getPromptChatFromDb admits guests, and this handler is only
				// ever reached from a client pressing the Narrator button (no
				// internal callers), so requiring ownership breaks no
				// auto-trigger path. The length cap above deliberately stays
				// first — it's a pure payload check that shouldn't cost a
				// query. A chat that doesn't exist keeps reporting "not found"
				// rather than "access denied".
				const access = await checkChatAccess(params.chatId, userId)
				if (!access.hasAccess) {
					return {
						error: "Error triggering Narrator response: Chat not found."
					}
				}
				if (!access.isOwner) {
					return {
						error: "Access denied. Only the chat owner can trigger a Narrator response."
					}
				}

				const chat = await getPromptChatFromDb(params.chatId, userId)
				if (!chat) {
					return {
						error: "Error triggering Narrator response: Chat not found."
					}
				}

				const hasGeneratingMessages = chat.chatMessages.some(
					(msg) => msg.isGenerating
				)
				if (hasGeneratingMessages) {
					return {
						error: "A response is already generating in this chat."
					}
				}

				// Resolve the effective narrator config (chat override → user active →
				// system default) up front so the message's display name is
				// snapshotted at generation time — later renaming a config, or
				// changing the chat's override, doesn't retroactively relabel
				// already-generated messages.
				const effectiveNarratorConfig =
					await resolveNarratorPromptConfig(chat, userId)
				const narratorName =
					effectiveNarratorConfig?.narratorName || "Narrator"

				const narratorMessage: InsertChatMessage = {
					userId,
					chatId: params.chatId,
					personaId: null,
					characterId: null,
					content: "",
					role: "assistant",
					isNarratorResponse: true,
					isGenerating: true,
					generationStage: "queued",
					metadata: {
						narratorName,
						...(params.instructions
							? { narratorInstructions: params.instructions }
							: {})
					}
				}

				const [generatingMessage] = await db
					.insert(schema.chatMessages)
					.values(narratorMessage)
					.returning()

				await broadcastToChatUsers(
					socket.io,
					generatingMessage.chatId,
					"chatMessage",
					{ chatMessage: generatingMessage }
				)

				const ok = await generateResponse({
					socket,
					emitToUser,
					chatId: params.chatId,
					userId,
					generatingMessage: generatingMessage as any
				})

				return { success: ok }
			} catch (error) {
				console.error("Error in triggerNarratorResponseHandler:", error)
				return {
					error: "Failed to trigger Narrator response."
				}
			}
		})
}

// Lets the client label the Narrator trigger button/modal correctly BEFORE any
// message exists (e.g. a chat-specific narrator name like "Fate" instead of
// the default "Narrator"). Deliberately not admin-gated — any chat
// participant (owner or guest) needs to see this, unlike the
// narratorPromptConfigs CRUD handlers which manage the underlying configs.
export const chatsGetNarratorNameHandler: Handler<
	Sockets.Chats.GetNarratorName.Params,
	Sockets.Chats.GetNarratorName.Response
> = {
	event: "chats:getNarratorName",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const chatAccess = await checkChatAccess(params.chatId, userId)
		if (!chatAccess.hasAccess) {
			return { chatId: params.chatId, narratorName: "Narrator" }
		}

		const chat = await db.query.chats.findFirst({
			where: (c, { eq }) => eq(c.id, params.chatId),
			columns: { narratorPromptConfigId: true }
		})

		const config = await resolveNarratorPromptConfig(chat, userId)
		const res: Sockets.Chats.GetNarratorName.Response = {
			chatId: params.chatId,
			narratorName: config?.narratorName || "Narrator"
		}
		emitToUser("chats:getNarratorName", res)
		return res
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

			// checkChatAccess (owner OR guest), not an owner-only ad-hoc check —
			// a guest who brought their own character into a shared chat must
			// be able to toggle that character's own active status; only the
			// per-row escalation below decides whether *this* character is
			// theirs to manage.
			const chatAccess = await checkChatAccess(params.chatId, userId)
			if (!chatAccess.hasAccess) {
				return {
					chatId: params.chatId,
					characterId: params.characterId,
					isActive: false,
					error: "Error toggling character active: Chat not found."
				}
			}

			const chat = await db.query.chats.findFirst({
				where: (c, { eq }) => eq(c.id, params.chatId),
				with: {
					chatCharacters: {
						where: (cc, { eq, and, isNull }) =>
							and(
								eq(cc.characterId, params.characterId),
								isNull(cc.removedAt)
							),
						with: { character: { columns: { userId: true } } }
					}
				}
			})

			if (!chat?.chatCharacters || chat.chatCharacters.length === 0) {
				return {
					chatId: params.chatId,
					characterId: params.characterId,
					isActive: false,
					error: "Chat character not found."
				}
			}

			const chatCharacter = chat.chatCharacters[0]
			const canManage =
				chatAccess.isOwner || chatCharacter.character?.userId === userId
			if (!canManage) {
				return {
					chatId: params.chatId,
					characterId: params.characterId,
					isActive: false,
					error:
						"Access denied. Only the chat owner or this character's owner can change this."
				}
			}

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

			const res = {
				chatId: params.chatId,
				characterId: params.characterId,
				isActive: newActiveStatus
			}
			// getChat (aliased from the legacy chat() function) emits under the
			// event name "chat", which nothing on the client listens for — this
			// silently dropped both the ack below and the chat refresh. Emit the
			// handler's own declared event, then refresh via the real chats:get
			// handler that EditChatForm/the chat page actually listen for.
			emitToUser("chats:toggleChatCharacterActive", res)
			await chatsGetHandler.handler(socket, { id: chat.id }, emitToUser)

			return res
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

			// See toggleChatCharacterActiveHandler — same "owner OR this
			// character's own owner" escalation, not an owner-only ad-hoc
			// check.
			const chatAccess = await checkChatAccess(params.chatId, userId)
			if (!chatAccess.hasAccess) {
				return {
					chatId: params.chatId,
					characterId: params.characterId,
					visibility: params.visibility,
					error: "Error updating character visibility: Chat not found."
				}
			}

			const chat = await db.query.chats.findFirst({
				where: (c, { eq }) => eq(c.id, params.chatId),
				with: {
					chatCharacters: {
						where: (cc, { eq, and, isNull }) =>
							and(
								eq(cc.characterId, params.characterId),
								isNull(cc.removedAt)
							),
						with: { character: { columns: { userId: true } } }
					}
				}
			})

			if (!chat?.chatCharacters || chat.chatCharacters.length === 0) {
				return {
					chatId: params.chatId,
					characterId: params.characterId,
					visibility: params.visibility,
					error: "Chat character not found."
				}
			}

			const chatCharacter = chat.chatCharacters[0]
			const canManage =
				chatAccess.isOwner || chatCharacter.character?.userId === userId
			if (!canManage) {
				return {
					chatId: params.chatId,
					characterId: params.characterId,
					visibility: params.visibility,
					error:
						"Access denied. Only the chat owner or this character's owner can change this."
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

			const res = {
				chatId: params.chatId,
				characterId: params.characterId,
				visibility: params.visibility
			}
			// See toggleChatCharacterActiveHandler — getChat emits under an event
			// name nothing listens for, dropping both the ack and the refresh.
			emitToUser("chats:updateChatCharacterVisibility", res)
			await chatsGetHandler.handler(socket, { id: chat.id }, emitToUser)

			return res
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
	register(socket, chatsTypingHandler, emitToUser)
	register(socket, chatsCreateHandler, emitToUser)
	register(socket, chatsDeleteHandler, emitToUser)
	register(socket, chatsGetHandler, emitToUser)
	register(socket, chatsSaveDraftHandler, emitToUser)
	register(socket, chatsUpdateHandler, emitToUser)
	register(socket, chatsAddPersonaHandler, emitToUser)
	register(socket, chatsAddGuestHandler, emitToUser)
	register(socket, chatsRemoveGuestHandler, emitToUser)
	register(socket, chatsBranchHandler, emitToUser)
	register(socket, chatsReassignRemovedParticipantHandler, emitToUser)
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
	register(socket, triggerNarratorResponseHandler, emitToUser)
	register(socket, chatsGetNarratorNameHandler, emitToUser)
	register(socket, toggleChatCharacterActiveHandler, emitToUser)
	register(socket, updateChatCharacterVisibilityHandler, emitToUser)
}
