/**
 * Draft Orchestrator
 *
 * High-level orchestration for character draft creation.
 * Coordinates field generation, validation, and progress updates.
 */

import type { Socket } from "socket.io"
import type { AssistantCreateCharacter } from "$lib/server/db/zodSchemas"
import { assistantCreateCharacterSchema } from "$lib/server/db/zodSchemas"
import {
	determineFieldsToPopulate,
	buildPromptForField,
	FIELD_GENERATION_GUIDANCE,
	initializeEmptyDraft
} from "./characterDraftGenerator"
import {
	generateFieldWithProgress,
	type FieldGenerationProgressCallback
} from "./llmFieldGenerator"
import { retryValidationWithLLM } from "./validationRetryHandler"

/**
 * Parse LLM response for a field value
 */
function parseFieldValue(fieldName: string, response: string): any {
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

/**
 * Options for draft generation
 */
export interface GenerateDraftOptions {
	userId: number
	chatId: number
	userRequest: string
	additionalFields?: string[]
	existingDraft?: Partial<AssistantCreateCharacter>
	socket?: Socket
}

/**
 * Result of draft generation
 */
export interface GenerateDraftResult {
	success: boolean
	draft: Partial<AssistantCreateCharacter>
	isValid: boolean
	validationErrors?: any[]
	errorMessage?: string
	generatedFields: string[]
	validationAttempts: number
}

/**
 * Generate a character draft with full LLM field generation and validation
 *
 * This is the main orchestrator that:
 * 1. Determines which fields to populate
 * 2. Generates each field using LLM
 * 3. Validates the result
 * 4. Retries with auto-correction if needed
 * 5. Emits progress updates via socket
 */
export async function generateCharacterDraft({
	userId,
	chatId,
	userRequest,
	additionalFields = [],
	existingDraft,
	socket
}: GenerateDraftOptions): Promise<GenerateDraftResult> {
	console.log("[DraftOrchestrator] Starting character draft generation")

	const generatedFields: string[] = []

	// 1. Determine which fields to populate
	const fieldsToPopulate = determineFieldsToPopulate(
		userRequest,
		additionalFields,
		existingDraft || null
	)

	console.log("[DraftOrchestrator] Fields to populate:", fieldsToPopulate)

	// Emit initial status
	emitProgress(socket, chatId, {
		status: "started",
		message: `Generating ${fieldsToPopulate.length} field(s)...`,
		totalFields: fieldsToPopulate.length
	})

	// 2. Initialize draft structure
	// If we have an existing draft, use it; otherwise create a fully initialized empty structure
	// This ensures all fields exist before field generation starts, preventing undefined access errors
	const draft: Partial<AssistantCreateCharacter> = existingDraft
		? { ...existingDraft }
		: initializeEmptyDraft()

	console.log(
		"[DraftOrchestrator] Draft initialized with structure:",
		Object.keys(draft)
	)

	// 3. Build draft by generating each field
	for (let i = 0; i < fieldsToPopulate.length; i++) {
		const field = fieldsToPopulate[i]
		const guidance = FIELD_GENERATION_GUIDANCE[field]

		if (!guidance) {
			console.warn(
				`[DraftOrchestrator] No guidance found for field: ${field}`
			)
			continue
		}

		try {
			// Generate prompt for this field
			const prompt = buildPromptForField(field, userRequest, draft)

			console.log(
				`[DraftOrchestrator] Generating field "${field}" with prompt:`,
				prompt
			)

			// Progress callback for this field
			const onProgress: FieldGenerationProgressCallback = (update) => {
				emitProgress(socket, chatId, {
					status: "generating_field",
					field: update.field,
					fieldStatus: update.status,
					message: update.message,
					currentField: i + 1,
					totalFields: fieldsToPopulate.length
				})
			}

			// Generate the field value
			const rawValue = await generateFieldWithProgress({
				userId,
				field,
				prompt,
				maxTokens: guidance.maxLength
					? Math.min(guidance.maxLength * 2, 1000)
					: 500,
				onProgress
			})

			console.log(
				`[DraftOrchestrator] Raw LLM response for "${field}":`,
				rawValue
			)

			// Parse the value based on field type
			let fieldValue: any = rawValue.trim()

			// Handle array fields
			if (guidance?.isArray) {
				// Try to fix common JSON issues before parsing
				let cleanedValue = rawValue.trim()

				// Fix unescaped quotes within array strings
				// This handles cases like ["text with "quotes" inside"]
				// We need to escape quotes that are inside array elements but not the array delimiters
				const arrayMatch = cleanedValue.match(/^\[[\s\S]*\]$/)
				if (arrayMatch) {
					try {
						// First attempt: try parsing as-is
						const parsed = JSON.parse(cleanedValue)
						if (Array.isArray(parsed)) {
							fieldValue = parsed
							console.log(
								`[DraftOrchestrator] Successfully parsed array for "${field}":`,
								fieldValue
							)
						}
					} catch (parseError) {
						console.log(
							`[DraftOrchestrator] Initial parse failed, attempting to fix quotes...`
						)

						// Attempt to fix unescaped quotes
						// Match pattern: ["...", "...", ...] and fix quotes inside each element
						try {
							// Replace straight quotes in dialogue with escaped quotes
							// This regex finds patterns like: "text "dialogue" more text"
							// and replaces middle quotes: "text \"dialogue\" more text"
							let fixed = cleanedValue

							// Find all array elements and fix quotes within them
							const elements: string[] = []
							let depth = 0
							let currentElement = ""
							let inString = false
							let escapeNext = false

							for (let i = 0; i < fixed.length; i++) {
								const char = fixed[i]

								if (escapeNext) {
									currentElement += char
									escapeNext = false
									continue
								}

								if (char === "\\") {
									currentElement += char
									escapeNext = true
									continue
								}

								if (char === '"') {
									if (depth === 1 && !inString) {
										// Start of string element
										inString = true
										currentElement += char
									} else if (depth === 1 && inString) {
										// Could be end of string or quote inside string
										// Check if next char is comma, ] or whitespace followed by comma/]
										const nextChars = fixed
											.slice(i + 1)
											.match(/^\s*[,\]]/)
										if (nextChars) {
											// End of string element
											currentElement += char
											inString = false
										} else {
											// Quote inside string - escape it
											currentElement += '\\"'
										}
									} else {
										currentElement += char
									}
								} else if (char === "[") {
									depth++
									if (depth > 1) currentElement += char
								} else if (char === "]") {
									if (depth === 1 && currentElement.trim()) {
										elements.push(currentElement.trim())
										currentElement = ""
									}
									depth--
									if (depth > 0) currentElement += char
								} else if (
									char === "," &&
									depth === 1 &&
									!inString
								) {
									if (currentElement.trim()) {
										elements.push(currentElement.trim())
										currentElement = ""
									}
								} else if (depth >= 1) {
									currentElement += char
								}
							}

							if (elements.length > 0) {
								fixed = "[" + elements.join(", ") + "]"
								console.log(
									`[DraftOrchestrator] Fixed JSON for "${field}":`,
									fixed.substring(0, 200)
								)
								fieldValue = JSON.parse(fixed)
								console.log(
									`[DraftOrchestrator] Successfully parsed fixed array for "${field}":`,
									fieldValue
								)
							} else {
								throw new Error(
									"Could not extract array elements"
								)
							}
						} catch (fixError) {
							console.warn(
								`[DraftOrchestrator] Could not fix quotes in array for "${field}":`,
								fixError
							)
							// Fall through to other parsing attempts
						}
					}
				}

				// If we still don't have a valid array, try original fallback logic
				if (!Array.isArray(fieldValue)) {
					try {
						const parsed = JSON.parse(cleanedValue)
						if (Array.isArray(parsed)) {
							fieldValue = parsed
							console.log(
								`[DraftOrchestrator] Successfully parsed array for "${field}":`,
								fieldValue
							)
						} else {
							console.log(
								`[DraftOrchestrator] Parsed JSON but not an array for "${field}":`,
								parsed
							)
							// Try to extract array from response
							const match = rawValue.match(/\[[\s\S]*\]/)
							if (match) {
								try {
									fieldValue = JSON.parse(match[0])
									console.log(
										`[DraftOrchestrator] Extracted array from text for "${field}":`,
										fieldValue
									)
								} catch {
									console.warn(
										`[DraftOrchestrator] Failed to extract array from match for "${field}"`
									)
									fieldValue = []
								}
							} else {
								console.warn(
									`[DraftOrchestrator] No array found in response for "${field}"`
								)
								fieldValue = []
							}
						}
					} catch (error) {
						console.warn(
							`[DraftOrchestrator] JSON parse failed for "${field}":`,
							error
						)

						// Check if we have multiple separate arrays (common LLM mistake)
						const arrayMatches = rawValue.match(/\[[^\[\]]*\]/g)
						if (arrayMatches && arrayMatches.length > 1) {
							console.log(
								`[DraftOrchestrator] Found ${arrayMatches.length} separate arrays, combining them`
							)
							try {
								// Parse each array and combine them
								const combinedArray: any[] = []
								for (const arrayStr of arrayMatches) {
									const parsed = JSON.parse(arrayStr)
									if (Array.isArray(parsed)) {
										combinedArray.push(...parsed)
									}
								}
								fieldValue = combinedArray
								console.log(
									`[DraftOrchestrator] Combined arrays for "${field}":`,
									fieldValue
								)
							} catch (combineError) {
								console.warn(
									`[DraftOrchestrator] Failed to combine arrays for "${field}":`,
									combineError
								)
								fieldValue = []
							}
						} else {
							// If parsing fails, try to extract single array from response
							const match = rawValue.match(/\[[\s\S]*?\]/)
							if (match) {
								try {
									fieldValue = JSON.parse(match[0])
									console.log(
										`[DraftOrchestrator] Extracted array from text (2nd attempt) for "${field}":`,
										fieldValue
									)
								} catch {
									console.warn(
										`[DraftOrchestrator] Failed to extract array from match (2nd attempt) for "${field}"`
									)
									fieldValue = []
								}
							} else {
								console.warn(
									`[DraftOrchestrator] No array pattern found in response for "${field}"`
								)
								fieldValue = []
							}
						}
					}
				}
			}

			// Update draft
			;(draft as any)[field] = fieldValue
			generatedFields.push(field)

			console.log(
				`[DraftOrchestrator] Generated field "${field}":`,
				fieldValue
			)

			// Emit field completion
			emitProgress(socket, chatId, {
				status: "field_complete",
				field,
				value: fieldValue,
				currentField: i + 1,
				totalFields: fieldsToPopulate.length
			})
		} catch (error) {
			console.error(
				`[DraftOrchestrator] Error generating field "${field}":`,
				error
			)

			// Emit error for this field
			emitProgress(socket, chatId, {
				status: "field_error",
				field,
				error: error instanceof Error ? error.message : "Unknown error",
				currentField: i + 1,
				totalFields: fieldsToPopulate.length
			})

			// Continue with other fields
			continue
		}
	}

	console.log("[DraftOrchestrator] Field generation complete, validating...")

	// Emit validation status
	emitProgress(socket, chatId, {
		status: "validating",
		message: "Validating character draft..."
	})

	// 3. Validate and auto-correct if needed
	const validationResult = await retryValidationWithLLM({
		schema: assistantCreateCharacterSchema as any, // Type assertion needed due to Zod complexity
		draft,
		entityType: "character",
		userId,
		maxAttempts: 3,
		onAttempt: async (attempt, errors, fields) => {
			console.log(
				`[DraftOrchestrator] Validation attempt ${attempt}, correcting fields:`,
				fields
			)

			emitProgress(socket, chatId, {
				status: "correcting",
				message: `Fixing ${fields.length} validation error(s) (attempt ${attempt}/3)...`,
				attempt,
				fields
			})
		}
	})

	console.log("[DraftOrchestrator] Validation result:", {
		success: validationResult.success,
		attempts: validationResult.attempts,
		correctedFields: validationResult.correctedFields
	})

	// 4. Emit final status
	if (validationResult.success) {
		emitProgress(socket, chatId, {
			status: "complete",
			message: "Character draft created successfully!",
			draft: validationResult.data,
			generatedFields,
			correctedFields: validationResult.correctedFields
		})

		return {
			success: true,
			draft: validationResult.data!,
			isValid: true,
			generatedFields,
			validationAttempts: validationResult.attempts
		}
	} else {
		emitProgress(socket, chatId, {
			status: "validation_failed",
			message: "Character draft has validation errors",
			draft,
			errors: validationResult.errors,
			generatedFields
		})

		return {
			success: true, // Draft was created, just not valid
			draft,
			isValid: false,
			validationErrors: validationResult.errors,
			errorMessage: validationResult.errorMessage,
			generatedFields,
			validationAttempts: validationResult.attempts
		}
	}
}

/**
 * Emit progress update via socket
 */
function emitProgress(socket: Socket | undefined, chatId: number, update: any) {
	if (!socket) return

	socket.emit("assistant:draftProgress", {
		chatId,
		...update,
		timestamp: Date.now()
	})
}
