import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, inArray } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import type {
	InsertCharacterLoreEntry,
	SelectCharacterLoreEntry
} from "$lib/server/db/types"
import { lorebookBindingListHandler } from "./lorebooks"
import { syncLorebookBindings } from "./lorebooks"
import { autoEnqueueLorebook } from "$lib/server/embedding/vectorizationQueue"

export const characterLoreEntryListHandler: Handler<
	Sockets.CharacterLoreEntries.List.Params,
	Sockets.CharacterLoreEntries.List.Response
> = {
	event: "characterLoreEntries:list",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const book = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, params.lorebookId), eq(l.userId, userId)),
			columns: {
				id: true,
				userId: true
			},
			with: {
				characterLoreEntries: true
			}
		})

		if (!book) throw new Error("Lorebook not found.")

		const res = {
			lorebookId: params.lorebookId,
			characterLoreEntryList: book.characterLoreEntries
		}
		emitToUser("characterLoreEntries:list", res)
		return res
	}
}

export const createCharacterLoreEntryHandler: Handler<
	Sockets.CharacterLoreEntries.Create.Params,
	Sockets.CharacterLoreEntries.Create.Response
> = {
	event: "characterLoreEntries:create",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const data: InsertCharacterLoreEntry = { ...params.characterLoreEntry }
		data.name = data.name.trim()
		data.content = data.content?.trim() || ""

		// Get next available position for the lore entry
		const existingBook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, data.lorebookId), eq(l.userId, userId)),
			columns: {
				id: true,
				name: true,
				userId: true
			},
			with: {
				characterLoreEntries: {
					columns: {
						id: true,
						position: true
					},
					orderBy: (e, { asc }) => asc(e.position)
				}
			}
		})

		if (!existingBook) {
			throw new Error(
				"Lorebook not found or you do not have permission to create an entry."
			)
		}

		const existingEntries = existingBook.characterLoreEntries

		let nextPosition = 1
		if (existingEntries.length > 0) {
			// Find the first available position
			const positions = existingEntries.map((e) => e.position)
			while (positions.includes(nextPosition)) {
				nextPosition++
			}
		}

		data.position = nextPosition

		const [newEntry] = await db
			.insert(schema.characterLoreEntries)
			.values(data)
			.returning()

		await syncLorebookBindings({ lorebookId: newEntry.lorebookId })
		autoEnqueueLorebook(newEntry.lorebookId, existingBook.name, "").catch(console.error)

		// Refresh binding list and entry list
		if (emitToUser) {
			const bindingListResult = await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: newEntry.lorebookId },
				emitToUser
			)
			emitToUser("lorebookBindingList", bindingListResult)

			const entryListResult = await characterLoreEntryListHandler.handler(
				socket,
				{ lorebookId: newEntry.lorebookId },
				emitToUser
			)
			emitToUser("characterLoreEntries:list", entryListResult)
		}

		return {
			characterLoreEntry: newEntry
		}
	}
}

export const updateCharacterLoreEntryHandler: Handler<
	Sockets.CharacterLoreEntries.Update.Params,
	Sockets.CharacterLoreEntries.Update.Response
> = {
	event: "characterLoreEntries:update",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Check if entry exists and user owns the lorebook
		const existingEntry = await db.query.characterLoreEntries.findFirst({
			where: (cle, { eq }) => eq(cle.id, params.characterLoreEntry.id!),
			with: {
				lorebook: true
			}
		})

		if (!existingEntry || existingEntry.lorebook.userId !== userId) {
			throw new Error("Character lore entry not found or access denied.")
		}

		const {
			id: _id,
			lorebookId: _lorebookId,
			createdAt: _createdAt,
			updatedAt: _updatedAt,
			vectorizedAt: _vectorizedAt,
			embedding: _embedding,
			embeddingModel: _embeddingModel,
			...updateData
		} = params.characterLoreEntry

		if (updateData.name) updateData.name = updateData.name.trim()
		if (updateData.content) updateData.content = updateData.content.trim()

		const [updatedEntry] = await db
			.update(schema.characterLoreEntries)
			.set({ ...updateData, embedding: null, embeddingModel: null, vectorizedAt: null })
			.where(
				eq(
					schema.characterLoreEntries.id,
					params.characterLoreEntry.id!
				)
			)
			.returning()

		await syncLorebookBindings({ lorebookId: existingEntry.lorebookId })
		autoEnqueueLorebook(existingEntry.lorebookId, (existingEntry as any).lorebook?.name ?? "", "").catch(console.error)

		// Refresh binding list and entry list
		if (emitToUser) {
			const bindingListResult = await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: existingEntry.lorebookId },
				emitToUser
			)
			emitToUser("lorebookBindingList", bindingListResult)

			const entryListResult = await characterLoreEntryListHandler.handler(
				socket,
				{ lorebookId: existingEntry.lorebookId },
				emitToUser
			)
			emitToUser("characterLoreEntries:list", entryListResult)
		}

		return {
			characterLoreEntry: updatedEntry
		}
	}
}

export const deleteCharacterLoreEntryHandler: Handler<
	Sockets.CharacterLoreEntries.Delete.Params,
	Sockets.CharacterLoreEntries.Delete.Response
> = {
	event: "characterLoreEntries:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Check if entry exists and user owns the lorebook
		const existingEntry = await db.query.characterLoreEntries.findFirst({
			where: (cle, { eq }) => eq(cle.id, params.id),
			with: {
				lorebook: true
			}
		})

		if (!existingEntry || existingEntry.lorebook.userId !== userId) {
			throw new Error("Character lore entry not found or access denied.")
		}

		await db
			.delete(schema.characterLoreEntries)
			.where(eq(schema.characterLoreEntries.id, params.id))

		await syncLorebookBindings({ lorebookId: existingEntry.lorebookId })

		// Refresh binding list and entry list
		if (emitToUser) {
			const bindingListResult = await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: existingEntry.lorebookId },
				emitToUser
			)
			emitToUser("lorebookBindingList", bindingListResult)

			const entryListResult = await characterLoreEntryListHandler.handler(
				socket,
				{ lorebookId: existingEntry.lorebookId },
				emitToUser
			)
			emitToUser("characterLoreEntries:list", entryListResult)
		}

		return {
			success: "Character lore entry deleted successfully."
		}
	}
}

export const updateCharacterLoreEntryPositionsHandler: Handler<
	Sockets.CharacterLoreEntries.UpdatePositions.Params,
	Sockets.CharacterLoreEntries.UpdatePositions.Response
> = {
	event: "characterLoreEntries:updatePositions",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Verify lorebook belongs to user
		const book = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, params.lorebookId), eq(l.userId, userId)),
			columns: { id: true }
		})

		if (!book) {
			throw new Error("Lorebook not found or access denied.")
		}

		// Update positions
		for (const update of params.positions) {
			await db
				.update(schema.characterLoreEntries)
				.set({ position: update.position })
				.where(eq(schema.characterLoreEntries.id, update.id))
		}

		// Refresh entry list
		if (emitToUser) {
			const entryListResult = await characterLoreEntryListHandler.handler(
				socket,
				{ lorebookId: params.lorebookId },
				emitToUser
			)
			emitToUser("characterLoreEntries:list", entryListResult)
		}

		return {
			success: "Character lore entry positions updated successfully."
		}
	}
}

// Registration function for character lore entry handlers
export function registerCharacterLoreEntryHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, characterLoreEntryListHandler, emitToUser)
	register(socket, createCharacterLoreEntryHandler, emitToUser)
	register(socket, updateCharacterLoreEntryHandler, emitToUser)
	register(socket, deleteCharacterLoreEntryHandler, emitToUser)
	register(socket, updateCharacterLoreEntryPositionsHandler, emitToUser)
}
