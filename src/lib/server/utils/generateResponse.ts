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
 * Build updated metadata that keeps swipes.history and swipes.thinkingHistory
 * in perfect sync (equal length, same indices).
 *
 * @param existingMeta  - current message metadata object
 * @param content       - the generated content string
 * @param thinking      - the thinking/reasoning trace, or undefined if none
 * @param writeToHistory - if true, also write content into swipes.history[currentIdx]
 *                        (used for final completion; mid-stream only updates thinking)
 * @returns updated metadata object, or null if no metadata changes are needed
 */
function buildThinkingMetadata(
	existingMeta: any,
	content: string,
	thinking: string | undefined,
	writeToHistory: boolean
): any | null {
	const hasThinking = thinking !== undefined
	const swipes = existingMeta?.swipes

	if (swipes && Array.isArray(swipes.history)) {
		const idx = swipes.currentIdx ?? 0

		// Clone content history; update only for swipe slots (idx > 0) to preserve existing behaviour
		const history: string[] = [...swipes.history]
		if (writeToHistory && typeof idx === "number" && idx > 0) {
			history[idx] = content
		}

		// Build thinkingHistory always parallel (same length) as history
		const thinkingHistory: (string | null)[] = [...(swipes.thinkingHistory || [])]
		while (thinkingHistory.length < history.length) thinkingHistory.push(null)
		if (hasThinking && typeof idx === "number") {
			thinkingHistory[idx] = thinking!
		}
		// Trim excess (should never happen, but guard the invariant)
		thinkingHistory.length = history.length

		return {
			...existingMeta,
			...(hasThinking ? { thinking } : {}),
			swipes: {
				...swipes,
				history,
				thinkingHistory
			}
		}
	}

	// No swipes — only update metadata.thinking
	if (hasThinking) {
		return {
			...(existingMeta || {}),
			thinking
		}
	}

	return null // no changes needed
}

/**
 * Extract <think>...</think> block from content (DeepSeek R1 / embedded-tag style).
 * Returns cleaned content and the extracted thinking string, or undefined if no tag found.
 */
function extractThinkFromContent(content: string): {
	content: string
	thinking: string | undefined
} {
	const trimmed = content.trimStart()
	if (!trimmed.startsWith("<think>")) return { content, thinking: undefined }
	const endIdx = trimmed.indexOf("</think>")
	if (endIdx === -1) return { content, thinking: undefined }
	const thinking = trimmed.slice(7, endIdx).trim() // 7 = "<think>".length
	const remaining = trimmed.slice(endIdx + 8).trimStart() // 8 = "</think>".length
	return { content: remaining, thinking: thinking || undefined }
}

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

	// Build cleared metadata: wipe thinking for the current swipe slot so the
	// client doesn't show stale thinking from a previous generation.
	const existingMeta = (currentMessage?.metadata as any) || {}
	const existingSwipes = existingMeta?.swipes
	let clearedMeta: any = { ...existingMeta, thinking: null }
	if (existingSwipes && Array.isArray(existingSwipes.history)) {
		const idx = existingSwipes.currentIdx ?? 0
		const thinkingHistory: (string | null)[] = [
			...(existingSwipes.thinkingHistory || [])
		]
		while (thinkingHistory.length < existingSwipes.history.length)
			thinkingHistory.push(null)
		thinkingHistory[idx] = null
		clearedMeta = {
			...clearedMeta,
			swipes: { ...existingSwipes, thinkingHistory }
		}
	}

	// Save the adapterId to the chatMessage
	// For continue: preserve existing content
	// For new generation: clear content
	await db
		.update(schema.chatMessages)
		.set({
			isGenerating: true,
			content: preservedContent, // Preserve existing content for continue
			adapterId,
			metadata: clearedMeta
		})
		.where(eq(schema.chatMessages.id, generatingMessage.id))
	// Instead of getChat, emit the chatMessage

	const req: Sockets.ChatMessage.Call = {
		chatMessage: {
			...generatingMessage,
			isGenerating: true,
			content: preservedContent, // Use existing content
			adapterId,
			metadata: clearedMeta
		}
	}

	await broadcastToChatUsers(
		socket.io,
		generatingMessage.chatId,
		"chatMessage",
		req
	)

	// Update local reference so buildThinkingMetadata works from the cleared state
	generatingMessage = { ...generatingMessage, metadata: clearedMeta }

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

	if (!connection) {
		throw new Error("No AI connection configured. Please set up a connection first.")
	}

	const { Adapter } = getConnectionAdapter(connection.type)

	const tokenCounter = new TokenCounters("estimate")
	const tokenLimit = 4096
	const contextThresholdPercent = 0.8

	// Detect assistant mode
	const isAssistantMode = chat?.chatType === ChatTypes.ASSISTANT

	// Fetch contextDebuggingEnabled from system settings
	const sysSettings = await db.query.systemSettings.findFirst({
		where: eq(schema.systemSettings.id, 1),
		columns: { contextDebuggingEnabled: true }
	})
	const contextDebuggingEnabled = sysSettings?.contextDebuggingEnabled ?? false

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
	// Thread context debugging flag into prompt builder
	adapter.promptBuilder.diagnosticsEnabled = contextDebuggingEnabled

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
	let { completionResult, compiledPrompt, isAborted, thinkingContent: adapterThinking } =
		await adapter.generate() // TODO: save compiledPrompt to chatMessages
	let content = ""
	let thinking = "" // accumulated thinking from streaming thinkingCb
	try {
		if (typeof completionResult === "function") {
			let ok = true
			await completionResult(
				async (chunk: string) => {
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

				// --- SWIPE HISTORY + THINKING LOGIC (mid-stream) ---
				const currentThinking = thinking.trim() || undefined
				let updateData: any = {
					content: finalContent,
					isGenerating: true
				}
				const swipes = generatingMessage.metadata?.swipes
				if (swipes && Array.isArray(swipes.history)) {
					const idx = swipes.currentIdx ?? 0
					const history: string[] = [...swipes.history]
					// Only update content in history for actual swipe slots (idx > 0)
					if (typeof idx === "number" && idx > 0) {
						history[idx] = content
					}
					// Keep thinkingHistory parallel to history
					const thinkingHistory: (string | null)[] = [
						...(swipes.thinkingHistory || [])
					]
					while (thinkingHistory.length < history.length) thinkingHistory.push(null)
					if (currentThinking !== undefined && typeof idx === "number") {
						thinkingHistory[idx] = currentThinking
					}
					updateData = {
						...updateData,
						metadata: {
							...generatingMessage.metadata,
							...(currentThinking !== undefined ? { thinking: currentThinking } : {}),
							swipes: {
								...swipes,
								history,
								thinkingHistory
							}
						}
					}
				} else if (currentThinking !== undefined) {
					// No swipes — store thinking directly in metadata
					updateData = {
						...updateData,
						metadata: {
							...(generatingMessage.metadata || {}),
							thinking: currentThinking
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
			},
			(thinkingChunk: string) => {
				thinking += thinkingChunk
			})

			// Final update: mark as not generating, clear adapterId
			content = content.replace(startString, "").trim()

			// When continuing, append to existing content
			if (isContinuing) {
				content = preservedContent + " " + content
			}

			// If no native thinking was captured via thinkingCb, check for <think> tags in content
			if (!thinking.trim()) {
				const extracted = extractThinkFromContent(content)
				if (extracted.thinking) {
					thinking = extracted.thinking
					content = extracted.content
				}
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
			console.log(
				"[generateResponse] POST-STREAM: thinking length:",
				thinking.length,
				"first 200 chars:",
				thinking.substring(0, 200)
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
			// Build final metadata with thinking + swipe history in sync
			const finalThinking = thinking.trim() || undefined
			let finalMetadata: any = buildThinkingMetadata(
				generatingMessage.metadata,
				content,
				finalThinking,
				true // write content to swipe history
			)
			const streamingDebugMeta = contextDebuggingEnabled && compiledPrompt?.meta
				? { debugMeta: compiledPrompt.meta }
				: {}
			const ret = await db
				.update(schema.chatMessages)
				.set({ content, isGenerating: false, adapterId: null, ...(finalMetadata !== null ? { metadata: finalMetadata } : {}), ...streamingDebugMeta })
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
						adapterId: null,
						...(finalMetadata !== null ? { metadata: finalMetadata } : {}),
						...(contextDebuggingEnabled && compiledPrompt?.meta
							? { debugMeta: compiledPrompt.meta }
							: { debugMeta: null })
					}
				}
			)
		} else {
			content = completionResult.replace(startString, "").trim()

			// When continuing, append to existing content
			const finalContent = isContinuing
				? preservedContent + " " + content
				: content

			// If no native thinking was returned by the adapter, check for <think> tags in content
			let nonStreamContent = finalContent
			let nonStreamAdapterThinking = adapterThinking
			if (!nonStreamAdapterThinking?.trim()) {
				const extracted = extractThinkFromContent(nonStreamContent)
				if (extracted.thinking) {
					nonStreamAdapterThinking = extracted.thinking
					nonStreamContent = extracted.content
				}
			}

			// Check for reasoning format in assistant mode (NON-STREAMING)
			if (isAssistantMode) {
				const reasoningResult = await handleAssistantReasoning({
					content: nonStreamContent,
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

			// --- SWIPE HISTORY + THINKING LOGIC (non-streamed) ---
			const nonStreamThinking = nonStreamAdapterThinking?.trim() || undefined
			const nonStreamMeta = buildThinkingMetadata(
				generatingMessage.metadata,
				nonStreamContent,
				nonStreamThinking,
				true // write content to swipe history
			)
			const nonStreamDebugMeta = contextDebuggingEnabled && compiledPrompt?.meta
				? { debugMeta: compiledPrompt.meta }
				: {}
			let updateData: any = {
				content: nonStreamContent,
				isGenerating: false,
				adapterId: null,
				...(nonStreamMeta !== null ? { metadata: nonStreamMeta } : {}),
				...nonStreamDebugMeta
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
						content: nonStreamContent,
						isGenerating: false,
						adapterId: null,
						...(updateData.metadata ? { metadata: updateData.metadata } : {}),
						...(contextDebuggingEnabled && compiledPrompt?.meta
							? { debugMeta: compiledPrompt.meta }
							: { debugMeta: null })
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
