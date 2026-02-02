/**
 * Assistant Validation Utilities
 *
 * Utilities for formatting Zod validation errors for LLM consumption
 * and enabling self-correction through structured error messages.
 */

import { ZodError, type ZodIssue } from "zod"

/**
 * Represents a validation error formatted for LLM understanding
 */
export interface FormattedValidationError {
	field: string
	message: string
	code: string
	received?: unknown
}

/**
 * Options for formatting validation errors
 */
export interface FormatValidationErrorOptions {
	/** Include the received value in error messages (default: false for privacy) */
	includeReceived?: boolean
	/** Maximum depth for nested field paths (default: 5) */
	maxDepth?: number
}

/**
 * Format a Zod validation error into LLM-friendly structured errors
 *
 * @param error - The ZodError to format
 * @param options - Formatting options
 * @returns Array of formatted errors
 *
 * @example
 * ```ts
 * try {
 *   schema.parse(data)
 * } catch (error) {
 *   if (error instanceof ZodError) {
 *     const formatted = formatValidationError(error)
 *     // Send to LLM for self-correction
 *   }
 * }
 * ```
 */
export function formatValidationError(
	error: ZodError,
	options: FormatValidationErrorOptions = {}
): FormattedValidationError[] {
	const { includeReceived = false, maxDepth = 5 } = options

	return error.issues.map((issue) => {
		const field = formatFieldPath(issue.path, maxDepth)
		const message = issue.message
		const code = issue.code

		const formatted: FormattedValidationError = {
			field,
			message,
			code
		}

		if (includeReceived && "received" in issue) {
			formatted.received = issue.received
		}

		return formatted
	})
}

/**
 * Convert field path array to readable string
 *
 * @param path - Array of path segments from ZodIssue
 * @param maxDepth - Maximum nesting depth to include
 * @returns Formatted field path string
 *
 * @example
 * formatFieldPath(['character', 'personality']) // => 'character.personality'
 * formatFieldPath(['items', 0, 'name']) // => 'items[0].name'
 */
export function formatFieldPath(
	path: (string | number)[],
	maxDepth: number = 5
): string {
	if (path.length === 0) return "root"
	if (path.length > maxDepth) {
		const truncated = path.slice(0, maxDepth)
		return (
			truncated
				.map((p) => (typeof p === "number" ? `[${p}]` : p))
				.join(".") + "..."
		)
	}

	return path
		.map((segment, index) => {
			if (typeof segment === "number") {
				return `[${segment}]`
			}
			// Add dot separator except for first segment and after array indices
			if (index > 0 && typeof path[index - 1] !== "number") {
				return `.${segment}`
			}
			return segment
		})
		.join("")
}

/**
 * Generate LLM-friendly error message for validation failures
 * This formats the errors into a clear message that the LLM can understand
 * and use to correct its function call parameters
 *
 * @param errors - Array of formatted validation errors
 * @param entityType - Type of entity being validated (e.g., 'character', 'persona')
 * @returns Formatted error message for LLM
 *
 * @example
 * ```ts
 * const errors = formatValidationError(zodError)
 * const message = generateLLMErrorMessage(errors, 'character')
 * // Returns: "Validation failed for character creation with 2 errors:\n1. ..."
 * ```
 */
export function generateLLMErrorMessage(
	errors: FormattedValidationError[],
	entityType: string
): string {
	if (errors.length === 0) {
		return `${entityType} validation passed successfully.`
	}

	const header = `Validation failed for ${entityType} with ${errors.length} error${errors.length > 1 ? "s" : ""}:`

	const errorLines = errors.map((error, index) => {
		const parts = [`${index + 1}. Field "${error.field}": ${error.message}`]

		if (error.received !== undefined) {
			parts.push(`   Received: ${JSON.stringify(error.received)}`)
		}

		return parts.join("\n")
	})

	return [header, ...errorLines].join("\n")
}

/**
 * Extract only correctable errors from validation results
 * Filters out system errors that the LLM cannot fix (like required server-side fields)
 *
 * @param errors - Array of formatted validation errors
 * @param nonCorrectableFields - Fields that LLM cannot set (e.g., 'id', 'userId', 'createdAt')
 * @returns Filtered errors that the LLM can correct
 */
export function extractCorrectableErrors(
	errors: FormattedValidationError[],
	nonCorrectableFields: string[] = ["id", "userId", "createdAt", "updatedAt"]
): FormattedValidationError[] {
	return errors.filter((error) => {
		// Check if error field starts with any non-correctable field
		return !nonCorrectableFields.some((field) =>
			error.field.startsWith(field)
		)
	})
}

/**
 * Check if validation error is recoverable by LLM self-correction
 * Some errors (like type mismatches in required fields) can be auto-corrected,
 * while others (like missing required data) might need user input
 *
 * @param error - Formatted validation error
 * @returns True if error is likely recoverable through self-correction
 */
export function isRecoverableError(error: FormattedValidationError): boolean {
	// Errors that are typically recoverable
	const recoverableCodes = [
		"too_small", // String too short, array too small
		"too_big", // String too long, array too large
		"invalid_type", // Wrong data type
		"invalid_string", // Invalid string format
		"invalid_enum_value" // Invalid enum value
	]

	return recoverableCodes.includes(error.code)
}

/**
 * Generate suggestions for fixing validation errors
 * Provides LLM with specific guidance on how to correct each error
 *
 * @param error - Formatted validation error
 * @returns Suggestion string for the LLM
 */
export function generateErrorSuggestion(
	error: FormattedValidationError
): string {
	switch (error.code) {
		case "too_small":
			return `Increase the value or add more items to "${error.field}".`

		case "too_big":
			return `Reduce the value or remove items from "${error.field}".`

		case "invalid_type":
			return `Ensure "${error.field}" has the correct data type.`

		case "invalid_string":
			return `Check the format of "${error.field}" matches requirements.`

		case "invalid_enum_value":
			return `"${error.field}" must be one of the allowed values.`

		case "invalid_date":
			return `"${error.field}" must be a valid date.`

		case "custom":
			return `"${error.field}" failed custom validation: ${error.message}`

		default:
			return `Review and correct "${error.field}": ${error.message}`
	}
}

/**
 * Create a complete validation response for function calling
 * This combines all error information into a structured response
 * that can be returned to the LLM through the function calling system
 *
 * @param zodError - The original ZodError
 * @param entityType - Type of entity (e.g., 'character', 'persona')
 * @param options - Formatting options
 * @returns Complete validation response object
 */
export function createValidationResponse(
	zodError: ZodError,
	entityType: string,
	options: FormatValidationErrorOptions = {}
) {
	const formattedErrors = formatValidationError(zodError, options)
	const correctableErrors = extractCorrectableErrors(formattedErrors)

	return {
		success: false,
		action: "validation_error",
		errorType: "validation_failed",
		entityType,
		message: generateLLMErrorMessage(correctableErrors, entityType),
		errors: correctableErrors.map((error) => ({
			...error,
			suggestion: generateErrorSuggestion(error),
			recoverable: isRecoverableError(error)
		})),
		totalErrors: formattedErrors.length,
		correctableErrors: correctableErrors.length,
		instruction:
			"Please fix the validation errors and retry the function call with corrected parameters."
	}
}

/**
 * Validate and return structured result
 * Helper function that wraps validation with proper error handling
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @param entityType - Type of entity for error messages
 * @returns Validation result with success flag and data or errors
 */
export function validateWithStructuredErrors<T>(
	schema: { parse: (data: unknown) => T },
	data: unknown,
	entityType: string
):
	| {
			success: true
			data: T
	  }
	| {
			success: false
			error: ReturnType<typeof createValidationResponse>
	  } {
	try {
		const validatedData = schema.parse(data)
		return {
			success: true,
			data: validatedData
		}
	} catch (error) {
		if (error instanceof ZodError) {
			return {
				success: false,
				error: createValidationResponse(error, entityType)
			}
		}
		// Re-throw non-Zod errors
		throw error
	}
}
