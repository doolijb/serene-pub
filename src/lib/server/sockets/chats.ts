import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, asc, eq, inArray } from "drizzle-orm"
import { generateResponse } from "../utils/generateResponse"
import { getNextCharacterTurn } from "$lib/server/utils/getNextCharacterTurn"
import type { BaseConnectionAdapter } from "../connectionAdapters/BaseConnectionAdapter"
import { getConnectionAdapter } from "../utils/getConnectionAdapter"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { GroupReplyStrategies } from "$lib/shared/constants/GroupReplyStrategies"
import { InterpolationEngine } from "../utils/promptBuilder"

// --- Global map for active adapters ---
export const activeAdapters = new Map<string, BaseConnectionAdapter>()

// List all chats for the current user
export async function chatsList(
	socket: any,
	message: Sockets.ChatsList.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	const chatsList = await db.query.chats.findMany({
		with: {
			chatCharacters: {
				with: {
					character: true
				},
				orderBy: (cc, { asc }) => asc(cc.position)
			},
			chatPersonas: {
				with: {
					persona: true
				}
			}
		},
		where: (c, { eq }) => eq(c.userId, userId)
	})

	// Drizzle/Sqlite may not properly handle orderby,
	// Lets sort it manually
	// Order the chatCharacters by position
	chatsList.forEach((chat) => {
		chat.chatCharacters.sort(
			(a, b) => (a.position ?? 0) - (b.position ?? 0)
		)
		// Sort chatPersonas by position if it exists
		if (chat.chatPersonas) {
			chat.chatPersonas.sort(
				(a, b) => (a.position ?? 0) - (b.position ?? 0)
			)
		}
	})

	const res: Sockets.ChatsList.Response = { chatsList: chatsList as any }
	emitToUser("chatsList", res)
}

export async function createChat(
	socket: any,
	message: Sockets.CreateChat.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		const userId = 1 // Replace with actual user id
		const chatData: InsertChat = {
			...message.chat,
			userId,
			isGroup: message.characterIds.length > 1
		}
		const [newChat] = await db
			.insert(schema.chats)
			.values(chatData)
			.returning()
		for (const personaId of message.personaIds) {
			await db.insert(schema.chatPersonas).values({
				chatId: newChat.id,
				personaId
			})
		}
		for (const characterId of message.characterIds) {
			const position = message.characterPositions[characterId] || 0
			await db.insert(schema.chatCharacters).values({
				chatId: newChat.id,
				characterId,
				position
			})
		}
		// Insert a first message for every character assigned to the chat, ordered by position
		const chatCharacters = await db.query.chatCharacters.findMany({
			where: (cc, { eq }) => eq(cc.chatId, newChat.id),
			with: { character: true },
			orderBy: (cc, { asc }) => asc(cc.position ?? 0)
		})
		const chatPersona = await db.query.chatPersonas.findFirst({
			where: (cp, { eq, and, isNotNull }) => and(eq(cp.chatId, newChat.id), isNotNull(cp.personaId)),
			with: { persona: true },
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
		const resChat = await getChatFromDB(newChat.id, userId)
		if (!resChat) return
		await chatsList(socket, {}, emitToUser) // Refresh chat list
		const res: Sockets.CreateChat.Response = { chat: resChat as any }
		emitToUser("createChat", res)
	} catch (error) {
		console.error("Error creating chat:", error)
		emitToUser("error", { error: "Failed to create chat." })
	}
}

export async function chat(
	socket: any,
	message: Sockets.Chat.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	const chat = await getChatFromDB(message.id, userId) // Replace with actual user id
	if (chat) {
		const res: Sockets.Chat.Response = { chat: chat as any }
		emitToUser("chat", res)
	}
}

export const getChat = chat

// Helper to get chat with userId
async function getChatFromDB(chatId: number, userId: number) {
	const res = db.query.chats.findFirst({
		where: (c, { eq, and }) => and(eq(c.id, chatId), eq(c.userId, userId)),
		with: {
			chatPersonas: {
				with: { persona: true },
				orderBy: (cp, { asc }) => asc(cp.position)
			},
			chatCharacters: { with: { character: true } },
			chatMessages: {
				orderBy: (cm, { asc }) => asc(cm.id)
			}
		}
	})

	// Drizzle/Sqlite may not properly handle orderby,
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
	}
	return chat
}

// Returns complete chat data for prompt compilation
async function getPromptChatFromDb(chatId: number, userId: number) {
	const chat = await db.query.chats.findFirst({
		where: (c, { eq, and }) => and(eq(c.id, chatId), eq(c.userId, userId)),
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

export async function sendPersonaMessage(
	socket: any,
	message: Sockets.SendPersonaMessage.Call,
	emitToUser: (event: string, data: any) => void
) {
	const { chatId, personaId, content } = message
	const userId = 1 // Replace with actual user id
	let chat = await getPromptChatFromDb(chatId, userId)
	if (!chat) {
		// Return a valid but empty chatMessage object with required fields set to null or default
		const res: Sockets.SendPersonaMessage.Response = {
			chatMessage: null as any
		}
		emitToUser("sendPersonaMessage", res)
		return
	}
	const newMessage: InsertChatMessage = {
		userId,
		chatId,
		personaId,
		role: "user",
		content
	}
	const [inserted] = await db
		.insert(schema.chatMessages)
		.values(newMessage)
		.returning()
	// Instead of refreshing the chat, emit the new chatMessage
	await chatMessage(socket, { chatMessage: inserted as any }, emitToUser)
	const res: Sockets.SendPersonaMessage.Response = {
		chatMessage: inserted as any
	}
	emitToUser("sendPersonaMessage", res)

	// --- Round-robin character response loop ---
	let maxTurns = 20 // Prevent infinite loops in case of data issues
	let currentTurn = 1

	// Check if group and group reply strategy
	if (
		!chat.isGroup ||
		chat.groupReplyStrategy !== GroupReplyStrategies.MANUAL
	) {
		while (
			chat &&
			chat.chatCharacters.length > 0 &&
			currentTurn <= maxTurns
		) {
			currentTurn++
			// Always fetch the latest chat state at the start of each loop
			chat = await getPromptChatFromDb(chatId, userId)
			if (!chat) break
			const nextCharacterId = getNextCharacterTurn(
				{
					chatMessages: chat!.chatMessages,
					chatCharacters: chat!.chatCharacters.filter(
						(cc) => cc.character !== null
					) as any,
					chatPersonas: chat!.chatPersonas.filter(
						(cp) => cp.persona !== null
					) as any
				},
				{ triggered: false }
			)
			if (!nextCharacterId) {
				break
			}
			const nextCharacter = chat.chatCharacters.find(
				(cc) => cc.character && cc.character.id === nextCharacterId
			)

			if (!nextCharacter || !nextCharacter.character) break
			const assistantMessage: InsertChatMessage = {
				userId,
				chatId,
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
			await generateResponse({
				socket,
				emitToUser,
				chatId,
				userId,
				generatingMessage: generatingMessage as any
			})
		}
	}
}

export async function deleteChatMessage(
	socket: any,
	message: Sockets.DeleteChatMessage.Call,
	emitToUser: (event: string, data: any) => void
) {
	const chatMsg = await db.query.chatMessages.findFirst({
		where: (cm, { eq }) => eq(cm.id, message.id),
		columns: {
			chatId: true
		}
	})
	if (!chatMsg) {
		const res = { error: "Message not found." }
		emitToUser("error", res)
		return
	}
	const userId = 1 // Replace with actual user id
	await db
		.delete(schema.chatMessages)
		.where(
			and(
				eq(schema.chatMessages.id, message.id),
				eq(schema.chatMessages.userId, userId)
			)
		)
	await getChat(socket, { id: chatMsg.chatId }, emitToUser)
	const res: Sockets.DeleteChatMessage.Response = { id: message.id }
	emitToUser("deleteChatMessage", res)
}

export async function updateChatMessage(
	socket: any,
	message: Sockets.UpdateChatMessage.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	const data = { ...message.chatMessage }
	delete data.id // Remove id to avoid conflicts with update
	const [updated] = await db
		.update(schema.chatMessages)
		.set({ ...data })
		.where(
			and(
				eq(schema.chatMessages.id, message.chatMessage.id),
				eq(schema.chatMessages.userId, userId)
			)
		)
		.returning()
	// Instead of refreshing the chat, emit the updated chatMessage
	await chatMessage(socket, { chatMessage: updated as any }, emitToUser)
	const res: Sockets.UpdateChatMessage.Response = {
		chatMessage: updated as any
	}
	emitToUser("updateChatMessage", res)
}

export async function deleteChat(
	socket: any,
	message: Sockets.DeleteChat.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		const userId = 1 // Replace with actual user id
		await db
			.delete(schema.chats)
			.where(
				and(
					eq(schema.chats.id, message.id),
					eq(schema.chats.userId, userId)
				)
			)
		const res: Sockets.DeleteChat.Response = { id: message.id }
		emitToUser("deleteChat", res)
	} catch (error) {
		// Optionally emit a separate error event
	}
}

export async function regenerateChatMessage(
	socket: any,
	message: Sockets.RegenerateChatMessage.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	const chatMessage = await db.query.chatMessages.findFirst({
		where: (cm, { eq }) => eq(cm.id, message.id)
	})
	if (!chatMessage) {
		const res: Sockets.RegenerateChatMessage.Response = {
			error: "Message not found."
		}
		emitToUser("regenerateChatMessage", res)
		return
	}
	const chat = await getPromptChatFromDb(chatMessage.chatId, userId)
	if (!chat) {
		const res: Sockets.RegenerateChatMessage.Response = {
			error: "Error Regenerating Message: Chat not found."
		}
		emitToUser("regenerateChatMessage", res)
		return
	}

	const data: InsertChatMessage = {
		...chatMessage,
		content: "",
		isGenerating: true
	}
	delete data.id // Remove id to avoid conflicts with update

	// Check if we need to clear swipe history
	if (
		typeof (data.metadata?.swipes?.currentIdx || null) === "number" &&
		(data.metadata?.swipes?.history.length || 0) > 0
	) {
		data.metadata!.swipes!.history[data.metadata!.swipes!.currentIdx!] = ""
	}

	await db
		.update(schema.chatMessages)
		.set(data)
		.where(eq(schema.chatMessages.id, chatMessage.id))

	try {
		await generateResponse({
			socket,
			emitToUser,
			chatId: chat.id,
			userId,
			generatingMessage: {
				...chatMessage,
				isGenerating: true,
				content: ""
			} as any
		})
	} catch (error) {
		console.log("Error during regeneration:", error)
		let [canceledMsg] = await db
			.update(schema.chatMessages)
			.set({
				isGenerating: false
			})
			.where(eq(schema.chatMessages.id, message.id))
			.returning()
		emitToUser("chatMessage", { chatMessage: canceledMsg })
		emitToUser("error", {
			error: "Failed to regenerate message."
		})
	}
}

export async function promptTokenCount(
	socket: any,
	message: Sockets.PromptTokenCount.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		const userId = 1 // Replace with actual user id
		const chat = await getPromptChatFromDb(message.chatId, userId)
		if (!chat) {
			emitToUser("error", { error: "Error Generating Prompt Token Count: Chat not found." })
			return
		}
		const user = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.id, userId),
			with: {
				activeConnection: true,
				activeSamplingConfig: true,
				activeContextConfig: true,
				activePromptConfig: true
			}
		})
		if (
			!chat ||
			!user ||
			!user.activeConnection ||
			!user.activeSamplingConfig ||
			!user.activeContextConfig ||
			!user.activePromptConfig
		) {
			emitToUser("error", {
				error: "Incomplete configuration, failed to calculate token count."
			})
			return
		}
		let chatForPrompt = { ...chat, chatMessages: [...chat.chatMessages] }
		// if (message.content && message.role) {
		// 	// chatForPrompt.chatMessages.push({
		// 	// 	id: -1,
		// 	// 	chatId: chat.id,
		// 	// 	userId: userId,
		// 	// 	personaId: message.personaId ?? null,
		// 	// 	characterId: null,
		// 	// 	role: message.role,
		// 	// 	content: message.content,
		// 	// 	isEdited: 0,
		// 	// 	metadata: null,
		// 	// 	isGenerating: false,
		// 	// 	adapterId: null,
		// 	// 	isHidden: null
		// 	// })
		// }
		const currentCharacterId = getNextCharacterTurn(
			{
				chatMessages: chat.chatMessages,
				chatCharacters: chat.chatCharacters.filter(
					(cc: any) => cc && cc.character != null
				) as any,
				chatPersonas: chat.chatPersonas.filter(
					(cp: any) => cp && cp.persona != null
				) as any
			},
			{ triggered: true }
		)

		if (!currentCharacterId) {
			emitToUser("error", { error: "No character available for prompt." })
			return
		}

		const { Adapter } = getConnectionAdapter(user.activeConnection.type)

		// Provide required params for Adapter (use defaults if not available)
		const tokenCounter = new TokenCounters("estimate")
		const tokenLimit = 4096
		const contextThresholdPercent = 0.8

		const adapter = new Adapter({
			chat: chatForPrompt,
			connection: user.activeConnection,
			sampling: user.activeSamplingConfig,
			contextConfig: user.activeContextConfig,
			promptConfig: user.activePromptConfig,
			currentCharacterId,
			tokenCounter,
			tokenLimit,
			contextThresholdPercent
		})
		const promptResult: Sockets.PromptTokenCount.Response =
			await adapter.compilePrompt({})
		emitToUser(
			"promptTokenCount",
			promptResult as Sockets.PromptTokenCount.Response
		)
	} catch (error) {
		console.error("Error in promptTokenCount:", error)
		emitToUser("error", {
			error: "Failed to calculate prompt token count."
		})
	}
}

export async function abortChatMessage(
	socket: any,
	message: Sockets.AbortChatMessage.Call,
	emitToUser: (event: string, data: any) => void
) {
	let chatMsg = await db.query.chatMessages.findFirst({
		where: (cm, { eq }) => eq(cm.id, message.id)
	})

	if (!chatMsg) {
		return
	}

	const adapterId = chatMsg.adapterId
	if (!adapterId) {
		// Already cleared above
		return
	}

	[chatMsg] = await db
		.update(schema.chatMessages)
		.set({ isGenerating: false, adapterId: null })
		.where(eq(schema.chatMessages.id, message.id))
		.returning()

	const req: Sockets.ChatMessage.Call = {
		chatMessage: chatMsg
	}
	// Send updated chatMessage to the user
	await chatMessage(socket, req, emitToUser)

	const adapter = activeAdapters.get(adapterId)
	if (!adapter) {
		const res: Sockets.AbortChatMessage.Response = {
			id: message.id,
			success: true,
			info: "No active adapter, forcibly cleared."
		}
		emitToUser("chatMessage", res)
		emitToUser("abortChatMessage", res)
		return
	}
	try {
		adapter.abort()
		const res: Sockets.AbortChatMessage.Response = {
			id: message.id,
			success: true
		}
		emitToUser("chatMessage", res)
		emitToUser("abortChatMessage", res)
	} catch (e: any) {
		const res: Sockets.AbortChatMessage.Response = {
			id: message.id,
			success: false,
			error: e?.message || String(e)
		}
		emitToUser("chatMessage", res)
		emitToUser("abortChatMessage", res)
	}
}

export async function triggerGenerateMessage(
	socket: any,
	message: Sockets.TriggerGenerateMessage.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id

	const msgLimit = 10
	let currentMsg = 1
	let triggered = true
	let ok = true

	while (currentMsg <= msgLimit && ok) {
		let chat = await getPromptChatFromDb(message.chatId, userId)
		if (!chat) {
			const res: Sockets.TriggerGenerateMessage.Response = {
				error: "Error Triggering Chat Message: Chat not found."
			}
			emitToUser("triggerGenerateMessage", res)
			return
		}

		// Find the next character who should reply (using triggered: true)
		const nextCharacterId =
			message.characterId ||
			getNextCharacterTurn(
				{
					chatMessages: chat.chatMessages,
					chatCharacters: chat.chatCharacters.filter(
						(cc) => cc.character !== null
					) as any,
					chatPersonas: chat.chatPersonas.filter(
						(cp) => cp.persona !== null
					) as any
				},
				{ triggered }
			)

		if (!nextCharacterId) {
			break
		}
		if (chat && chat.chatCharacters.length > 0 && nextCharacterId) {
			const nextCharacter = chat.chatCharacters.find(
				(cc) => cc.character && cc.character.id === nextCharacterId
			)
			if (!nextCharacter || !nextCharacter.character) return
			const assistantMessage: InsertChatMessage = {
				userId,
				chatId: message.chatId,
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
			await chatMessage(
				socket,
				{ chatMessage: generatingMessage },
				emitToUser
			)
			ok = await generateResponse({
				socket,
				emitToUser,
				chatId: message.chatId,
				userId,
				generatingMessage: generatingMessage as any
			})
		}
		if (message.once) {
			break
		}
		currentMsg++
		triggered = false // After the first message, we don't trigger again
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

export async function updateChat(
	socket: any,
	message: Sockets.UpdateChat.Call,
	emitToUser: (event: string, data: any) => void
) {
	try {
		console.log("Updating chat with message:", message)
		const userId = 1 // Replace with actual user id

		//  Select the chat to compare data
		const existingChat = await getPromptChatFromDb(message.chat.id, userId)

		// Update chat main fields
		const data = { ...message.chat }
		delete data.id // Remove id to avoid conflicts
		await db
			.update(schema.chats)
			.set({
				...message.chat,
				isGroup: message.characterIds.length > 1,
				userId: undefined
			})
			.where(
				and(
					eq(schema.chats.id, message.chat.id),
					eq(schema.chats.userId, userId)
				)
			)

		// Remove any characters that are not in the new list
		const deletedCharacterIds =
			existingChat?.chatCharacters
				.filter(
					(c) => !message.characterIds.includes(c.characterId || 0)
				)
				.map((c) => c.characterId)
				.filter(
					(id): id is number => id !== null && id !== undefined
				) || []

		// Remove any personas that are not in the new list
		const deletedPersonaIds =
			existingChat?.chatPersonas
				.filter((p) => !message.personaIds.includes(p.personaId || 0))
				.map((p) => p.personaId)
				.filter(
					(id): id is number => id !== null && id !== undefined
				) || []

		// Find new character IDs that are not in the existing chat
		const newCharacterIds = message.characterIds.filter(
			(id) =>
				!existingChat?.chatCharacters.some((c) => c.characterId === id)
		)

		// Find new persona IDs that are not in the existing chat
		const newPersonaIds = message.personaIds.filter(
			(id) => !existingChat?.chatPersonas.some((p) => p.personaId === id)
		)

		// Delete characters that are no longer in the chat
		if (deletedCharacterIds.length > 0) {
			await db
				.delete(schema.chatCharacters)
				.where(
					and(
						eq(schema.chatCharacters.chatId, message.chat.id),
						inArray(
							schema.chatCharacters.characterId,
							deletedCharacterIds
						)
					)
				)
		}

		// Delete personas that are no longer in the chat
		if (deletedPersonaIds.length > 0) {
			await db
				.delete(schema.chatPersonas)
				.where(
					and(
						eq(schema.chatPersonas.chatId, message.chat.id),
						inArray(
							schema.chatPersonas.personaId,
							deletedPersonaIds
						)
					)
				)
		}

		// Insert new characters that are not already in the chat
		if (newCharacterIds.length > 0) {
			const newChatCharacters = newCharacterIds.map((characterId) => ({
				chatId: message.chat.id,
				characterId,
				position: message.characterPositions[characterId] ?? 0
			}))
			await db.insert(schema.chatCharacters).values(newChatCharacters)
		}

		// Insert new personas that are not already in the chat
		if (newPersonaIds.length > 0) {
			const newChatPersonas = newPersonaIds.map((personaId) => ({
				chatId: message.chat.id,
				personaId
			}))
			await db.insert(schema.chatPersonas).values(newChatPersonas)
		}

		// Update positions for all characters in the chat (not just new ones)
		if (message.characterPositions) {
			for (const characterId of message.characterIds) {
				const position = message.characterPositions[characterId]
				console.log(
					"Updating position for characterId",
					characterId,
					"to",
					position
				)
				if (typeof position === "number") {
					await db
						.update(schema.chatCharacters)
						.set({ position })
						.where(
							and(
								eq(
									schema.chatCharacters.chatId,
									message.chat.id
								),
								eq(
									schema.chatCharacters.characterId,
									characterId
								)
							)
						)
				}
			}
		}

		// After updating character positions in the DB, also update the position field for existing characters
		if (message.characterPositions) {
			for (const [characterId, position] of Object.entries(
				message.characterPositions
			)) {
				await db
					.update(schema.chatCharacters)
					.set({ position })
					.where(
						and(
							eq(schema.chatCharacters.chatId, message.chat.id),
							eq(
								schema.chatCharacters.characterId,
								Number(characterId)
							)
						)
					)
			}
		}

		// Insert a first message for every new character added to the chat, ordered by position
		if (newCharacterIds.length > 0) {
			const newChatCharacters = await db.query.chatCharacters.findMany({
				where: (cc, { eq }) => eq(cc.chatId, message.chat.id),
				with: { character: true },
				orderBy: (cc, { asc }) => asc(cc.position ?? 0)
			})
			const chatPersona = await db.query.chatPersonas.findFirst({
				where: (cp, { eq, and, isNotNull }) => and(eq(cp.chatId, message.chat.id), isNotNull(cp.personaId)),
				with: { persona: true },
				orderBy: (cp, { asc }) => asc(cp.position ?? 0)
			})
			for (const cc of newChatCharacters) {
				if (!cc.character) continue
				if (!newCharacterIds.includes(cc.character.id)) continue
				const greetings = buildCharacterFirstChatMessage({
					character: cc.character,
					persona: chatPersona?.persona,
					isGroup: message.characterIds.length > 1
				})
				if (greetings.length > 0) {
					const newMessage: InsertChatMessage = {
						userId,
						chatId: message.chat.id,
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
		}

		// Fetch the updated chat with all relations
		const resChat = await getChatFromDB(message.chat.id, userId)

		if (!resChat) return
		const res: Sockets.UpdateChat.Response = { chat: resChat as any }
		await chatsList(socket, {}, emitToUser)
		emitToUser("updateChat", res)
	} catch (error) {
		console.error("Error updating chat:", error)
		emitToUser("error", { error: "Failed to update chat." })
	}
}

export async function chatMessageSwipeRight(
	socket: any,
	message: Sockets.ChatMessageSwipeRight.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	const chat = await db.query.chats.findFirst({
		where: (c, { eq, and }) =>
			and(eq(c.id, message.chatId), eq(c.userId, userId)),
		with: {
			chatMessages: true
		}
	})
	if (!chat) {
		const res = {
			error: "Error Swiping Chat Message Right: Chat not found."
		}
		emitToUser("error", res)
		return
	}
	const chatMessage = chat.chatMessages.find(
		(cm) => cm.id === message.chatMessageId
	)
	if (!chatMessage) {
		const res = {
			error: "Chat message not found."
		}
		emitToUser("error", res)
		return
	}

	if (chatMessage.isGenerating) {
		const res = {
			error: "Message is still generating, please wait."
		}
		emitToUser("error", res)
		return
	}

	if (chatMessage.isHidden) {
		const res = {
			error: "Message is hidden, cannot swipe right."
		}
		emitToUser("error", res)
		return
	}

	if (chatMessage.role !== "assistant") {
		const res = {
			error: "Only assistant messages can be swiped right."
		}
		emitToUser("error", res)
		return
	}

	interface MetaData {
		swipes?: {
			currentIdx: number | null
			history: string[]
		}
	}

	let isOnLastSwipe = false

	// Check if metadata.swipes, if not, initialize it
	const data: SelectChatMessage = {
		...chatMessage,
		metadata: {
			...chatMessage.metadata,
			swipes: {
				currentIdx: null,
				history: [],
				...(chatMessage.metadata?.swipes || {})
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
			data.metadata!.swipes!.history[data.metadata!.swipes!.currentIdx] ||
			""
	} else {
		if (data.metadata!.swipes!.currentIdx === null) {
			;(data.metadata!.swipes!.currentIdx = 0),
				data.metadata!.swipes!.history.push(data.content)
		}
		// Now increment the current index and content
		data.metadata!.swipes!.currentIdx += 1
		data.content = "" // Clear the message content
		data.isGenerating = true // Set generating state to true
		// Push the new empty content to history
		data.metadata!.swipes!.history.push("") // Add an empty string to history
	}

	delete data.id

	// Update the chat message in the database
	const [updatedMessage] = await db
		.update(schema.chatMessages)
		.set({ ...data })
		.where(eq(schema.chatMessages.id, chatMessage.id))
		.returning()

	if (!updatedMessage) {
		const res = {
			error: "Failed to update chat message."
		}
		emitToUser("error", res)
		return
	}

	if (!updatedMessage.isGenerating) {
		// If the message is not generating, emit the updated chatMessage
		const chatMsgRes: Sockets.ChatMessage.Response = {
			chatMessage: updatedMessage as any
		}
		emitToUser("chatMessage", chatMsgRes)
		const res: Sockets.ChatMessageSwipeRight.Response = {
			chatId: chat.id,
			chatMessageId: updatedMessage.id,
			done: true
		}

		emitToUser("chatMessageSwipeRight", res)
		return
	}

	// If the message is generating, we need to start generating a response
	await generateResponse({
		socket,
		emitToUser,
		chatId: chat.id,
		userId,
		generatingMessage: updatedMessage as any
	})

	const res: Sockets.ChatMessageSwipeRight.Response = {
		chatId: chat.id,
		chatMessageId: updatedMessage.id,
		done: true
	}

	emitToUser("chatMessageSwipeRight", res)
}

export async function chatMessageSwipeLeft(
	socket: any,
	message: Sockets.ChatMessageSwipeLeft.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	const chat = await db.query.chats.findFirst({
		where: (c, { eq, and }) =>
			and(eq(c.id, message.chatId), eq(c.userId, userId)),
		with: {
			chatMessages: true
		}
	})
	if (!chat) {
		const res = {
			error: "Error Swiping Chat Message Left: Chat not found."
		}
		emitToUser("error", res)
		return
	}
	const chatMessage = chat.chatMessages.find(
		(cm) => cm.id === message.chatMessageId
	)
	if (!chatMessage) {
		const res = {
			error: "Chat message not found."
		}
		emitToUser("error", res)
		return
	}

	if (chatMessage.isGenerating) {
		const res = {
			error: "Message is still generating, please wait."
		}
		emitToUser("error", res)
		return
	}

	if (chatMessage.isHidden) {
		const res = {
			error: "Message is hidden, cannot swipe right."
		}
		emitToUser("error", res)
		return
	}

	if (chatMessage.role !== "assistant") {
		const res = {
			error: "Only assistant messages can be swiped right."
		}
		emitToUser("error", res)
		return
	}

	interface MetaData {
		swipes?: {
			currentIdx: number | null
			history: string[]
		}
	}

	let isOnLastSwipe = false

	// Check if metadata.swipes, if not, initialize it
	const data: SelectChatMessage = {
		...chatMessage,
		metadata: {
			...chatMessage.metadata,
			swipes: {
				currentIdx: null,
				history: [],
				...(chatMessage.metadata?.swipes || {})
			}
		}
	}

	// Check if we are on the last left swipe (idx=0|null) (or if there are no swipes)
	if (
		!data.metadata!.swipes!.history.length ||
		data.metadata!.swipes!.currentIdx === null ||
		data.metadata!.swipes!.currentIdx === 0
	) {
		isOnLastSwipe = true
	} else {
		isOnLastSwipe =
			data.metadata!.swipes!.currentIdx === 0 &&
			data.metadata!.swipes!.history.length > 0
	}

	// If we are on the last left swipe, return an error
	if (isOnLastSwipe) {
		const res = {
			error: "Already on the last left swipe, cannot swipe left."
		}
		emitToUser("error", res)
		return
	}

	// If not on the last left swipe, just update the current index and content
	data.metadata!.swipes!.currentIdx =
		(data.metadata!.swipes!.currentIdx || 0) - 1
	data.content =
		data.metadata!.swipes!.history[data.metadata!.swipes!.currentIdx] || "" // Set content to the previous swipe content
	// Update the chat message in the database
	delete data.id
	const [updatedMessage] = await db
		.update(schema.chatMessages)
		.set({ ...data })
		.where(eq(schema.chatMessages.id, chatMessage.id))
		.returning()

	if (!updatedMessage) {
		const res = {
			error: "Failed to update chat message."
		}
		emitToUser("error", res)
		return
	}

	const chatRes: Sockets.ChatMessage.Response = {
		chatMessage: updatedMessage
	}
	socket.emit("chatMessage", chatRes)
	const res: Sockets.ChatMessageSwipeLeft.Response = {
		chatId: chat.id,
		chatMessageId: updatedMessage.id,
		done: true
	}
	emitToUser("chatMessageSwipeLeft", res)
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
	console.log("Building first chat message for character:", character.name)
	const history: string[] = []
	const engine = new InterpolationEngine()
	const context = engine.createInterpolationContext({
		currentCharacterName: character.nickname || character.name,
		currentPersonaName: persona?.name || "User",
	})
	if (!isGroup || !character.groupOnlyGreetings?.length) {
		if (character.firstMessage) {
			history.push(engine.interpolateString(character.firstMessage.trim(), context)!)
		}
		if (character.alternateGreetings) {
			history.push(...character.alternateGreetings.map((g) => engine.interpolateString(g.trim(), context)!))
		}
	} else if (character.groupOnlyGreetings?.length) {
		// If this is a group chat, use only group greetings
		history.push(...character.groupOnlyGreetings.map((g) => engine.interpolateString(g.trim(), context)!))
	} else {
		// Fallback firstMessage if no greetings are available
		history.push(
			`Sits down at the table, "I didn't think you'd show up so soon."`
		)
	}
	return history
}

export async function toggleChatCharacterActive(
	socket: any,
	message: Sockets.ToggleChatCharacterActive.Call,
	emitToUser: (event: string, data: any) => void
) {
	const userId = 1 // Replace with actual user id
	if (!userId) return

	const chat = await db.query.chats.findFirst({
		where: (c, { eq, and }) =>
			and(eq(c.id, message.chatId), eq(c.userId, userId)),
		with: {
			chatCharacters: {
				where: (cc, { eq }) => eq(cc.characterId, message.characterId)
			}
		}
	})
	if (!chat) {
		const res = {
			error: "Error toggling character active: Chat not found."
		}
		emitToUser("error", res)
		return
	}

	if (!chat.chatCharacters || chat.chatCharacters.length === 0) {
		const res = {
			error: "Chat character not found."
		}
		emitToUser("error", res)
		return
	}

	const chatCharacter = chat.chatCharacters[0]

	await db
		.update(schema.chatCharacters)
		.set({ isActive: !chatCharacter.isActive })
		.where(
			and(
				eq(schema.chatCharacters.characterId, message.characterId),
				eq(schema.chatCharacters.chatId, message.chatId)
			)
		)

	const res: Sockets.ToggleChatCharacterActive.Response = {
		chatId: message.chatId,
		characterId: message.characterId,
		isActive: !chatCharacter.isActive
	}

	emitToUser("toggleChatCharacterActive", res)

	await getChat(socket, { id: chat.id }, emitToUser)
}
