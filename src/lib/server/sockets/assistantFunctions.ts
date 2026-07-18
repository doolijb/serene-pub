/**
 * Assistant Functions Socket Handler
 *
 * Handles execution of assistant function calls and user selections
 */

import type { Socket, Server } from "socket.io"
import { getFunction } from "$lib/server/assistantFunctions/serverRegistry"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"

export function handleAssistantFunctions(
	io: Server,
	socket: Socket,
	userId: number
) {
	/**
	 * Execute function calls from reasoning format
	 */
	socket.on(
		"assistant:executeFunctions",
		async (data: {
			chatId: number
			functionCalls: Array<{ name: string; args: Record<string, any> }>
		}) => {
			try {
				const { chatId, functionCalls } = data

				// Execute all function calls
				const results = await Promise.all(
					functionCalls.map(async (call) => {
						const fn = getFunction(call.name)
						if (!fn || !fn.handler) {
							return {
								success: false,
								error: `Function '${call.name}' not found`
							}
						}

						// Execute the function handler
						const result = await fn.handler({
							userId,
							chatId,
							args: call.args,
							socket
						})

						return result
					})
				)

				// Combine all results and remove duplicates (by id)
				const allData: any[] = []
				const seenIds = new Set<string>()

				for (const result of results) {
					if (result.success && result.data) {
						// Handle different data structures
						// If data.characters exists (from listCharacters), use that
						const items = result.data.characters || result.data

						// Ensure items is an array
						const itemsArray = Array.isArray(items)
							? items
							: [items]

						for (const item of itemsArray) {
							const itemId = String(item.id)
							if (!seenIds.has(itemId)) {
								seenIds.add(itemId)
								allData.push(item)
							}
						}
					}
				}

				console.log("[AssistantFunctions] Function results:", {
					totalResults: results.length,
					allDataCount: allData.length,
					allData: allData,
					rawResults: results
				})

				// Emit combined results to client (for UI updates)
				socket.emit("assistant:functionResults", {
					chatId,
					results: allData
				})

				// Auto-complete and regenerate for functions that don't return selectable data
				// (e.g., draft functions that modify metadata but don't return entities to select)
				if (allData.length === 0) {
					console.log(
						"[AssistantFunctions] No selectable results, auto-completing and triggering conversational response"
					)

					// Get the chat to find the last assistant message
					const chat = await db.query.chats.findFirst({
						where: eq(schema.chats.id, chatId),
						with: {
							chatMessages: {
								orderBy: (chatMessages, { asc }) => [
									asc(chatMessages.createdAt)
								]
							}
						}
					})

					if (!chat) {
						console.error(
							"[AssistantFunctions] Chat not found for auto-complete"
						)
						return
					}

					if (chat.userId !== userId) {
						console.error(
							"[AssistantFunctions] Chat not owned by requesting user, refusing auto-complete"
						)
						return
					}

					// Find the last assistant message (the one that called the functions)
					const lastAssistantMessage = chat.chatMessages
						.filter((m: any) => m.role === "assistant")
						.pop()

					if (!lastAssistantMessage) {
						console.error(
							"[AssistantFunctions] No assistant message found to regenerate"
						)
						return
					}

					console.log(
						"[AssistantFunctions] Found assistant message to regenerate:",
						lastAssistantMessage.id
					)

					// Clear waitingForFunctionSelection but preserve reasoning
					const currentMetadata =
						(lastAssistantMessage.metadata as any) || {}
					const cleanedMetadata = {
						...currentMetadata,
						waitingForFunctionSelection: undefined
						// Keep reasoning - it will trigger conversational mode
					}

					// Update message: clear content, set generating, clean metadata
					await db
						.update(schema.chatMessages)
						.set({
							content: "",
							isGenerating: true,
							metadata: cleanedMetadata
						})
						.where(
							eq(schema.chatMessages.id, lastAssistantMessage.id)
						)

					console.log(
						"[AssistantFunctions] Triggering regeneration for conversational response"
					)

					// Import and call the chat handler to trigger generation
					const { chatMessagesRegenerateHandler } = await import(
						"./chats"
					)
					await chatMessagesRegenerateHandler.handler(
						socket,
						{ id: lastAssistantMessage.id },
						(event: string, data: any) => socket.emit(event, data)
					)
				}
			} catch (error) {
				console.error("Error executing assistant functions:", error)
				socket.emit("assistant:functionError", {
					error: "Failed to execute functions"
				})
			}
		}
	)

	/**
	 * Handle user selection of function results
	 */
	socket.on(
		"assistant:selectFunctionResults",
		async (data: {
			chatId: number
			selectedIds: number[]
			type: string
		}) => {
			try {
				const { chatId, selectedIds, type } = data

				console.log("=".repeat(80))
				console.log("[selectFunctionResults] Received selection:", {
					chatId,
					selectedIds,
					type
				})

				// Get current chat metadata
				const chat = await db.query.chats.findFirst({
					where: eq(schema.chats.id, chatId)
				})

				if (!chat) {
					socket.emit("assistant:selectionError", {
						error: "Chat not found"
					})
					return
				}

				if (chat.userId !== userId) {
					socket.emit("assistant:selectionError", {
						error: "Unauthorized"
					})
					return
				}

				console.log(
					"[selectFunctionResults] Chat metadata exists:",
					!!chat.metadata
				)

				// Get chat metadata (now a JSON column)
				const metadata = chat.metadata || {}

				console.log(
					"[selectFunctionResults] Parsed metadata keys:",
					Object.keys(metadata)
				)

				const taggedEntities = metadata.taggedEntities || {}
				console.log(
					"[selectFunctionResults] Existing taggedEntities:",
					taggedEntities
				)

				// Add/update tagged entities for this type
				if (!taggedEntities[type]) {
					taggedEntities[type] = []
				}

				// Add selected IDs (avoid duplicates)
				for (const id of selectedIds) {
					if (!taggedEntities[type].includes(id)) {
						taggedEntities[type].push(id)
					}
				}

				console.log(
					"[selectFunctionResults] Updated taggedEntities:",
					taggedEntities
				)

				// Save updated metadata (metadata is now a JSON column)
				await db
					.update(schema.chats)
					.set({
						metadata: { ...metadata, taggedEntities }
					})
					.where(eq(schema.chats.id, chatId))

				console.log(
					"[selectFunctionResults] Emitting selectionComplete with:",
					{ chatId, taggedEntities }
				)
				console.log("=".repeat(80))

				// Emit success and continue generation
				socket.emit("assistant:selectionComplete", {
					chatId,
					taggedEntities
				})
			} catch (error) {
				console.error("Error saving function result selection:", error)
				socket.emit("assistant:selectionError", {
					error: "Failed to save selection"
				})
			}
		}
	)

	/**
	 * Handle unlinking entities from chat
	 */
	socket.on(
		"assistant:unlinkEntity",
		async (data: { chatId: number; entityId: number; type: string }) => {
			try {
				const { chatId, entityId, type } = data

				// Get current chat metadata
				const chat = await db.query.chats.findFirst({
					where: eq(schema.chats.id, chatId)
				})

				if (!chat) {
					socket.emit("assistant:unlinkError", {
						error: "Chat not found"
					})
					return
				}

				if (chat.userId !== userId) {
					socket.emit("assistant:unlinkError", {
						error: "Unauthorized"
					})
					return
				}

				// Update chat metadata by removing the entity
				const metadata = (chat.metadata as any) || {}
				const taggedEntities = metadata.taggedEntities || {}

				if (taggedEntities[type]) {
					taggedEntities[type] = taggedEntities[type].filter(
						(id: number) => id !== entityId
					)

					// Remove the type key if array is empty
					if (taggedEntities[type].length === 0) {
						delete taggedEntities[type]
					}
				}

				// Save updated metadata (metadata is now a JSON column)
				await db
					.update(schema.chats)
					.set({
						metadata: { ...metadata, taggedEntities }
					})
					.where(eq(schema.chats.id, chatId))

				// Emit success
				socket.emit("assistant:unlinkSuccess", {
					chatId,
					entityId,
					type,
					taggedEntities
				})
			} catch (error) {
				console.error("Error unlinking entity:", error)
				socket.emit("assistant:unlinkError", {
					error: "Failed to unlink entity"
				})
			}
		}
	)

	/**
	 * Handle manual editing of draft fields
	 */
	socket.on(
		"assistant:editDraft",
		async (data: {
			chatId: number
			operation: "create" | "edit" // Whether creating new or editing existing
			entityType: "characters" | "personas" // Type of entity
			entityIndex: number // Index in the array
			field: string // Field name to update
			value: any // New value
		}) => {
			try {
				const {
					chatId,
					operation,
					entityType,
					entityIndex,
					field,
					value
				} = data

				console.log("=".repeat(80))
				console.log("[editDraft] Received edit request:", {
					chatId,
					operation,
					entityType,
					entityIndex,
					field,
					valuePreview:
						typeof value === "string"
							? value.substring(0, 50)
							: value
				})

				// Get current chat
				const chat = await db.query.chats.findFirst({
					where: eq(schema.chats.id, chatId)
				})

				if (!chat) {
					socket.emit("assistant:editDraftError", {
						error: "Chat not found"
					})
					return
				}

				// Verify user owns this chat
				if (chat.userId !== userId) {
					socket.emit("assistant:editDraftError", {
						error: "Unauthorized"
					})
					return
				}

				// Get metadata (now a JSON column)
				const metadata = chat.metadata || {}

				// Navigate to the draft location
				const drafts = metadata.dataEditor?.[operation]?.[entityType]

				if (
					!drafts ||
					!Array.isArray(drafts) ||
					entityIndex >= drafts.length
				) {
					socket.emit("assistant:editDraftError", {
						error: `Draft not found at dataEditor.${operation}.${entityType}[${entityIndex}]`
					})
					return
				}

				const draft = drafts[entityIndex]

				// Validate the field based on entity type
				let validationError: string | null = null

				if (entityType === "characters") {
					const { assistantCreateCharacterSchema } = await import(
						"$lib/server/db/zodSchemas"
					)

					// Validate just the specific field
					try {
						const fieldSchema = (
							assistantCreateCharacterSchema.shape as any
						)[field]

						if (!fieldSchema) {
							validationError = `Field '${field}' is not a valid character field`
						} else {
							// Validate the field value
							fieldSchema.parse(value)
						}
					} catch (error: any) {
						// Extract validation error message
						if (error.errors && error.errors.length > 0) {
							validationError = error.errors[0].message
						} else {
							validationError =
								error.message || "Validation failed"
						}
					}
				} else if (entityType === "personas") {
					const { assistantCreatePersonaSchema } = await import(
						"$lib/server/db/zodSchemas"
					)

					// Similar validation for personas
					try {
						const fieldSchema = (
							assistantCreatePersonaSchema.shape as any
						)[field]

						if (!fieldSchema) {
							validationError = `Field '${field}' is not a valid persona field`
						} else {
							fieldSchema.parse(value)
						}
					} catch (error: any) {
						if (error.errors && error.errors.length > 0) {
							validationError = error.errors[0].message
						} else {
							validationError =
								error.message || "Validation failed"
						}
					}
				}

				// If validation failed, emit error
				if (validationError) {
					console.log(
						"[editDraft] Validation failed:",
						validationError
					)
					socket.emit("assistant:editDraftError", {
						error: validationError,
						field,
						value
					})
					return
				}

				// Update the draft field
				draft[field] = value

				console.log("[editDraft] Updated draft field:", field)

				// Save updated metadata (metadata is now a JSON column)
				await db
					.update(schema.chats)
					.set({
						metadata
					})
					.where(eq(schema.chats.id, chatId))

				console.log("[editDraft] Successfully saved to database")

				// Fetch the updated chat to emit
				const updatedChat = await db.query.chats.findFirst({
					where: eq(schema.chats.id, chatId)
				})

				console.log("[editDraft] Emitting updated chat")
				console.log("=".repeat(80))

				// Emit success with updated draft and full chat
				socket.emit("assistant:editDraftSuccess", {
					chatId,
					operation,
					entityType,
					entityIndex,
					field,
					value,
					draft,
					chat: updatedChat
				})
			} catch (error) {
				console.error("Error editing draft:", error)
				socket.emit("assistant:editDraftError", {
					error: "Failed to edit draft"
				})
			}
		}
	)
}
