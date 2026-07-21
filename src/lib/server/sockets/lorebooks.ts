import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray } from "drizzle-orm"
import { runBindingNodeCheck } from "$lib/server/utils/bindingNodeCheck"
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
import {
	buildSpecV3Lorebook,
	assignHistoryEntryLocalIds,
	attachBoundEntities,
	mapSceneForExport,
	mapNarrativeNode,
	mapNarrativeRelationship,
	attachNarrativeGraph,
	type ExportedBoundCharacter,
	type ExportedBoundPersona,
	type ExportedBinding,
	type ExportedScene
} from "$lib/server/utils/lorebookExportMapper"
import { hashCanonicalJson } from "$lib/server/utils/contentHash"
import { buildCharacterCardV3 } from "$lib/server/utils/characterCardParser"
import { isValidUuid } from "$lib/server/utils/uuid"
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
	buildPersonaExportCard,
	createPersonaFromParsedData,
	overwritePersonaFromParsedData
} from "./personas"
import type { Handler } from "$lib/shared/events"
// SelectTag/SelectLorebookTag/InsertHistoryEntry are declared globally in
// $lib/server/db/types.d.ts (ambient `export global {}` block, same pattern
// as the Sockets namespace) — no import needed/available for them.

// Helper function to process tags for lorebook creation/update
async function processLorebookTags(
	lorebookId: number,
	tagNames: string[],
	userId: number
) {
	if (!tagNames || tagNames.length === 0) return

	// First, remove all existing tags for this lorebook
	await db
		.delete(schema.lorebookTags)
		.where(eq(schema.lorebookTags.lorebookId, lorebookId))

	// Process each tag name
	const tagIds: number[] = []

	for (const tagName of tagNames) {
		if (!tagName.trim()) continue

		// Check if tag exists for this user
		let existingTag = await db.query.tags.findFirst({
			where: (t, { and, eq }) =>
				and(eq(t.name, tagName.trim()), eq(t.userId, userId))
		})

		// Create tag if it doesn't exist
		if (!existingTag) {
			const [newTag] = await db
				.insert(schema.tags)
				.values({
					name: tagName.trim(),
					userId
					// description and colorPreset will use database defaults
				})
				.returning()
			existingTag = newTag
		}

		tagIds.push(existingTag.id)
	}

	// Link all tags to the lorebook
	if (tagIds.length > 0) {
		const lorebookTagsData = tagIds.map((tagId) => ({
			lorebookId,
			tagId
		}))

		await db
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

			// Update the lorebook
			const [updated] = await db
				.update(schema.lorebooks)
				.set(params.lorebook)
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

export async function syncLorebookBindings({
	lorebookId
}: {
	lorebookId: number
}) {
	const queries: (() => Promise<any>)[] = []
	// Query all lorebook bindings for the given lorebook
	const existingBindings = await db.query.lorebookBindings.findMany({
		where: (b, { eq }) => eq(b.lorebookId, lorebookId),
		with: {
			characterLoreEntries: true
		}
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
		}
	})
	// If a binding exists in the lorebook bindings without a bound character or persona, consider it orphaned and delete it
	existingBindings.forEach((eb) => {
		if (
			!!eb.characterId ||
			!!eb.personaId ||
			!!eb.characterLoreEntries.length
		) {
			return
		} // Skip bindings that are still in use
		const isBindingUsed = foundBindings.some((fb) => fb === eb.binding)
		if (!isBindingUsed) {
			queries.push(
				db
					.delete(schema.lorebookBindings)
					.where(
						eq(schema.lorebookBindings.id, eb.id)
					) as any as () => Promise<any>
			)
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
				where: eq(schema.lorebookBindings.characterId, params.characterId),
				with: { lorebook: { columns: { id: true, name: true, userId: true } } }
			})

			const seen = new Set<number>()
			const lorebooks = bindings
				.map((b) => b.lorebook)
				// Only this user's own lorebooks are exportable candidates —
				// a binding could in principle reference a lorebook owned by
				// whoever the character was shared with, not the exporter.
				.filter((lb): lb is NonNullable<typeof lb> => !!lb && lb.userId === userId)
				.filter((lb) => (seen.has(lb.id) ? false : (seen.add(lb.id), true)))
				.map((lb) => ({ id: lb.id, name: lb.name }))

			const res: Sockets.Lorebooks.BindingsForCharacter.Response = {
				characterId: params.characterId,
				lorebooks
			}
			emitToUser("lorebooks:bindingsForCharacter", res)
			return res
		} catch (error: any) {
			console.error("Error fetching lorebook bindings for character:", error)
			emitToUser("lorebooks:bindingsForCharacter:error", {
				error: error.message || "Failed to fetch lorebooks for character."
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
async function verifyBindingTargetAccess(
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

		if (!(await verifyBindingTargetAccess(params.lorebookBinding, userId))) {
			throw new Error(
				"Access denied. You don't have permission to bind that character or persona."
			)
		}

		const [binding] = await db
			.insert(schema.lorebookBindings)
			.values(params.lorebookBinding)
			.returning()

		// Refresh binding list
		if (emitToUser) {
			const listResult = await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: book.id },
				emitToUser
			)
			emitToUser("lorebooks:bindingList", listResult)
		}

		// Flow 2: node-link check for the new binding
		if (emitToUser) {
			const allBindings = await db.query.lorebookBindings.findMany({
				where: eq(schema.lorebookBindings.lorebookId, book.id)
			})
			runBindingNodeCheck(book.id, allBindings, emitToUser).catch(console.error)
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

		if (!(await verifyBindingTargetAccess(params.lorebookBinding, userId))) {
			throw new Error(
				"Access denied. You don't have permission to bind that character or persona."
			)
		}

		const [updatedBinding] = await db
			.update(schema.lorebookBindings)
			.set(params.lorebookBinding)
			.where(eq(schema.lorebookBindings.id, params.lorebookBinding.id!))
			.returning()

		// Refresh binding list
		if (emitToUser) {
			const listResult = await lorebookBindingListHandler.handler(
				socket,
				{ lorebookId: existingBinding.lorebookId },
				emitToUser
			)
			emitToUser("lorebooks:bindingList", listResult)
		}

		// Flow 2: node-link check (skip if unlinking a character/persona)
		const isUnlinking =
			("characterId" in params.lorebookBinding && params.lorebookBinding.characterId === null) ||
			("personaId" in params.lorebookBinding && params.lorebookBinding.personaId === null)
		if (!isUnlinking && emitToUser) {
			const allBindings = await db.query.lorebookBindings.findMany({
				where: eq(schema.lorebookBindings.lorebookId, existingBinding.lorebookId)
			})
			runBindingNodeCheck(existingBinding.lorebookId, allBindings, emitToUser).catch(console.error)
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
 * ====================================================================
 * LOREBOOK EXPORT / IMPORT TYPE-SAFE HANDLERS
 * ====================================================================
 */

/**
 * Builds the full spec-compliant export representation of a lorebook —
 * shared by lorebookExportHandler (the actual file download) and
 * lorebookImportHandler's "unchanged vs conflict" hash comparison, so the
 * two can never drift apart. They used to be separate implementations; the
 * comparison side rebuilt a bare buildSpecV3Lorebook() with no bindings/
 * characters/personas/narrativeGraph attached, which meant a straight,
 * unedited re-import of a previously-exported lorebook always hashed
 * differently from the version that was actually exported and reported a
 * spurious "conflict" on every re-import, never "unchanged".
 */
async function buildLorebookExportData(
	lorebookId: number,
	userId: number,
	options: {
		includeCharacters?: boolean
		includePersonas?: boolean
		includeNarrativeGraph?: boolean
	} = {}
) {
	const lorebook = await db.query.lorebooks.findFirst({
		where: and(
			eq(schema.lorebooks.id, lorebookId),
			eq(schema.lorebooks.userId, userId)
		),
		with: {
			worldLoreEntries: true,
			characterLoreEntries: true,
			historyEntries: true,
			scenes: true
		}
	})

	if (!lorebook) {
		throw new Error("Lorebook not found.")
	}

	// All default to true — matches the original always-include-everything
	// behavior for any caller that doesn't specify.
	const includeCharacters = options.includeCharacters ?? true
	const includePersonas = options.includePersonas ?? true
	const includeNarrativeGraph = options.includeNarrativeGraph ?? true

	// Embed every bound character/persona's full card (when opted into),
	// plus the binding structure itself (always, even for bindings whose
	// card isn't embedded) — see attachBoundEntities.
	const bindingRows = await db.query.lorebookBindings.findMany({
		where: eq(schema.lorebookBindings.lorebookId, lorebook.id),
		with: {
			character: { with: { characterTags: { with: { tag: true } } } },
			persona: true
		}
	})

	let nextLocalId = 1
	const characters: ExportedBoundCharacter[] = []
	const personas: ExportedBoundPersona[] = []
	const bindings: ExportedBinding[] = []
	const bindingLocalIdByRealId = new Map<number, number>()

	for (const binding of bindingRows) {
		let characterLocalId: number | null = null
		let personaLocalId: number | null = null

		if (binding.character && includeCharacters) {
			characterLocalId = nextLocalId++
			characters.push({
				localId: characterLocalId,
				// No `lorebook` passed — avoids embedding this character's
				// own character_book recursively.
				card: buildCharacterCardV3({
					...binding.character,
					tags: binding.character.characterTags?.map((ct) => ct.tag.name) || []
				})
			})
		}
		if (binding.persona && includePersonas) {
			personaLocalId = nextLocalId++
			personas.push({
				localId: personaLocalId,
				card: buildPersonaExportCard(binding.persona)
			})
		}

		const bindingLocalId = nextLocalId++
		bindingLocalIdByRealId.set(binding.id, bindingLocalId)
		bindings.push({
			localId: bindingLocalId,
			bindingText: binding.binding,
			kind: binding.characterId ? "character" : "persona",
			characterLocalId,
			personaLocalId
		})
	}

	// Scenes nest under their owning history entry rather than a separate
	// top-level array (a scene belongs to exactly one history entry) —
	// assign each a document-scoped localId here so narrativeGraph nodes/
	// relationships below can reference one.
	const historyEntryLocalIdByRealId = assignHistoryEntryLocalIds(
		lorebook.historyEntries
	)
	const sceneLocalIdByRealId = new Map<number, number>()
	const scenesByHistoryEntryId = new Map<number, ExportedScene[]>()
	lorebook.scenes.forEach((scene) => {
		const localId = nextLocalId++
		sceneLocalIdByRealId.set(scene.id, localId)
		const mapped = mapSceneForExport(scene, localId)
		const existing = scenesByHistoryEntryId.get(scene.historyEntryId) ?? []
		existing.push(mapped)
		scenesByHistoryEntryId.set(scene.historyEntryId, existing)
	})

	const specBook = attachBoundEntities(
		buildSpecV3Lorebook(
			lorebook,
			lorebook.worldLoreEntries,
			lorebook.characterLoreEntries,
			lorebook.historyEntries,
			bindingLocalIdByRealId,
			scenesByHistoryEntryId,
			historyEntryLocalIdByRealId
		),
		characters,
		personas,
		bindings
	)

	// Narrative graph — skipped entirely (no DB queries either) when the
	// caller opted out, or omitted from the output (attachNarrativeGraph's
	// own job) when the lorebook simply has no nodes/relationships at all.
	let specBookWithGraph = specBook
	if (includeNarrativeGraph) {
		const narrativeNodeRows = await db.query.narrativeNodes.findMany({
			where: eq(schema.narrativeNodes.lorebookId, lorebook.id)
		})
		const narrativeRelationshipRows = await db.query.narrativeRelationships.findMany(
			{ where: eq(schema.narrativeRelationships.lorebookId, lorebook.id) }
		)

		const nodeLocalIdByRealId = new Map<number, number>()
		narrativeNodeRows.forEach((node) => {
			nodeLocalIdByRealId.set(node.id, nextLocalId++)
		})

		// characterIds are this install's raw DB ids — meaningless on a
		// different install, so resolve each to its character's stable uuid
		// instead (silently dropping any that no longer exist).
		const allCharacterIds = Array.from(
			new Set(narrativeNodeRows.flatMap((n) => n.characterIds ?? []))
		)
		const characterUuidById = new Map<number, string>()
		if (allCharacterIds.length > 0) {
			const rows = await db.query.characters.findMany({
				where: inArray(schema.characters.id, allCharacterIds),
				columns: { id: true, uuid: true }
			})
			rows.forEach((c) => characterUuidById.set(c.id, c.uuid))
		}

		const narrativeNodes = narrativeNodeRows.map((node) =>
			mapNarrativeNode(
				node,
				nodeLocalIdByRealId.get(node.id)!,
				(node.characterIds ?? [])
					.map((id) => characterUuidById.get(id))
					.filter((uuid): uuid is string => !!uuid),
				bindingLocalIdByRealId,
				nodeLocalIdByRealId,
				historyEntryLocalIdByRealId,
				sceneLocalIdByRealId
			)
		)
		const narrativeRelationships = narrativeRelationshipRows
			.map((rel) =>
				mapNarrativeRelationship(
					rel,
					nodeLocalIdByRealId,
					historyEntryLocalIdByRealId,
					sceneLocalIdByRealId
				)
			)
			.filter((r): r is NonNullable<typeof r> => r !== null)

		specBookWithGraph = attachNarrativeGraph(specBook, narrativeNodes, narrativeRelationships)
	}

	return { name: lorebook.name, specBookWithGraph }
}

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
		...(rawData?.scan_depth !== undefined ? { scanDepth: rawData.scan_depth } : {}),
		...(rawData?.token_budget !== undefined ? { tokenBudget: rawData.token_budget } : {}),
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
function assertLorebookImportWithinLimits(card: CharacterBook, lorebookData: any) {
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
 * bindings by localId) can be wired up by insertLorebookEntries afterward.
 */
async function restoreBoundEntities(
	lorebookId: number,
	serenepub: any,
	userId: number
): Promise<Map<number, number>> {
	const bindingLocalIdToRealId = new Map<number, number>()
	const rawBindings = serenepub?.bindings
	if (!Array.isArray(rawBindings)) return bindingLocalIdToRealId

	const characterLocalIdToRealId = new Map<number, number>()
	for (const embedded of serenepub?.characters ?? []) {
		const cardData = embedded?.card?.data
		if (!cardData) continue
		const character = await resolveOrOverwriteEmbeddedCharacter(cardData, userId)
		characterLocalIdToRealId.set(embedded.localId, character.id)
	}

	const personaLocalIdToRealId = new Map<number, number>()
	for (const embedded of serenepub?.personas ?? []) {
		const cardData = embedded?.card
		if (!cardData) continue
		const persona = await resolveOrOverwriteEmbeddedPersona(cardData, userId)
		personaLocalIdToRealId.set(embedded.localId, persona.id)
	}

	for (const binding of rawBindings) {
		const characterId =
			binding.characterLocalId != null
				? (characterLocalIdToRealId.get(binding.characterLocalId) ?? null)
				: null
		const personaId =
			binding.personaLocalId != null
				? (personaLocalIdToRealId.get(binding.personaLocalId) ?? null)
				: null

		const [row] = await db
			.insert(schema.lorebookBindings)
			.values({
				lorebookId,
				characterId,
				personaId,
				binding: binding.bindingText || "{{char:1}}"
			})
			.returning()
		bindingLocalIdToRealId.set(binding.localId, row.id)
	}

	return bindingLocalIdToRealId
}

async function resolveOrOverwriteEmbeddedCharacter(cardData: any, userId: number) {
	const incomingUuid = extractCharacterUuid(cardData)
	if (incomingUuid) {
		const existing = await db.query.characters.findFirst({
			where: and(
				eq(schema.characters.uuid, incomingUuid),
				eq(schema.characters.userId, userId)
			),
			columns: { id: true }
		})
		if (existing) {
			const comparison = await buildExistingCharacterComparisonData(existing.id)
			if (comparison) {
				const { character_book, ...incomingForHash } = cardData
				const existingHash = hashCanonicalJson(comparison.comparisonData)
				const incomingHash = hashCanonicalJson(incomingForHash)
				if (existingHash === incomingHash) return comparison.character
				return overwriteCharacterFromParsedData(
					existing.id,
					cardData,
					undefined,
					userId
				)
			}
		}
	}
	return createCharacterFromParsedData(cardData, undefined, userId)
}

async function resolveOrOverwriteEmbeddedPersona(cardData: any, userId: number) {
	const incomingUuid = extractPersonaUuid(cardData)
	if (incomingUuid) {
		const existing = await db.query.personas.findFirst({
			where: and(
				eq(schema.personas.uuid, incomingUuid),
				eq(schema.personas.userId, userId)
			)
		})
		if (existing) {
			const existingHash = hashCanonicalJson(canonicalPersonaContent(existing))
			const incomingHash = hashCanonicalJson(
				canonicalPersonaContent(personaFieldsFromParsedData(cardData) as any)
			)
			if (existingHash === incomingHash) return existing
			return overwritePersonaFromParsedData(existing.id, cardData, undefined)
		}
	}
	return createPersonaFromParsedData(cardData, undefined, userId)
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
	bindingLocalIdToRealId: Map<number, number>
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
				db.insert(schema.characterLoreEntries).values({
					...mapLorebookEntryToCharacterLoreEntry(entry, characterPosition),
					lorebookId,
					lorebookBindingId
				})
			)
			characterPosition++
		} else if (type === "history") {
			const meta = entry.extensions?.serenepub ?? {}
			queries.push(
				(async () => {
					const [historyRow] = await db
						.insert(schema.historyEntries)
						.values({
							...mapLorebookEntryToHistoryEntry(entry, historyPosition),
							lorebookId
						})
						.returning()

					if (typeof meta.localId === "number") {
						historyEntryLocalIdToRealId.set(meta.localId, historyRow.id)
					}

					// Nested scenes — each still gets its own document-scoped
					// localId (see mapHistoryEntry) so narrativeGraph can
					// reference one via sceneLocalId. chatId/
					// selectedMessageIds were deliberately never exported —
					// they're chat-instance-specific and can't round-trip.
					const scenes = Array.isArray(meta.scenes) ? meta.scenes : []
					for (const scene of scenes) {
						const [sceneRow] = await db
							.insert(schema.scenes)
							.values({
								lorebookId,
								historyEntryId: historyRow.id,
								chatId: null,
								name: scene?.name ?? null,
								selectedMessageIds: [],
								summary: scene?.summary ?? null,
								participantCharacters: scene?.participantCharacters ?? [],
								mentionedCharacters: scene?.mentionedCharacters ?? []
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
				db.insert(schema.worldLoreEntries).values({
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
 */
async function restoreNarrativeGraph(
	lorebookId: number,
	serenepub: any,
	userId: number,
	bindingLocalIdToRealId: Map<number, number>,
	historyRefs: RestoredHistoryRefs
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

		// characterIds are this install's raw DB ids on export, resolved to
		// portable uuids instead (see mapNarrativeNode) — resolve them back
		// to this user's real character ids in one query.
		const allUuids = Array.from(
			new Set<string>(
				rawNodes.flatMap((n: any) =>
					Array.isArray(n?.characterUuids) ? n.characterUuids : []
				)
			)
		)
		const characterIdByUuid = new Map<string, number>()
		if (allUuids.length > 0) {
			const rows = await db.query.characters.findMany({
				where: and(
					inArray(schema.characters.uuid, allUuids),
					eq(schema.characters.userId, userId)
				),
				columns: { id: true, uuid: true }
			})
			rows.forEach((c) => characterIdByUuid.set(c.uuid, c.id))
		}

		// Pass 1: insert every node without parentNodeId (a parent may be
		// defined later in the array), tracking localId -> real id.
		const nodeLocalIdToRealId = new Map<number, number>()
		for (const node of rawNodes) {
			try {
				const lorebookBindingId =
					typeof node?.bindingLocalId === "number"
						? (bindingLocalIdToRealId.get(node.bindingLocalId) ?? null)
						: null
				const historyEntryId =
					typeof node?.historyEntryLocalId === "number"
						? (historyRefs.historyEntryLocalIdToRealId.get(
								node.historyEntryLocalId
							) ?? null)
						: null
				const sceneId =
					typeof node?.sceneLocalId === "number"
						? (historyRefs.sceneLocalIdToRealId.get(node.sceneLocalId) ?? null)
						: null
				const characterIds = (
					Array.isArray(node?.characterUuids) ? node.characterUuids : []
				)
					.map((uuid: string) => characterIdByUuid.get(uuid))
					.filter((id: number | undefined): id is number => id !== undefined)

				const [row] = await db
					.insert(schema.narrativeNodes)
					.values({
						lorebookId,
						name: node?.name || "",
						nodeState: node?.nodeState || "active",
						nodeVisibility: node?.nodeVisibility || "normal",
						aliases: Array.isArray(node?.aliases) ? node.aliases : [],
						summary: node?.summary ?? null,
						lorebookBindingId,
						historyEntryId,
						sceneId,
						characterIds
					})
					.returning()

				if (typeof node?.localId === "number") {
					nodeLocalIdToRealId.set(node.localId, row.id)
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
		// resolveParentNodeLinks (narrativeNodes.parentNodeId is 2-level max).
		const parentLinks = resolveParentNodeLinks(rawNodes, nodeLocalIdToRealId)
		for (const { realId, parentRealId } of parentLinks) {
			try {
				await db
					.update(schema.narrativeNodes)
					.set({ parentNodeId: parentRealId })
					.where(eq(schema.narrativeNodes.id, realId))
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
						? (historyRefs.sceneLocalIdToRealId.get(rel.sceneLocalId) ?? null)
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

/** Creates a brand-new lorebook (+ bound entities, bindings, entries) from a parsed CharacterBook. */
async function createLorebookFromParsedCard(
	card: CharacterBook,
	rawData: any,
	userId: number
) {
	const [book] = await db
		.insert(schema.lorebooks)
		.values({
			name: card.name || "Imported Lorebook",
			description: card.description,
			userId,
			extraJson: extractLorebookLevelExtraJson(rawData)
		})
		.returning()

	const bindingLocalIdToRealId = await restoreBoundEntities(
		book.id,
		card.extensions?.serenepub,
		userId
	)
	const historyRefs = await insertLorebookEntries(
		book.id,
		card.entries,
		bindingLocalIdToRealId
	)
	await restoreNarrativeGraph(
		book.id,
		card.extensions?.serenepub,
		userId,
		bindingLocalIdToRealId,
		historyRefs
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
	await db
		.update(schema.lorebooks)
		.set({
			name: card.name || "Imported Lorebook",
			description: card.description,
			extraJson: extractLorebookLevelExtraJson(rawData)
		})
		.where(eq(schema.lorebooks.id, existingId))

	await db
		.delete(schema.worldLoreEntries)
		.where(eq(schema.worldLoreEntries.lorebookId, existingId))
	await db
		.delete(schema.characterLoreEntries)
		.where(eq(schema.characterLoreEntries.lorebookId, existingId))
	await db
		.delete(schema.historyEntries)
		.where(eq(schema.historyEntries.lorebookId, existingId))
	await db
		.delete(schema.lorebookBindings)
		.where(eq(schema.lorebookBindings.lorebookId, existingId))
	// narrativeRelationships before narrativeNodes — relationships FK
	// straight to nodes, not lorebookId-cascaded on node deletion.
	await db
		.delete(schema.narrativeRelationships)
		.where(eq(schema.narrativeRelationships.lorebookId, existingId))
	await db
		.delete(schema.narrativeNodes)
		.where(eq(schema.narrativeNodes.lorebookId, existingId))

	const bindingLocalIdToRealId = await restoreBoundEntities(
		existingId,
		card.extensions?.serenepub,
		userId
	)
	const historyRefs = await insertLorebookEntries(
		existingId,
		card.entries,
		bindingLocalIdToRealId
	)
	await restoreNarrativeGraph(
		existingId,
		card.extensions?.serenepub,
		userId,
		bindingLocalIdToRealId,
		historyRefs
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
			const lorebookData = normalizeLegacyLorebookData(params.lorebookData)
			const card = CharacterBook.from_json(lorebookData)
			if (!card) {
				throw new Error("No lorebook data provided.")
			}
			assertLorebookImportWithinLimits(card, lorebookData)

			const rawIncomingUuid = (lorebookData as any)?.extensions?.serenepub?.uuid
			const incomingUuid = isValidUuid(rawIncomingUuid) ? rawIncomingUuid : undefined

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
				userId
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

			const lorebookData = normalizeLegacyLorebookData(params.lorebookData)
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
				completedBook = await createLorebookFromParsedCard(
					card,
					lorebookData,
					userId
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

	// Lorebook export / import handlers
	register(socket, lorebookExportHandler, emitToUser)
	register(socket, lorebookImportHandler, emitToUser)
	register(socket, lorebookImportResolveHandler, emitToUser)
}
