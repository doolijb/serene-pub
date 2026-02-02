/**
 * Character Draft Generator Utilities
 *
 * Utilities for generating character drafts field-by-field using LLM
 */

import type { Socket } from "socket.io"
import type { AssistantCreateCharacter } from "$lib/server/db/zodSchemas"

/**
 * Initialize an empty draft structure with all fields set to appropriate empty/default values
 * This ensures all properties exist before any field generation begins
 */
export function initializeEmptyDraft(): Partial<AssistantCreateCharacter> {
	return {
		// Required text fields
		name: "",
		description: "",

		// Optional text fields
		nickname: undefined,
		personality: undefined,
		scenario: undefined,
		firstMessage: undefined,
		creatorNotes: undefined,
		postHistoryInstructions: undefined,
		characterVersion: undefined,

		// Array fields - initialize as empty arrays to prevent undefined access
		alternateGreetings: [],
		exampleDialogues: [],
		groupOnlyGreetings: [],
		source: [],

		// Object fields - initialize as empty objects
		creatorNotesMultilingual: undefined
	}
}

/**
 * Fields that are required for character creation
 */
export const REQUIRED_CHARACTER_FIELDS = ["name", "description"] as const

/**
 * Optional fields that can be included in character drafts
 */
export const OPTIONAL_CHARACTER_FIELDS = [
	"nickname",
	"personality",
	"scenario",
	"firstMessage",
	"alternateGreetings",
	"exampleDialogues",
	"creatorNotes",
	"groupOnlyGreetings",
	"postHistoryInstructions",
	"source",
	"characterVersion"
] as const

/**
 * Field generation prompts and guidance
 */
export const FIELD_GENERATION_GUIDANCE: Record<
	string,
	{
		prompt: string
		maxLength?: number
		isArray?: boolean
	}
> = {
	name: {
		prompt: "Generate a character name. Keep it concise (1-50 characters). Return ONLY the name, nothing else.",
		maxLength: 50
	},
	description: {
		prompt: "Generate a detailed character description including personality, appearance, and background. Aim for vivid detail but be efficient (minimum 10 characters). Return ONLY the description text, nothing else.",
		maxLength: undefined
	},
	nickname: {
		prompt: "Generate an optional nickname or alternative name for this character. Keep it concise (max 50 characters). Return ONLY the nickname, nothing else.",
		maxLength: 50
	},
	personality: {
		prompt: "Generate the character's personality traits and behavioral patterns. Be detailed but efficient. Return ONLY the personality description, nothing else.",
		maxLength: undefined
	},
	scenario: {
		prompt: "Generate the scenario or setting where this character exists. Keep it under 2000 characters. Return ONLY the scenario text, nothing else.",
		maxLength: 2000
	},
	firstMessage: {
		prompt: "Generate the character's opening message where they first meet {{user}}. Write a paragraph (or two) in third person showing the character's actions, thoughts, and dialogue as they encounter {{user}}. Return ONLY the greeting message, nothing else.",
		maxLength: 2000
	},
	alternateGreetings: {
		prompt: 'Generate 2-3 alternative opening messages where the character first meets {{user}}. Each should be a paragraph showing:\n1. The character\'s observations about the environment\n2. Their perception of {{user}}\n3. Their emotions and thoughts\n4. Their speech and interaction with {{user}}\n\nWrite in third person. Use double quotes for dialogue and escape them with backslash. Return as a SINGLE JSON array of strings.\n\nExample format:\n["{{char}} notices {{user}} across the crowded tavern, their eyes meeting for a brief moment. The warmth of the fireplace casts dancing shadows across the room. \\"I couldn\'t help but notice you,\\" {{char}} says with a gentle smile, extending a hand in greeting.", "The rain patters softly against the window as {{char}} looks up from their book, surprised to see {{user}} standing in the doorway. A mix of curiosity and delight crosses their face. \\"What a pleasant surprise,\\" they murmur, setting the book aside. \\"Please, come in out of the rain.\\""]',
		isArray: true
	},
	exampleDialogues: {
		prompt: 'Generate 2-3 example dialogue snippets showing the character in conversation. Each should be 2-3 paragraphs showing:\n1. The character\'s observations about their environment or {{user}}\n2. Their emotions and internal thoughts\n3. Their actions and body language\n4. Their speech and interaction\n\nWrite in third person. The character can interact with others (e.g., holding hands, gestures) but should NOT control {{user}}\'s actions or dialogue. Use {{char}} for the character and {{user}} for the person they\'re interacting with. Use double quotes for dialogue and escape them with backslash. Return as a SINGLE JSON array of strings.\n\nExample format:\n["{{char}} gazes out at the sunset, the orange and pink hues reflecting in their eyes. They feel {{user}}\'s presence beside them and a warmth spreads through their chest. \\"It\'s beautiful, isn\'t it?\\" {{char}} whispers, reaching out to gently take {{user}}\'s hand. \\"I\'m glad we\'re here together.\\"", "The coffee shop bustles with activity, but {{char}} only has eyes for {{user}} sitting across from them. Nervous energy makes their fingers drum against the table. \\"I\'ve been wanting to tell you something,\\" {{char}} begins, their voice soft but earnest. They take a deep breath, gathering courage. \\"You make me feel like I can be myself.\\""]',
		isArray: true
	},
	creatorNotes: {
		prompt: "Generate creator notes about this character - design philosophy, inspiration, usage tips. Return ONLY the notes text, nothing else.",
		maxLength: undefined
	},
	groupOnlyGreetings: {
		prompt: "Generate 1-2 opening messages for when this character joins a group chat with multiple people. Each should show the character acknowledging the group and introducing themselves. Write in third person. Return as a JSON array of strings.",
		isArray: true
	},
	postHistoryInstructions: {
		prompt: "Generate instructions for how the character should behave after chat history. Keep it under 2000 characters. Return ONLY the instruction text, nothing else.",
		maxLength: 2000
	},
	source: {
		prompt: 'List the sources for this character (e.g., "Original Creation", book titles, show names). Return as a JSON array of strings.',
		isArray: true
	},
	characterVersion: {
		prompt: 'Specify the character card version (typically "1.0" or "2.0"). Return ONLY the version string, nothing else.',
		maxLength: 20
	}
}

/**
 * Generate a system prompt for creating a specific field value
 */
export function buildPromptForField(
	fieldName: string,
	userRequest: string,
	existingDraft: Partial<AssistantCreateCharacter>
): string {
	const guidance = FIELD_GENERATION_GUIDANCE[fieldName]
	if (!guidance) {
		throw new Error(`No guidance found for field: ${fieldName}`)
	}

	const contextParts: string[] = [
		"You are helping to create a character based on the user's request.",
		"",
		`User request: "${userRequest}"`,
		""
	]

	// Check if this field already exists and we're updating it
	const fieldExists = existingDraft[fieldName as keyof typeof existingDraft]
	const isUpdate = fieldExists && String(fieldExists).length > 0

	// Add existing field values for context
	if (Object.keys(existingDraft).length > 0) {
		contextParts.push("Existing character details:")
		for (const [key, value] of Object.entries(existingDraft)) {
			if (value !== null && value !== undefined) {
				contextParts.push(`- ${key}: ${JSON.stringify(value)}`)
			}
		}
		contextParts.push("")
	}

	// Modify the prompt based on whether we're creating or updating
	if (isUpdate) {
		// For updates, emphasize improvement and expansion
		const updatePrompt = guidance.prompt.replace(
			/^Generate/i,
			"IMPROVE and EXPAND upon the existing content. Generate"
		)
		contextParts.push(`Your task: ${updatePrompt}`)
		contextParts.push(
			`IMPORTANT: The existing ${fieldName} is provided above. Your goal is to make it MORE DETAILED, MORE VIVID, and BETTER aligned with the user's request. Do NOT just rewrite it similarly - ADD significant new detail and depth.`
		)
	} else {
		contextParts.push(`Your task: ${guidance.prompt}`)
	}

	if (guidance.maxLength) {
		contextParts.push(`Maximum length: ${guidance.maxLength} characters`)
	}

	contextParts.push("")
	contextParts.push(
		"IMPORTANT: Return ONLY the requested content, no explanations or additional text."
	)

	return contextParts.join("\n")
}

/**
 * Determine which fields to populate based on user request and existing draft
 */
export function determineFieldsToPopulate(
	userRequest: string,
	additionalFields: string[] = [],
	existingDraft: Partial<AssistantCreateCharacter> | null
): string[] {
	const fields: string[] = []

	// Detect if this is a regeneration/modification request
	const regenerationKeywords = [
		"reroll",
		"regenerate",
		"change",
		"modify",
		"update",
		"redo",
		"remake",
		"rewrite",
		"remove",
		"add",
		"adjust",
		"fix",
		"correct",
		"improve",
		"enhance",
		"better",
		"flesh out",
		"expand",
		"elaborate",
		"refine",
		"polish",
		"revise",
		"edit"
	]
	const isRegenerationRequest = regenerationKeywords.some((keyword) =>
		userRequest.toLowerCase().includes(keyword)
	)

	// Detect which fields are mentioned in the user request
	const requestLower = userRequest.toLowerCase()
	const mentionedFields: string[] = []

	// Check for field names mentioned in the request
	const allFields = [
		...REQUIRED_CHARACTER_FIELDS,
		...OPTIONAL_CHARACTER_FIELDS
	]
	for (const field of allFields) {
		// Match field name with word boundaries or as part of common phrases
		if (
			requestLower.includes(field.toLowerCase()) ||
			(field === "name" && requestLower.match(/\bname\b/)) ||
			(field === "nickname" && requestLower.match(/\bnick|alias\b/)) ||
			(field === "personality" &&
				requestLower.match(/\bpersonality|traits?\b/)) ||
			(field === "description" &&
				requestLower.match(/\bdescription|appearance|look\b/)) ||
			(field === "scenario" &&
				requestLower.match(/\bscenario|setting|background\b/)) ||
			(field === "firstMessage" &&
				requestLower.match(/\bgreeting|first message|opening\b/)) ||
			(field === "alternateGreetings" &&
				requestLower.match(
					/\balternate greeting|alternative greeting|other greeting/
				)) ||
			(field === "exampleDialogues" &&
				requestLower.match(/\bexample|dialogue|conversation|sample/)) ||
			(field === "groupOnlyGreetings" &&
				requestLower.match(
					/\bgroup greeting|group only|group chat greeting/
				)) ||
			(field === "source" &&
				requestLower.match(/\bsource|from|based on\b/))
		) {
			mentionedFields.push(field)
		}
	}

	// Always include required fields if not already present
	for (const field of REQUIRED_CHARACTER_FIELDS) {
		if (!existingDraft || !(field in existingDraft)) {
			fields.push(field)
		}
	}

	// Add requested additional fields
	// If additionalFields are explicitly provided (e.g., from tool call), ALWAYS include them
	// This ensures that when the assistant calls update_character_draft with fieldsToUpdate,
	// those fields are regenerated even if the user request doesn't contain regeneration keywords
	for (const field of additionalFields) {
		if (
			OPTIONAL_CHARACTER_FIELDS.includes(field as any) ||
			REQUIRED_CHARACTER_FIELDS.includes(field as any)
		) {
			if (!fields.includes(field)) {
				console.log(
					`[determineFieldsToPopulate] Adding explicitly requested field: ${field}`
				)
				fields.push(field)
			}
		}
	}

	// Add fields mentioned in the request (if modification is requested)
	if (isRegenerationRequest && mentionedFields.length > 0) {
		for (const field of mentionedFields) {
			if (!fields.includes(field)) {
				console.log(
					`[determineFieldsToPopulate] Adding mentioned field: ${field}`
				)
				fields.push(field)
			}
		}

		// CROSS-REFERENCE DETECTION: If name is being changed, also update fields that likely contain the name
		if (mentionedFields.includes("name") && existingDraft?.name) {
			const fieldsWithPotentialNameReferences = [
				"description",
				"personality",
				"scenario",
				"firstMessage",
				"exampleDialogues"
			]
			for (const field of fieldsWithPotentialNameReferences) {
				if (
					existingDraft[field as keyof typeof existingDraft] &&
					!fields.includes(field)
				) {
					console.log(
						`[determineFieldsToPopulate] Name change detected - adding cross-reference field: ${field}`
					)
					fields.push(field)
				}
			}
		}

		// If personality is being changed, update greeting and example dialogue to match
		if (
			mentionedFields.includes("personality") &&
			existingDraft?.personality
		) {
			const personalityDependentFields = [
				"firstMessage",
				"exampleDialogues"
			]
			for (const field of personalityDependentFields) {
				if (
					existingDraft[field as keyof typeof existingDraft] &&
					!fields.includes(field)
				) {
					console.log(
						`[determineFieldsToPopulate] Personality change detected - adding dependent field: ${field}`
					)
					fields.push(field)
				}
			}
		}

		// If scenario is being changed, update description and greeting
		if (mentionedFields.includes("scenario") && existingDraft?.scenario) {
			const scenarioDependentFields = ["description", "firstMessage"]
			for (const field of scenarioDependentFields) {
				if (
					existingDraft[field as keyof typeof existingDraft] &&
					!fields.includes(field)
				) {
					console.log(
						`[determineFieldsToPopulate] Scenario change detected - adding dependent field: ${field}`
					)
					fields.push(field)
				}
			}
		}
	}

	return fields
}

/**
 * Parse LLM response for a field value
 */
export function parseFieldValue(fieldName: string, response: string): any {
	const guidance = FIELD_GENERATION_GUIDANCE[fieldName]

	if (guidance?.isArray) {
		// Try to parse as JSON array
		try {
			const parsed = JSON.parse(response.trim())
			if (Array.isArray(parsed)) {
				return parsed
			}
		} catch (error) {
			// If parsing fails, try to extract array from response
			const match = response.match(/\[[\s\S]*\]/)
			if (match) {
				try {
					return JSON.parse(match[0])
				} catch {
					// Fall through to return empty array
				}
			}
		}
		return []
	}

	// For non-array fields, return trimmed response
	return response.trim()
}
