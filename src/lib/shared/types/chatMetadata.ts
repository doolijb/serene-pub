/**
 * Chat Metadata Types
 *
 * Defines the structure of the metadata field in the chats table.
 * This metadata is stored as JSON and includes draft entities being created/edited.
 */

import type { AssistantCreateCharacter } from "$lib/server/db/zodSchemas"

/**
 * Data editor structure for draft entities
 */
export interface DataEditor {
	/** Entities being created */
	create?: {
		/** Character drafts (index 0 is the active draft) */
		characters?: Partial<AssistantCreateCharacter>[]
		/** Persona drafts */
		personas?: any[]
	}
	/** Entities being edited */
	edit?: {
		characters?: any[]
		personas?: any[]
	}
}

/**
 * Complete chat metadata structure
 */
export interface ChatMetadata {
	/** Draft entities being created/edited in this chat */
	dataEditor?: DataEditor
	/** Other metadata fields can be added here */
	[key: string]: any
}

/**
 * Parse chat metadata from JSON string
 */
export function parseChatMetadata(metadataString: string | null): ChatMetadata {
	if (!metadataString) {
		return {}
	}

	try {
		return JSON.parse(metadataString) as ChatMetadata
	} catch (error) {
		console.error("Failed to parse chat metadata:", error)
		return {}
	}
}

/**
 * Serialize chat metadata to JSON string
 */
export function serializeChatMetadata(metadata: ChatMetadata): string {
	return JSON.stringify(metadata)
}

/**
 * Get the active character draft from chat metadata
 */
export function getActiveCharacterDraft(
	metadata: ChatMetadata
): Partial<AssistantCreateCharacter> | null {
	return metadata.dataEditor?.create?.characters?.[0] ?? null
}

/**
 * Set the active character draft in chat metadata
 */
export function setActiveCharacterDraft(
	metadata: ChatMetadata,
	draft: Partial<AssistantCreateCharacter>
): ChatMetadata {
	return {
		...metadata,
		dataEditor: {
			...metadata.dataEditor,
			create: {
				...metadata.dataEditor?.create,
				characters: [draft]
			}
		}
	}
}

/**
 * Clear the active character draft from chat metadata
 */
export function clearActiveCharacterDraft(
	metadata: ChatMetadata
): ChatMetadata {
	const newMetadata = { ...metadata }
	if (newMetadata.dataEditor?.create?.characters) {
		newMetadata.dataEditor.create.characters = []
	}
	return newMetadata
}
