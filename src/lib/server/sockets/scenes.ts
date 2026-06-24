import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq, inArray, asc } from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { compileScenesForEntry } from "$lib/server/utils/summarizer"
import { getUserConfigurations } from "$lib/server/utils/getUserConfigurations"

export const sceneListHandler: Handler<
	Sockets.Scenes.List.Params,
	Sockets.Scenes.List.Response
> = {
	event: "scenes:list",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Verify chat ownership
		const chat = await db.query.chats.findFirst({
			where: (c, { and, eq }) => and(eq(c.id, params.chatId), eq(c.userId, userId))
		})

		if (!chat) {
			throw new Error("Chat not found or access denied.")
		}

		const scenes = await db.query.scenes.findMany({
			where: eq(schema.scenes.chatId, params.chatId),
			orderBy: (s, { asc }) => asc(s.id),
			with: {
				historyEntry: {
					columns: { id: true, year: true, month: true, day: true, isCompleted: true }
				}
			}
		})

		// Build nextEntry for each history entry (ordered by year, month, day, then id)
		const lorebookId = scenes[0]?.lorebookId
		let nextEntryMap = new Map<number, { id: number; year: number; month: number | null; day: number | null } | null>()
		if (lorebookId) {
			const allEntries = await db.query.historyEntries.findMany({
				where: eq(schema.historyEntries.lorebookId, lorebookId),
				columns: { id: true, year: true, month: true, day: true },
				orderBy: [asc(schema.historyEntries.year), asc(schema.historyEntries.month), asc(schema.historyEntries.day), asc(schema.historyEntries.id)]
			})
			for (let i = 0; i < allEntries.length; i++) {
				nextEntryMap.set(allEntries[i].id, allEntries[i + 1] ?? null)
			}
		}

		const sceneList = (scenes as any[]).map((s) => ({
			...s,
			historyEntry: s.historyEntry
				? { ...s.historyEntry, nextEntry: nextEntryMap.get(s.historyEntry.id) ?? null }
				: null
		}))

		const res = { sceneList: sceneList as unknown as Sockets.Scenes.List.SceneWithEntry[] }
		emitToUser("scenes:list", res)
		return res
	}
}

export const sceneCreateHandler: Handler<
	Sockets.Scenes.Create.Params,
	Sockets.Scenes.Create.Response
> = {
	event: "scenes:create",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const data: InsertScene = { ...params.scene }

		// Verify lorebook ownership
		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, data.lorebookId), eq(l.userId, userId))
		})

		if (!lorebook) {
			throw new Error("Lorebook not found or access denied.")
		}

		// If chatId provided, verify chat ownership
		if (data.chatId) {
			const chat = await db.query.chats.findFirst({
				where: (c, { and, eq }) => and(eq(c.id, data.chatId!), eq(c.userId, userId))
			})
			if (!chat) {
				throw new Error("Chat not found or access denied.")
			}
		}

		const [newScene] = await db.insert(schema.scenes).values(data).returning()

		// Refresh scene list for the chat
		if (emitToUser && newScene.chatId) {
			const listRes = await sceneListHandler.handler(
				socket,
				{ chatId: newScene.chatId },
				emitToUser
			)
			emitToUser("scenes:list", listRes)

			// Also refresh scened message IDs
			const scenedRes = await scenedMessageIdsHandler.handler(
				socket,
				{ chatId: newScene.chatId },
				emitToUser
			)
			emitToUser("scenes:scenedMessageIds", scenedRes)
		}

		const res = { scene: newScene }
		emitToUser("scenes:create", res)
		return res
	}
}

export const sceneUpdateHandler: Handler<
	Sockets.Scenes.Update.Params,
	Sockets.Scenes.Update.Response
> = {
	event: "scenes:update",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const existing = await db.query.scenes.findFirst({
			where: eq(schema.scenes.id, params.scene.id)
		})

		if (!existing) throw new Error("Scene not found.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) => and(eq(l.id, existing.lorebookId), eq(l.userId, userId))
		})

		if (!lorebook) {
			throw new Error("Scene not found or access denied.")
		}

		await db
			.update(schema.scenes)
			.set(params.scene)
			.where(eq(schema.scenes.id, params.scene.id))

		const [updated] = await db
			.select()
			.from(schema.scenes)
			.where(eq(schema.scenes.id, params.scene.id))

		// Refresh scene list
		if (emitToUser && updated.chatId) {
			const listRes = await sceneListHandler.handler(
				socket,
				{ chatId: updated.chatId },
				emitToUser
			)
			emitToUser("scenes:list", listRes)
		}

		const res = { scene: updated }
		emitToUser("scenes:update", res)
		return res
	}
}

export const sceneDeleteHandler: Handler<
	Sockets.Scenes.Delete.Params,
	Sockets.Scenes.Delete.Response
> = {
	event: "scenes:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const existing = await db.query.scenes.findFirst({
			where: eq(schema.scenes.id, params.id)
		})

		if (!existing) throw new Error("Scene not found.")

		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) => and(eq(l.id, existing.lorebookId), eq(l.userId, userId))
		})

		if (!lorebook) {
			throw new Error("Scene not found or access denied.")
		}

		const chatId = existing.chatId

		await db.delete(schema.scenes).where(eq(schema.scenes.id, params.id))

		// Refresh scene list and scened message IDs
		if (emitToUser && chatId) {
			const listRes = await sceneListHandler.handler(socket, { chatId }, emitToUser)
			emitToUser("scenes:list", listRes)

			const scenedRes = await scenedMessageIdsHandler.handler(
				socket,
				{ chatId },
				emitToUser
			)
			emitToUser("scenes:scenedMessageIds", scenedRes)
		}

		return { success: "Scene deleted." }
	}
}

export const scenedMessageIdsHandler: Handler<
	Sockets.Scenes.SenedMessageIds.Params,
	Sockets.Scenes.SenedMessageIds.Response
> = {
	event: "scenes:scenedMessageIds",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Verify chat ownership
		const chat = await db.query.chats.findFirst({
			where: (c, { and, eq }) => and(eq(c.id, params.chatId), eq(c.userId, userId))
		})

		if (!chat) {
			throw new Error("Chat not found or access denied.")
		}

		const scenes = await db.query.scenes.findMany({
			where: eq(schema.scenes.chatId, params.chatId),
			columns: { selectedMessageIds: true }
		})

		const scenedMessageIds = scenes.flatMap((s) => s.selectedMessageIds ?? [])

		const res = { scenedMessageIds }
		emitToUser("scenes:scenedMessageIds", res)
		return res
	}
}

export const sceneListByLorebookHandler: Handler<
	Sockets.Scenes.ListByLorebook.Params,
	Sockets.Scenes.ListByLorebook.Response
> = {
	event: "scenes:listByLorebook",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Verify lorebook ownership
		const lorebook = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) => and(eq(l.id, params.lorebookId), eq(l.userId, userId))
		})
		if (!lorebook) throw new Error("Lorebook not found or access denied.")

		const scenes = await db.query.scenes.findMany({
			where: eq(schema.scenes.lorebookId, params.lorebookId),
			orderBy: [asc(schema.scenes.historyEntryId), asc(schema.scenes.id)]
		})

		// Resolve chat names in a single query
		const chatIds = [...new Set(scenes.filter((s) => s.chatId).map((s) => s.chatId!))]
		const chats =
			chatIds.length > 0
				? await db.query.chats.findMany({
						where: inArray(schema.chats.id, chatIds),
						columns: { id: true, name: true }
					})
				: []
		const chatMap = new Map(chats.map((c) => [c.id, c.name]))

		const sceneList: Sockets.Scenes.SceneWithMeta[] = scenes.map((s) => ({
			...s,
			chatName: s.chatId ? (chatMap.get(s.chatId) ?? null) : null
		}))

		const res = { sceneList }
		emitToUser("scenes:listByLorebook", res)
		return res
	}
}

export const sceneCompileHandler: Handler<
	Sockets.Scenes.Compile.Params,
	Sockets.Scenes.Compile.Response
> = {
	event: "scenes:compile",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Verify history entry ownership via lorebook
		const historyEntry = await db.query.historyEntries.findFirst({
			where: eq(schema.historyEntries.id, params.historyEntryId),
			with: { lorebook: true }
		})
		if (!historyEntry || (historyEntry as any).lorebook?.userId !== userId) {
			throw new Error("History entry not found or access denied.")
		}

		// Fetch scenes for this history entry
		const scenes = await db.query.scenes.findMany({
			where: eq(schema.scenes.historyEntryId, params.historyEntryId),
			orderBy: asc(schema.scenes.id)
		})

		if (scenes.length === 0) {
			throw new Error("No scenes found for this history entry.")
		}

		const { connection, sampling, contextConfig, promptConfig } =
			await getUserConfigurations(userId)

		if (!connection) {
			throw new Error("No AI connection configured. Please set up a connection first.")
		}

		const result = await compileScenesForEntry({
			scenes,
			connection,
			sampling,
			contextConfig,
			promptConfig,
			onProgress: (data) => {
				emitToUser("scenes:compile:progress", data satisfies Sockets.Scenes.Compile.Progress)
			}
		})

		const response: Sockets.Scenes.Compile.Response = {
			content: result.content ?? result.raw,
			historyEntryId: params.historyEntryId
		}
		emitToUser("scenes:compile:complete", response)
		return response
	}
}

export function registerSceneHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, sceneListHandler, emitToUser)
	register(socket, sceneCreateHandler, emitToUser)
	register(socket, sceneUpdateHandler, emitToUser)
	register(socket, sceneDeleteHandler, emitToUser)
	register(socket, scenedMessageIdsHandler, emitToUser)
	register(socket, sceneListByLorebookHandler, emitToUser)
	register(socket, sceneCompileHandler, emitToUser)
}
