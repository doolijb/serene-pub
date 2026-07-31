import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray, sql } from "drizzle-orm"
import {
	syncLorebookBindingsForCharacter,
	syncLorebookBindingsForPersona
} from "$lib/server/utils/characterBindingSync"
import { canViewCharacter, canViewPersona } from "$lib/server/utils/chatAccess"
import { CharacterBook } from "@lenml/char-card-reader"
import {
	mapLorebookEntryToWorldLoreEntry,
	mapLorebookEntryToCharacterLoreEntry,
	mapLorebookEntryToHistoryEntry,
	entryTypeOf,
	normalizeLegacyLorebookData,
	resolveParentNodeLinks
} from "$lib/server/utils/lorebookImportMapper"
import { buildLorebookExportData } from "$lib/server/utils/lorebookExportBuilder"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import { resolveOrCreateBindingByName } from "$lib/server/utils/summarizer/availableSceneCast"
import { hashCanonicalJson } from "$lib/server/utils/contentHash"
import { isValidUuid } from "$lib/server/utils/uuid"
import { findOrCreateTagId } from "$lib/server/utils/tags"
import type { ExtractTablesWithRelations } from "drizzle-orm"
import type { PgliteDatabase, PgliteTransaction } from "drizzle-orm/pglite"
import {
	extractCharacterUuid,
	buildExistingCharacterComparisonData,
	createCharacterFromParsedData,
	overwriteCharacterFromParsedData
} from "./characters"
import {
	extractPersonaUuid,
	canonicalPersonaContent,
	personaFieldsFromParsedData,
	createPersonaFromParsedData,
	overwritePersonaFromParsedData
} from "./personas"
import type { Handler } from "$lib/shared/events"
// SelectTag/SelectLorebookTag/InsertHistoryEntry are declared globally in
// $lib/server/db/types.d.ts (ambient `export global {}` block, same pattern
// as the Sockets namespace) — no import needed/available for them.

type Executor =
	| PgliteDatabase<typeof schema>
	| PgliteTransaction<
			typeof schema,
			ExtractTablesWithRelations<typeof schema>
	  >

// `parentNodeId`/`sceneId`/`historyEntryId` are foreign keys into rows that
// must belong to the SAME lorebook as the binding being written — allowlisting
// the field isn't enough on its own, since the value could still point at
// another tenant's row (eg. another user's lorebookBindings id as
// parentNodeId), creating a cross-tenant reference the graph-context builder
// could later join through into prompt content. Same re-fetch-and-compare
// shape (and error copy) as narrativeGraphUpdateNodeHandler
// (narrativeGraph.ts), which already guards this exact pattern for the same
// table's same columns via a different entry point.
async function validateBindingCrossRefs(
	fields: {
		parentNodeId?: number | null
		sceneId?: number | null
		historyEntryId?: number | null
	},
	lorebookId: number
) {
	if (fields.parentNodeId != null) {
		const parent = await db.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, fields.parentNodeId)
		})
		if (!parent || parent.lorebookId !== lorebookId) {
			throw new Error("Parent node not found.")
		}
	}
	if (fields.sceneId != null) {
		const scene = await db.query.scenes.findFirst({
			where: eq(schema.scenes.id, fields.sceneId)
		})
		if (!scene || scene.lorebookId !== lorebookId) {
			throw new Error("Scene not found.")
		}
	}
	if (fields.historyEntryId != null) {
		const historyEntry = await db.query.historyEntries.findFirst({
			where: eq(schema.historyEntries.id, fields.historyEntryId)
		})
		if (!historyEntry || historyEntry.lorebookId !== lorebookId) {
			throw new Error("History entry not found.")
		}
	}
}

// Helper function to process tags for lorebook creation/update
async function processLorebookTags(
	lorebookId: number,
	tagNames: string[],
	userId: number,
	dbOrTx: Executor = db
) {
	if (!tagNames || tagNames.length === 0) return

	// First, remove all existing tags for this lorebook
	await dbOrTx
		.delete(schema.lorebookTags)
		.where(eq(schema.lorebookTags.lorebookId, lorebookId))

	// Process each tag name — findOrCreateTagId adopts an existing
	// case-insensitive match instead of creating a duplicate.
	const tagIds: number[] = []

	for (const tagName of tagNames) {
		const tagId = await findOrCreateTagId(userId, tagName, dbOrTx)
		if (tagId) tagIds.push(tagId)
	}

	// Link all tags to the lorebook
	if (tagIds.length > 0) {
		const lorebookTagsData = tagIds.map((tagId) => ({
			lorebookId,
			tagId
		}))

		await dbOrTx
			.insert(schema.lorebookTags)
			.values(lorebookTagsData)
			.onConflictDoNothing() // In case of race conditions
	}
}

export const lorebooksListHandler: Handler<
	Sockets.Lorebooks.List.Params,
	Sockets.Lorebooks.List.Response
> = {
	event: "lorebooks:list",
	async handler(socket, params, emitToUser) {
		// Fetch all lorebooks for the user
		const userId = socket.user!.id
		if (!userId) {
			const res = { lorebookList: [] }
			emitToUser("lorebooks:list", res)
			return res
		}
		const books = await db.query.lorebooks.findMany({
			where: (l, { eq }) => eq(l.userId, userId),
			orderBy: (l, { desc }) => desc(l.name),
			with: {
				worldLoreEntries: {
					columns: {
						id: true
					}
				},
				characterLoreEntries: {
					columns: {
						id: true
					}
				},
				historyEntries: {
					columns: {
						id: true
					}
				},
				lorebookBindings: {
					columns: {
						id: true
					}
				},
				lorebookTags: {
					with: {
						tag: true
					}
				}
			}
		})

		// Transform lorebook tags to include tags as string array
		const booksWithTags = books.map((book) => ({
			...book,
			tags:
				book.lorebookTags?.map(
					(lt: SelectLorebookTag & { tag: SelectTag }) => lt.tag.name
				) || []
		}))

		const res = { lorebookList: booksWithTags }
		emitToUser("lorebooks:list", res)
		return res
	}
}

export const lorebooksCreateHandler: Handler<
	Sockets.Lorebooks.Create.Params,
	Sockets.Lorebooks.Create.Response
> = {
	event: "lorebooks:create",
	async handler(socket, params, emitToUser) {
		try {
			const userId = socket.user!.id

			const [newBook] = await db
				.insert(schema.lorebooks)
				.values({
					name: params.name,
					userId
				})
				.returning()

			// Refresh lorebook list
			if (emitToUser) {
				const lorebookListResult = await lorebooksListHandler.handler(
					socket,
					{},
					emitToUser
				)
				emitToUser("lorebooks:list", lorebookListResult)
				emitToUser("lorebooks:create", { lorebook: newBook })
			}

			return { lorebook: newBook }
		} catch (error) {
			console.error("Error creating lorebook:", error)
			throw error
		}
	}
}

export const lorebooksGetHandler: Handler<
	Sockets.Lorebooks.Get.Params,
	Sockets.Lorebooks.Get.Response
> = {
	event: "lorebooks:get",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			const book = await db.query.lorebooks.findFirst({
				where: (l, { and, eq }) =>
					and(eq(l.id, params.id), eq(l.userId, userId)),
				with: {
					worldLoreEntries: true,
					characterLoreEntries: true,
					historyEntries: true,
					lorebookBindings: true,
					lorebookTags: {
						with: {
							tag: true
						}
					}
				}
			})

			if (!book) {
				const res: Sockets.Lorebooks.Get.Response = {
					lorebook: null,
					worldLoreEntries: [],
					characterLoreEntries: [],
					historyEntries: []
				}
				emitToUser("lorebooks:get", res)
				return res
			}

			// Transform lorebook tags to include tags as string array
			const { lorebookTags, ...bookFields } = book
			const bookWithTags = {
				...bookFields,
				tags: lorebookTags?.map((lt) => lt.tag.name) || []
			}

			const res: Sockets.Lorebooks.Get.Response = {
				lorebook: bookWithTags,
				worldLoreEntries: book.worldLoreEntries,
				characterLoreEntries: book.characterLoreEntries,
				historyEntries: book.historyEntries
			}
			emitToUser("lorebooks:get", res)
			return res
		} catch (error: any) {
			console.error("Error fetching lorebook:", error)
			emitToUser("lorebooks:get:error", {
				error: "Failed to fetch lorebook"
			})
			throw error
		}
	}
}

export const lorebooksUpdateHandler: Handler<
	Sockets.Lorebooks.Update.Params,
	Sockets.Lorebooks.Update.Response
> = {
	event: "lorebooks:update",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Explicit allowlist, not a spread — never writable here: userId
			// (would donate the lorebook into another account), uuid (export/
			// import dedup identity), or nextBindingNumber. That counter is
			// load-bearing for more than "future {{char:N}} collisions": every
			// past bindingMergeLogs entry's absorb/undo restore relies on a
			// binding number never being reissued (see deriveNextBindingToken),
			// so rewinding it here would silently invalidate the restore-safety
			// proof for every merge already on record for this lorebook.
			const { name, description, extraJson } = params.lorebook

			// Update the lorebook
			const [updated] = await db
				.update(schema.lorebooks)
				.set({
					...(name !== undefined ? { name } : {}),
					...(description !== undefined ? { description } : {}),
					...(extraJson !== undefined ? { extraJson } : {})
				})
				.where(
					and(
						eq(schema.lorebooks.id, params.lorebook.id!),
						eq(schema.lorebooks.userId, userId)
					)
				)
				.returning()

			if (!updated) {
				throw new Error("Lorebook not found or not owned by user")
			}

			const res: Sockets.Lorebooks.Update.Response = {
				lorebook: updated
			}
			emitToUser("lorebooks:update", res)
			await lorebooksListHandler.handler(socket, {}, emitToUser) // Refresh list
			return res
		} catch (error: any) {
			console.error("Error updating lorebook:", error)
			emitToUser("lorebooks:update:error", {
				error: "Failed to update lorebook"
			})
			throw error
		}
	}
}

export const lorebooksDeleteHandler: Handler<
	Sockets.Lorebooks.Delete.Params,
	Sockets.Lorebooks.Delete.Response
> = {
	event: "lorebooks:delete",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Delete the lorebook
			await db
				.delete(schema.lorebooks)
				.where(
					and(
						eq(schema.lorebooks.id, params.id),
						eq(schema.lorebooks.userId, userId)
					)
				)

			const res: Sockets.Lorebooks.Delete.Response = {
				success: "Lorebook deleted successfully"
			}
			emitToUser("lorebooks:delete", res)
			await lorebooksListHandler.handler(socket, {}, emitToUser) // Refresh list
			return res
		} catch (error: any) {
			console.error("Error deleting lorebook:", error)
			const res: Sockets.Lorebooks.Delete.Response = {
				error: "Failed to delete lorebook"
			}
			emitToUser("lorebooks:delete:error", res)
			throw error
		}
	}
}

/**
 * Auto-creates a lorebookBindings row for any {{char:N}}-style token found
 * in stored content that doesn't already have one. Never deletes a row —
 * a prior "delete any binding whose token isn't literally present in
 * content anymore" heuristic here was removed (same false-positive class
 * removed from the graph-rebuild path this session): bindingMergeLogs
 * references node ids as plain JSON with no real FK, so deleting one left
 * relationship endpoints dangling, or silently nulled a past merge's
 * survivorId, permanently disabling that merge's undo, on completely
 * routine lore edits. Manual per-node deletion via
 * narrativeGraph:deleteNode remains the only way to remove an unwanted
 * node.
 */
export async function syncLorebookBindings({
	lorebookId
}: {
	lorebookId: number
}) {
	const queries: (() => Promise<any>)[] = []
	// Query all lorebook bindings for the given lorebook
	const existingBindings = await db.query.lorebookBindings.findMany({
		where: (b, { eq }) => eq(b.lorebookId, lorebookId),
		columns: { id: true, binding: true }
	})
	// Query all world, character and history entries for the given lorebook
	const worldEntries = await db.query.worldLoreEntries.findMany({
		where: (e, { eq }) => eq(e.lorebookId, lorebookId)
	})
	const characterEntries = await db.query.characterLoreEntries.findMany({
		where: (e, { eq }) => eq(e.lorebookId, lorebookId)
	})
	const historyEntries = await db.query.historyEntries.findMany({
		where: (e, { eq }) => eq(e.lorebookId, lorebookId)
	})
	// Create a list of all unique lorebook bindings from the entries
	const foundBindings: string[] = []
	for (const entry of [
		...worldEntries,
		...characterEntries,
		...historyEntries
	]) {
		// use regex to find all {{char:1}}, {{char:2}}, {char:1}, {char:2}, etc. bindings in the entry content
		const rgx: RegExp = /\{\{?(\w+):(\d+)\}?\}/g // Matches both {{char:1}} and {char:1} (deprecated)
		let match: RegExpExecArray | null
		while ((match = rgx.exec(entry.content)) !== null) {
			const binding = `{{${match[1]}:${match[2]}}}` // Store as preferred syntax
			if (!foundBindings.includes(binding)) {
				foundBindings.push(binding)
			}
		}
	}
	// If a binding does not exist in the lorebook bindings, create it without a character or persona
	foundBindings.forEach((fb) => {
		// Check for both {{char:#}} and {char:#} syntax when looking for existing bindings
		const legacyBinding = fb.replace(/\{\{(\w+):(\d+)\}\}/, "{$1:$2}") // Convert {{char:1}} to {char:1}
		const existingBinding = existingBindings.find(
			(eb) => eb.binding === fb || eb.binding === legacyBinding
		)
		if (!existingBinding) {
			queries.push(
				db.insert(schema.lorebookBindings).values({
					lorebookId,
					binding: fb, // Use preferred {{char:#}} syntax
					characterId: null,
					personaId: null
				}) as any as () => Promise<any>
			)
			// This binding wasn't minted via deriveNextBindingToken's atomic
			// counter — it came straight from content text (pasted export,
			// manually typed, or a stale reference). binding has no
			// uniqueness constraint, so if the counter later reaches this
			// same number through normal creation, deriveNextBindingToken
			// would issue it again, producing two rows silently sharing one
			// token. Advance the counter past it now so that can't happen.
			const parsedNumber = Number(fb.match(/:(\d+)\}\}$/)?.[1])
			if (Number.isInteger(parsedNumber)) {
				queries.push(
					db
						.update(schema.lorebooks)
						.set({
							nextBindingNumber: sql`GREATEST(${schema.lorebooks.nextBindingNumber}, ${parsedNumber + 1})`
						})
						.where(
							eq(schema.lorebooks.id, lorebookId)
						) as any as () => Promise<any>
				)
			}
		}
	})
	// Execute all queries in parallel
	if (queries.length > 0) {
		await Promise.all(queries)
	}
}

// =============================================
// TYPE-SAFE LOREBOOK HANDLERS
// =============================================

/**
 * Type-safe handler for listing lorebook bindings
 */
export const lorebookBindingListHandler: Handler<
	Sockets.Lorebooks.BindingList.Params,
	Sockets.Lorebooks.BindingList.Response
> = {
	event: "lorebooks:bindingList",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const book = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, params.lorebookId), eq(l.userId, userId)),
			columns: {
				id: true
			},
			with: {
				lorebookBindings: {
					with: {
						character: true,
						persona: true
					}
				}
			}
		})

		if (!book) throw new Error("Lorebook not found.")

		const res: Sockets.Lorebooks.BindingList.Response = {
			lorebookId: book.id,
			lorebookBindingList: book.lorebookBindings
		}

		if (emitToUser) {
			emitToUser("lorebooks:bindingList", res)
		}

		return res
	}
}

/**
 * Lorebooks bound to a given character — the candidate list for
 * charactersExportCard's optional lorebook-embedding picker. Deliberately
 * NOT the same as character.lorebookId (a separate, single "attached" book)
 * — a character can be referenced by bindings in several different shared
 * lorebooks at once.
 */
export const lorebookBindingsForCharacterHandler: Handler<
	Sockets.Lorebooks.BindingsForCharacter.Params,
	Sockets.Lorebooks.BindingsForCharacter.Response
> = {
	event: "lorebooks:bindingsForCharacter",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			const character = await db.query.characters.findFirst({
				where: eq(schema.characters.id, params.characterId),
				columns: { id: true, userId: true }
			})
			if (!character) throw new Error("Character not found.")
			if (
				character.userId !== userId &&
				!(await canViewCharacter(params.characterId, userId))
			) {
				throw new Error("Character not found.")
			}

			const bindings = await db.query.lorebookBindings.findMany({
				where: eq(
					schema.lorebookBindings.characterId,
					params.characterId
				),
				with: {
					lorebook: {
						columns: { id: true, name: true, userId: true }
					}
				}
			})

			const seen = new Set<number>()
			const lorebooks = bindings
				.map((b) => b.lorebook)
				// Only this user's own lorebooks are exportable candidates —
				// a binding could in principle reference a lorebook owned by
				// whoever the character was shared with, not the exporter.
				.filter(
					(lb): lb is NonNullable<typeof lb> =>
						!!lb && lb.userId === userId
				)
				.filter((lb) =>
					seen.has(lb.id) ? false : (seen.add(lb.id), true)
				)
				.map((lb) => ({ id: lb.id, name: lb.name }))

			const res: Sockets.Lorebooks.BindingsForCharacter.Response = {
				characterId: params.characterId,
				lorebooks
			}
			emitToUser("lorebooks:bindingsForCharacter", res)
			return res
		} catch (error: any) {
			console.error(
				"Error fetching lorebook bindings for character:",
				error
			)
			emitToUser("lorebooks:bindingsForCharacter:error", {
				error:
					error.message || "Failed to fetch lorebooks for character."
			})
			throw error
		}
	}
}

/**
 * Type-safe handler for creating lorebook binding
 */
// A lorebook binding resolves a placeholder like {{char:1}} to a real
// character/persona's name/data — without this check, any characterId or
// personaId could be supplied regardless of who it belongs to, and the
// bound entity's name/aliases/summary would later be disclosed through the
// binding (and copied into narrative-graph nodes derived from it).
export async function verifyBindingTargetAccess(
	binding: { characterId?: number | null; personaId?: number | null },
	userId: number
): Promise<boolean> {
	if (binding.characterId) {
		const character = await db.query.characters.findFirst({
			where: eq(schema.characters.id, binding.characterId),
			columns: { userId: true }
		})
		if (!character) return false
		if (character.userId === userId) return true
		return await canViewCharacter(binding.characterId, userId)
	}
	if (binding.personaId) {
		const persona = await db.query.personas.findFirst({
			where: eq(schema.personas.id, binding.personaId),
			columns: { userId: true }
		})
		if (!persona) return false
		if (persona.userId === userId) return true
		return await canViewPersona(binding.personaId, userId)
	}
	return true
}

export const createLorebookBindingHandler: Handler<
	Sockets.Lorebooks.CreateBinding.Params,
	Sockets.Lorebooks.CreateBinding.Response
> = {
	event: "lorebooks:createBinding",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const book = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(
					eq(l.id, params.lorebookBinding.lorebookId),
					eq(l.userId, userId)
				)
		})

		if (!book) throw new Error("Lorebook not found.")

		if (
			!(await verifyBindingTargetAccess(params.lorebookBinding, userId))
		) {
			throw new Error(
				"Access denied. You don't have permission to bind that character or persona."
			)
		}

		// `binding` is never trusted from the client — the token is always
		// server-derived from the row's own real id (never reused after a
		// delete, unlike the old max+1 scheme). `name`/`aliases` are only
		// stripped when the row is bound to a real character/persona — for
		// that case they must only ever come from the entity sync below,
		// never a direct write (decision 2). An unbound/background row has
		// no entity to sync from, so its name is exactly what the client
		// supplies here — the only way to name a background character.
		// embedding/embeddingModel/vectorizedAt/absorbedAliases/createdAt/
		// updatedAt are never client-writable either — all server-derived
		// or pipeline-owned.
		const isBound = !!params.lorebookBinding.characterId ||
			!!params.lorebookBinding.personaId
		const {
			binding: _ignoredBinding,
			embedding: _ignoredEmbedding,
			embeddingModel: _ignoredEmbeddingModel,
			vectorizedAt: _ignoredVectorizedAt,
			absorbedAliases: _ignoredAbsorbedAliases,
			createdAt: _ignoredCreatedAt,
			updatedAt: _ignoredUpdatedAt,
			...rest
		} = params.lorebookBinding
		const safeInsert = isBound
			? (({ name, aliases, ...r }) => r)(rest)
			: rest

		await validateBindingCrossRefs(
			safeInsert,
			params.lorebookBinding.lorebookId
		)

		let binding = await db.transaction(async (tx) => {
			const token = await deriveNextBindingToken(
				params.lorebookBinding.lorebookId,
				tx
			)
			const [inserted] = await tx
				.insert(schema.lorebookBindings)
				.values({ ...safeInsert, binding: token })
				.returning()
			return inserted
		})

		// Attach-time sync: a fresh characterId/personaId attachment should
		// pull in that entity's name/aliases immediately. Re-fetch afterward
		// so the response/emitted row reflects the synced name/aliases
		// rather than the pre-sync (empty) values captured by the INSERT's
		// own .returning().
		if (binding.characterId) {
			await syncLorebookBindingsForCharacter(binding.characterId)
			;[binding] = await db
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, binding.id))
		} else if (binding.personaId) {
			await syncLorebookBindingsForPersona(binding.personaId)
			;[binding] = await db
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, binding.id))
		}

		// Refresh binding list
		if (emitToUser) {
			const listResult = await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: book.id },
				emitToUser
			)
			emitToUser("lorebooks:bindingList", listResult)
		}

		const res: Sockets.Lorebooks.CreateBinding.Response = {
			lorebookBinding: binding
		}

		if (emitToUser) {
			emitToUser("lorebooks:createBinding", res)
		}

		return res
	}
}

/**
 * Type-safe handler for updating lorebook binding
 */
export const updateLorebookBindingHandler: Handler<
	Sockets.Lorebooks.UpdateBinding.Params,
	Sockets.Lorebooks.UpdateBinding.Response
> = {
	event: "lorebooks:updateBinding",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		// Check if binding exists and user owns the lorebook
		const existingBinding = await db.query.lorebookBindings.findFirst({
			where: (lb, { eq }) => eq(lb.id, params.lorebookBinding.id!)
		})

		if (!existingBinding) {
			throw new Error("Lorebook binding not found.")
		}

		const lorebookOwner = await db.query.lorebooks.findFirst({
			where: and(
				eq(schema.lorebooks.id, existingBinding.lorebookId),
				eq(schema.lorebooks.userId, userId)
			),
			columns: { id: true }
		})

		if (!lorebookOwner) {
			throw new Error("Access denied.")
		}

		if (
			!(await verifyBindingTargetAccess(params.lorebookBinding, userId))
		) {
			throw new Error(
				"Access denied. You don't have permission to bind that character or persona."
			)
		}

		// `binding` is never client-writable here either — an existing token
		// is never rewritten (decision 1's preservation guarantee). `name`/
		// `aliases` are only stripped when the row is (or is becoming, via
		// this same update) bound to a real character/persona — that case's
		// name/aliases only ever come from the entity sync below. A row
		// that's unbound both before and after this update has no entity to
		// sync from, so its name is exactly what the client supplies here —
		// the only way to rename a background character after creation.
		const willBeBound =
			(params.lorebookBinding.characterId !== undefined
				? params.lorebookBinding.characterId
				: existingBinding.characterId) != null ||
			(params.lorebookBinding.personaId !== undefined
				? params.lorebookBinding.personaId
				: existingBinding.personaId) != null
		// lorebookId is deliberately excluded too — ownership is only
		// verified against the binding's *current* lorebook above; a
		// client-supplied replacement value here would let a user relocate
		// their own binding (and any bound character/persona) into a
		// lorebook they don't own with no re-validation.
		// embedding/embeddingModel/vectorizedAt/absorbedAliases/createdAt/
		// updatedAt are never client-writable either — all server-derived
		// or pipeline-owned.
		const {
			binding: _ignoredBinding,
			lorebookId: _ignoredLorebookId,
			embedding: _ignoredEmbedding,
			embeddingModel: _ignoredEmbeddingModel,
			vectorizedAt: _ignoredVectorizedAt,
			absorbedAliases: _ignoredAbsorbedAliases,
			createdAt: _ignoredCreatedAt,
			updatedAt: _ignoredUpdatedAt,
			...restUpdate
		} = params.lorebookBinding
		const safeUpdate = willBeBound
			? (({ name, aliases, ...r }) => r)(restUpdate)
			: restUpdate

		await validateBindingCrossRefs(safeUpdate, existingBinding.lorebookId)

		let [updatedBinding] = await db
			.update(schema.lorebookBindings)
			.set(safeUpdate)
			.where(eq(schema.lorebookBindings.id, params.lorebookBinding.id!))
			.returning()

		// Attach-time sync: a fresh characterId/personaId attachment should
		// pull in that entity's name/aliases immediately, not wait for an
		// unrelated future edit to that entity. Re-fetch afterward so the
		// response/emitted row reflects the synced name/aliases rather than
		// the pre-sync values captured by the UPDATE's own .returning().
		if (updatedBinding.characterId) {
			await syncLorebookBindingsForCharacter(updatedBinding.characterId)
			;[updatedBinding] = await db
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, updatedBinding.id))
		} else if (updatedBinding.personaId) {
			await syncLorebookBindingsForPersona(updatedBinding.personaId)
			;[updatedBinding] = await db
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, updatedBinding.id))
		}

		// Refresh binding list
		if (emitToUser) {
			const listResult = await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: existingBinding.lorebookId },
				emitToUser
			)
			emitToUser("lorebooks:bindingList", listResult)
		}

		const res: Sockets.Lorebooks.UpdateBinding.Response = {
			lorebookBinding: updatedBinding
		}

		if (emitToUser) {
			emitToUser("lorebooks:updateBinding", res)
		}

		return res
	}
}

/**
 * Resolves a name suggested on the summarize Review & Save screen (either
 * from character extraction or manually typed) to a real lorebookBindings
 * id, creating one only if it doesn't already match something in the
 * lorebook's current cast — see resolveOrCreateBindingByName's own doc
 * comment for why this has to be a save-time, server-side check rather than
 * a client-side "just create it" call.
 */
export const resolveOrCreateBindingByNameHandler: Handler<
	Sockets.Lorebooks.ResolveOrCreateBindingByName.Params,
	Sockets.Lorebooks.ResolveOrCreateBindingByName.Response
> = {
	event: "lorebooks:resolveOrCreateBindingByName",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		const book = await db.query.lorebooks.findFirst({
			where: (l, { and, eq }) =>
				and(eq(l.id, params.lorebookId), eq(l.userId, userId))
		})
		if (!book) throw new Error("Lorebook not found.")

		const { id, created } = await resolveOrCreateBindingByName(
			params.lorebookId,
			params.name
		)

		// A matched-existing result changed nothing, so only a genuinely new
		// row needs to push a binding-list refresh to other viewers.
		if (created && emitToUser) {
			const listResult = await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: params.lorebookId },
				emitToUser
			)
			emitToUser("lorebooks:bindingList", listResult)
		}

		const res: Sockets.Lorebooks.ResolveOrCreateBindingByName.Response = {
			lorebookBindingId: id,
			created,
			requestId: params.requestId
		}

		if (emitToUser) {
			emitToUser("lorebooks:resolveOrCreateBindingByName", res)
		}

		return res
	}
}

/**
 * ====================================================================
 * LOREBOOK EXPORT / IMPORT TYPE-SAFE HANDLERS
 * ====================================================================
 */

export const lorebookExportHandler: Handler<
	Sockets.Lorebooks.Export.Params,
	Sockets.Lorebooks.Export.Response
> = {
	event: "lorebooks:export",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			const { name, specBookWithGraph } = await buildLorebookExportData(
				params.id,
				userId,
				{
					includeCharacters: params.includeCharacters,
					includePersonas: params.includePersonas,
					includeNarrativeGraph: params.includeNarrativeGraph
				}
			)

			const jsonString = JSON.stringify(specBookWithGraph, null, 2)
			const blob = Buffer.from(jsonString, "utf-8")
			const filename = `${name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.v3.json`

			const res: Sockets.Lorebooks.Export.Response = { blob, filename }
			emitToUser("lorebooks:export", res)
			return res
		} catch (error: any) {
			console.error("Error exporting lorebook:", error)
			emitToUser("lorebooks:export:error", {
				error: error.message || "Failed to export lorebook."
			})
			throw error
		}
	}
}

// Reads scan_depth/token_budget/recursive_scanning from the RAW import
// payload rather than the parsed CharacterBook instance —
// CharacterBook.from_json backfills these with hardcoded defaults
// (recursive_scanning ?? true, scan_depth ?? 10) when absent, which would
// otherwise get stored as if they were genuine source data and pollute
// every future re-export/hash-comparison with fabricated values.
function extractLorebookLevelExtraJson(rawData: any): Record<string, any> {
	return {
		...(rawData?.scan_depth !== undefined
			? { scanDepth: rawData.scan_depth }
			: {}),
		...(rawData?.token_budget !== undefined
			? { tokenBudget: rawData.token_budget }
			: {}),
		...(rawData?.recursive_scanning !== undefined
			? { recursiveScanning: rawData.recursive_scanning }
			: {})
	}
}

// Generous-but-bounded caps on a single lorebook import's item counts —
// below Socket.IO's blanket 100MB maxHttpBufferSize, this is the only thing
// stopping a crafted payload (tens of thousands of entries, or embedded
// characters each triggering a full character-creation flow) from hammering
// the DB well within that transport-level ceiling.
const LOREBOOK_IMPORT_LIMITS = {
	maxEntries: 5000,
	maxCharacters: 200,
	maxPersonas: 200,
	maxNarrativeNodes: 5000,
	maxNarrativeRelationships: 5000
} as const

/** Rejects an oversized import up front, before any DB work begins. */
function assertLorebookImportWithinLimits(
	card: CharacterBook,
	lorebookData: any
) {
	const serenepub = (lorebookData as any)?.extensions?.serenepub
	const entryCount = Array.isArray(card.entries) ? card.entries.length : 0
	const characterCount = Array.isArray(serenepub?.characters)
		? serenepub.characters.length
		: 0
	const personaCount = Array.isArray(serenepub?.personas)
		? serenepub.personas.length
		: 0
	const graph = serenepub?.narrativeGraph
	const nodeCount = Array.isArray(graph?.nodes) ? graph.nodes.length : 0
	const relationshipCount = Array.isArray(graph?.relationships)
		? graph.relationships.length
		: 0

	if (entryCount > LOREBOOK_IMPORT_LIMITS.maxEntries) {
		throw new Error(
			`Lorebook has too many entries (${entryCount}); the maximum supported is ${LOREBOOK_IMPORT_LIMITS.maxEntries}.`
		)
	}
	if (characterCount > LOREBOOK_IMPORT_LIMITS.maxCharacters) {
		throw new Error(
			`Lorebook embeds too many characters (${characterCount}); the maximum supported is ${LOREBOOK_IMPORT_LIMITS.maxCharacters}.`
		)
	}
	if (personaCount > LOREBOOK_IMPORT_LIMITS.maxPersonas) {
		throw new Error(
			`Lorebook embeds too many personas (${personaCount}); the maximum supported is ${LOREBOOK_IMPORT_LIMITS.maxPersonas}.`
		)
	}
	if (nodeCount > LOREBOOK_IMPORT_LIMITS.maxNarrativeNodes) {
		throw new Error(
			`Lorebook's narrative graph has too many nodes (${nodeCount}); the maximum supported is ${LOREBOOK_IMPORT_LIMITS.maxNarrativeNodes}.`
		)
	}
	if (relationshipCount > LOREBOOK_IMPORT_LIMITS.maxNarrativeRelationships) {
		throw new Error(
			`Lorebook's narrative graph has too many relationships (${relationshipCount}); the maximum supported is ${LOREBOOK_IMPORT_LIMITS.maxNarrativeRelationships}.`
		)
	}
}

/**
 * Restores embedded characters/personas/bindings from a parsed lorebook's
 * extensions.serenepub (Part 2.5), in dependency order. Each embedded
 * character/persona goes through the same uuid+hash dedup logic as a
 * direct characters:importCard/personas:importCard — reused directly
 * rather than re-implemented — except a hash mismatch here silently
 * *overwrites* the existing row instead of prompting: the containing
 * lorebook import already went through its own Overwrite/Import-as-new
 * decision, and a second per-embedded-entity prompt would be poor UX, so
 * bound entities just follow the same fate as their lorebook.
 *
 * Returns a map from each binding's exported localId to its newly-created
 * real lorebookBindings id, so character-lore entries (which reference
 * bindings by localId) can be wired up by insertLorebookEntries afterward,
 * plus the sets of character/persona ids that got bound — name/alias sync
 * for those (see below) is deliberately deferred to the caller rather than
 * done here.
 */
async function restoreBoundEntities(
	lorebookId: number,
	serenepub: any,
	userId: number,
	dbOrTx: Executor = db
): Promise<{
	bindingLocalIdToRealId: Map<number, number>
	syncCharacterIds: Set<number>
	syncPersonaIds: Set<number>
	boundEntityByRealId: Map<
		number,
		{ characterId: number | null; personaId: number | null }
	>
}> {
	const bindingLocalIdToRealId = new Map<number, number>()
	const syncCharacterIds = new Set<number>()
	const syncPersonaIds = new Set<number>()
	const boundEntityByRealId = new Map<
		number,
		{ characterId: number | null; personaId: number | null }
	>()
	const rawBindings = serenepub?.bindings
	if (!Array.isArray(rawBindings)) {
		return {
			bindingLocalIdToRealId,
			syncCharacterIds,
			syncPersonaIds,
			boundEntityByRealId
		}
	}

	const characterLocalIdToRealId = new Map<number, number>()
	for (const embedded of serenepub?.characters ?? []) {
		const cardData = embedded?.card?.data
		if (!cardData) continue
		const character = await resolveOrOverwriteEmbeddedCharacter(
			cardData,
			userId,
			dbOrTx
		)
		characterLocalIdToRealId.set(embedded.localId, character.id)
	}

	const personaLocalIdToRealId = new Map<number, number>()
	for (const embedded of serenepub?.personas ?? []) {
		const cardData = embedded?.card
		if (!cardData) continue
		const persona = await resolveOrOverwriteEmbeddedPersona(
			cardData,
			userId,
			dbOrTx
		)
		personaLocalIdToRealId.set(embedded.localId, persona.id)
	}

	for (const binding of rawBindings) {
		const characterId =
			binding.characterLocalId != null
				? (characterLocalIdToRealId.get(binding.characterLocalId) ??
					null)
				: null
		const personaId =
			binding.personaLocalId != null
				? (personaLocalIdToRealId.get(binding.personaLocalId) ?? null)
				: null

		const [row] = await dbOrTx
			.insert(schema.lorebookBindings)
			.values({
				lorebookId,
				characterId,
				personaId,
				binding: binding.bindingText || "{{char:1}}"
			})
			.returning()
		bindingLocalIdToRealId.set(binding.localId, row.id)
		boundEntityByRealId.set(row.id, { characterId, personaId })

		// Every other bound-insert site syncs name/aliases from the entity
		// immediately (see characterBindingSync.ts) — without this, an
		// imported bound row's name stays permanently NULL, and every
		// consumer that displays `name || binding` falls through to the raw
		// {{char:N}} token forever. Deferred to after this transaction
		// commits (see the caller) rather than called here — same
		// inside-tx/outside-tx split resolveOrCreateBinding
		// (characterBindingSync.ts) already uses for this exact call, and
		// these sync helpers' own `dbInstance?: DbLike` type doesn't accept
		// a transaction handle anyway.
		if (characterId) {
			syncCharacterIds.add(characterId)
		} else if (personaId) {
			syncPersonaIds.add(personaId)
		}
	}

	return {
		bindingLocalIdToRealId,
		syncCharacterIds,
		syncPersonaIds,
		boundEntityByRealId
	}
}

async function resolveOrOverwriteEmbeddedCharacter(
	cardData: any,
	userId: number,
	dbOrTx: Executor = db
) {
	const incomingUuid = extractCharacterUuid(cardData)
	if (incomingUuid) {
		const existing = await dbOrTx.query.characters.findFirst({
			where: and(
				eq(schema.characters.uuid, incomingUuid),
				eq(schema.characters.userId, userId)
			),
			columns: { id: true }
		})
		if (existing) {
			const comparison = await buildExistingCharacterComparisonData(
				existing.id,
				dbOrTx
			)
			if (comparison) {
				const { character_book, ...incomingForHash } = cardData
				const existingHash = hashCanonicalJson(
					comparison.comparisonData
				)
				const incomingHash = hashCanonicalJson(incomingForHash)
				if (existingHash === incomingHash) return comparison.character
				return overwriteCharacterFromParsedData(
					existing.id,
					cardData,
					undefined,
					userId,
					dbOrTx
				)
			}
		}
	}
	return createCharacterFromParsedData(cardData, undefined, userId, dbOrTx)
}

async function resolveOrOverwriteEmbeddedPersona(
	cardData: any,
	userId: number,
	dbOrTx: Executor = db
) {
	const incomingUuid = extractPersonaUuid(cardData)
	if (incomingUuid) {
		const existing = await dbOrTx.query.personas.findFirst({
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
					personaFieldsFromParsedData(cardData) as any
				)
			)
			if (existingHash === incomingHash) return existing
			return overwritePersonaFromParsedData(
				existing.id,
				cardData,
				undefined,
				dbOrTx
			)
		}
	}
	return createPersonaFromParsedData(cardData, undefined, userId, dbOrTx)
}

/**
 * Inserts a parsed CharacterBook's entries into the appropriate table
 * (world/character/history), routed per-entry via entryTypeOf(). Shared by
 * both the "create new" and "overwrite" import paths.
 */
interface RestoredHistoryRefs {
	// Export-assigned history-entry localId -> real historyEntries.id.
	historyEntryLocalIdToRealId: Map<number, number>
	// Export-assigned scene localId -> real scenes.id (scenes nest under
	// their owning history entry on export, but narrativeGraph nodes/
	// relationships reference them by their own localId).
	sceneLocalIdToRealId: Map<number, number>
}

async function insertLorebookEntries(
	lorebookId: number,
	entries: any[],
	bindingLocalIdToRealId: Map<number, number>,
	dbOrTx: Executor = db
): Promise<RestoredHistoryRefs> {
	let worldPosition = 0
	let characterPosition = 0
	let historyPosition = 0
	const queries: Promise<any>[] = []
	const historyEntryLocalIdToRealId = new Map<number, number>()
	const sceneLocalIdToRealId = new Map<number, number>()

	for (const entry of entries) {
		const type = entryTypeOf(entry)
		if (type === "character") {
			const bindingLocalId = entry.extensions?.serenepub?.bindingLocalId
			const lorebookBindingId =
				typeof bindingLocalId === "number"
					? (bindingLocalIdToRealId.get(bindingLocalId) ?? null)
					: null
			queries.push(
				dbOrTx.insert(schema.characterLoreEntries).values({
					...mapLorebookEntryToCharacterLoreEntry(
						entry,
						characterPosition
					),
					lorebookId,
					lorebookBindingId
				})
			)
			characterPosition++
		} else if (type === "history") {
			const meta = entry.extensions?.serenepub ?? {}
			queries.push(
				(async () => {
					const [historyRow] = await dbOrTx
						.insert(schema.historyEntries)
						.values({
							...mapLorebookEntryToHistoryEntry(
								entry,
								historyPosition
							),
							lorebookId
						})
						.returning()

					if (typeof meta.localId === "number") {
						historyEntryLocalIdToRealId.set(
							meta.localId,
							historyRow.id
						)
					}

					// Nested scenes — each still gets its own document-scoped
					// localId (see mapHistoryEntry) so narrativeGraph can
					// reference one via sceneLocalId. chatId/
					// selectedMessageIds were deliberately never exported —
					// they're chat-instance-specific and can't round-trip.
					// participantCharacters/mentionedCharacters are binding
					// localIds now (see the merge plan) — resolve back to
					// real ids via the same map bindingLocalId elsewhere in
					// this format uses. A legacy export's name-string arrays
					// silently resolve to nothing here (every entry fails
					// the `=== "number"` check) rather than erroring — the
					// scene still imports, just without its old cast list,
					// consistent with this whole function's best-effort
					// philosophy.
					const scenes = Array.isArray(meta.scenes) ? meta.scenes : []
					const resolveBindingIds = (raw: unknown): number[] =>
						Array.isArray(raw)
							? raw
									.filter(
										(v): v is number => typeof v === "number"
									)
									.map((localId) =>
										bindingLocalIdToRealId.get(localId)
									)
									.filter((id): id is number => id !== undefined)
							: []
					for (const scene of scenes) {
						const [sceneRow] = await dbOrTx
							.insert(schema.scenes)
							.values({
								lorebookId,
								historyEntryId: historyRow.id,
								chatId: null,
								name: scene?.name ?? null,
								selectedMessageIds: [],
								summary: scene?.summary ?? null,
								participantCharacters: resolveBindingIds(
									scene?.participantCharacters
								),
								mentionedCharacters: resolveBindingIds(
									scene?.mentionedCharacters
								)
							})
							.returning()
						if (typeof scene?.localId === "number") {
							sceneLocalIdToRealId.set(scene.localId, sceneRow.id)
						}
					}
				})()
			)
			historyPosition++
		} else {
			queries.push(
				dbOrTx.insert(schema.worldLoreEntries).values({
					...mapLorebookEntryToWorldLoreEntry(entry, worldPosition),
					lorebookId
				})
			)
			worldPosition++
		}
	}

	await Promise.all(queries)
	return { historyEntryLocalIdToRealId, sceneLocalIdToRealId }
}

/**
 * Restores narrativeGraph.nodes/relationships from a parsed lorebook's
 * extensions.serenepub, if present — entirely best-effort. Wrapped in its
 * own try/catch (and each node/relationship in its own, individually) so a
 * malformed entry, a bad reference, or a future schema version this
 * importer doesn't understand yet never fails the surrounding lorebook
 * import; it just gets skipped with a warning.
 *
 * Post-merge (see the lorebookBindings/narrativeNodes merge plan): a
 * "node" entry whose bindingLocalId resolves to an already-restored
 * lorebookBindings row (from restoreBoundEntities, run before this) is no
 * longer a separate INSERT — it's an UPDATE onto that same row, since
 * binding IS the node now. Every real binding row — character/persona-linked
 * AND background — gets a bindingLocalId on export (see
 * lorebookExportBuilder.ts), so this UPDATE path is the normal case for
 * both; only a bindingLocalId-less entry (a pure graph node with no
 * corresponding binding row at all — not expected from a real export today,
 * but tolerated defensively, e.g. legacy/hand-built payloads) actually
 * creates a new row, deriving its token from the lorebook's own
 * per-lorebook counter (see lorebookBindingToken.ts). Whether the UPDATE
 * applies a node's name/aliases depends on whether the restored row is
 * actually character/persona-linked (see boundEntityByRealId below) — a
 * background binding, or one whose card was scoped out of this export via
 * includeCharacters/includePersonas, has no other source for that data and
 * must take it from the graph node. The old characterUuids/characterIds
 * resolution is gone — that field was already vestigial pre-merge
 * (populated on export/import only, never read by any privacy/graph/prompt
 * logic) and has no merged-schema equivalent; a legacy exported file that
 * still has it on a node is simply ignored, not an error.
 */
async function restoreNarrativeGraph(
	lorebookId: number,
	serenepub: any,
	userId: number,
	bindingLocalIdToRealId: Map<number, number>,
	historyRefs: RestoredHistoryRefs,
	boundEntityByRealId: Map<
		number,
		{ characterId: number | null; personaId: number | null }
	>
) {
	try {
		const graph = serenepub?.narrativeGraph
		// Only version 1 is understood today — a future bump just means this
		// block is skipped gracefully until the importer catches up
		// (additive, never breaking).
		if (!graph || graph.version !== 1) return

		const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : []
		const rawRelationships = Array.isArray(graph.relationships)
			? graph.relationships
			: []
		if (rawNodes.length === 0 && rawRelationships.length === 0) return

		// Pass 1: resolve every node to a real lorebookBindings row —
		// update in place if bindingLocalId points at an already-restored
		// binding, otherwise insert a new unbound row. Track localId -> real
		// id either way (a parent may be defined later in the array).
		const nodeLocalIdToRealId = new Map<number, number>()
		for (const node of rawNodes) {
			try {
				const boundRealId =
					typeof node?.bindingLocalId === "number"
						? (bindingLocalIdToRealId.get(node.bindingLocalId) ??
							null)
						: null
				const historyEntryId =
					typeof node?.historyEntryLocalId === "number"
						? (historyRefs.historyEntryLocalIdToRealId.get(
								node.historyEntryLocalId
							) ?? null)
						: null
				const sceneId =
					typeof node?.sceneLocalId === "number"
						? (historyRefs.sceneLocalIdToRealId.get(
								node.sceneLocalId
							) ?? null)
						: null
				const nodeFields = {
					name: node?.name || "",
					nodeState: node?.nodeState || "active",
					nodeVisibility: node?.nodeVisibility || "normal",
					aliases: Array.isArray(node?.aliases) ? node.aliases : [],
					// Unlike name/aliases, absorbedAliases has no other source
					// of truth — characterBindingSync never touches it, even
					// for entity-linked bindings (that's exactly why it's a
					// separate column). So it's always graph-authoritative and
					// must stay out of the entity-linked strip below.
					absorbedAliases: Array.isArray(node?.absorbedAliases)
						? node.absorbedAliases
						: [],
					summary: node?.summary ?? null,
					historyEntryId,
					sceneId
				}

				let realId: number
				if (boundRealId !== null) {
					// A bound row's name/aliases are entity-derived (kept in
					// sync by characterBindingSync, restoreBoundEntities
					// already called it) — never overwritten from graph-node
					// data, same rule createBinding's isBound branch already
					// applies. This only holds for rows actually linked to a
					// character/persona, though — a background binding (or one
					// scoped out of this export via includeCharacters/
					// includePersonas) has no other source for its name/
					// aliases, so the graph node's copy is all that survives
					// and must be applied.
					const boundEntity = boundEntityByRealId.get(boundRealId)
					const isEntityLinked =
						!!boundEntity?.characterId || !!boundEntity?.personaId
					const { name, aliases, ...rest } = nodeFields
					const fieldsToApply = isEntityLinked ? rest : nodeFields
					const [row] = await db
						.update(schema.lorebookBindings)
						.set(fieldsToApply)
						.where(eq(schema.lorebookBindings.id, boundRealId))
						.returning({ id: schema.lorebookBindings.id })
					realId = row.id
				} else {
					const token = await deriveNextBindingToken(lorebookId, db)
					const [inserted] = await db
						.insert(schema.lorebookBindings)
						.values({
							lorebookId,
							characterId: null,
							personaId: null,
							binding: token,
							...nodeFields
						})
						.returning()
					realId = inserted.id
				}

				if (typeof node?.localId === "number") {
					nodeLocalIdToRealId.set(node.localId, realId)
				}
			} catch (e) {
				console.warn(
					"[lorebooks] Skipping malformed narrative node on import:",
					e
				)
			}
		}

		// Pass 2: now that every node exists, resolve parentLocalId links —
		// self-references and 3rd-level chains are dropped by
		// resolveParentNodeLinks (lorebookBindings.parentNodeId is 2-level max).
		const parentLinks = resolveParentNodeLinks(
			rawNodes,
			nodeLocalIdToRealId
		)
		for (const { realId, parentRealId } of parentLinks) {
			try {
				await db
					.update(schema.lorebookBindings)
					.set({ parentNodeId: parentRealId })
					.where(eq(schema.lorebookBindings.id, realId))
			} catch (e) {
				console.warn(
					"[lorebooks] Skipping malformed narrative node parent link on import:",
					e
				)
			}
		}

		for (const rel of rawRelationships) {
			try {
				const fromNodeId = nodeLocalIdToRealId.get(rel?.fromLocalId)
				const toNodeId = nodeLocalIdToRealId.get(rel?.toLocalId)
				// Both endpoints must resolve to a node actually restored above.
				if (!fromNodeId || !toNodeId) continue
				const historyEntryId =
					typeof rel?.historyEntryLocalId === "number"
						? (historyRefs.historyEntryLocalIdToRealId.get(
								rel.historyEntryLocalId
							) ?? null)
						: null
				const sceneId =
					typeof rel?.sceneLocalId === "number"
						? (historyRefs.sceneLocalIdToRealId.get(
								rel.sceneLocalId
							) ?? null)
						: null

				await db.insert(schema.narrativeRelationships).values({
					lorebookId,
					fromNodeId,
					toNodeId,
					relationshipType: rel?.relationshipType || "neutral",
					description: rel?.description || "",
					visibility: rel?.visibility || "acknowledged",
					status: rel?.status || "active",
					reason: rel?.reason ?? null,
					historyEntryId,
					sceneId
				})
			} catch (e) {
				console.warn(
					"[lorebooks] Skipping malformed narrative relationship on import:",
					e
				)
			}
		}
	} catch (e) {
		console.warn(
			"[lorebooks] Narrative graph restoration failed, skipping:",
			e
		)
	}
}

async function fetchCompletedLorebook(lorebookId: number) {
	const completedBook = await db.query.lorebooks.findFirst({
		where: eq(schema.lorebooks.id, lorebookId),
		with: {
			lorebookBindings: true,
			worldLoreEntries: true,
			characterLoreEntries: true,
			historyEntries: true
		}
	})
	if (!completedBook) throw new Error("Failed to retrieve lorebook.")
	return completedBook
}

/**
 * Resolves the uuid a newly-created lorebook row should be stamped with —
 * mirrors claimIncomingCharacterUuid/claimIncomingPersonaUuid.
 * `lorebooks_uuid_idx` is unique per-owner (userId, uuid); a same-user
 * collision means this user already owns a row with that uuid (e.g. the
 * "Import as New" path after a same-user conflict), so falling back to a
 * fresh uuid is always the correct, safe behavior.
 */
async function claimIncomingLorebookUuid(
	incomingUuid: string | undefined,
	userId: number,
	dbOrTx: Executor
): Promise<string | undefined> {
	if (!incomingUuid) return undefined
	const existing = await dbOrTx.query.lorebooks.findFirst({
		where: and(
			eq(schema.lorebooks.uuid, incomingUuid),
			eq(schema.lorebooks.userId, userId)
		),
		columns: { id: true }
	})
	return existing ? undefined : incomingUuid
}

/** Creates a brand-new lorebook (+ bound entities, bindings, entries) from a parsed CharacterBook. */
async function createLorebookFromParsedCard(
	card: CharacterBook,
	rawData: any,
	userId: number,
	uuid?: string
) {
	// The insert + bound-entity/entry restoration must be atomic — a
	// failure partway through (a malformed embedded character card, a
	// transient DB error) previously left an orphaned, partially-populated
	// lorebook with no way to retry cleanly. Kept OUT of this transaction,
	// deliberately: the bound-entity name/alias sync (see
	// characterBindingSync.ts's own resolveOrCreateBinding, which already
	// splits the same way) and restoreNarrativeGraph — the latter's own
	// per-node/per-relationship try/catch swallows individual failures so
	// one malformed graph node doesn't fail the whole import, a resilience
	// property that would break if it ran inside this shared transaction
	// (a caught-but-unhandled statement failure still poisons the rest of
	// a Postgres transaction, which would silently roll back everything
	// else restored above it once the outer transaction tried to commit).
	const {
		book,
		bindingLocalIdToRealId,
		historyRefs,
		syncCharacterIds,
		syncPersonaIds,
		boundEntityByRealId
	} = await db.transaction(async (tx) => {
			const uuidToStamp = await claimIncomingLorebookUuid(uuid, userId, tx)
			const [book] = await tx
				.insert(schema.lorebooks)
				.values({
					name: card.name || "Imported Lorebook",
					description: card.description,
					userId,
					extraJson: extractLorebookLevelExtraJson(rawData),
					// Preserves the imported file's own uuid (when it has one
					// and this user doesn't already own a row with it — see
					// claimIncomingLorebookUuid) so a future re-import of this
					// exact file can find it again. Omitting this left every
					// "created" import with a random DB-default uuid instead,
					// silently defeating that dedup on the very next re-import
					// of an unedited file.
					...(uuidToStamp ? { uuid: uuidToStamp } : {})
				})
				.returning()

			const {
				bindingLocalIdToRealId,
				syncCharacterIds,
				syncPersonaIds,
				boundEntityByRealId
			} = await restoreBoundEntities(
				book.id,
				card.extensions?.serenepub,
				userId,
				tx
			)
			const historyRefs = await insertLorebookEntries(
				book.id,
				card.entries,
				bindingLocalIdToRealId,
				tx
			)
			return {
				book,
				bindingLocalIdToRealId,
				historyRefs,
				syncCharacterIds,
				syncPersonaIds,
				boundEntityByRealId
			}
		})

	for (const characterId of syncCharacterIds) {
		await syncLorebookBindingsForCharacter(characterId)
	}
	for (const personaId of syncPersonaIds) {
		await syncLorebookBindingsForPersona(personaId)
	}
	await restoreNarrativeGraph(
		book.id,
		card.extensions?.serenepub,
		userId,
		bindingLocalIdToRealId,
		historyRefs,
		boundEntityByRealId
	)
	return fetchCompletedLorebook(book.id)
}

/**
 * Overwrites an existing lorebook's metadata + entries wholesale from a
 * parsed CharacterBook — simplest, most predictable "Overwrite" semantics.
 * Bindings are wiped and recreated the same way entries are; the bound
 * characters/personas themselves are resolved via restoreBoundEntities's
 * own uuid+hash dedup (reused, not re-created wholesale).
 */
async function overwriteLorebookFromParsedCard(
	existingId: number,
	card: CharacterBook,
	rawData: any,
	userId: number
) {
	// Same atomicity boundary as createLorebookFromParsedCard above — the
	// deletes and the rebuild must commit together or not at all, or a
	// failure partway through leaves the lorebook's old content already
	// gone with only some/none of the new content in its place. See that
	// function's comment for why restoreNarrativeGraph and the bound-entity
	// sync calls stay outside this transaction.
	const {
		bindingLocalIdToRealId,
		historyRefs,
		syncCharacterIds,
		syncPersonaIds,
		boundEntityByRealId
	} = await db.transaction(async (tx) => {
			await tx
				.update(schema.lorebooks)
				.set({
					name: card.name || "Imported Lorebook",
					description: card.description,
					extraJson: extractLorebookLevelExtraJson(rawData)
				})
				.where(eq(schema.lorebooks.id, existingId))

			await tx
				.delete(schema.worldLoreEntries)
				.where(eq(schema.worldLoreEntries.lorebookId, existingId))
			await tx
				.delete(schema.characterLoreEntries)
				.where(eq(schema.characterLoreEntries.lorebookId, existingId))
			await tx
				.delete(schema.historyEntries)
				.where(eq(schema.historyEntries.lorebookId, existingId))
			// narrativeRelationships before lorebookBindings — relationships FK
			// straight to bindings, not lorebookId-cascaded on binding deletion
			// (deleting bindings first would cascade-delete them anyway via
			// onDelete: cascade, but explicit ordering keeps this readable). Post-
			// merge, this single lorebookBindings delete covers what used to be two
			// separate deletes (bindings + narrativeNodes) — see the merge plan.
			await tx
				.delete(schema.narrativeRelationships)
				.where(eq(schema.narrativeRelationships.lorebookId, existingId))
			await tx
				.delete(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, existingId))

			const {
				bindingLocalIdToRealId,
				syncCharacterIds,
				syncPersonaIds,
				boundEntityByRealId
			} = await restoreBoundEntities(
				existingId,
				card.extensions?.serenepub,
				userId,
				tx
			)
			const historyRefs = await insertLorebookEntries(
				existingId,
				card.entries,
				bindingLocalIdToRealId,
				tx
			)
			return {
				bindingLocalIdToRealId,
				historyRefs,
				syncCharacterIds,
				syncPersonaIds,
				boundEntityByRealId
			}
		})

	for (const characterId of syncCharacterIds) {
		await syncLorebookBindingsForCharacter(characterId)
	}
	for (const personaId of syncPersonaIds) {
		await syncLorebookBindingsForPersona(personaId)
	}
	await restoreNarrativeGraph(
		existingId,
		card.extensions?.serenepub,
		userId,
		bindingLocalIdToRealId,
		historyRefs,
		boundEntityByRealId
	)
	return fetchCompletedLorebook(existingId)
}

export const lorebookImportHandler: Handler<
	Sockets.Lorebooks.Import.Params,
	Sockets.Lorebooks.Import.Response
> = {
	event: "lorebooks:import",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Normalizes legacy shapes (object-keyed entries, singular
			// key/keysecondary fields) that CharacterBook.from_json() on its
			// own would silently turn into an empty book rather than error on.
			const lorebookData = normalizeLegacyLorebookData(
				params.lorebookData
			)
			const card = CharacterBook.from_json(lorebookData)
			if (!card) {
				throw new Error("No lorebook data provided.")
			}
			assertLorebookImportWithinLimits(card, lorebookData)

			const rawIncomingUuid = (lorebookData as any)?.extensions?.serenepub
				?.uuid
			const incomingUuid = isValidUuid(rawIncomingUuid)
				? rawIncomingUuid
				: undefined

			if (incomingUuid) {
				const existing = await db.query.lorebooks.findFirst({
					where: and(
						eq(schema.lorebooks.uuid, incomingUuid),
						eq(schema.lorebooks.userId, userId)
					),
					with: {
						worldLoreEntries: true,
						characterLoreEntries: true,
						historyEntries: true
					}
				})

				if (existing) {
					// Compared against the RAW incoming payload, not the parsed
					// CharacterBook — CharacterBook.from_json backfills several
					// fields with hardcoded defaults, which would otherwise make
					// an untouched re-import look "changed" against a freshly
					// rebuilt export of the unchanged existing row. Uses the same
					// buildLorebookExportData a real export uses (bindings/
					// characters/personas/narrativeGraph attached), not a bare
					// buildSpecV3Lorebook — otherwise a straight, unedited
					// re-import would always hash differently from what was
					// actually exported and never report "unchanged".
					const { specBookWithGraph: existingExportData } =
						await buildLorebookExportData(existing.id, userId)
					const existingHash = hashCanonicalJson(existingExportData)
					const incomingHash = hashCanonicalJson(lorebookData)

					if (existingHash === incomingHash) {
						const res: Sockets.Lorebooks.Import.Response = {
							status: "unchanged",
							lorebook: existing
						}
						emitToUser("lorebooks:import", res)
						return res
					}

					const res: Sockets.Lorebooks.Import.Response = {
						status: "conflict",
						lorebook: null,
						conflict: {
							existingLorebook: existing,
							lorebookData
						}
					}
					emitToUser("lorebooks:import", res)
					return res
				}
			}

			const completedBook = await createLorebookFromParsedCard(
				card,
				lorebookData,
				userId,
				incomingUuid
			)

			if (emitToUser) {
				const lorebookListResult = await lorebooksListHandler.handler(
					socket,
					{ userId },
					emitToUser
				)
				emitToUser("lorebooks:list", lorebookListResult)
			}

			const res: Sockets.Lorebooks.Import.Response = {
				status: "created",
				lorebook: completedBook
			}
			emitToUser("lorebooks:import", res)
			return res
		} catch (error: any) {
			console.error("Error importing lorebook:", error)
			emitToUser("lorebooks:import:error", {
				error: error.message || "Failed to import lorebook."
			})
			throw error
		}
	}
}

/**
 * Carries out the user's choice after lorebooks:import returned a
 * "conflict" status — either overwrite the existing (uuid-matched) lorebook
 * in place, or import the payload as a brand-new lorebook with a fresh uuid.
 */
export const lorebookImportResolveHandler: Handler<
	Sockets.Lorebooks.ImportResolve.Params,
	Sockets.Lorebooks.ImportResolve.Response
> = {
	event: "lorebooks:importResolve",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			const lorebookData = normalizeLegacyLorebookData(
				params.lorebookData
			)
			const card = CharacterBook.from_json(lorebookData)
			if (!card) {
				throw new Error("No lorebook data provided.")
			}
			assertLorebookImportWithinLimits(card, lorebookData)

			let completedBook
			if (params.action === "overwrite") {
				const existing = await db.query.lorebooks.findFirst({
					where: and(
						eq(schema.lorebooks.id, params.existingId),
						eq(schema.lorebooks.userId, userId)
					),
					columns: { id: true }
				})
				if (!existing) {
					throw new Error("Lorebook not found.")
				}
				completedBook = await overwriteLorebookFromParsedCard(
					existing.id,
					card,
					lorebookData,
					userId
				)
			} else {
				const rawIncomingUuid = (lorebookData as any)?.extensions
					?.serenepub?.uuid
				const incomingUuid = isValidUuid(rawIncomingUuid)
					? rawIncomingUuid
					: undefined
				completedBook = await createLorebookFromParsedCard(
					card,
					lorebookData,
					userId,
					incomingUuid
				)
			}

			if (emitToUser) {
				const lorebookListResult = await lorebooksListHandler.handler(
					socket,
					{ userId },
					emitToUser
				)
				emitToUser("lorebooks:list", lorebookListResult)
			}

			const res: Sockets.Lorebooks.ImportResolve.Response = {
				lorebook: completedBook
			}
			emitToUser("lorebooks:importResolve", res)
			return res
		} catch (error: any) {
			console.error("Error resolving lorebook import conflict:", error)
			emitToUser("lorebooks:importResolve:error", {
				error: error.message || "Failed to resolve lorebook import."
			})
			throw error
		}
	}
}

// Registration function for all lorebook handlers
export function registerLorebookHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	// Core lorebook handlers
	register(socket, lorebooksListHandler, emitToUser)
	register(socket, lorebooksCreateHandler, emitToUser)
	register(socket, lorebooksGetHandler, emitToUser)
	register(socket, lorebooksUpdateHandler, emitToUser)
	register(socket, lorebooksDeleteHandler, emitToUser)

	// Lorebook binding handlers
	register(socket, lorebookBindingListHandler, emitToUser)
	register(socket, lorebookBindingsForCharacterHandler, emitToUser)
	register(socket, createLorebookBindingHandler, emitToUser)
	register(socket, updateLorebookBindingHandler, emitToUser)
	register(socket, resolveOrCreateBindingByNameHandler, emitToUser)

	// Lorebook export / import handlers
	register(socket, lorebookExportHandler, emitToUser)
	register(socket, lorebookImportHandler, emitToUser)
	register(socket, lorebookImportResolveHandler, emitToUser)
}
