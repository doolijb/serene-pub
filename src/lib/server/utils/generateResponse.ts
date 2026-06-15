import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq } from "drizzle-orm"
import { v4 as uuidv4 } from "uuid"
import { activeAdapters, chatMessage } from "../sockets/chats"
import { getConnectionAdapter } from "./getConnectionAdapter"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { getUserConfigurations } from "./getUserConfigurations"
import { broadcastToChatUsers } from "../sockets/utils/broadcastHelpers"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"
import { generateChatTitle } from "./generateChatTitle"
import { parseReasoningFormat } from "./parseReasoningFormat"

/**
 * Handles reasoning format detection and processing for assistant mode
 * @returns true if waiting for user function selection, false if continuing with generation
 */
async function handleAssistantReasoning({
	content,
	socket,
	chatId,
	generatingMessage,
	adapterId,
	emitToUser,
	userId
}: {
	content: string
	socket: any
	chatId: number
	generatingMessage: SelectChatMessage
	adapterId: string
	emitToUser: (event: string, data: any) => void
	userId: number
}): Promise<boolean | null> {
	console.log("[handleAssistantReasoning] Parsing for reasoning format...")
	const reasoningParsed = parseReasoningFormat(content)

	console.log(
		"[handleAssistantReasoning] Parse result:",
		reasoningParsed ? "DETECTED" : "NOT DETECTED"
	)
	if (reasoningParsed) {
		console.log(
			"[handleAssistantReasoning] Reasoning text:",
			reasoningParsed.reasoning
		)
		console.log(
			"[handleAssistantReasoning] Function calls count:",
			reasoningParsed.functionCalls.length
		)
		if (reasoningParsed.functionCalls.length > 0) {
			console.log(
				"[handleAssistantReasoning] Function calls:",
				JSON.stringify(reasoningParsed.functionCalls, null, 2)
			)
		}
	}

	if (!reasoningParsed) {
		return null // No reasoning detected, continue with normal flow
	}

	if (reasoningParsed.functionCalls.length > 0) {
		// Functions needed - emit to client and wait for selection
		console.log(
			"[handleAssistantReasoning] Function calls detected, waiting for user selection"
		)

		socket.emit("assistant:reasoningDetected", {
			chatId,
			messageId: generatingMessage.id,
			reasoning: reasoningParsed.reasoning,
			functionCalls: reasoningParsed.functionCalls
		})

		// Update message: store reasoning in metadata, keep content empty, mark as waiting
		const currentMetadata =
			typeof generatingMessage.metadata === "object" &&
			generatingMessage.metadata !== null
				? generatingMessage.metadata
				: {}

		await db
			.update(schema.chatMessages)
			.set({
				content: "",
				isGenerating: false,
				adapterId: null,
				metadata: {
					...currentMetadata,
					reasoning: reasoningParsed.reasoning,
					waitingForFunctionSelection: true
				}
			})
			.where(eq(schema.chatMessages.id, generatingMessage.id))

		const updatedMessage = await db.query.chatMessages.findFirst({
			where: (cm, { eq }) => eq(cm.id, generatingMessage.id)
		})

		if (updatedMessage) {
			await broadcastToChatUsers(socket.io, chatId, "chatMessage", {
				chatMessage: updatedMessage
			})
		}

		activeAdapters.delete(adapterId)
		return true // Wait for user selection
	} else {
		// No functions needed - store reasoning and regenerate for final response
		console.log(
			"[handleAssistantReasoning] No functions needed, regenerating for conversational response"
		)

		const currentMetadata =
			typeof generatingMessage.metadata === "object" &&
			generatingMessage.metadata !== null
				? generatingMessage.metadata
				: {}

		await db
			.update(schema.chatMessages)
			.set({
				content: "",
				isGenerating: true, // Keep generating for second pass
				metadata: {
					...currentMetadata,
					reasoning: reasoningParsed.reasoning
				}
			})
			.where(eq(schema.chatMessages.id, generatingMessage.id))

		// Re-fetch message and call generateResponse again
		const updatedGeneratingMessage = await db.query.chatMessages.findFirst({
			where: (cm, { eq }) => eq(cm.id, generatingMessage.id)
		})

		if (!updatedGeneratingMessage) {
			console.error(
				"[handleAssistantReasoning] Failed to fetch updated message"
			)
			activeAdapters.delete(adapterId)
			return false
		}

		activeAdapters.delete(adapterId)

		// Recursive call for conversational response
		return await generateResponse({
			socket,
			emitToUser,
			chatId,
			userId,
			generatingMessage: updatedGeneratingMessage
		})
	}
}

export async function generateResponse({
	socket,
	emitToUser,
	chatId,
	userId,
	generatingMessage
}: {
	socket: any
	emitToUser: (event: string, data: any) => void
	chatId: number
	userId: number
	generatingMessage: SelectChatMessage
}): Promise<boolean> {
	// Generate a UUID for this adapter instance
	const adapterId = uuidv4()

	// Get the current message content before updating
	const currentMessage = await db.query.chatMessages.findFirst({
		where: (cm, { eq }) => eq(cm.id, generatingMessage.id)
	})
	const preservedContent = currentMessage?.content || ""

	// Save the adapterId to the chatMessage
	// For continue: preserve existing content
	// For new generation: clear content
	await db
		.update(schema.chatMessages)
		.set({
			isGenerating: true,
			content: preservedContent, // Preserve existing content for continue
			adapterId
		})
		.where(eq(schema.chatMessages.id, generatingMessage.id))
	// Instead of getChat, emit the chatMessage

	const req: Sockets.ChatMessage.Call = {
		chatMessage: {
			...generatingMessage,
			isGenerating: true,
			content: preservedContent, // Use existing content
			adapterId
		}
	}

	await broadcastToChatUsers(
		socket.io,
		generatingMessage.chatId,
		"chatMessage",
		req
	)

	// Determine if we're continuing an existing message
	const isContinuing = preservedContent.length > 0

	const chat = await db.query.chats.findFirst({
		where: (c, { eq }) => eq(c.id, chatId),
		with: {
			chatCharacters: {
				with: {
					character: true
				}
			},
			chatPersonas: {
				with: {
					persona: true
				}
			},
			chatMessages: {
				// Always exclude the generating message from history
				where: (cm, { ne }) => ne(cm.id, generatingMessage.id),
				orderBy: (cm, { asc }) => asc(cm.id)
			},
			lorebook: true
		}
	})

	// If continuing, signal the PromptBuilder to use preservedContent as the
	// prefill (-2 placeholder) rather than inserting a duplicate message.
	// Adding a separate synthetic message causes two consecutive assistant
	// entries in chat-completion APIs and a wrongly-closed block for text-
	// completion formats.
	if (isContinuing && chat) {
		;(chat as any)._continuationPrefill = preservedContent
	}

	// Get user and their configurations with fallbacks
	const { connection, sampling, contextConfig, promptConfig } =
		await getUserConfigurations(userId)

	const { Adapter } = getConnectionAdapter(connection.type)

	const tokenCounter = new TokenCounters("estimate")
	const tokenLimit = 4096
	const contextThresholdPercent = 0.8

	// Detect assistant mode
	const isAssistantMode = chat?.chatType === ChatTypes.ASSISTANT

	// Get fresh metadata from the generating message (important for reasoning detection)
	const generatingMessageMetadata = (generatingMessage.metadata as any) || {}

	const adapter = new Adapter({
		chat,
		connection: connection,
		sampling: sampling,
		contextConfig: contextConfig,
		promptConfig: promptConfig,
		currentCharacterId: isAssistantMode
			? null
			: generatingMessage.characterId!,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent,
		isAssistantMode,
		generatingMessageMetadata
	})
	// Store adapter in global map
	activeAdapters.set(adapterId, adapter)

	// For assistant mode, no character name prefix
	const currentCharacter = chat?.chatCharacters?.find(
		(cc) => cc.character?.id === adapter.currentCharacterId
	)

	const charName = isAssistantMode
		? ""
		: currentCharacter?.character?.nickname ||
			currentCharacter?.character?.name ||
			""

	// If message already has content, we're continuing it
	// Include the existing content in the startString so LLM continues from there
	// Use preservedContent which was fetched from the database earlier
	const existingContent = preservedContent || ""
	const startString = existingContent
		? charName
			? `${charName}: ${existingContent}`
			: existingContent
		: charName
			? `${charName}:`
			: ""

	// Generate completion
	let { completionResult, compiledPrompt, isAborted } =
		await adapter.generate() // TODO: save compiledPrompt to chatMessages
	let content = ""
	try {
		if (typeof completionResult === "function") {
			let ok = true
			await completionResult(async (chunk: string) => {
				if (!ok) {
					return
				}
				content += chunk

				let stagedContent = content.replace(startString, "")
				// If stagedContent length is <= startString, remove partial startString
				if (stagedContent.length <= startString.length) {
					// Check if content starts with startString substring
					if (
						content.startsWith(
							startString.substring(0, stagedContent.length)
						)
					) {
						stagedContent = ""
					}
				}

				// When continuing, the LLM sees the partial message in history
				// and generates a continuation. We should append the new content
				// to the existing partial content.
				const finalContent = isContinuing
					? preservedContent + " " + stagedContent.trim()
					: stagedContent.trim()

				// --- SWIPE HISTORY LOGIC ---
				let updateData: any = {
					content: finalContent,
					isGenerating: true
				}
				if (
					generatingMessage.metadata &&
					generatingMessage.metadata.swipes &&
					typeof generatingMessage.metadata.swipes.currentIdx ===
						"number" &&
					generatingMessage.metadata.swipes.currentIdx > 0 &&
					Array.isArray(generatingMessage.metadata.swipes.history)
				) {
					const idx = generatingMessage.metadata.swipes.currentIdx
					const history: string[] = [
						...generatingMessage.metadata.swipes.history
					]
					history[idx] = content
					updateData = {
						...updateData,
						metadata: {
							...generatingMessage.metadata,
							swipes: {
								...generatingMessage.metadata.swipes,
								history
							}
						}
					}
				}

				const [updatedChatMsg] = await db
					.update(schema.chatMessages)
					.set(updateData)
					.where(
						and(
							eq(schema.chatMessages.id, generatingMessage.id),
							eq(schema.chatMessages.isGenerating, true)
						)
					)
					.returning()
				if (!!updatedChatMsg) {
					// Removed verbose streaming log
					const chatMsgReq: Sockets.ChatMessage.Call = {
						chatMessage: updatedChatMsg
					}
					await broadcastToChatUsers(
						socket.io,
						generatingMessage.chatId,
						"chatMessage",
						chatMsgReq
					)
				} else {
					const chatMsgReq: Sockets.ChatMessage.Call = {
						id: generatingMessage.id
					}
					await broadcastToChatUsers(
						socket.io,
						generatingMessage.chatId,
						"chatMessage",
						chatMsgReq
					)
					console.warn(
						"[generateResponse] Generating terminated early",
						generatingMessage.id
					)
					ok = false
				}
			})

			// Final update: mark as not generating, clear adapterId
			content = content.replace(startString, "").trim()

			// When continuing, append to existing content
			if (isContinuing) {
				content = preservedContent + " " + content
			}

			console.log(
				"[generateResponse] POST-STREAM: Final content length:",
				content.length
			)
			console.log(
				"[generateResponse] POST-STREAM: Is assistant mode:",
				isAssistantMode
			)
			console.log(
				"[generateResponse] POST-STREAM: First 300 chars:",
				content.substring(0, 300)
			)

			// Check for reasoning format in assistant mode - only after streaming is complete
			if (isAssistantMode) {
				const reasoningResult = await handleAssistantReasoning({
					content,
					socket,
					chatId,
					generatingMessage,
					adapterId,
					emitToUser,
					userId
				})

				// If reasoning was detected and handled, return the result
				if (reasoningResult !== null) {
					return reasoningResult
				}
			}

			// Normal completion - no reasoning detected
			const ret = await db
				.update(schema.chatMessages)
				.set({ content, isGenerating: false, adapterId: null })
				.where(
					and(
						eq(schema.chatMessages.id, generatingMessage.id),
						eq(schema.chatMessages.isGenerating, true)
					)
				)
				.returning()
			if (!ret || ret.length === 0) {
				console.error(
					"[generateResponse] Failed to update generating message:",
					generatingMessage.id
				)
				activeAdapters.delete(adapterId)
				return false
			}
			// Broadcast the chatMessage to all chat participants
			await broadcastToChatUsers(
				socket.io,
				generatingMessage.chatId,
				"chatMessage",
				{
					chatMessage: {
						...generatingMessage,
						content,
						isGenerating: false,
						adapterId: null
					}
				}
			)
		} else {
			content = completionResult.replace(startString, "").trim()

			// When continuing, append to existing content
			const finalContent = isContinuing
				? preservedContent + " " + content
				: content

			// Check for reasoning format in assistant mode (NON-STREAMING)
			if (isAssistantMode) {
				const reasoningResult = await handleAssistantReasoning({
					content: finalContent,
					socket,
					chatId,
					generatingMessage,
					adapterId,
					emitToUser,
					userId
				})

				// If reasoning was detected and handled, return the result
				if (reasoningResult !== null) {
					return reasoningResult
				}
			}

			// --- SWIPE HISTORY LOGIC (non-streamed) ---
			let updateData: any = {
				content: finalContent,
				isGenerating: false,
				adapterId: null
			}
			if (
				generatingMessage.metadata &&
				generatingMessage.metadata.swipes &&
				typeof generatingMessage.metadata.swipes.currentIdx ===
					"number" &&
				generatingMessage.metadata.swipes.currentIdx > 0 &&
				Array.isArray(generatingMessage.metadata.swipes.history)
			) {
				const idx = generatingMessage.metadata.swipes.currentIdx
				const history: string[] = [
					...generatingMessage.metadata.swipes.history
				]
				history[idx] = finalContent
				updateData = {
					...updateData,
					metadata: {
						...generatingMessage.metadata,
						swipes: {
							...generatingMessage.metadata.swipes,
							history
						}
					}
				}
			}

			const ret = await db
				.update(schema.chatMessages)
				.set(updateData)
				.where(
					and(
						eq(schema.chatMessages.id, generatingMessage.id),
						eq(schema.chatMessages.isGenerating, true)
					)
				)
				.returning()
			// Instead of getChat, emit the chatMessage
			if (!ret || ret.length === 0) {
				console.error(
					"[generateResponse] Failed to update generating message:",
					generatingMessage.id
				)
				activeAdapters.delete(adapterId)
				return false
			}
			await broadcastToChatUsers(
				socket.io,
				generatingMessage.chatId,
				"chatMessage",
				{
					chatMessage: {
						...generatingMessage,
						content,
						isGenerating: false,
						adapterId: null,
						...(updateData.metadata
							? { metadata: updateData.metadata }
							: {})
					}
				}
			)
		}
	} finally {
		// Remove adapter from global map
		activeAdapters.delete(adapterId)
	}
	// Fetch the updated message for the response
	const updatedMsg = await db.query.chatMessages.findFirst({
		where: (cm, { eq }) => eq(cm.id, generatingMessage.id)
	})
	const response: Sockets.SendPersonaMessage.Response = {
		chatMessage: updatedMsg!
	}
	socket.io.to("user_" + userId).emit("personaMessageReceived", response)
	// Broadcast the chatMessage to all chat participants
	await broadcastToChatUsers(socket.io, updatedMsg!.chatId, "chatMessage", {
		chatMessage: updatedMsg!
	})

	// ASYNC: Generate chat title if this is the first assistant message in an assistant chat
	if (isAssistantMode && chat && !isAborted) {
		// Don't await - run this asynchronously to not block the response
		generateChatTitleIfNeeded(
			chatId,
			userId,
			socket.io,
			connection,
			sampling,
			contextConfig,
			promptConfig
		).catch((error) => {
			console.error("Background title generation failed:", error)
		})
	}

	return !isAborted // Whether there were no interruptions
}

/**
 * Generate a title for a new assistant chat after the first exchange
 * This runs asynchronously and doesn't block the main response
 */
async function generateChatTitleIfNeeded(
	chatId: number,
	userId: number,
	io: any,
	connection: any,
	sampling: any,
	contextConfig: any,
	promptConfig: any
) {
	try {
		// Check if this is the first assistant message
		const assistantMessages = await db.query.chatMessages.findMany({
			where: (cm, { eq, and }) =>
				and(eq(cm.chatId, chatId), eq(cm.role, "assistant"))
		})

		// Only generate title if this is the first assistant response
		if (assistantMessages.length !== 1) {
			return
		}

		// Get the first user message
		const userMessage = await db.query.chatMessages.findFirst({
			where: (cm, { eq, and }) =>
				and(eq(cm.chatId, chatId), eq(cm.role, "user")),
			orderBy: (cm, { asc }) => asc(cm.id)
		})

		if (!userMessage || !userMessage.content) {
			return
		}

		const assistantMessage = assistantMessages[0]
		if (!assistantMessage.content) {
			return
		}

		// Generate the title
		const title = await generateChatTitle({
			userMessage: userMessage.content,
			assistantMessage: assistantMessage.content,
			connection,
			sampling,
			contextConfig,
			promptConfig
		})

		// Update the chat with the new title
		await db
			.update(schema.chats)
			.set({ name: title })
			.where(eq(schema.chats.id, chatId))

		// Broadcast the updated chat name to the user
		io.to("user_" + userId).emit("chats:titleGenerated", {
			chatId,
			title
		})

		console.log(`Generated title for chat ${chatId}: "${title}"`)
	} catch (error) {
		console.error("Error in generateChatTitleIfNeeded:", error)
		// Don't throw - this is a background task
	}
}
