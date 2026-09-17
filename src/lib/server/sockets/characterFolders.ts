import { db } from "$lib/server/db"
import { and, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import { buildCharactersList } from "./characters"

/**
 * The library's folders — a user-made grouping of characters.
 *
 * Owner-scoped throughout, and there is no read path for anyone else: a folder
 * is a shelf in one person's library, never a thing a session shares. Every
 * write scopes its `where` on `userId` rather than checking ownership first and
 * then writing, so a caller naming someone else's folder id updates nothing
 * instead of racing the check.
 *
 * Deleting a folder KEEPS its characters — `characters.folder_id` is
 * `ON DELETE SET NULL`, so they return to the top level and the confirm dialog
 * can say so honestly.
 */

/**
 * Every folder this user has, with how many of their characters are in it.
 *
 * The one query behind the `characterFolders:list` request AND behind the
 * cascades that re-send it after a write, so a refresh can never be a different
 * read from the request's own — and so those cascades can hand it over LAZILY
 * (socket-interest plan, ruling 4).
 *
 * The count comes off a grouped sub-select rather than a per-folder query: a
 * library with thirty folders would otherwise pay thirty round trips to render
 * one sidebar. Soft-deleted characters are excluded, matching what
 * `buildCharactersList` actually shows.
 */
async function buildFoldersList(
	userId: number
): Promise<Sockets.CharacterFolders.List.Response> {
	const counts = await db
		.select({
			folderId: schema.characters.folderId,
			total: sql<number>`count(*)::int`
		})
		.from(schema.characters)
		.where(
			and(
				eq(schema.characters.userId, userId),
				eq(schema.characters.isDeleted, false)
			)
		)
		.groupBy(schema.characters.folderId)

	const byFolder = new Map<number, number>()
	for (const row of counts)
		if (row.folderId != null) byFolder.set(row.folderId, row.total)

	const rows = await db.query.characterFolders.findMany({
		where: (f, { eq }) => eq(f.userId, userId),
		orderBy: (f, { asc }) => [asc(f.position), asc(f.name)]
	})

	return {
		folders: rows.map((folder) => ({
			...folder,
			characterCount: byFolder.get(folder.id) ?? 0
		}))
	}
}

export const characterFoldersList: Handler<
	Sockets.CharacterFolders.List.Params,
	Sockets.CharacterFolders.List.Response
> = {
	event: "characterFolders:list",
	handler: async (socket, params, emitToUser) => {
		const res = await buildFoldersList(socket.user!.id)
		emitToUser("characterFolders:list", res)
		return res
	}
}

export const characterFoldersCreate: Handler<
	Sockets.CharacterFolders.Create.Params,
	Sockets.CharacterFolders.Create.Response
> = {
	event: "characterFolders:create",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const name = (params.name ?? "").trim()
			if (!name) throw new Error("Folder name is required.")

			const [folder] = await db
				.insert(schema.characterFolders)
				.values({ userId, name })
				.returning()

			// LAZY (see `buildFoldersList`), awaited so the refreshed list
			// still lands before the reply.
			await emitToUser("characterFolders:list", () =>
				buildFoldersList(userId)
			)
			const res: Sockets.CharacterFolders.Create.Response = { folder }
			emitToUser("characterFolders:create", res)
			return res
		} catch (e: any) {
			console.error("Error creating character folder:", e)
			// Drizzle wraps the raw pg error under `.cause` on some drivers.
			const isUniqueViolation =
				e?.code === "23505" || e?.cause?.code === "23505"
			emitToUser("characterFolders:create:error", {
				error: isUniqueViolation
					? `A folder named "${(params.name ?? "").trim()}" already exists.`
					: e.message || "Failed to create folder."
			})
			throw e
		}
	}
}

export const characterFoldersUpdate: Handler<
	Sockets.CharacterFolders.Update.Params,
	Sockets.CharacterFolders.Update.Response
> = {
	event: "characterFolders:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const patch: { name?: string; position?: number } = {}
			if (params.name !== undefined) {
				const name = params.name.trim()
				if (!name) throw new Error("Folder name is required.")
				patch.name = name
			}
			if (params.position !== undefined) patch.position = params.position
			if (!Object.keys(patch).length)
				throw new Error("Nothing to update.")

			// Scoped on userId: naming someone else's folder updates no row and
			// answers "not found", rather than reading it first to say so.
			const [folder] = await db
				.update(schema.characterFolders)
				.set(patch)
				.where(
					and(
						eq(schema.characterFolders.id, params.id),
						eq(schema.characterFolders.userId, userId)
					)
				)
				.returning()
			if (!folder)
				throw new Error("Folder not found or not owned by user.")

			await emitToUser("characterFolders:list", () =>
				buildFoldersList(userId)
			)
			const res: Sockets.CharacterFolders.Update.Response = { folder }
			emitToUser("characterFolders:update", res)
			return res
		} catch (e: any) {
			console.error("Error updating character folder:", e)
			// Drizzle wraps the raw pg error under `.cause` on some drivers.
			const isUniqueViolation =
				e?.code === "23505" || e?.cause?.code === "23505"
			emitToUser("characterFolders:update:error", {
				error: isUniqueViolation
					? `A folder named "${(params.name ?? "").trim()}" already exists.`
					: e.message || "Failed to update folder."
			})
			throw e
		}
	}
}

export const characterFoldersDelete: Handler<
	Sockets.CharacterFolders.Delete.Params,
	Sockets.CharacterFolders.Delete.Response
> = {
	event: "characterFolders:delete",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const [folder] = await db
				.delete(schema.characterFolders)
				.where(
					and(
						eq(schema.characterFolders.id, params.id),
						eq(schema.characterFolders.userId, userId)
					)
				)
				.returning()
			if (!folder)
				throw new Error("Folder not found or not owned by user.")

			// The characters that were in it are NOT deleted — `folder_id` is
			// ON DELETE SET NULL, so they are back at the top level and the
			// character list has to be re-read to show that.
			await emitToUser("characterFolders:list", () =>
				buildFoldersList(userId)
			)
			await emitToUser("characters:list", () =>
				buildCharactersList(userId)
			)
			const res: Sockets.CharacterFolders.Delete.Response = {
				success: true,
				id: params.id
			}
			emitToUser("characterFolders:delete", res)
			return res
		} catch (e: any) {
			console.error("Error deleting character folder:", e)
			emitToUser("characterFolders:delete:error", {
				error: e.message || "Failed to delete folder."
			})
			throw e
		}
	}
}

export const charactersSetFolder: Handler<
	Sockets.Characters.SetFolder.Params,
	Sockets.Characters.SetFolder.Response
> = {
	event: "characters:setFolder",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// A folder that is not the caller's is not a destination. Refused
			// outright here (unlike `characters:update`, where the folder is
			// one field of a form save and dropping it silently is the lesser
			// surprise) because moving a character IS the whole request.
			if (params.folderId != null) {
				const folder = await db.query.characterFolders.findFirst({
					where: (f, { and, eq }) =>
						and(eq(f.id, params.folderId!), eq(f.userId, userId)),
					columns: { id: true }
				})
				if (!folder)
					throw new Error("Folder not found or not owned by user.")
			}

			const [updated] = await db
				.update(schema.characters)
				.set({ folderId: params.folderId })
				.where(
					and(
						eq(schema.characters.id, params.characterId),
						eq(schema.characters.userId, userId)
					)
				)
				.returning({ id: schema.characters.id })
			if (!updated)
				throw new Error("Character not found or not owned by user.")

			await emitToUser("characters:list", () =>
				buildCharactersList(userId)
			)
			await emitToUser("characterFolders:list", () =>
				buildFoldersList(userId)
			)
			const res: Sockets.Characters.SetFolder.Response = {
				success: true,
				characterId: params.characterId
			}
			emitToUser("characters:setFolder", res)
			return res
		} catch (e: any) {
			console.error("Error setting character folder:", e)
			emitToUser("characters:setFolder:error", {
				error: e.message || "Failed to move character.",
				characterId: params.characterId
			})
			throw e
		}
	}
}

export function registerCharacterFolderHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, characterFoldersList, emitToUser)
	register(socket, characterFoldersCreate, emitToUser)
	register(socket, characterFoldersUpdate, emitToUser)
	register(socket, characterFoldersDelete, emitToUser)
	// `characters:setFolder` — the folder family's write, named after the row
	// it moves. Registered here because it is this file's cascade.
	register(socket, charactersSetFolder, emitToUser)
}
