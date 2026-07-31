import { db } from "$lib/server/db"
import { eq, and } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"

// Case-insensitive+trimmed match against the tags_user_id_name_unique
// index (schema.ts) — shared by tagsCreate's adopt-on-collision check and
// tagsUpdate's rename-collision check below, so the two can never disagree
// about what counts as a collision.
function findMatchingTag(userId: number, rawName: string) {
	const name = rawName.trim()
	return db.query.tags.findFirst({
		where: (t, { and, eq, sql }) =>
			and(eq(t.userId, userId), sql`lower(${t.name}) = lower(${name})`)
	})
}

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
			const name = (params.tag.name ?? "").trim()
			if (!name) throw new Error("Tag name is required.")

			// Adopt an existing case-insensitive/whitespace-variant match
			// instead of creating a duplicate — reused as-is, not overwritten
			// with this request's description/colorPreset, since "adopt"
			// means reuse the existing tag's own appearance.
			const existing = await findMatchingTag(userId, name)
			const tag =
				existing ??
				(
					await db
						.insert(schema.tags)
						.values({ ...params.tag, name, userId })
						.returning()
				)[0]

			const res: Sockets.Tags.Create.Response = { tag }
			emitToUser("tags:create", res)

			// Also emit updated tags list
			await tagsList.handler(socket, {}, emitToUser)
			return res
		} catch (error) {
			console.error("Error creating tag:", error)
			emitToUser("tags:create:error", {
				error: "Failed to create tag."
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
			const name = (params.tag.name ?? "").trim()

			// Renaming into a collision with a DIFFERENT existing tag fails
			// loudly rather than silently merging the two tags' associations
			// — same case-insensitive predicate as the tags_user_id_name_unique
			// index itself (findMatchingTag), so this check and the DB
			// constraint can never disagree about what counts as a collision.
			if (name) {
				const collision = await findMatchingTag(userId, name)
				if (collision && collision.id !== params.tag.id) {
					throw new Error("A tag with this name already exists.")
				}
			}

			const [tag] = await db
				.update(schema.tags)
				.set({
					name: name || params.tag.name,
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
				error:
					error instanceof Error
						? error.message
						: "Failed to update tag."
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

		// Get related characters (only from user's characters). "character"
		// is a `one(...)` relation, and drizzle-orm's relational query API
		// only supports a `where` filter on `many(...)` relations (see
		// DBQueryConfig in drizzle-orm/relations.d.ts — `where`/`orderBy`/
		// `limit` are only added to the config type when TRelationType
		// extends "many"), so the user-ownership check has to happen after
		// the fetch instead of inside the `with.character` config.
		const characterTagRows = await db.query.characterTags.findMany({
			where: (ct, { eq }) => eq(ct.tagId, params.tagId),
			with: {
				character: {
					columns: {
						id: true,
						name: true,
						avatar: true,
						userId: true
					}
				}
			}
		})
		const characters = characterTagRows
			.map((ct) => ct.character)
			.filter(
				(c): c is NonNullable<typeof c> =>
					c !== null && c.userId === userId
			)
			.map(({ userId: _userId, ...c }) => c)

		// Get related personas (only from user's personas) — same "one"
		// relation `where` limitation as above.
		const personaTagRows = await db.query.personaTags.findMany({
			where: (pt, { eq }) => eq(pt.tagId, params.tagId),
			with: {
				persona: {
					columns: {
						id: true,
						name: true,
						avatar: true,
						userId: true
					}
				}
			}
		})
		const personas = personaTagRows
			.map((pt) => pt.persona)
			.filter(
				(p): p is NonNullable<typeof p> =>
					p !== null && p.userId === userId
			)
			.map(({ userId: _userId, ...p }) => p)

		// Get related lorebooks (only from user's lorebooks) — same "one"
		// relation `where` limitation as above.
		const lorebookTagRows = await db.query.lorebookTags.findMany({
			where: (lt, { eq }) => eq(lt.tagId, params.tagId),
			with: {
				lorebook: {
					columns: {
						id: true,
						name: true,
						userId: true
					}
				}
			}
		})
		const lorebooks = lorebookTagRows
			.map((lt) => lt.lorebook)
			.filter(
				(l): l is NonNullable<typeof l> =>
					l !== null && l.userId === userId
			)
			.map(({ userId: _userId, ...l }) => l)

		const res: Sockets.Tags.GetRelatedData.Response = {
			tagData: {
				tag,
				characters,
				personas,
				lorebooks
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
