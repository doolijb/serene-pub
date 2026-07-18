import { db } from "$lib/server/db"
import { eq, and } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"

export const tagsList: Handler<
	Sockets.Tags.List.Params,
	Sockets.Tags.List.Response
> = {
	event: "tags:list",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const tagsList = await db.query.tags.findMany({
			where: (t, { eq }) => eq(t.userId, userId),
			orderBy: (t, { asc }) => asc(t.name)
		})
		const res: Sockets.Tags.List.Response = { tagsList }
		emitToUser("tags:list", res)
		return res
	}
}

export const tagsCreate: Handler<
	Sockets.Tags.Create.Params,
	Sockets.Tags.Create.Response
> = {
	event: "tags:create",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const [tag] = await db
				.insert(schema.tags)
				.values({
					...params.tag,
					userId
				})
				.returning()

			const res: Sockets.Tags.Create.Response = { tag }
			emitToUser("tags:create", res)

			// Also emit updated tags list
			await tagsList.handler(socket, {}, emitToUser)
			return res
		} catch (error) {
			console.error("Error creating tag:", error)
			emitToUser("tags:create:error", {
				error: "Failed to create tag. Tag name might already exist."
			})
			throw error
		}
	}
}

export const tagsUpdate: Handler<
	Sockets.Tags.Update.Params,
	Sockets.Tags.Update.Response
> = {
	event: "tags:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const [tag] = await db
				.update(schema.tags)
				.set({
					name: params.tag.name,
					description: params.tag.description,
					colorPreset: params.tag.colorPreset
				})
				.where(
					and(
						eq(schema.tags.id, params.tag.id),
						eq(schema.tags.userId, userId)
					)
				)
				.returning()

			const res: Sockets.Tags.Update.Response = { tag }
			emitToUser("tags:update", res)

			// Also emit updated tags list
			await tagsList.handler(socket, {}, emitToUser)
			return res
		} catch (error) {
			console.error("Error updating tag:", error)
			emitToUser("tags:update:error", {
				error: "Failed to update tag. Tag name might already exist."
			})
			throw error
		}
	}
}

export const tagsDelete: Handler<
	Sockets.Tags.Delete.Params,
	Sockets.Tags.Delete.Response
> = {
	event: "tags:delete",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Delete the tag (only if owned by user). character_tags/persona_tags/
			// lorebook_tags all declare onDelete: "cascade" on their tagId FK, so
			// their associations clean up automatically — no need to (and
			// previously wrong to) delete them manually here. Doing it manually,
			// unconditionally, before this ownership-scoped delete meant any user
			// could wipe another user's tag associations by id, even though the
			// tag row itself correctly survived.
			await db
				.delete(schema.tags)
				.where(
					and(
						eq(schema.tags.id, params.id),
						eq(schema.tags.userId, userId)
					)
				)

			const res: Sockets.Tags.Delete.Response = {
				success: "Tag deleted successfully"
			}
			emitToUser("tags:delete", res)

			// Also emit updated tags list
			await tagsList.handler(socket, {}, emitToUser)
			return res
		} catch (error) {
			console.error("Error deleting tag:", error)
			emitToUser("tags:delete:error", {
				error: "Failed to delete tag."
			})
			throw error
		}
	}
}

export const tagsGetRelatedData: Handler<
	Sockets.Tags.GetRelatedData.Params,
	Sockets.Tags.GetRelatedData.Response
> = {
	event: "tags:getRelatedData",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Get the tag (only if owned by user)
		const tag = await db.query.tags.findFirst({
			where: (t, { and, eq }) =>
				and(eq(t.id, params.tagId), eq(t.userId, userId))
		})

		if (!tag) {
			throw new Error("Tag not found")
		}

		// Get related characters (only from user's characters)
		const characters = await db.query.characterTags.findMany({
			where: (ct, { eq }) => eq(ct.tagId, params.tagId),
			with: {
				character: {
					columns: {
						id: true,
						name: true,
						avatar: true
					},
					where: (c, { eq }) => eq(c.userId, userId)
				}
			}
		})

		// Get related personas (only from user's personas)
		const personas = await db.query.personaTags.findMany({
			where: (pt, { eq }) => eq(pt.tagId, params.tagId),
			with: {
				persona: {
					columns: {
						id: true,
						name: true,
						avatar: true
					},
					where: (p, { eq }) => eq(p.userId, userId)
				}
			}
		})

		// Get related lorebooks (only from user's lorebooks)
		const lorebooks = await db.query.lorebookTags.findMany({
			where: (lt, { eq }) => eq(lt.tagId, params.tagId),
			with: {
				lorebook: {
					columns: {
						id: true,
						name: true
					},
					where: (l, { eq }) => eq(l.userId, userId)
				}
			}
		})

		const res: Sockets.Tags.GetRelatedData.Response = {
			tagData: {
				tag,
				characters: characters
					.map((ct) => ct.character)
					.filter(Boolean),
				personas: personas.map((pt) => pt.persona).filter(Boolean),
				lorebooks: lorebooks.map((lt) => lt.lorebook).filter(Boolean)
			}
		}
		emitToUser("tags:getRelatedData", res)
		return res
	}
}

// Registration function for all tag handlers
export function registerTagHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, tagsList, emitToUser)
	register(socket, tagsCreate, emitToUser)
	register(socket, tagsUpdate, emitToUser)
	register(socket, tagsDelete, emitToUser)
	register(socket, tagsGetRelatedData, emitToUser)
}
