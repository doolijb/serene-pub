import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq } from "drizzle-orm"
import { runBindingNodeCheck } from "$lib/server/utils/bindingNodeCheck"
import { canViewCharacter, canViewPersona } from "$lib/server/utils/chatAccess"
import { CharacterBook } from "@lenml/char-card-reader"
import { mapLorebookEntryToWorldLoreEntry } from "$lib/server/utils/lorebookImportMapper"
import type { Handler } from "$lib/shared/events"
// SelectTag/SelectLorebookTag/InsertHistoryEntry are declared globally in
// $lib/server/db/types.d.ts (ambient `export global {}` block, same pattern
// as the Sockets namespace) — no import needed/available for them.

// Helper function to process tags for lorebook creation/update
async function processLorebookTags(
	lorebookId: number,
	tagNames: string[],
	userId: number
) {
	if (!tagNames || tagNames.length === 0) return

	// First, remove all existing tags for this lorebook
	await db
		.delete(schema.lorebookTags)
		.where(eq(schema.lorebookTags.lorebookId, lorebookId))

	// Process each tag name
	const tagIds: number[] = []

	for (const tagName of tagNames) {
		if (!tagName.trim()) continue

		// Check if tag exists for this user
		let existingTag = await db.query.tags.findFirst({
			where: (t, { and, eq }) =>
				and(eq(t.name, tagName.trim()), eq(t.userId, userId))
		})

		// Create tag if it doesn't exist
		if (!existingTag) {
			const [newTag] = await db
				.insert(schema.tags)
				.values({
					name: tagName.trim(),
					userId
					// description and colorPreset will use database defaults
				})
				.returning()
			existingTag = newTag
		}

		tagIds.push(existingTag.id)
	}

	// Link all tags to the lorebook
	if (tagIds.length > 0) {
		const lorebookTagsData = tagIds.map((tagId) => ({
			lorebookId,
			tagId
		}))

		await db
			.insert(schema.lorebookTags)
			.values(lorebookTagsData)
			.onConflictDoNothing() // In case of race conditions
	}
}

export const lorebooksListHandler: Handler<
	Sockets.Lorebooks.List.Params,
	Sockets.Lorebooks.List.Response
> = {
	event: "lorebooks:list",
	async handler(socket, params, emitToUser) {
		// Fetch all lorebooks for the user
		const userId = socket.user!.id
		if (!userId) {
			const res = { lorebookList: [] }
			emitToUser("lorebooks:list", res)
			return res
		}
		const books = await db.query.lorebooks.findMany({
			where: (l, { eq }) => eq(l.userId, userId),
			orderBy: (l, { desc }) => desc(l.name),
			with: {
				worldLoreEntries: {
					columns: {
						id: true
					}
				},
				characterLoreEntries: {
					columns: {
						id: true
					}
				},
				historyEntries: {
					columns: {
						id: true
					}
				},
				lorebookBindings: {
					columns: {
						id: true
					}
				},
				lorebookTags: {
					with: {
						tag: true
					}
				}
			}
		})

		// Transform lorebook tags to include tags as string array
		const booksWithTags = books.map((book) => ({
			...book,
			tags:
				book.lorebookTags?.map(
					(lt: SelectLorebookTag & { tag: SelectTag }) => lt.tag.name
				) || []
		}))

		const res = { lorebookList: booksWithTags }
		emitToUser("lorebooks:list", res)
		return res
	}
}

export const lorebooksCreateHandler: Handler<
	Sockets.Lorebooks.Create.Params,
	Sockets.Lorebooks.Create.Response
> = {
	event: "lorebooks:create",
	async handler(socket, params, emitToUser) {
		try {
			const userId = socket.user!.id

			const [newBook] = await db
				.insert(schema.lorebooks)
				.values({
					name: params.name,
					userId
				})
				.returning()

			// Refresh lorebook list
			if (emitToUser) {
				const lorebookListResult = await lorebooksListHandler.handler(
					socket,
					{},
					emitToUser
				)
				emitToUser("lorebooks:list", lorebookListResult)
			}

			return { lorebook: newBook }
		} catch (error) {
			console.error("Error creating lorebook:", error)
			throw error
		}
	}
}

export const lorebooksGetHandler: Handler<
	Sockets.Lorebooks.Get.Params,
	Sockets.Lorebooks.Get.Response
> = {
	event: "lorebooks:get",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			const book = await db.query.lorebooks.findFirst({
				where: (l, { and, eq }) =>
					and(eq(l.id, params.id), eq(l.userId, userId)),
				with: {
					worldLoreEntries: true,
					characterLoreEntries: true,
					historyEntries: true,
					lorebookBindings: true,
					lorebookTags: {
						with: {
							tag: true
						}
					}
				}
			})

			if (!book) {
				const res: Sockets.Lorebooks.Get.Response = {
					lorebook: null,
					worldLoreEntries: [],
					characterLoreEntries: [],
					historyEntries: []
				}
				emitToUser("lorebooks:get", res)
				return res
			}

			// Transform lorebook tags to include tags as string array
			const { lorebookTags, ...bookFields } = book
			const bookWithTags = {
				...bookFields,
				tags: lorebookTags?.map((lt) => lt.tag.name) || []
			}

			const res: Sockets.Lorebooks.Get.Response = {
				lorebook: bookWithTags,
				worldLoreEntries: book.worldLoreEntries,
				characterLoreEntries: book.characterLoreEntries,
				historyEntries: book.historyEntries
			}
			emitToUser("lorebooks:get", res)
			return res
		} catch (error: any) {
			console.error("Error fetching lorebook:", error)
			emitToUser("lorebooks:get:error", {
				error: "Failed to fetch lorebook"
			})
			throw error
		}
	}
}

export const lorebooksUpdateHandler: Handler<
	Sockets.Lorebooks.Update.Params,
	Sockets.Lorebooks.Update.Response
> = {
	event: "lorebooks:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Update the lorebook
			const [updated] = await db
				.update(schema.lorebooks)
				.set(params.lorebook)
				.where(
					and(
						eq(schema.lorebooks.id, params.lorebook.id!),
						eq(schema.lorebooks.userId, userId)
					)
				)
				.returning()

			if (!updated) {
				throw new Error("Lorebook not found or not owned by user")
			}

			const res: Sockets.Lorebooks.Update.Response = {
				lorebook: updated
			}
			emitToUser("lorebooks:update", res)
			await lorebooksListHandler.handler(socket, {}, emitToUser) // Refresh list
			return res
		} catch (error: any) {
			console.error("Error updating lorebook:", error)
			emitToUser("lorebooks:update:error", {
				error: "Failed to update lorebook"
			})
			throw error
		}
	}
}

export const lorebooksDeleteHandler: Handler<
	Sockets.Lorebooks.Delete.Params,
	Sockets.Lorebooks.Delete.Response
> = {
	event: "lorebooks:delete",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Delete the lorebook
			await db
				.delete(schema.lorebooks)
				.where(
					and(
						eq(schema.lorebooks.id, params.id),
						eq(schema.lorebooks.userId, userId)
					)
				)

			const res: Sockets.Lorebooks.Delete.Response = {
				success: "Lorebook deleted successfully"
			}
			emitToUser("lorebooks:delete", res)
			await lorebooksListHandler.handler(socket, {}, emitToUser) // Refresh list
			return res
		} catch (error: any) {
			console.error("Error deleting lorebook:", error)
			const res: Sockets.Lorebooks.Delete.Response = {
				error: "Failed to delete lorebook"
			}
			emitToUser("lorebooks:delete:error", res)
			throw error
		}
	}
}

export async function syncLorebookBindings({
	lorebookId
}: {
	lorebookId: number
}) {
	const queries: (() => Promise<any>)[] = []
	// Query all lorebook bindings for the given lorebook
	const existingBindings = await db.query.lorebookBindings.findMany({
		where: (b, { eq }) => eq(b.lorebookId, lorebookId),
		with: {
			characterLoreEntries: true
		}
	})
	// Query all world, character and history entries for the given lorebook
	const worldEntries = await db.query.worldLoreEntries.findMany({
		where: (e, { eq }) => eq(e.lorebookId, lorebookId)
	})
	const characterEntries = await db.query.characterLoreEntries.findMany({
		where: (e, { eq }) => eq(e.lorebookId, lorebookId)
	})
	const historyEntries = await db.query.historyEntries.findMany({
		where: (e, { eq }) => eq(e.lorebookId, lorebookId)
	})
	// Create a list of all unique lorebook bindings from the entries
	const foundBindings: string[] = []
	for (const entry of [
		...worldEntries,
		...characterEntries,
		...historyEntries
	]) {
		// use regex to find all {{char:1}}, {{char:2}}, {char:1}, {char:2}, etc. bindings in the entry content
		const rgx: RegExp = /\{\{?(\w+):(\d+)\}?\}/g // Matches both {{char:1}} and {char:1} (deprecated)
		let match: RegExpExecArray | null
		while ((match = rgx.exec(entry.content)) !== null) {
			const binding = `{{${match[1]}:${match[2]}}}` // Store as preferred syntax
			if (!foundBindings.includes(binding)) {
				foundBindings.push(binding)
			}
		}
	}
	// If a binding does not exist in the lorebook bindings, create it without a character or persona
	foundBindings.forEach((fb) => {
		// Check for both {{char:#}} and {char:#} syntax when looking for existing bindings
		const legacyBinding = fb.replace(/\{\{(\w+):(\d+)\}\}/, "{$1:$2}") // Convert {{char:1}} to {char:1}
		const existingBinding = existingBindings.find(
			(eb) => eb.binding === fb || eb.binding === legacyBinding
		)
		if (!existingBinding) {
			queries.push(
				db.insert(schema.lorebookBindings).values({
					lorebookId,
					binding: fb, // Use preferred {{char:#}} syntax
					characterId: null,
					personaId: null
				}) as any as () => Promise<any>
			)
		}
	})
	// If a binding exists in the lorebook bindings without a bound character or persona, consider it orphaned and delete it
	existingBindings.forEach((eb) => {
		if (
			!!eb.characterId ||
			!!eb.personaId ||
			!!eb.characterLoreEntries.length
		) {
			return
		} // Skip bindings that are still in use
		const isBindingUsed = foundBindings.some((fb) => fb === eb.binding)
		if (!isBindingUsed) {
			queries.push(
				db
					.delete(schema.lorebookBindings)
					.where(
						eq(schema.lorebookBindings.id, eb.id)
					) as any as () => Promise<any>
			)
		}
	})
	// Execute all queries in parallel
	if (queries.length > 0) {
		await Promise.all(queries)
	}
}

// =============================================
// TYPE-SAFE LOREBOOK HANDLERS
// =============================================

/**
 * Type-safe handler for listing lorebook bindings
 */
export const lorebookBindingListHandler: Handler<
	Sockets.Lorebooks.BindingList.Params,
	Sockets.Lorebooks.BindingList.Response
> = {
	event: "lorebooks:bindingList",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const book = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, params.lorebookId), eq(l.userId, userId)),
			columns: {
				id: true
			},
			with: {
				lorebookBindings: {
					with: {
						character: true,
						persona: true
					}
				}
			}
		})

		if (!book) throw new Error("Lorebook not found.")

		const res: Sockets.Lorebooks.BindingList.Response = {
			lorebookId: book.id,
			lorebookBindingList: book.lorebookBindings
		}

		if (emitToUser) {
			emitToUser("lorebooks:bindingList", res)
		}

		return res
	}
}

/**
 * Type-safe handler for creating lorebook binding
 */
// A lorebook binding resolves a placeholder like {{char:1}} to a real
// character/persona's name/data — without this check, any characterId or
// personaId could be supplied regardless of who it belongs to, and the
// bound entity's name/aliases/summary would later be disclosed through the
// binding (and copied into narrative-graph nodes derived from it).
async function verifyBindingTargetAccess(
	binding: { characterId?: number | null; personaId?: number | null },
	userId: number
): Promise<boolean> {
	if (binding.characterId) {
		const character = await db.query.characters.findFirst({
			where: eq(schema.characters.id, binding.characterId),
			columns: { userId: true }
		})
		if (!character) return false
		if (character.userId === userId) return true
		return await canViewCharacter(binding.characterId, userId)
	}
	if (binding.personaId) {
		const persona = await db.query.personas.findFirst({
			where: eq(schema.personas.id, binding.personaId),
			columns: { userId: true }
		})
		if (!persona) return false
		if (persona.userId === userId) return true
		return await canViewPersona(binding.personaId, userId)
	}
	return true
}

export const createLorebookBindingHandler: Handler<
	Sockets.Lorebooks.CreateBinding.Params,
	Sockets.Lorebooks.CreateBinding.Response
> = {
	event: "lorebooks:createBinding",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const book = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(
					eq(l.id, params.lorebookBinding.lorebookId),
					eq(l.userId, userId)
				)
		})

		if (!book) throw new Error("Lorebook not found.")

		if (!(await verifyBindingTargetAccess(params.lorebookBinding, userId))) {
			throw new Error(
				"Access denied. You don't have permission to bind that character or persona."
			)
		}

		const [binding] = await db
			.insert(schema.lorebookBindings)
			.values(params.lorebookBinding)
			.returning()

		// Refresh binding list
		if (emitToUser) {
			const listResult = await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: book.id },
				emitToUser
			)
			emitToUser("lorebooks:bindingList", listResult)
		}

		// Flow 2: node-link check for the new binding
		if (emitToUser) {
			const allBindings = await db.query.lorebookBindings.findMany({
				where: eq(schema.lorebookBindings.lorebookId, book.id)
			})
			runBindingNodeCheck(book.id, allBindings, emitToUser).catch(console.error)
		}

		const res: Sockets.Lorebooks.CreateBinding.Response = {
			lorebookBinding: binding
		}

		if (emitToUser) {
			emitToUser("lorebooks:createBinding", res)
		}

		return res
	}
}

/**
 * Type-safe handler for updating lorebook binding
 */
export const updateLorebookBindingHandler: Handler<
	Sockets.Lorebooks.UpdateBinding.Params,
	Sockets.Lorebooks.UpdateBinding.Response
> = {
	event: "lorebooks:updateBinding",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Check if binding exists and user owns the lorebook
		const existingBinding = await db.query.lorebookBindings.findFirst({
			where: (lb, { eq }) => eq(lb.id, params.lorebookBinding.id!)
		})

		if (!existingBinding) {
			throw new Error("Lorebook binding not found.")
		}

		const lorebookOwner = await db.query.lorebooks.findFirst({
			where: and(
				eq(schema.lorebooks.id, existingBinding.lorebookId),
				eq(schema.lorebooks.userId, userId)
			),
			columns: { id: true }
		})

		if (!lorebookOwner) {
			throw new Error("Access denied.")
		}

		if (!(await verifyBindingTargetAccess(params.lorebookBinding, userId))) {
			throw new Error(
				"Access denied. You don't have permission to bind that character or persona."
			)
		}

		const [updatedBinding] = await db
			.update(schema.lorebookBindings)
			.set(params.lorebookBinding)
			.where(eq(schema.lorebookBindings.id, params.lorebookBinding.id!))
			.returning()

		// Refresh binding list
		if (emitToUser) {
			const listResult = await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: existingBinding.lorebookId },
				emitToUser
			)
			emitToUser("lorebooks:bindingList", listResult)
		}

		// Flow 2: node-link check (skip if unlinking a character/persona)
		const isUnlinking =
			("characterId" in params.lorebookBinding && params.lorebookBinding.characterId === null) ||
			("personaId" in params.lorebookBinding && params.lorebookBinding.personaId === null)
		if (!isUnlinking && emitToUser) {
			const allBindings = await db.query.lorebookBindings.findMany({
				where: eq(schema.lorebookBindings.lorebookId, existingBinding.lorebookId)
			})
			runBindingNodeCheck(existingBinding.lorebookId, allBindings, emitToUser).catch(console.error)
		}

		const res: Sockets.Lorebooks.UpdateBinding.Response = {
			lorebookBinding: updatedBinding
		}

		if (emitToUser) {
			emitToUser("lorebooks:updateBinding", res)
		}

		return res
	}
}

/**
 * ====================================================================
 * LOREBOOK IMPORT TYPE-SAFE HANDLER
 * ====================================================================
 */

/**
 * Import Lorebook handler
 */
export const lorebookImportHandler: Handler<
	Sockets.Lorebooks.Import.Params,
	Sockets.Lorebooks.Import.Response
> = {
	event: "lorebooks:import",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		console.log("Importing lorebook data:", params.lorebookData)
		let card = CharacterBook.from_json(params.lorebookData)

		console.log("Importing lorebook data:", card)

		if (!card) {
			throw new Error("No lorebook data provided.")
		}

		// Create the new lorebook
		const [book] = await db
			.insert(schema.lorebooks)
			.values({
				name: card.name || "Imported Lorebook",
				description: card.description,
				userId,
				extraJson: {}
			})
			.returning()

		let position = 0
		const queries: Promise<any>[] = []
		card.entries.forEach((entry) => {
			// World entries are the most agnostic, so we will import all entries as world lore entries
			queries.push(
				db.insert(schema.worldLoreEntries).values({
					...mapLorebookEntryToWorldLoreEntry(entry, position),
					lorebookId: book.id
				})
			)
			position++
		})

		await Promise.all(queries)

		// Get the completed book with all relations
		const completedBook = await db.query.lorebooks.findFirst({
			where: (l, { eq }) => eq(l.id, book.id),
			with: {
				lorebookBindings: true,
				worldLoreEntries: true,
				characterLoreEntries: true,
				historyEntries: true
			}
		})

		if (!completedBook) {
			throw new Error("Failed to retrieve imported lorebook.")
		}

		// Refresh lorebook list
		if (emitToUser) {
			const lorebookListResult = await lorebooksListHandler.handler(
				socket,
				{ userId },
				emitToUser
			)
			emitToUser("lorebooks:list", lorebookListResult)
		}

		return {
			lorebook: completedBook
		}
	}
}

// Registration function for all lorebook handlers
export function registerLorebookHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	// Core lorebook handlers
	register(socket, lorebooksListHandler, emitToUser)
	register(socket, lorebooksCreateHandler, emitToUser)
	register(socket, lorebooksGetHandler, emitToUser)
	register(socket, lorebooksUpdateHandler, emitToUser)
	register(socket, lorebooksDeleteHandler, emitToUser)

	// Lorebook binding handlers
	register(socket, lorebookBindingListHandler, emitToUser)
	register(socket, createLorebookBindingHandler, emitToUser)
	register(socket, updateLorebookBindingHandler, emitToUser)

	// Lorebook import handler
	register(socket, lorebookImportHandler, emitToUser)
}
