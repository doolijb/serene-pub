import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { asc, eq, inArray, sql } from "drizzle-orm"
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

		// Same denylist as updateWorldLoreEntryHandler's — a raw client
		// payload should never be able to set these directly on create
		// either (eg. a forged vectorizedAt/embedding would make
		// vectorizationQueue.ts's needsEmbedding check wrongly treat this
		// entry as already current, permanently skipping real embedding).
		const {
			id: _id,
			createdAt: _createdAt,
			updatedAt: _updatedAt,
			vectorizedAt: _vectorizedAt,
			embedding: _embedding,
			embeddingModel: _embeddingModel,
			position: _position,
			...safeInsert
		} = params.worldLoreEntry
		const data: InsertWorldLoreEntry = { ...safeInsert }
		data.name = data.name.trim()
		data.content = data.content?.trim() || ""

		const book = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, data.lorebookId), eq(l.userId, userId)),
			columns: { id: true, name: true, userId: true }
		})
		if (!book) {
			throw new Error(
				"Lorebook not found or you do not have permission to create an entry."
			)
		}

		// Advisory lock scoped to lorebookId — without it, two concurrent
		// creates can both read the same "first available position" gap and
		// insert with the same position. Same fix, same reason, as
		// resolveOrCreateBinding's already-fixed race.
		const [newEntry] = await db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(${data.lorebookId})`
			)

			const existingEntries = await tx.query.worldLoreEntries.findMany({
				where: eq(schema.worldLoreEntries.lorebookId, data.lorebookId),
				columns: { id: true, position: true },
				orderBy: asc(schema.worldLoreEntries.position)
			})

			let nextPosition = 1
			const positions = existingEntries.map((e) => e.position)
			while (positions.includes(nextPosition)) {
				nextPosition++
			}
			data.position = nextPosition

			return tx.insert(schema.worldLoreEntries).values(data).returning()
		})

		await syncLorebookBindings({ lorebookId: newEntry.lorebookId })
		autoEnqueueLorebook(newEntry.lorebookId, book.name, "").catch(
			console.error
		)

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

		// lorebookId is deliberately excluded — ownership is only verified
		// against the entry's *current* lorebook above; a client-supplied
		// replacement value here would let a user relocate their own entry
		// into a lorebook they don't own with no re-validation. position is
		// also excluded — the real reorder UI goes through the separately
		// IDOR-checked updatePositions batch handler; this singular update
		// shouldn't let a raw client set an arbitrary/colliding value.
		const {
			id: _id,
			lorebookId: _lorebookId,
			createdAt: _createdAt,
			updatedAt: _updatedAt,
			vectorizedAt: _vectorizedAt,
			embedding: _embedding,
			embeddingModel: _embeddingModel,
			position: _position,
			...updateData
		} = params.worldLoreEntry
		if (updateData.name) updateData.name = updateData.name.trim()
		if (updateData.content) updateData.content = updateData.content.trim()

		const [updatedEntry] = await db
			.update(schema.worldLoreEntries)
			.set({
				...updateData,
				embedding: null,
				embeddingModel: null,
				vectorizedAt: null
			})
			.where(eq(schema.worldLoreEntries.id, params.worldLoreEntry.id!))
			.returning()

		await syncLorebookBindings({ lorebookId: existingEntry.lorebookId })
		autoEnqueueLorebook(
			existingEntry.lorebookId,
			existingEntry.lorebook?.name ?? "",
			""
		).catch(console.error)

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
