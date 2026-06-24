/**
 * LLM Field Generator
 *
 * Utilities for generating individual character draft fields using LLM.
 * This module handles the low-level LLM API calls for field generation.
 */

import { getConnectionAdapter } from "$lib/server/utils/getConnectionAdapter"
import { getUserConfigurations } from "$lib/server/utils/getUserConfigurations"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"

/**
 * Simple system prompt for field generation
 * Instructs the LLM to follow field-specific guidance
 */
const FIELD_GENERATION_SYSTEM_PROMPT = `You are a creative assistant helping to design a character for a roleplay application.
You will be given specific instructions for generating individual character fields.
Follow the instructions exactly and return ONLY the requested content without any additional formatting, explanations, or meta-commentary.`

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
	const { connection, sampling } = await getUserConfigurations(userId)

	if (!connection) {
		throw new Error("No AI connection configured. Please set up a connection first.")
	}

	// Get the appropriate adapter for this connection
	const { Adapter } = getConnectionAdapter(connection.type)

	// Create a minimal "prompt builder" structure for the adapter
	// We'll construct a simple chat-style prompt manually
	const messages = [
		{ role: "system", content: systemPrompt },
		{ role: "user", content: userPrompt }
	]

	// Build prompt string based on connection type format
	let promptString = ""

	// Most adapters expect chat format, but we'll build a simple prompt
	// that works across different connection types
	if (connection.type === "openai") {
		// OpenAI uses messages array - we'll send it directly
		promptString = JSON.stringify(messages)
	} else {
		// For other types (Ollama, LlamaCpp, etc.), build a simple text prompt
		promptString = `${systemPrompt}\n\n${userPrompt}`
	}

	// Make the LLM API call
	try {
		const response = await callLLMAPI({
			connection,
			sampling,
			promptString,
			messages,
			maxTokens
		})

		return response.trim()
	} catch (error) {
		console.error("[generateFieldWithLLM] Error calling LLM:", error)
		throw new Error(
			`Failed to generate field: ${error instanceof Error ? error.message : "Unknown error"}`
		)
	}
}

/**
 * Call the LLM API directly with a simple prompt
 * This is a simplified version that doesn't use the full adapter infrastructure
 */
async function callLLMAPI({
	connection,
	sampling,
	promptString,
	messages,
	maxTokens
}: {
	connection: SelectConnection
	sampling: SelectSamplingConfig
	promptString: string
	messages: Array<{ role: string; content: string }>
	maxTokens: number
}): Promise<string> {
	const { baseUrl, extraJson } = connection
	const apiKey = extraJson?.apiKey || null
	const url = baseUrl || ""

	// Handle different connection types
	switch (connection.type) {
		case "openai":
			return await callOpenAIAPI({
				url,
				apiKey,
				messages,
				sampling,
				maxTokens
			})

		case "ollama":
			return await callOllamaAPI({
				url,
				model: connection.model,
				messages,
				sampling,
				maxTokens
			})

		case "lmstudio":
		case "koboldcpp":
		case "llamacpp":
			return await callCompletionAPI({
				url,
				messages,
				sampling,
				maxTokens
			})

		default:
			throw new Error(`Unsupported connection type: ${connection.type}`)
	}
}

/**
 * Call OpenAI-compatible API
 */
async function callOpenAIAPI({
	url,
	apiKey,
	messages,
	sampling,
	maxTokens
}: {
	url: string
	apiKey: string | null
	messages: Array<{ role: string; content: string }>
	sampling: SelectSamplingConfig
	maxTokens: number
}): Promise<string> {
	const endpoint = url.endsWith("/")
		? `${url}chat/completions`
		: `${url}/chat/completions`

	const headers: Record<string, string> = {
		"Content-Type": "application/json"
	}

	if (apiKey) {
		headers["Authorization"] = `Bearer ${apiKey}`
	}

	const body = {
		messages,
		max_tokens: maxTokens,
		temperature: sampling.temperature ?? 0.7,
		top_p: sampling.topP ?? 1.0,
		stream: false
	}

	const response = await fetch(endpoint, {
		method: "POST",
		headers,
		body: JSON.stringify(body)
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(`OpenAI API error (${response.status}): ${errorText}`)
	}

	const data = await response.json()
	return data.choices?.[0]?.message?.content || ""
}

/**
 * Call Ollama API
 */
async function callOllamaAPI({
	url,
	model,
	messages,
	sampling,
	maxTokens
}: {
	url: string
	model: string | null
	messages: Array<{ role: string; content: string }>
	sampling: SelectSamplingConfig
	maxTokens: number
}): Promise<string> {
	const endpoint = url.endsWith("/") ? `${url}api/chat` : `${url}/api/chat`

	const body = {
		model: model || "llama2",
		messages,
		stream: false,
		options: {
			temperature: sampling.temperature ?? 0.7,
			top_p: sampling.topP ?? 1.0,
			num_predict: maxTokens
		}
	}

	const response = await fetch(endpoint, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body)
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(`Ollama API error (${response.status}): ${errorText}`)
	}

	const data = await response.json()
	return data.message?.content || ""
}

/**
 * Call generic completion API (LMStudio, KoboldCpp, LlamaCpp)
 */
async function callCompletionAPI({
	url,
	messages,
	sampling,
	maxTokens
}: {
	url: string
	messages: Array<{ role: string; content: string }>
	sampling: SelectSamplingConfig
	maxTokens: number
}): Promise<string> {
	// Build a simple text prompt from messages
	const promptText = messages
		.map((m) => {
			if (m.role === "system") return m.content
			return m.content
		})
		.join("\n\n")

	const endpoint = url.endsWith("/")
		? `${url}v1/completions`
		: `${url}/v1/completions`

	const body = {
		prompt: promptText,
		max_tokens: maxTokens,
		temperature: sampling.temperature ?? 0.7,
		top_p: sampling.topP ?? 1.0,
		stream: false
	}

	const response = await fetch(endpoint, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body)
	})

	if (!response.ok) {
		const errorText = await response.text()
		throw new Error(
			`Completion API error (${response.status}): ${errorText}`
		)
	}

	const data = await response.json()
	return data.choices?.[0]?.text || ""
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
