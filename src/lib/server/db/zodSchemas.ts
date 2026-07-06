/**
 * Zod Validation Schemas for Assistant Entity Creation/Editing
 *
 * This file contains auto-generated Zod schemas from Drizzle ORM schemas,
 * refined with custom validation rules for assistant use.
 *
 * These schemas serve multiple purposes:
 * 1. Runtime validation of data before database operations
 * 2. Type inference for TypeScript
 * 3. JSON Schema generation for LLM function calling
 * 4. Single source of truth for validation rules
 */

import { createInsertSchema, createSelectSchema } from "drizzle-zod"
import { z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import * as schema from "./schema"

// ============================================================================
// CHARACTER SCHEMAS
// ============================================================================

/**
 * Base insert schema auto-generated from Drizzle
 */
export const insertCharacterSchema = createInsertSchema(schema.characters)

/**
 * Base select schema auto-generated from Drizzle
 */
export const selectCharacterSchema = createSelectSchema(schema.characters)

/**
 * Refined schema for assistant character creation
 * Omits system-managed fields and adds custom validation
 */
export const assistantCreateCharacterSchema = createInsertSchema(
	schema.characters,
	{
		// Override with custom validation using callback functions
		name: (schema) =>
			schema
				.min(1, "Character name is required")
				.max(50, "Character name must be 100 characters or less")
				.describe("The character's primary name"),

		description: (schema) =>
			schema
				.min(10, "Description must be at least 10 characters")
				.describe(
					"Detailed description of the character including personality, appearance, and background"
				),

		nickname: (schema) =>
			schema
				.max(50, "Nickname must be 100 characters or less")
				.optional()
				.describe(
					"An optional nickname or alternative name for the character"
				),

		personality: (schema) =>
			schema
				.optional()
				.describe(
					"The character's personality traits and behavioral patterns"
				),

		scenario: (schema) =>
			schema
				.optional()
				.describe("The scenario or setting where the character exists"),

		firstMessage: (schema) =>
			schema
				.max(2000, "First message must be 2000 characters or less")
				.optional()
				.describe("The character's greeting or opening message"),

		characterVersion: (schema) =>
			schema
				.max(20, "Version must be 20 characters or less")
				.optional()
				.describe("Character card version (e.g., '1.0', '2.0')"),

		alternateGreetings: (schema) =>
			schema.describe("Array of alternative greeting messages"),

		exampleDialogues: (schema) =>
			schema.describe("Array of example conversation snippets"),

		creatorNotes: (schema) =>
			schema.optional().describe("Notes from the character creator"),

		creatorNotesMultilingual: (schema) =>
			schema
				.optional()
				.describe(
					"Creator notes in multiple languages (key: language code, value: notes)"
				),

		groupOnlyGreetings: (schema) =>
			schema
				.optional()
				.describe("Greetings specifically for group chats"),

		postHistoryInstructions: (schema) =>
			schema
				.max(
					2000,
					"Post-history instructions must be 2000 characters or less"
				)
				.optional()
				.describe(
					"Instructions for how the character should behave after chat history"
				),

		source: (schema) =>
			schema.describe(
				"Sources for the character (e.g., books, shows, original)"
			)
	}
).omit({
	id: true, // Auto-generated
	userId: true, // Set by system
	createdAt: true, // Auto-generated
	updatedAt: true, // Auto-generated
	isDeleted: true, // System managed
	isFavorite: true, // Not set during creation
	lorebookId: true, // Not set during creation (can be linked later)
	assets: true, // Managed separately
	aliases: true // Set via UI after creation
})

// ============================================================================
// PERSONA SCHEMAS
// ============================================================================

/**
 * Base insert schema auto-generated from Drizzle
 */
export const insertPersonaSchema = createInsertSchema(schema.personas)

/**
 * Base select schema auto-generated from Drizzle
 */
export const selectPersonaSchema = createSelectSchema(schema.personas)

/**
 * Refined schema for assistant persona creation
 */
export const assistantCreatePersonaSchema = createInsertSchema(
	schema.personas,
	{
		name: (schema) =>
			schema
				.min(1, "Persona name is required")
				.max(100, "Persona name must be 100 characters or less")
				.describe("The persona's name"),

		description: (schema) =>
			schema
				.min(10, "Description must be at least 10 characters")
				.max(2000, "Description must be 2000 characters or less")
				.describe(
					"Description of the persona including traits and characteristics"
				),

		avatar: (schema) =>
			schema
				.max(500, "Avatar path must be 500 characters or less")
				.optional()
				.describe("Path or URL to the persona's avatar image")
	}
).omit({
	id: true, // Auto-generated
	userId: true, // Set by system
	createdAt: true, // Auto-generated
	updatedAt: true, // Auto-generated
	isDeleted: true, // System managed
	isDefault: true, // Set separately
	lorebookId: true, // Not set during creation (can be linked later)
	aliases: true // Set via UI after creation
})

// ============================================================================
// JSON SCHEMA CONVERSION
// ============================================================================

/**
 * Convert Zod schemas to JSON Schema format for LLM consumption
 * Note: Using 'as any' to work around type incompatibility in zod-to-json-schema
 */
export const characterSchemaForLLM = {
	create: zodToJsonSchema(assistantCreateCharacterSchema as any, {
		name: "CreateCharacterParams",
		$refStrategy: "none" // Inline all definitions for clarity
	})
}

export const personaSchemaForLLM = {
	create: zodToJsonSchema(assistantCreatePersonaSchema as any, {
		name: "CreatePersonaParams",
		$refStrategy: "none"
	})
}

// ============================================================================
// TYPE HELPERS
// ============================================================================

/**
 * Type helpers for schema inference
 * Note: Using @ts-expect-error to suppress known drizzle-zod type incompatibilities
 * The schemas work correctly at runtime, the types are just complex
 */
// @ts-expect-error - drizzle-zod type compatibility
export type AssistantCreateCharacter = z.infer<typeof assistantCreateCharacterSchema>
// @ts-expect-error - drizzle-zod type compatibility
export type AssistantCreatePersona = z.infer<typeof assistantCreatePersonaSchema>
