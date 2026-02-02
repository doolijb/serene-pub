import {
	PromptBuilder,
	type CompiledPrompt as PromptBuilderCompiledPrompt
} from "../utils/promptBuilder"
import type { TokenCounters } from "../utils/TokenCounterManager"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"
import { AssistantPrompts } from "$lib/shared/constants/AssistantPrompts"

export interface BasePromptChat extends SelectChat {
	chatCharacters?: (SelectChatCharacter & {
		character: SelectCharacter & { lorebook?: SelectLorebook }
	})[]
	chatPersonas?: (SelectChatPersona & {
		persona: SelectPersona & { lorebook?: SelectLorebook }
	})[]
	chatMessages: SelectChatMessage[]
	lorebook: SelectLorebook & {
		lorebookBindings: (SelectLorebookBinding & {
			character?: SelectCharacter
			persona?: SelectPersona
		})[]
	}
}

// Generic interface for constructor parameters
export interface BaseConnectionAdapterParams {
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	chat: BasePromptChat
	currentCharacterId: number | null
	tokenCounter: TokenCounters
	tokenLimit: number
	contextThresholdPercent: number
	isAssistantMode?: boolean
	generatingMessageMetadata?: any // Metadata of the message being generated/regenerated
}

// Types for abstract functions
export type ListModelsFn = (
	connection: SelectConnection
) => Promise<{ models: any[]; error?: string }>
export type TestConnectionFn = (
	connection: SelectConnection
) => Promise<{ ok: boolean; error?: string }>

export abstract class BaseConnectionAdapter {
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	chat: BasePromptChat
	currentCharacterId: number | null
	isAborting = false
	isAssistantMode = false
	generatingMessageMetadata: any = {}
	promptBuilder: PromptBuilder

	constructor({
		connection,
		sampling,
		contextConfig,
		promptConfig,
		chat,
		currentCharacterId,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent,
		isAssistantMode = false,
		generatingMessageMetadata = {}
	}: BaseConnectionAdapterParams) {
		this.connection = connection
		this.sampling = sampling
		this.contextConfig = contextConfig
		this.promptConfig = promptConfig
		this.chat = chat
		this.currentCharacterId = currentCharacterId
		this.isAssistantMode =
			isAssistantMode || chat.chatType === ChatTypes.ASSISTANT
		this.generatingMessageMetadata = generatingMessageMetadata
		this.promptBuilder = new PromptBuilder({
			connection: this.connection,
			sampling: this.sampling,
			contextConfig: this.contextConfig,
			promptConfig: this.promptConfig,
			chat: this.chat,
			currentCharacterId: this.currentCharacterId,
			tokenCounter,
			tokenLimit,
			contextThresholdPercent,
			isAssistantMode: this.isAssistantMode
		})
	}

	async compilePrompt(args: {}): Promise<PromptBuilderCompiledPrompt> {
		this.promptBuilder.tokenLimit = await this.getContextTokenLimit()

		// Use assistant prompt compilation for assistant mode
		if (this.isAssistantMode) {
			return await this.compileAssistantPrompt(args)
		}

		return await this.promptBuilder.compilePrompt(args)
	}

	abstract generate(): Promise<{
		completionResult:
			| string
			| ((cb: (chunk: string) => void) => Promise<void>)
		compiledPrompt: PromptBuilderCompiledPrompt
		isAborted: boolean
	}>

	abort() {
		this.isAborting = true
	}

	async getContextTokenLimit(): Promise<number> {
		return this.sampling.contextTokensEnabled
			? this.sampling.contextTokens || 4096
			: 4096
	}

	/**
	 * Get the system prompt for the current mode
	 * Override this in subclasses if needed
	 */
	protected getSystemPrompt(): string {
		if (this.isAssistantMode) {
			return AssistantPrompts.getSystemPrompt()
		}
		return this.promptConfig.systemPrompt
	}

	/**
	 * Determine which assistant prompt mode to use based on chat state
	 */
	protected getAssistantPromptMode():
		| "function-calling"
		| "conversational"
		| "default" {
		// Get metadata (now a JSON column)
		const metadata = this.chat.metadata || {}

		console.log("=".repeat(80))
		console.log("[getAssistantPromptMode] Checking mode...")
		console.log(
			"[getAssistantPromptMode] Chat messages count:",
			this.chat.chatMessages.length
		)
		console.log(
			"[getAssistantPromptMode] Generating message metadata exists:",
			!!this.generatingMessageMetadata
		)
		console.log(
			"[getAssistantPromptMode] Raw metadata exists:",
			!!this.chat.metadata
		)
		console.log(
			"[getAssistantPromptMode] Parsed metadata exists:",
			!!metadata
		)
		console.log(
			"[getAssistantPromptMode] Parsed metadata keys:",
			metadata ? Object.keys(metadata) : "N/A"
		)

		// CRITICAL: Check if we're regenerating a message that already has reasoning
		// The generating message is excluded from chat.chatMessages, so we need to check it separately
		const generatingHasReasoning =
			!!this.generatingMessageMetadata?.reasoning

		console.log(
			"[getAssistantPromptMode] Generating message has reasoning:",
			generatingHasReasoning
		)

		if (generatingHasReasoning) {
			console.log(
				"[getAssistantPromptMode] ✅ Regenerating message with existing reasoning, using CONVERSATIONAL mode"
			)
			console.log("=".repeat(80))
			return "conversational"
		}

		// Check if we have tagged entities (NOT draft - draft doesn't need conversational mode)
		const hasTaggedEntities =
			metadata.taggedEntities &&
			Object.keys(metadata.taggedEntities).length > 0

		console.log(
			"[getAssistantPromptMode] Has tagged entities:",
			hasTaggedEntities
		)

		// Get the very last message in the chat (could be user or assistant)
		const lastMessage =
			this.chat.chatMessages[this.chat.chatMessages.length - 1]

		console.log("[getAssistantPromptMode] Last message:", {
			id: lastMessage?.id,
			role: lastMessage?.role,
			content: lastMessage?.content?.substring(0, 50),
			isGenerating: lastMessage?.isGenerating,
			metadata: lastMessage?.metadata
		})

		// Only use conversational mode if:
		// 1. Last message was from assistant
		// 2. That message is still waiting for function selection OR actively being regenerated
		// This means we're in the middle of a function-calling workflow
		if (lastMessage?.role === "assistant") {
			const lastMessageMetadata = (lastMessage.metadata as any) || {}
			const isWaitingForSelection =
				!!lastMessageMetadata.waitingForFunctionSelection
			const hasReasoningAndIsGenerating =
				!!lastMessageMetadata.reasoning && !!lastMessage.isGenerating

			console.log("[getAssistantPromptMode] Last message is assistant")
			console.log(
				"[getAssistantPromptMode] Waiting for selection:",
				isWaitingForSelection
			)
			console.log(
				"[getAssistantPromptMode] Has reasoning and generating:",
				hasReasoningAndIsGenerating
			)

			// Only use conversational mode if actively regenerating after selection
			// NOT for new user messages after the function workflow completed
			if (hasReasoningAndIsGenerating) {
				console.log(
					"[getAssistantPromptMode] ✅ Regenerating after function selection, using CONVERSATIONAL mode"
				)
				console.log("=".repeat(80))
				return "conversational"
			}
		}

		// For assistant mode, always use function-calling prompt for new messages
		// The prompt itself instructs the LLM when to use functions vs answer directly
		console.log(
			"[getAssistantPromptMode] ✅ Using FUNCTION-CALLING mode (LLM decides when to call functions)"
		)
		console.log("=".repeat(80))
		return "function-calling"
	}

	/**
	 * Compile assistant mode prompt (simple message history)
	 * Can be overridden by subclasses for custom formatting
	 */
	protected async compileAssistantPrompt(args: {}): Promise<PromptBuilderCompiledPrompt> {
		const messages: any[] = []

		// Determine which prompt mode to use
		const promptMode = this.getAssistantPromptMode()

		// Get appropriate system prompt
		let systemContent: string
		switch (promptMode) {
			case "function-calling":
				systemContent = AssistantPrompts.getFunctionCallingPrompt()
				console.log("[AssistantPrompt] Using FUNCTION-CALLING mode")
				console.log(
					"[AssistantPrompt] System prompt preview:",
					systemContent.substring(0, 500)
				)
				break
			case "conversational":
				systemContent = AssistantPrompts.getConversationalPrompt()
				console.log(
					"[AssistantPrompt] Using CONVERSATIONAL mode (has tagged entities)"
				)
				break
			default:
				systemContent = AssistantPrompts.getSystemPrompt()
				console.log("[AssistantPrompt] Using DEFAULT mode")
				break
		}

		// Load and append tagged entities context (for conversational mode)
		const taggedEntitiesContext = await this.loadTaggedEntitiesContext()
		if (taggedEntitiesContext) {
			systemContent += "\n\n" + taggedEntitiesContext
			systemContent +=
				"\n\n**Instructions:** The user has requested information about the above entities. Please provide a response based on what was requested in their original question, using the entity data provided above."
		}

		// Load and append draft context (for conversational mode after draft creation)
		const draftContext = await this.loadDraftContext()
		if (draftContext) {
			systemContent += "\n\n" + draftContext
		}

		messages.push({
			role: "system",
			content: systemContent
		})

		// Add chat messages in order (simple conversion)
		for (const msg of this.chat.chatMessages) {
			// Skip hidden messages
			if (msg.isHidden) continue

			messages.push({
				role: msg.role === "assistant" ? "assistant" : "user",
				content: msg.content
			})
		}

		// Add a mode-specific instruction as the last user message to reinforce the expected format
		if (promptMode === "function-calling") {
			messages.push({
				role: "user",
				content:
					'[SYSTEM: You are now in Function Calling mode. Respond with the reasoning format: {"reasoning": "your thoughts", "functions": [...]} ]'
			})
		} else if (promptMode === "conversational") {
			messages.push({
				role: "user",
				content:
					"[SYSTEM: You are now in Conversational mode. Respond naturally using the information provided about the tagged entities.]"
			})
		}

		const totalTokens = await this.promptBuilder.tokenCounter.countTokens(
			JSON.stringify(messages)
		)

		return {
			prompt: undefined,
			messages,
			meta: {
				promptFormat: "chat",
				templateName: "assistant",
				timestamp: new Date().toISOString(),
				truncationReason: null,
				currentTurnCharacterId: null,
				tokenCounts: {
					total: totalTokens,
					limit: await this.getContextTokenLimit()
				},
				chatMessages: {
					included: this.chat.chatMessages.filter(
						(m: SelectChatMessage) => !m.isHidden
					).length,
					total: this.chat.chatMessages.length,
					includedIds: this.chat.chatMessages
						.filter((m: SelectChatMessage) => !m.isHidden)
						.map((m: SelectChatMessage) => m.id),
					excludedIds: this.chat.chatMessages
						.filter((m: SelectChatMessage) => m.isHidden)
						.map((m: SelectChatMessage) => m.id)
				},
				sources: {
					characters: [],
					personas: [],
					scenario: null
				}
			}
		}
	}

	/**
	 * Load tagged entities from chat metadata and format for context
	 */
	private async loadTaggedEntitiesContext(): Promise<string> {
		// Get metadata (now a JSON column)
		const metadata = this.chat.metadata

		if (!metadata || !(metadata as any).taggedEntities) {
			return ""
		}

		const sections: string[] = []
		const taggedEntities = (metadata as any).taggedEntities

		// Load tagged characters
		if (
			taggedEntities.characters &&
			Array.isArray(taggedEntities.characters)
		) {
			const { db } = await import("../db")
			const characterIds = taggedEntities.characters

			if (characterIds.length > 0) {
				const characters = await db.query.characters.findMany({
					where: (c: any, { inArray, eq, and }: any) =>
						and(
							inArray(c.id, characterIds),
							eq(c.userId, this.chat.userId)
						),
					columns: {
						id: true,
						name: true,
						nickname: true,
						description: true,
						avatar: true,
						createdAt: true
					}
				})

				if (characters.length > 0) {
					sections.push("## Referenced Characters\n")
					for (const char of characters) {
						sections.push(
							`### ${char.name}${char.nickname ? ` ("${char.nickname}")` : ""}`
						)
						if (char.description) {
							sections.push(`${char.description}`)
						}
						if (char.avatar) {
							sections.push(`Avatar: ${char.avatar}`)
						}
						sections.push("") // Empty line between characters
					}
				}
			}
		}

		return sections.length > 0 ? sections.join("\n") : ""
	}

	/**
	 * Load draft data from chat metadata and format for context
	 */
	private async loadDraftContext(): Promise<string> {
		// Get metadata (now a JSON column)
		const metadata = this.chat.metadata

		if (!metadata || !(metadata as any).dataEditor?.create) {
			return ""
		}

		const sections: string[] = []
		const drafts = (metadata as any).dataEditor.create

		// Load draft characters
		if (
			drafts.characters &&
			Array.isArray(drafts.characters) &&
			drafts.characters.length > 0
		) {
			sections.push("## Character Draft Context\n")
			const draft = drafts.characters[0] // Only show the first draft

			sections.push(
				"A character draft has been created with the following details:"
			)
			sections.push("")

			if (draft.name) sections.push(`Name: ${draft.name}`)
			if (draft.nickname) sections.push(`Nickname: ${draft.nickname}`)
			if (draft.description)
				sections.push(
					`Description: ${draft.description.substring(0, 150)}${draft.description.length > 150 ? "..." : ""}`
				)
			if (draft.personality)
				sections.push(
					`Personality: ${draft.personality.substring(0, 150)}${draft.personality.length > 150 ? "..." : ""}`
				)
			if (draft.scenario)
				sections.push(
					`Scenario: ${draft.scenario.substring(0, 150)}${draft.scenario.length > 150 ? "..." : ""}`
				)
			if (
				draft.exampleDialogues &&
				Array.isArray(draft.exampleDialogues)
			) {
				sections.push(
					`Example Dialogues: ${draft.exampleDialogues.length} dialogue(s)`
				)
			}

			sections.push("")
			sections.push(
				"The user can see and edit this draft in their interface. You can reference it naturally in conversation if relevant."
			)
		}

		return sections.length > 0 ? sections.join("\n") : ""
	}
}

export interface AdapterExports {
	Adapter: new (args: BaseConnectionAdapterParams) => BaseConnectionAdapter
	listModels: ListModelsFn
	testConnection: TestConnectionFn
	connectionDefaults: Record<string, any>
	samplingKeyMap: Record<string, string>
}
