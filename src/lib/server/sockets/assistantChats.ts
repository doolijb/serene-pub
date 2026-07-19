import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, and, or, inArray, asc } from "drizzle-orm"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"
import type { Handler } from "$lib/shared/events"
import { broadcastToChatUsers } from "./utils/broadcastHelpers"

/**
 * List assistant chats for the current user
 */
export const chatsListAssistantHandler: Handler<
	Sockets.Chats.List.Params,
	Sockets.Chats.List.Response
> = {
	event: "chats:listAssistant",
	async handler(socket, params, emitToUser) {
		const userId = socket.user!.id
		console.log("Fetching assistant chats for user:", userId)

		// Get assistant chats for this user
		const chatsList = await db.query.chats.findMany({
			where: (c, { eq, and }) =>
				and(eq(c.userId, userId), eq(c.chatType, ChatTypes.ASSISTANT)),
			orderBy: (c, { desc }) => desc(c.id)
		})

		console.log(`Found ${chatsList.length} assistant chats`)

		// This query is scoped to eq(c.userId, userId) above, so every row is
		// owned by the caller (no guest concept for assistant chats). Matches
		// the isOwner/isGuest/canEdit shape the real chats:list handler in
		// chats.ts adds; Sockets.Chats.List.Response requires them.
		const chatListWithPermissions = chatsList.map((chat) => ({
			...chat,
			isOwner: true,
			isGuest: false,
			canEdit: true
		}))

		const res: Sockets.Chats.List.Response = {
			chatList: chatListWithPermissions
		}
		emitToUser("chats:listAssistant", res)
		return res
	}
}

/**
 * Create a new assistant chat
 */
export const chatsCreateAssistantHandler: Handler<
	Sockets.Chats.CreateAssistant.Params,
	Sockets.Chats.CreateAssistant.Response
> = {
	event: "chats:createAssistant",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Create assistant chat
			const [chat] = await db
				.insert(schema.chats)
				.values({
					userId,
					name: "Assistant Chat",
					isGroup: false,
					chatType: ChatTypes.ASSISTANT
				})
				.returning()

			const res: Sockets.Chats.CreateAssistant.Response = {
				chat
			}
			emitToUser("chats:createAssistant", res)
			return res
		} catch (error) {
			console.error("Error in chatsCreateAssistantHandler:", error)
			const res: Sockets.Chats.CreateAssistant.Response = {
				error: "Failed to create assistant chat."
			}
			emitToUser("chats:createAssistant", res)
			return res
		}
	}
}

/**
 * Update character draft in chat metadata (auto-save)
 */
export const assistantUpdateDraftHandler: Handler<
	{ chatId: number; draft: any },
	{ success: boolean; error?: string }
> = {
	event: "assistant:updateDraft",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { chatId, draft } = params

			// Verify chat exists and user has access
			const chat = await db.query.chats.findFirst({
				where: (c, { eq, and }) =>
					and(eq(c.id, chatId), eq(c.userId, userId))
			})

			if (!chat) {
				return {
					success: false,
					error: "Chat not found or access denied"
				}
			}

			// Get metadata (now a JSON column)
			const metadata = chat.metadata || {}

			// Update the draft in dataEditor.create.characters[0]
			const updatedMetadata = {
				...metadata,
				dataEditor: {
					...metadata.dataEditor,
					create: {
						...metadata.dataEditor?.create,
						characters: [draft]
					}
				}
			}

			// Save to database (metadata is now a JSON column)
			await db
				.update(schema.chats)
				.set({ metadata: updatedMetadata })
				.where(eq(schema.chats.id, chatId))

			console.log(
				`[assistantUpdateDraftHandler] Draft auto-saved for chat ${chatId}`
			)

			// Broadcast updated chat to all users
			if (socket.io) {
				const updatedChat = await db.query.chats.findFirst({
					where: eq(schema.chats.id, chatId)
				})

				if (updatedChat) {
					await broadcastToChatUsers(socket.io, chatId, "chats:get", {
						chat: updatedChat
					})
				}
			}

			return { success: true }
		} catch (error) {
			console.error("Error in assistantUpdateDraftHandler:", error)
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to update draft"
			}
		}
	}
}
