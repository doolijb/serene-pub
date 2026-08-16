import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, asc, eq, desc, gte, sql } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
// InsertHistoryEntry/SelectHistoryEntry are declared globally in
// $lib/server/db/types.d.ts (ambient `export global {}` block, same pattern
// as the Sockets namespace) — no import needed/available for them.
import { lorebookBindingListHandler } from "./lorebooks"
import { autoEnqueueLorebook } from "$lib/server/embedding/vectorizationQueue"

export const historyEntryListHandler: Handler<
	Sockets.HistoryEntries.List.Params,
	Sockets.HistoryEntries.List.Response
> = {
	event: "historyEntries:list",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const book = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, params.lorebookId), eq(l.userId, userId)),
			with: {
				historyEntries: {
					orderBy: asc(schema.historyEntries.position)
				}
			}
		})

		if (!book) {
			throw new Error("Lorebook not found.")
		}

		const res = {
			lorebookId: params.lorebookId,
			historyEntryList: book.historyEntries
		}
		emitToUser("historyEntries:list", res)
		return res
	}
}

export const createHistoryEntryHandler: Handler<
	Sockets.HistoryEntries.Create.Params,
	Sockets.HistoryEntries.Create.Response
> = {
	event: "historyEntries:create",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const data: InsertHistoryEntry = { ...params.historyEntry }

		// Verify lorebook ownership
		const book = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, data.lorebookId), eq(l.userId, userId))
		})

		if (!book) {
			throw new Error("Lorebook not found.")
		}

		// Advisory lock scoped to lorebookId — without it, two concurrent
		// creates that both need to compute a position can both read the same
		// max and insert with the same position. Same fix, same reason, as
		// resolveOrCreateBinding's already-fixed race.
		const [newEntry] = await db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(${data.lorebookId})`
			)

			// Get next position if not provided
			if (data.position === undefined || data.position === null) {
				const maxPosition = await tx.query.historyEntries.findFirst({
					where: (he, { eq }) => eq(he.lorebookId, data.lorebookId),
					orderBy: (he, { desc }) => desc(he.position),
					columns: { position: true }
				})
				data.position = (maxPosition?.position ?? -1) + 1
			}

			return tx.insert(schema.historyEntries).values(data).returning()
		})

		autoEnqueueLorebook(newEntry.lorebookId, book.name, "").catch(
			console.error
		)

		// Refresh lorebook bindings — both handler calls already emit their
		// own response internally ("lorebooks:bindingList" /
		// "historyEntries:list"), so no separate emit is needed here.
		if (emitToUser) {
			await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: newEntry.lorebookId },
				emitToUser
			)
			await historyEntryListHandler.handler(
				socket,
				{ lorebookId: newEntry.lorebookId },
				emitToUser
			)
			emitToUser("historyEntries:create", { historyEntry: newEntry })
		}

		return {
			historyEntry: newEntry
		}
	}
}

export const updateHistoryEntryHandler: Handler<
	Sockets.HistoryEntries.Update.Params,
	Sockets.HistoryEntries.Update.Response
> = {
	event: "historyEntries:update",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const existingEntry = await db.query.historyEntries.findFirst({
			where: (he, { eq }) => eq(he.id, params.historyEntry.id),
			with: {
				lorebook: true
			}
		})

		if (!existingEntry || existingEntry.lorebook.userId !== userId) {
			throw new Error("History entry not found.")
		}

		// lorebookId is deliberately excluded — ownership is only verified
		// against the entry's *current* lorebook above; a client-supplied
		// replacement value here would let a user relocate their own entry
		// into a lorebook they don't own with no re-validation. position is
		// also excluded — the real reorder UI goes through the separately
		// IDOR-checked updatePositions batch handler; this singular update
		// shouldn't let a raw client set an arbitrary/colliding value.
		const {
			id,
			lorebookId: _lorebookId,
			createdAt,
			updatedAt,
			embedding,
			embeddingModel,
			vectorizedAt,
			position: _position,
			...fields
		} = { ...params.historyEntry }

		// Update the entry; reset embedding so the queue re-vectorizes it
		await db
			.update(schema.historyEntries)
			.set({
				...fields,
				embedding: null,
				embeddingModel: null,
				vectorizedAt: null
			})
			.where(eq(schema.historyEntries.id, id))

		// Get updated entry
		const [updatedEntry] = await db
			.select()
			.from(schema.historyEntries)
			.where(eq(schema.historyEntries.id, id))

		autoEnqueueLorebook(
			existingEntry.lorebookId,
			existingEntry.lorebook?.name ?? "",
			""
		).catch(console.error)

		// Refresh lorebook bindings and entry list
		if (emitToUser) {
			const bindingListResult = await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: existingEntry.lorebookId },
				emitToUser
			)
			emitToUser("lorebookBindingList", bindingListResult)

			const entryListResult = await historyEntryListHandler.handler(
				socket,
				{ lorebookId: existingEntry.lorebookId },
				emitToUser
			)
			emitToUser("historyEntries:list", entryListResult)
		}

		return {
			historyEntry: updatedEntry
		}
	}
}

export const deleteHistoryEntryHandler: Handler<
	Sockets.HistoryEntries.Delete.Params,
	Sockets.HistoryEntries.Delete.Response
> = {
	event: "historyEntries:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const existingEntry = await db.query.historyEntries.findFirst({
			where: (he, { eq }) => eq(he.id, params.id),
			with: {
				lorebook: true
			}
		})

		if (!existingEntry || existingEntry.lorebook.userId !== userId) {
			throw new Error("History entry not found.")
		}

		// Delete the entry
		await db
			.delete(schema.historyEntries)
			.where(eq(schema.historyEntries.id, params.id))

		// Refresh lorebook bindings and entry list
		if (emitToUser) {
			const bindingListResult = await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: existingEntry.lorebookId },
				emitToUser
			)
			emitToUser("lorebookBindingList", bindingListResult)

			const entryListResult = await historyEntryListHandler.handler(
				socket,
				{ lorebookId: existingEntry.lorebookId },
				emitToUser
			)
			emitToUser("historyEntries:list", entryListResult)
		}

		return {
			success: "History entry deleted successfully."
		}
	}
}

export const iterateNextHistoryEntryHandler: Handler<
	Sockets.HistoryEntries.IterateNext.Params,
	Sockets.HistoryEntries.IterateNext.Response
> = {
	event: "historyEntries:iterateNext",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const existingEntry = await db.query.historyEntries.findFirst({
			where: (he, { eq }) => eq(he.id, params.id),
			with: {
				lorebook: true
			}
		})

		if (!existingEntry || existingEntry.lorebook.userId !== userId) {
			throw new Error("History entry not found.")
		}

		let year = existingEntry.year ?? 1
		let month = existingEntry.month ?? 1
		let day = existingEntry.day ?? 1

		// Iterate date forward by 1 day
		day += 1

		// Handle month overflow
		const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
		if (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) {
			daysInMonth[1] = 29 // Leap year
		}

		if (day > daysInMonth[month - 1]) {
			day = 1
			month += 1
			if (month > 12) {
				month = 1
				year += 1
			}
		}

		// Create new entry data
		const data: InsertHistoryEntry = {
			lorebookId: existingEntry.lorebookId,
			keys: "", // Blank keys for new entry
			content: "", // Blank content for new entry
			useRegex: existingEntry.useRegex,
			caseSensitive: existingEntry.caseSensitive,
			year,
			month,
			day,
			extraJson: existingEntry.extraJson || {},
			position: existingEntry.position + 1
		}

		// Insert the new entry, first shifting every entry already at or past
		// the target position forward by one — otherwise the new entry and
		// whatever was already at position+1 end up sharing a position, with
		// ambiguous ordering until someone manually fixes it.
		const [newEntry] = await db.transaction(async (tx) => {
			await tx
				.update(schema.historyEntries)
				.set({ position: sql`${schema.historyEntries.position} + 1` })
				.where(
					and(
						eq(
							schema.historyEntries.lorebookId,
							existingEntry.lorebookId
						),
						gte(schema.historyEntries.position, data.position!)
					)
				)

			return await tx
				.insert(schema.historyEntries)
				.values(data)
				.returning()
		})

		// Refresh history entry list
		if (emitToUser) {
			const historyEntryListResult =
				await historyEntryListHandler.handler(
					socket,
					{ lorebookId: existingEntry.lorebookId },
					emitToUser
				)
			emitToUser("historyEntries:list", historyEntryListResult)
		}

		return {
			historyEntry: newEntry
		}
	}
}

// Registration function for history entry handlers
export function registerHistoryEntryHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, historyEntryListHandler, emitToUser)
	register(socket, createHistoryEntryHandler, emitToUser)
	register(socket, updateHistoryEntryHandler, emitToUser)
	register(socket, deleteHistoryEntryHandler, emitToUser)
	register(socket, iterateNextHistoryEntryHandler, emitToUser)
}
