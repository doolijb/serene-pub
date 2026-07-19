import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { asc, eq, inArray } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
// InsertWorldLoreEntry is declared globally in $lib/server/db/types.d.ts
// (ambient `export global {}` block, same pattern as the Sockets namespace)
// — no import needed/available for it.
import { lorebookBindingListHandler, syncLorebookBindings } from "./lorebooks"
import { autoEnqueueLorebook } from "$lib/server/embedding/vectorizationQueue"

export const worldLoreEntryListHandler: Handler<
	Sockets.WorldLoreEntries.List.Params,
	Sockets.WorldLoreEntries.List.Response
> = {
	event: "worldLoreEntries:list",
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
				worldLoreEntries: true
			}
		})

		if (!book) throw new Error("Lorebook not found.")

		const res = {
			worldLoreEntryList: book.worldLoreEntries
		}
		emitToUser("worldLoreEntries:list", res)
		return res
	}
}

export const createWorldLoreEntryHandler: Handler<
	Sockets.WorldLoreEntries.Create.Params,
	Sockets.WorldLoreEntries.Create.Response
> = {
	event: "worldLoreEntries:create",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const data: InsertWorldLoreEntry = { ...params.worldLoreEntry }
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
				worldLoreEntries: {
					columns: {
						id: true,
						position: true
					},
					orderBy: asc(schema.worldLoreEntries.position)
				}
			}
		})

		if (!existingBook) {
			throw new Error(
				"Lorebook not found or you do not have permission to create an entry."
			)
		}

		const existingEntries = existingBook.worldLoreEntries

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
			.insert(schema.worldLoreEntries)
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

			const entryListResult = await worldLoreEntryListHandler.handler(
				socket,
				{ lorebookId: newEntry.lorebookId },
				emitToUser
			)
			emitToUser("worldLoreEntries:list", entryListResult)
		}

		return {
			worldLoreEntry: newEntry
		}
	}
}

export const updateWorldLoreEntryHandler: Handler<
	Sockets.WorldLoreEntries.Update.Params,
	Sockets.WorldLoreEntries.Update.Response
> = {
	event: "worldLoreEntries:update",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Check if entry exists and user owns the lorebook
		const existingEntry = await db.query.worldLoreEntries.findFirst({
			where: (wle, { eq }) => eq(wle.id, params.worldLoreEntry.id!),
			with: {
				lorebook: true
			}
		})

		if (!existingEntry || existingEntry.lorebook.userId !== userId) {
			throw new Error("World lore entry not found or access denied.")
		}

		const updateData = { ...params.worldLoreEntry }
		if (updateData.name) updateData.name = updateData.name.trim()
		if (updateData.content) updateData.content = updateData.content.trim()

		const [updatedEntry] = await db
			.update(schema.worldLoreEntries)
			.set({ ...updateData, embedding: null, embeddingModel: null, vectorizedAt: null })
			.where(eq(schema.worldLoreEntries.id, params.worldLoreEntry.id!))
			.returning()

		await syncLorebookBindings({ lorebookId: existingEntry.lorebookId })
		autoEnqueueLorebook(existingEntry.lorebookId, existingEntry.lorebook?.name ?? "", "").catch(console.error)

		// Refresh binding list and entry list
		if (emitToUser) {
			const bindingListResult = await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: existingEntry.lorebookId },
				emitToUser
			)
			emitToUser("lorebookBindingList", bindingListResult)

			const entryListResult = await worldLoreEntryListHandler.handler(
				socket,
				{ lorebookId: existingEntry.lorebookId },
				emitToUser
			)
			emitToUser("worldLoreEntries:list", entryListResult)
		}

		return {
			worldLoreEntry: updatedEntry
		}
	}
}

export const deleteWorldLoreEntryHandler: Handler<
	Sockets.WorldLoreEntries.Delete.Params,
	Sockets.WorldLoreEntries.Delete.Response
> = {
	event: "worldLoreEntries:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Check if entry exists and user owns the lorebook
		const existingEntry = await db.query.worldLoreEntries.findFirst({
			where: (wle, { eq }) => eq(wle.id, params.id),
			with: {
				lorebook: true
			}
		})

		if (!existingEntry || existingEntry.lorebook.userId !== userId) {
			throw new Error("World lore entry not found or access denied.")
		}

		await db
			.delete(schema.worldLoreEntries)
			.where(eq(schema.worldLoreEntries.id, params.id))

		await syncLorebookBindings({ lorebookId: existingEntry.lorebookId })

		// Refresh binding list and entry list
		if (emitToUser) {
			const bindingListResult = await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: existingEntry.lorebookId },
				emitToUser
			)
			emitToUser("lorebookBindingList", bindingListResult)

			const entryListResult = await worldLoreEntryListHandler.handler(
				socket,
				{ lorebookId: existingEntry.lorebookId },
				emitToUser
			)
			emitToUser("worldLoreEntries:list", entryListResult)
		}

		return {
			success: "World lore entry deleted successfully."
		}
	}
}

export const updateWorldLoreEntryPositionsHandler: Handler<
	Sockets.WorldLoreEntries.UpdatePositions.Params,
	Sockets.WorldLoreEntries.UpdatePositions.Response
> = {
	event: "worldLoreEntries:updatePositions",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Verify all entries belong to user's lorebooks
		const entryIds = params.updates.map((u) => u.id)
		const entries = await db.query.worldLoreEntries.findMany({
			where: (wle, { inArray }) => inArray(wle.id, entryIds),
			with: {
				lorebook: true
			}
		})

		if (entries.length !== entryIds.length) {
			throw new Error("Some world lore entries not found.")
		}

		const userEntries = entries.filter((e) => e.lorebook.userId === userId)
		if (userEntries.length !== entries.length) {
			throw new Error("Access denied to some world lore entries.")
		}

		// Update positions concurrently — each update targets a distinct entry id
		// and doesn't depend on any other update's result.
		await Promise.all(
			params.updates.map((update) =>
				db
					.update(schema.worldLoreEntries)
					.set({ position: update.position })
					.where(eq(schema.worldLoreEntries.id, update.id))
			)
		)

		// Refresh entry list for affected lorebooks
		if (emitToUser) {
			const affectedLorebookIds = [
				...new Set(entries.map((e) => e.lorebookId))
			]
			for (const lorebookId of affectedLorebookIds) {
				const entryListResult = await worldLoreEntryListHandler.handler(
					socket,
					{ lorebookId },
					emitToUser
				)
				emitToUser("worldLoreEntries:list", entryListResult)
			}
		}

		return {
			success: "World lore entry positions updated successfully."
		}
	}
}

// Registration function for world lore entry handlers
export function registerWorldLoreEntryHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, worldLoreEntryListHandler, emitToUser)
	register(socket, createWorldLoreEntryHandler, emitToUser)
	register(socket, updateWorldLoreEntryHandler, emitToUser)
	register(socket, deleteWorldLoreEntryHandler, emitToUser)
	register(socket, updateWorldLoreEntryPositionsHandler, emitToUser)
}
