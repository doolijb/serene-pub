import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq } from "drizzle-orm"
import { v4 as uuidv4 } from "uuid"
import { getConnectionAdapter } from "./getConnectionAdapter"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { getUserConfigurations } from "./getUserConfigurations"
import { broadcastToChatUsers } from "../sockets/utils/broadcastHelpers"
import { buildGraphContext } from "./graphContextFormatter"
import { llmQueue, isQueueCancellation } from "./llmQueue"
import {
	persistGenerationStage,
	persistGenerationErrorRow
} from "./generationStatus"
import { resolveTaskConfig } from "./resolveTaskConfig"
import { resolveNarratorPromptConfig } from "./resolveNarratorPromptConfig"
import {
	autoEnqueueChat,
	ensureChatMessageEmbedded
} from "$lib/server/embedding/vectorizationQueue"

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
		const thinkingHistory: (string | null)[] = [
			...(swipes.thinkingHistory || [])
		]
		while (thinkingHistory.length < history.length)
			thinkingHistory.push(null)
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

type GenerateExecuteResult =
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

	if (!chat) {
		await persistGenerationErrorRow(
			socket.io,
			generatingMessage.chatId,
			generatingMessage.id,
			new Error("Chat not found.")
		)
		return false
	}

	// If continuing, signal the PromptBuilder to use preservedContent as the
	// prefill (-2 placeholder) rather than inserting a duplicate message.
	// Adding a separate synthetic message causes two consecutive assistant
	// entries in chat-completion APIs and a wrongly-closed block for text-
	// completion formats.
	if (isContinuing) {
		;(chat as any)._continuationPrefill = preservedContent
	}

	// Get context/prompt config from user settings; resolve connection+sampling via
	// resolveTaskConfig (chat override → prompt config override → system default)
	const {
		sampling: defaultSampling,
		contextConfig,
		promptConfig
	} = await getUserConfigurations(userId)

	// Narrator response: a manually-triggered, non-character narration/environment
	// message — uses its own "Chat Prompts: Narrator" config instead of the
	// chat's normal prompt config. The chat's own override (set via Edit Chat)
	// wins over the user's active/system-default pick — see
	// resolveNarratorPromptConfig.ts.
	const isNarratorResponseMode = !!generatingMessage.isNarratorResponse
	const narratorPromptConfig = isNarratorResponseMode
		? await resolveNarratorPromptConfig(chat, userId)
		: null

	if (isNarratorResponseMode && !narratorPromptConfig) {
		await persistGenerationErrorRow(
			socket.io,
			generatingMessage.chatId,
			generatingMessage.id,
			new Error(
				"No Narrator prompt config configured. Set one up under Chat Prompts: Narrator in Settings."
			)
		)
		return false
	}

	const resolved = isNarratorResponseMode
		? await resolveTaskConfig({
				taskType: "narratorPrompt",
				narratorPromptConfigId: narratorPromptConfig!.id,
				chatId
			})
		: await resolveTaskConfig({
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
			new Error(
				"No AI connection configured. Please set up a connection first."
			)
		)
		return false
	}

	const { Adapter } = await getConnectionAdapter(connection.type)

	// Honor the connection's own configured tokenizer (set in the connection
	// form) rather than always forcing the crude length-based estimate —
	// every adapter constructor already has a `tokenCounter ||
	// connection.tokenCounter` fallback for exactly this, but passing a
	// truthy value here unconditionally short-circuited it, so a user who
	// picked a precise tokenizer to size context correctly never actually
	// got it for a real generation (only for the prompt-preview path, which
	// already resolves this correctly — see chats.ts's
	// `chats:promptTokenCount` handler for the same pattern).
	const tokenCounter = new TokenCounters(
		(connection as any).tokenCounter || TokenCounterOptions.ESTIMATE
	)
	const tokenLimit = 4096
	const contextThresholdPercent = 0.8

	// Fetch contextDebuggingEnabled from system settings
	const sysSettings = await db.query.systemSettings.findFirst({
		where: eq(schema.systemSettings.id, 1),
		columns: { contextDebuggingEnabled: true }
	})
	const contextDebuggingEnabled =
		sysSettings?.contextDebuggingEnabled ?? false

	// Get fresh metadata from the generating message — isNarratorResponse
	// rides along here rather than as a separate adapter constructor param;
	// see the comment on isNarratorResponseMode in BaseConnectionAdapter.ts
	// for why.
	const generatingMessageMetadata = {
		...((generatingMessage.metadata as any) || {}),
		isNarratorResponse: isNarratorResponseMode
	}

	// chatCharacters/chatPersonas rows can have a null character/persona when
	// the linked row was deleted (the FK is nullable, onDelete: "set null") —
	// filter those out since there's nothing left to prompt-build from, and
	// BasePromptChat (shared by every adapter) requires the relation to be
	// populated for the rows it does list.
	const adapterChat = {
		...chat,
		chatCharacters: (chat.chatCharacters ?? []).filter(
			(cc): cc is typeof cc & { character: SelectCharacter } =>
				cc.character !== null
		),
		chatPersonas: (chat.chatPersonas ?? []).filter(
			(cp): cp is typeof cp & { persona: SelectPersona } =>
				cp.persona !== null
		)
	}

	const adapter = new Adapter({
		chat: adapterChat,
		connection: connection,
		sampling: sampling,
		contextConfig: contextConfig,
		promptConfig: isNarratorResponseMode
			? narratorPromptConfig!
			: promptConfig,
		currentCharacterId: isNarratorResponseMode
			? null
			: generatingMessage.characterId!,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent,
		generatingMessageMetadata
	})
	// The context-debugging flag used to switch on the legacy builder's own
	// diagnostics. The pipeline records a decision per block unconditionally —
	// it is in the receipt whether anyone is looking or not — so there is
	// nothing to toggle here any more. The setting still gates the *panel*,
	// client-side, which is where it was always visible from.
	void contextDebuggingEnabled

	/**
	 * The pipeline compiles every reply. There is no toggle and no fallback
	 * (ruling 2026-08-19): a failure here fails the turn the same way any other
	 * generation error does, with the receipt saying where it stopped. Falling
	 * back to the legacy builder would mean a user with a configured pipeline
	 * silently getting a reply built by something else — the one bug in this
	 * area nobody can see. The legacy builder below survives only as dispatch
	 * scaffolding and as `pipeline:compare`'s second arm.
	 *
	 * Only the *prompt* changes hands. The run compiles a payload and injects it
	 * at `withCompiledPrompt` — the one seam every adapter funnels through — so
	 * queueing, streaming, persistence, swipes and thinking extraction below are
	 * untouched legacy code. That is the whole reason the switch is one call
	 * rather than a rewrite of this file.
	 */
	{
		const { runTurn } = await import("$lib/server/pipelines/runTurn")
		const { NARRATE_SPEC_ID } = await import(
			"$lib/server/pipelines/specs/narrate"
		)
		const receipt = await runTurn({
			db,
			chatId,
			userId,
			currentCharacterId: adapter.currentCharacterId,
			text: preservedContent || "",
			// The narrator is its own pipeline and namespace, with its own
			// configs — not the respond spec wearing a different prompt.
			...(isNarratorResponseMode ? { specId: NARRATE_SPEC_ID } : {}),
			// Stops at the pre-call substrate with the real payload: the
			// adapter below is what actually sends it.
			preview: true
		})

		// `PreviewReport.context.rendered` is Assemble's allocation record; the
		// unwrap accepts either the record or its rendered string, and
		// `toCompiledPrompt` bridges both to the adapter's shape.
		const rendered = receipt.preview?.context.rendered as
			| { rendered?: unknown }
			| undefined
		const compiled = rendered?.rendered ?? rendered
		// A preview *halts* at the pre-call substrate by design, so a non-ok
		// outcome only means failure when it arrived without a payload.
		if (!compiled)
			throw new Error(
				`the pipeline could not compile this turn: ${receipt.outcome}` +
					(receipt.haltNodeKey
						? ` at '${receipt.haltNodeKey}'`
						: "") +
					(receipt.haltReason ? ` — ${receipt.haltReason}` : "")
			)

		const { toCompiledPrompt } = await import(
			"$lib/server/pipelines/dispatch"
		)
		adapter.withCompiledPrompt(
			toCompiledPrompt(rendered, connection, {
				currentCharacterId: adapter.currentCharacterId
			})
		)
	}

	// Inject narrative graph context into system instructions (if lorebook + node
	// present) — skipped for Narrator response, which has no character perspective
	// of its own to build graph context from.
	//
	// This used to append directly to adapter.promptBuilder.instructions,
	// but that field is only ever set inside PromptBuilder.buildContextData(),
	// which runs later — inside compilePrompt(), called from within
	// adapter.generate() — so it was always undefined here and this
	// injection silently never reached the model. Setting
	// graphContextInstructions on the adapter instead lets
	// BaseConnectionAdapter.compilePrompt() merge it into extraInstructions
	// once instructions actually exists, the same mechanism
	// narratorInstructions already uses for the equivalent per-trigger-note
	// case.
	if (!isNarratorResponseMode && chat?.lorebookId) {
		try {
			const graphCtx = await buildGraphContext({
				chatId,
				lorebookId: chat.lorebookId,
				speakerCharacterId: generatingMessage.characterId ?? null,
				speakerPersonaId: null
			})
			if (graphCtx) {
				adapter.graphContextInstructions = graphCtx
			}
		} catch (err) {
			console.warn(
				"[generateResponse] graph context injection failed:",
				err
			)
		}
	}

	const currentCharacter = chat?.chatCharacters?.find(
		(cc) => cc.character?.id === adapter.currentCharacterId
	)

	const charName = isNarratorResponseMode
		? (generatingMessage.metadata as any)?.narratorName ||
			narratorPromptConfig?.narratorName ||
			"Narrator"
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
			taskType: isNarratorResponseMode ? "narratorPrompt" : "chat",
			connectionName: resolved.connectionName,
			samplingName: resolved.samplingName,
			chatId,
			messageId: generatingMessage.id,
			label: isNarratorResponseMode ? "Narrator" : charName || undefined,
			userId,
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
					contextDebuggingEnabled,
					queueItemId
				}),
			onCancel: () => adapter.abort(),
			onStatusChange: (status) =>
				persistGenerationStage(
					generatingMessage.id,
					generatingMessage.chatId,
					socket.io,
					status
				)
		},
		queueItemId
	)

	try {
		const result = await done

		if (result.kind === "silentFail") {
			return false
		}

		const { isAborted } = result

		// Fetch the updated message for the response
		const updatedMsg = await db.query.chatMessages.findFirst({
			where: (cm, { eq }) => eq(cm.id, generatingMessage.id)
		})
		const response: Sockets.ChatMessages.SendPersonaMessage.Response = {
			chatMessage: updatedMsg!
		}
		socket.io.to("user_" + userId).emit("personaMessageReceived", response)
		await broadcastToChatUsers(
			socket.io,
			updatedMsg!.chatId,
			"chatMessage",
			{
				chatMessage: updatedMsg!
			}
		)

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
	contextDebuggingEnabled,
	queueItemId
}: {
	signal: AbortSignal
	adapter: any
	socket: any
	chatId: number
	generatingMessage: SelectChatMessage
	startString: string
	isContinuing: boolean
	preservedContent: string
	contextDebuggingEnabled: boolean
	// Fences every write this run makes: a user-initiated stop nulls
	// queueItemId on the row immediately and unconditionally (see
	// chatMessagesCancelHandler). Streaming adapters invoke their per-chunk
	// callback fire-and-forget, so several writes from this run can still be
	// in flight after cancellation — gating every write on this exact id
	// guarantees none of them can resurrect isGenerating:true after the row
	// has moved on, regardless of timing. Message-stop status must never be
	// contingent on whether the upstream LLM actually stops in time.
	queueItemId: string
}): Promise<GenerateExecuteResult> {
	// Generate completion
	let {
		completionResult,
		compiledPrompt,
		isAborted,
		thinkingContent: adapterThinking
	} = await adapter.generate() // TODO: save compiledPrompt to chatMessages
	let content = ""
	let thinking = "" // accumulated thinking from streaming thinkingCb

	if (typeof completionResult === "function") {
		let ok = true
		// Without this, every single streamed chunk (often several per
		// second, sometimes per token) did its own DB UPDATE...RETURNING plus
		// a socket broadcast to every user in the chat — for a 200-500 token
		// response that's 200-500 round trips of both. A ~120ms cadence is
		// well below what's perceptible as "smooth streaming" to a reader,
		// so this only cuts wasted work, not visible responsiveness. The
		// unconditional final persist after the stream ends (below) always
		// flushes the last chunk's content regardless of this throttle, so
		// nothing streamed is ever lost — only some *intermediate* frames
		// are skipped.
		const STREAM_PERSIST_THROTTLE_MS = 120
		let lastPersistedAt = 0
		await completionResult(
			async (chunk: string) => {
				if (!ok || signal.aborted) {
					return
				}
				content += chunk
				const now = Date.now()
				if (now - lastPersistedAt < STREAM_PERSIST_THROTTLE_MS) {
					return
				}
				lastPersistedAt = now

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
					while (thinkingHistory.length < history.length)
						thinkingHistory.push(null)
					if (
						currentThinking !== undefined &&
						typeof idx === "number"
					) {
						thinkingHistory[idx] = currentThinking
					}
					updateData = {
						...updateData,
						metadata: {
							...generatingMessage.metadata,
							...(currentThinking !== undefined
								? { thinking: currentThinking }
								: {}),
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
							eq(schema.chatMessages.isGenerating, true),
							eq(schema.chatMessages.queueItemId, queueItemId)
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
				} else if (signal.aborted) {
					// Fenced out by a user-initiated stop — the cancel handler already
					// reset and owns this row's state. Not an error; stay quiet.
					ok = false
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

		// Build final metadata with thinking + swipe history in sync
		const finalThinking = thinking.trim() || undefined
		let finalMetadata: any = buildThinkingMetadata(
			generatingMessage.metadata,
			content,
			finalThinking,
			true // write content to swipe history
		)
		// debugMeta persists the actual compiled prompt/messages alongside the
		// stats meta — without them, "Prompt Details" has nothing to browse
		// after the fact (only the aggregate counts survive), since the raw
		// compiledPrompt otherwise only lives in memory for this one request.
		const streamingDebugMetaValue =
			contextDebuggingEnabled && compiledPrompt?.meta
				? {
						...compiledPrompt.meta,
						prompt: compiledPrompt.prompt,
						messages: compiledPrompt.messages
					}
				: null
		const streamingDebugMeta = streamingDebugMetaValue
			? { debugMeta: streamingDebugMetaValue }
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
					eq(schema.chatMessages.isGenerating, true),
					eq(schema.chatMessages.queueItemId, queueItemId)
				)
			)
			.returning()
		if (!ret || ret.length === 0) {
			if (signal.aborted) {
				// Cancelled — the cancel handler already reset this row; this run's
				// own completion write is stale and correctly a no-op.
				return { kind: "normal", isAborted: true }
			}
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
					...(finalMetadata !== null
						? { metadata: finalMetadata }
						: {}),
					debugMeta: streamingDebugMetaValue
				}
			}
		)
		try {
			await ensureChatMessageEmbedded(generatingMessage.id)
		} catch (err) {
			// Swallowing here is load-bearing, not decorative: autoEnqueueChat()
			// below must still run even if the inline embed failed or timed out —
			// it's the fallback that eventually catches this message up via the
			// background queue either way.
			console.error(
				"[vectorization] Inline embed of new message failed:",
				err
			)
		}
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

		// --- SWIPE HISTORY + THINKING LOGIC (non-streamed) ---
		const nonStreamThinking = nonStreamAdapterThinking?.trim() || undefined
		const nonStreamMeta = buildThinkingMetadata(
			generatingMessage.metadata,
			nonStreamContent,
			nonStreamThinking,
			true // write content to swipe history
		)
		const nonStreamDebugMetaValue =
			contextDebuggingEnabled && compiledPrompt?.meta
				? {
						...compiledPrompt.meta,
						prompt: compiledPrompt.prompt,
						messages: compiledPrompt.messages
					}
				: null
		const nonStreamDebugMeta = nonStreamDebugMetaValue
			? { debugMeta: nonStreamDebugMetaValue }
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
					eq(schema.chatMessages.isGenerating, true),
					eq(schema.chatMessages.queueItemId, queueItemId)
				)
			)
			.returning()
		if (!ret || ret.length === 0) {
			if (signal.aborted) {
				// Cancelled — the cancel handler already reset this row; this run's
				// own completion write is stale and correctly a no-op.
				return { kind: "normal", isAborted: true }
			}
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
					...(updateData.metadata
						? { metadata: updateData.metadata }
						: {}),
					debugMeta: nonStreamDebugMetaValue
				}
			}
		)
		try {
			await ensureChatMessageEmbedded(generatingMessage.id)
		} catch (err) {
			// Swallowing here is load-bearing, not decorative: autoEnqueueChat()
			// below must still run even if the inline embed failed or timed out —
			// it's the fallback that eventually catches this message up via the
			// background queue either way.
			console.error(
				"[vectorization] Inline embed of new message failed:",
				err
			)
		}
		autoEnqueueChat(chatId).catch(console.error)
		return { kind: "normal", isAborted }
	}
}
