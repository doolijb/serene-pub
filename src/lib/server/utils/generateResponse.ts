import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq } from "drizzle-orm"
import { v4 as uuidv4 } from "uuid"
import { getConnectionAdapter } from "./getConnectionAdapter"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { getUserConfigurations } from "./getUserConfigurations"
import { broadcastToChatUsers } from "../sockets/utils/broadcastHelpers"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"
import { generateChatTitle } from "./generateChatTitle"
import { parseReasoningFormat } from "./parseReasoningFormat"
import { buildGraphContext } from "./graphContextFormatter"
import { llmQueue, isQueueCancellation } from "./llmQueue"
import { persistGenerationStage, persistGenerationErrorRow } from "./generationStatus"
import { resolveTaskConfig } from "./resolveTaskConfig"
import { autoEnqueueChat } from "$lib/server/embedding/vectorizationQueue"

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
 * Extract all <think>...</think> blocks from content (DeepSeek R1 / Qwen3 style).
 * Returns cleaned content and the concatenated extracted thinking, or undefined if no tag found.
 * Also hides any unclosed <think> block still being streamed.
 */
function extractThinkFromContent(content: string): {
	content: string
	thinking: string | undefined
} {
	// Collect all completed <think>...</think> blocks
	const thinkRegex = /<think>([\s\S]*?)<\/think>/g
	const thinkParts: string[] = []
	let cleaned = content.replace(thinkRegex, (_match, inner: string) => {
		const trimmed = inner.trim()
		if (trimmed) thinkParts.push(trimmed)
		return ""
	})

	// Hide any in-progress (unclosed) <think> block
	const openIdx = cleaned.indexOf("<think>")
	if (openIdx !== -1) {
		cleaned = cleaned.slice(0, openIdx)
	}

	cleaned = cleaned.trimStart()
	const thinking = thinkParts.length > 0 ? thinkParts.join("\n\n") : undefined
	return { content: cleaned, thinking }
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
	emitToUser,
	userId
}: {
	content: string
	socket: any
	chatId: number
	generatingMessage: SelectChatMessage
	emitToUser: (event: string, data: any) => void
	userId: number
}): Promise<boolean | null> {
	const reasoningParsed = parseReasoningFormat(content)

	if (!reasoningParsed) {
		return null // No reasoning detected, continue with normal flow
	}

	if (reasoningParsed.functionCalls.length > 0) {
		// Functions needed - emit to client and wait for selection
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
				generationStage: null,
				queueItemId: null,
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

		return true // Wait for user selection
	} else {
		// No functions needed - store reasoning and regenerate for final response
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
			return false
		}

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

type GenerateExecuteResult =
	| { kind: "reasoningHandled"; value: boolean }
	| { kind: "silentFail" }
	| { kind: "normal"; isAborted: boolean }

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

	// Initial write: enter the pipeline as "queued" — no queue item exists yet.
	await db
		.update(schema.chatMessages)
		.set({
			isGenerating: true,
			generationStage: "queued",
			error: null,
			content: preservedContent, // Preserve existing content for continue
			queueItemId: null,
			metadata: clearedMeta
		})
		.where(eq(schema.chatMessages.id, generatingMessage.id))

	const req: Sockets.ChatMessage.Call = {
		chatMessage: {
			...generatingMessage,
			isGenerating: true,
			generationStage: "queued",
			error: null,
			content: preservedContent, // Use existing content
			queueItemId: null,
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

	// Get context/prompt config from user settings; resolve connection+sampling via
	// resolveTaskConfig (chat override → prompt config override → system default)
	const { sampling: defaultSampling, contextConfig, promptConfig } =
		await getUserConfigurations(userId)

	const resolved = await resolveTaskConfig({
		taskType: "chat",
		promptConfigId: promptConfig?.id,
		chatId
	})
	const connection = resolved.connection
	const sampling = resolved.sampling ?? defaultSampling

	if (!connection) {
		await persistGenerationErrorRow(
			socket.io,
			generatingMessage.chatId,
			generatingMessage.id,
			new Error("No AI connection configured. Please set up a connection first.")
		)
		return false
	}

	const { Adapter } = await getConnectionAdapter(connection.type)

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

	// Inject narrative graph context into system instructions (if lorebook + node present)
	if (!isAssistantMode && chat?.lorebookId) {
		try {
			const graphCtx = await buildGraphContext({
				chatId,
				lorebookId: chat.lorebookId,
				speakerCharacterId: generatingMessage.characterId ?? null,
				speakerPersonaId: null
			})
			if (graphCtx && adapter.promptBuilder.instructions) {
				adapter.promptBuilder.instructions += graphCtx
			}
		} catch (err) {
			console.warn("[generateResponse] graph context injection failed:", err)
		}
	}

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

	// Persist the queue item id BEFORE enqueueing so it's never possible for a
	// run to be active/started while the row still shows queueItemId: null —
	// closes the race where a very-fast Stop click finds nothing to cancel.
	const queueItemId = uuidv4()
	await db
		.update(schema.chatMessages)
		.set({ queueItemId })
		.where(eq(schema.chatMessages.id, generatingMessage.id))

	const { done } = llmQueue.enqueue<GenerateExecuteResult>(
		{
			taskType: "chat",
			connectionName: resolved.connectionName,
			samplingName: resolved.samplingName,
			chatId,
			messageId: generatingMessage.id,
			label: charName || undefined,
			preflight: (signal) => adapter.preflight(signal),
			execute: (signal) =>
				runGenerateAndPersist({
					signal,
					adapter,
					socket,
					chatId,
					generatingMessage,
					startString,
					isContinuing,
					preservedContent,
					isAssistantMode,
					emitToUser,
					userId,
					contextDebuggingEnabled
				}),
			onCancel: () => adapter.abort(),
			onStatusChange: (status) =>
				persistGenerationStage(generatingMessage.id, generatingMessage.chatId, socket.io, status)
		},
		queueItemId
	)

	try {
		const result = await done

		if (result.kind === "reasoningHandled") {
			return result.value
		}
		if (result.kind === "silentFail") {
			return false
		}

		const { isAborted } = result

		// Fetch the updated message for the response
		const updatedMsg = await db.query.chatMessages.findFirst({
			where: (cm, { eq }) => eq(cm.id, generatingMessage.id)
		})
		const response: Sockets.SendPersonaMessage.Response = {
			chatMessage: updatedMsg!
		}
		socket.io.to("user_" + userId).emit("personaMessageReceived", response)
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
	} catch (err) {
		if (isQueueCancellation(err)) {
			// The cancel handler already flipped isGenerating/queueItemId/error on
			// the row — a user-initiated stop isn't a failure worth reporting.
			return false
		}
		await persistGenerationErrorRow(
			socket.io,
			generatingMessage.chatId,
			generatingMessage.id,
			err
		)
		return false
	}
}

/**
 * Runs adapter.generate(), consumes streaming or non-streaming output, and
 * persists it to the message row — this is the LLM queue item's execute()
 * body. Errors thrown here are caught by llmQueue and surfaced to the
 * caller's `done` promise.
 */
async function runGenerateAndPersist({
	signal,
	adapter,
	socket,
	chatId,
	generatingMessage,
	startString,
	isContinuing,
	preservedContent,
	isAssistantMode,
	emitToUser,
	userId,
	contextDebuggingEnabled
}: {
	signal: AbortSignal
	adapter: any
	socket: any
	chatId: number
	generatingMessage: SelectChatMessage
	startString: string
	isContinuing: boolean
	preservedContent: string
	isAssistantMode: boolean
	emitToUser: (event: string, data: any) => void
	userId: number
	contextDebuggingEnabled: boolean
}): Promise<GenerateExecuteResult> {
	// Generate completion
	let { completionResult, compiledPrompt, isAborted, thinkingContent: adapterThinking } =
		await adapter.generate() // TODO: save compiledPrompt to chatMessages
	let content = ""
	let thinking = "" // accumulated thinking from streaming thinkingCb

	if (typeof completionResult === "function") {
		let ok = true
		await completionResult(
			async (chunk: string) => {
				if (!ok || signal.aborted) {
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
				let stagedForDisplay = stagedContent.trim()

				// Strip <think> tags from streamed content when no native thinking is active.
				// Completed blocks are moved to the thinking accumulator; unclosed blocks
				// (still being streamed) are hidden from the displayed content.
				if (!thinking.trim()) {
					const extracted = extractThinkFromContent(stagedForDisplay)
					if (extracted.thinking) {
						thinking = extracted.thinking
						stagedForDisplay = extracted.content
					} else if (extracted.content !== stagedForDisplay) {
						stagedForDisplay = extracted.content
					}
				}

				const finalContent = isContinuing
					? preservedContent + " " + stagedForDisplay
					: stagedForDisplay

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
			}
		)

		// Final update: mark as not generating, clear queueItemId
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

		// Check for reasoning format in assistant mode - only after streaming is complete
		if (isAssistantMode) {
			const reasoningResult = await handleAssistantReasoning({
				content,
				socket,
				chatId,
				generatingMessage,
				emitToUser,
				userId
			})

			if (reasoningResult !== null) {
				return { kind: "reasoningHandled", value: reasoningResult }
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
			.set({
				content,
				isGenerating: false,
				generationStage: null,
				queueItemId: null,
				error: null,
				...(finalMetadata !== null ? { metadata: finalMetadata } : {}),
				...streamingDebugMeta
			})
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
			return { kind: "silentFail" }
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
					generationStage: null,
					queueItemId: null,
					error: null,
					...(finalMetadata !== null ? { metadata: finalMetadata } : {}),
					...(contextDebuggingEnabled && compiledPrompt?.meta
						? { debugMeta: compiledPrompt.meta }
						: { debugMeta: null })
				}
			}
		)
		autoEnqueueChat(chatId).catch(console.error)
		return { kind: "normal", isAborted }
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
				emitToUser,
				userId
			})

			if (reasoningResult !== null) {
				return { kind: "reasoningHandled", value: reasoningResult }
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
			generationStage: null,
			queueItemId: null,
			error: null,
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
		if (!ret || ret.length === 0) {
			console.error(
				"[generateResponse] Failed to update generating message:",
				generatingMessage.id
			)
			return { kind: "silentFail" }
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
					generationStage: null,
					queueItemId: null,
					error: null,
					...(updateData.metadata ? { metadata: updateData.metadata } : {}),
					...(contextDebuggingEnabled && compiledPrompt?.meta
						? { debugMeta: compiledPrompt.meta }
						: { debugMeta: null })
				}
			}
		)
		autoEnqueueChat(chatId).catch(console.error)
		return { kind: "normal", isAborted }
	}
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
