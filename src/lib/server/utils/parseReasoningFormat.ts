/**
 * Reasoning Format Parser
 *
 * Parses the assistant's reasoning response to extract function calls.
 * Format: {reasoning: "explanation", functions?: [fn(arg:"value"), fn2(arg:"value")]}
 */

export interface ParsedReasoning {
	reasoning: string
	functionCalls: Array<{
		name: string
		args: Record<string, any>
	}>
}

/**
 * Parse reasoning format from assistant response
 */
export function parseReasoningFormat(content: string): ParsedReasoning | null {
	console.log(
		"[parseReasoningFormat] Parsing content, length:",
		content.length
	)
	console.log(
		"[parseReasoningFormat] First 500 chars:",
		content.substring(0, 500)
	)

	// Match: {reasoning: "...", functions?: [...]} or {reasoning:"...", functions:[...]}
	// Allow optional whitespace around colons and after commas
	// Also handle empty arrays: functions: []
	// Use a more robust pattern that handles nested brackets in function arguments
	const reasoningPattern =
		/\{\s*reasoning\s*:\s*"([^"]+)"\s*(?:,\s*functions\??\s*:\s*\[((?:[^\[\]]|\[[^\]]*\])*)\])?\s*\}/
	const match = content.match(reasoningPattern)

	console.log(
		"[parseReasoningFormat] Regex match:",
		match ? "FOUND" : "NOT FOUND"
	)
	if (match) {
		console.log("[parseReasoningFormat] Reasoning text:", match[1])
		console.log("[parseReasoningFormat] Functions string:", match[2])
	}

	if (!match) {
		return null
	}

	const reasoning = match[1]
	const functionsStr = match[2]

	// If functionsStr is empty string or undefined, return empty array
	const functionCalls =
		functionsStr && functionsStr.trim()
			? parseFunctionCalls(functionsStr)
			: []

	console.log(
		"[parseReasoningFormat] Parsed function calls:",
		functionCalls.length
	)
	if (functionCalls.length > 0) {
		console.log(
			"[parseReasoningFormat] Function calls:",
			JSON.stringify(functionCalls, null, 2)
		)
	}

	return {
		reasoning,
		functionCalls
	}
}

/**
 * Parse function call strings into structured data
 * Example: listCharacters(name:"Sarah"), getCharacter(id:5)
 */
export function parseFunctionCalls(
	functionsStr: string
): Array<{ name: string; args: Record<string, any> }> {
	console.log("[parseFunctionCalls] Parsing functions string:", functionsStr)

	const calls: Array<{ name: string; args: Record<string, any> }> = []

	// Match patterns like: functionName(arg1:"value1", arg2:123)
	const functionPattern = /(\w+)\(([^)]*)\)/g
	let fnMatch

	while ((fnMatch = functionPattern.exec(functionsStr)) !== null) {
		const name = fnMatch[1]
		const argsStr = fnMatch[2]
		console.log("[parseFunctionCalls] Found function:", name)
		console.log("[parseFunctionCalls] Arguments string:", argsStr)

		const args: Record<string, any> = {}

		if (argsStr.trim()) {
			// Parse arguments: arg:"value" or arg:["val1","val2"] or arg:number
			// First, try to parse array arguments
			const arrayArgPattern = /(\w+)\s*:\s*\[([^\]]*)\]/g
			let arrayMatch

			while ((arrayMatch = arrayArgPattern.exec(argsStr)) !== null) {
				const argName = arrayMatch[1]
				const arrayContent = arrayMatch[2]

				// Parse array items - they can be quoted strings or numbers
				const items: any[] = []
				const itemPattern = /["']([^"']+)["']|(\d+)/g
				let itemMatch

				while ((itemMatch = itemPattern.exec(arrayContent)) !== null) {
					if (itemMatch[1]) {
						// Quoted string
						items.push(itemMatch[1])
					} else if (itemMatch[2]) {
						// Number
						items.push(Number(itemMatch[2]))
					}
				}

				args[argName] = items
			}

			// Parse quoted string arguments (handles strings with spaces and special chars)
			// Match opening quote, capture content until matching closing quote
			// This handles apostrophes within double-quoted strings correctly
			const doubleQuotedPattern = /(\w+)\s*:\s*"([^"]*)"/g
			const singleQuotedPattern = /(\w+)\s*:\s*'([^']*)'/g

			let quotedMatch

			// First parse double-quoted strings
			while ((quotedMatch = doubleQuotedPattern.exec(argsStr)) !== null) {
				const argName = quotedMatch[1]
				const argValue = quotedMatch[2]

				// Skip if already parsed as array
				if (args[argName]) continue

				args[argName] = argValue
			}

			// Then parse single-quoted strings (if not already parsed)
			while ((quotedMatch = singleQuotedPattern.exec(argsStr)) !== null) {
				const argName = quotedMatch[1]
				const argValue = quotedMatch[2]

				// Skip if already parsed
				if (args[argName]) continue

				args[argName] = argValue
			}

			// Then parse simple unquoted arguments (numbers, booleans)
			const simpleArgPattern = /(\w+)\s*:\s*([^,"'\[\]\s]+)/g
			let simpleMatch

			while ((simpleMatch = simpleArgPattern.exec(argsStr)) !== null) {
				const argName = simpleMatch[1]

				// Skip if already parsed
				if (args[argName]) continue

				const argValue = simpleMatch[2].trim()

				// Try to parse as number or boolean
				if (!isNaN(Number(argValue))) {
					args[argName] = Number(argValue)
				} else if (argValue === "true" || argValue === "false") {
					args[argName] = argValue === "true"
				} else {
					args[argName] = argValue
				}
			}
		}

		console.log(
			"[parseFunctionCalls] Parsed args for",
			name,
			":",
			JSON.stringify(args, null, 2)
		)
		calls.push({ name, args })
	}

	console.log("[parseFunctionCalls] Total calls parsed:", calls.length)
	return calls
}
