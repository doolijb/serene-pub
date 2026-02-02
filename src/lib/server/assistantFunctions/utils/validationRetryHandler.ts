/**
 * Validation Retry Handler
 *
 * Utilities for automatically correcting validation errors using LLM.
 * When a draft fails validation, this handler sends the errors back to the LLM
 * to fix specific fields.
 */

import type { z } from "zod"
import {
	validateWithStructuredErrors,
	generateLLMErrorMessage,
	type FormattedValidationError
} from "$lib/server/utils/assistantValidation"
import { generateFieldWithLLM } from "./llmFieldGenerator"

/**
 * Result of a validation retry attempt
 */
export interface ValidationRetryResult<T> {
	success: boolean
	data?: T
	errors?: FormattedValidationError[]
	errorMessage?: string
	attempts: number
	correctedFields?: string[]
}

/**
 * Retry validation with automatic LLM correction
 *
 * @param schema - Zod schema to validate against
 * @param draft - Draft object to validate and correct
 * @param entityType - Type of entity (for error messages)
 * @param userId - User ID for LLM calls
 * @param maxAttempts - Maximum number of retry attempts
 * @param onAttempt - Callback for each retry attempt
 * @returns Validation result with corrected draft
 */
export async function retryValidationWithLLM<T extends Record<string, any>>({
	schema,
	draft,
	entityType,
	userId,
	maxAttempts = 3,
	onAttempt
}: {
	schema: z.ZodSchema<T>
	draft: Partial<T>
	entityType: string
	userId: number
	maxAttempts?: number
	onAttempt?: (
		attempt: number,
		errors: FormattedValidationError[],
		fields: string[]
	) => void | Promise<void>
}): Promise<ValidationRetryResult<T>> {
	let currentDraft = { ...draft }
	let attempts = 0
	const correctedFields: Set<string> = new Set()

	while (attempts < maxAttempts) {
		attempts++

		console.log(`[ValidationRetry] Attempt ${attempts}/${maxAttempts}`)

		// Validate current draft
		const validationResult = validateWithStructuredErrors(
			schema,
			currentDraft,
			entityType
		)

		if (validationResult.success) {
			console.log(
				`[ValidationRetry] Validation successful after ${attempts} attempts`
			)
			return {
				success: true,
				data: validationResult.data,
				attempts,
				correctedFields: Array.from(correctedFields)
			}
		}

		// Extract errors
		const errors = validationResult.error.errors
		console.log(
			`[ValidationRetry] Validation failed with ${errors.length} errors`
		)

		// If this is the last attempt, return the errors
		if (attempts >= maxAttempts) {
			console.log(
				`[ValidationRetry] Max attempts reached, returning errors`
			)
			return {
				success: false,
				errors,
				errorMessage: validationResult.error.message,
				attempts
			}
		}

		// Determine which fields can be auto-corrected
		const correctableErrors = extractCorrectableErrors(errors, currentDraft)

		if (correctableErrors.length === 0) {
			console.log(`[ValidationRetry] No correctable errors found`)
			return {
				success: false,
				errors,
				errorMessage: validationResult.error.message,
				attempts
			}
		}

		console.log(
			`[ValidationRetry] Attempting to correct ${correctableErrors.length} fields:`,
			correctableErrors.map((e) => e.field)
		)

		// Notify callback
		await onAttempt?.(
			attempts,
			errors,
			correctableErrors.map((e) => e.field)
		)

		// Attempt to fix each correctable error
		for (const error of correctableErrors) {
			try {
				const correctedValue = await correctFieldError({
					error,
					currentValue: currentDraft[error.field as keyof T],
					draft: currentDraft,
					userId
				})

				if (correctedValue !== undefined) {
					currentDraft = {
						...currentDraft,
						[error.field]: correctedValue
					}
					correctedFields.add(error.field)
					console.log(
						`[ValidationRetry] Corrected field: ${error.field}`
					)
				}
			} catch (err) {
				console.error(
					`[ValidationRetry] Failed to correct field ${error.field}:`,
					err
				)
				// Continue with other fields
			}
		}
	}

	// This shouldn't be reached, but TypeScript needs it
	return {
		success: false,
		errors: [],
		errorMessage: "Unknown validation error",
		attempts
	}
}

/**
 * Extract errors that can be automatically corrected
 *
 * Some errors are fixable (like length violations), others require user input
 */
function extractCorrectableErrors(
	errors: FormattedValidationError[],
	draft: Record<string, any>
): FormattedValidationError[] {
	return errors.filter((error) => {
		// Can only correct errors on fields that already have values
		if (!error.field || !(error.field in draft)) {
			return false
		}

		// Can correct these types of errors:
		// - String length violations (too long, too short)
		// - Array length violations
		// - Format issues that can be rephrased
		const correctableTypes = [
			"too_small",
			"too_big",
			"invalid_string",
			"invalid_type"
		]

		return correctableTypes.includes(error.code)
	})
}

/**
 * Correct a single field error using LLM
 */
async function correctFieldError({
	error,
	currentValue,
	draft,
	userId
}: {
	error: FormattedValidationError
	currentValue: any
	draft: Record<string, any>
	userId: number
}): Promise<any> {
	// Build a prompt to fix this specific error
	const prompt = buildCorrectionPrompt(error, currentValue, draft)

	// Determine expected response type
	const isArray = Array.isArray(currentValue)

	// Call LLM to fix the issue
	const response = await generateFieldWithLLM({
		userId,
		systemPrompt:
			"You are a helpful assistant that fixes validation errors in character data. Follow the instructions exactly and return ONLY the corrected value.",
		userPrompt: prompt,
		maxTokens: isArray ? 1000 : 500
	})

	// Parse the response
	if (isArray) {
		try {
			// Extract JSON array from response
			const jsonMatch = response.match(/\[[\s\S]*\]/)
			if (jsonMatch) {
				return JSON.parse(jsonMatch[0])
			}
			return currentValue // Fallback to original if can't parse
		} catch {
			return currentValue
		}
	} else {
		return response.trim()
	}
}

/**
 * Build a correction prompt for a specific validation error
 */
function buildCorrectionPrompt(
	error: FormattedValidationError,
	currentValue: any,
	draft: Record<string, any>
): string {
	const fieldName = error.field
	const errorMessage = error.message

	let prompt = `The field "${fieldName}" has a validation error:\n${errorMessage}\n\n`

	// Extract expected values from error message if possible
	// Error messages typically include the constraint (e.g., "String must contain at most 50 character(s)")
	const maxMatch = errorMessage.match(/at most (\d+)/)
	const minMatch = errorMessage.match(/at least (\d+)/)

	if (error.code === "too_big" && typeof currentValue === "string") {
		// String too long - ask LLM to shorten it
		const maxLength = maxMatch ? parseInt(maxMatch[1]) : 100
		prompt += `Current value (${currentValue.length} characters):\n"${currentValue}"\n\n`
		prompt += `Please rewrite this to be ${maxLength} characters or less while preserving the core meaning and character voice. `
		prompt += `Return ONLY the shortened text, nothing else.`
	} else if (error.code === "too_small" && typeof currentValue === "string") {
		// String too short - ask LLM to expand it
		const minLength = minMatch ? parseInt(minMatch[1]) : 10
		prompt += `Current value (${currentValue.length} characters):\n"${currentValue}"\n\n`
		prompt += `Please expand this to be at least ${minLength} characters while maintaining the character's voice and adding relevant detail. `
		prompt += `Return ONLY the expanded text, nothing else.`
	} else if (error.code === "too_big" && Array.isArray(currentValue)) {
		// Array too long - ask LLM to select best items
		const maxLength = maxMatch ? parseInt(maxMatch[1]) : 10
		prompt += `Current array (${currentValue.length} items):\n${JSON.stringify(currentValue, null, 2)}\n\n`
		prompt += `Please select the ${maxLength} best/most important items from this array. `
		prompt += `Return ONLY a JSON array with your selection, nothing else.`
	} else if (error.code === "too_small" && Array.isArray(currentValue)) {
		// Array too short - ask LLM to add items
		const minLength = minMatch ? parseInt(minMatch[1]) : 1
		prompt += `Current array (${currentValue.length} items):\n${JSON.stringify(currentValue, null, 2)}\n\n`
		prompt += `Please add ${minLength - currentValue.length} more items in a similar style to reach at least ${minLength} items. `
		prompt += `Return ONLY a JSON array with the complete result (including original items), nothing else.`
	} else {
		// Generic correction
		prompt += `Current value:\n${JSON.stringify(currentValue, null, 2)}\n\n`
		prompt += `Please correct this value to fix the validation error. `
		if (Array.isArray(currentValue)) {
			prompt += `Return ONLY a JSON array, nothing else.`
		} else {
			prompt += `Return ONLY the corrected text, nothing else.`
		}
	}

	return prompt
}
