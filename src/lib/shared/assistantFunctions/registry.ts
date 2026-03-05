/**
 * Assistant Function Registry
 *
 * Central registry of all available functions for the assistant.
 */

import { characterFunctions } from "./definitions/characterFunctions"
import type { AssistantFunction } from "./types"

export const assistantFunctionRegistry: Record<string, AssistantFunction> = {
	...characterFunctions
}

export function getFunction(name: string): AssistantFunction | undefined {
	return assistantFunctionRegistry[name]
}

export function getFunctionList(): AssistantFunction[] {
	return Object.values(assistantFunctionRegistry)
}

/**
 * Generates function definitions formatted for the LLM's system prompt
 */
export function getFunctionDefinitionsForPrompt(): string {
	console.log(
		"[Registry] ========== getFunctionDefinitionsForPrompt START =========="
	)
	console.log("[Registry] About to call getFunctionList()")

	const functions = getFunctionList()

	console.log("[Registry] getFunctionList() returned")
	console.log(
		"[Registry] getFunctionDefinitionsForPrompt called, functions count:",
		functions.length
	)
	console.log(
		"[Registry] Function names:",
		functions.map((f) => f.name)
	)
	console.log(
		"[Registry] assistantFunctionRegistry keys:",
		Object.keys(assistantFunctionRegistry)
	)

	const functionNames = functions.map((f) => f.name).join(", ")
	const functionList = functions.map((f) => `✅ ${f.name}`).join("\n")

	const result = `# Available Functions

**YOU HAVE ${functions.length === 1 ? "EXACTLY ONE FUNCTION" : `${functions.length} FUNCTIONS AVAILABLE`}: ${functionNames}**

**CRITICAL:** Only use the functions listed below. Do NOT invent or guess function names.

## ⚠️ AVAILABLE FUNCTIONS ⚠️

${functionList}

## ⚠️ DO NOT INVENT FUNCTION NAMES ⚠️

❌ summarizeCharacter - DOES NOT EXIST
❌ getCharacter - DOES NOT EXIST  
❌ getCharacterDetails - DOES NOT EXIST
❌ searchLibrary - DOES NOT EXIST
❌ createCharacter - DOES NOT EXIST (use draftCharacter instead)

## Required Format

{reasoning: "brief explanation", functions?: [functionName(param:"value")]}

## Examples

**User:** "Summarize character Hina"
**You:** {reasoning: "User wants summary of Hina", functions?: [listCharacters(search:"Hina")]}

**User:** "Create a character named Alex who is a detective"
**You:** {reasoning: "User wants to create a new character", functions?: [draftCharacter(userRequest:"Create a character named Alex who is a detective", additionalFields:["personality","scenario"])]}

**User:** "Find Maria"
**You:** {reasoning: "Looking up Maria", functions?: [listCharacters(search:"Maria")]}

---

${functions
	.map(
		(f) => `
## ${f.name}
${f.description}

**Parameters:**
${Object.entries(f.parameters.properties)
	.map(([key, prop]) => {
		const required = f.parameters.required?.includes(key)
			? " (REQUIRED)"
			: " (optional)"
		const enumInfo = prop.enum ? ` [${prop.enum.join(", ")}]` : ""
		const itemsInfo = prop.items?.enum
			? ` [items: ${prop.items.enum.join(", ")}]`
			: ""
		return `- ${key} (${prop.type})${required}: ${prop.description}${enumInfo}${itemsInfo}`
	})
	.join("\n")}

**When to use:** ${f.description}
**No confirmation needed** - Execute immediately when user requests this action.
`
	)
	.join("\n---\n")}

---

## Important Rules

1. **Format is everything**: Use ONLY {reasoning: "...", functions?: [...]} - nothing before or after
2. **STOP IMMEDIATELY**: After outputting the function call, output NOTHING else. Don't add explanations, summaries, or follow-up text.
3. **No confirmations**: Don't ask permission, execute immediately  
4. **Multiple calls OK**: {reasoning: "...", functions?: [fn1(...), fn2(...)]}
5. **Wait for results**: The functions will execute and return results. You will see those results in the next message.
6. **Then respond**: ONLY after receiving function results should you compose a natural response to the user.

## CRITICAL: Function Call Pattern

**WRONG** ❌:
{reasoning: "Creating character", functions?: [draftCharacter(...)]}
Based on your request, here's a draft for your samurai character...

**CORRECT** ✅:
{reasoning: "Creating character", functions?: [draftCharacter(...)]}

(STOP HERE - wait for function to execute and return results)
`

	console.log(
		"[Registry] Returning function definitions, length:",
		result.length
	)
	console.log(
		"[Registry] ========== getFunctionDefinitionsForPrompt END =========="
	)
	return result
}
