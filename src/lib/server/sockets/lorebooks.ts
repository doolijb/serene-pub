import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, eq, inArray, isNull, sql } from "drizzle-orm"
import {
	resolveOrCreateBindingRow,
	syncLorebookBindingsForCharacter
} from "$lib/server/utils/characterBindingSync"
import { canViewCharacter } from "$lib/server/utils/sessionAccess"
import {
	mapImportedEntry,
	entryTypeIdOf,
	normalizeLegacyLorebookData,
	normalizeNativeWorldInfoEntry,
	importedKeyColumns,
	parseImportedLorebook,
	resolveAnchorEntryLinks,
	resolveParentNodeLinks,
	type ParsedImportedLorebook
} from "$lib/server/utils/lorebookImportMapper"
import { buildLorebookExportData } from "$lib/server/utils/lorebookExportBuilder"
import { duplicateLorebookRows } from "$lib/server/utils/lorebookDuplicate"
import { LOREBOOK_EXPORT_PAUSED } from "$lib/shared/lorebooks/exportPaused"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import { resolveOrCreateBindingByName } from "$lib/server/utils/summarizer/availableSceneCast"
import { hashCanonicalJson } from "$lib/server/utils/contentHash"
import { isValidUuid } from "$lib/server/utils/uuid"
import { findOrCreateTagId } from "$lib/server/utils/tags"
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
} from "$lib/server/utils/personaCard"
import { writeSceneCast } from "$lib/server/utils/sceneCast"
import { assertValidParentNode } from "$lib/server/utils/bindingParent"
import { isUniqueViolation, refusable } from "./refusable"
import {
	CHARACTER_LORE_TYPE_ID,
	ENTRY_TYPE_IDS,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID,
	entryInsert,
	loadBookEntries,
	type EntryTypeId
} from "$lib/server/utils/lorebookEntries"
import type { Handler } from "$lib/shared/events"
import { readStoryCalendar, type StoryClock } from "$lib/shared/lorebooks/storyDate"
import { clockColumns, clockProblem } from "$lib/server/state/storyTime"
// SelectTag/SelectLorebookTag/InsertHistoryEntry are declared globally in
// $lib/server/db/types.d.ts (ambient `export global {}` block, same pattern
// as the Sockets namespace) — no import needed/available for them.

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
	lorebookId: number,
	/** The row being written; null for a create. */
	bindingId: number | null
) {
	if (fields.parentNodeId != null) {
		// Same book, not itself, and the two-level rule (finding #22) — one
		// shared guard, so narrativeGraph:updateNode cannot drift from it.
		await assertValidParentNode(
			db,
			bindingId,
			fields.parentNodeId,
			lorebookId
		)
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
		const [historyEntry] = await db
			.select({ lorebookId: schema.lorebookEntries.lorebookId })
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.id, fields.historyEntryId),
					eq(schema.lorebookEntries.typeId, HISTORY_TYPE_ID)
				)
			)
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
	dbOrTx: Db = db
) {
	// Undefined means "not touched"; an EMPTY list means "no tags" and must
	// still run the delete below — returning early on [] made clearing the
	// last tag impossible.
	if (!Array.isArray(tagNames)) return

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

/**
 * Every lorebook this user owns, with the counts and tags its card shows.
 *
 * Split out of the handler below so the six cascades that re-send the list
 * (create, update, delete, duplicate, import, importResolve) can hand it to
 * `emitToUser` as a thunk: ONE source of truth for the payload, and the
 * multi-relation read behind it — every book with its entry ids, its binding
 * ids and its tags — is paid only when some socket declared the key
 * (socket-interest plan, ruling 4). The handler's own reply stays eager: the
 * caller asked for it.
 */
async function buildLorebooksList(
	userId: number
): Promise<Sockets.Lorebooks.List.Response> {
	if (!userId) return { lorebookList: [] }
	const books = await db.query.lorebooks.findMany({
		where: (l, { eq }) => eq(l.userId, userId),
		orderBy: (l, { desc }) => desc(l.name),
		with: {
			lorebookEntries: {
				columns: {
					id: true,
					typeId: true,
					archived: true
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

	// Transform lorebook tags to include tags as string array. The three
	// entry lists are id-only and exist for the card's counts, so they are
	// split back out of the one relation rather than fetched three times.
	const booksWithTags = books.map((book) => {
		const { lorebookEntries: allEntries, ...rest } = book
		// Counts exclude archived rows, matching the default entry list — a
		// book reads as holding what the reader will see when they open it.
		const lorebookEntries = allEntries.filter((e) => !e.archived)
		const idsOf = (typeId: string) =>
			lorebookEntries
				.filter((e) => e.typeId === typeId)
				.map((e) => ({ id: e.id }))
		// Every type, keyed by type id — places and items counted as 0 when
		// only the three legacy lists existed (finding #17).
		const entryCounts: Record<string, number> = {}
		for (const e of lorebookEntries)
			entryCounts[e.typeId] = (entryCounts[e.typeId] ?? 0) + 1
		return {
			...rest,
			entryCount: lorebookEntries.length,
			entryCounts,
			worldLoreEntries: idsOf(WORLD_LORE_TYPE_ID),
			characterLoreEntries: idsOf(CHARACTER_LORE_TYPE_ID),
			historyEntries: idsOf(HISTORY_TYPE_ID),
			tags:
				book.lorebookTags?.map(
					(lt: SelectLorebookTag & { tag: SelectTag }) => lt.tag.name
				) || []
		}
	})

	return { lorebookList: booksWithTags }
}

/**
 * The lorebook list, re-sent to the caller after a mutation that changed it.
 *
 * The LAZY form (socket-interest plan, ruling 4): these are pushes, not
 * replies, so a create, a rename or an import made from a surface that shows
 * no lorebook list pays for no re-list at all. Skipping the emit alone would
 * save nothing; the query is the cost.
 */
function relistLorebooks(
	socket: any,
	emitToUser: (event: string, data: any) => void
) {
	return emitToUser("lorebooks:list", () =>
		buildLorebooksList(socket.user!.id)
	)
}

export const lorebooksListHandler: Handler<
	Sockets.Lorebooks.List.Params,
	Sockets.Lorebooks.List.Response
> = {
	event: "lorebooks:list",
	async handler(socket, params, emitToUser) {
		const res = await buildLorebooksList(socket.user!.id)
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

			const [lorebook] = await db
				.insert(schema.lorebooks)
				.values({ name: params.name, userId })
				.returning()

			if (emitToUser) {
				// The refreshed list, lazily — and exactly ONE of it.
				// `relistLorebooks` emits `lorebooks:list` itself, so a second
				// `emitToUser("lorebooks:list", …)` beside this call puts the same
				// payload on the wire twice. One stood here; it is gone.
				await relistLorebooks(socket, emitToUser)
				emitToUser("lorebooks:create", { lorebook })
			}

			return { lorebook }
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
					lorebookBindings: true,
					lorebookTags: {
						with: {
							tag: true
						}
					}
				}
			})

			if (!book) {
				// ⚠ `lorebookId` beside the null, the same treatment as
				// `sessions:get`'s not-found reply: there is no lorebook for the
				// scope extractor to read an id off, so without it this reply has
				// no **interest scope** and only a BARE `lorebooks:get` key could
				// receive it — a key that matches every OTHER book's reply too.
				const res: Sockets.Lorebooks.Get.Response = {
					lorebook: null,
					entries: [],
					lorebookId: params.id
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
				entries: await loadBookEntries(db, params.id),
				lorebookId: params.id
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
			const { name, description, extraJson, tags } = params.lorebook

			// The row and its tags commit together (only `tx` inside). Tags
			// are written only when the caller sent a list — an absent `tags`
			// leaves them alone, an empty list clears them. They were never
			// written here at all before, so every tag edit in Book settings
			// was silently discarded (findings #12/#107).
			const updated = await db.transaction(async (tx) => {
				const [row] = await tx
					.update(schema.lorebooks)
					.set({
						...(name !== undefined ? { name } : {}),
						...(description !== undefined ? { description } : {}),
						...(extraJson !== undefined ? { extraJson } : {}),
						// A tags-only save still touches the row — and gives the
						// SET something to say, which drizzle requires.
						updatedAt: sql`(CURRENT_TIMESTAMP)`
					})
					.where(
						and(
							eq(schema.lorebooks.id, params.lorebook.id!),
							eq(schema.lorebooks.userId, userId)
						)
					)
					.returning()
				if (!row) throw new Error("Lorebook not found.")
				if (Array.isArray(tags))
					await processLorebookTags(
						row.id,
						tags.filter((t): t is string => typeof t === "string"),
						userId,
						tx
					)
				const tagRows = await tx
					.select({ name: schema.tags.name })
					.from(schema.lorebookTags)
					.innerJoin(
						schema.tags,
						eq(schema.tags.id, schema.lorebookTags.tagId)
					)
					.where(eq(schema.lorebookTags.lorebookId, row.id))
				return { ...row, tags: tagRows.map((t) => t.name) }
			})

			const res: Sockets.Lorebooks.Update.Response = {
				lorebook: updated
			}
			emitToUser("lorebooks:update", res)
			await relistLorebooks(socket, emitToUser) // Refresh list
			return res
		} catch (error: any) {
			console.error("Error updating lorebook:", error)
			emitToUser("lorebooks:update:error", {
				error: error?.message || "Failed to update lorebook."
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

			// Scoped by owner in the same statement; a book that is not
			// this caller's (or is already gone) deletes nothing, and that is
			// a refusal, not a success (finding #20).
			const deleted = await db
				.delete(schema.lorebooks)
				.where(
					and(
						eq(schema.lorebooks.id, params.id),
						eq(schema.lorebooks.userId, userId)
					)
				)
				.returning({ id: schema.lorebooks.id })
			if (deleted.length === 0) throw new Error("Lorebook not found.")

			const res: Sockets.Lorebooks.Delete.Response = {
				success: "Lorebook deleted successfully",
				id: params.id
			}
			emitToUser("lorebooks:delete", res)
			await relistLorebooks(socket, emitToUser) // Refresh list
			return res
		} catch (error: any) {
			console.error("Error deleting lorebook:", error)
			const res: Sockets.Lorebooks.Delete.Response = {
				error: error?.message || "Failed to delete lorebook."
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
	// One transaction under the book's advisory lock — the same key every
	// other cast writer takes (resolveOrCreateBindingRow,
	// resolveOrCreateBindingByName) — so two concurrent entry writes naming
	// the same new token cannot both see it missing and both insert it
	// (finding #24). Reads and writes run one after another, on `tx` only.
	await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
		const existingBindings = await tx
			.select({ binding: schema.lorebookBindings.binding })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
		// Every entry of the lorebook, of every type — one scan, because the
		// binding scan never cared which shape the content came out of.
		const entries = await tx
			.select({ content: schema.lorebookEntries.content })
			.from(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, lorebookId))

		// Every unique {{char:N}} / {char:N} (deprecated) token in the content,
		// in the preferred {{…}} spelling.
		const foundBindings: string[] = []
		for (const entry of entries) {
			const rgx: RegExp = /\{\{?(\w+):(\d+)\}?\}/g
			let match: RegExpExecArray | null
			while ((match = rgx.exec(entry.content)) !== null) {
				const binding = `{{${match[1]}:${match[2]}}}`
				if (!foundBindings.includes(binding)) foundBindings.push(binding)
			}
		}

		for (const fb of foundBindings) {
			// Either spelling of the token counts as already present.
			const legacyBinding = fb.replace(/\{\{(\w+):(\d+)\}\}/, "{$1:$2}")
			if (
				existingBindings.some(
					(eb) => eb.binding === fb || eb.binding === legacyBinding
				)
			)
				continue
			await tx.insert(schema.lorebookBindings).values({
				lorebookId,
				binding: fb,
				characterId: null
			})
			// This token was not minted by deriveNextBindingToken's counter —
			// it came straight from content text (pasted export, typed by
			// hand, a stale reference). `binding` has no uniqueness
			// constraint, so if the counter later reached this number it
			// would issue it again. Advance the counter past it now.
			const parsedNumber = Number(fb.match(/:(\d+)\}\}$/)?.[1])
			if (Number.isInteger(parsedNumber))
				await tx
					.update(schema.lorebooks)
					.set({
						nextBindingNumber: sql`GREATEST(${schema.lorebooks.nextBindingNumber}, ${parsedNumber + 1})`
					})
					.where(eq(schema.lorebooks.id, lorebookId))
		}
	})
}

// =============================================
// TYPE-SAFE LOREBOOK HANDLERS
// =============================================

/**
 * Type-safe handler for listing lorebook bindings
 */
/**
 * One lorebook's cast, with each binding's character and persona attached.
 *
 * Split out of the handler below for the reason `buildLorebooksList` is: six
 * call sites re-send this list after a write (three in this file, plus
 * `entries.ts`' `afterWrite`, the session binding check and the summarizer),
 * and every one of them is a push. As a thunk the three-way join is paid only
 * when a socket is actually showing the cast.
 *
 * Ownership is re-checked here rather than trusted from the caller — the read
 * is scoped by `userId` in the same statement that fetches the rows, so a
 * book belonging to somebody else is "not found" rather than "found but
 * refused".
 */
export async function buildLorebookBindingList(
	userId: number,
	lorebookId: number
): Promise<Sockets.Lorebooks.BindingList.Response> {
	const book = await db.query.lorebooks.findFirst({
		where: (l, { and, eq }) =>
			and(eq(l.id, lorebookId), eq(l.userId, userId)),
		columns: {
			id: true
		},
		with: {
			lorebookBindings: {
				with: {
					character: true
				}
			}
		}
	})

	if (!book) throw new Error("Lorebook not found.")

	return {
		lorebookId: book.id,
		lorebookBindingList: book.lorebookBindings
	}
}

/**
 * The cast, re-sent to the caller after a write that could have changed it.
 *
 * The lazy counterpart of the handler below, and the ONE spelling of this
 * event name for every cascade — exported because three of the six live in
 * other files.
 *
 * ⚠ A build that THROWS is logged by `emitToUser` and emits nothing, which
 * is right for a push the caller's own reply does not depend on.
 */
export function relistBindings(
	socket: any,
	lorebookId: number,
	emitToUser: (event: string, data: any) => void
) {
	return emitToUser("lorebooks:bindingList", () =>
		buildLorebookBindingList(socket.user!.id, lorebookId)
	)
}

export const lorebookBindingListHandler: Handler<
	Sockets.Lorebooks.BindingList.Params,
	Sockets.Lorebooks.BindingList.Response
> = {
	event: "lorebooks:bindingList",
	handler: async (socket, params, emitToUser) => {
		const res = await buildLorebookBindingList(
			socket.user!.id,
			params.lorebookId
		)

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
// character's name/data — without this check, any characterId could be
// supplied regardless of who it belongs to, and the bound entity's
// name/aliases/summary would later be disclosed through the binding (and
// copied into narrative-graph nodes derived from it).
export async function verifyBindingTargetAccess(
	binding: { characterId?: number | null },
	userId: number
): Promise<boolean> {
	if (binding.characterId) {
		const character = await db.query.characters.findFirst({
			where: eq(schema.characters.id, binding.characterId),
			columns: { userId: true }
		})
		if (!character) return false
		if (character.userId === userId) return true
		// Checks BOTH member tables, so a character somebody else voices in a
		// session the caller is in is bindable too.
		return await canViewCharacter(binding.characterId, userId)
	}
	return true
}

/**
 * A background cast member (no card) with a freshly minted token — the one
 * spelling of that insert, shared by `lorebooks:createBinding` and
 * `bindingSuggestions:add`. Must be called on a transaction handle: the
 * token and the row commit together.
 */
export async function insertBackgroundBinding(
	tx: Db,
	lorebookId: number,
	values: Omit<
		Partial<typeof schema.lorebookBindings.$inferInsert>,
		"id" | "lorebookId" | "binding" | "characterId"
	>
) {
	const token = await deriveNextBindingToken(lorebookId, tx)
	const [inserted] = await tx
		.insert(schema.lorebookBindings)
		.values({ ...values, lorebookId, characterId: null, binding: token })
		.returning()
	return inserted
}

export const createLorebookBindingHandler: Handler<
	Sockets.Lorebooks.CreateBinding.Params,
	Sockets.Lorebooks.CreateBinding.Response
> = refusable(
	"lorebooks:createBinding",
	async (socket, params: Sockets.Lorebooks.CreateBinding.Params, emitToUser) => {
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
		const isBound = !!params.lorebookBinding.characterId
		const {
			// The primary key is never the client's (finding #18) — it would
			// ride into both the unbound insert and the bound `extra` update.
			id: _ignoredId,
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
			params.lorebookBinding.lorebookId,
			null
		)

		// One binding per person per book (ruling 2026-09-12). A second
		// create for a character this book already holds answers
		// with the row it already has rather than minting a rival: a rival
		// row shows one person twice in the cast panel and splits their lore
		// across two anchors.
		//
		// resolveOrCreateBindingRow owns the check-and-insert under the
		// lorebook's advisory lock, and syncs a fresh row's name/aliases from
		// the bound entity. An existing row is returned untouched — that is
		// what returning it means.
		//
		// A background row (no character) has no entity to resolve through
		// and keeps the bare insert: names are deduped for those by
		// lorebooks:resolveOrCreateBindingByName, which is the path binding
		// suggestions use.
		let binding: typeof schema.lorebookBindings.$inferSelect
		let existing = false
		if (isBound) {
			const { id, created } = await resolveOrCreateBindingRow(
				{
					lorebookId: params.lorebookBinding.lorebookId,
					characterId: params.lorebookBinding.characterId ?? null
				},
				db
			)
			existing = !created
			// Any other column the client supplied belongs to the row this
			// call meant to create, so it is written only when this call
			// actually created one.
			if (created) {
				const {
					lorebookId: _lorebookId,
					characterId: _characterId,
					...rest
				} = safeInsert as Record<string, unknown>
				const extra = Object.fromEntries(
					Object.entries(rest).filter(([, v]) => v !== undefined)
				)
				if (Object.keys(extra).length > 0) {
					await db
						.update(schema.lorebookBindings)
						.set(extra)
						.where(eq(schema.lorebookBindings.id, id))
				}
			}
			// Re-read rather than trust the insert's own .returning(): the
			// sync above writes name/aliases after it, so the returned values
			// would be the pre-sync (empty) ones.
			;[binding] = await db
				.select()
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.id, id))
		} else {
			const {
				lorebookId: _lorebookId,
				characterId: _characterId,
				...values
			} = safeInsert as Record<string, any>
			binding = await db.transaction((tx) =>
				insertBackgroundBinding(
					tx,
					params.lorebookBinding.lorebookId,
					values
				)
			)
		}

		// The refreshed cast, lazily — and exactly ONE of it.
		// `relistBindings` emits `lorebooks:bindingList` itself, so a second
		// emit of its result beside this call is the same payload twice. One
		// stood here; it is gone.
		if (emitToUser) await relistBindings(socket, book.id, emitToUser)

		const res: Sockets.Lorebooks.CreateBinding.Response = {
			lorebookBinding: binding,
			existing
		}

		if (emitToUser) {
			emitToUser("lorebooks:createBinding", res)
		}

		return res
	},
	"Failed to add that cast member."
)

/**
 * Type-safe handler for updating lorebook binding
 */
export const updateLorebookBindingHandler: Handler<
	Sockets.Lorebooks.UpdateBinding.Params,
	Sockets.Lorebooks.UpdateBinding.Response
> = refusable(
	"lorebooks:updateBinding",
	async (socket, params: Sockets.Lorebooks.UpdateBinding.Params, emitToUser) => {
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
		// is never rewritten (decision 1's preservation guarantee). `name` is
		// only stripped when the row is (or is becoming, via this same
		// update) bound to a real character — a carded member is named by
		// its card, from the entity sync below. A row that's unbound both
		// before and after this update has no entity to sync from, so its
		// name is exactly what the client supplies here — the only way to
		// rename a background character after creation.
		//
		// ⚠ `aliases` are NOT stripped for a carded member (#114): the other
		// names a member is known by are MEMBER-owned (cast-first, ruled
		// 2026-09-28). The sync below MERGES the card's names into them
		// rather than replacing them, so what the author writes here stays.
		const willBeBound =
			(params.lorebookBinding.characterId !== undefined
				? params.lorebookBinding.characterId
				: existingBinding.characterId) != null
		// lorebookId is deliberately excluded too — ownership is only
		// verified against the binding's *current* lorebook above; a
		// client-supplied replacement value here would let a user relocate
		// their own binding (and any bound character) into a
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
			? (({ name, ...r }) => r)(restUpdate)
			: restUpdate

		await validateBindingCrossRefs(
			safeUpdate,
			existingBinding.lorebookId,
			existingBinding.id
		)

		// Linking a card to a background member: the member's own name and
		// aliases are about to be overwritten by the card's (the entity sync
		// below), and they are MEMBER-owned — what the story has called this
		// person. Keep every one of them as an absorbed alias so the member
		// still answers to "The innkeeper" once they are "Maren" (finding
		// #109). Only on the unbound → bound step, so a card-to-card change
		// does not pile up old card projections.
		const becomingBound =
			existingBinding.characterId == null &&
			params.lorebookBinding.characterId != null
		const absorbed = becomingBound
			? {
					absorbedAliases: unionAliases(
						existingBinding.absorbedAliases,
						[existingBinding.name],
						existingBinding.aliases
					)
				}
			: {}
		const { id: _ignoredId, ...setValues } = safeUpdate as Record<
			string,
			any
		>

		// A payload that names nothing writable still touches the row (its
		// `updatedAt`, as the id-only SET this replaced did) — drizzle refuses
		// an empty SET.
		const set = Object.fromEntries(
			Object.entries({ ...setValues, ...absorbed }).filter(
				([, v]) => v !== undefined
			)
		)
		let [updatedBinding] = await db
			.update(schema.lorebookBindings)
			.set(Object.keys(set).length > 0 ? set : { updatedAt: new Date() })
			.where(eq(schema.lorebookBindings.id, params.lorebookBinding.id!))
			.returning()

		// Attach-time sync: a fresh characterId attachment should
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
		}

		// The refreshed cast, lazily — and exactly ONE of it.
		// `relistBindings` emits `lorebooks:bindingList` itself, so a second
		// emit of its result beside this call is the same payload twice. One
		// stood here; it is gone.
		if (emitToUser)
			await relistBindings(socket, existingBinding.lorebookId, emitToUser)

		const res: Sockets.Lorebooks.UpdateBinding.Response = {
			lorebookBinding: updatedBinding
		}

		if (emitToUser) {
			emitToUser("lorebooks:updateBinding", res)
		}

		return res
	},
	"Failed to update that cast member.",
	(e) =>
		isUniqueViolation(e)
			? "That character is already in this lorebook."
			: undefined
)

/** Names a member answers to, de-duplicated case-insensitively, order kept. */
function unionAliases(
	...lists: (readonly (string | null | undefined)[] | null | undefined)[]
): string[] {
	const out: string[] = []
	const seen = new Set<string>()
	for (const list of lists)
		for (const raw of list ?? []) {
			const name = typeof raw === "string" ? raw.trim() : ""
			const key = name.toLowerCase()
			if (!name || seen.has(key)) continue
			seen.add(key)
			out.push(name)
		}
	return out
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
		// The refreshed cast, lazily — and exactly ONE of it.
		// `relistBindings` emits `lorebooks:bindingList` itself, so a second
		// emit of its result beside this call is the same payload twice. One
		// stood here; it is gone.
		if (created && emitToUser)
			await relistBindings(socket, params.lorebookId, emitToUser)

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

/**
 * Export is DISABLED (owner ruling 2026-09-28): the handler stays registered so
 * a stale client or a hand-rolled emit gets the same sentence the disabled
 * button shows, rather than a file in a format that is about to change. The
 * builder behind it stays — the import's unchanged-vs-conflict check uses it.
 */
export const lorebookExportHandler: Handler<
	Sockets.Lorebooks.Export.Params,
	Sockets.Lorebooks.Export.Response
> = {
	event: "lorebooks:export",
	handler: async (_socket, _params, emitToUser) => {
		emitToUser("lorebooks:export:error", { error: LOREBOOK_EXPORT_PAUSED })
		throw new Error(LOREBOOK_EXPORT_PAUSED)
	}
}

// Reads scan_depth/token_budget/recursive_scanning from the RAW import
// payload rather than from the parsed book. The card reader this import used
// to go through backfilled these with hardcoded defaults
// (recursive_scanning ?? true, scan_depth ?? 10) when absent, which would
// otherwise get stored as if they were genuine source data and pollute every
// future re-export/hash-comparison with fabricated values. Reading raw is
// still the rule now that parseImportedLorebook does not carry them at all:
// absent in the file means absent from the row, which is the only reading
// that survives a round trip.
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

/**
 * A lorebook payload as the unchanged-vs-conflict check compares it.
 *
 * ⚠ Every entry's `id` is dropped: the exporter writes this install's primary
 * key there (finding #77), which an overwrite changes on every row, so a file
 * re-imported after an overwrite from that very file could never read as
 * "unchanged". The id carries no content, so ignoring it on both sides is the
 * whole fix. Nothing else is touched.
 */
function comparableLorebookData(data: any): any {
	if (!data || typeof data !== "object" || !Array.isArray(data.entries))
		return data
	return {
		...data,
		entries: data.entries.map((entry: any) => {
			if (!entry || typeof entry !== "object") return entry
			const { id: _id, ...rest } = entry
			return rest
		})
	}
}

/** Rejects an oversized import up front, before any DB work begins. */
function assertLorebookImportWithinLimits(
	card: ParsedImportedLorebook,
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
	dbOrTx: Db = db
): Promise<{
	bindingLocalIdToRealId: Map<number, number>
	syncCharacterIds: Set<number>
	boundEntityByRealId: Map<number, { characterId: number | null }>
}> {
	const bindingLocalIdToRealId = new Map<number, number>()
	const syncCharacterIds = new Set<number>()
	const boundEntityByRealId = new Map<
		number,
		{ characterId: number | null }
	>()
	const rawBindings = serenepub?.bindings
	if (!Array.isArray(rawBindings)) {
		return {
			bindingLocalIdToRealId,
			syncCharacterIds,
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

	// {{char:N}} tokens travel verbatim, so the book's counter has to be past
	// every one of them BEFORE anything is minted — or the next new cast
	// member (and restoreNarrativeGraph's unbound-node mint) reissues
	// {{char:1}} (finding #13). A binding with no valid token of its own mints
	// one, rather than every such row sharing "{{char:1}}".
	const tokenNumber = (text: unknown): number | null => {
		const m =
			typeof text === "string" ? /^\{\{?char:(\d+)\}\}?$/.exec(text) : null
		const n = m ? Number(m[1]) : NaN
		return Number.isInteger(n) && n > 0 ? n : null
	}
	let maxToken = 0
	for (const binding of rawBindings) {
		const n = tokenNumber(binding?.bindingText)
		if (n !== null && n > maxToken) maxToken = n
	}
	if (maxToken > 0)
		await dbOrTx
			.update(schema.lorebooks)
			.set({
				nextBindingNumber: sql`GREATEST(${schema.lorebooks.nextBindingNumber}, ${maxToken + 1})`
			})
			.where(eq(schema.lorebooks.id, lorebookId))
	const seenTokens = new Set<string>()

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

		// One column: an embedded persona card restores as a character with
		// `isPersona`, so both halves of the wire format land on
		// `character_id`. `characterId` wins when a malformed document names
		// both.
		const boundCharacterId = characterId ?? personaId
		// A token the file states once is kept; a missing, malformed or
		// repeated one is minted fresh from the (already raised) counter.
		const stated =
			tokenNumber(binding?.bindingText) !== null &&
			!seenTokens.has(binding.bindingText)
				? (binding.bindingText as string)
				: null
		const token = stated ?? (await deriveNextBindingToken(lorebookId, dbOrTx))
		seenTokens.add(token)
		const [row] = await dbOrTx
			.insert(schema.lorebookBindings)
			.values({
				lorebookId,
				characterId: boundCharacterId,
				binding: token
			})
			.returning()
		bindingLocalIdToRealId.set(binding.localId, row.id)
		boundEntityByRealId.set(row.id, { characterId: boundCharacterId })

		// Every other bound-insert site syncs name/aliases from the entity
		// immediately (see characterBindingSync.ts) — without this, an
		// imported bound row's name stays permanently NULL, and every
		// consumer that displays `name || binding` falls through to the raw
		// {{char:N}} token forever. Deferred to after this transaction
		// commits (see the caller) rather than called here — same
		// inside-tx/outside-tx split resolveOrCreateBinding
		// (characterBindingSync.ts) already uses for this exact call: the
		// sync writes rows this transaction has not committed yet, so they
		// have to see it landed.
		if (boundCharacterId) syncCharacterIds.add(boundCharacterId)
	}

	return {
		bindingLocalIdToRealId,
		syncCharacterIds,
		boundEntityByRealId
	}
}

async function resolveOrOverwriteEmbeddedCharacter(
	cardData: any,
	userId: number,
	dbOrTx: Db = db
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
	dbOrTx: Db = db
) {
	const incomingUuid = extractPersonaUuid(cardData)
	if (incomingUuid) {
		const existing = await dbOrTx.query.characters.findFirst({
			where: and(
				eq(schema.characters.uuid, incomingUuid),
				eq(schema.characters.userId, userId)
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
 * Inserts a parsed lorebook's entries as rows of the declared type, routed
 * per-entry via `entryTypeIdOf()`. Shared by both the "create new" and
 * "overwrite" import paths.
 */
interface RestoredEntryRefs {
	// Export-assigned history-entry localId -> real lorebook_entries.id.
	historyEntryLocalIdToRealId: Map<number, number>
	// Export-assigned scene localId -> real scenes.id (scenes nest under
	// their owning history entry on export, but narrativeGraph nodes/
	// relationships reference them by their own localId).
	sceneLocalIdToRealId: Map<number, number>
	// Export-assigned entry localId -> real lorebook_entries.id. Its own
	// space, carrying whichever entries the document points at: an edge
	// endpoint of kind `entry`, and an entry's own parent.
	entryLocalIdToRealId: Map<number, number>
}

async function insertLorebookEntries(
	lorebookId: number,
	entries: any[],
	bindingLocalIdToRealId: Map<number, number>,
	dbOrTx: Db = db
): Promise<RestoredEntryRefs> {
	// Position is per `(lorebook, type)`, so each type counts from zero —
	// which is what the three counters this replaces were doing.
	const positions = new Map<EntryTypeId, number>(
		ENTRY_TYPE_IDS.map((t) => [t, 0])
	)
	const queries: Promise<any>[] = []
	const historyEntryLocalIdToRealId = new Map<number, number>()
	const sceneLocalIdToRealId = new Map<number, number>()
	const entryLocalIdToRealId = new Map<number, number>()
	// An entry's parent is written after every entry exists: a district can be
	// filed before its city is inserted, and these rows go in concurrently.
	const pendingAnchors: Array<{
		realId: number
		localId: number | null
		anchorLocalId: number
	}> = []

	/** What the document points at this row with, once the row has an id. */
	const recordEntryRefs = (meta: any, realId: number) => {
		const localId =
			typeof meta?.entryLocalId === "number" ? meta.entryLocalId : null
		if (localId !== null) entryLocalIdToRealId.set(localId, realId)
		if (typeof meta?.anchorEntryLocalId === "number")
			pendingAnchors.push({
				realId,
				localId,
				anchorLocalId: meta.anchorEntryLocalId
			})
	}

	for (const entry of entries) {
		const typeId = entryTypeIdOf(entry)
		const position = positions.get(typeId)!
		positions.set(typeId, position + 1)

		const meta = entry.extensions?.serenepub ?? {}
		const bindingLocalId = meta.bindingLocalId
		// A SillyTavern *native* World Info entry (`disable`, `caseSensitive`,
		// `key`) reaches this door too; the adapter is strictly additive, so a
		// CCv2/V3 or Serene Pub entry passes through it unchanged. Without it a
		// disabled native entry imported enabled (finding #71).
		const normalized = normalizeNativeWorldInfoEntry(entry)
		const mapped = mapImportedEntry(normalized, typeId, position)
		const values = {
			...entryInsert({
				...(mapped as any),
				typeId,
				lorebookId,
				// Ignored by `entryInsert` for a type that declares no anchor,
				// so it is resolved once here rather than behind a second
				// branch.
				lorebookBindingId:
					typeof bindingLocalId === "number"
						? (bindingLocalIdToRealId.get(bindingLocalId) ?? null)
						: null
			}),
			// One file key, one stored key: the joined string `entryInsert`
			// re-splits on commas would tear a `{1,3}` quantifier or a literal
			// "Smith, John" in two (finding #146).
			...importedKeyColumns(normalized)
		}

		// Only the dated type carries nested scenes, so only it does more than
		// record the id it got back. These still run concurrently; what each
		// one returns is a single id.
		if (typeId !== HISTORY_TYPE_ID) {
			queries.push(
				(async () => {
					const [row] = await dbOrTx
						.insert(schema.lorebookEntries)
						.values(values)
						.returning({ id: schema.lorebookEntries.id })
					recordEntryRefs(meta, row.id)
				})()
			)
			continue
		}

		queries.push(
			(async () => {
				const [historyRow] = await dbOrTx
					.insert(schema.lorebookEntries)
					.values(values)
					.returning()

				if (typeof meta.localId === "number") {
					historyEntryLocalIdToRealId.set(meta.localId, historyRow.id)
				}
				recordEntryRefs(meta, historyRow.id)

				// Nested scenes — each still gets its own document-scoped
				// localId (see mapEntry) so narrativeGraph can reference one.
				// sessionId/selectedMessageIds were deliberately never exported
				// — they're session-instance-specific and can't round-trip.
				// participantCharacters/mentionedCharacters are binding
				// localIds now (see the merge plan) — resolve back to real ids
				// via the same map bindingLocalId elsewhere in this format
				// uses. A legacy export's name-string arrays silently resolve
				// to nothing here (every entry fails the `=== "number"` check)
				// rather than erroring — the scene still imports, just without
				// its old cast list, consistent with this whole function's
				// best-effort philosophy.
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
					const participantCharacters = resolveBindingIds(
						scene?.participantCharacters
					)
					const mentionedCharacters = resolveBindingIds(
						scene?.mentionedCharacters
					)
					const [sceneRow] = await dbOrTx
						.insert(schema.scenes)
						.values({
							lorebookId,
							historyEntryId: historyRow.id,
							sessionId: null,
							name: scene?.name ?? null,
							selectedMessageIds: [],
							summary: scene?.summary ?? null,
							// The import file recorded a cast, so this scene
							// counts as resolved even if every entry was
							// dropped as unresolvable above.
							castResolvedAt: new Date()
						})
						.returning()
					// Cast lives in scene_characters, so it is written after
					// the row exists (the FK requires a scene id).
					await writeSceneCast(
						sceneRow.id,
						{ participantCharacters, mentionedCharacters },
						dbOrTx as any
					)
					if (typeof scene?.localId === "number") {
						sceneLocalIdToRealId.set(scene.localId, sceneRow.id)
					}
				}
			})()
		)
	}

	await Promise.all(queries)

	// The `parent` role, once every row it could name exists. A link the file
	// states but this import cannot honour (a missing parent, a cycle) leaves
	// the entry at the top level rather than failing the import, which is this
	// whole function's rule for a reference it cannot resolve.
	for (const { realId, anchorRealId } of resolveAnchorEntryLinks(
		pendingAnchors,
		entryLocalIdToRealId
	)) {
		await dbOrTx
			.update(schema.lorebookEntries)
			.set({ anchorEntryId: anchorRealId })
			.where(eq(schema.lorebookEntries.id, realId))
	}

	return {
		historyEntryLocalIdToRealId,
		sceneLocalIdToRealId,
		entryLocalIdToRealId
	}
}

/**
 * One end of an imported edge, in whichever spelling the file used: the kinded
 * `{ kind, node | entry }` one, or the flat cast local id a file written before
 * entry endpoints carries. Null when the file names something this import did
 * not restore — the caller drops the whole edge, since half an edge is a
 * dangling half.
 */
function resolveEdgeEndpoint(
	endpoint: any,
	flatLocalId: unknown,
	nodeLocalIdToRealId: Map<number, number>,
	entryLocalIdToRealId: Map<number, number>
):
	| { nodeId: number; entryId: null }
	| { nodeId: null; entryId: number }
	| null {
	if (endpoint?.kind === "entry" && typeof endpoint.entry === "number") {
		const entryId = entryLocalIdToRealId.get(endpoint.entry)
		return entryId === undefined ? null : { nodeId: null, entryId }
	}
	const localId =
		endpoint?.kind === "cast" && typeof endpoint.node === "number"
			? endpoint.node
			: flatLocalId
	if (typeof localId !== "number") return null
	const nodeId = nodeLocalIdToRealId.get(localId)
	return nodeId === undefined ? null : { nodeId, entryId: null }
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
	entryRefs: RestoredEntryRefs,
	boundEntityByRealId: Map<
		number,
		{ characterId: number | null }
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
						? (entryRefs.historyEntryLocalIdToRealId.get(
								node.historyEntryLocalId
							) ?? null)
						: null
				const sceneId =
					typeof node?.sceneLocalId === "number"
						? (entryRefs.sceneLocalIdToRealId.get(
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
					const isEntityLinked = !!boundEntity?.characterId
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
				const from = resolveEdgeEndpoint(
					rel?.from,
					rel?.fromLocalId,
					nodeLocalIdToRealId,
					entryRefs.entryLocalIdToRealId
				)
				const to = resolveEdgeEndpoint(
					rel?.to,
					rel?.toLocalId,
					nodeLocalIdToRealId,
					entryRefs.entryLocalIdToRealId
				)
				// Both endpoints must resolve to a row actually restored above.
				if (!from || !to) continue
				const historyEntryId =
					typeof rel?.historyEntryLocalId === "number"
						? (entryRefs.historyEntryLocalIdToRealId.get(
								rel.historyEntryLocalId
							) ?? null)
						: null
				const sceneId =
					typeof rel?.sceneLocalId === "number"
						? (entryRefs.sceneLocalIdToRealId.get(
								rel.sceneLocalId
							) ?? null)
						: null

				await db.insert(schema.narrativeRelationships).values({
					lorebookId,
					fromNodeId: from.nodeId,
					fromEntryId: from.entryId,
					toNodeId: to.nodeId,
					toEntryId: to.entryId,
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
			lorebookBindings: true
		}
	})
	if (!completedBook) throw new Error("Failed to retrieve lorebook.")
	// One list, of every type — `typeId` is what splits it, and the importer's
	// caller reads the entries to confirm what landed rather than to render
	// them per tab.
	return { ...completedBook, entries: await loadBookEntries(db, lorebookId) }
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
	dbOrTx: Db
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

/** Creates a brand-new lorebook (+ bound entities, bindings, entries) from a parsed lorebook payload. */
/** The story time an imported file carries, as lorebook columns. */
function importedStoryTime(serenepub: any) {
	const st = serenepub?.storyTime
	if (!st || typeof st !== "object") return {}
	const calendar = readStoryCalendar(st.calendar ?? null)
	const c = st.clock
	const clock =
		c && Number.isInteger(c.year) && !clockProblem(c, calendar)
			? (c as StoryClock)
			: null
	return { storyCalendar: calendar, ...clockColumns(clock) }
}

/**
 * The story time an OVERWRITE writes: the file's, or — when the file carries
 * none — free-form with no clock. `importedStoryTime` alone returns `{}` for
 * such a file, which left the old calendar and clock in place, so a file that
 * differed only in story time conflicted forever (finding #15).
 */
function overwrittenStoryTime(serenepub: any) {
	const st = importedStoryTime(serenepub) as Partial<
		typeof schema.lorebooks.$inferInsert
	>
	return "storyCalendar" in st
		? st
		: { storyCalendar: null, ...clockColumns(null) }
}

/**
 * What an overwrite-import deletes that the file cannot bring back — dated
 * changes, presences, lines (branches) and scenes captured from a session.
 * Shown in the conflict prompt before the user chooses Overwrite.
 */
export async function overwriteLosses(
	lorebookId: number,
	dbOrTx: Db = db
): Promise<Sockets.Lorebooks.OverwriteLosses> {
	const countIn = async (table: any, extra?: any) => {
		const [row] = await dbOrTx
			.select({ n: sql<number>`count(*)::int` })
			.from(table)
			.where(
				extra
					? and(eq(table.lorebookId, lorebookId), extra)
					: eq(table.lorebookId, lorebookId)
			)
		return Number(row?.n ?? 0)
	}
	const entryAmendments = await countIn(schema.entryAmendments)
	const castAmendments = await countIn(schema.castAmendments)
	return {
		amendments: entryAmendments + castAmendments,
		presences: await countIn(schema.castPresences),
		branches: await countIn(schema.lorebookBranches),
		sceneLinks: await countIn(
			schema.scenes,
			sql`${schema.scenes.sessionId} IS NOT NULL`
		)
	}
}

async function createLorebookFromParsedCard(
	card: ParsedImportedLorebook,
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
		entryRefs,
		syncCharacterIds,
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
				// The book's calendar and main's clock, when the file carries
				// them (DESIGN-story-time P5). A malformed calendar reads as
				// free-form rather than failing the import.
				...importedStoryTime(card.extensions?.serenepub),
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
			boundEntityByRealId
		} = await restoreBoundEntities(
			book.id,
			card.extensions?.serenepub,
			userId,
			tx
		)
		const entryRefs = await insertLorebookEntries(
			book.id,
			card.entries,
			bindingLocalIdToRealId,
			tx
		)
		return {
			book,
			bindingLocalIdToRealId,
			entryRefs,
			syncCharacterIds,
			boundEntityByRealId
		}
	})

	for (const characterId of syncCharacterIds) {
		await syncLorebookBindingsForCharacter(characterId)
	}
	await restoreNarrativeGraph(
		book.id,
		card.extensions?.serenepub,
		userId,
		bindingLocalIdToRealId,
		entryRefs,
		boundEntityByRealId
	)
	return fetchCompletedLorebook(book.id)
}

/**
 * Overwrites an existing lorebook's metadata + entries wholesale from a
 * parsed lorebook payload — simplest, most predictable "Overwrite" semantics.
 * Bindings are wiped and recreated the same way entries are; the bound
 * characters/personas themselves are resolved via restoreBoundEntities's
 * own uuid+hash dedup (reused, not re-created wholesale).
 */
async function overwriteLorebookFromParsedCard(
	existingId: number,
	card: ParsedImportedLorebook,
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
		entryRefs,
		syncCharacterIds,
		boundEntityByRealId
	} = await db.transaction(async (tx) => {
		await tx
			.update(schema.lorebooks)
			.set({
				name: card.name || "Imported Lorebook",
				description: card.description,
				extraJson: extractLorebookLevelExtraJson(rawData),
				...overwrittenStoryTime(card.extensions?.serenepub)
			})
			.where(eq(schema.lorebooks.id, existingId))

		// Attribute rows the book's members own at the template layer have no
		// foreign key (owner ids are polymorphic), so the cascades below would
		// orphan them. Read the owner ids before those rows go.
		const memberIds = (
			await tx
				.select({ id: schema.lorebookBindings.id })
				.from(schema.lorebookBindings)
				.where(eq(schema.lorebookBindings.lorebookId, existingId))
		).map((r) => r.id)
		const placeIds = (
			await tx
				.select({ id: schema.lorebookEntries.id })
				.from(schema.lorebookEntries)
				.where(eq(schema.lorebookEntries.lorebookId, existingId))
		).map((r) => r.id)
		for (const table of [
			schema.attributeValues,
			schema.attributeConfigs
		] as const) {
			for (const [kind, ids] of [
				["cast_member", memberIds],
				["location", placeIds]
			] as const) {
				if (ids.length === 0) continue
				await tx
					.delete(table as any)
					.where(
						and(
							eq((table as any).ownerKind, kind),
							inArray((table as any).ownerId, ids as number[]),
							isNull((table as any).sessionId)
						)
					)
			}
		}

		// One delete where three stood — and it takes the scenes with it, via
		// the cascade a history entry's scenes have always had.
		await tx
			.delete(schema.lorebookEntries)
			.where(eq(schema.lorebookEntries.lorebookId, existingId))
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
		// The lines themselves: nothing is left on them once entries and
		// bindings are gone, their clocks are stale, and the file carries main
		// only (finding #16; the conflict prompt showed the counts first).
		// Sessions played on one fall back to main (`set null`).
		await tx
			.delete(schema.lorebookBranches)
			.where(eq(schema.lorebookBranches.lorebookId, existingId))

		const {
			bindingLocalIdToRealId,
			syncCharacterIds,
			boundEntityByRealId
		} = await restoreBoundEntities(
			existingId,
			card.extensions?.serenepub,
			userId,
			tx
		)
		const entryRefs = await insertLorebookEntries(
			existingId,
			card.entries,
			bindingLocalIdToRealId,
			tx
		)
		return {
			bindingLocalIdToRealId,
			entryRefs,
			syncCharacterIds,
			boundEntityByRealId
		}
	})

	for (const characterId of syncCharacterIds) {
		await syncLorebookBindingsForCharacter(characterId)
	}
	await restoreNarrativeGraph(
		existingId,
		card.extensions?.serenepub,
		userId,
		bindingLocalIdToRealId,
		entryRefs,
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
			// key/keysecondary fields) that parseImportedLorebook() on its
			// own would silently turn into an empty book rather than error on.
			const lorebookData = normalizeLegacyLorebookData(
				params.lorebookData
			)
			// Reads the payload's own fields rather than handing it to
			// @lenml/char-card-reader, whose book constructor splits every key
			// on `[,|;，；]` — which shredded a regex key (`/foo|bar/i` →
			// `/foo` + `bar/i`) on this door alone, while the bulk import path
			// read the same file's keys intact. See parseImportedLorebook for
			// what the reader backfilled and how each of those is supplied.
			const card = parseImportedLorebook(lorebookData)
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
					)
				})

				if (existing) {
					// Compared against the RAW incoming payload, not the parsed
					// book — the parse is a lossy read of the file (it keeps
					// only the four fields the importer writes from, and drops
					// scan_depth/token_budget/recursive_scanning entirely),
					// which would otherwise make an untouched re-import look
					// "changed" against a freshly rebuilt export of the
					// unchanged existing row. Uses the same
					// buildLorebookExportData a real export uses (bindings/
					// characters/personas/narrativeGraph attached), not a bare
					// buildSpecV3Lorebook — otherwise a straight, unedited
					// re-import would always hash differently from what was
					// actually exported and never report "unchanged".
					const { specBookWithGraph: existingExportData } =
						await buildLorebookExportData(existing.id, userId)
					const existingHash = hashCanonicalJson(
						comparableLorebookData(existingExportData)
					)
					const incomingHash = hashCanonicalJson(
						comparableLorebookData(lorebookData)
					)

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
							lorebookData,
							losses: await overwriteLosses(existing.id)
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

			// Lazily, and exactly once: `relistLorebooks` emits `lorebooks:list`
			// itself, so a second emit of its result beside this call is the same
			// payload twice. One stood here; it is gone.
			if (emitToUser) await relistLorebooks(socket, emitToUser)

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
 * A copy of a book: every row it owns, written again under new ids in ONE
 * transaction (owner ruling 2026-09-28 — "Duplicate is an exact copy").
 *
 * ⚠ Never export → import. The file format carries a main-line snapshot and
 * nothing of branches, amendments, presences, tags or unowned cards; a copy
 * made through it silently lost all of those. `duplicateLorebookRows` says
 * what travels and the few things that deliberately do not.
 *
 * Owner only, the same rule as delete: the read is scoped by `userId` and a
 * book this caller does not own is "not found". The copy takes a fresh uuid.
 */
export const lorebooksDuplicateHandler: Handler<
	Sockets.Lorebooks.Duplicate.Params,
	Sockets.Lorebooks.Duplicate.Response
> = {
	event: "lorebooks:duplicate",
	handler: async (socket, params, emitToUser) => {
		try {
			const userId = socket.user!.id

			const source = await db.query.lorebooks.findFirst({
				where: and(
					eq(schema.lorebooks.id, params.lorebookId),
					eq(schema.lorebooks.userId, userId)
				),
				columns: { id: true, name: true }
			})
			if (!source) throw new Error("Lorebook not found.")

			const { id } = await db.transaction((tx) =>
				duplicateLorebookRows(
					tx,
					source.id,
					userId,
					params.name?.trim() || `${source.name} (copy)`
				)
			)
			const completedBook = await fetchCompletedLorebook(id)

			await relistLorebooks(socket, emitToUser)

			const res: Sockets.Lorebooks.Duplicate.Response = {
				lorebook: completedBook
			}
			emitToUser("lorebooks:duplicate", res)
			return res
		} catch (error: any) {
			console.error("Error duplicating lorebook:", error)
			emitToUser("lorebooks:duplicate:error", {
				error: error.message || "Failed to duplicate lorebook."
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
			// Same bypass as lorebooks:import above — the reader's key
			// splitting must not reach either door.
			const card = parseImportedLorebook(lorebookData)
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

			// Lazily, and exactly once: `relistLorebooks` emits `lorebooks:list`
			// itself, so a second emit of its result beside this call is the same
			// payload twice. One stood here; it is gone.
			if (emitToUser) await relistLorebooks(socket, emitToUser)

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
	register(socket, lorebooksDuplicateHandler, emitToUser)

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
