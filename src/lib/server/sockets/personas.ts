import { db } from "$lib/server/db"
import { readMedia, toClientMedia } from "$lib/server/media"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import * as fsPromises from "fs/promises"
import * as path from "path"
import {
	handlePersonaAvatarUpload,
	uploadPersonaGalleryImage,
	listPersonaGallery,
	deletePersonaGalleryImage,
	reorderPersonaGalleryImages,
	getPersonaDataDir
} from "../utils"
import type { Handler } from "$lib/shared/events"
import {
	parseCharacterCardFromBase64,
	embedCharacterCardInPng,
	getRobustSpecV3Data
} from "../utils/characterCardParser"
import { autoEnqueuePersona } from "$lib/server/embedding/vectorizationQueue"
import { canViewPersona } from "$lib/server/utils/sessionAccess"
import {
	resolveCardSource,
	cachedSearch,
	resolveNsfwParam
} from "$lib/server/cardSources"
import {
	CardSourceUnavailableError,
	CardSourceRateLimitedError
} from "$lib/server/cardSources/types"
import { hashCanonicalJson } from "$lib/server/utils/contentHash"
import { isValidUuid } from "$lib/server/utils/uuid"
import { syncLorebookBindingsForPersona } from "$lib/server/utils/characterBindingSync"
import { findOrCreateTagId } from "$lib/server/utils/tags"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import type { PgliteDatabase, PgliteTransaction } from "drizzle-orm/pglite"

type Executor =
	| PgliteDatabase<typeof schema>
	| PgliteTransaction<
			typeof schema,
			ExtractTablesWithRelations<typeof schema>
	  >

// Helper function to process tags for persona creation/update
async function processPersonaTags(
	personaId: number,
	tagNames: string[],
	userId: number,
	dbOrTx: Executor = db
) {
	// Without this, a caller supplying another user's personaId could still
	// attach its own tags to (or strip tags from) a persona it doesn't own,
	// even though the persona's own field update is already ownership-scoped
	// and would no-op for an unowned id.
	const persona = await dbOrTx.query.personas.findFirst({
		where: (p, { and, eq }) =>
			and(eq(p.id, personaId), eq(p.userId, userId)),
		columns: { id: true }
	})
	if (!persona) return

	// Get existing tags for this persona that belong to the user
	const existingPersonaTags = await dbOrTx.query.personaTags.findMany({
		where: eq(schema.personaTags.personaId, personaId),
		with: {
			tag: true
		}
	})

	// Filter to only tags that belong to this user
	const userPersonaTags = existingPersonaTags.filter(
		(pt) => pt.tag.userId === userId
	)
	const existingTagNames = userPersonaTags.map((pt) => pt.tag.name)

	// Normalize tag names for comparison
	const normalizedNewTags = (tagNames || [])
		.map((t) => t.trim())
		.filter((t) => t.length > 0)

	// Find tags to remove (exist in DB but not in new list)
	const tagsToRemove = userPersonaTags.filter(
		(pt) => !normalizedNewTags.includes(pt.tag.name)
	)

	// Find tags to add (exist in new list but not in DB)
	const tagsToAdd = normalizedNewTags.filter(
		(tagName) => !existingTagNames.includes(tagName)
	)

	// Remove tags that are no longer in the list
	if (tagsToRemove.length > 0) {
		const tagIdsToRemove = tagsToRemove.map((pt) => pt.tagId)
		await dbOrTx
			.delete(schema.personaTags)
			.where(
				and(
					eq(schema.personaTags.personaId, personaId),
					inArray(schema.personaTags.tagId, tagIdsToRemove)
				)
			)
	}

	// Add new tags — findOrCreateTagId adopts an existing case-insensitive
	// match instead of creating a duplicate.
	for (const tagName of tagsToAdd) {
		const tagId = await findOrCreateTagId(userId, tagName, dbOrTx)
		if (!tagId) continue
		await dbOrTx
			.insert(schema.personaTags)
			.values({
				personaId,
				tagId
			})
			.onConflictDoNothing()
	}
}

export const personasList: Handler<
	Sockets.Personas.List.Params,
	Sockets.Personas.List.Response
> = {
	event: "personas:list",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const personaList = await db.query.personas.findMany({
			columns: {
				id: true,
				name: true,
				avatarMediaId: true,
				isDefault: true,
				description: true,
				position: true,
				embeddingModel: true
			},
			with: {
				personaTags: {
					with: {
						tag: true
					}
				}
			},
			where: (p, { and, eq }) =>
				and(eq(p.userId, userId), eq(p.isDeleted, false))
		})
		const res: Sockets.Personas.List.Response = { personaList }
		emitToUser("personas:list", res)
		return res
	}
}

export const personasGet: Handler<
	Sockets.Personas.Get.Params,
	Sockets.Personas.Get.Response
> = {
	event: "personas:get",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const persona = await db.query.personas.findFirst({
			where: (p, { and, eq }) =>
				and(eq(p.id, params.id), eq(p.isDeleted, false)),
			// Unlike personasList (which already allowlists columns), this
			// findFirst had no columns restriction and spread the full row —
			// including the raw embedding vector — into the response.
			columns: {
				embedding: false,
				embeddingModel: false,
				vectorizedAt: false
			},
			with: {
				personaTags: {
					with: {
						tag: true
					}
				},
				user: {
					columns: { username: true, displayName: true }
				}
			}
		})

		const isOwner = persona?.userId === userId
		if (
			persona &&
			(isOwner || (await canViewPersona(persona.id, userId)))
		) {
			// Transform the persona data to include tags as string array
			const personaWithTags: any = {
				...persona,
				tags: persona.personaTags.map((pt) => pt.tag.name),
				isOwner,
				ownerName:
					persona.user?.displayName || persona.user?.username || null
			}
			delete personaWithTags.personaTags
			delete personaWithTags.user

			const res: Sockets.Personas.Get.Response = {
				persona: personaWithTags
			}
			emitToUser("personas:get", res)
			return res
		} else {
			const res: Sockets.Personas.Get.Response = { persona: null }
			emitToUser("personas:get", res)
			return res
		}
	}
}

export const personasCreate: Handler<
	Sockets.Personas.Create.Params,
	Sockets.Personas.Create.Response
> = {
	event: "personas:create",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const data = { ...params.persona }
			const tags = (data as any).tags || []

			// Remove fields that shouldn't be in the database insert
			delete (data as any).avatar // Remove avatar from persona data to avoid conflicts
			delete (data as any).tags // Remove tags - will be handled separately
			// uuid is reserved for the import path's stamp-or-fallback logic
			// (see createPersonaFromParsedData) — this generic create
			// handler always gets a fresh DB-generated uuid. id is likewise
			// client-overridable on an identity column. Both must always be
			// server-generated, same as personasUpdate already strips uuid
			// for the same reason.
			delete (data as any).uuid
			delete (data as any).id

			const [persona] = await db
				.insert(schema.personas)
				.values({ ...data, userId })
				.returning()

			// Process tags after persona creation
			if (tags.length > 0) {
				await processPersonaTags(persona.id, tags, userId)
			}

			if (params.avatarFile) {
				await handlePersonaAvatarUpload({
					persona,
					avatarFile: params.avatarFile
				})
			}

			autoEnqueuePersona(persona.id, persona.name).catch(console.error)
			await personasList.handler(socket, {}, emitToUser)
			const res: Sockets.Personas.Create.Response = { persona }
			emitToUser("personas:create", res)
			return res
		} catch (e: any) {
			console.error("Error creating persona:", e)
			emitToUser("personas:create:error", {
				error: e.message || String(e)
			})
			throw e
		}
	}
}

export const personasUpdate: Handler<
	Sockets.Personas.Update.Params,
	Sockets.Personas.Update.Response
> = {
	event: "personas:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const data = { ...params.persona }
			const id = data.id
			const userId = socket.user!.id
			const tags = (data as any).tags || []

			// Remove fields that shouldn't be in the database update
			if ("userId" in data) (data as any).userId = undefined
			if ("id" in data) (data as any).id = undefined
			delete (data as any).avatar // Remove avatar from persona data to avoid conflicts
			delete (data as any).tags // Remove tags - will be handled separately
			delete (data as any).createdAt
			delete (data as any).updatedAt
			delete (data as any).vectorizedAt
			delete (data as any).embedding
			delete (data as any).embeddingModel
			// lorebookId: no ownership check exists for it here (unlike sessions,
			// nothing currently reads a persona's own lorebookId for prompt
			// content), so blocking it outright is the correct minimal fix —
			// a future feature needing this should validate ownership first.
			// uuid is reserved for the import path — letting a client set it
			// directly here would silently break this user's own
			// import-dedup identity.
			delete (data as any).lorebookId
			delete (data as any).uuid

			const [updated] = await db
				.update(schema.personas)
				.set({
					...data,
					embedding: null,
					embeddingModel: null,
					vectorizedAt: null
				})
				.where(
					and(
						eq(schema.personas.id, id),
						eq(schema.personas.userId, userId)
					)
				)
				.returning()

			if (!updated) {
				throw new Error("Persona not found or not owned by user.")
			}

			// Process tags after persona update
			await processPersonaTags(id, tags, userId)

			if (params.avatarFile) {
				await handlePersonaAvatarUpload({
					persona: updated,
					avatarFile: params.avatarFile
				})
			}

			// Keep every bound lorebookBindings row's name/aliases in sync with
			// this persona's current name/aliases (decision 2, merge plan) — a
			// persona can be bound in multiple lorebooks. Cheap no-op if
			// nothing is bound.
			await syncLorebookBindingsForPersona(id)

			autoEnqueuePersona(id, updated.name).catch(console.error)
			await personasGet.handler(socket, { id }, emitToUser)
			await personasList.handler(socket, {}, emitToUser)
			const res: Sockets.Personas.Update.Response = { persona: updated }
			emitToUser("personas:update", res)
			return res
		} catch (e: any) {
			console.error("Error updating persona:", e)
			emitToUser("personas:update:error", {
				error: e.message || "Failed to update persona."
			})
			throw e
		}
	}
}

export const personasDelete: Handler<
	Sockets.Personas.Delete.Params,
	Sockets.Personas.Delete.Response
> = {
	event: "personas:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Soft delete the persona by setting isDeleted = true
		await db
			.update(schema.personas)
			.set({ isDeleted: true })
			.where(
				and(
					eq(schema.personas.id, params.id),
					eq(schema.personas.userId, userId)
				)
			)
		await personasList.handler(socket, {}, emitToUser)
		const res: Sockets.Personas.Delete.Response = {
			success: "Persona deleted successfully"
		}
		emitToUser("personas:delete", res)
		return res
	}
}

export const personasSearchLibrary: Handler<
	Sockets.Personas.SearchLibrary.Params,
	Sockets.Personas.SearchLibrary.Response
> = {
	event: "personas:searchLibrary",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const sourceId = params.source ?? "github-serenepub"
			const source = resolveCardSource(sourceId)
			if (!source.supports("persona")) {
				throw new CardSourceUnavailableError(
					`${source.label} does not support browsing personas`
				)
			}

			const nsfw = await resolveNsfwParam(userId)
			const { items, hasMore } = await cachedSearch(
				sourceId,
				{
					kind: "persona",
					searchTerm: params.searchTerm,
					category: params.category,
					nsfw,
					sort: params.sort,
					cursor: params.cursor
				},
				{ userId }
			)

			const res: Sockets.Personas.SearchLibrary.Response = {
				personas: items,
				hasMore,
				requestId: params.requestId
			}
			emitToUser("personas:searchLibrary", res)
			return res
		} catch (error: any) {
			console.error("Persona library search error:", error)
			emitToUser("personas:searchLibrary:error", {
				error:
					error instanceof CardSourceUnavailableError ||
					error instanceof CardSourceRateLimitedError
						? error.message
						: "Failed to search persona library",
				unreachable:
					error instanceof CardSourceUnavailableError || undefined,
				rateLimited:
					error instanceof CardSourceRateLimitedError || undefined,
				retryAfterMs:
					error instanceof CardSourceRateLimitedError
						? error.retryAfterMs
						: undefined,
				requestId: params.requestId
			})
			throw error
		}
	}
}

/**
 * Extracts a stable per-row uuid from a parsed persona card's V3 spec data,
 * if present. A malformed value (wrong shape/type — untrusted import data)
 * is treated as absent rather than passed through to a `uuid`-typed DB
 * column, where it would otherwise surface as a raw driver error.
 */
export function extractPersonaUuid(data: any): string | undefined {
	const uuid = data?.extensions?.serenepub?.uuid
	return isValidUuid(uuid) ? uuid : undefined
}

/**
 * Resolves the uuid a newly-created persona row should be stamped with —
 * mirrors claimIncomingCharacterUuid in characters.ts. `personas_uuid_idx`
 * is unique per-owner (userId, uuid); a same-user collision would already
 * have been caught by the caller's dedup lookup, so it's always safe to
 * fall back to a fresh uuid here.
 */
async function claimIncomingPersonaUuid(
	incomingUuid: string | undefined,
	userId: number,
	dbOrTx: Executor
): Promise<string | undefined> {
	if (!incomingUuid) return undefined
	const existing = await dbOrTx.query.personas.findFirst({
		where: and(
			eq(schema.personas.uuid, incomingUuid),
			eq(schema.personas.userId, userId)
		),
		columns: { id: true }
	})
	return existing ? undefined : incomingUuid
}

/**
 * Personas have no spec-format export/card-builder (no persona export
 * feature exists yet) — this is a small flat comparison shape used purely
 * for import-dedup hashing, not a portable file format.
 */
export function canonicalPersonaContent(persona: {
	name: string
	description: string
	creator: string | null
	category: string | null
}) {
	return {
		name: persona.name,
		description: persona.description,
		creator: persona.creator,
		category: persona.category
	}
}

/**
 * Flat, Serene-Pub-specific persona card shape used when a persona is
 * embedded into a lorebook export (extensions.serenepub.personas) — not a
 * spec format (personas have no standalone export/card-builder otherwise).
 */
export function buildPersonaExportCard(persona: {
	name: string
	description: string
	creator: string | null
	category: string | null
	aliases: string[] | null
	summary: string | null
	uuid: string
}) {
	return {
		name: persona.name,
		description: persona.description,
		creator: persona.creator || "",
		extensions: {
			serenepub: {
				uuid: persona.uuid,
				...(persona.category ? { category: persona.category } : {}),
				...(persona.aliases && persona.aliases.length > 0
					? { aliases: persona.aliases }
					: {}),
				...(persona.summary ? { summary: persona.summary } : {})
			}
		}
	}
}

export function personaFieldsFromParsedData(
	data: any
): Omit<InsertPersona, "userId" | "isDefault"> {
	// aliases/summary are read back from the same place buildPersonaExportCard
	// writes them — without this a Serene Pub persona loses both on its own
	// export/re-import round trip. Mirrors characterFieldsFromParsedData, which
	// also tolerates the un-namespaced `extensions.aliases` other tools use.
	const aliases =
		data.extensions?.serenepub?.aliases ?? data.extensions?.aliases
	return {
		name: data.name || "Unnamed Persona",
		description: data.description || "",
		creator: data.creator || null,
		aliases: Array.isArray(aliases) ? aliases : [],
		summary: data.extensions?.serenepub?.summary ?? null,
		category: data.extensions?.serenepub?.category ?? null
	}
}

/** Non-fatal problem from an import step that didn't invalidate the import. */
export type ImportWarning = string

/**
 * Applies the avatar to an already-inserted persona row.
 *
 * Non-fatal, mirroring applyAvatarAndTags in characters.ts and for the same
 * reason: this runs *after* the persona row is committed, and the avatar write
 * rejects anything over 10MB or not a recognized image — which persona cards
 * exported from SillyTavern hit routinely, since the card IS a
 * full-resolution PNG. Letting it throw reported "import failed" for a persona
 * that was already in the database and then showed up on the next refresh,
 * while the persona list was never told to update.
 */
async function applyPersonaAvatar(
	persona: typeof schema.personas.$inferSelect,
	avatarBuffer: Buffer | undefined,
	dbOrTx: Executor = db
): Promise<{
	persona: typeof schema.personas.$inferSelect
	warnings: ImportWarning[]
}> {
	const warnings: ImportWarning[] = []
	if (avatarBuffer) {
		try {
			await handlePersonaAvatarUpload({
				persona,
				avatarFile: avatarBuffer
			})
			const updatedPersona = await dbOrTx.query.personas.findFirst({
				where: eq(schema.personas.id, persona.id)
			})
			if (updatedPersona) Object.assign(persona, updatedPersona)
		} catch (e: any) {
			const reason = e?.message || String(e)
			console.warn(
				`Persona ${persona.id} imported without its avatar: ${reason}`
			)
			warnings.push(`The card's image could not be saved: ${reason}`)
		}
	}
	return { persona, warnings }
}

/**
 * @param warnings optional sink for non-fatal problems (an unusable avatar).
 * Out-param rather than a widened return type, so existing callers that only
 * want the persona are unaffected.
 */
export async function createPersonaFromParsedData(
	data: any,
	avatarBuffer: Buffer | undefined,
	userId: number,
	dbOrTx: Executor = db,
	warnings?: ImportWarning[]
) {
	const uuidToStamp = await claimIncomingPersonaUuid(
		extractPersonaUuid(data),
		userId,
		dbOrTx
	)
	const [persona] = await dbOrTx
		.insert(schema.personas)
		.values({
			...personaFieldsFromParsedData(data),
			...(uuidToStamp ? { uuid: uuidToStamp } : {}),
			userId,
			isDefault: false
		})
		.returning()
	const applied = await applyPersonaAvatar(persona, avatarBuffer, dbOrTx)
	warnings?.push(...applied.warnings)
	return applied.persona
}

export async function overwritePersonaFromParsedData(
	existingId: number,
	data: any,
	avatarBuffer: Buffer | undefined,
	dbOrTx: Executor = db,
	warnings?: ImportWarning[]
) {
	await dbOrTx
		.update(schema.personas)
		.set(personaFieldsFromParsedData(data))
		.where(eq(schema.personas.id, existingId))
	const persona = await dbOrTx.query.personas.findFirst({
		where: eq(schema.personas.id, existingId)
	})
	if (!persona) throw new Error("Persona not found.")
	const applied = await applyPersonaAvatar(persona, avatarBuffer, dbOrTx)
	warnings?.push(...applied.warnings)
	return applied.persona
}

/**
 * Rebuilds and emits the persona list after an import. Never throws — the
 * persona is already committed by this point, so a list-refresh failure must
 * not be reported as a failed import.
 */
async function refreshPersonaList(
	socket: any,
	emitToUser: any,
	warnings: ImportWarning[]
) {
	try {
		await personasList.handler(socket, {}, emitToUser)
	} catch (e: any) {
		const reason = e?.message || String(e)
		console.warn(`Persona list refresh after import failed: ${reason}`)
		warnings.push(
			"The persona list could not be refreshed — reload to see it."
		)
	}
}

export const personasImportCard: Handler<
	Sockets.Personas.ImportCard.Params,
	Sockets.Personas.ImportCard.Response
> = {
	event: "personas:importCard",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Parse persona card using shared utility
			const { card, avatarBuffer } = await parseCharacterCardFromBase64(
				params.file
			)

			// getRobustSpecV3Data (not a bare card.toSpecV3()) so older/V1
			// cards import with full fidelity — see its own doc comment.
			const data = getRobustSpecV3Data(card)

			const incomingUuid = extractPersonaUuid(data)

			if (incomingUuid) {
				const existing = await db.query.personas.findFirst({
					where: and(
						eq(schema.personas.uuid, incomingUuid),
						eq(schema.personas.userId, userId)
					)
				})

				if (existing) {
					const existingHash = hashCanonicalJson(
						canonicalPersonaContent(existing)
					)
					const incomingHash = hashCanonicalJson(
						canonicalPersonaContent(
							personaFieldsFromParsedData(data) as any
						)
					)

					if (existingHash === incomingHash) {
						const res: Sockets.Personas.ImportCard.Response = {
							status: "unchanged",
							persona: existing
						}
						emitToUser("personas:importCard", res)
						return res
					}

					const res: Sockets.Personas.ImportCard.Response = {
						status: "conflict",
						persona: null,
						conflict: {
							existingPersona: existing,
							file: params.file
						}
					}
					emitToUser("personas:importCard", res)
					return res
				}
			}

			const warnings: ImportWarning[] = []
			const persona = await createPersonaFromParsedData(
				data,
				avatarBuffer,
				userId,
				db,
				warnings
			)

			await refreshPersonaList(socket, emitToUser, warnings)
			const res: Sockets.Personas.ImportCard.Response = {
				status: "created",
				persona,
				...(warnings.length > 0 ? { warnings } : {})
			}
			emitToUser("personas:importCard", res)
			return res
		} catch (error: any) {
			console.error("Error importing persona card:", error)
			emitToUser("personas:importCard:error", {
				error: error.message || "Failed to import persona card."
			})
			throw error
		}
	}
}

/**
 * Carries out the user's choice after personas:importCard returned a
 * "conflict" status — either overwrite the existing (uuid-matched) persona
 * in place, or import the file as a brand-new persona with a fresh uuid.
 */
export const personasImportResolve: Handler<
	Sockets.Personas.ImportResolve.Params,
	Sockets.Personas.ImportResolve.Response
> = {
	event: "personas:importResolve",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { card, avatarBuffer } = await parseCharacterCardFromBase64(
				params.file
			)
			const data = getRobustSpecV3Data(card)

			const warnings: ImportWarning[] = []
			let persona
			if (params.action === "overwrite") {
				const existing = await db.query.personas.findFirst({
					where: and(
						eq(schema.personas.id, params.existingId),
						eq(schema.personas.userId, userId)
					),
					columns: { id: true }
				})
				if (!existing) throw new Error("Persona not found.")
				persona = await overwritePersonaFromParsedData(
					existing.id,
					data,
					avatarBuffer,
					db,
					warnings
				)
			} else {
				persona = await createPersonaFromParsedData(
					data,
					avatarBuffer,
					userId,
					db,
					warnings
				)
			}

			await refreshPersonaList(socket, emitToUser, warnings)

			const res: Sockets.Personas.ImportResolve.Response = {
				persona,
				...(warnings.length > 0 ? { warnings } : {})
			}
			emitToUser("personas:importResolve", res)
			return res
		} catch (error: any) {
			console.error("Error resolving persona import conflict:", error)
			emitToUser("personas:importResolve:error", {
				error: error.message || "Failed to resolve persona import."
			})
			throw error
		}
	}
}

export const personasExportCard: Handler<
	Sockets.Personas.ExportCard.Params,
	Sockets.Personas.ExportCard.Response
> = {
	event: "personas:exportCard",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const format = params.format || "json"

			// Owner-only (export is a data-extraction action) — mirrors
			// charactersExportCard's precedent exactly.
			const persona = await db.query.personas.findFirst({
				where: and(
					eq(schema.personas.id, params.id),
					eq(schema.personas.userId, userId)
				)
			})

			if (!persona) {
				throw new Error("Persona not found")
			}

			const cardData = buildPersonaExportCard(persona)

			if (format === "json") {
				const jsonString = JSON.stringify(cardData, null, 2)
				const blob = Buffer.from(jsonString, "utf-8")
				const filename = `${persona.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.v3.json`

				const res: Sockets.Personas.ExportCard.Response = {
					blob,
					filename
				}
				emitToUser("personas:exportCard", res)
				return res
			} else {
				// The card's primary image (28 §10): read straight from the
				// media row the avatar points at, rather than reconstructing a
				// filename from a path column that no longer exists.
				const avatar = persona.avatarMediaId
					? await readMedia(db, persona.avatarMediaId)
					: null
				if (!avatar) {
					throw new Error("Persona has no avatar to embed data into")
				}
				if (avatar.row.mime !== "image/png") {
					throw new Error(
						"This persona's avatar isn't a PNG, so it can't be used for PNG card export — try JSON export instead, or update the avatar to a PNG image first."
					)
				}

				const blob = embedCharacterCardInPng(avatar.bytes, cardData)
				const filename = `${persona.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.v3.png`

				const res: Sockets.Personas.ExportCard.Response = {
					blob,
					filename
				}
				emitToUser("personas:exportCard", res)
				return res
			}
		} catch (error: any) {
			console.error("Error exporting persona card:", error)
			emitToUser("personas:exportCard:error", {
				error: error.message || "Failed to export persona card."
			})
			throw error
		}
	}
}

export const personasImportFromLibrary: Handler<
	Sockets.Personas.ImportFromLibrary.Params,
	Sockets.Personas.ImportFromLibrary.Response
> = {
	event: "personas:importFromLibrary",
	handler: async (socket, params, emitToUser) => {
		try {
			const source = resolveCardSource(params.source)
			if (!source.supports("persona")) {
				throw new CardSourceUnavailableError(
					`${source.label} does not support browsing personas`
				)
			}
			const buffer = await source.getCardBytes(params.ref, {
				userId: socket.user!.id
			})
			const base64 = buffer.toString("base64")

			// Use the existing import handler
			const importResult = await personasImportCard.handler(
				socket,
				{ file: base64 },
				emitToUser
			)

			// Only reachable if this exact card (by its embedded uuid) somehow
			// already conflicts with one this user has — there's no
			// conflict-resolution UI wired up for the library-import path, so
			// surface it as a plain error rather than return a null persona.
			if (!importResult.persona) {
				throw new Error(
					"This card conflicts with one you already have — resolve it from the Personas panel instead."
				)
			}

			const res: Sockets.Personas.ImportFromLibrary.Response = {
				persona: importResult.persona
			}
			emitToUser("personas:importFromLibrary", res)
			return res
		} catch (error: any) {
			console.error("Persona import from library error:", error)
			emitToUser("personas:importFromLibrary:error", {
				error:
					error instanceof CardSourceUnavailableError ||
					error instanceof CardSourceRateLimitedError
						? error.message
						: "Failed to import persona from library"
			})
			throw error
		}
	}
}

export const personasListGallery: Handler<
	Sockets.Personas.ListGallery.Params,
	Sockets.Personas.ListGallery.Response
> = {
	event: "personas:listGallery",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const images = await listPersonaGallery({
				personaId: params.personaId,
				userId
			})
			const res: Sockets.Personas.ListGallery.Response = {
				images,
				personaId: params.personaId
			}
			emitToUser("personas:listGallery", res)
			return res
		} catch (error: any) {
			emitToUser("personas:listGallery:error", {
				error: error.message || "Failed to list gallery.",
				personaId: params.personaId
			})
			throw error
		}
	}
}

export const personasUploadGalleryImage: Handler<
	Sockets.Personas.UploadGalleryImage.Params,
	Sockets.Personas.UploadGalleryImage.Response
> = {
	event: "personas:uploadGalleryImage",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const persona = await db.query.personas.findFirst({
				where: (p, { and, eq }) =>
					and(eq(p.id, params.personaId), eq(p.userId, userId))
			})
			if (!persona) throw new Error("Persona not found or access denied")

			const uploaded = await uploadPersonaGalleryImage({
				personaId: params.personaId,
				userId,
				imageFile: Buffer.from(params.imageFile as Uint8Array)
			})

			const res: Sockets.Personas.UploadGalleryImage.Response = {
				success: true,
				media: toClientMedia(uploaded),
				personaId: params.personaId
			}
			emitToUser("personas:uploadGalleryImage", res)
			await personasListGallery.handler(
				socket,
				{ personaId: params.personaId },
				emitToUser
			)
			await personasGet.handler(
				socket,
				{ id: params.personaId },
				emitToUser
			)
			return res
		} catch (error: any) {
			emitToUser("personas:uploadGalleryImage:error", {
				error: error.message || "Failed to upload image.",
				personaId: params.personaId
			})
			throw error
		}
	}
}

export const personasDeleteGalleryImage: Handler<
	Sockets.Personas.DeleteGalleryImage.Params,
	Sockets.Personas.DeleteGalleryImage.Response
> = {
	event: "personas:deleteGalleryImage",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const persona = await db.query.personas.findFirst({
				where: (p, { and, eq }) =>
					and(eq(p.id, params.personaId), eq(p.userId, userId))
			})
			if (!persona) throw new Error("Persona not found or access denied")

			await deletePersonaGalleryImage({
				personaId: params.personaId,
				userId,
				mediaId: params.mediaId
			})

			const res: Sockets.Personas.DeleteGalleryImage.Response = {
				success: true,
				personaId: params.personaId
			}
			emitToUser("personas:deleteGalleryImage", res)
			await personasListGallery.handler(
				socket,
				{ personaId: params.personaId },
				emitToUser
			)
			return res
		} catch (error: any) {
			emitToUser("personas:deleteGalleryImage:error", {
				error: error.message || "Failed to delete image.",
				personaId: params.personaId
			})
			throw error
		}
	}
}

export const personasReorderGallery: Handler<
	Sockets.Personas.ReorderGallery.Params,
	Sockets.Personas.ReorderGallery.Response
> = {
	event: "personas:reorderGallery",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const persona = await db.query.personas.findFirst({
			where: (p, { and, eq }) =>
				and(eq(p.id, params.personaId), eq(p.userId, userId))
		})
		if (!persona) throw new Error("Persona not found or access denied")

		await reorderPersonaGalleryImages({
			personaId: params.personaId,
			mediaIds: params.mediaIds
		})

		const listRes = await personasListGallery.handler(
			socket,
			{ personaId: params.personaId },
			emitToUser
		)
		const res: Sockets.Personas.ReorderGallery.Response = listRes
		emitToUser("personas:reorderGallery", res)
		return res
	}
}

export const personasSetAvatar: Handler<
	Sockets.Personas.SetAvatar.Params,
	Sockets.Personas.SetAvatar.Response
> = {
	event: "personas:setAvatar",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const persona = await db.query.personas.findFirst({
			where: (p, { and, eq }) =>
				and(eq(p.id, params.personaId), eq(p.userId, userId))
		})
		if (!persona) throw new Error("Persona not found or access denied")

		// params.mediaId must be one of this persona's own media rows —
		// without this, the client could point avatar at an arbitrary
		// external URL, which every other viewer's browser would then fetch
		// directly (avatar isn't routed through the authenticated /images
		// proxy unless it happens to start with /images/...), bypassing the
		// per-viewer authorization that route exists to enforce.
		// Ownership check — see the equivalent in characters.ts for why the
		// old external-URL guard is no longer a concern.
		const owned = await db.query.media.findFirst({
			where: (m, { and, eq, isNull }) =>
				and(
					eq(m.id, params.mediaId),
					eq(m.personaId, params.personaId),
					isNull(m.variant)
				)
		})
		if (!owned) throw new Error("Invalid avatar image.")

		const [updated] = await db
			.update(schema.personas)
			.set({ avatarMediaId: params.mediaId })
			.where(
				and(
					eq(schema.personas.id, params.personaId),
					eq(schema.personas.userId, userId)
				)
			)
			.returning()

		const res: Sockets.Personas.SetAvatar.Response = { persona: updated }
		emitToUser("personas:setAvatar", res)
		await personasGet.handler(socket, { id: params.personaId }, emitToUser)
		return res
	}
}

export const personasSetDefault: Handler<
	Sockets.Personas.SetDefault.Params,
	Sockets.Personas.SetDefault.Response
> = {
	event: "personas:setDefault",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const persona = await db.query.personas.findFirst({
			where: (p, { and, eq }) =>
				and(eq(p.id, params.personaId), eq(p.userId, userId))
		})
		if (!persona) throw new Error("Persona not found or access denied")

		await db.transaction(async (tx) => {
			// Scoped to this user only — a bare "WHERE is_default = true"
			// here would clear every user's default on a multi-account
			// instance, not just the caller's.
			await tx
				.update(schema.personas)
				.set({ isDefault: false })
				.where(
					and(
						eq(schema.personas.userId, userId),
						eq(schema.personas.isDefault, true)
					)
				)
			await tx
				.update(schema.personas)
				.set({ isDefault: true })
				.where(
					and(
						eq(schema.personas.id, params.personaId),
						eq(schema.personas.userId, userId)
					)
				)
		})

		const res: Sockets.Personas.SetDefault.Response = { success: true }
		emitToUser("personas:setDefault", res)
		await personasList.handler(socket, {}, emitToUser)
		return res
	}
}

// Registration function for all persona handlers
export function registerPersonaHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, personasList, emitToUser)
	register(socket, personasGet, emitToUser)
	register(socket, personasCreate, emitToUser)
	register(socket, personasUpdate, emitToUser)
	register(socket, personasDelete, emitToUser)
	register(socket, personasImportCard, emitToUser)
	register(socket, personasImportResolve, emitToUser)
	register(socket, personasExportCard, emitToUser)
	register(socket, personasSearchLibrary, emitToUser)
	register(socket, personasImportFromLibrary, emitToUser)
	register(socket, personasListGallery, emitToUser)
	register(socket, personasUploadGalleryImage, emitToUser)
	register(socket, personasDeleteGalleryImage, emitToUser)
	register(socket, personasReorderGallery, emitToUser)
	register(socket, personasSetAvatar, emitToUser)
	register(socket, personasSetDefault, emitToUser)
}
