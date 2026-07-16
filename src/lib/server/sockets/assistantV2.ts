/**
 * New Assistant Socket Handler (v2)
 *
 * Uses AssistantService for clean tool-based interactions.
 * Replaces the old reasoning-based system with structured tool calling.
 */

import type { Server, Socket } from "socket.io"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, and, ne } from "drizzle-orm"
import { AssistantService } from "$lib/server/assistant/AssistantService"
import { getConnectionAdapter } from "$lib/server/utils/getConnectionAdapter"
import { getUserConfigurations } from "$lib/server/utils/getUserConfigurations"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"
import { broadcastToChatUsers } from "./utils/broadcastHelpers"
import { v4 as uuidv4 } from "uuid"
import { llmQueue, isQueueCancellation } from "$lib/server/utils/llmQueue"
import { persistGenerationStage, persistGenerationErrorRow } from "$lib/server/utils/generationStatus"

export function handleAssistantV2(io: Server, socket: Socket, userId: number) {
	console.log("[AssistantV2] Registering handlers for user", userId)

	/**
	 * Send a message in an assistant chat
	 */
	socket.on(
		"assistant:sendMessageV2",
		async (data: { chatId: number; content: string }) => {
			let assistantMessage: typeof schema.chatMessages.$inferSelect | undefined
			const { chatId } = data
			try {
				const { content } = data

				console.log("[AssistantV2] Received message for chat", chatId)

				// Validate input parameters
				if (!content || typeof content !== "string") {
					socket.emit("assistant:errorV2", {
						chatId,
						error: "Message content is required"
					})
					return
				}

				// Trim and validate content length
				const trimmedContent = content.trim()
				if (trimmedContent.length === 0) {
					socket.emit("assistant:errorV2", {
						chatId,
						error: "Message cannot be empty"
					})
					return
				}

				if (trimmedContent.length > 50000) {
					socket.emit("assistant:errorV2", {
						chatId,
						error: "Message too long (max 50,000 characters)"
					})
					return
				}

				// Verify chat exists and user has access
				const chatOwnership = await db.query.chats.findFirst({
					where: eq(schema.chats.id, chatId),
					columns: { userId: true, chatType: true }
				})

				if (!chatOwnership) {
					socket.emit("assistant:errorV2", {
						chatId,
						error: "Chat not found"
					})
					return
				}

				// Verify it's an assistant chat
				if (chatOwnership.chatType !== ChatTypes.ASSISTANT) {
					socket.emit("assistant:errorV2", {
						chatId,
						error: "This is not an assistant chat"
					})
					return
				}

				// Verify user owns the chat (assistant chats don't support guests)
				if (chatOwnership.userId !== userId) {
					socket.emit("assistant:errorV2", {
						chatId,
						error: "Access denied. You do not own this chat."
					})
					return
				}

				// 1. Save user message to database
				const [userMessage] = await db
					.insert(schema.chatMessages)
					.values({
						chatId,
						userId,
						role: "user",
						content: trimmedContent,
						metadata: {}
					})
					.returning()

				// Broadcast user message to all chat users
				await broadcastToChatUsers(io, chatId, "chatMessage", {
					chatId,
					chatMessage: userMessage
				})

				// 2. Create placeholder assistant message
				;[assistantMessage] = await db
					.insert(schema.chatMessages)
					.values({
						chatId,
						userId,
						role: "assistant",
						content: "",
						isGenerating: true,
						generationStage: "queued",
						metadata: {}
					})
					.returning()

				// Broadcast placeholder to all chat users
				await broadcastToChatUsers(io, chatId, "chatMessage", {
					chatId,
					chatMessage: assistantMessage
				})

				// 3. Load full chat with messages (excluding the generating message)
				const chat = await db.query.chats.findFirst({
					where: eq(schema.chats.id, chatId),
					with: {
						chatCharacters: {
							with: {
								character: {
									with: {
										lorebook: true
									}
								}
							}
						},
						chatPersonas: {
							with: {
								persona: true
							}
						},
						chatMessages: {
							where: ne(
								schema.chatMessages.id,
								assistantMessage.id
							),
							orderBy: (cm, { asc }) => asc(cm.id)
						},
						lorebook: true
					}
				})

				if (!chat) {
					throw new Error("Chat not found")
				}

				// 4. Get user's configurations
				const { connection, sampling, contextConfig, promptConfig } =
					await getUserConfigurations(userId)

				if (!connection) {
					throw new Error("No AI connection configured. Please set up a connection first.")
				}

				// 5. Create adapter instance
				const { Adapter } = await getConnectionAdapter(connection.type)
				const tokenCounter = new TokenCounters("estimate")
				const tokenLimit = 4096
				const contextThresholdPercent = 0.8

				const adapter = new Adapter({
					chat,
					connection,
					sampling,
					contextConfig,
					promptConfig,
					currentCharacterId: null,
					tokenCounter,
					tokenLimit,
					contextThresholdPercent,
					isAssistantMode: true,
					generatingMessageMetadata: {}
				})

				// 6. Create AssistantService and generate response
				const assistantService = new AssistantService(
					adapter,
					userId,
					chatId,
					socket
				)

				// Persist the queue item id BEFORE enqueueing so cancellation can
				// always find it — same race-window fix as generateResponse.ts.
				const queueItemId = uuidv4()
				await db
					.update(schema.chatMessages)
					.set({ queueItemId })
					.where(eq(schema.chatMessages.id, assistantMessage.id))

				// Treat the whole tool-calling turn as a single queue slot rather
				// than instrumenting each internal LLM call — assistant turns have
				// no per-call UI today, so the coarser granularity is fine.
				const { done } = llmQueue.enqueue(
					{
						taskType: "chat",
						connectionName: connection.name,
						samplingName: sampling.name,
						chatId,
						messageId: assistantMessage.id,
						label: "assistant",
						userId,
						preflight: (signal) => adapter.preflight(signal),
						execute: () => assistantService.generateResponse(trimmedContent),
						onCancel: () => adapter.abort(),
						onStatusChange: (status) =>
							persistGenerationStage(assistantMessage!.id, chatId, io, status)
					},
					queueItemId
				)
				const result = await done

				// 7. Update assistant message with result
				if (result.success && result.message) {
					await db
						.update(schema.chatMessages)
						.set({
							content: result.message,
							isGenerating: false,
							generationStage: null,
							queueItemId: null,
							error: null,
							metadata: {
								toolsUsed: result.toolsUsed || []
							} as any
						})
						.where(eq(schema.chatMessages.id, assistantMessage.id))

					// Fetch updated message
					const updatedMessage =
						await db.query.chatMessages.findFirst({
							where: eq(
								schema.chatMessages.id,
								assistantMessage.id
							)
						})

					// Broadcast final message to all chat users
					await broadcastToChatUsers(io, chatId, "chatMessage", {
						chatId,
						chatMessage: updatedMessage
					})

					// If metadata was updated (e.g., draft created), fetch and emit updated chat
					if (result.metadataUpdated) {
						const updatedChat = await db.query.chats.findFirst({
							where: eq(schema.chats.id, chatId),
							columns: { metadata: true }
						})

						if (updatedChat) {
							console.log(
								"[AssistantV2] Emitting metadata update"
							)
							await broadcastToChatUsers(
								io,
								chatId,
								"assistant:metadataUpdated",
								{
									chatId,
									metadata: updatedChat.metadata
								}
							)
						}
					}

					// Send completion event to requesting socket only
					socket.emit("assistant:completeV2", {
						chatId,
						messageId: assistantMessage.id,
						toolsUsed: result.toolsUsed || []
					})
				} else {
					// Handle error
					await db
						.update(schema.chatMessages)
						.set({
							content: `Error: ${result.error || "Unknown error"}`,
							isGenerating: false,
							generationStage: null,
							queueItemId: null,
							error: { message: result.error || "Failed to generate response" },
							metadata: { error: true } as any
						})
						.where(eq(schema.chatMessages.id, assistantMessage.id))

					// Fetch error message
					const errorMessage = await db.query.chatMessages.findFirst({
						where: eq(schema.chatMessages.id, assistantMessage.id)
					})

					// Broadcast error message to all chat users
					await broadcastToChatUsers(io, chatId, "chatMessage", {
						chatId,
						chatMessage: errorMessage
					})

					// Send error event to requesting socket only
					socket.emit("assistant:errorV2", {
						chatId,
						error: result.error || "Failed to generate response"
					})
				}
			} catch (error) {
				console.error("[AssistantV2] Error:", error)
				if (isQueueCancellation(error)) {
					// User-initiated stop already flipped isGenerating/queueItemId/error
					// on the row via the cancel handler — nothing left to persist.
					return
				}
				if (assistantMessage) {
					await persistGenerationErrorRow(io, chatId, assistantMessage.id, error)
				}
				socket.emit("assistant:errorV2", {
					chatId,
					error:
						error instanceof Error ? error.message : "Unknown error"
				})
			}
		}
	)

	console.log("[AssistantV2] Handlers registered")
}
