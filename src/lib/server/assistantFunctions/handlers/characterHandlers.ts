/**
 * Character function handlers
 */

import { db } from "$lib/server/db"
import { like, or, eq, and } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { AssistantFunctionHandler } from "$lib/shared/assistantFunctions/types"
import {
	parseChatMetadata,
	getActiveCharacterDraft,
	setActiveCharacterDraft
} from "$lib/shared/types/chatMetadata"
import { generateCharacterDraft } from "../utils/draftOrchestrator"
import { broadcastToChatUsers } from "$lib/server/sockets/utils/broadcastHelpers"

export const listCharactersHandler: AssistantFunctionHandler = async ({
	userId,
	args
}) => {
	try {
		const { name, nickname, search } = args

		// Build where conditions
		const conditions = []

		if (name) {
			conditions.push(like(schema.characters.name, `%${name}%`))
		}

		if (nickname) {
			conditions.push(like(schema.characters.nickname, `%${nickname}%`))
		}

		if (search) {
			conditions.push(
				or(
					like(schema.characters.name, `%${search}%`),
					like(schema.characters.nickname, `%${search}%`),
					like(schema.characters.description, `%${search}%`)
				)
			)
		}

		// Query characters
		const whereClause =
			conditions.length > 0
				? and(eq(schema.characters.userId, userId), or(...conditions))
				: eq(schema.characters.userId, userId)

		const characters = await db.query.characters.findMany({
			where: whereClause,
			columns: {
				id: true,
				name: true,
				nickname: true,
				description: true,
				avatar: true
			},
			limit: 50
		})

		console.log(
			`listCharactersHandler: Found ${characters.length} characters for userId ${userId}`
		)

		return {
			success: true,
			data: { characters }
		}
	} catch (error) {
		console.error("listCharactersHandler error:", error)
		return {
			success: false,
			error: "Failed to search for characters"
		}
	}
}

/**
 * Draft Character Handler
 *
 * Creates or updates a character draft in chat metadata using AI-assisted field generation.
 *
 * **Flow:**
 * 1. Load existing draft from chat metadata (if any)
 * 2. Generate missing fields using LLM (field-by-field with specific prompts)
 * 3. Validate the draft with Zod schema
 * 4. Auto-correct validation errors (up to 3 attempts)
 * 5. Save draft back to chat metadata
 * 6. Emit progress updates via socket
 *
 * **Result:**
 * - Draft stored in `chat.metadata.dataEditor.create.characters[0]`
 * - User can review, edit, and save the draft via UI
 * - Validation errors (if any) are returned for user correction
 */
export const draftCharacterHandler: AssistantFunctionHandler = async ({
	userId,
	chatId,
	args,
	socket
}) => {
	try {
		const { userRequest, additionalFields = [] } = args

		console.log(
			`[draftCharacterHandler] Starting for chat ${chatId}, user ${userId}`
		)
		console.log(`[draftCharacterHandler] User request: ${userRequest}`)
		console.log(
			`[draftCharacterHandler] Additional fields: ${JSON.stringify(additionalFields)}`
		)

		// 1. Get current chat and metadata
		const chat = await db.query.chats.findFirst({
			where: eq(schema.chats.id, chatId)
		})

		if (!chat) {
			return {
				success: false,
				error: "Chat not found"
			}
		}

		const metadata = parseChatMetadata(chat.metadata)
		const existingDraft = getActiveCharacterDraft(metadata)

		console.log(`[draftCharacterHandler] Existing draft:`, existingDraft)

		// 2. Generate the draft using the orchestrator
		const result = await generateCharacterDraft({
			userId,
			chatId,
			userRequest,
			additionalFields,
			existingDraft: existingDraft || undefined,
			socket
		})

		console.log(`[draftCharacterHandler] Generation result:`, {
			success: result.success,
			isValid: result.isValid,
			generatedFields: result.generatedFields,
			validationAttempts: result.validationAttempts
		})

		// 3. Save draft to chat metadata
		const updatedMetadata = setActiveCharacterDraft(metadata, result.draft)

		await db
			.update(schema.chats)
			.set({ metadata: updatedMetadata })
			.where(eq(schema.chats.id, chatId))

		console.log(`[draftCharacterHandler] Draft saved to chat metadata`)

		// 4. Broadcast updated chat to client so draft appears immediately
		const updatedChat = await db.query.chats.findFirst({
			where: eq(schema.chats.id, chatId)
		})

		if (updatedChat && socket?.io) {
			console.log(
				`[draftCharacterHandler] Broadcasting updated chat to client`
			)
			await broadcastToChatUsers(socket.io, chatId, "chats:get", {
				chat: updatedChat
			})
		}

		// 5. Return result - DON'T return draft data as it's already in metadata
		// Returning data here would make it appear as a "selectable result"
		// which causes the CharacterSelector to auto-select and add null to taggedEntities
		return {
			success: true,
			message: result.isValid
				? `Character draft created successfully! Generated ${result.generatedFields.length} field(s). Review and save when ready.`
				: `Character draft created with ${result.validationErrors?.length || 0} validation error(s). Please review and fix: ${result.errorMessage}`
		}
	} catch (error) {
		console.error("[draftCharacterHandler] Error:", error)
		return {
			success: false,
			error:
				error instanceof Error
					? error.message
					: "Failed to create character draft"
		}
	}
}
