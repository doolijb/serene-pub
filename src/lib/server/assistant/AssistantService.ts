/**
 * Assistant Service
 *
 * Main service for handling assistant conversations with tool calling support.
 * Uses Vercel AI SDK for seamless tool integration across multiple LLM providers.
 */

import { generateText, tool } from "ai"
import { z } from "zod"
import type { BaseConnectionAdapter } from "../connectionAdapters/BaseConnectionAdapter"
import { db } from "../db"
import * as schema from "../db/schema"
import { eq, desc, asc, and } from "drizzle-orm"
import type { Socket } from "socket.io"
import * as toolHandlers from "./tools/handlers"
import { createLanguageModelFromAdapter } from "./utils/createLanguageModel"
import { withChatTriggerLock } from "$lib/server/utils/chatTriggerLock"

const SERENITY_SYSTEM_PROMPT = `You are Serenity, the helpful AI assistant for Serene Pub.

CRITICAL INSTRUCTION - TOOL CALLING:
You MUST use tools to modify character data. Writing text descriptions does NOT save changes.

When a user requests ANY modification to a character (add, update, change, modify, create, give, set, rewrite, reroll):
1. CALL the appropriate tool (update_character_draft or draft_character)
2. Do NOT write out the changes in text - this accomplishes nothing
3. Do NOT say you called a tool if you didn't actually call it

IMPORTANT: Your tools are the ONLY way to make changes. Text responses cannot modify data.

Words that REQUIRE tool calls:
- "update", "change", "modify", "rewrite", "reroll", "regenerate", "save", "add", "create", "make", "give", "set"
- "with that" (referring to something you just wrote)
- "to the character", "on the character", "for the character"
- "add an alternative greeting" → MUST call update_character_draft
- "give him a nickname" → MUST call update_character_draft
- "make him 42 years old" → MUST call update_character_draft

HANDLING AMBIGUOUS REQUESTS:
If a user says something like "Sure, add it to the character" or "update the character with that":
1. Look at the recent conversation history to infer what "it" or "that" refers to
2. Review the current draft JSON to see what might be missing
3. Make your best guess and call the appropriate tool
4. If truly ambiguous, ask for clarification FIRST, then call the tool once they clarify

CORRECT BEHAVIOR EXAMPLES:
❌ WRONG: User says "add an alternative greeting" → You write "I have called update_character_draft..." but don't actually call it
✅ CORRECT: User says "add an alternative greeting" → You ACTUALLY call update_character_draft with fieldsToUpdate: ["alternateGreetings"]

❌ WRONG: User says "give him a nickname" → You describe a nickname in text
✅ CORRECT: User says "give him a nickname" → You call update_character_draft with fieldsToUpdate: ["nickname"]

❌ WRONG: User says "reroll the scenario" → You write a new scenario in text
✅ CORRECT: User says "reroll the scenario" → You call update_character_draft with fieldsToUpdate: ["scenario"]

FIELD MAPPING - Match user intent to these field names:
- Physical appearance, age, looks, scars, height, hair, eyes → "description"
- Personality, traits, behavior, how they act, mood → "personality"
- Background, setting, world, context, where they are → "scenario"
- Opening message, greeting, first words → "firstMessage"
- Alternative greetings → "alternateGreetings"
- Example conversations → "exampleDialogues"

After calling a tool, briefly confirm what you did.`

interface AssistantMessage {
	role: "system" | "user" | "assistant"
	content: string
}

export class AssistantService {
	private adapter: BaseConnectionAdapter
	private userId: number
	private chatId: number
	private socket: Socket | null

	constructor(
		adapter: BaseConnectionAdapter,
		userId: number,
		chatId: number,
		socket: Socket | null = null
	) {
		this.adapter = adapter
		this.userId = userId
		this.chatId = chatId
		this.socket = socket
	}

	/**
	 * Generate assistant response with automatic tool calling
	 */
	async generateResponse(userMessage: string): Promise<{
		success: boolean
		message?: string
		toolsUsed?: string[]
		metadataUpdated?: boolean
		error?: string
	}> {
		try {
			// 1. Load conversation history (includes the user message that was just saved to DB)
			const messages = await this.loadConversationHistory()

			// Note: We don't add the user message here because it was already saved to the database
			// before this method was called, and loadConversationHistory() loaded it from the DB

			// 2. Create language model from adapter
			const model = createLanguageModelFromAdapter(this.adapter)

			// 3. Define tools for Vercel AI SDK
			const tools = await this.getTools()

			console.log(
				"[AssistantService] Model:",
				this.adapter.connection.model
			)
			console.log(
				"[AssistantService] Available tools:",
				Object.keys(tools)
			)

			// 4. Generate response with automatic tool calling
			this.emitProgress("Thinking...")

			console.log("[AssistantService] Generating response with:")
			console.log("[AssistantService] - Messages count:", messages.length)
			console.log(
				"[AssistantService] - Last user message:",
				messages[messages.length - 1]?.content?.substring(0, 200)
			)
			console.log(
				"[AssistantService] - Tools available:",
				Object.keys(tools)
			)

			// Log the complete prompt context
			console.log("\n========== COMPLETE PROMPT CONTEXT ==========")
			console.log(
				JSON.stringify(
					{
						model: this.adapter.connection.model,
						messages: messages,
						tools: Object.keys(tools).reduce((acc, toolName) => {
							acc[toolName] = {
								description: (tools as any)[toolName]
									.description,
								parameters: (tools as any)[toolName].parameters
							}
							return acc
						}, {} as any)
					},
					null,
					2
				)
			)
			console.log("=============================================\n")

			try {
				const result = await generateText({
					model,
					messages,
					tools,
					onStepFinish: (step) => {
						console.log("[AssistantService] Step finished:", {
							text: step.text?.substring(0, 100),
							toolCalls: step.toolCalls?.map((tc) => ({
								toolName: tc.toolName,
								input: tc.input,
								invalid: (tc as any).invalid,
								error:
									(tc as any).error?.message ||
									(tc as any).error
							})),
							finishReason: step.finishReason,
							fullTextLength: step.text?.length || 0
						})

						// Detect when model should have called a tool but didn't
						if (
							(!step.toolCalls || step.toolCalls.length === 0) &&
							step.text
						) {
							const userMessage =
								messages[messages.length - 1]?.content || ""

							// Expanded trigger word detection with better patterns
							const actionWords = [
								"update",
								"change",
								"modify",
								"rewrite",
								"reroll",
								"regenerate",
								"save",
								"add",
								"create",
								"make",
								"give",
								"set",
								"edit",
								"improve",
								"enhance"
							]
							const targetPhrases = [
								"the character",
								"his",
								"her",
								"the draft",
								"with that",
								"add it",
								"save it"
							]

							const hasActionWord = actionWords.some((word) =>
								new RegExp(`\\b${word}\\b`, "i").test(
									userMessage
								)
							)
							const hasTargetPhrase = targetPhrases.some(
								(phrase) =>
									userMessage
										.toLowerCase()
										.includes(phrase.toLowerCase())
							)
							const shouldHaveCalledTool =
								hasActionWord && hasTargetPhrase

							// Detect if model CLAIMS to have called a tool but didn't (hallucination)
							const toolNames = [
								"update_character_draft",
								"draft_character",
								"list_characters",
								"get_character_details",
								"list_worlds",
								"get_world_details",
								"list_personas",
								"search_documentation"
							]
							const claimsToolCall = toolNames.some(
								(toolName) => {
									// Look for phrases like "I have called X", "I'm calling X", "using X", etc.
									const patterns = [
										new RegExp(
											`\\b(?:I(?:'ve| have| will| am| 'm)|calling|call(?:ed|ing)?|us(?:ed|ing))\\s+(?:the\\s+)?${toolName.replace(/_/g, "[_\\s]")}`,
											"i"
										),
										new RegExp(
											`${toolName.replace(/_/g, "[_\\s]")}\\s+(?:tool|function)`,
											"i"
										),
										new RegExp(
											`\\b(?:with|via)\\s+${toolName.replace(/_/g, "[_\\s]")}`,
											"i"
										)
									]
									return patterns.some((pattern) =>
										pattern.test(step.text)
									)
								}
							)

							if (claimsToolCall) {
								console.error(
									"[AssistantService] ⚠️  TOOL CALL HALLUCINATION DETECTED ⚠️"
								)
								console.error(
									"[AssistantService] Model FALSELY CLAIMED to call a tool but DID NOT actually execute it"
								)
								console.error(
									"[AssistantService] User message:",
									userMessage.substring(0, 200)
								)
								console.error(
									"[AssistantService] Response text:",
									step.text.substring(0, 300)
								)
								console.error("[AssistantService] ")
								console.error(
									"[AssistantService] ❌ This model does NOT reliably support tool calling"
								)
								console.error("[AssistantService] ")
								console.error(
									"[AssistantService] RECOMMENDED MODELS with reliable tool support:"
								)
								console.error(
									"[AssistantService]   • qwen2.5:14b (Excellent tool calling)"
								)
								console.error(
									"[AssistantService]   • llama3.1 (Good tool calling)"
								)
								console.error(
									"[AssistantService]   • mistral-nemo (Good tool calling)"
								)
								console.error(
									"[AssistantService]   • gpt-4o / gpt-4-turbo (OpenAI, excellent)"
								)
								console.error("[AssistantService] ")
							} else if (shouldHaveCalledTool) {
								console.warn(
									"[AssistantService] ⚠️  POSSIBLE MISSED TOOL CALL"
								)
								console.warn(
									"[AssistantService] User requested an action but model did not call a tool"
								)
								console.warn(
									"[AssistantService] User message:",
									userMessage.substring(0, 200)
								)
								console.warn(
									"[AssistantService] Model response:",
									step.text?.substring(0, 200)
								)
								console.warn("[AssistantService] ")
								console.warn(
									"[AssistantService] Possible causes:"
								)
								console.warn(
									"[AssistantService]   1. Model lacks reliable tool calling support"
								)
								console.warn(
									"[AssistantService]   2. Ambiguous user request - model needs clarification"
								)
								console.warn(
									"[AssistantService]   3. Model chose to ask for clarification first"
								)
								console.warn("[AssistantService] ")
							}
						}

						// Track which tools were called and emit progress
						if (step.toolCalls && step.toolCalls.length > 0) {
							for (const toolCall of step.toolCalls) {
								if ((toolCall as any).invalid) {
									console.error(
										"[AssistantService] Invalid tool call:",
										{
											toolName: toolCall.toolName,
											input: toolCall.input,
											error: (toolCall as any).error
										}
									)
									this.emitProgress(
										`Error: Invalid ${toolCall.toolName} parameters`
									)
								} else {
									// Emit user-friendly progress messages
									const friendlyNames: Record<
										string,
										string
									> = {
										draft_character:
											"Generating character draft",
										update_character_draft:
											"Updating character draft",
										list_characters:
											"Searching your characters",
										get_character_details:
											"Loading character details",
										list_worlds: "Searching your worlds",
										get_world_details:
											"Loading world details",
										list_personas:
											"Searching your personas",
										search_documentation:
											"Searching documentation"
									}
									const friendlyName =
										friendlyNames[toolCall.toolName] ||
										`Using ${toolCall.toolName}`
									this.emitProgress(friendlyName)
								}
							}
						}
					}
				})

				return await this.processToolResults(result)
			} catch (error: any) {
				// Check if error is about model not supporting tools
				if (
					error.message?.includes("does not support tools") ||
					error.responseBody?.includes("does not support tools")
				) {
					console.warn(
						"[AssistantService] Model does not support native tool calling, falling back to text-only mode"
					)

					// Fall back to generating without tools
					const result = await generateText({
						model,
						messages: [
							...messages.slice(0, -1), // All messages except the last user message
							{
								role: "system",
								content:
									"Note: This model does not support tool calling. Please respond conversationally and explain what you would do if you had access to the requested tools."
							},
							messages[messages.length - 1] // Last user message
						]
					})

					return {
						success: true,
						message:
							result.text ||
							"I apologize, but this model does not support the advanced features needed for tool calling. Please try using a different model like qwen2.5:14b, llama3.1, or mistral-nemo which have better tool support.",
						toolsUsed: []
					}
				}
				throw error
			}
		} catch (error) {
			console.error("[AssistantService] Error:", error)
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Unknown error occurred"
			}
		}
	}

	/**
	 * Process tool results from generateText
	 */
	private async processToolResults(result: any): Promise<{
		success: boolean
		message?: string
		toolsUsed?: string[]
		metadataUpdated?: boolean
		error?: string
	}> {
		// Extract tools used and process tool results
		const toolsUsed: string[] = []
		let responseMessage = result.text || ""
		let metadataUpdated = false

		try {
			for (const step of result.steps) {
				if (step.toolCalls && step.toolResults) {
					for (let i = 0; i < step.toolCalls.length; i++) {
						const toolCall = step.toolCalls[i]
						const toolResult = step.toolResults[i] as any

						// Check if tool call was invalid
						if ((toolCall as any).invalid) {
							const errorMsg =
								(toolCall as any).error?.message ||
								(toolCall as any).error ||
								"Unknown validation error"
							console.error(
								"[AssistantService] Invalid tool call detected:",
								{
									toolName: toolCall.toolName,
									input: toolCall.input,
									error: errorMsg
								}
							)

							// Return user-friendly error instead of throwing
							return {
								success: false,
								error: `I tried to use the ${toolCall.toolName} tool, but the parameters were invalid. ${errorMsg}. Please try rephrasing your request.`
							}
						}

						if (!toolsUsed.includes(toolCall.toolName)) {
							toolsUsed.push(toolCall.toolName)
						}

						// Handle draft_character tool results - save draft to chat metadata
						if (
							toolCall.toolName === "draft_character" &&
							toolResult
						) {
							console.log(
								"[AssistantService] Processing draft_character result"
							)

							try {
								await this.saveDraftToMetadata(toolResult)
								metadataUpdated = true

								// If no text response, generate a helpful message
								if (!responseMessage) {
									const draftName =
										(toolResult as any).output?.draft
											?.name || "character"
									responseMessage = `I've created a character draft for ${draftName}! You can see the preview below and make any adjustments you'd like.`
								}
							} catch (error) {
								console.error(
									"[AssistantService] Error saving draft_character:",
									error
								)
								return {
									success: false,
									error: `I generated the character draft, but couldn't save it: ${error instanceof Error ? error.message : "Unknown error"}`
								}
							}
						}

						// Handle update_character_draft tool results - save updated draft to metadata
						if (
							toolCall.toolName === "update_character_draft" &&
							toolResult
						) {
							console.log(
								"[AssistantService] Processing update_character_draft result"
							)

							// Check if tool execution failed
							if (toolResult.error) {
								console.error(
									"[AssistantService] update_character_draft tool error:",
									toolResult.error
								)
								return {
									success: false,
									error: `I couldn't update the character draft: ${toolResult.error}`
								}
							}

							try {
								await this.saveDraftToMetadata(toolResult, true)
								metadataUpdated = true

								// If no text response, generate a helpful message
								if (!responseMessage) {
									const updatedFields =
										(toolResult as any).output
											?.updatedFields || []
									if (updatedFields.length > 0) {
										const fieldsList =
											updatedFields.join(", ")
										responseMessage = `I've updated the ${fieldsList} ${updatedFields.length === 1 ? "field" : "fields"} in your character draft. Check out the preview below!`
									} else {
										responseMessage = `I've updated your character draft. Check out the preview below!`
									}
								}
							} catch (error) {
								console.error(
									"[AssistantService] Error saving updated draft:",
									error
								)
								return {
									success: false,
									error: `I updated the fields, but couldn't save them: ${error instanceof Error ? error.message : "Unknown error"}`
								}
							}
						}
					}
				}
			}
		} catch (error) {
			console.error(
				"[AssistantService] Error processing tool results:",
				error
			)
			return {
				success: false,
				error: `An error occurred while processing the tool results: ${error instanceof Error ? error.message : "Unknown error"}`
			}
		}

		console.log("[AssistantService] Response generated:", responseMessage)
		console.log("[AssistantService] Tools used:", toolsUsed)

		// Fallback if response is completely empty
		if (!responseMessage || responseMessage.trim() === "") {
			console.warn(
				"[AssistantService] Empty response detected! This may indicate a model issue."
			)

			if (toolsUsed.length > 0) {
				responseMessage =
					"I've processed your request. Let me know if you need anything else!"
			} else {
				// More helpful fallback message
				responseMessage =
					"I'm having trouble understanding that request. For character drafts, try being more specific, like:\n\n" +
					"- 'Add a greeting message'\n" +
					"- 'Make the description more detailed'\n" +
					"- 'Change the personality to be more cheerful'\n" +
					"- 'Add example dialogues'\n\n" +
					"What would you like to do?"
			}
		}

		return {
			success: true,
			message: responseMessage,
			toolsUsed,
			metadataUpdated
		}
	}

	/**
	 * Define tools for Vercel AI SDK
	 */
	private async getTools() {
		const userId = this.userId
		const chatId = this.chatId

		// Check if a draft already exists
		const chat = await db.query.chats.findFirst({
			where: eq(schema.chats.id, chatId),
			columns: { metadata: true }
		})

		let hasDraft = false
		if (chat?.metadata) {
			const metadata = chat.metadata
			hasDraft = !!metadata?.dataEditor?.create?.characters?.[0]
		}

		const baseTools = {
			list_characters: tool({
				description:
					"Search and list the user's characters. Returns character names, nicknames, and descriptions.",
				inputSchema: z.object({
					search: z
						.string()
						.optional()
						.describe(
							"Search term for character name or description"
						),
					limit: z
						.number()
						.optional()
						.default(20)
						.describe("Maximum number of characters to return")
				}),
				execute: async ({ search, limit }) => {
					console.log(
						`[Tool] list_characters called with search="${search}", limit=${limit}`
					)
					return await toolHandlers.listCharacters(userId, {
						search,
						limit
					})
				}
			}),

			get_character_details: tool({
				description:
					"Get full details for a specific character including personality, scenario, greeting, and example dialogue.",
				inputSchema: z.object({
					characterId: z
						.number()
						.describe("The ID of the character to fetch")
				}),
				execute: async ({ characterId }) => {
					console.log(
						`[Tool] get_character_details called with characterId=${characterId}`
					)
					return await toolHandlers.getCharacterDetails(userId, {
						characterId
					})
				}
			}),

			list_worlds: tool({
				description:
					"Search and list the user's worlds (lorebooks). Returns world names and descriptions.",
				inputSchema: z.object({
					search: z
						.string()
						.optional()
						.describe("Search term for world name or description"),
					limit: z
						.number()
						.optional()
						.default(20)
						.describe("Maximum number of worlds to return")
				}),
				execute: async ({ search, limit }) => {
					console.log(
						`[Tool] list_worlds called with search="${search}", limit=${limit}`
					)
					return await toolHandlers.listWorlds(userId, {
						search,
						limit
					})
				}
			}),

			get_world_details: tool({
				description:
					"Get full details for a specific world including all lore entries.",
				inputSchema: z.object({
					worldId: z.number().describe("The ID of the world to fetch")
				}),
				execute: async ({ worldId }) => {
					console.log(
						`[Tool] get_world_details called with worldId=${worldId}`
					)
					return await toolHandlers.getWorldDetails(userId, {
						worldId
					})
				}
			}),

			list_personas: tool({
				description:
					"Search and list the user's personas. Returns persona names and descriptions.",
				inputSchema: z.object({
					search: z
						.string()
						.optional()
						.describe(
							"Search term for persona name or description"
						),
					limit: z
						.number()
						.optional()
						.default(20)
						.describe("Maximum number of personas to return")
				}),
				execute: async ({ search, limit }) => {
					console.log(
						`[Tool] list_personas called with search="${search}", limit=${limit}`
					)
					return await toolHandlers.listPersonas(userId, {
						search,
						limit
					})
				}
			}),

			search_documentation: tool({
				description:
					"Search the Serene Pub documentation for help and information.",
				inputSchema: z.object({
					query: z
						.string()
						.describe("Search query for documentation"),
					category: z
						.enum([
							"characters",
							"personas",
							"connections",
							"lorebooks",
							"chats",
							"settings",
							"general"
						])
						.optional()
						.describe("Category to search within")
				}),
				execute: async ({ query, category }) => {
					console.log(
						`[Tool] search_documentation called with query="${query}", category="${category}"`
					)
					return await toolHandlers.searchDocumentation(userId, {
						query,
						category
					})
				}
			})
		}

		// Conditionally add draft tools based on whether a draft exists
		if (hasDraft) {
			// If draft exists, only allow updates
			console.log(
				"[AssistantService] Draft exists, adding update_character_draft tool"
			)
			return {
				...baseTools,
				update_character_draft: tool({
					description: `Update an existing character draft based on user instructions. 

Use this tool whenever the user wants to:
- Add, modify, improve, or expand any character information
- Change any existing details (name, appearance, personality, etc.)
- Add new fields like greetings, example dialogues, or scenarios
- Remove or delete content from specific fields

HOW TO USE:
1. Review the current draft context provided in the system prompt (JSON format)
2. Identify which field(s) need to be updated based on the user's request
3. List those fields in fieldsToUpdate using the exact field names from the JSON
4. Pass the user's complete request in userRequest - the system will handle generation

FIELD MAPPING (use exact JSON property names):
- name → Character's primary name
- nickname → Character's nickname or alias
- description → Physical appearance, age, looks, background
- personality → Personality traits, behavior, how they act
- scenario → Background, setting, world context, current situation
- firstMessage → Opening message, greeting, introduction
- alternateGreetings → Array of alternative greeting messages
- exampleDialogues → Array of example conversation snippets
- groupOnlyGreetings → Array of greetings for group chats only
- creatorNotes → Creator notes, author comments
- postHistoryInstructions → Post-history instructions
- source → Array of character sources, inspiration

EXAMPLES:
- "add a greeting" → fieldsToUpdate: ["firstMessage"]
- "make him 42 years old with a scar" → fieldsToUpdate: ["description"]
- "flesh out his appearance" → fieldsToUpdate: ["description"]
- "make her personality more cheerful" → fieldsToUpdate: ["personality"]
- "add some example dialogues" → fieldsToUpdate: ["exampleDialogues"]
- "change his name to Peter" → fieldsToUpdate: ["name"]
- "reroll the scenario" → fieldsToUpdate: ["scenario"]

The system will intelligently generate or update the content based on the user's request and the existing draft JSON.`,
					inputSchema: z.object({
						userRequest: z
							.string()
							.describe(
								"The complete user request describing what to change. Be specific and include all details they mentioned."
							),
						fieldsToUpdate: z
							.array(
								z.enum([
									"name",
									"nickname",
									"description",
									"personality",
									"scenario",
									"firstMessage",
									"alternateGreetings",
									"exampleDialogues",
									"groupOnlyGreetings",
									"source"
								])
							)
							.optional()
							.describe(
								"Optional: Specific fields you know need updating. IMPORTANT: Use exact field names from the draft JSON. If not provided, the system will determine which fields to update."
							)
					}),
					execute: async ({ userRequest, fieldsToUpdate }) => {
						console.log(
							`[Tool] update_character_draft called with request: "${userRequest}"`
						)
						if (fieldsToUpdate) {
							console.log(
								`[Tool] Suggested fields to update:`,
								fieldsToUpdate
							)
						}

						try {
							// Use the draft character handler with the existing draft as context
							return await toolHandlers.updateCharacterDraftSimple(
								userId,
								chatId,
								{ userRequest, fieldsToUpdate }
							)
						} catch (error) {
							console.error(
								"[Tool] update_character_draft error:",
								error
							)
							throw error
						}
					}
				})
			}
		} else {
			// If no draft exists, only allow creation
			console.log(
				"[AssistantService] No draft exists, adding draft_character tool"
			)
			return {
				...baseTools,
				draft_character: tool({
					description:
						"REQUIRED for character creation requests. Creates a structured character draft with proper fields (name, description, personality, etc.). Use this whenever the user wants to create, draft, design, or make a new character. DO NOT describe characters conversationally - always use this tool to create proper drafts.",
					inputSchema: z.object({
						userRequest: z
							.string()
							.describe(
								'The user\'s request describing what character to create (e.g., "Create a space cowboy", "Make a warrior named Marcus")'
							),
						additionalFields: z
							.array(
								z.enum([
									"name",
									"nickname",
									"description",
									"personality",
									"scenario",
									"firstMessage",
									"alternateGreetings",
									"exampleDialogues",
									"groupOnlyGreetings",
									"source"
								])
							)
							.optional()
							.describe(
								"Specific fields to generate or regenerate"
							)
					}),
					execute: async ({ userRequest, additionalFields }) => {
						console.log(
							`[Tool] draft_character called with userRequest="${userRequest}"`
						)
						return await toolHandlers.draftCharacter(
							userId,
							chatId,
							{ userRequest, additionalFields }
						)
					}
				})
			}
		}
	}

	/**
	 * Load conversation history from database
	 */
	private async loadConversationHistory(): Promise<AssistantMessage[]> {
		const chatMessages = await db.query.chatMessages.findMany({
			where: eq(schema.chatMessages.chatId, this.chatId),
			orderBy: [
				asc(schema.chatMessages.createdAt),
				asc(schema.chatMessages.id)
			],
			limit: 50
		})

		console.log(
			`[loadConversationHistory] Loaded ${chatMessages.length} raw messages from database`
		)

		// Get current chat metadata to include draft context
		const chat = await db.query.chats.findFirst({
			where: eq(schema.chats.id, this.chatId),
			columns: { metadata: true }
		})

		// Parse metadata and extract current draft
		let metadata: any = null
		let currentDraft: any = null

		if (chat?.metadata) {
			metadata = chat.metadata
			// Extract current draft from dataEditor.create.characters[0]
			currentDraft = metadata?.dataEditor?.create?.characters?.[0] || null
		}

		// Build system prompt with draft context
		let systemPrompt = SERENITY_SYSTEM_PROMPT

		if (currentDraft) {
			// Add structured draft context as JSON
			systemPrompt += `\n\n## Current Draft Context\n`
			systemPrompt += `The user is currently working on a character draft. Here is the complete draft data in JSON format:\n\n`
			systemPrompt += "```json\n"
			systemPrompt += JSON.stringify(currentDraft, null, 2)
			systemPrompt += "\n```\n\n"
			systemPrompt += `When the user asks to modify or update the draft, use the update_character_draft tool with only the fields they want to change.`
		}

		const messages: AssistantMessage[] = [
			{
				role: "system",
				content: systemPrompt
			}
		]

		for (const msg of chatMessages) {
			// Skip hidden messages
			if (msg.isHidden) continue

			// Skip empty assistant messages (placeholders that weren't filled)
			if (
				msg.role === "assistant" &&
				(!msg.content || msg.content.trim() === "")
			) {
				console.log(
					`[loadConversationHistory] Skipping empty assistant message ID ${msg.id}`
				)
				continue
			}

			// Skip messages still being generated
			if (msg.isGenerating) {
				console.log(
					`[loadConversationHistory] Skipping generating message ID ${msg.id}`
				)
				continue
			}

			messages.push({
				role: msg.role === "user" ? "user" : "assistant",
				content: msg.content
			})
		}

		console.log(
			`[loadConversationHistory] Returning ${messages.length} messages (including system prompt)`
		)

		return messages
	}

	/**
	 * Emit progress updates via socket
	 */
	private emitProgress(message: string) {
		if (this.socket) {
			this.socket.emit("assistant:progress", { message })
		}
		console.log(`[AssistantService] Progress: ${message}`)
	}

	/**
	 * Save character draft to chat metadata
	 */
	private async saveDraftToMetadata(
		draftResult: any,
		isUpdate: boolean = false
	) {
		try {
			// Serialized per-chat against assistantSaveDraftHandler (the other
			// writer of this same chat metadata, triggered by the user's Save
			// click) — without this, a background field-regeneration write
			// could race the user saving the draft as a real character.
			await withChatTriggerLock(this.chatId, async () => {
			console.log(
				"[AssistantService] Saving draft to metadata:",
				draftResult
			)

			// Get current chat metadata
			const chat = await db.query.chats.findFirst({
				where: eq(schema.chats.id, this.chatId),
				columns: { metadata: true }
			})

			// Get metadata (now a JSON column)
			let metadata = chat?.metadata || {}

			// Initialize dataEditor structure if it doesn't exist
			if (!metadata.dataEditor) {
				metadata.dataEditor = { create: { characters: [] }, edit: {} }
			}
			if (!metadata.dataEditor.create) {
				metadata.dataEditor.create = { characters: [] }
			}
			if (!metadata.dataEditor.create.characters) {
				metadata.dataEditor.create.characters = []
			}

			// Extract draft from tool result (tool results have output property)
			const draft = draftResult.output?.draft || draftResult.draft

			// Update or add the draft at index 0
			metadata.dataEditor.create.characters[0] = draft

			// Save to database (metadata is now a JSON column)
			await db
				.update(schema.chats)
				.set({ metadata })
				.where(eq(schema.chats.id, this.chatId))

			console.log("[AssistantService] Draft saved to chat metadata")

			// Emit socket event so frontend updates
			if (this.socket) {
				const eventData = {
					chatId: this.chatId,
					draft: draft,
					isValid: draftResult.output?.isValid || draftResult.isValid,
					validationErrors:
						draftResult.output?.validationErrors ||
						draftResult.validationErrors
				}

				// Include appropriate fields based on whether it's create or update
				if (isUpdate) {
					;(eventData as any).updatedFields =
						draftResult.output?.updatedFields ||
						draftResult.updatedFields
				} else {
					;(eventData as any).generatedFields =
						draftResult.output?.generatedFields ||
						draftResult.generatedFields
				}

				this.socket.emit("assistant:draftProgress", eventData)
			}
			})
		} catch (error) {
			console.error(
				"[AssistantService] Error saving draft to metadata:",
				error
			)
		}
	}
}
