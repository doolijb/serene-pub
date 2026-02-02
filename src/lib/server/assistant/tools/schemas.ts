/**
 * Assistant Tool Schemas
 *
 * Zod schemas for all assistant tools.
 * These are used with @instructor-ai/instructor for structured outputs.
 */

import { z } from "zod"

// ============================================================================
// CHARACTER TOOLS
// ============================================================================

export const ListCharactersParamsSchema = z.object({
	search: z
		.string()
		.optional()
		.describe("Search term for character name, nickname, or description"),
	limit: z
		.number()
		.optional()
		.default(20)
		.describe("Maximum number of characters to return")
})

export const CharacterSummarySchema = z.object({
	id: z.number(),
	name: z.string(),
	nickname: z.string().nullable(),
	description: z.string().nullable(),
	avatar: z.string().nullable()
})

export const ListCharactersResultSchema = z.object({
	characters: z.array(CharacterSummarySchema),
	total: z.number()
})

export const GetCharacterDetailsParamsSchema = z.object({
	characterId: z.number().describe("The ID of the character to fetch")
})

export const CharacterDetailsSchema = z.object({
	id: z.number(),
	name: z.string(),
	nickname: z.string().nullable(),
	description: z.string().nullable(),
	personality: z.string().nullable(),
	scenario: z.string().nullable(),
	firstMessage: z.string().nullable(),
	exampleDialogues: z.array(z.string()).nullable(),
	avatar: z.string().nullable(),
	tags: z
		.array(
			z.object({
				id: z.number(),
				name: z.string()
			})
		)
		.optional()
})

export const GetCharacterDetailsResultSchema = z.object({
	character: CharacterDetailsSchema.nullable()
})

// Character Draft Tool
export const DraftCharacterParamsSchema = z.object({
	userRequest: z
		.string()
		.describe(
			"The user's request describing the character to create or modify"
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
		.describe("Specific fields to generate or regenerate")
})

export const CharacterDraftSchema = z.object({
	name: z.string().min(1, "Name is required"),
	nickname: z.string().optional(),
	description: z.string().optional(),
	personality: z.string().optional(),
	scenario: z.string().optional(),
	firstMessage: z.string().optional(),
	alternateGreetings: z.array(z.string()).optional(),
	exampleDialogues: z.array(z.string()).optional(),
	groupOnlyGreetings: z.array(z.string()).optional(),
	source: z.array(z.string()).optional()
})

export const DraftCharacterResultSchema = z.object({
	draft: CharacterDraftSchema,
	generatedFields: z.array(z.string()),
	isValid: z.boolean(),
	validationErrors: z.array(z.string()).optional()
})

// Update Character Draft Tool - for partial updates to existing drafts
export const UpdateCharacterDraftParamsSchema = z.object({
	fieldUpdates: z
		.object({
			name: z.string().optional(),
			nickname: z.string().optional(),
			description: z.string().optional(),
			personality: z.string().optional(),
			scenario: z.string().optional(),
			firstMessage: z.string().optional(),
			alternateGreetings: z.array(z.string()).optional(),
			exampleDialogues: z.array(z.string()).optional(),
			groupOnlyGreetings: z.array(z.string()).optional(),
			source: z.array(z.string()).optional()
		})
		.describe("Partial field updates to apply to the existing draft"),
	userInstruction: z
		.string()
		.optional()
		.describe(
			'Optional instruction explaining what changes to make (e.g., "make the personality more cheerful", "add more detail to the description")'
		)
})

export const UpdateCharacterDraftResultSchema = z.object({
	draft: CharacterDraftSchema,
	updatedFields: z.array(z.string()),
	isValid: z.boolean(),
	validationErrors: z.array(z.string()).optional()
})

// ============================================================================
// WORLD/LOCATION TOOLS
// ============================================================================

export const ListWorldsParamsSchema = z.object({
	search: z
		.string()
		.optional()
		.describe("Search term for world/lorebook name or description"),
	limit: z
		.number()
		.optional()
		.default(20)
		.describe("Maximum number of worlds to return")
})

export const WorldSummarySchema = z.object({
	id: z.number(),
	name: z.string(),
	description: z.string().nullable()
})

export const ListWorldsResultSchema = z.object({
	worlds: z.array(WorldSummarySchema),
	total: z.number()
})

export const GetWorldDetailsParamsSchema = z.object({
	worldId: z.number().describe("The ID of the world/lorebook to fetch")
})

export const LorebookEntrySchema = z.object({
	id: z.number(),
	name: z.string(),
	category: z.string().nullable(),
	keys: z.string(),
	content: z.string(),
	enabled: z.boolean(),
	priority: z.number()
})

export const WorldDetailsSchema = z.object({
	id: z.number(),
	name: z.string(),
	description: z.string().nullable(),
	worldEntries: z.array(LorebookEntrySchema).optional(),
	characterEntries: z.array(LorebookEntrySchema).optional()
})

export const GetWorldDetailsResultSchema = z.object({
	world: WorldDetailsSchema.nullable()
})

// ============================================================================
// PERSONA TOOLS
// ============================================================================

export const ListPersonasParamsSchema = z.object({
	search: z
		.string()
		.optional()
		.describe("Search term for persona name or description"),
	limit: z
		.number()
		.optional()
		.default(20)
		.describe("Maximum number of personas to return")
})

export const PersonaSummarySchema = z.object({
	id: z.number(),
	name: z.string(),
	description: z.string().nullable(),
	avatar: z.string().nullable()
})

export const ListPersonasResultSchema = z.object({
	personas: z.array(PersonaSummarySchema),
	total: z.number()
})

// ============================================================================
// DOCUMENTATION/HELP TOOLS
// ============================================================================

export const SearchDocumentationParamsSchema = z.object({
	query: z.string().describe("Search query for documentation"),
	category: z
		.enum([
			"connections",
			"characters",
			"personas",
			"lorebooks",
			"chats",
			"settings",
			"general"
		])
		.optional()
		.describe("Category to search within")
})

export const DocumentationResultSchema = z.object({
	title: z.string(),
	content: z.string(),
	category: z.string(),
	relevance: z.number().optional()
})

export const SearchDocumentationResultSchema = z.object({
	results: z.array(DocumentationResultSchema),
	total: z.number()
})

// ============================================================================
// CONVERSATIONAL RESPONSE (no tools needed)
// ============================================================================

export const ConversationalResponseSchema = z.object({
	response: z
		.string()
		.describe("The assistant's conversational response to the user"),
	requiresFollowup: z
		.boolean()
		.optional()
		.describe(
			"Whether this response requires user confirmation before proceeding"
		),
	suggestedActions: z
		.array(z.string())
		.optional()
		.describe("Suggested next actions for the user")
})

// ============================================================================
// TOOL DECISION (router for determining which tool to use)
// ============================================================================

export const ToolDecisionSchema = z.object({
	reasoning: z
		.string()
		.describe("Brief explanation of which tool(s) to use and why"),
	toolCalls: z.array(
		z.object({
			tool: z.enum([
				"list_characters",
				"get_character_details",
				"draft_character",
				"update_character_draft",
				"list_worlds",
				"get_world_details",
				"list_personas",
				"search_documentation",
				"conversational_response"
			]),
			params: z.record(z.any()).describe("Parameters for the tool call")
		})
	)
})

// ============================================================================
// EXPORT TYPES
// ============================================================================

export type ListCharactersParams = z.infer<typeof ListCharactersParamsSchema>
export type ListCharactersResult = z.infer<typeof ListCharactersResultSchema>
export type GetCharacterDetailsParams = z.infer<
	typeof GetCharacterDetailsParamsSchema
>
export type GetCharacterDetailsResult = z.infer<
	typeof GetCharacterDetailsResultSchema
>
export type DraftCharacterParams = z.infer<typeof DraftCharacterParamsSchema>
export type DraftCharacterResult = z.infer<typeof DraftCharacterResultSchema>
export type UpdateCharacterDraftParams = z.infer<
	typeof UpdateCharacterDraftParamsSchema
>
export type UpdateCharacterDraftResult = z.infer<
	typeof UpdateCharacterDraftResultSchema
>
export type ListWorldsParams = z.infer<typeof ListWorldsParamsSchema>
export type ListWorldsResult = z.infer<typeof ListWorldsResultSchema>
export type GetWorldDetailsParams = z.infer<typeof GetWorldDetailsParamsSchema>
export type GetWorldDetailsResult = z.infer<typeof GetWorldDetailsResultSchema>
export type ListPersonasParams = z.infer<typeof ListPersonasParamsSchema>
export type ListPersonasResult = z.infer<typeof ListPersonasResultSchema>
export type SearchDocumentationParams = z.infer<
	typeof SearchDocumentationParamsSchema
>
export type SearchDocumentationResult = z.infer<
	typeof SearchDocumentationResultSchema
>
export type ConversationalResponse = z.infer<
	typeof ConversationalResponseSchema
>
export type ToolDecision = z.infer<typeof ToolDecisionSchema>
