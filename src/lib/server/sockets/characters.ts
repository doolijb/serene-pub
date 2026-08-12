import { db } from "$lib/server/db"
import { and, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import * as fsPromises from "fs/promises"
import * as path from "path"
import {
	getCharacterDataDir,
	handleCharacterAvatarUpload,
	uploadCharacterGalleryImage,
	listCharacterGallery,
	deleteCharacterGalleryImage,
	reorderCharacterGalleryImages
} from "../utils"
import { CharacterCard, type SpecV3 } from "@lenml/char-card-reader"
import { fileTypeFromBuffer } from "file-type"
import type { Handler } from "$lib/shared/events"
import {
	parseCharacterCardFromBase64,
	buildCharacterCardV3,
	embedCharacterCardInPng,
	getRobustSpecV3Data
} from "../utils/characterCardParser"
import { autoEnqueueCharacter } from "$lib/server/embedding/vectorizationQueue"
import { canViewCharacter } from "$lib/server/utils/chatAccess"
import {
	resolveCardSource,
	cachedSearch,
	resolveNsfwParam
} from "$lib/server/cardSources"
import {
	CardSourceUnavailableError,
	CardSourceRateLimitedError
} from "$lib/server/cardSources/types"
import { withSupersession } from "$lib/server/cardSources/inFlightRequests"
import { buildLorebookExportData } from "$lib/server/utils/lorebookExportBuilder"
import { syncLorebookBindingsForCharacter } from "$lib/server/utils/characterBindingSync"
import { hashCanonicalJson } from "$lib/server/utils/contentHash"
import { isValidUuid } from "$lib/server/utils/uuid"
import { findOrCreateTagId } from "$lib/server/utils/tags"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import type { PgliteDatabase, PgliteTransaction } from "drizzle-orm/pglite"

type Executor =
	| PgliteDatabase<typeof schema>
	| PgliteTransaction<
			typeof schema,
			ExtractTablesWithRelations<typeof schema>
	  >

// Helper function to process tags for character creation/update. Tags are
// per-user (schema.tags.userId): lookups/creates must stay scoped to the
// calling user, both so one user's tag name never resolves to another
// user's tag row, and so a caller can never mutate tag associations on a
// character it doesn't own by supplying someone else's characterId — the
// resource-ownership check below guards that even though the actual
// character field update elsewhere is already ownership-scoped.
async function processCharacterTags(
	characterId: number,
	tagNames: string[],
	userId: number,
	dbOrTx: Executor = db
) {
	const character = await dbOrTx.query.characters.findFirst({
		where: (c, { and, eq }) =>
			and(eq(c.id, characterId), eq(c.userId, userId)),
		columns: { id: true }
	})
	if (!character) return

	// Get existing tags for this character that belong to the user
	const existingCharacterTags = await dbOrTx.query.characterTags.findMany({
		where: eq(schema.characterTags.characterId, characterId),
		with: { tag: true }
	})
	const userCharacterTags = existingCharacterTags.filter(
		(ct) => ct.tag.userId === userId
	)
	const existingTagNames = userCharacterTags.map((ct) => ct.tag.name)

	// Normalize tag names for comparison
	const normalizedNewTags = (tagNames || [])
		.map((t) => t.trim())
		.filter((t) => t.length > 0)

	// Find tags to remove (exist in DB but not in new list)
	const tagsToRemove = userCharacterTags.filter(
		(ct) => !normalizedNewTags.includes(ct.tag.name)
	)

	// Find tags to add (exist in new list but not in DB)
	const tagsToAdd = normalizedNewTags.filter(
		(tagName) => !existingTagNames.includes(tagName)
	)

	// Remove tags that are no longer in the list
	if (tagsToRemove.length > 0) {
		const tagIdsToRemove = tagsToRemove.map((ct) => ct.tagId)
		await dbOrTx
			.delete(schema.characterTags)
			.where(
				and(
					eq(schema.characterTags.characterId, characterId),
					inArray(schema.characterTags.tagId, tagIdsToRemove)
				)
			)
	}

	// Add new tags — findOrCreateTagId adopts an existing case-insensitive
	// match instead of creating a duplicate.
	for (const tagName of tagsToAdd) {
		const tagId = await findOrCreateTagId(userId, tagName, dbOrTx)
		if (!tagId) continue
		await dbOrTx
			.insert(schema.characterTags)
			.values({
				characterId,
				tagId
			})
			.onConflictDoNothing() // In case of race conditions
	}
}

export const charactersList: Handler<
	Sockets.Characters.List.Params,
	Sockets.Characters.List.Response
> = {
	event: "characters:list",
	handler: async (socket, params, emitToUser) => {
		const characterList = await db.query.characters.findMany({
			columns: {
				id: true,
				name: true,
				nickname: true,
				avatar: true,
				isFavorite: true,
				description: true,
				creatorNotes: true,
				embeddingModel: true
			},
			with: {
				characterTags: {
					with: {
						tag: true
					}
				}
			},
			where: (c, { and, eq }) =>
				and(eq(c.userId, socket.user!.id), eq(c.isDeleted, false)),
			orderBy: (c, { asc }) => asc(c.id)
		})
		const res: Sockets.Characters.List.Response = { characterList }
		emitToUser("characters:list", res)
		return res
	}
}

export const charactersGet: Handler<
	Sockets.Characters.Get.Params,
	Sockets.Characters.Get.Response
> = {
	event: "characters:get",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const character = await db.query.characters.findFirst({
			where: (c, { and, eq }) =>
				and(eq(c.id, params.id), eq(c.isDeleted, false)),
			// Unlike charactersList (which already allowlists columns), this
			// findFirst had no columns restriction and spread the full row —
			// including the raw embedding vector — into the response.
			columns: {
				embedding: false,
				embeddingModel: false,
				vectorizedAt: false
			},
			with: {
				characterTags: {
					with: {
						tag: true
					}
				},
				user: {
					columns: { username: true, displayName: true }
				}
			}
		})

		const isOwner = character?.userId === userId
		if (
			character &&
			(isOwner || (await canViewCharacter(character.id, userId)))
		) {
			// Transform the character data to include tags as string array
			const characterWithTags = {
				...character,
				tags: character.characterTags.map((ct) => ct.tag.name),
				isOwner,
				ownerName:
					character.user?.displayName ||
					character.user?.username ||
					null
			}
			const { characterTags, user, ...characterWithoutTags } =
				characterWithTags

			const res: Sockets.Characters.Get.Response = {
				character: characterWithoutTags
			}
			emitToUser("characters:get", res)
			return res
		}
		const res: Sockets.Characters.Get.Response = { character: null }
		emitToUser("characters:get", res)
		return res
	}
}

export const charactersCreate: Handler<
	Sockets.Characters.Create.Params,
	Sockets.Characters.Create.Response
> = {
	event: "characters:create",
	handler: async (socket, params, emitToUser) => {
		try {
			const data = { ...params.character }
			const tags = (data as any).tags || []

			// Remove fields that shouldn't be in the database insert
			// @ts-ignore - Remove avatar from character data to avoid conflicts
			delete data.avatar
			// @ts-ignore - Remove tags - will be handled separately
			delete (data as any).tags
			// uuid carries a table-wide (not per-user) unique index — a
			// client-supplied value could collide with another user's row,
			// permanently blocking their future import of that exact card.
			// id is likewise client-overridable on an identity column. Both
			// must always be server-generated, same as charactersUpdate
			// already strips uuid for the same reason.
			delete (data as any).uuid
			delete (data as any).id

			const [character] = await db
				.insert(schema.characters)
				.values({ ...data, userId: socket.user!.id })
				.returning()

			// Process tags after character creation
			if (tags.length > 0) {
				await processCharacterTags(character.id, tags, socket.user!.id)
			}

			if (params.avatarFile) {
				await handleCharacterAvatarUpload({
					character,
					avatarFile: params.avatarFile
				})
			}

			autoEnqueueCharacter(character.id, character.name).catch(
				console.error
			)
			await charactersList.handler(socket, {}, emitToUser)

			const res: Sockets.Characters.Create.Response = { character }
			emitToUser("characters:create", res)
			return res
		} catch (e: any) {
			console.error("Error creating character:", e)
			emitToUser("characters:create:error", {
				error: e.message || "Failed to create character."
			})
			throw e
		}
	}
}

export const charactersUpdate: Handler<
	Sockets.Characters.Update.Params,
	Sockets.Characters.Update.Response
> = {
	event: "characters:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const data = { ...params.character }
			const id = data.id
			const userId = socket.user!.id
			const tags = (data as any).tags || []

			// Remove fields that shouldn't be in the database update
			if ("userId" in data) (data as any).userId = undefined
			if ("id" in data) (data as any).id = undefined
			// @ts-ignore - Remove avatar from character data to avoid conflicts
			delete data.avatar
			// @ts-ignore - Remove tags - will be handled separately
			delete (data as any).tags
			delete (data as any).createdAt
			delete (data as any).updatedAt
			delete (data as any).vectorizedAt
			delete (data as any).embedding
			delete (data as any).embeddingModel
			// lorebookId: no ownership check exists for it here (unlike chats,
			// nothing currently reads a character's own lorebookId for prompt
			// content), so blocking it outright is the correct minimal fix —
			// a future feature needing this should validate ownership first.
			// uuid: table-wide unique index, not per-user — a client-supplied
			// collision would throw on someone else's row, and otherwise lets
			// a user silently break their own import-dedup identity.
			delete (data as any).lorebookId
			delete (data as any).uuid

			const [updated] = await db
				.update(schema.characters)
				.set({
					...data,
					embedding: null,
					embeddingModel: null,
					vectorizedAt: null
				})
				.where(
					and(
						eq(schema.characters.id, id),
						eq(schema.characters.userId, userId)
					)
				)
				.returning()

			if (!updated) {
				throw new Error("Character not found or not owned by user.")
			}

			// Process tags after character update
			await processCharacterTags(id, tags, userId)

			if (params.avatarFile) {
				await handleCharacterAvatarUpload({
					character: updated,
					avatarFile: params.avatarFile
				})
			}

			// Keep every bound lorebookBindings row's name/aliases in sync with
			// this character's current name/nickname/aliases (decision 2, merge
			// plan) — a character can be bound in multiple lorebooks, so this
			// isn't scoped to one. Cheap no-op if nothing is bound.
			await syncLorebookBindingsForCharacter(id)

			autoEnqueueCharacter(id, updated.name).catch(console.error)
			const res: Sockets.Characters.Update.Response = {
				character: updated
			}
			await charactersList.handler(socket, {}, emitToUser)
			emitToUser("characters:update", res)
			return res
		} catch (e: any) {
			console.error("Error updating character:", e)
			emitToUser("characters:update:error", {
				error: e.message || "Failed to update character."
			})
			throw e
		}
	}
}

export const charactersDelete: Handler<
	Sockets.Characters.Delete.Params,
	Sockets.Characters.Delete.Response
> = {
	event: "characters:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Soft delete, mirroring personasDelete exactly — a real DELETE here
		// cascades chatMessages.characterId -> SET NULL with no name
		// snapshot, so every historical message this character ever
		// authored would permanently fall back to the generic "assistant"
		// label (resolveCharacterName()) the moment the row was gone. Soft
		// delete keeps the row (and its name/nickname) around so that
		// resolution keeps working, while charactersList/charactersGet hide
		// it going forward. The avatar directory is deliberately NOT removed
		// either, for the same reason personasDelete doesn't remove a
		// persona's — old chat messages may still render this character's
		// avatar.
		await db
			.update(schema.characters)
			.set({ isDeleted: true })
			.where(
				and(
					eq(schema.characters.id, params.id),
					eq(schema.characters.userId, userId)
				)
			)

		await charactersList.handler(socket, {}, emitToUser)

		// Emit the delete event
		const res: Sockets.Characters.Delete.Response = {
			success: "Character deleted successfully"
		}
		emitToUser("characters:delete", res)
		return res
	}
}

/**
 * Extracts a stable per-row uuid from a parsed character card's V3 spec
 * data, if present. A malformed value (wrong shape/type — untrusted import
 * data) is treated as absent rather than passed through to a `uuid`-typed
 * DB column, where it would otherwise surface as a raw driver error.
 */
export function extractCharacterUuid(data: any): string | undefined {
	const uuid = data?.extensions?.serenepub?.uuid
	return isValidUuid(uuid) ? uuid : undefined
}

/**
 * Resolves the uuid a newly-created character row should be stamped with.
 * `characters_uuid_idx` is unique per-owner (userId, uuid), so an incoming
 * uuid is only safe to stamp if this same user doesn't already have a row
 * with it — if they do, that row would have been found by the caller's own
 * dedup lookup already, so reaching here with a same-user collision would
 * mean stamping a duplicate; falling back to a fresh uuid is always safe.
 */
async function claimIncomingCharacterUuid(
	incomingUuid: string | undefined,
	userId: number,
	dbOrTx: Executor
): Promise<string | undefined> {
	if (!incomingUuid) return undefined
	const existing = await dbOrTx.query.characters.findFirst({
		where: and(
			eq(schema.characters.uuid, incomingUuid),
			eq(schema.characters.userId, userId)
		),
		columns: { id: true }
	})
	return existing ? undefined : incomingUuid
}

export function characterFieldsFromParsedData(
	data: any
): Omit<typeof schema.characters.$inferInsert, "userId" | "isFavorite"> {
	return {
		name: data.name || "Unnamed Character",
		nickname: data.nickname || null,
		description: data.description || "",
		personality: data.personality || null,
		scenario: data.scenario || null,
		firstMessage: data.first_mes || null,
		exampleDialogues: data.mes_example
			? Array.isArray(data.mes_example)
				? data.mes_example
				: [data.mes_example]
			: undefined,
		alternateGreetings: data.alternate_greetings || null,
		creatorNotes: data.creator_notes || null,
		postHistoryInstructions: data.post_history_instructions || null,
		characterVersion: data.character_version || null,
		creator: data.creator || null,
		source: Array.isArray(data.extensions?.source)
			? data.extensions.source
			: [],
		groupOnlyGreetings: Array.isArray(data.extensions?.group_only_greetings)
			? data.extensions.group_only_greetings
			: null,
		aliases: Array.isArray(
			data.extensions?.serenepub?.aliases ?? data.extensions?.aliases
		)
			? (data.extensions?.serenepub?.aliases ?? data.extensions?.aliases)
			: [],
		summary: data.extensions?.serenepub?.summary ?? null,
		category: data.extensions?.serenepub?.category ?? null
	}
}

async function applyAvatarAndTags(
	character: typeof schema.characters.$inferSelect,
	avatarBuffer: Buffer | undefined,
	tags: string[] | undefined,
	userId: number,
	dbOrTx: Executor = db
) {
	if (avatarBuffer) {
		await handleCharacterAvatarUpload({
			character,
			avatarFile: avatarBuffer
		})
		const updatedCharacter = await dbOrTx.query.characters.findFirst({
			where: eq(schema.characters.id, character.id)
		})
		if (updatedCharacter) Object.assign(character, updatedCharacter)
	}
	if (tags && tags.length > 0) {
		await processCharacterTags(character.id, tags, userId, dbOrTx)
	}
	return character
}

/** Creates a brand-new character (+ avatar/tags) from parsed V3 spec data. */
export async function createCharacterFromParsedData(
	data: any,
	avatarBuffer: Buffer | undefined,
	userId: number,
	dbOrTx: Executor = db
) {
	const uuidToStamp = await claimIncomingCharacterUuid(
		extractCharacterUuid(data),
		userId,
		dbOrTx
	)
	const [character] = await dbOrTx
		.insert(schema.characters)
		.values({
			...characterFieldsFromParsedData(data),
			...(uuidToStamp ? { uuid: uuidToStamp } : {}),
			userId,
			isFavorite: false
		})
		.returning()
	return applyAvatarAndTags(
		character,
		avatarBuffer,
		data.tags,
		userId,
		dbOrTx
	)
}

/**
 * Overwrites an existing character's fields (+ avatar/tags) wholesale from
 * parsed V3 spec data — the "Overwrite" choice after an import conflict.
 */
export async function overwriteCharacterFromParsedData(
	existingId: number,
	data: any,
	avatarBuffer: Buffer | undefined,
	userId: number,
	dbOrTx: Executor = db
) {
	await dbOrTx
		.update(schema.characters)
		.set(characterFieldsFromParsedData(data))
		.where(eq(schema.characters.id, existingId))
	const character = await dbOrTx.query.characters.findFirst({
		where: eq(schema.characters.id, existingId)
	})
	if (!character) throw new Error("Character not found.")
	return applyAvatarAndTags(
		character,
		avatarBuffer,
		data.tags,
		userId,
		dbOrTx
	)
}

/**
 * Spec-shaped `data` for an existing character (+ its tags), built the same
 * way charactersExportCard would — used to hash-compare against an
 * incoming import's own spec data. `character_book` is deliberately never
 * set here (a character's lorebook has its own independent uuid/hash
 * tracked separately), so it must also be stripped from the incoming side
 * before comparing, or an exported-with-lorebook character would always
 * look "changed".
 */
export async function buildExistingCharacterComparisonData(
	characterId: number,
	dbOrTx: Executor = db
) {
	const character = await dbOrTx.query.characters.findFirst({
		where: eq(schema.characters.id, characterId),
		with: { characterTags: { with: { tag: true } } }
	})
	if (!character) return null
	const built = buildCharacterCardV3({
		...character,
		tags: character.characterTags?.map((ct) => ct.tag.name) || []
	})
	return { character, comparisonData: built.data }
}

export const charactersImportCard: Handler<
	Sockets.Characters.ImportCard.Params,
	Sockets.Characters.ImportCard.Response
> = {
	event: "characters:importCard",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Parse character card using shared utility
			const { card, avatarBuffer, lorebook } =
				await parseCharacterCardFromBase64(params.file)

			// getRobustSpecV3Data (not a bare card.toSpecV3()) so older/V1
			// cards import with full fidelity — see its own doc comment.
			const data = getRobustSpecV3Data(card)

			const incomingUuid = extractCharacterUuid(data)

			if (incomingUuid) {
				const existing = await db.query.characters.findFirst({
					where: and(
						eq(schema.characters.uuid, incomingUuid),
						eq(schema.characters.userId, userId)
					),
					columns: { id: true }
				})

				if (existing) {
					const existingComparison =
						await buildExistingCharacterComparisonData(existing.id)
					if (existingComparison) {
						const { character_book, ...incomingForHash } =
							data as any
						const existingHash = hashCanonicalJson(
							existingComparison.comparisonData
						)
						const incomingHash = hashCanonicalJson(incomingForHash)

						if (existingHash === incomingHash) {
							const res: Sockets.Characters.ImportCard.Response =
								{
									status: "unchanged",
									character: existingComparison.character,
									book: lorebook ?? null
								}
							emitToUser("characters:importCard", res)
							return res
						}

						const res: Sockets.Characters.ImportCard.Response = {
							status: "conflict",
							character: null,
							book: null,
							conflict: {
								existingCharacter: existingComparison.character,
								file: params.file
							}
						}
						emitToUser("characters:importCard", res)
						return res
					}
				}
			}

			const character = await createCharacterFromParsedData(
				data,
				avatarBuffer,
				userId
			)

			await charactersList.handler(socket, {}, emitToUser)

			const res: Sockets.Characters.ImportCard.Response = {
				status: "created",
				character,
				book: lorebook ?? null
			}
			emitToUser("characters:importCard", res)
			return res
		} catch (e: any) {
			console.error("Error importing character card:", e)
			emitToUser("characters:importCard:error", {
				error: e.message || "Failed to import character card."
			})
			throw e
		}
	}
}

/**
 * Carries out the user's choice after characters:importCard returned a
 * "conflict" status — either overwrite the existing (uuid-matched)
 * character in place, or import the file as a brand-new character with a
 * fresh uuid.
 */
export const charactersImportResolve: Handler<
	Sockets.Characters.ImportResolve.Params,
	Sockets.Characters.ImportResolve.Response
> = {
	event: "characters:importResolve",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const { card, avatarBuffer, lorebook } =
				await parseCharacterCardFromBase64(params.file)
			const data = getRobustSpecV3Data(card)

			let character
			if (params.action === "overwrite") {
				const existing = await db.query.characters.findFirst({
					where: and(
						eq(schema.characters.id, params.existingId),
						eq(schema.characters.userId, userId)
					),
					columns: { id: true }
				})
				if (!existing) throw new Error("Character not found.")
				character = await overwriteCharacterFromParsedData(
					existing.id,
					data,
					avatarBuffer,
					userId
				)
			} else {
				character = await createCharacterFromParsedData(
					data,
					avatarBuffer,
					userId
				)
			}

			await charactersList.handler(socket, {}, emitToUser)

			const res: Sockets.Characters.ImportResolve.Response = {
				character,
				book: lorebook ?? null
			}
			emitToUser("characters:importResolve", res)
			return res
		} catch (error: any) {
			console.error("Error resolving character import conflict:", error)
			emitToUser("characters:importResolve:error", {
				error: error.message || "Failed to resolve character import."
			})
			throw error
		}
	}
}

export const charactersSearchLibrary: Handler<
	Sockets.Characters.SearchLibrary.Params,
	// | undefined: a superseded request (see withSupersession below)
	// resolves with no response at all rather than throwing — honestly
	// widened here rather than suppressed with `as any`, since register()
	// (sockets/index.ts) never actually reads a handler's resolved value.
	Sockets.Characters.SearchLibrary.Response | undefined
> = {
	event: "characters:searchLibrary",
	handler: async (socket, params, emitToUser) => {
		return withSupersession(
			socket.id,
			"characters:searchLibrary",
			async (signal) => {
				try {
					const userId = socket.user!.id
					const sourceId = params.source ?? "github-serenepub"
					const source = resolveCardSource(sourceId)
					if (!source.supports("character")) {
						throw new CardSourceUnavailableError(
							`${source.label} does not support browsing characters`
						)
					}

					const nsfw = await resolveNsfwParam(userId)
					const { items, hasMore, nextOffset } = await cachedSearch(
						sourceId,
						{
							kind: "character",
							searchTerm: params.searchTerm,
							category: params.category,
							nsfw,
							sort: params.sort,
							hasBook: params.hasBook,
							creatorFilter: params.creatorFilter,
							cursor: params.cursor
						},
						{ userId, signal }
					)

					const res: Sockets.Characters.SearchLibrary.Response = {
						characters: items,
						hasMore,
						nextOffset,
						requestId: params.requestId
					}
					emitToUser("characters:searchLibrary", res)
					return res
				} catch (error: any) {
					if (signal.aborted) {
						// Superseded by a newer search from this same socket — the
						// client already only cares about the newest requestId (see
						// +page.svelte's staleness guard), so a superseded request's
						// response was always going to be thrown away even before
						// this fix — this just also stops spending rate-limit
						// budget on producing it. Routine, not worth logging.
						return undefined
					}
					console.error("Character library search error:", error)
					emitToUser("characters:searchLibrary:error", {
						error:
							error instanceof CardSourceUnavailableError ||
							error instanceof CardSourceRateLimitedError
								? error.message
								: "Failed to search character library",
						unreachable:
							error instanceof CardSourceUnavailableError ||
							undefined,
						rateLimited:
							error instanceof CardSourceRateLimitedError ||
							undefined,
						retryAfterMs:
							error instanceof CardSourceRateLimitedError
								? error.retryAfterMs
								: undefined,
						requestId: params.requestId
					})
					throw error
				}
			}
		)
	}
}

export const charactersImportFromLibrary: Handler<
	Sockets.Characters.ImportFromLibrary.Params,
	Sockets.Characters.ImportFromLibrary.Response
> = {
	event: "characters:importFromLibrary",
	handler: async (socket, params, emitToUser) => {
		try {
			const source = resolveCardSource(params.source)
			if (!source.supports("character")) {
				throw new CardSourceUnavailableError(
					`${source.label} does not support browsing characters`
				)
			}
			const buffer = await source.getCardBytes(params.ref, {
				userId: socket.user!.id
			})
			const base64 = buffer.toString("base64")

			// Use the existing import handler
			const importResult = await charactersImportCard.handler(
				socket,
				{ file: base64 },
				emitToUser
			)

			// Only reachable if this exact card (by its embedded uuid) somehow
			// already conflicts with one this user has — there's no
			// conflict-resolution UI wired up for the library-import path, so
			// surface it as a plain error rather than return a null character.
			if (!importResult.character) {
				throw new Error(
					"This card conflicts with one you already have — resolve it from the Characters panel instead."
				)
			}

			const res: Sockets.Characters.ImportFromLibrary.Response = {
				character: importResult.character,
				book: importResult.book
			}
			emitToUser("characters:importFromLibrary", res)
			return res
		} catch (error: any) {
			console.error("Character import from library error:", error)
			emitToUser("characters:importFromLibrary:error", {
				error:
					error instanceof CardSourceUnavailableError ||
					error instanceof CardSourceRateLimitedError
						? error.message
						: "Failed to import character from library"
			})
			throw error
		}
	}
}

export const charactersExportCard: Handler<
	Sockets.Characters.ExportCard.Params,
	Sockets.Characters.ExportCard.Response
> = {
	event: "characters:exportCard",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const format = params.format || "json"

			// Fetch the character with all its data — owner-only (export is a
			// data-extraction action, unlike viewing a character in a shared
			// chat, so this deliberately does NOT use canViewCharacter).
			const character = await db.query.characters.findFirst({
				where: and(
					eq(schema.characters.id, params.id),
					eq(schema.characters.userId, userId)
				),
				with: {
					characterTags: {
						with: {
							tag: true
						}
					}
				}
			})

			if (!character) {
				throw new Error("Character not found")
			}

			// Embedding a lorebook is optional — only when the caller picked
			// one from this character's own binding list (verified below, not
			// just trusted from the client), matching the "whole shared book"
			// scope decision: every world/character/history entry in the book
			// is included, not just entries scoped to this one character —
			// and, per the same scope decision, its bindings and narrative
			// graph now come along too (see the merge plan's decision 5).
			// Reuses buildLorebookExportData — the exact function backing the
			// lorebook's own export handler — instead of a bespoke bare
			// buildSpecV3Lorebook() call, which used to silently drop every
			// character-lore entry's privacy binding and all graph data on
			// this path specifically.
			let lorebook: SpecV3.Lorebook | undefined
			if (params.lorebookId) {
				const binding = await db.query.lorebookBindings.findFirst({
					where: and(
						eq(
							schema.lorebookBindings.lorebookId,
							params.lorebookId
						),
						eq(schema.lorebookBindings.characterId, params.id)
					)
				})
				if (!binding) {
					throw new Error(
						"That lorebook isn't bound to this character."
					)
				}
				const { specBookWithGraph } = await buildLorebookExportData(
					params.lorebookId,
					userId
				)
				lorebook = specBookWithGraph as unknown as SpecV3.Lorebook
			}

			const charCardData = buildCharacterCardV3({
				...character,
				tags: character.characterTags?.map((ct) => ct.tag.name) || [],
				lorebook
			})

			if (format === "json") {
				// Export as JSON
				const jsonString = JSON.stringify(charCardData, null, 2)
				const blob = Buffer.from(jsonString, "utf-8")
				const filename = `${character.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.v3.json`

				const res: Sockets.Characters.ExportCard.Response = {
					blob,
					filename
				}
				emitToUser("characters:exportCard", res)
				return res
			} else {
				// Export as PNG with embedded data
				if (!character.avatar) {
					throw new Error(
						"Character has no avatar to embed data into"
					)
				}

				// Read the avatar file
				const avatarDir = getCharacterDataDir({
					characterId: params.id,
					userId
				})
				// Extract just the filename from the avatar path (it may contain full path)
				const avatarFilename = path.basename(character.avatar)
				// Stored avatars aren't guaranteed to be PNGs (jpg/webp/gif are
				// all valid per ALLOWED_IMAGE_EXTENSIONS) — embedCharacterCardInPng
				// would otherwise throw the PNG library's opaque "Invalid .png
				// file header" for those, with no indication of why to the user.
				if (path.extname(avatarFilename).toLowerCase() !== ".png") {
					throw new Error(
						"This character's avatar isn't a PNG, so it can't be used for PNG card export — try JSON export instead, or update the avatar to a PNG image first."
					)
				}
				const avatarPath = path.join(avatarDir, avatarFilename)
				const avatarBuffer = await fsPromises.readFile(avatarPath)

				const blob = embedCharacterCardInPng(avatarBuffer, charCardData)
				const filename = `${character.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.v3.png`

				const res: Sockets.Characters.ExportCard.Response = {
					blob,
					filename
				}
				emitToUser("characters:exportCard", res)
				return res
			}
		} catch (error: any) {
			console.error("Error exporting character card:", error)
			emitToUser("characters:exportCard:error", {
				error: error.message || "Failed to export character card."
			})
			throw error
		}
	}
}

export const charactersListGallery: Handler<
	Sockets.Characters.ListGallery.Params,
	Sockets.Characters.ListGallery.Response
> = {
	event: "characters:listGallery",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const images = await listCharacterGallery({
				characterId: params.characterId,
				userId
			})
			const res: Sockets.Characters.ListGallery.Response = {
				images,
				characterId: params.characterId
			}
			emitToUser("characters:listGallery", res)
			return res
		} catch (error: any) {
			emitToUser("characters:listGallery:error", {
				error: error.message || "Failed to list gallery.",
				characterId: params.characterId
			})
			throw error
		}
	}
}

export const charactersUploadGalleryImage: Handler<
	Sockets.Characters.UploadGalleryImage.Params,
	Sockets.Characters.UploadGalleryImage.Response
> = {
	event: "characters:uploadGalleryImage",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const character = await db.query.characters.findFirst({
				where: (c, { and, eq }) =>
					and(eq(c.id, params.characterId), eq(c.userId, userId))
			})
			if (!character)
				throw new Error("Character not found or access denied")

			const imgPath = await uploadCharacterGalleryImage({
				characterId: params.characterId,
				userId,
				imageFile: Buffer.from(params.imageFile as Uint8Array),
				mimeType: params.mimeType
			})

			const res: Sockets.Characters.UploadGalleryImage.Response = {
				success: true,
				path: imgPath,
				characterId: params.characterId
			}
			emitToUser("characters:uploadGalleryImage", res)
			await charactersListGallery.handler(
				socket,
				{ characterId: params.characterId },
				emitToUser
			)
			await charactersGet.handler(
				socket,
				{ id: params.characterId },
				emitToUser
			)
			return res
		} catch (error: any) {
			emitToUser("characters:uploadGalleryImage:error", {
				error: error.message || "Failed to upload image.",
				characterId: params.characterId
			})
			throw error
		}
	}
}

export const charactersDeleteGalleryImage: Handler<
	Sockets.Characters.DeleteGalleryImage.Params,
	Sockets.Characters.DeleteGalleryImage.Response
> = {
	event: "characters:deleteGalleryImage",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id
			const character = await db.query.characters.findFirst({
				where: (c, { and, eq }) =>
					and(eq(c.id, params.characterId), eq(c.userId, userId))
			})
			if (!character)
				throw new Error("Character not found or access denied")

			await deleteCharacterGalleryImage({
				characterId: params.characterId,
				userId,
				path: params.path
			})

			const res: Sockets.Characters.DeleteGalleryImage.Response = {
				success: true,
				characterId: params.characterId
			}
			emitToUser("characters:deleteGalleryImage", res)
			await charactersListGallery.handler(
				socket,
				{ characterId: params.characterId },
				emitToUser
			)
			return res
		} catch (error: any) {
			emitToUser("characters:deleteGalleryImage:error", {
				error: error.message || "Failed to delete image.",
				characterId: params.characterId
			})
			throw error
		}
	}
}

export const charactersReorderGallery: Handler<
	Sockets.Characters.ReorderGallery.Params,
	Sockets.Characters.ReorderGallery.Response
> = {
	event: "characters:reorderGallery",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const character = await db.query.characters.findFirst({
			where: (c, { and, eq }) =>
				and(eq(c.id, params.characterId), eq(c.userId, userId))
		})
		if (!character) throw new Error("Character not found or access denied")

		await reorderCharacterGalleryImages({
			characterId: params.characterId,
			paths: params.paths
		})

		const listRes = await charactersListGallery.handler(
			socket,
			{ characterId: params.characterId },
			emitToUser
		)
		const res: Sockets.Characters.ReorderGallery.Response = listRes
		emitToUser("characters:reorderGallery", res)
		return res
	}
}

export const charactersSetAvatar: Handler<
	Sockets.Characters.SetAvatar.Params,
	Sockets.Characters.SetAvatar.Response
> = {
	event: "characters:setAvatar",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const character = await db.query.characters.findFirst({
			where: (c, { and, eq }) =>
				and(eq(c.id, params.characterId), eq(c.userId, userId))
		})
		if (!character) throw new Error("Character not found or access denied")

		// params.path must be one of this character's own gallery images —
		// without this, the client could point avatar at an arbitrary
		// external URL, which every other viewer's browser would then fetch
		// directly (avatar isn't routed through the authenticated /images
		// proxy unless it happens to start with /images/...), bypassing the
		// per-viewer authorization that route exists to enforce.
		const galleryImage = await db.query.characterGalleryImages.findFirst({
			where: (g, { and, eq }) =>
				and(
					eq(g.characterId, params.characterId),
					eq(g.path, params.path)
				)
		})
		if (!galleryImage) throw new Error("Invalid avatar path.")

		const [updated] = await db
			.update(schema.characters)
			.set({ avatar: params.path })
			.where(
				and(
					eq(schema.characters.id, params.characterId),
					eq(schema.characters.userId, userId)
				)
			)
			.returning()

		const res: Sockets.Characters.SetAvatar.Response = {
			character: updated
		}
		emitToUser("characters:setAvatar", res)
		await charactersGet.handler(
			socket,
			{ id: params.characterId },
			emitToUser
		)
		return res
	}
}

// Registration function for all character handlers
export function registerCharacterHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, charactersList, emitToUser)
	register(socket, charactersGet, emitToUser)
	register(socket, charactersCreate, emitToUser)
	register(socket, charactersUpdate, emitToUser)
	register(socket, charactersDelete, emitToUser)
	register(socket, charactersImportCard, emitToUser)
	register(socket, charactersImportResolve, emitToUser)
	register(socket, charactersExportCard, emitToUser)
	register(socket, charactersSearchLibrary, emitToUser)
	register(socket, charactersImportFromLibrary, emitToUser)
	register(socket, charactersListGallery, emitToUser)
	register(socket, charactersUploadGalleryImage, emitToUser)
	register(socket, charactersDeleteGalleryImage, emitToUser)
	register(socket, charactersReorderGallery, emitToUser)
	register(socket, charactersSetAvatar, emitToUser)
}
