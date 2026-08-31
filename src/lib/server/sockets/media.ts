/**
 * Media management (28) — the handlers behind the Media panel.
 *
 * Everything here is scoped to the calling user's own blobs. That is the whole
 * authorisation story and it is deliberately narrower than `canViewMedia`:
 * *viewing* an image can be inherited from a shared character, but *managing*
 * one — deleting it, changing its visibility, re-cutting its thumbnail — is
 * only ever the owner's to do.
 */
import { db } from "$lib/server/db"
import { and, eq, isNull, desc, asc, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { Handler } from "$lib/shared/events"
import {
	deleteMedia,
	ensureThumbnail,
	getMedia,
	rotateMediaUuid,
	thumbsByParent,
	toClientMedia
} from "$lib/server/media"
import { MediaVisibility } from "$lib/shared/constants/MediaVisibility"

/**
 * Resolve the display name of whatever each row is grouped under, in two
 * queries rather than one per row. The panel groups and sorts by this, so it
 * cannot be left to the client to look up — the client has no reason to be
 * holding every character in memory just to label an image.
 */
async function attachmentLabels(rows: (typeof schema.media.$inferSelect)[]) {
	const charIds = [
		...new Set(rows.map((r) => r.characterId).filter(Boolean))
	] as number[]
	const personaIds = [
		...new Set(rows.map((r) => r.personaId).filter(Boolean))
	] as number[]

	const characters = charIds.length
		? await db.query.characters.findMany({
				where: inArray(schema.characters.id, charIds),
				columns: { id: true, name: true, nickname: true }
			})
		: []
	const personas = personaIds.length
		? await db.query.personas.findMany({
				where: inArray(schema.personas.id, personaIds),
				columns: { id: true, name: true }
			})
		: []

	const charName = new Map(
		characters.map((c) => [c.id, c.nickname || c.name])
	)
	const personaName = new Map(personas.map((p) => [p.id, p.name]))

	return (row: (typeof schema.media.$inferSelect)) => {
		if (row.characterId)
			return {
				type: "character" as const,
				id: row.characterId,
				// A deleted parent leaves the id behind by design (28 §2), so
				// this is the label an orphan gets — and it is the thing that
				// makes orphans visible to the user at all.
				name: charName.get(row.characterId) ?? null
			}
		if (row.personaId)
			return {
				type: "persona" as const,
				id: row.personaId,
				name: personaName.get(row.personaId) ?? null
			}
		if (row.sessionId)
			return { type: "session" as const, id: row.sessionId, name: null }
		return null
	}
}

export const mediaList: Handler<
	Sockets.Media.List.Params,
	Sockets.Media.List.Response
> = {
	event: "media:list",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const sort = params?.sort ?? "newest"
		const orderBy =
			sort === "oldest"
				? [asc(schema.media.createdAt), asc(schema.media.id)]
				: sort === "largest"
					? [desc(schema.media.bytes), desc(schema.media.id)]
					: sort === "smallest"
						? [asc(schema.media.bytes), asc(schema.media.id)]
						: sort === "name"
							? [asc(schema.media.filename), asc(schema.media.id)]
							: [desc(schema.media.createdAt), desc(schema.media.id)]

		const filters = [
			eq(schema.media.userId, userId),
			// Derivatives are never listed: they are an implementation detail
			// of the originals, and showing them would double every row.
			isNull(schema.media.variant)
		]
		if (params?.kind) filters.push(eq(schema.media.kind, params.kind))

		const rows = await db
			.select()
			.from(schema.media)
			.where(and(...filters))
			.orderBy(...orderBy)

		const thumbs = await thumbsByParent(
			db,
			rows.map((r) => r.id)
		)
		const label = await attachmentLabels(rows)

		const res: Sockets.Media.List.Response = {
			media: rows.map((row) => ({
				...toClientMedia(row, { thumb: thumbs.get(row.id) ?? null }),
				createdAt:
					row.createdAt instanceof Date
						? row.createdAt.toISOString()
						: String(row.createdAt),
				hasThumbnail: thumbs.has(row.id),
				attachedTo: label(row)
			})),
			totalBytes: rows.reduce((sum, r) => sum + r.bytes, 0)
		}
		emitToUser("media:list", res)
		return res
	}
}

export const mediaRegenerateThumbnail: Handler<
	Sockets.Media.RegenerateThumbnail.Params,
	Sockets.Media.RegenerateThumbnail.Response
> = {
	event: "media:regenerateThumbnail",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const row = await getMedia(db, params.mediaId)
		if (!row || row.userId !== userId || row.variant) {
			throw new Error("Image not found.")
		}

		// Drop the existing derivative first — ensureThumbnail is a no-op when
		// one already exists, which is what makes it safe to call on every
		// upload but useless as a "redo this" button on its own.
		const existing = (await thumbsByParent(db, [row.id])).get(row.id)
		if (existing) await deleteMedia(db, existing.id)

		// Rotate the original's public address: its bytes are unchanged, but
		// what its `?v=thumb` form resolves to is not, and a browser may be
		// holding the old address with a year-long immutable cache.
		await rotateMediaUuid(db, row.id)
		const thumb = await ensureThumbnail(db, (await getMedia(db, row.id))!)
		const res: Sockets.Media.RegenerateThumbnail.Response = {
			mediaId: row.id,
			// Null when the source is already at or under the target size, or
			// when the encode failed — both are "the original serves", not an
			// error the user needs to act on.
			regenerated: !!thumb
		}
		emitToUser("media:regenerateThumbnail", res)
		await mediaList.handler(socket, {}, emitToUser)
		return res
	}
}

export const mediaSetVisibility: Handler<
	Sockets.Media.SetVisibility.Params,
	Sockets.Media.SetVisibility.Response
> = {
	event: "media:setVisibility",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const row = await getMedia(db, params.mediaId)
		if (!row || row.userId !== userId) throw new Error("Image not found.")
		if (
			params.visibility !== MediaVisibility.SCOPED &&
			params.visibility !== MediaVisibility.PRIVATE
		) {
			throw new Error("Unknown visibility.")
		}

		await db
			.update(schema.media)
			.set({ visibility: params.visibility })
			// A derivative inherits its original's permissions, so keeping the
			// stored value in step matters only for tidiness — but an
			// out-of-step row is the kind of thing that later reads as a bug.
			.where(eq(schema.media.id, row.id))
		await db
			.update(schema.media)
			.set({ visibility: params.visibility })
			.where(eq(schema.media.parentMediaId, row.id))

		const res: Sockets.Media.SetVisibility.Response = {
			mediaId: row.id,
			visibility: params.visibility
		}
		emitToUser("media:setVisibility", res)
		await mediaList.handler(socket, {}, emitToUser)
		return res
	}
}

export const mediaDelete: Handler<
	Sockets.Media.Delete.Params,
	Sockets.Media.Delete.Response
> = {
	event: "media:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const row = await getMedia(db, params.mediaId)
		if (!row || row.userId !== userId) throw new Error("Image not found.")

		await deleteMedia(db, row.id)

		// Clear the pointers we can see. A dangling pointer is tolerated by
		// design elsewhere, but leaving one we could have cleared would show
		// up immediately as a broken avatar.
		await db
			.update(schema.characters)
			.set({ avatarMediaId: null })
			.where(eq(schema.characters.avatarMediaId, row.id))
		await db
			.update(schema.personas)
			.set({ avatarMediaId: null })
			.where(eq(schema.personas.avatarMediaId, row.id))
		await db
			.update(schema.userSettings)
			.set({ backgroundMediaId: null })
			.where(eq(schema.userSettings.backgroundMediaId, row.id))

		const res: Sockets.Media.Delete.Response = { mediaId: row.id }
		emitToUser("media:delete", res)
		await mediaList.handler(socket, {}, emitToUser)
		return res
	}
}

export function registerMediaHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, mediaList, emitToUser)
	register(socket, mediaRegenerateThumbnail, emitToUser)
	register(socket, mediaSetVisibility, emitToUser)
	register(socket, mediaDelete, emitToUser)
}
