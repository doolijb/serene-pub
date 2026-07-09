import { getConnectionAdapter } from "./getConnectionAdapter"
import { TokenCounters } from "./TokenCounterManager"
import { runQueuedLLMCall } from "./runQueuedLLMCall"

/**
 * Generate a concise title for an assistant chat based on the first exchange
 * Uses the connection adapter system to be provider-agnostic
 */
export async function generateChatTitle({
	userMessage,
	assistantMessage,
	connection,
	sampling,
	contextConfig,
	promptConfig
}: {
	userMessage: string
	assistantMessage: string
	connection: any // SelectConnection
	sampling: any // SelectSamplingConfig
	contextConfig: any // SelectContextConfig
	promptConfig: any // SelectPromptConfig
}): Promise<string> {
	try {
		// Create a minimal chat structure for title generation
		const titleChat = {
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
					content: userMessage.slice(0, 500),
					createdAt: new Date().toISOString(),
					isHidden: false,
					isGenerating: false,
					metadata: null
				},
				{
					id: 2,
					chatId: 0,
					role: "assistant",
					content: assistantMessage.slice(0, 500),
					createdAt: new Date().toISOString(),
					isHidden: false,
					isGenerating: false,
					metadata: null
				},
				{
					id: 3,
					chatId: 0,
					role: "user",
					content:
						"Based on the conversation above, generate a short, descriptive title (maximum 6 words, no quotes or punctuation at the end). Just the title, nothing else.",
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

		// Get the appropriate adapter
		const AdapterClass = getConnectionAdapter(connection.type)
		if (!AdapterClass) {
			throw new Error(
				`No adapter found for connection type: ${connection.type}`
			)
		}

		// Create token counter
		const tokenCounter = new TokenCounters(connection.type)

		// Create adapter instance with minimal config
		const adapter = new AdapterClass.Adapter({
			connection,
			sampling: {
				...sampling,
				maxTokens: 30, // Limit to short title
				temperature: 0.7
			},
			contextConfig,
			promptConfig: {
				...promptConfig,
				systemPrompt:
					"You are a helpful assistant that generates concise titles."
			},
			chat: titleChat as any,
			currentCharacterId: null,
			tokenCounter,
			tokenLimit: 4096,
			contextThresholdPercent: 0.8,
			isAssistantMode: false // Don't use assistant mode for title generation
		})

		// Generate the title
		const { text } = await runQueuedLLMCall({
			adapter,
			taskType: "chat_title",
			connectionName: connection.name || connection.type,
			samplingName: sampling.name || "title"
		})
		let title = text

		// Clean up the title
		title = title
			.trim()
			.replace(/^["']|["']$/g, "") // Remove quotes
			.replace(/\.$/, "") // Remove trailing period
			.replace(/^Title:\s*/i, "") // Remove "Title:" prefix if present
			.slice(0, 100) // Truncate if too long

		// Return the title or a fallback
		return title || "Conversation"
	} catch (error) {
		console.error("Error generating chat title:", error)
		// Return a fallback based on first few words of user message
		const fallback = userMessage
			.split(" ")
			.slice(0, 5)
			.join(" ")
			.slice(0, 50)
		return fallback || "Assistant Chat"
	}
}
