/**
 * Utility to create Vercel AI SDK language models from connection adapters
 */

import { createOpenAI } from "@ai-sdk/openai"
import type { LanguageModel } from "ai"
import type { BaseConnectionAdapter } from "../../connectionAdapters/BaseConnectionAdapter"

export function createLanguageModelFromAdapter(
	adapter: BaseConnectionAdapter
): LanguageModel {
	const connection = adapter.connection

	// Extract API key from extraJson if it exists
	const extraJson = (connection.extraJson as Record<string, any>) || {}
	const apiKey = extraJson.apiKey || extraJson.api_key || "ollama" // Ollama doesn't require a key

	// Determine the base URL
	let baseURL = connection.baseUrl

	// For Ollama, ensure we're using the OpenAI-compatible endpoint
	if (connection.type === "ollama" && baseURL) {
		// Ollama's OpenAI-compatible endpoint is at /v1
		if (!baseURL.endsWith("/v1")) {
			baseURL = baseURL.replace(/\/$/, "") + "/v1"
		}
	}

	// For OpenAI-compatible APIs (OpenAI, Ollama, LM Studio, etc.)
	const provider = createOpenAI({
		apiKey,
		baseURL: baseURL || undefined
	})

	// Use the model name from connection, or default
	const modelName = connection.model || "gpt-4"

	// Use chat method explicitly to ensure correct endpoint
	return provider.chat(modelName)
}
