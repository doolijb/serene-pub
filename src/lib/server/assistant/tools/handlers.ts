/**
 * Assistant Tool Handlers
 *
 * Implementation of all assistant tool functions.
 * These execute the actual operations requested by the AI.
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, or, like, and, desc } from "drizzle-orm"
import type {
	ListCharactersParams,
	ListCharactersResult,
	GetCharacterDetailsParams,
	GetCharacterDetailsResult,
	DraftCharacterParams,
	DraftCharacterResult,
	UpdateCharacterDraftParams,
	UpdateCharacterDraftResult,
	ListWorldsParams,
	ListWorldsResult,
	GetWorldDetailsParams,
	GetWorldDetailsResult,
	ListPersonasParams,
	ListPersonasResult,
	SearchDocumentationParams,
	SearchDocumentationResult
} from "./schemas"

// ============================================================================
// CHARACTER HANDLERS
// ============================================================================

export async function listCharacters(
	userId: number,
	params: ListCharactersParams
): Promise<ListCharactersResult> {
	// Validate input parameters
	const { search, limit = 20 } = params

	// Sanitize limit to prevent abuse
	const safeLimit = Math.min(Math.max(1, limit), 100) // Clamp between 1-100

	// Validate search string length
	if (search && search.length > 200) {
		throw new Error("Search query too long (max 200 characters)")
	}

	const conditions = [eq(schema.characters.userId, userId)]

	if (search && search.trim()) {
		const sanitizedSearch = search.trim()
		conditions.push(
			or(
				like(schema.characters.name, `%${sanitizedSearch}%`),
				like(schema.characters.nickname, `%${sanitizedSearch}%`),
				like(schema.characters.description, `%${sanitizedSearch}%`)
			)!
		)
	}

	const characters = await db.query.characters.findMany({
		where: and(...conditions),
		columns: {
			id: true,
			name: true,
			nickname: true,
			description: true,
			avatar: true
		},
		limit: safeLimit
	})

	return {
		characters,
		total: characters.length
	}
}

export async function getCharacterDetails(
	userId: number,
	params: GetCharacterDetailsParams
): Promise<GetCharacterDetailsResult> {
	const { characterId } = params

	const character = await db.query.characters.findFirst({
		where: and(
			eq(schema.characters.id, characterId),
			eq(schema.characters.userId, userId)
		),
		columns: {
			id: true,
			name: true,
			nickname: true,
			description: true,
			personality: true,
			scenario: true,
			firstMessage: true,
			exampleDialogues: true,
			avatar: true
		}
	})

	if (!character) {
		return { character: null }
	}

	return {
		character: {
			id: character.id,
			name: character.name,
			nickname: character.nickname,
			description: character.description,
			personality: character.personality,
			scenario: character.scenario,
			firstMessage: character.firstMessage,
			exampleDialogues: character.exampleDialogues,
			avatar: character.avatar,
			tags: []
		}
	}
}

export async function draftCharacter(
	userId: number,
	chatId: number,
	params: DraftCharacterParams
): Promise<DraftCharacterResult> {
	const { userRequest, additionalFields = [] } = params

	// Validate input parameters
	if (!userRequest || userRequest.trim().length === 0) {
		throw new Error("User request is required to draft a character")
	}

	if (userRequest.length > 10000) {
		throw new Error("User request too long (max 10,000 characters)")
	}

	// Validate additionalFields contains only valid field names
	const validFields = [
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
	]

	if (additionalFields.length > 0) {
		const invalidFields = additionalFields.filter(
			(field) => !validFields.includes(field)
		)
		if (invalidFields.length > 0) {
			throw new Error(
				`Invalid field names: ${invalidFields.join(", ")}. Valid fields are: ${validFields.join(", ")}`
			)
		}
	}

	// Import the draft orchestrator
	const { generateCharacterDraft } = await import(
		"$lib/server/assistantFunctions/utils/draftOrchestrator"
	)
	const { parseChatMetadata, getActiveCharacterDraft } = await import(
		"$lib/shared/types/chatMetadata"
	)

	// Get existing draft from chat metadata
	const chat = await db.query.chats.findFirst({
		where: eq(schema.chats.id, chatId),
		columns: { metadata: true }
	})

	const metadata = chat ? parseChatMetadata(chat.metadata) : null
	const existingDraft = metadata ? getActiveCharacterDraft(metadata) : null

	// Generate draft using orchestrator (without socket - tool handlers shouldn't emit directly)
	const result = await generateCharacterDraft({
		userId,
		chatId,
		userRequest,
		additionalFields,
		existingDraft: existingDraft || undefined,
		socket: undefined // No socket - AssistantService handles progress
	})

	return {
		draft: result.draft as any, // Cast to match our schema
		generatedFields: result.generatedFields,
		isValid: result.isValid,
		validationErrors: result.validationErrors?.map(
			(e: any) => e.message || String(e)
		)
	}
}

export async function updateCharacterDraft(
	userId: number,
	chatId: number,
	params: UpdateCharacterDraftParams
): Promise<UpdateCharacterDraftResult> {
	const { fieldUpdates, userInstruction } = params

	console.log(`[updateCharacterDraft] Updating draft for chat ${chatId}`)
	console.log(`[updateCharacterDraft] Field updates:`, fieldUpdates)

	// Get existing draft from chat metadata
	const chat = await db.query.chats.findFirst({
		where: eq(schema.chats.id, chatId),
		columns: { metadata: true }
	})

	if (!chat) {
		throw new Error("Chat not found")
	}

	// Get metadata (now a JSON column, no parsing needed)
	const metadata = chat.metadata || {}

	// Extract existing draft from dataEditor.create.characters[0]
	const existingDraft = metadata?.dataEditor?.create?.characters?.[0]

	if (!existingDraft) {
		throw new Error(
			"No existing draft found. Use draft_character to create a new draft first."
		)
	}

	console.log(`[updateCharacterDraft] Existing draft:`, existingDraft)

	// Merge field updates into existing draft
	const updatedDraft = {
		...existingDraft,
		...fieldUpdates
	}

	console.log(`[updateCharacterDraft] Updated draft:`, updatedDraft)

	// Import CharacterDraftSchema for validation
	const { CharacterDraftSchema } = await import("./schemas")

	// Validate the updated draft
	const validation = CharacterDraftSchema.safeParse(updatedDraft)

	// Track which fields were actually updated
	const updatedFields = Object.keys(fieldUpdates)

	// Initialize dataEditor structure if it doesn't exist
	if (!metadata.dataEditor) {
		metadata.dataEditor = { create: { characters: [] }, edit: {} }
	}
	if (!metadata.dataEditor.create) {
		metadata.dataEditor.create = { characters: [] }
	}

	// Update the draft at index 0
	metadata.dataEditor.create.characters[0] = updatedDraft

	// Save updated metadata to database (metadata is now a JSON column)
	await db
		.update(schema.chats)
		.set({ metadata })
		.where(eq(schema.chats.id, chatId))

	console.log(
		`[updateCharacterDraft] Updated fields: ${updatedFields.join(", ")}`
	)

	return {
		draft: updatedDraft as any,
		updatedFields,
		isValid: validation.success,
		validationErrors: validation.success
			? undefined
			: validation.error.errors.map((e) => e.message)
	}
}

/**
 * Simple update that uses the orchestrator like draft_character
 */
export async function updateCharacterDraftSimple(
	userId: number,
	chatId: number,
	params: { userRequest: string; fieldsToUpdate?: string[] }
): Promise<DraftCharacterResult> {
	const { userRequest, fieldsToUpdate = [] } = params

	// Validate input parameters
	if (!userRequest || userRequest.trim().length === 0) {
		throw new Error("User request is required")
	}

	if (userRequest.length > 10000) {
		throw new Error("User request too long (max 10,000 characters)")
	}

	// Validate fieldsToUpdate contains only valid field names
	const validFields = [
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
	]

	if (fieldsToUpdate.length > 0) {
		const invalidFields = fieldsToUpdate.filter(
			(field) => !validFields.includes(field)
		)
		if (invalidFields.length > 0) {
			throw new Error(
				`Invalid field names: ${invalidFields.join(", ")}. Valid fields are: ${validFields.join(", ")}`
			)
		}

		// Limit number of fields that can be updated at once
		if (fieldsToUpdate.length > 10) {
			throw new Error("Too many fields to update at once (max 10)")
		}
	}

	console.log(
		`[updateCharacterDraftSimple] Updating draft for chat ${chatId}`
	)
	console.log(
		`[updateCharacterDraftSimple] User request: "${userRequest.substring(0, 200)}${userRequest.length > 200 ? "..." : ""}"`
	)
	if (fieldsToUpdate.length > 0) {
		console.log(
			`[updateCharacterDraftSimple] Suggested fields:`,
			fieldsToUpdate
		)
	}

	// Import the draft orchestrator
	const { generateCharacterDraft } = await import(
		"$lib/server/assistantFunctions/utils/draftOrchestrator"
	)
	const { parseChatMetadata, getActiveCharacterDraft } = await import(
		"$lib/shared/types/chatMetadata"
	)

	// Get existing draft from chat metadata
	const chat = await db.query.chats.findFirst({
		where: eq(schema.chats.id, chatId),
		columns: { metadata: true }
	})

	const metadata = chat?.metadata || null
	const existingDraft = metadata ? getActiveCharacterDraft(metadata) : null

	if (!existingDraft) {
		throw new Error(
			"No existing draft found. Use draft_character to create a new draft first."
		)
	}

	// Generate draft using orchestrator with existing draft as context
	const result = await generateCharacterDraft({
		userId,
		chatId,
		userRequest,
		additionalFields:
			fieldsToUpdate.length > 0 ? (fieldsToUpdate as any[]) : undefined,
		existingDraft: existingDraft,
		socket: undefined // No socket - AssistantService handles progress
	})

	return {
		draft: result.draft as any,
		generatedFields: result.generatedFields,
		isValid: result.isValid,
		validationErrors: result.validationErrors?.map(
			(e: any) => e.message || String(e)
		)
	}
}

// ============================================================================
// WORLD/LOREBOOK HANDLERS
// ============================================================================

export async function listWorlds(
	userId: number,
	params: ListWorldsParams
): Promise<ListWorldsResult> {
	const { search, limit = 20 } = params

	const conditions = [eq(schema.lorebooks.userId, userId)]

	if (search) {
		conditions.push(
			or(
				like(schema.lorebooks.name, `%${search}%`),
				like(schema.lorebooks.description, `%${search}%`)
			)!
		)
	}

	const worlds = await db.query.lorebooks.findMany({
		where: and(...conditions),
		columns: {
			id: true,
			name: true,
			description: true
		},
		limit
	})

	return {
		worlds,
		total: worlds.length
	}
}

export async function getWorldDetails(
	userId: number,
	params: GetWorldDetailsParams
): Promise<GetWorldDetailsResult> {
	const { worldId } = params

	const world = await db.query.lorebooks.findFirst({
		where: and(
			eq(schema.lorebooks.id, worldId),
			eq(schema.lorebooks.userId, userId)
		),
		columns: {
			id: true,
			name: true,
			description: true
		},
		with: {
			worldLoreEntries: {
				columns: {
					id: true,
					name: true,
					category: true,
					keys: true,
					content: true,
					enabled: true,
					priority: true
				},
				orderBy: [desc(schema.worldLoreEntries.position)]
			},
			characterLoreEntries: {
				columns: {
					id: true,
					name: true,
					category: true,
					keys: true,
					content: true,
					enabled: true,
					priority: true
				}
			}
		}
	})

	if (!world) {
		return { world: null }
	}

	return {
		world: {
			id: world.id,
			name: world.name,
			description: world.description,
			worldEntries: world.worldLoreEntries,
			characterEntries: world.characterLoreEntries
		}
	}
}

// ============================================================================
// PERSONA HANDLERS
// ============================================================================

export async function listPersonas(
	userId: number,
	params: ListPersonasParams
): Promise<ListPersonasResult> {
	const { search, limit = 20 } = params

	const conditions = [eq(schema.personas.userId, userId)]

	if (search) {
		conditions.push(
			or(
				like(schema.personas.name, `%${search}%`),
				like(schema.personas.description, `%${search}%`)
			)!
		)
	}

	const personas = await db.query.personas.findMany({
		where: and(...conditions),
		columns: {
			id: true,
			name: true,
			description: true,
			avatar: true
		},
		limit
	})

	return {
		personas,
		total: personas.length
	}
}

// ============================================================================
// DOCUMENTATION HANDLERS
// ============================================================================

export async function searchDocumentation(
	userId: number,
	params: SearchDocumentationParams
): Promise<SearchDocumentationResult> {
	const { query, category } = params

	// TODO: Implement actual documentation search
	// For now, return helpful placeholder responses based on common queries

	const mockDocs = [
		{
			title: "Getting Started with Serene Pub",
			content:
				"Serene Pub is an AI-powered roleplay and creative writing application. You can create characters, personas, and have conversations with them using various AI backends.",
			category: "general",
			relevance: 0.9
		},
		{
			title: "Creating Characters",
			content:
				"Characters are the AI entities you chat with. You can create them manually or use the assistant to draft them. Each character can have personality traits, scenarios, greetings, and example dialogue.",
			category: "characters",
			relevance: 0.85
		},
		{
			title: "Setting up AI Connections",
			content:
				"Serene Pub supports multiple AI backends: OpenAI, Ollama, LM Studio, Llama.cpp, KoboldCpp, and Anthropic. Configure your connections in the settings.",
			category: "connections",
			relevance: 0.8
		}
	]

	// Filter by category if specified
	let results = category
		? mockDocs.filter((doc) => doc.category === category)
		: mockDocs

	// Simple keyword matching
	if (query) {
		const queryLower = query.toLowerCase()
		results = results.filter(
			(doc) =>
				doc.title.toLowerCase().includes(queryLower) ||
				doc.content.toLowerCase().includes(queryLower)
		)
	}

	return {
		results,
		total: results.length
	}
}
