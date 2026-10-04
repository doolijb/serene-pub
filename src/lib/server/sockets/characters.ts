import { db } from "$lib/server/db"
import { readMedia, toClientMedia } from "$lib/server/media"
import { MediaVariant } from "$lib/shared/constants/MediaVisibility"
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
import type { CardSprite } from "$lib/server/utils/cardSprites"
import type { Handler } from "$lib/shared/events"
import {
	decodeCardFileBase64,
	parseCharacterCard,
	describeUnimportedAssets,
	buildCharacterCardV3,
	embedCharacterCardInPng,
	getRobustSpecV3Data
} from "../utils/characterCardParser"
import { autoEnqueueCharacter } from "$lib/server/embedding/vectorizationQueue"
import { canViewCharacter } from "$lib/server/utils/sessionAccess"
import { markCharacterAsPersona } from "$lib/server/utils/markCharacterAsPersona"
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
import { refusable } from "./refusable"
import {
	importFailureSentence,
	serverFailureAs
} from "$lib/server/imports/importFailure"
import { holdImport, takeHeldImport } from "$lib/server/imports/heldImports"
import { withImportLimit } from "$lib/server/imports/importLimit"

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
	dbOrTx: Db = db
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

/**
 * The character list, as every surface that shows one reads it.
 *
 * The one query behind the `characters:list` request AND behind the four
 * cascades that re-send the list after a write, so a refresh can never be a
 * different read from the request's own — and so those cascades can hand it
 * over LAZILY (socket-interest plan, ruling 4). It is a findMany over every
 * character this user has, each with its avatar row and its tag joins, so a
 * create, a rename, a delete or an import made from a surface that shows no
 * character list pays for none of it. Skipping the emit alone would save
 * nothing; the query is the cost.
 */
export async function buildCharactersList(
	userId: number
): Promise<Sockets.Characters.List.Response> {
	const characterList = await db.query.characters.findMany({
		columns: {
			id: true,
			name: true,
			nickname: true,
			avatarMediaId: true,
			isFavorite: true,
			description: true,
			creatorNotes: true,
			embeddingModel: true,
			// The persona picker and the folder-grouped library are reads of
			// THIS list, not of a second family — so these three ride the row
			// rather than costing a query each.
			isPersona: true,
			isDefaultPersona: true,
			folderId: true
		},
		with: {
			avatarMedia: {
				columns: { uuid: true, rev: true, frame: true }
			},
			characterTags: {
				with: {
					tag: true
				}
			}
		},
		where: (c, { and, eq }) =>
			and(eq(c.userId, userId), eq(c.isDeleted, false)),
		orderBy: (c, { asc }) => asc(c.id)
	})
	return { characterList }
}

export const charactersList: Handler<
	Sockets.Characters.List.Params,
	Sockets.Characters.List.Response
> = {
	event: "characters:list",
	handler: async (socket, params, emitToUser) => {
		const res = await buildCharactersList(socket.user!.id)
		emitToUser("characters:list", res)
		return res
	}
}

/**
 * One character, as the panel that opened it reads it.
 *
 * Shared by the `characters:get` request and the two cascades that re-send the
 * character after a write it cannot describe (a gallery upload, an avatar
 * pick), so the push and the request can never be two different reads — and so
 * those cascades can be LAZY (socket-interest plan, ruling 4): the row, its
 * avatar, its tags, its owner and the `canViewCharacter` check behind it are
 * never paid for when no panel is open to receive them.
 *
 * ⚠ The not-found reply carries `characterId`, the way `sessions:get`'s does.
 * There is no character for a scope extractor to read an id off, so without it
 * the payload would have no **interest scope** and only a BARE `characters:get`
 * key — one that matches every OTHER character's reply too — could receive it.
 */
async function buildCharacterGet(
	userId: number,
	characterId: number
): Promise<Sockets.Characters.Get.Response> {
	const character = await db.query.characters.findFirst({
		where: (c, { and, eq }) =>
			and(eq(c.id, characterId), eq(c.isDeleted, false)),
		// Unlike buildCharactersList (which already allowlists columns), this
		// findFirst had no columns restriction and spread the full row —
		// including the raw embedding vector — into the response.
		columns: {
			embedding: false,
			embeddingModel: false,
			embeddingSourceHash: false,
			embedTextHash: false,
			vectorizedAt: false
		},
		with: {
			avatarMedia: {
				columns: { uuid: true, rev: true, frame: true }
			},
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
				character.user?.displayName || character.user?.username || null
		}
		const { characterTags, user, ...characterWithoutTags } =
			characterWithTags

		return { character: characterWithoutTags }
	}
	return { character: null, characterId }
}

export const charactersGet: Handler<
	Sockets.Characters.Get.Params,
	Sockets.Characters.Get.Response
> = {
	event: "characters:get",
	handler: async (socket, params, emitToUser) => {
		const res = await buildCharacterGet(socket.user!.id, params.id)
		emitToUser("characters:get", res)
		return res
	}
}

/**
 * The character as a broadcast has to carry it: re-read AFTER every write the
 * handler made, with the avatar file's address joined on.
 *
 * `.returning()` answers with the row its own statement wrote, and an avatar
 * upload sets `avatarMediaId` in a separate statement afterwards — so a payload
 * built from the returned row names the avatar the character wore before the
 * save, and every open session applies that faithfully and keeps rendering the
 * old face.
 *
 * `fallback` covers the row vanishing between the write and this read; the
 * caller has already established it exists.
 */
async function characterForBroadcast(
	id: number,
	fallback: SelectCharacter
): Promise<Sockets.Characters.Update.Response["character"]> {
	const row = await db.query.characters.findFirst({
		where: (c, { eq }) => eq(c.id, id),
		with: {
			avatarMedia: { columns: { uuid: true, rev: true, frame: true } }
		}
	})
	return row ?? fallback
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

			// `isDefaultPersona` cannot ride the INSERT: the partial unique
			// index admits one per user, so a create that claims the default
			// while another row still holds it is refused outright. Taken out
			// here and applied by the same transaction `setDefaultPersona`
			// uses — the setup wizard's starter persona arrives exactly this
			// way, with both flags set on a create.
			const makeDefault = (data as any).isDefaultPersona === true
			delete (data as any).isDefaultPersona

			// `folderId`: ownership-checked, same rule as `characters:update`.
			if (data.folderId != null) {
				const folder = await db.query.characterFolders.findFirst({
					where: (f, { and, eq }) =>
						and(
							eq(f.id, data.folderId as number),
							eq(f.userId, socket.user!.id)
						),
					columns: { id: true }
				})
				if (!folder) data.folderId = null
			}

			const [character] = await db
				.insert(schema.characters)
				.values({
					...data,
					...(makeDefault ? { isPersona: true } : {}),
					userId: socket.user!.id
				})
				.returning()

			if (makeDefault) {
				await setDefaultPersona(character.id, socket.user!.id)
				character.isPersona = true
				character.isDefaultPersona = true
			}

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
			// LAZY (see `buildCharactersList`): with no character list open
			// anywhere, this create pays for no re-list. Awaited so the refreshed
			// list still lands before the reply, exactly as it did eagerly.
			await emitToUser("characters:list", () =>
				buildCharactersList(socket.user!.id)
			)

			const res: Sockets.Characters.Create.Response = {
				character: await characterForBroadcast(character.id, character)
			}
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
			// Absent means untouched; an empty array means remove all.
			const tagsProvided = Array.isArray((params.character as any).tags)

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
			delete (data as any).embeddingSourceHash
			// GENERATED from the name and description; Postgres refuses a write.
			delete (data as any).embedTextHash
			// lorebookId: no ownership check exists for it here (unlike sessions,
			// nothing currently reads a character's own lorebookId for prompt
			// content), so blocking it outright is the correct minimal fix —
			// a future feature needing this should validate ownership first.
			// uuid: table-wide unique index, not per-user — a client-supplied
			// collision would throw on someone else's row, and otherwise lets
			// a user silently break their own import-dedup identity.
			delete (data as any).lorebookId
			delete (data as any).uuid
			// A joined relation, not a column — the payload carries it so a
			// client can build the avatar's real URL, and it has nowhere to go
			// in an UPDATE.
			delete (data as any).avatarMedia

			// `folderId`: OWNERSHIP-CHECKED, not blocked. A folder is a shelf
			// in the caller's own library, so naming someone else's id is not
			// a move to honour — it files the character at the top level
			// instead. `undefined` means "not part of this update" and is left
			// alone; an explicit `null` is the user clearing it.
			if (data.folderId != null) {
				const folder = await db.query.characterFolders.findFirst({
					where: (f, { and, eq }) =>
						and(
							eq(f.id, data.folderId as number),
							eq(f.userId, userId)
						),
					columns: { id: true }
				})
				if (!folder) data.folderId = null
			}

			// `isDefaultPersona`: routed through the same transaction as
			// `characters:setDefaultPersona`, because setting it while another
			// row still holds it trips `characters_default_persona_unique`.
			// Taken out of the plain UPDATE below and applied after it.
			const makeDefault = data.isDefaultPersona === true
			const clearDefault = data.isDefaultPersona === false
			delete (data as any).isDefaultPersona

			// The vector is dropped only when this save CHANGES what it was
			// computed over — the name and the description
			// (`characterEmbedText`) — so retrieval never matches words the card
			// does not hold. Compared, not merely named: the editor re-sends
			// the whole card, and a folder move, an avatar or a persona flag
			// changes nothing a vector reads. The queue re-embeds on the text
			// hash either way.
			const stored = await db.query.characters.findFirst({
				where: and(
					eq(schema.characters.id, id),
					eq(schema.characters.userId, userId)
				),
				columns: { name: true, description: true }
			})
			const movesEmbeddedText =
				!!stored &&
				((typeof data.name === "string" && data.name !== stored.name) ||
					(typeof data.description === "string" &&
						data.description !== stored.description))

			const [updated] = await db
				.update(schema.characters)
				.set({
					...data,
					// Setting the default also makes it a persona — a default
					// you cannot play is not a state worth having.
					...(makeDefault ? { isPersona: true } : {}),
					...(movesEmbeddedText
						? {
								embedding: null,
								embeddingModel: null,
								embeddingSourceHash: null,
								vectorizedAt: null
							}
						: {})
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

			if (makeDefault) await setDefaultPersona(id, userId)
			else if (clearDefault)
				await db
					.update(schema.characters)
					.set({ isDefaultPersona: false })
					.where(
						and(
							eq(schema.characters.id, id),
							eq(schema.characters.userId, userId)
						)
					)

			// Process tags after character update. Absent means untouched; an
			// empty array means remove all.
			if (tagsProvided) await processCharacterTags(id, tags, userId)

			if (params.avatarFile) {
				await handleCharacterAvatarUpload({
					character: updated,
					avatarFile: params.avatarFile
				})
			}

			// Keep the bound lorebookBindings rows' name/aliases in sync with
			// this character's current name/nickname/aliases (decision 2, merge
			// plan) — in every book of the card's owner, never in another
			// person's (plan A25). Cheap no-op if nothing is bound.
			await syncLorebookBindingsForCharacter(id)

			autoEnqueueCharacter(id, updated.name).catch(console.error)
			const res: Sockets.Characters.Update.Response = {
				character: await characterForBroadcast(id, updated)
			}
			// LAZY (see `buildCharactersList`), in the order the eager cascade
			// sent it: the refreshed list, then this handler's own reply.
			await emitToUser("characters:list", () =>
				buildCharactersList(userId)
			)
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
		// cascades sessionMessages.characterId -> SET NULL with no name
		// snapshot, so every historical message this character ever
		// authored would permanently fall back to the generic "assistant"
		// label (resolveCharacterName()) the moment the row was gone. Soft
		// delete keeps the row (and its name/nickname) around so that
		// resolution keeps working, while charactersList/charactersGet hide
		// it going forward. The avatar directory is deliberately NOT removed
		// either, for the same reason personasDelete doesn't remove a
		// persona's — old session messages may still render this character's
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

		// LAZY (see `buildCharactersList`).
		await emitToUser("characters:list", () => buildCharactersList(userId))

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
	dbOrTx: Db
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

/** First candidate that's actually an array, else undefined. */
function firstArray<T>(...candidates: unknown[]): T[] | undefined {
	return candidates.find(Array.isArray) as T[] | undefined
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
		// V3 defines these on `data` itself; Serene Pub's own exporter (and
		// SillyTavern before it) writes them under `extensions` instead. Read
		// both, spec location first, or every spec-compliant card from another
		// tool imports with these silently emptied.
		source: firstArray(data.source, data.extensions?.source) ?? [],
		groupOnlyGreetings:
			firstArray(
				data.group_only_greetings,
				data.extensions?.group_only_greetings
			) ?? null,
		// Straight V3 fields with a column each — dropped entirely until now.
		creatorNotesMultilingual:
			data.creator_notes_multilingual &&
			typeof data.creator_notes_multilingual === "object"
				? data.creator_notes_multilingual
				: null,
		// V3 `assets` (card asset descriptors) is parsed by nothing here:
		// `characters.assets` was dropped (see schema.ts), and there's no
		// column to put it in. Importing card assets should create `media`
		// rows, not reinstate the column.
		aliases: Array.isArray(
			data.extensions?.serenepub?.aliases ?? data.extensions?.aliases
		)
			? (data.extensions?.serenepub?.aliases ?? data.extensions?.aliases)
			: [],
		summary: data.extensions?.serenepub?.summary ?? null,
		category: data.extensions?.serenepub?.category ?? null
	}
}

/**
 * Warnings from an import step that failed WITHOUT invalidating the import
 * itself. Attached to the success response rather than thrown.
 */
export type ImportWarning = string

/**
 * Applies the avatar and tags to an already-inserted character row.
 *
 * The avatar write is deliberately non-fatal. It runs *after* the character
 * row is committed, and it rejects anything over 10MB or not a recognized
 * image — which real SillyTavern cards hit routinely, since the card IS a
 * full-resolution PNG portrait. Letting that throw meant the caller reported
 * "import failed" for a character that was already in the database and then
 * appeared on the next refresh, while the character list was never told to
 * update. The character's actual content parsed fine; only its portrait was
 * unusable, so the honest outcome is a successful import carrying a warning.
 *
 * A genuine failure earlier in the import (bad card, failed insert) still
 * throws, so an error really does mean nothing was imported.
 */
async function applyAvatarAndTags(
	character: typeof schema.characters.$inferSelect,
	avatarBuffer: Buffer | undefined,
	tags: string[] | undefined,
	userId: number,
	dbOrTx: Db = db
): Promise<{
	character: typeof schema.characters.$inferSelect
	warnings: ImportWarning[]
}> {
	const warnings: ImportWarning[] = []
	if (avatarBuffer) {
		try {
			await handleCharacterAvatarUpload({
				character,
				avatarFile: avatarBuffer
			})
			const updatedCharacter = await dbOrTx.query.characters.findFirst({
				where: eq(schema.characters.id, character.id)
			})
			if (updatedCharacter) Object.assign(character, updatedCharacter)
		} catch (e: any) {
			const reason = importFailureSentence(
				e,
				`character ${character.id}'s avatar`
			)
			console.warn(
				`Character ${character.id} imported without its avatar: ${reason}`
			)
			warnings.push(`The card's image could not be saved: ${reason}`)
		}
	}
	if (tags && tags.length > 0) {
		try {
			await processCharacterTags(character.id, tags, userId, dbOrTx)
		} catch (e: any) {
			const reason = importFailureSentence(
				e,
				`character ${character.id}'s tags`
			)
			console.warn(
				`Character ${character.id} imported without its tags: ${reason}`
			)
			warnings.push(`The card's tags could not be saved: ${reason}`)
		}
	}
	return { character, warnings }
}

/**
 * Creates a brand-new character (+ avatar/tags) from parsed V3 spec data.
 *
 * @param warnings optional sink for non-fatal problems (an unusable avatar or
 * tags). Pass one from an import handler so the user can be told what was
 * skipped; omit it and such problems are logged only. Kept as an out-param
 * rather than widening the return type, since several callers only ever want
 * the character.
 */
export async function createCharacterFromParsedData(
	data: any,
	avatarBuffer: Buffer | undefined,
	userId: number,
	dbOrTx: Db = db,
	warnings?: ImportWarning[]
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
	const applied = await applyAvatarAndTags(
		character,
		avatarBuffer,
		data.tags,
		userId,
		dbOrTx
	)
	warnings?.push(...applied.warnings)
	return applied.character
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
	dbOrTx: Db = db,
	warnings?: ImportWarning[]
) {
	await dbOrTx
		.update(schema.characters)
		.set(characterFieldsFromParsedData(data))
		.where(eq(schema.characters.id, existingId))
	const character = await dbOrTx.query.characters.findFirst({
		where: eq(schema.characters.id, existingId)
	})
	if (!character) throw new Error("Character not found.")
	const applied = await applyAvatarAndTags(
		character,
		avatarBuffer,
		data.tags,
		userId,
		dbOrTx
	)
	warnings?.push(...applied.warnings)
	return applied.character
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
	dbOrTx: Db = db
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

/**
 * Rebuilds and emits the character list after an import.
 *
 * Never throws: by the time this runs the character is already committed, so
 * letting a list-refresh failure propagate would report a successful import as
 * a failure — the exact confusion this whole path had. A stale sidebar is
 * recoverable; a false "import failed" is not.
 */
async function refreshCharacterList(
	socket: any,
	emitToUser: any,
	warnings: ImportWarning[]
) {
	// LAZY (see `buildCharactersList`), with the catch moved INSIDE the thunk
	// so it still guards the read it was written for. A gate that never runs
	// the thunk is not a failed refresh — there was no list to refresh — so it
	// leaves the warnings alone, and the re-throw is what makes `emitToUser`
	// log the failure and emit nothing rather than push a half-built list.
	await emitToUser("characters:list", async () => {
		try {
			return await buildCharactersList(socket.user!.id)
		} catch (e: any) {
			const reason = e?.message || String(e)
			console.warn(
				`Character list refresh after import failed: ${reason}`
			)
			warnings.push(
				"The character list could not be refreshed — reload to see it."
			)
			throw e
		}
	})
}

/**
 * Store the sprites a card carried (DESIGN-sprites §4) and say, as import
 * warnings, which were left behind — an image that is not an image, one past
 * a ceiling. The character is already committed, so nothing here fails the
 * import: a failure is a sentence in the toast.
 */
async function importCardSprites(
	userId: number,
	characterId: number,
	sprites: CardSprite[] | undefined,
	warnings: ImportWarning[],
	defaultSetName?: unknown
): Promise<void> {
	if (!sprites?.length) return
	try {
		const { importSprites, ensureDefaultSpriteSet, renameSpriteSet } =
			await import("$lib/server/sprites")
		const result = await importSprites(db, userId, characterId, sprites, "card")
		// A Serene Pub CHARX names its default set; keep the name.
		if (typeof defaultSetName === "string" && defaultSetName.trim()) {
			const def = await ensureDefaultSpriteSet(db, characterId)
			await renameSpriteSet(db, characterId, def.id, defaultSetName).catch(
				() => undefined
			)
		}
		if (result.skipped.length > 0) {
			const n = result.skipped.length
			warnings.push(
				`${n} of the card's sprites ${n === 1 ? "was" : "were"} not imported (${result.skipped
					.slice(0, 3)
					.map((s) => `${s.label}: ${s.reason}`)
					.join("; ")}${n > 3 ? "; …" : ""}).`
			)
		}
	} catch (e: any) {
		warnings.push(
			`The card's sprites could not be imported: ${importFailureSentence(e, `character ${characterId}'s sprites`)}`
		)
	}
}

/**
 * A card import's refusal when the server failed rather than refused, and the
 * wrapper's fallback: the database's and the machine's words go to the log
 * (`serverFailureAs`), never to the person.
 */
const CARD_IMPORT_FAILED =
	"The card could not be imported. The server log has the details."
const cardImportFailureOf = serverFailureAs(CARD_IMPORT_FAILED)

/**
 * Import a card file (sent as base64).
 *
 * Hardened (lorebooks plan S4): the file is measured before it is decoded, a
 * person runs at most `IMPORTS_RUNNING_PER_USER` imports at once however many
 * sockets they hold (and the server `IMPORTS_RUNNING_ON_SERVER` for everyone),
 * and a conflict HOLDS the decoded file on the server — the reply carries a
 * `heldImportId`, never the file. Refusals reach the person as the sentence
 * that says which (`refusable`).
 */
export const charactersImportCard = refusable<
	Sockets.Characters.ImportCard.Params,
	Sockets.Characters.ImportCard.Response
>(
	"characters:importCard",
	async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		if (typeof params?.file !== "string") {
			throw new Error("No card file was sent.")
		}
		return withImportLimit(userId, () =>
			importCardFile(
				socket,
				decodeCardFileBase64(params.file),
				emitToUser
			)
		)
	},
	CARD_IMPORT_FAILED,
	cardImportFailureOf
)

/**
 * The card's embedded lorebook, HELD for the "Import the lorebook?" dialog
 * (NOMENCLATURE §16) rather than sent: the book can be 16 MB, and a reply
 * reaches every tab only for the dialog to send it straight back (S4 review).
 * `lorebooks:import` takes the id; only this person, once.
 */
function holdCardBook(
	userId: number,
	lorebook: SpecV3.Lorebook | undefined
): Sockets.Characters.HeldCardBook | null {
	if (!lorebook) return null
	return {
		heldImportId: holdImport(userId, "lorebook", {
			lorebookJson: JSON.stringify(lorebook)
		}),
		name: typeof lorebook.name === "string" ? lorebook.name : ""
	}
}

/**
 * A card file's bytes, imported for the socket's person — the body of
 * `characters:importCard`, and of a Library import, which hands over the
 * bytes it fetched as they are (never base64 and back). The caller holds the
 * import limit.
 */
async function importCardFile(
	socket: any,
	bytes: Buffer,
	emitToUser: (event: string, data: any) => void
): Promise<Sockets.Characters.ImportCard.Response> {
	const userId = socket.user!.id
	const { card, avatarBuffer, lorebook, unimportedAssets, sprites } =
		await parseCharacterCard(bytes)

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
					const res: Sockets.Characters.ImportCard.Response = {
						status: "unchanged",
						character: existingComparison.character,
						// Nothing new to offer: the dialog asks only after a
						// card is created.
						book: null
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
						heldImportId: holdImport(userId, "card", bytes)
					}
				}
				emitToUser("characters:importCard", res)
				return res
			}
		}
	}

	const warnings: ImportWarning[] = []
	// The V3 spec requires telling the user when a card's assets are
	// not kept, since a re-export will leave them out.
	const assetNote = describeUnimportedAssets(unimportedAssets)
	if (assetNote) warnings.push(assetNote)
	const character = await createCharacterFromParsedData(
		data,
		avatarBuffer,
		userId,
		db,
		warnings
	)
	await importCardSprites(
		userId,
		character.id,
		sprites,
		warnings,
		(data.extensions as any)?.serenepub?.defaultSpriteSet
	)

	// Refreshed inside its own try/catch: the character is already
	// committed at this point, so a failure to rebuild the list is not
	// a failed import and must not be reported as one — an error thrown
	// into the outer catch would say the import failed while the
	// character sits in the database and the sidebar goes stale.
	await refreshCharacterList(socket, emitToUser, warnings)

	const res: Sockets.Characters.ImportCard.Response = {
		status: "created",
		character,
		book: holdCardBook(userId, lorebook),
		...(warnings.length > 0 ? { warnings } : {})
	}
	emitToUser("characters:importCard", res)
	return res
}

/**
 * Carries out the user's choice after characters:importCard returned a
 * "conflict" status — either overwrite the existing (uuid-matched)
 * character in place, or import the file as a brand-new character with a
 * fresh uuid. The file is the HELD import the conflict named, taken out of
 * the store before anything else: only its owner can take it, and only once.
 */
export const charactersImportResolve = refusable<
	Sockets.Characters.ImportResolve.Params,
	Sockets.Characters.ImportResolve.Response
>(
	"characters:importResolve",
	async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		return withImportLimit(userId, async () => {
			const bytes = takeHeldImport(userId, "card", params?.heldImportId)
			const { card, avatarBuffer, lorebook, unimportedAssets, sprites } =
				await parseCharacterCard(bytes)
			const data = getRobustSpecV3Data(card)

			const warnings: ImportWarning[] = []
			const assetNote = describeUnimportedAssets(unimportedAssets)
			if (assetNote) warnings.push(assetNote)
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
					userId,
					db,
					warnings
				)
			} else {
				character = await createCharacterFromParsedData(
					data,
					avatarBuffer,
					userId,
					db,
					warnings
				)
			}

			await importCardSprites(
				userId,
				character.id,
				sprites,
				warnings,
				(data.extensions as any)?.serenepub?.defaultSpriteSet
			)
			await refreshCharacterList(socket, emitToUser, warnings)

			const res: Sockets.Characters.ImportResolve.Response = {
				character,
				book: holdCardBook(userId, lorebook),
				...(warnings.length > 0 ? { warnings } : {})
			}
			emitToUser("characters:importResolve", res)
			return res
		})
	},
	CARD_IMPORT_FAILED,
	cardImportFailureOf
)

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
					// `catalog` names the REMOTE library's shelf, not our
					// table — a source still publishes characters and personas
					// separately, and `supports()` still answers per shelf.
					const kind =
						params.catalog === "personas" ? "persona" : "character"
					if (!source.supports(kind)) {
						throw new CardSourceUnavailableError(
							`${source.label} does not support browsing ${kind === "persona" ? "personas" : "characters"}`
						)
					}

					const nsfw = await resolveNsfwParam(userId)
					const { items, hasMore, nextOffset } = await cachedSearch(
						sourceId,
						{
							kind,
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

/**
 * Import a card from a Library source. The fetch, the source's own checks and
 * the import all run as ONE import under the import limit (S4 review: the
 * fetch and a full parse ran before any limit), the fetched bytes are
 * imported as they are, and a refusal reaches the person as its own sentence
 * (`refusable`) — a source's "not available" included.
 *
 * ⚠ The card is still parsed twice: once by the source's content check
 * (CharaVault's, without the avatar or sprites), once to import it. Sharing
 * one parse would take the `CardSource` interface handing its parse back.
 */
export const charactersImportFromLibrary = refusable<
	Sockets.Characters.ImportFromLibrary.Params,
	Sockets.Characters.ImportFromLibrary.Response
>(
	"characters:importFromLibrary",
	async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const fromPersonaCatalog = params.catalog === "personas"
		const source = resolveCardSource(params.source)
		const kind = fromPersonaCatalog ? "persona" : "character"
		if (!source.supports(kind)) {
			throw new CardSourceUnavailableError(
				`${source.label} does not support browsing ${fromPersonaCatalog ? "personas" : "characters"}`
			)
		}
		const importResult = await withImportLimit(userId, async () =>
			importCardFile(
				socket,
				await source.getCardBytes(params.ref, { userId }),
				emitToUser
			)
		)

		// Only reachable if this exact card (by its embedded uuid) somehow
		// already conflicts with one this user has — there's no
		// conflict-resolution UI wired up for the library-import path, so
		// surface it as a plain error rather than return a null character.
		if (!importResult.character) {
			throw new Error(
				"This card conflicts with one you already have — resolve it from the Characters view instead."
			)
		}

		// A card off the PERSONA shelf lands as one of your personas: the
		// user browsed a persona catalogue, which is the same statement
		// that attaching one to a session makes.
		if (fromPersonaCatalog) {
			await markCharacterAsPersona(importResult.character.id)
			importResult.character.isPersona = true
			await emitToUser("characters:list", () =>
				buildCharactersList(userId)
			)
		}

		const res: Sockets.Characters.ImportFromLibrary.Response = {
			character: importResult.character,
			book: importResult.book
		}
		emitToUser("characters:importFromLibrary", res)
		return res
	},
	"The card could not be imported from the library. The server log has the details.",
	serverFailureAs(
		"The card could not be imported from the library. The server log has the details."
	)
)

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
			// session, so this deliberately does NOT use canViewCharacter).
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

			if (format === "charx") {
				// CHARX (DESIGN-sprites §4): the one container that carries the
				// character's sprites — and its avatar, as the main icon.
				const { buildCharx } = await import("$lib/server/sprites/charx")
				const blob = await buildCharx(db, {
					characterId: character.id,
					avatarMediaId: character.avatarMediaId ?? null,
					card: charCardData
				})
				const filename = `${character.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.charx`
				const res: Sockets.Characters.ExportCard.Response = { blob, filename }
				emitToUser("characters:exportCard", res)
				return res
			}

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
				// Export as PNG with embedded data.
				//
				// The card's primary image (28 §10), asked for as the ORIGINAL
				// rather than as "the file's bytes" (0182). The display form of
				// a PNG upload can legitimately be a re-derived lossless WebP
				// that came out smaller, and handing that to the embedder would
				// refuse the export of a PNG-original avatar — or, if the mime
				// check below were ever loosened, put WebP bytes inside a file
				// named .png. The variant carries the sniffed mime, so the check
				// still never infers a type from a filename extension.
				const avatar = character.avatarMediaId
					? await readMedia(
							db,
							character.avatarMediaId,
							MediaVariant.ORIGINAL
						)
					: null
				if (!avatar) {
					throw new Error(
						"Character has no avatar to embed data into"
					)
				}
				if (!avatar.row.isOriginal) {
					// `readMedia` falls back to the display form when the
					// original is gone. That is right for rendering and wrong
					// here: culling originals is an explicit, irreversible admin
					// action and a card export has nothing to fall back to.
					// Naming that cause matters — reporting "isn't a PNG" would
					// send someone to re-upload a PNG they already uploaded.
					throw new Error(
						"This character's avatar is no longer stored in its original form (originals were culled to reclaim space), so it can't be used for PNG card export — try JSON export instead, or upload the avatar again."
					)
				}
				if (avatar.mime !== "image/png") {
					throw new Error(
						"This character's avatar isn't a PNG, so it can't be used for PNG card export — try JSON export instead, or update the avatar to a PNG image first."
					)
				}
				const blob = embedCharacterCardInPng(avatar.bytes, charCardData)
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

/**
 * One character's gallery, as the panel that opened it reads it.
 *
 * Shared by the `characters:listGallery` request, the two cascades that re-send
 * the gallery after an upload or a delete, and the reorder that answers WITH
 * it — so the four can never disagree about what the gallery holds. The two
 * cascades hand it over lazily (socket-interest plan, ruling 4); the reorder
 * cannot, because its own reply IS this payload.
 *
 * The response carries `characterId` so a client with two gallery panels open
 * can tell which one a broadcast is for, and so the interest scope has an id to
 * key off.
 */
async function buildCharactersGallery(
	userId: number,
	characterId: number
): Promise<Sockets.Characters.ListGallery.Response> {
	const images = await listCharacterGallery({ characterId, userId })
	return { images, characterId }
}

export const charactersListGallery: Handler<
	Sockets.Characters.ListGallery.Params,
	Sockets.Characters.ListGallery.Response
> = {
	event: "characters:listGallery",
	handler: async (socket, params, emitToUser) => {
		try {
			const res = await buildCharactersGallery(
				socket.user!.id,
				params.characterId
			)
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

			const uploaded = await uploadCharacterGalleryImage({
				characterId: params.characterId,
				userId,
				imageFile: Buffer.from(params.imageFile as Uint8Array)
			})

			const res: Sockets.Characters.UploadGalleryImage.Response = {
				success: true,
				media: toClientMedia(uploaded.file),
				characterId: params.characterId
			}
			emitToUser("characters:uploadGalleryImage", res)
			// Both LAZY (socket-interest plan, ruling 4), in the order the eager
			// cascades sent them.
			//
			// ⚠ A re-read that THROWS is logged by `emitToUser` and emits
			// nothing — no `characters:listGallery:error`, and nothing raised
			// into this handler's catch. That is right for a push the caller's
			// reply does not depend on: the image is already stored, so a failed
			// refresh must not report the upload as failed.
			await emitToUser("characters:listGallery", () =>
				buildCharactersGallery(userId, params.characterId)
			)
			await emitToUser("characters:get", () =>
				buildCharacterGet(userId, params.characterId)
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
				mediaId: params.mediaId
			})

			const res: Sockets.Characters.DeleteGalleryImage.Response = {
				success: true,
				characterId: params.characterId
			}
			emitToUser("characters:deleteGalleryImage", res)
			// LAZY, and a failed re-read is swallowed — see the note in
			// `charactersUploadGalleryImage` above.
			await emitToUser("characters:listGallery", () =>
				buildCharactersGallery(userId, params.characterId)
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
			mediaIds: params.mediaIds
		})

		// EAGER, deliberately: this handler's own reply IS the refreshed
		// gallery, so a thunk could only skip the `characters:listGallery`
		// emit, never the read — and skipping an emit alone saves nothing.
		// Built once and sent twice, which is what keeps the two from
		// disagreeing.
		const listRes = await buildCharactersGallery(userId, params.characterId)
		emitToUser("characters:listGallery", listRes)
		const res: Sockets.Characters.ReorderGallery.Response = listRes
		emitToUser("characters:reorderGallery", res)
		return res
	}
}

/**
 * Clear the caller's current default persona and set this one, in ONE
 * transaction.
 *
 * `characters_default_persona_unique` is a partial unique index over
 * `user_id`, so the clear and the set have to be the same statement pair or a
 * concurrent read of the table between them sees two defaults — and a set that
 * ran first would simply be refused. Scoped to this user only: a bare
 * "WHERE is_default_persona" would clear every account's default on a
 * multi-user instance, not just the caller's.
 *
 * Also flags the character as a persona, via the one writer of that flag.
 */
async function setDefaultPersona(characterId: number, userId: number) {
	await db.transaction(async (tx) => {
		await tx
			.update(schema.characters)
			.set({ isDefaultPersona: false })
			.where(
				and(
					eq(schema.characters.userId, userId),
					eq(schema.characters.isDefaultPersona, true)
				)
			)
		await tx
			.update(schema.characters)
			.set({ isDefaultPersona: true, isPersona: true })
			.where(
				and(
					eq(schema.characters.id, characterId),
					eq(schema.characters.userId, userId)
				)
			)
	})
}

export const charactersSetDefaultPersona: Handler<
	Sockets.Characters.SetDefaultPersona.Params,
	Sockets.Characters.SetDefaultPersona.Response
> = {
	event: "characters:setDefaultPersona",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const character = await db.query.characters.findFirst({
			where: (c, { and, eq }) =>
				and(eq(c.id, params.characterId), eq(c.userId, userId)),
			columns: { id: true }
		})
		if (!character)
			throw new Error("Character not found or access denied")

		await setDefaultPersona(params.characterId, userId)

		const res: Sockets.Characters.SetDefaultPersona.Response = {
			success: true
		}
		emitToUser("characters:setDefaultPersona", res)
		// LAZY (see `buildCharactersList`): the list is the only thing that
		// shows which character is the default, so a view that is not showing
		// one needs no re-read.
		await emitToUser("characters:list", () => buildCharactersList(userId))
		return res
	}
}

// `characters:setFolder` lives in `./characterFolders.ts` with the rest of the
// folder family: it cascades BOTH lists, and putting it here instead would make
// the two modules import each other.

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

		// params.mediaId must be one of this character's own files.
		// The old version guarded against the client pointing `avatar` at an
		// arbitrary external URL — every viewer's browser would fetch it
		// directly, bypassing the authenticated proxy. That whole class is
		// gone now (an avatar is an id into `files`, and there is nowhere to
		// put a URL), but the ownership check still matters: without it a
		// client could name someone else's media id.
		//
		// The `variant IS NULL` filter this used to carry is gone with 0182:
		// a stored representation has no id in this space and no provenance
		// at all, so a `characterId` match can only ever be a file.
		const owned = await db.query.files.findFirst({
			where: (f, { and, eq }) =>
				and(
					eq(f.id, params.mediaId),
					eq(f.characterId, params.characterId)
				)
		})
		if (!owned) throw new Error("Invalid avatar image.")

		const [updated] = await db
			.update(schema.characters)
			.set({ avatarMediaId: params.mediaId })
			.where(
				and(
					eq(schema.characters.id, params.characterId),
					eq(schema.characters.userId, userId)
				)
			)
			.returning()

		const broadcast = await characterForBroadcast(
			params.characterId,
			updated
		)
		const res: Sockets.Characters.SetAvatar.Response = {
			character: broadcast
		}
		emitToUser("characters:setAvatar", res)
		// The session views listen for `characters:update`, not for this
		// event — and picking a gallery image changes the face they render.
		//
		// Lazy for the emit alone: the payload is already in hand, so there is
		// no query to skip here — only the push itself, which is dropped when
		// no view holds `characters:update`.
		await emitToUser(
			"characters:update",
			() =>
				({
					character: broadcast
				}) satisfies Sockets.Characters.Update.Response
		)
		// LAZY (see `buildCharacterGet`): the character panel's re-read.
		await emitToUser("characters:get", () =>
			buildCharacterGet(userId, params.characterId)
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
	register(socket, charactersSetDefaultPersona, emitToUser)
}
