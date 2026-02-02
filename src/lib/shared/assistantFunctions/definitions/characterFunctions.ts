/**
 * Character-related assistant functions
 */

import type { AssistantFunction } from "../types"

export const characterFunctions: Record<string, AssistantFunction> = {
	listCharacters: {
		name: "listCharacters",
		description:
			"Find and retrieve character information. Use this for ANY character-related query including: finding characters, getting character details, summarizing characters, describing characters, or answering questions about characters. Returns full character data including name, description, personality, and all other details.",
		requiresConfirmation: false,
		requiresAdmin: false,
		parameters: {
			type: "object",
			properties: {
				name: {
					type: "string",
					description: "Search by exact or partial character name"
				},
				nickname: {
					type: "string",
					description: "Search by character nickname"
				},
				search: {
					type: "string",
					description:
						"General search term - searches across name, nickname, and description. Use this when you have a character name."
				}
			},
			required: []
		}
	},
	draftCharacter: {
		name: "draftCharacter",
		description: `Create or update a character draft based on user requirements. The draft is saved to the chat and shown to the user for review before being saved to the database. 

**When to use**: 
- User asks to create/draft a character
- User asks to modify an existing draft (e.g., "reroll personality", "change the description", "add more details")

**How to call**:
{reasoning: "User wants to create/modify [type of character]", functions: [draftCharacter(userRequest:"[exact user request here]", additionalFields:["personality","scenario"])]}

**Examples - Creating new drafts**:
- User: "Create a cowboy character" → {reasoning: "Creating cowboy character", functions: [draftCharacter(userRequest:"Create a cowboy character", additionalFields:["personality","scenario"])]}
- User: "Make a detective named Sarah who is cynical" → {reasoning: "Creating detective character", functions: [draftCharacter(userRequest:"Make a detective named Sarah who is cynical", additionalFields:["personality","scenario"])]}

**Examples - Modifying existing drafts**:
- User: "Reroll his personality" → {reasoning: "User wants to regenerate personality field", functions: [draftCharacter(userRequest:"Reroll his personality", additionalFields:["personality"])]}
- User: "Change the description" → {reasoning: "User wants to regenerate description", functions: [draftCharacter(userRequest:"Change the description", additionalFields:[])]}
- User: "Make him more cynical" → {reasoning: "User wants to modify personality", functions: [draftCharacter(userRequest:"Make him more cynical", additionalFields:["personality"])]}

**CRITICAL**: 
- ALWAYS use the CURRENT user message as userRequest, not previous messages
- NEVER create character details yourself
- NEVER output JSON schemas or API endpoints
- Only call this function with the exact format shown above`,
		requiresConfirmation: false,
		requiresAdmin: false,
		parameters: {
			type: "object",
			properties: {
				userRequest: {
					type: "string",
					description:
						"The EXACT user request describing what character they want. Copy it word-for-word from the user message."
				},
				additionalFields: {
					type: "array",
					items: {
						type: "string",
						enum: [
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
						]
					},
					description:
						'Optional fields to populate in addition to required fields (name, description). Default: ["personality","scenario"]'
				}
			},
			required: ["userRequest"]
		}
	}
}
