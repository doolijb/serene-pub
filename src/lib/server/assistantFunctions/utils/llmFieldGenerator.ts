/**
 * LLM Field Generator
 *
 * Utilities for generating individual character draft fields using LLM.
 */

import { getConnectionAdapter } from "$lib/server/utils/getConnectionAdapter"
import { getUserConfigurations } from "$lib/server/utils/getUserConfigurations"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
import { runQueuedLLMCall } from "$lib/server/utils/runQueuedLLMCall"

/**
 * Simple system prompt for field generation
 * Instructs the LLM to follow field-specific guidance
 */
const FIELD_GENERATION_SYSTEM_PROMPT = `You are a creative assistant helping to design a character for a roleplay application.
You will be given specific instructions for generating individual character fields.
Follow the instructions exactly and return ONLY the requested content without any additional formatting, explanations, or meta-commentary.`

function buildFieldGenerationChat(userPrompt: string): any {
	return {
		id: 0,
		userId: 0,
		name: null,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		scenario: null,
		metadata: null,
		lorebookId: null,
		isGroup: false,
		chatType: "assistant",
		groupReplyStrategy: null,
		chatMessages: [
			{
				id: 1,
				chatId: 0,
				role: "user",
				content: userPrompt,
				createdAt: new Date().toISOString(),
				isHidden: false,
				isGenerating: false,
				metadata: null
			}
		],
		lorebook: {
			id: 0,
			userId: 0,
			name: "",
			description: null,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			lorebookBindings: []
		}
	}
}

/**
 * Generate a single field value using the LLM
 *
 * @param userId - User making the request
 * @param systemPrompt - System-level instructions
 * @param userPrompt - Specific field generation prompt
 * @param maxTokens - Maximum tokens to generate
 * @returns Generated text from LLM
 */
export async function generateFieldWithLLM({
	userId,
	systemPrompt,
	userPrompt,
	maxTokens = 500
}: {
	userId: number
	systemPrompt: string
	userPrompt: string
	maxTokens?: number
}): Promise<string> {
	// Get user's active LLM configurations
	const { connection, sampling, contextConfig, promptConfig } =
		await getUserConfigurations(userId)

	if (!connection) {
		throw new Error("No AI connection configured. Please set up a connection first.")
	}

	const { Adapter } = getConnectionAdapter(connection.type)
	const tokenCounter = new TokenCounters(
		connection.tokenCounter || "estimate"
	)

	const adapter = new Adapter({
		connection,
		sampling: { ...sampling, maxTokens },
		contextConfig,
		promptConfig: { ...promptConfig, systemPrompt },
		chat: buildFieldGenerationChat(userPrompt),
		currentCharacterId: null,
		tokenCounter,
		tokenLimit:
			typeof sampling.contextTokens === "number" ? sampling.contextTokens : 4096,
		contextThresholdPercent: 0.9,
		isAssistantMode: false
	})

	try {
		const { text } = await runQueuedLLMCall({
			adapter,
			taskType: "field_generation",
			connectionName: connection.name,
			samplingName: sampling.name,
			label: "field generation"
		})
		return text
	} catch (error) {
		console.error("[generateFieldWithLLM] Error calling LLM:", error)
		throw new Error(
			`Failed to generate field: ${error instanceof Error ? error.message : "Unknown error"}`
		)
	}
}

/**
 * Progress callback type for field generation
 */
export type FieldGenerationProgressCallback = (update: {
	field: string
	status: "generating" | "validating" | "complete" | "error"
	message?: string
	value?: any
	error?: string
}) => void

/**
 * Generate a field value with progress updates
 * Wrapper around generateFieldWithLLM that emits progress events
 */
export async function generateFieldWithProgress({
	userId,
	field,
	prompt,
	maxTokens,
	onProgress
}: {
	userId: number
	field: string
	prompt: string
	maxTokens?: number
	onProgress?: FieldGenerationProgressCallback
}): Promise<string> {
	try {
		// Emit generating status
		onProgress?.({
			field,
			status: "generating",
			message: `Generating ${field}...`
		})

		// Generate the field
		const value = await generateFieldWithLLM({
			userId,
			systemPrompt: FIELD_GENERATION_SYSTEM_PROMPT,
			userPrompt: prompt,
			maxTokens
		})

		// Emit complete status
		onProgress?.({
			field,
			status: "complete",
			message: `Generated ${field}`,
			value
		})

		return value
	} catch (error) {
		// Emit error status
		onProgress?.({
			field,
			status: "error",
			message: `Failed to generate ${field}`,
			error: error instanceof Error ? error.message : "Unknown error"
		})

		throw error
	}
}
