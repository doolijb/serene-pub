import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm"
import {
	resolveOrCreateBindingRow,
	syncLorebookBindingsForCharacter
} from "$lib/server/utils/characterBindingSync"
import { canViewCharacter } from "$lib/server/utils/sessionAccess"
import { cardTakenBy } from "$lib/server/utils/castMemberCards"
import { retoldFieldList } from "$lib/shared/lorebooks/retold"
import { retoldUpdateProblem } from "$lib/server/lorebooks/retold"
import { createMedia, readMedia, sniffMedia } from "$lib/server/media"
import { storeLorebookCover, uploadedBytes } from "$lib/server/utils"
import {
	MediaKind,
	MediaVariant,
	MediaVisibility
} from "$lib/shared/constants/MediaVisibility"
import {
	mapImportedEntry,
	entryTypeIdOf,
	normalizeLegacyLorebookData,
	normalizeNativeWorldInfoEntry,
	importedKeyColumns,
	importedStatRows,
	lorebookFileFormatOf,
	parseImportedLorebook,
	resolveAnchorEntryLinks,
	resolveParentNodeLinks,
	secondaryKeysOf,
	unfileable,
	type ParsedImportedLorebook
} from "$lib/server/utils/lorebookImportMapper"
import { lorebookFileTooLarge } from "$lib/shared/imports/fileCaps"
import { holdImport, takeHeldImport } from "$lib/server/imports/heldImports"
import { withImportLimit } from "$lib/server/imports/importLimit"
import { assertImportJsonShape } from "$lib/server/imports/jsonShape"
import { buildLorebookExportData } from "$lib/server/utils/lorebookExportBuilder"
import { duplicateLorebookRows } from "$lib/server/utils/lorebookDuplicate"
import {
	afterKitCopy,
	bookFromKit,
	kitRefOf,
	resolveKit,
	STARTER_KIT_KIND,
	STARTER_KIT_SENTENCES
} from "$lib/server/lorebooks/starterKits"
import { relayToBookReaders } from "$lib/server/sockets/utils/bookReaders"
import { LOREBOOK_EXPORT_PAUSED } from "$lib/shared/lorebooks/exportPaused"
import { deriveNextBindingToken } from "$lib/server/utils/lorebookBindingToken"
import {
	MAX_TYPED_MEMBER_NUMBER,
	castTag,
	castTagNumber,
	castTagsIn,
	importedCastTagNumber,
	rewriteImportedCastTagsDeep,
	type CastTagReplacer
} from "$lib/server/utils/castTags"
import { resolveOrCreateBindingByName } from "$lib/server/utils/summarizer/availableSceneCast"
import { hashCanonicalJson } from "$lib/server/utils/contentHash"
import { isValidUuid } from "$lib/server/utils/uuid"
import { findOrCreateTagId } from "$lib/server/utils/tags"
import {
	extractCharacterUuid,
	buildExistingCharacterComparisonData,
	createCharacterFromParsedData,
	overwriteCharacterFromParsedData,
	buildCharactersList
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
import { askerOf, refusable } from "./refusable"
import { bookLoreWriteMode } from "$lib/server/state/loreWriteMode"
import {
	LORE_WRITES_OFF,
	isLoreWriteMode
} from "$lib/shared/lorebooks/loreWriteMode"
import { isUniqueViolation } from "$lib/server/db/errors"
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
import {
	datesThatDoNotLand,
	readStoryCalendar,
	type StoryClock
} from "$lib/shared/lorebooks/storyDate"
import { clockColumns, clockProblem, datedRowsOf } from "$lib/server/state/storyTime"
import {
	bookStatOwners,
	purgeLorebook
} from "$lib/server/lorebooks/tableRegistry"
import {
	countSessionLoreRefs,
	dropSessionLoreRefs
} from "$lib/server/state/sessionLoreRefs"
import { autoEnqueueLorebook } from "$lib/server/embedding/vectorizationQueue"
import { pickableRulesets } from "$lib/server/rulesets/pubRulesets"
import { enqueueLorebookAnnotation } from "$lib/server/annotations/queue"
import { serverFailureAs } from "$lib/server/imports/importFailure"
import {
	getAttributeSlot,
	getRuleset,
	resolveSlotConfig
} from "@serene-pub/sdk"
import {
	BOOK_DEFAULT_RULES,
	bookRulesChoices
} from "$lib/server/rulesets/genreOffer"
import { findLinkedThatWay } from "$lib/server/utils/relationshipGuards"
import { sanitizeRelationshipVisibility } from "$lib/server/utils/relationshipVisibility"
import {
	RELATIONSHIP_STATUSES,
	RELATIONSHIP_TEXT_LIMITS
} from "$lib/shared/lorebooks/linkVocabulary"
import {
	ITEM_TYPE_ID,
	LOCATION_TYPE_ID
} from "$lib/shared/entries/types"
import {
	LOREBOOK_NOT_FOUND,
	assertOwnedBook,
	assertReadableBook,
	findOwnedBook,
	lorebookAccessFor
} from "$lib/server/utils/ownedBook"
import {
	listSharedWith,
	replaceShares,
	sharedLorebookIdsFor
} from "$lib/server/utils/shares"
import { pushToUser } from "./utils/userPush"
import type {
	LorebooksShareParams,
	LorebooksShareResponse
} from "$lib/shared/sockets/conversations"
// SelectTag/SelectLorebookTag/InsertHistoryEntry are declared globally in
// $lib/server/db/types.d.ts (ambient `export global {}` block, same pattern
// as the Sockets namespace) — no import needed/available for them.

// `parentNodeId`/`sceneId`/`historyEntryId` are foreign keys into rows that
// must belong to the SAME lorebook as the binding being written — allowlisting
// the field isn't enough on its own, since the value could still point at
// another tenant's row (eg. another user's lorebookBindings id as
// parentNodeId), creating a cross-tenant reference the graph-context builder
// could later join through into prompt content. The ONE check for a cast
// row's references: `lorebooks:updateBinding` is the only door that writes
// them after create (plan B2 — the graph's `narrativeGraph:updateNode`, which
// repeated these checks, is gone).
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
		// Same book, not itself, and the two-level rule (finding #22) — the
		// shared guard create and update both use.
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
/** The cover image's address, as every lorebook payload joins it: what a
 *  browser caches against, and the crop the editor opens on. */
const COVER_MEDIA_COLUMNS = {
	columns: { uuid: true, rev: true, frame: true }
} as const

async function coverMediaOf(
	tx: Pick<Db, "select">,
	coverMediaId: number | null
): Promise<Sockets.AvatarMedia | null> {
	if (!coverMediaId) return null
	const [media] = await tx
		.select({
			uuid: schema.files.uuid,
			rev: schema.files.rev,
			frame: schema.files.frame
		})
		.from(schema.files)
		.where(eq(schema.files.id, coverMediaId))
	return media ?? null
}

/**
 * The lorebook rows as the Lorebooks view draws them. `"books"` is the main
 * list; `"sessionNotes"` (pr-6, B §B-3) is the asker's own books — the ones
 * with a `session_id` — each also naming its session and the shared book it
 * overlays, newest session first. One row mapping for both.
 */
function buildLorebooksList(userId: number): Promise<Sockets.Lorebooks.List.Response>
function buildLorebooksList(
	userId: number,
	which: "sessionNotes"
): Promise<Sockets.Lorebooks.SessionNotes.Response>
function buildLorebooksList(
	userId: number,
	which: "books"
): Promise<Sockets.Lorebooks.List.Response>
async function buildLorebooksList(
	userId: number,
	which: "books" | "sessionNotes" = "books"
): Promise<Sockets.Lorebooks.List.Response | Sockets.Lorebooks.SessionNotes.Response> {
	if (!userId) return which === "books" ? { lorebookList: [] } : { books: [] }
	// Books other people **shared** with the asker (PLAN-private-messages
	// §6.7) ride the same read, each marked and named by its owner.
	const sharedIds =
		which === "books" ? await sharedLorebookIdsFor(db as unknown as Db, userId) : []
	const books = await db.query.lorebooks.findMany({
		// 🚧 Never a session's own book in the main list (PLAN-rulesets §26):
		// they are listed apart, as Session notes (`which: "sessionNotes"`).
		where: (l, { and, eq, inArray, isNotNull, isNull, or }) =>
			which === "sessionNotes"
				? and(isNotNull(l.sessionId), eq(l.userId, userId))
				: and(
				isNull(l.sessionId),
				// 🚧 Starter lorebooks (PLAN-lorebook-kinds §B): the asker's own come
				// back marked by their book kind, for a group of their own; no
				// one else's kit is ever on this shelf (a kit is never shared).
				sharedIds.length
					? or(
							eq(l.userId, userId),
							and(inArray(l.id, sharedIds), eq(l.kind, "book"))
						)
					: eq(l.userId, userId)
			),
		orderBy: (l, { desc }) => desc(l.name),
		with: {
			user: { columns: { username: true, displayName: true } },
			coverMedia: COVER_MEDIA_COLUMNS,
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

	// 🚧 Which of the asker's own sessions read each book (DC walk 6: a book
	// made from a session said "Not read by a session" while it was read).
	// The asker's sessions only — another person's session is theirs.
	const readers = books.length
		? await db
				.select({
					id: schema.sessions.id,
					name: schema.sessions.name,
					lorebookId: schema.sessions.lorebookId
				})
				.from(schema.sessions)
				.where(
					and(
						eq(schema.sessions.userId, userId),
						inArray(
							schema.sessions.lorebookId,
							books.map((b) => b.id)
						)
					)
				)
				.orderBy(desc(schema.sessions.updatedAt))
		: []
	const readByOf = (lorebookId: number) =>
		readers
			.filter((r) => r.lorebookId === lorebookId)
			.map((r) => ({ id: r.id, name: r.name ?? null }))

	// Transform lorebook tags to include tags as string array. The three
	// entry lists are id-only and exist for the card's counts, so they are
	// split back out of the one relation rather than fetched three times.
	const booksWithTags = books.map((book) => {
		const { lorebookEntries: allEntries, user, ...rest } = book
		// The list holds the asker's own books and the ones shared with them
		// — never an admin's view of another's — so a row is one or the other.
		const shared =
			book.userId !== userId
				? {
						isSharedWithMe: true,
						ownerName: user?.displayName || user?.username || null,
						bookAccess: "shared" as const
					}
				: { bookAccess: "owner" as const }
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
			readBy: readByOf(book.id),
			tags:
				book.lorebookTags?.map(
					(lt: SelectLorebookTag & { tag: SelectTag }) => lt.tag.name
				) || [],
			...shared
		}
	})

	if (which === "books") return { lorebookList: booksWithTags }

	// Session notes: each own book names its session and the shared book it
	// overlays.
	const sessionIds = booksWithTags.map((b) => b.sessionId!).filter((id) => id != null)
	const sessionRows = sessionIds.length
		? await db
				.select({
					id: schema.sessions.id,
					name: schema.sessions.name,
					updatedAt: schema.sessions.updatedAt
				})
				.from(schema.sessions)
				.where(inArray(schema.sessions.id, sessionIds))
		: []
	const sessionOf = new Map(sessionRows.map((r) => [r.id, r]))
	const overlayIds = [...new Set(booksWithTags.map((b) => b.overlayOf).filter((id): id is number => id != null))]
	const overlayRows = overlayIds.length
		? await db
				.select({ id: schema.lorebooks.id, name: schema.lorebooks.name })
				.from(schema.lorebooks)
				.where(inArray(schema.lorebooks.id, overlayIds))
		: []
	const overlayName = new Map(overlayRows.map((r) => [r.id, r.name]))
	const notes = booksWithTags
		.filter((b) => b.sessionId != null && sessionOf.has(b.sessionId))
		.map((b) => {
			const session = sessionOf.get(b.sessionId!)!
			return {
				updatedAt: session.updatedAt?.getTime() ?? 0,
				row: {
					...b,
					sessionId: b.sessionId!,
					sessionName: session.name ?? null,
					attached:
						b.overlayOf != null && overlayName.has(b.overlayOf)
							? { id: b.overlayOf, name: overlayName.get(b.overlayOf)! }
							: null
				}
			}
		})
		.sort((a, b) => b.updatedAt - a.updatedAt)
	return { books: notes.map((n) => n.row) }
}

/**
 * The lorebook list, re-sent to the caller after a mutation that changed it.
 *
 * The LAZY form (socket-interest plan, ruling 4): these are pushes, not
 * replies, so a create, a rename or an import made from a surface that shows
 * no lorebook list pays for no re-list at all. Skipping the emit alone would
 * save nothing; the query is the cost.
 */
export function relistLorebooks(
	socket: any,
	emitToUser: (event: string, data: any) => void
) {
	return emitToUser("lorebooks:list", () =>
		buildLorebooksList(socket.user!.id)
	)
}

/**
 * 🚧 The asker's Session notes, re-sent after a Share verb, a session made or
 * deleted (pr-6, B §B-3) — the lazy form of `relistLorebooks`.
 */
export function relistSessionNotes(
	socket: any,
	emitToUser: (event: string, data: any) => void
) {
	return emitToUser("lorebooks:sessionNotes", () =>
		buildLorebooksList(socket.user!.id, "sessionNotes")
	)
}

export const lorebooksSessionNotesHandler: Handler<
	Sockets.Lorebooks.SessionNotes.Params,
	Sockets.Lorebooks.SessionNotes.Response
> = refusable(
	"lorebooks:sessionNotes",
	async (socket, _params: Sockets.Lorebooks.SessionNotes.Params, emitToUser) => {
		const res = await buildLorebooksList(socket.user!.id, "sessionNotes")
		emitToUser("lorebooks:sessionNotes", res)
		return res
	},
	"Your session notes could not be listed."
)

export const lorebooksListHandler: Handler<
	Sockets.Lorebooks.List.Params,
	Sockets.Lorebooks.List.Response
> = refusable(
	"lorebooks:list",
	async (socket, params: Sockets.Lorebooks.List.Params, emitToUser) => {
		const res = await buildLorebooksList(socket.user!.id)
		emitToUser("lorebooks:list", res)
		return res
	},
	"Your lorebooks could not be listed."
)

/**
 * 🚧 A book's **Rules** as a person may choose them (`lorebooks.primary_ruleset`):
 * an id the instance has installed, or refused in words. Undefined when the
 * caller sent none. NOMENCLATURE §28: the word the person reads is _rules_.
 */
function chosenBookRules(raw: unknown): string | undefined {
	if (raw === undefined || raw === null) return undefined
	if (typeof raw !== "string" || !getRuleset(raw))
		throw new Error("Those rules aren't installed on this pub.")
	return raw
}

/**
 * `lorebooks:rulesChoices` — the **Rules** a book may be told by, for New
 * lorebook and Book settings: every installed ruleset, Freeform first. No
 * genre stands behind a book, so nothing is recommended or rated here.
 */
export const lorebooksRulesChoicesHandler: Handler<
	Sockets.Lorebooks.RulesChoices.Params,
	Sockets.Lorebooks.RulesChoices.Response
> = refusable(
	"lorebooks:rulesChoices",
	async (_socket, _params, emitToUser) => {
		const res: Sockets.Lorebooks.RulesChoices.Response = {
			choices: bookRulesChoices(pickableRulesets()),
			defaultId: BOOK_DEFAULT_RULES
		}
		if (emitToUser) emitToUser("lorebooks:rulesChoices", res)
		return res
	},
	"The rules could not be listed."
)

/**
 * 🚧 `lorebooks:library` — the book's **‹Rules› library** (PLAN-lorebook-kinds
 * §C, ruling 10): the rules' shipped pieces for the book's entryable lists,
 * shown under the book read-only (hidden by default) and copied into it on
 * edit (`entries:copyFromLibrary`). Readable by whoever may read the book;
 * empty for rules with no library. ⚠ The workspace reads it; a widget never
 * carries a library (`server/rulesets/read.ts`).
 */
export const lorebooksLibraryHandler: Handler<
	Sockets.Lorebooks.Library.Params,
	Sockets.Lorebooks.Library.Response
> = refusable(
	"lorebooks:library",
	async (socket, params: Sockets.Lorebooks.Library.Params, emitToUser) => {
		await assertReadableBook(db, socket.user!.id, params.lorebookId, {
			isAdmin: !!socket.user?.isAdmin
		})
		const { bookLibrary } = await import("$lib/server/lorebooks/rulesLists")
		const library = await bookLibrary(db as unknown as Db, params.lorebookId)
		const res: Sockets.Lorebooks.Library.Response = {
			lorebookId: params.lorebookId,
			name: library.name,
			source: library.source,
			rows: library.rows
		}
		if (emitToUser) emitToUser("lorebooks:library", res)
		return res
	},
	"The book's rules library could not be read."
)

export const lorebooksCreateHandler: Handler<
	Sockets.Lorebooks.Create.Params,
	Sockets.Lorebooks.Create.Response
> = refusable(
	"lorebooks:create",
	async (socket, params: Sockets.Lorebooks.Create.Params, emitToUser) => {
		try {
			const userId = socket.user!.id
			// 🚧 Starting from a starter lorebook (PLAN-lorebook-kinds §B): the
			// kit is copied whole into the new book, and its Rules win — the
			// Rules param is not read.
			const kitRef =
				params.starterKit != null ? kitRefOf(params.starterKit) : undefined
			const kit =
				kitRef !== undefined
					? await resolveKit(db as unknown as Db, kitRef)
					: null
			const primaryRuleset = kit ? undefined : chosenBookRules(params.primaryRuleset)

			let lorebook: typeof schema.lorebooks.$inferSelect
			if (kit) {
				const name = params.name?.trim() || kit.name
				const copy = await db.transaction((tx) =>
					bookFromKit(tx, kit, { userId, name, kind: "book" })
				)
				await afterKitCopy(
					copy,
					userId,
					socket.user?.displayName || socket.user?.username || ""
				)
				if (copy.cards.length && emitToUser)
					await emitToUser("characters:list", () =>
						buildCharactersList(userId)
					)
				;[lorebook] = await db
					.select()
					.from(schema.lorebooks)
					.where(eq(schema.lorebooks.id, copy.lorebookId))
			} else
				[lorebook] = await db
					.insert(schema.lorebooks)
					.values({
						name: params.name,
						userId,
						...(primaryRuleset ? { primaryRuleset } : {})
					})
					.returning()

			if (emitToUser) {
				// The refreshed list, lazily — and exactly ONE of it.
				// `relistLorebooks` emits `lorebooks:list` itself, so a second
				// `emitToUser("lorebooks:list", …)` beside this call puts the same
				// payload on the wire twice. One stood here; it is gone.
				await relistLorebooks(socket, emitToUser)
				emitToUser("lorebooks:create", { lorebook, ...askerOf(params) })
			}

			return { lorebook, ...askerOf(params) }
		} catch (error) {
			console.error("Error creating lorebook:", error)
			throw error
		}
	},
	"The lorebook could not be created.",
	undefined,
	askerOf
)

/**
 * One book as `lorebooks:get` answers it, for `userId`: the request and the
 * share pushes read it through here, so the two can never differ.
 */
async function buildLorebookGet(
	userId: number,
	lorebookId: number
): Promise<Sockets.Lorebooks.Get.Response> {
	// The book's own row and its tags — what Book settings edits. Its
	// entries and cast have their own reads (`entries:list`,
	// `lorebooks:bindingList`); this reply carried both whole for a
	// form that reads neither (Phase D).
	// Owner, or a person it is **shared** with (PLAN-private-messages
	// §4): `lorebookAccessFor`. The administrator exception the entry
	// reads make is NOT extended here — this reply drives the book's
	// workspace, and an admin's read-only view has no presentation yet.
	const access = await lorebookAccessFor(lorebookId, userId, {
		isAdmin: false
	})
	const book = access
		? await db.query.lorebooks.findFirst({
				where: (l, { eq }) => eq(l.id, lorebookId),
				with: {
					lorebookTags: {
						with: {
							tag: true
						}
					},
					user: { columns: { username: true, displayName: true } },
					coverMedia: COVER_MEDIA_COLUMNS
				}
			})
		: undefined

	if (!book) {
		// ⚠ `lorebookId` beside the null, the same treatment as
		// `sessions:get`'s not-found reply: there is no lorebook for the
		// scope extractor to read an id off, so without it this reply has
		// no **interest scope** and only a BARE `lorebooks:get` key could
		// receive it — a key that matches every OTHER book's reply too.
		const res: Sockets.Lorebooks.Get.Response = {
			lorebook: null,
			lorebookId: lorebookId
		}
		return res
	}

	// Transform lorebook tags to include tags as string array
	const { lorebookTags, user, ...bookFields } = book
	const bookWithTags = {
		...bookFields,
		tags: lorebookTags?.map((lt) => lt.tag.name) || [],
		// The one fact the client derives read-only from (lane A3).
		bookAccess: access!,
		// The owner reads who it is shared with; a recipient reads
		// that it is theirs to read, and nothing about other people.
		...(access === "owner"
			? {
					sharedWith: await listSharedWith(
						db as unknown as Db,
						"lorebook",
						book.id
					)
				}
			: {
					isSharedWithMe: true,
					ownerName: user?.displayName || user?.username || null
				})
	}

	const res: Sockets.Lorebooks.Get.Response = {
		lorebook: bookWithTags,
		lorebookId: lorebookId
	}
	return res
}

export const lorebooksGetHandler: Handler<
	Sockets.Lorebooks.Get.Params,
	Sockets.Lorebooks.Get.Response
> = refusable(
	"lorebooks:get",
	async (socket, params: Sockets.Lorebooks.Get.Params, emitToUser) => {
		try {
			const res = await buildLorebookGet(socket.user!.id, params.id)
			emitToUser("lorebooks:get", res)
			return res
		} catch (error: any) {
			console.error("Error fetching lorebook:", error)
			throw error
		}
	},
	"The lorebook could not be opened."
)

/**
 * `lorebooks:share` — replace who a book is **shared** with
 * (PLAN-private-messages §4 "Shares"). Owner only (`assertOwnedBook`); a
 * replace-set in one transaction; every recipient a live account. The reply
 * reaches every tab of the owner; each person added or removed gets a fresh
 * `lorebooks:list` and `lorebooks:get` (gated: only a tab showing one pays).
 */
export const lorebooksShareHandler: Handler<
	LorebooksShareParams,
	LorebooksShareResponse
> = refusable(
	"lorebooks:share",
	async (socket, params: LorebooksShareParams, emitToUser) => {
		const userId = socket.user!.id
		const changed = await db.transaction(async (tx) => {
			const book = await assertOwnedBook(
				tx as unknown as Db,
				userId,
				params?.lorebookId
			)
			// 🚧 A starter lorebook is the pub's already (PLAN-lorebook-kinds §B).
			const [{ kind } = { kind: "book" }] = await tx
				.select({ kind: schema.lorebooks.kind })
				.from(schema.lorebooks)
				.where(eq(schema.lorebooks.id, book.id))
			if (kind === STARTER_KIT_KIND) throw new Error(STARTER_KIT_SENTENCES.share)
			return {
				lorebookId: book.id,
				...(await replaceShares(
					tx as unknown as Db,
					"lorebook",
					book.id,
					userId,
					params.userIds
				))
			}
		})
		const lorebookId = changed.lorebookId
		const res: LorebooksShareResponse = {
			lorebookId,
			sharedWith: await listSharedWith(
				db as unknown as Db,
				"lorebook",
				lorebookId
			)
		}
		emitToUser("lorebooks:share", res)
		for (const recipient of [...changed.added, ...changed.removed]) {
			pushToUser(recipient, "lorebooks:list", () =>
				buildLorebooksList(recipient)
			)
			// A revoked recipient reads the not-found reply; an added one
			// reads the book.
			pushToUser(recipient, "lorebooks:get", () =>
				buildLorebookGet(recipient, lorebookId)
			)
		}
		return res
	},
	"Couldn't change who this lorebook is shared with.",
	undefined,
	(raw) => ({ lorebookId: (raw as { lorebookId?: unknown })?.lorebookId })
)

export const lorebooksUpdateHandler: Handler<
	Sockets.Lorebooks.Update.Params,
	Sockets.Lorebooks.Update.Response
> = refusable(
	"lorebooks:update",
	async (socket, params: Sockets.Lorebooks.Update.Params, emitToUser) => {
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
			// `extraJson` is not written here: nothing reads a book's bag and no
			// form edits it, so a whole row sent back from the form could only
			// overwrite it with a stale copy (audit 2026-10-21).
			const { tags } = params.lorebook
			// The name as a person reads it: trimmed, never empty, within the
			// length an import accepts. The form checks first; a socket client
			// can send anything.
			const name =
				params.lorebook.name === undefined
					? undefined
					: String(params.lorebook.name ?? "").trim()
			if (name !== undefined && !name)
				throw new Error("A lorebook needs a name.")
			if (name && name.length > LOREBOOK_IMPORT_LIMITS.maxNameChars)
				throw new Error(
					`A lorebook's name can be up to ${LOREBOOK_IMPORT_LIMITS.maxNameChars.toLocaleString("en-US")} characters.`
				)
			const description =
				params.lorebook.description === undefined
					? undefined
					: String(params.lorebook.description ?? "")
			if (
				description &&
				description.length > LOREBOOK_IMPORT_LIMITS.maxTextChars
			)
				throw new Error(
					`A lorebook's description can be up to ${LOREBOOK_IMPORT_LIMITS.maxTextChars.toLocaleString("en-US")} characters.`
				)

			// The cover image: a picture replaces it, `null` clears it, absent
			// leaves it. Stored BEFORE the transaction — `createMedia` writes
			// through the outer handle, which inside it would deadlock PGlite —
			// and only once the book is known to be the asker's, so a refused
			// save leaves no file behind.
			// The rules, sent on their own and only when changed — never read
			// off the row, which the form sends back whole. A session's own
			// notes follow their session's rules, so they take none here.
			const primaryRuleset = chosenBookRules(params.primaryRuleset)
			// The book's own lore write mode, the same way: sent on its own.
			const loreWriteMode = params.loreWriteMode
			if (loreWriteMode !== undefined && !isLoreWriteMode(loreWriteMode))
				throw new Error("Writes from sessions are Full, Review changes or Off.")
			if (primaryRuleset !== undefined || loreWriteMode !== undefined) {
				const [owned] = await db
					.select({ sessionId: schema.lorebooks.sessionId })
					.from(schema.lorebooks)
					.where(
						and(
							eq(schema.lorebooks.id, Number(params.lorebook.id)),
							eq(schema.lorebooks.userId, userId)
						)
					)
				if (!owned) throw new Error("Lorebook not found.")
				if (owned.sessionId !== null)
					throw new Error(
						primaryRuleset !== undefined
							? "A session's own notes play their session's rules."
							: "A session's own notes follow their session's lorebook."
					)
			}

			let coverMediaId: number | null | undefined
			if (params.coverFile === null) coverMediaId = null
			else if (params.coverFile !== undefined) {
				if (!(await findOwnedBook(db, userId, params.lorebook.id)))
					throw new Error("Lorebook not found.")
				const coverFile = uploadedBytes(params.coverFile)
				if (!coverFile)
					throw new Error("No picture came with that upload.")
				const { file } = await storeLorebookCover({
					userId,
					lorebookId: params.lorebook.id!,
					coverFile
				})
				coverMediaId = file.id
			}

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
						...(coverMediaId !== undefined ? { coverMediaId } : {}),
						...(primaryRuleset !== undefined ? { primaryRuleset } : {}),
						...(loreWriteMode !== undefined ? { loreWriteMode } : {}),
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
				return {
					...row,
					tags: tagRows.map((t) => t.name),
					coverMedia: await coverMediaOf(tx, row.coverMediaId)
				}
			})

			const res: Sockets.Lorebooks.Update.Response = {
				lorebook: updated,
				...askerOf(params)
			}
			emitToUser("lorebooks:update", res)
			await relistLorebooks(socket, emitToUser) // Refresh list
			// The people it is shared with read the name and the cover off
			// their own list, built as each of them.
			await relayToBookReaders(socket, updated.id, "lorebooks:list", (readerId) =>
				buildLorebooksList(readerId)
			)
			return res
		} catch (error: any) {
			console.error("Error updating lorebook:", error)
			throw error
		}
	},
	"The lorebook could not be saved.",
	undefined,
	askerOf
)

export const lorebooksDeleteHandler: Handler<
	Sockets.Lorebooks.Delete.Params,
	Sockets.Lorebooks.Delete.Response
> = refusable(
	"lorebooks:delete",
	async (socket, params: Sockets.Lorebooks.Delete.Params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Scoped by owner in the same statement; a book that is not
			// this caller's (or is already gone) deletes nothing, and that is
			// a refusal, not a success (finding #20). Everything it holds goes
			// with it, in the same transaction, by the one deletion rule an
			// overwrite uses (`purgeLorebook`): stat owner ids carry no
			// foreign key, so a row on main would outlive the book.
			const deleted = await db.transaction(async (tx) => {
				const mine = and(
					eq(schema.lorebooks.id, params.id),
					eq(schema.lorebooks.userId, userId)
				)
				const [book] = await tx
					.select({ id: schema.lorebooks.id })
					.from(schema.lorebooks)
					.where(mine)
					.limit(1)
				if (!book) return []
				await purgeLorebook(tx, book.id)
				return await tx
					.delete(schema.lorebooks)
					.where(mine)
					.returning({ id: schema.lorebooks.id })
			})
			if (deleted.length === 0) throw new Error("Lorebook not found.")

			const res: Sockets.Lorebooks.Delete.Response = {
				success: "Lorebook deleted successfully",
				id: params.id,
				// The book, under the name every other lorebook reply uses,
				// so client filtering is uniform (plan B5).
				lorebookId: params.id
			}
			emitToUser("lorebooks:delete", res)
			await relistLorebooks(socket, emitToUser) // Refresh list
			return res
		} catch (error: any) {
			console.error("Error deleting lorebook:", error)
			throw error
		}
	},
	"The lorebook could not be deleted."
)

/**
 * Mints a cast member for a cast tag an entry names that no member holds —
 * a tag typed by hand, or pasted from another book. Never deletes a row —
 * a prior "delete any binding whose token isn't literally present in
 * content anymore" heuristic here was removed (same false-positive class
 * removed from the graph-rebuild path this session): bindingMergeLogs
 * references node ids as plain JSON with no real FK, so deleting one left
 * relationship endpoints dangling, or silently nulled a past merge's
 * survivorId, permanently disabling that merge's undo, on completely
 * routine lore edits. Manual per-node deletion via
 * narrativeGraph:deleteNode remains the only way to remove an unwanted
 * node.
 *
 * ⚠ **Only a number the book has never issued is minted (A16).** A tag
 * below `next_binding_number` names a member this book numbered and has
 * since lost — absorbed by a merge, or deleted. Minting it again brought that
 * member back as a blank row, and an undoMerge then put the real one back
 * beside it: two members on one tag. The merge and the delete rewrite the
 * tags they leave behind (`rewriteBookCastTags`), so such a tag reaches here
 * only from text written before they did — an editor's unsaved draft, an
 * older copy — and it stays what it is, a tag with no member, which the
 * editor shows as one. Numbers are never reused within a book; this is the
 * entry save keeping that rule.
 *
 * ⚠ **Only the `char` prefix is a tag.** `{{roll:20}}` is a dice macro: the
 * old `{{word:N}}` scan minted a member for it and moved the counter to 21.
 * And only the `{{char:N}}` spelling: 0.5's `{char:N}` is prose here, as it
 * is to the prompt and the editor (`castTags.ts`).
 *
 * ⚠ **Nothing past `MAX_TYPED_MEMBER_NUMBER`.** A ledger number typed as a
 * tag would move the counter to the edge of its range, and every member
 * added after it would fail.
 */
export async function syncLorebookBindings({
	lorebookId
}: {
	lorebookId: number
}) {
	// One transaction under the book's advisory lock — the same key every
	// other cast writer takes (resolveOrCreateBindingRow,
	// resolveOrCreateBindingByName, the merge and the delete) — so two
	// concurrent entry writes naming the same new tag cannot both see it
	// missing and both insert it (finding #24). Reads and writes run one after
	// another, on `tx` only.
	await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(${lorebookId})`)
		const [book] = await tx
			.select({ next: schema.lorebooks.nextBindingNumber })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, lorebookId))
		if (!book) return
		const held = new Set<number>()
		for (const row of await tx
			.select({ binding: schema.lorebookBindings.binding })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebookId))) {
			const n = castTagNumber(row.binding)
			if (n !== null) held.add(n)
		}
		// Every entry of the lorebook that names a tag at all, of every type —
		// the scan never cared which shape the content came out of.
		const entries = await tx
			.select({ content: schema.lorebookEntries.content })
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, lorebookId),
					sql`${schema.lorebookEntries.content} LIKE ${"%char:%"}`
				)
			)

		const unissued = new Set<number>()
		for (const entry of entries)
			for (const n of castTagsIn(entry.content))
				if (
					!held.has(n) &&
					n >= book.next &&
					n <= MAX_TYPED_MEMBER_NUMBER
				)
					unissued.add(n)
		if (unissued.size === 0) return

		const numbers = [...unissued].sort((a, b) => a - b)
		await tx.insert(schema.lorebookBindings).values(
			numbers.map((n) => ({
				lorebookId,
				binding: castTag(n),
				characterId: null
			}))
		)
		// These numbers came from text, not from deriveNextBindingToken's
		// counter; move the counter past them so it never issues one again.
		await tx
			.update(schema.lorebooks)
			.set({ nextBindingNumber: numbers[numbers.length - 1] + 1 })
			.where(eq(schema.lorebooks.id, lorebookId))
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
 * Access is re-checked here rather than trusted from the caller —
 * `assertReadableBook` (owner, share recipient or admin), so a book the asker
 * may not read is "not found" rather than "found but refused".
 */
export async function buildLorebookBindingList(
	userId: number,
	lorebookId: number
): Promise<Sockets.Lorebooks.BindingList.Response> {
	// A read: owner, share recipient or admin (lane A3). Same refusal.
	await assertReadableBook(db, userId, lorebookId)
	const book = await db.query.lorebooks.findFirst({
		where: (l, { eq }) => eq(l.id, lorebookId),
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

	if (!book) throw new Error(LOREBOOK_NOT_FOUND)

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
export async function relistBindings(
	socket: any,
	lorebookId: number,
	emitToUser: (event: string, data: any) => void
) {
	const own = await emitToUser("lorebooks:bindingList", () =>
		buildLorebookBindingList(socket.user!.id, lorebookId)
	)
	// The people the book is shared with, each list built as them (lane A3).
	await relayToBookReaders(socket, lorebookId, "lorebooks:bindingList", (readerId) =>
		buildLorebookBindingList(readerId, lorebookId)
	)
	return own
}

export const lorebookBindingListHandler: Handler<
	Sockets.Lorebooks.BindingList.Params,
	Sockets.Lorebooks.BindingList.Response
> = refusable(
	"lorebooks:bindingList",
	async (socket, params: Sockets.Lorebooks.BindingList.Params, emitToUser) => {
		const res = await buildLorebookBindingList(
			socket.user!.id,
			params.lorebookId
		)

		if (emitToUser) {
			emitToUser("lorebooks:bindingList", res)
		}

		return res
	},
	"The book's cast could not be listed."
)

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
> = refusable(
	"lorebooks:bindingsForCharacter",
	async (socket, params: Sockets.Lorebooks.BindingsForCharacter.Params, emitToUser) => {
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

			// The cast members this card is, in the asker's own books, and
			// which of the card's fields each retells (PLAN-cast-retold-fields)
			// — the card editor's "Represents N cast members" banner. The
			// stored flags, not a dated reading: the banner is about the book.
			const members = bindings
				.filter((b) => !!b.lorebook && b.lorebook.userId === userId)
				.map((b) => ({
					lorebookId: b.lorebook!.id,
					lorebookName: b.lorebook!.name,
					castId: b.id,
					retold: retoldFieldList(b.retold)
				}))

			const res: Sockets.Lorebooks.BindingsForCharacter.Response = {
				characterId: params.characterId,
				lorebooks,
				members
			}
			emitToUser("lorebooks:bindingsForCharacter", res)
			return res
		} catch (error: any) {
			console.error(
				"Error fetching lorebook bindings for character:",
				error
			)
			throw error
		}
	},
	"This character's lorebooks could not be listed."
)

/**
 * Type-safe handler for creating lorebook binding
 */
// A lorebook binding resolves a placeholder like {{char:1}} to a real
// character's name/data — without this check, any characterId could be
// supplied regardless of who it belongs to, and the bound entity's
// name/aliases/summary would later be disclosed through the binding (and
// copied into narrative-graph nodes derived from it).
//
// A deleted card is gone as far as a lorebook is concerned (plan A25): the
// delete is soft so old messages keep their speaker's name, and nothing in a
// book may link it again.
export async function verifyBindingTargetAccess(
	binding: { characterId?: number | null },
	userId: number
): Promise<boolean> {
	if (binding.characterId) {
		const character = await db.query.characters.findFirst({
			where: eq(schema.characters.id, binding.characterId),
			columns: { userId: true, isDeleted: true }
		})
		if (!character || character.isDeleted) return false
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
	async (
		socket,
		params: Sockets.Lorebooks.CreateBinding.Params,
		emitToUser
	) => {
		const userId = socket.user!.id

		const book = await assertOwnedBook(db, userId, params.lorebookBinding.lorebookId)

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
		// The vector and its bookkeeping, absorbedAliases, createdAt and
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
			embeddingSourceHash: _ignoredEmbeddingSourceHash,
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
			const found = await resolveOrCreateBindingRow(
				{
					lorebookId: params.lorebookBinding.lorebookId,
					characterId: params.lorebookBinding.characterId ?? null
				},
				db
			)
			// Only a card deleted since the access check above answers null.
			if (!found) throw new Error("That card has been deleted.")
			const { id, created } = found
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
			existing,
			...askerOf(params)
		}

		if (emitToUser) {
			emitToUser("lorebooks:createBinding", res)
		}

		return res
	},
	"Failed to add that cast member.",
	undefined,
	askerOf
)

/**
 * Type-safe handler for updating lorebook binding
 */
export const updateLorebookBindingHandler: Handler<
	Sockets.Lorebooks.UpdateBinding.Params,
	Sockets.Lorebooks.UpdateBinding.Response
> = refusable(
	"lorebooks:updateBinding",
	async (
		socket,
		params: Sockets.Lorebooks.UpdateBinding.Params,
		emitToUser
	) => {
		const userId = socket.user!.id

		// Check if binding exists and user owns the lorebook
		const existingBinding = await db.query.lorebookBindings.findFirst({
			where: (lb, { eq }) => eq(lb.id, params.lorebookBinding.id!)
		})

		if (!existingBinding) {
			throw new Error("That cast member is not in this lorebook.")
		}

		const lorebookOwner = await findOwnedBook(db, userId, existingBinding.lorebookId)

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
		// The vector and its bookkeeping, absorbedAliases, createdAt and
		// updatedAt are never client-writable either — all server-derived
		// or pipeline-owned.
		const {
			binding: _ignoredBinding,
			lorebookId: _ignoredLorebookId,
			embedding: _ignoredEmbedding,
			embeddingModel: _ignoredEmbeddingModel,
			embeddingSourceHash: _ignoredEmbeddingSourceHash,
			// GENERATED from the name and summary; Postgres refuses a write.
			embedTextHash: _ignoredEmbedTextHash,
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

		// The retold columns (PLAN-cast-retold-fields): checked as themselves,
		// and a new face must be a picture this member may wear — the asker's
		// upload to this book, or a gallery image of the member's card.
		const retoldProblem = await retoldUpdateProblem(
			db,
			safeUpdate as Record<string, unknown>,
			{
				id: existingBinding.id,
				lorebookId: existingBinding.lorebookId,
				characterId:
					params.lorebookBinding.characterId !== undefined
						? (params.lorebookBinding.characterId ?? null)
						: existingBinding.characterId,
				faceMediaId: existingBinding.faceMediaId
			},
			userId
		)
		if (retoldProblem) throw new Error(retoldProblem)

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
		// A card is one member's (plan A25): linking one another member has —
		// linked, or drawn with from a date — would make one seat two people.
		// Asked and written under the book's lock, the one every cast writer
		// takes (`resolveOrCreateBindingRow`, a dated change's write), so two
		// tabs cannot both give one card away.
		const linking = params.lorebookBinding.characterId
		let [updatedBinding] = await db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(${existingBinding.lorebookId})`
			)
			if (linking != null) {
				const holder = await cardTakenBy(
					tx,
					existingBinding.lorebookId,
					linking,
					existingBinding.id
				)
				if (holder)
					throw new Error(
						`${holder.name} already has that card in this lorebook, and a card draws one cast member.`
					)
			}
			return tx
				.update(schema.lorebookBindings)
				.set(Object.keys(set).length > 0 ? set : { updatedAt: new Date() })
				.where(eq(schema.lorebookBindings.id, params.lorebookBinding.id!))
				.returning()
		})

		// A person's edit settles the fields' standing imprints at once (pr-6 A3).
		{
			const { markImprintsKept } = await import("$lib/server/lorebooks/imprints")
			await markImprintsKept(db, {
				subjectKind: "member",
				subjectId: params.lorebookBinding.id!,
				fields: Object.keys(set)
			})
		}

		// Attach-time sync: a fresh characterId attachment should
		// pull in that entity's name/aliases immediately, not wait for an
		// unrelated future edit to that entity. Re-fetch afterward so the
		// response/emitted row reflects the synced name/aliases rather than
		// the pre-sync values captured by the UPDATE's own .returning().
		//
		// ⚠ On any other edit only the book owner's OWN card re-names the
		// member (plan A25): a guest's persona in this book keeps the name
		// it arrived with, so the host editing its summary does not pull in
		// the guest's rename.
		const attaching =
			updatedBinding.characterId != null &&
			updatedBinding.characterId !== existingBinding.characterId
		const ownCard =
			updatedBinding.characterId != null &&
			!attaching &&
			!!(await db.query.characters.findFirst({
				where: and(
					eq(schema.characters.id, updatedBinding.characterId),
					eq(schema.characters.userId, userId)
				),
				columns: { id: true }
			}))
		if (updatedBinding.characterId && (attaching || ownCard)) {
			await syncLorebookBindingsForCharacter(
				updatedBinding.characterId,
				undefined,
				{ lorebookId: updatedBinding.lorebookId }
			)
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

/**
 * Upload a picture as a cast member's **face** (PLAN-cast-retold-fields):
 * lorebook-owned media (`files.lorebook_id`), set as the member's
 * `faceMediaId` with `retold.face` turned on. The book must be the asker's,
 * as for every member edit. Replies under its own name with the member's
 * row, and refreshes the cast as `lorebooks:updateBinding` does.
 *
 * Bytes the asker already uploaded come back as that file (`createMedia`
 * dedupes per user); one with no book yet is stamped this book's, so it
 * stays a picture this member may wear on the next edit.
 */
export const uploadMemberFaceHandler: Handler<
	Sockets.Lorebooks.UploadMemberFace.Params,
	Sockets.Lorebooks.UploadMemberFace.Response
> = refusable(
	"lorebooks:uploadMemberFace",
	async (
		socket,
		params: Sockets.Lorebooks.UploadMemberFace.Params,
		emitToUser
	) => {
		const userId = socket.user!.id
		const castId = Number(params?.castId)
		const member = Number.isInteger(castId)
			? await db.query.lorebookBindings.findFirst({
					where: (lb, { eq }) => eq(lb.id, castId),
					columns: { id: true, lorebookId: true }
				})
			: undefined
		if (!member) throw new Error("That cast member is not in this lorebook.")
		if (!(await findOwnedBook(db, userId, member.lorebookId)))
			throw new Error("Access denied.")
		const raw = params.imageFile as unknown
		if (
			!raw ||
			!(
				Buffer.isBuffer(raw) ||
				raw instanceof Uint8Array ||
				raw instanceof ArrayBuffer
			)
		)
			throw new Error("No picture came with that upload.")
		const bytes = Buffer.isBuffer(raw)
			? raw
			: raw instanceof ArrayBuffer
				? Buffer.from(new Uint8Array(raw))
				: Buffer.from(raw)

		// Judge the bytes BEFORE writing them, so a refused upload leaves no
		// orphan file behind (review 2026-10-13).
		const sniffed = await sniffMedia(bytes)
		if (sniffed.kind !== MediaKind.IMAGE)
			throw new Error("A cast member's face must be a picture.")
		const created = await createMedia(db, {
			userId,
			lorebookId: member.lorebookId,
			bytes
		})
		// Files are one row per (user, bytes): the same picture uploaded
		// again REUSES the row it already has — another book's face, or one of
		// the person's own files. Never re-stamp it (that moved a personal
		// file out of its owner's media list). Who may see a face follows the
		// members that wear it (`canViewMedia`), not the stamp. A private
		// file stays private, so it cannot be a face others are shown.
		if (!created.created && created.file.visibility === MediaVisibility.PRIVATE)
			throw new Error(
				"That picture is one of your private files, so nobody else could see it as a face. Choose another picture."
			)

		// The picture only. Which face the member wears is a member change,
		// so it goes through the form's draft and its two saves like every
		// other field — dated when the author reads as of a date. Writing the
		// base here hid the new face behind any dated `retold` (review
		// 2026-10-13, owner: "that works, go").
		const res: Sockets.Lorebooks.UploadMemberFace.Response = {
			castId: member.id,
			lorebookId: member.lorebookId,
			mediaId: created.file.id
		}
		if (emitToUser) emitToUser("lorebooks:uploadMemberFace", res)
		return res
	},
	"That face could not be uploaded."
)

/**
 * `lorebooks:listMemberFaces` — the face picker's **This book's pictures**:
 * images uploaded to the book, plus faces its members wear that are not a
 * card's gallery picture (a re-used upload keeps its first stamp, since files
 * are one row per user and bytes). Newest first. Owner only, like uploading.
 */
export const listMemberFacesHandler: Handler<
	Sockets.Lorebooks.ListMemberFaces.Params,
	Sockets.Lorebooks.ListMemberFaces.Response
> = refusable(
	"lorebooks:listMemberFaces",
	async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const lorebookId = Number(params?.lorebookId)
		if (
			!Number.isInteger(lorebookId) ||
			!(await findOwnedBook(db, userId, lorebookId))
		)
			throw new Error("Access denied.")
		const worn = db
			.select({ id: schema.lorebookBindings.faceMediaId })
			.from(schema.lorebookBindings)
			.where(
				and(
					eq(schema.lorebookBindings.lorebookId, lorebookId),
					isNotNull(schema.lorebookBindings.faceMediaId)
				)
			)
		const rows = await db
			.select({ id: schema.files.id })
			.from(schema.files)
			.where(
				and(
					eq(schema.files.kind, MediaKind.IMAGE),
					or(
						eq(schema.files.lorebookId, lorebookId),
						and(
							inArray(schema.files.id, worn),
							isNull(schema.files.characterId)
						)
					)
				)
			)
			.orderBy(sql`${schema.files.id} desc`)
		const res: Sockets.Lorebooks.ListMemberFaces.Response = {
			lorebookId,
			mediaIds: rows.map((r) => r.id)
		}
		if (emitToUser) emitToUser("lorebooks:listMemberFaces", res)
		return res
	},
	"The book's pictures could not be listed."
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
> = refusable(
	"lorebooks:resolveOrCreateBindingByName",
	async (socket, params: Sockets.Lorebooks.ResolveOrCreateBindingByName.Params, emitToUser) => {
		const userId = socket.user!.id

		await assertOwnedBook(db, userId, params.lorebookId)

		// From a session's summarize: Off refuses here, before a member is
		// added, as the scene's own save would be refused after (plan A22).
		if (params.sessionId != null && (await bookLoreWriteMode(db, params.lorebookId)) === "off")
			throw new Error(LORE_WRITES_OFF)

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
			// Top level, so every listener filters the same way (plan B5).
			lorebookId: params.lorebookId,
			lorebookBindingId: id,
			created,
			requestId: params.requestId
		}

		if (emitToUser) {
			emitToUser("lorebooks:resolveOrCreateBindingByName", res)
		}

		return res
	},
	"The cast member could not be added."
)

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
> = refusable(
	"lorebooks:export",
	async (_socket, _params: Sockets.Lorebooks.Export.Params, emitToUser) => {
		throw new Error(LOREBOOK_EXPORT_PAUSED)
	},
	"Export is turned off for now."
)

// Reads scan_depth/token_budget/recursive_scanning from the RAW import
// payload rather than from the parsed book. The card reader this import used
// to go through backfilled these with hardcoded defaults
// (recursive_scanning ?? true, scan_depth ?? 10) when absent, which would
// otherwise get stored as if they were genuine source data and pollute every
// future re-export/hash-comparison with fabricated values. Reading raw is
// still the rule now that parseImportedLorebook does not carry them at all:
// absent in the file means absent from the row, which is the only reading
// that survives a round trip. Every door that makes a book from a file reads
// them, the SillyTavern folder import included (plan A13). Each is kept only
// as what it is — a finite number, a true/false switch — and anything else a
// file puts there is dropped: nothing reads these at runtime, and every
// lorebook list sends the column whole, so a file must not park a string or
// an object of any size in it.
export function extractLorebookLevelExtraJson(rawData: any): Record<string, any> {
	const number = (v: unknown): v is number =>
		typeof v === "number" && Number.isFinite(v)
	return {
		...(number(rawData?.scan_depth) ? { scanDepth: rawData.scan_depth } : {}),
		...(number(rawData?.token_budget)
			? { tokenBudget: rawData.token_budget }
			: {}),
		...(typeof rawData?.recursive_scanning === "boolean"
			? { recursiveScanning: rawData.recursive_scanning }
			: {})
	}
}

// Generous-but-bounded caps on what one lorebook import may carry, checked
// before any DB work. The file's own size is `IMPORT_FILE_CAPS.lorebookBytes`
// (checked before it is parsed); these bound what fits inside it — tens of
// thousands of entries, embedded characters each triggering a full
// character-creation flow, or one row or key large enough to cost every turn
// that reads it (plan S4). Each is far past anything a real book holds.
export const LOREBOOK_IMPORT_LIMITS = {
	maxEntries: 5000,
	maxCharacters: 200,
	maxPersonas: 200,
	maxNarrativeNodes: 5000,
	maxNarrativeRelationships: 5000,
	/** Primary keys, and condition keys, each — per entry. */
	maxKeysPerEntry: 1000,
	/** One key, in characters. */
	maxKeyChars: 2000,
	/** An entry's content, a scene's summary, the book's description. */
	maxTextChars: 200_000,
	/** An entry's name or comment, a scene's name, the book's name. */
	maxNameChars: 10_000,
	/** An entry's foreign `extensions` bag, as the JSON its extraJson stores. */
	maxExtraJsonBytes: 64 * 1024,
	/** Scenes nested under one history entry. */
	maxScenesPerHistoryEntry: 1000,
	/** Characters one scene names, participants and mentions together. */
	maxCastPerScene: 500,
	/** Stat rows — configurations and values together — in `serenepub.stats`. */
	maxStatRows: 20_000,
	/** One stat row's configuration or value, as the JSON it is stored as. */
	maxStatJsonBytes: 64 * 1024
} as const

/**
 * A lorebook payload as the unchanged-vs-conflict check compares it.
 *
 * ⚠ Every entry's `id` is dropped: the exporter writes this install's primary
 * key there (finding #77), which an overwrite changes on every row, so a file
 * re-imported after an overwrite from that very file could never read as
 * "unchanged". The id carries no content, so ignoring it on both sides is the
 * whole fix.
 *
 * ⚠ **So is the container's format marker** (`serenepub.formatVersion`, and
 * the `version: 1` a format-1 file states). It says how to read the file, not
 * what the book holds, and every format-2 key is written only when it holds
 * something — so an older file of a book it can fully describe reads as
 * "unchanged", and one it cannot describe reads as a conflict on the content
 * itself, whose losses name what it cannot carry (`overwriteLosses`).
 */
function comparableLorebookData(data: any): any {
	if (!data || typeof data !== "object" || !Array.isArray(data.entries))
		return data
	const serenepub = data.extensions?.serenepub
	const {
		formatVersion: _formatVersion,
		version: _version,
		...content
	} = serenepub && typeof serenepub === "object" ? serenepub : ({} as any)
	return {
		...data,
		...(serenepub && typeof serenepub === "object"
			? { extensions: { ...data.extensions, serenepub: content } }
			: {}),
		entries: data.entries.map((entry: any) => {
			if (!entry || typeof entry !== "object") return entry
			const { id: _id, ...rest } = entry
			return rest
		})
	}
}

/**
 * A book's own name and description against `LOREBOOK_IMPORT_LIMITS`, in the
 * sentences a person reads — every door that makes a book from a file: a
 * lorebook file, and a SillyTavern card's book or World Info file.
 */
export function assertBookWithinImportLimits(name: unknown, description: unknown): void {
	const L = LOREBOOK_IMPORT_LIMITS
	const tooLong = (v: unknown, max: number): v is string =>
		typeof v === "string" && v.length > max
	if (tooLong(name, L.maxNameChars)) {
		throw new Error(
			`This lorebook's name is ${fmtCount(name.length)} characters; Serene Pub reads up to ${fmtCount(L.maxNameChars)}.`
		)
	}
	if (tooLong(description, L.maxTextChars)) {
		throw new Error(
			`This lorebook's description is ${fmtCount(description.length)} characters; Serene Pub reads up to ${fmtCount(L.maxTextChars)}.`
		)
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

	assertBookWithinImportLimits(card.name, card.description)
	card.entries.forEach((entry: any, i: number) => {
		if (!entry || typeof entry !== "object") return
		assertEntryWithinImportLimits(entry, i)
	})
	assertStatsWithinImportLimits(serenepub?.stats)
}

/**
 * The file's stats (format 2) — how many rows, and how big each one is.
 *
 * ⚠ Each row is measured by what the importer STORES from it: a
 * configuration's `config`, a value's `value`. Whatever else a row carries is
 * never stored, so it can neither pass a row nor stand in for its payload.
 */
function assertStatsWithinImportLimits(stats: unknown) {
	if (!stats || typeof stats !== "object") return
	const L = LOREBOOK_IMPORT_LIMITS
	const listOf = (key: "configs" | "values"): any[] =>
		Array.isArray((stats as any)[key]) ? (stats as any)[key] : []
	const rows = [
		...listOf("configs").map((row) => ({ row, payload: row?.config })),
		...listOf("values").map((row) => ({ row, payload: row?.value }))
	]
	if (rows.length > L.maxStatRows)
		throw new Error(
			`This lorebook file holds ${fmtCount(rows.length)} stats; Serene Pub reads up to ${fmtCount(L.maxStatRows)}.`
		)
	for (const { row, payload } of rows) {
		if (payload === undefined) continue
		const bytes = Buffer.byteLength(JSON.stringify(payload))
		if (bytes > L.maxStatJsonBytes)
			throw new Error(
				`One of this lorebook's stats${typeof row?.slotId === "string" ? ` (${row.slotId.slice(0, 80)})` : ""} is ${fmtCount(bytes)} bytes; Serene Pub reads up to ${fmtCount(L.maxStatJsonBytes)}.`
			)
	}
}

/** A count or length as a sentence writes it: "1,001". */
const fmtCount = (v: number) => v.toLocaleString("en")

/** "Entry 3 (“Dragon”)" — the entry's place in the file, and its title if it has one. */
function importEntryLabel(entry: any, i: number): string {
	const title = [entry?.name, entry?.comment].find(
		(v): v is string => typeof v === "string" && v.trim().length > 0
	)
	if (!title) return `Entry ${i + 1}`
	const t = title.trim()
	return `Entry ${i + 1} (“${t.length > 40 ? `${t.slice(0, 39)}…` : t}”)`
}

/**
 * One entry of a lorebook file against `LOREBOOK_IMPORT_LIMITS` (plan S4):
 * its keys, its text, its foreign extra data and its nested scenes. Throws the
 * sentence naming the entry and what is over. The SillyTavern folder import
 * holds its books' entries to the same (`sockets/import.ts`).
 */
export function assertEntryWithinImportLimits(entry: any, i: number): void {
	if (!entry || typeof entry !== "object") return
	const L = LOREBOOK_IMPORT_LIMITS
	for (const field of ["name", "comment"] as const) {
		const v = entry[field]
		if (typeof v === "string" && v.length > L.maxNameChars) {
			throw new Error(
				`Entry ${i + 1}'s name is ${fmtCount(v.length)} characters; Serene Pub reads up to ${fmtCount(L.maxNameChars)}.`
			)
		}
	}
	const label = importEntryLabel(entry, i)
	const primary: unknown[] = Array.isArray(entry.keys)
		? entry.keys
		: Array.isArray(entry.key)
			? entry.key
			: []
	const condition: unknown[] = secondaryKeysOf(entry)
	for (const [keys, what] of [
		[primary, "keys"],
		[condition, "condition keys"]
	] as const) {
		if (keys.length > L.maxKeysPerEntry) {
			throw new Error(
				`${label} has ${fmtCount(keys.length)} ${what}; Serene Pub reads up to ${fmtCount(L.maxKeysPerEntry)} per entry.`
			)
		}
		const long = keys.find(
			(k): k is string =>
				typeof k === "string" && k.length > L.maxKeyChars
		)
		if (long !== undefined) {
			throw new Error(
				`${label} has a key ${fmtCount(long.length)} characters long; Serene Pub reads keys up to ${fmtCount(L.maxKeyChars)} characters.`
			)
		}
	}
	if (
		typeof entry.content === "string" &&
		entry.content.length > L.maxTextChars
	) {
		throw new Error(
			`${label}'s content is ${fmtCount(entry.content.length)} characters; Serene Pub reads up to ${fmtCount(L.maxTextChars)}.`
		)
	}
	const ext = entry.extensions
	if (ext && typeof ext === "object") {
		const { serenepub, ...foreign } = ext
		// The entry's declared fields are read out of this bag by name
		// (`mapImportedEntry`), checked for type but not length — a category
		// of 3,000,000 characters imported (S4 review). Every text in it is a
		// label (the entry kind, a category, a local id), held to a name's
		// ceiling.
		if (
			serenepub &&
			typeof serenepub === "object" &&
			!Array.isArray(serenepub)
		) {
			for (const [key, v] of Object.entries(serenepub)) {
				if (typeof v === "string" && v.length > L.maxNameChars) {
					throw new Error(
						`${label}'s ${key} is ${fmtCount(v.length)} characters; Serene Pub reads up to ${fmtCount(L.maxNameChars)}.`
					)
				}
			}
		}
		const bytes = Buffer.byteLength(JSON.stringify(foreign))
		if (bytes > L.maxExtraJsonBytes) {
			throw new Error(
				`${label} carries ${fmtCount(Math.ceil(bytes / 1024))} KB of extra data; Serene Pub reads up to ${fmtCount(L.maxExtraJsonBytes / 1024)} KB per entry.`
			)
		}
		const scenes = serenepub?.scenes
		if (Array.isArray(scenes)) {
			if (scenes.length > L.maxScenesPerHistoryEntry) {
				throw new Error(
					`Entry ${i + 1} has ${fmtCount(scenes.length)} scenes; Serene Pub reads up to ${fmtCount(L.maxScenesPerHistoryEntry)} per history entry.`
				)
			}
			scenes.forEach((scene: any, j: number) => {
				const where = `Scene ${j + 1} of entry ${i + 1}`
				// Stored as text; anything else failed inside the database and
				// reached the person as "Failed to import lorebook." (S4 review).
				for (const field of ["name", "summary"] as const) {
					const v = scene?.[field]
					if (
						v !== undefined &&
						v !== null &&
						typeof v !== "string"
					) {
						throw new Error(
							`${where}'s ${field} isn't text, so Serene Pub can't read it.`
						)
					}
				}
				if (
					typeof scene?.name === "string" &&
					scene.name.length > L.maxNameChars
				) {
					throw new Error(
						`${where}'s name is ${fmtCount(scene.name.length)} characters; Serene Pub reads up to ${fmtCount(L.maxNameChars)}.`
					)
				}
				if (
					typeof scene?.summary === "string" &&
					scene.summary.length > L.maxTextChars
				) {
					throw new Error(
						`${where}'s summary is ${fmtCount(scene.summary.length)} characters; Serene Pub reads up to ${fmtCount(L.maxTextChars)}.`
					)
				}
				const cast =
					(Array.isArray(scene?.participantCharacters)
						? scene.participantCharacters.length
						: 0) +
					(Array.isArray(scene?.mentionedCharacters)
						? scene.mentionedCharacters.length
						: 0)
				if (cast > L.maxCastPerScene) {
					throw new Error(
						`${where} names ${fmtCount(cast)} characters; Serene Pub reads up to ${fmtCount(L.maxCastPerScene)} per scene.`
					)
				}
			})
		}
	}
}

/**
 * A lorebook file as the import reads it (plan S4): measured before it is
 * parsed, parsed with a sentence for a file that isn't JSON, normalized from
 * every legacy shape, named as the person named it in the import dialog, and
 * held to `LOREBOOK_IMPORT_LIMITS` — all before any DB work.
 */
function readLorebookImport(
	lorebookJson: unknown,
	name?: unknown
): {
	lorebookData: any
	card: ParsedImportedLorebook
	/**
	 * The dialog's name as the book took it — trimmed and within its ceiling
	 * — or undefined when none was given. A conflict holds THIS, never the
	 * name as sent (S4 review: 90 million spaces were held).
	 */
	name?: string
} {
	if (typeof lorebookJson !== "string") {
		throw new Error("No lorebook file was sent.")
	}
	const tooLarge = lorebookFileTooLarge(Buffer.byteLength(lorebookJson))
	if (tooLarge) throw new Error(tooLarge)
	// What the parse may build, measured first: the byte ceiling alone let
	// 32 MiB of `{}`s parse to +753 MB of heap (S4 review).
	assertImportJsonShape(lorebookJson, "This lorebook file")
	let raw: unknown
	try {
		raw = JSON.parse(lorebookJson.replace(/^\uFEFF/, ""))
	} catch {
		throw new Error(
			"This lorebook file isn't valid JSON, so Serene Pub can't read it."
		)
	}
	// Normalizes legacy shapes (object-keyed entries, singular
	// key/keysecondary fields) that parseImportedLorebook() on its own would
	// silently turn into an empty book rather than error on.
	let lorebookData = normalizeLegacyLorebookData(raw)
	// Reads the payload's own fields rather than handing it to
	// @lenml/char-card-reader, whose book constructor splits every key on
	// `[,|;，；]` — which shredded a regex key (`/foo|bar/i` → `/foo` +
	// `bar/i`) on this door alone, while the bulk import path read the same
	// file's keys intact. See parseImportedLorebook for what the reader
	// backfilled and how each of those is supplied.
	const card = parseImportedLorebook(lorebookData)
	const rename = typeof name === "string" ? name.trim() : ""
	if (rename) {
		card.name = rename
		// Where a Serene Pub file keeps its name, so a renamed re-import
		// compares as the change it is.
		if (!Array.isArray(lorebookData)) {
			lorebookData = { ...lorebookData, name: rename }
		}
	}
	assertLorebookImportWithinLimits(card, lorebookData)
	return { lorebookData, card, ...(rename ? { name: rename } : {}) }
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
 *
 * Also returns `retag`: what each cast tag the file's text writes becomes in
 * this book (A16). Every member is stored as `{{char:N}}`, and the file's
 * text follows its members through `retagImportedBook`:
 *  - **one card bound twice** (0.5 had no rule against it) is ONE member —
 *    the second binding folds into the first, and its lore, its scene
 *    appearances and its tags follow. The one-member-per-card index refused
 *    the second insert and failed the whole import.
 *  - **both spellings of one number** (`{char:3}` and `{{char:3}}`, two
 *    members in 0.5, whose sync matched each spelling to its own binding):
 *    the `{{…}}` member keeps the number, the other takes a fresh one, and
 *    the text spelled its way follows it.
 *  - a number stated twice in one spelling keeps the first, as before.
 *  - a fresh tag starts past every number the file's text names, too — the
 *    text can name a number no binding holds, and a member renumbered onto
 *    it would suddenly be the one that text means.
 */
async function restoreBoundEntities(
	lorebookId: number,
	card: ParsedImportedLorebook,
	userId: number,
	dbOrTx: Db = db
): Promise<{
	bindingLocalIdToRealId: Map<number, number>
	syncCharacterIds: Set<number>
	boundEntityByRealId: Map<number, { characterId: number | null }>
	retag: CastTagReplacer
}> {
	const bindingLocalIdToRealId = new Map<number, number>()
	const syncCharacterIds = new Set<number>()
	const boundEntityByRealId = new Map<
		number,
		{ characterId: number | null }
	>()
	const serenepub: any = card.extensions?.serenepub
	const rawBindings = serenepub?.bindings

	// Stated tags travel verbatim, so the book's counter has to be past every
	// one of them BEFORE anything is minted — or the next new cast member (and
	// restoreNarrativeGraph's unbound-node mint) reissues {{char:1}} (finding
	// #13). Past every number the file's lore text names as well (the text
	// `retagImportedBook` rewrites), bound or not — up to the largest the entry
	// save would ever mint from text; a ledger number past it is prose.
	let maxToken = 0
	retagImportedBook(card, (n) => {
		if (n > maxToken && n <= MAX_TYPED_MEMBER_NUMBER) maxToken = n
		return null
	})
	const moveCounterPast = async (top: number) => {
		if (top > 0)
			await dbOrTx
				.update(schema.lorebooks)
				.set({
					nextBindingNumber: sql`GREATEST(${schema.lorebooks.nextBindingNumber}, ${top + 1})`
				})
				.where(eq(schema.lorebooks.id, lorebookId))
	}

	if (!Array.isArray(rawBindings)) {
		await moveCounterPast(maxToken)
		return {
			bindingLocalIdToRealId,
			syncCharacterIds,
			boundEntityByRealId,
			retag: (n) => castTag(n)
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

	/** One binding of the file, and where it lands. */
	type Landing = {
		localId: unknown
		boundCharacterId: number | null
		/** The sprite set the file names for this member, by name. */
		spriteSet: string | null
		/** The number its tag states, in either spelling; null for none. */
		n: number | null
		/** Its tag as the file spells it. */
		written: string | null
		/** The earlier binding of the same card this one folds into. */
		foldInto: Landing | null
		tag?: string
		rowId?: number
	}
	const landings: Landing[] = []
	const firstForCard = new Map<number, Landing>()
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
		const n = importedCastTagNumber(binding?.bindingText)
		const landing: Landing = {
			localId: binding?.localId,
			boundCharacterId,
			spriteSet:
				typeof binding?.spriteSet === "string" &&
				binding.spriteSet.trim() &&
				binding.spriteSet.length <= LOREBOOK_IMPORT_LIMITS.maxNameChars
					? binding.spriteSet
					: null,
			n,
			written: n !== null ? (binding.bindingText as string) : null,
			foldInto:
				boundCharacterId != null
					? (firstForCard.get(boundCharacterId) ?? null)
					: null
		}
		if (boundCharacterId != null && !landing.foldInto)
			firstForCard.set(boundCharacterId, landing)
		landings.push(landing)
	}
	const own = landings.filter((l) => !l.foldInto)

	// Which member keeps each stated number: the `{{…}}` spelling first, then
	// the file's order. Every other one takes a fresh tag.
	const keeperOf = new Map<number, Landing>()
	for (const l of own)
		if (l.n !== null && l.written === castTag(l.n) && !keeperOf.has(l.n))
			keeperOf.set(l.n, l)
	for (const l of own)
		if (l.n !== null && !keeperOf.has(l.n)) keeperOf.set(l.n, l)

	// A binding with no valid tag of its own mints one past all of that,
	// rather than every such row sharing "{{char:1}}".
	for (const l of landings) if (l.n !== null && l.n > maxToken) maxToken = l.n
	await moveCounterPast(maxToken)

	for (const l of own) {
		l.tag =
			l.n !== null && keeperOf.get(l.n) === l
				? castTag(l.n)
				: await deriveNextBindingToken(lorebookId, dbOrTx)
		const [row] = await dbOrTx
			.insert(schema.lorebookBindings)
			.values({
				lorebookId,
				characterId: l.boundCharacterId,
				binding: l.tag,
				spriteSet: l.spriteSet
			})
			.returning()
		l.rowId = row.id
		bindingLocalIdToRealId.set(l.localId as number, row.id)
		boundEntityByRealId.set(row.id, { characterId: l.boundCharacterId })

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
		if (l.boundCharacterId) syncCharacterIds.add(l.boundCharacterId)
	}
	for (const l of landings)
		if (l.foldInto)
			bindingLocalIdToRealId.set(l.localId as number, l.foldInto.rowId!)

	// What each spelling the file writes becomes: a keeper's own spelling
	// first, then the other members', then the folded bindings'.
	const tagFor = new Map<string, string>()
	const claim = (written: string | null, tag: string | undefined) => {
		if (written && tag && !tagFor.has(written)) tagFor.set(written, tag)
	}
	for (const l of own)
		if (l.n !== null && keeperOf.get(l.n) === l) claim(l.written, l.tag)
	for (const l of own) claim(l.written, l.tag)
	for (const l of landings) if (l.foldInto) claim(l.written, l.foldInto.tag)
	const retag: CastTagReplacer = (n, written) =>
		tagFor.get(written) ??
		tagFor.get(castTag(n)) ??
		tagFor.get(`{char:${n}}`) ??
		castTag(n)

	return {
		bindingLocalIdToRealId,
		syncCharacterIds,
		boundEntityByRealId,
		retag
	}
}

/**
 * An imported book's text with its cast tags as `restoreBoundEntities` landed
 * them — every entry, and the graph, scenes and links the Serene Pub
 * extension carries. The embedded cards and the bindings themselves are not
 * lore text and are left as the file wrote them.
 */
function retagImportedBook(
	card: ParsedImportedLorebook,
	retag: CastTagReplacer
) {
	const serenepub = card.extensions?.serenepub
	const retaggedExtension =
		serenepub && typeof serenepub === "object"
			? Object.fromEntries(
					Object.entries(serenepub).map(([key, value]) => [
						key,
						key === "characters" ||
						key === "personas" ||
						key === "bindings"
							? value
							: rewriteImportedCastTagsDeep(value, retag)
					])
				)
			: serenepub
	return {
		entries: rewriteImportedCastTagsDeep(card.entries, retag),
		serenepub: retaggedExtension,
		description:
			typeof card.description === "string"
				? rewriteImportedCastTagsDeep(card.description, retag)
				: card.description
	}
}

/**
 * The card a file's embedded character is, in this user's library: the one
 * with its uuid, unchanged or overwritten — or a new one. A deleted card with
 * that uuid is not reused (plan A25): the import makes a new card, under a
 * fresh uuid (`claimIncomingCharacterUuid`), and the deleted one stays
 * deleted.
 */
async function resolveOrOverwriteEmbeddedCharacter(
	cardData: any,
	userId: number,
	dbOrTx: Db = db
) {
	const match = await matchEmbeddedCharacter(cardData, userId, dbOrTx)
	if (match?.unchanged) return match.unchanged
	if (match)
		return overwriteCharacterFromParsedData(
			match.id,
			cardData,
			undefined,
			userId,
			dbOrTx
		)
	return createCharacterFromParsedData(cardData, undefined, userId, dbOrTx)
}

/**
 * The user's live card a file's embedded character names by uuid, and whether
 * it is unchanged (`unchanged` is then the card, as it stands) — or null when
 * the user has none. One reading for the import that rewrites it and the
 * count the conflict prompt shows first (`overwriteLosses`).
 */
async function matchEmbeddedCharacter(
	cardData: any,
	userId: number,
	dbOrTx: Db
): Promise<{ id: number; unchanged: any | null } | null> {
	const incomingUuid = extractCharacterUuid(cardData)
	if (!incomingUuid) return null
	const existing = await dbOrTx.query.characters.findFirst({
		where: and(
			eq(schema.characters.uuid, incomingUuid),
			eq(schema.characters.userId, userId),
			eq(schema.characters.isDeleted, false)
		),
		columns: { id: true }
	})
	if (!existing) return null
	const comparison = await buildExistingCharacterComparisonData(
		existing.id,
		dbOrTx
	)
	if (!comparison) return null
	const { character_book, ...incomingForHash } = cardData
	return hashCanonicalJson(comparison.comparisonData) ===
		hashCanonicalJson(incomingForHash)
		? { id: existing.id, unchanged: comparison.character }
		: { id: existing.id, unchanged: null }
}

async function resolveOrOverwriteEmbeddedPersona(
	cardData: any,
	userId: number,
	dbOrTx: Db = db
) {
	const match = await matchEmbeddedPersona(cardData, userId, dbOrTx)
	if (match?.unchanged) return match.unchanged
	if (match)
		return overwritePersonaFromParsedData(
			match.id,
			cardData,
			undefined,
			dbOrTx
		)
	return createPersonaFromParsedData(cardData, undefined, userId, dbOrTx)
}

/** `matchEmbeddedCharacter` for an embedded persona card. */
async function matchEmbeddedPersona(
	cardData: any,
	userId: number,
	dbOrTx: Db
): Promise<{ id: number; unchanged: any | null } | null> {
	const incomingUuid = extractPersonaUuid(cardData)
	if (!incomingUuid) return null
	// Never a deleted persona, as for a character above.
	const existing = await dbOrTx.query.characters.findFirst({
		where: and(
			eq(schema.characters.uuid, incomingUuid),
			eq(schema.characters.userId, userId),
			eq(schema.characters.isDeleted, false)
		)
	})
	if (!existing) return null
	const same =
		hashCanonicalJson(canonicalPersonaContent(existing)) ===
		hashCanonicalJson(
			canonicalPersonaContent(personaFieldsFromParsedData(cardData) as any)
		)
	return { id: existing.id, unchanged: same ? existing : null }
}

/**
 * How many of the user's live characters (personas included) an import of
 * this file rewrites: each embedded card whose uuid names one of theirs and
 * whose content differs (`resolveOrOverwriteEmbeddedCharacter`). Counted
 * once per card, however many times the file embeds it.
 */
export async function countCharactersRewritten(
	serenepub: any,
	userId: number,
	dbOrTx: Db = db
): Promise<number> {
	const rewritten = new Set<number>()
	for (const embedded of serenepub?.characters ?? []) {
		const cardData = embedded?.card?.data
		if (!cardData) continue
		const m = await matchEmbeddedCharacter(cardData, userId, dbOrTx)
		if (m && !m.unchanged) rewritten.add(m.id)
	}
	for (const embedded of serenepub?.personas ?? []) {
		const cardData = embedded?.card
		if (!cardData) continue
		const m = await matchEmbeddedPersona(cardData, userId, dbOrTx)
		if (m && !m.unchanged) rewritten.add(m.id)
	}
	return rewritten.size
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

/**
 * Entries one INSERT writes on an import (plan A13): far inside Postgres'
 * 65,535 bound values at the table's width, and a few statements for a book
 * at the 5,000-entry ceiling rather than one per entry.
 */
export const ENTRY_INSERT_BATCH = 200

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
	const rows: Array<{
		values: typeof schema.lorebookEntries.$inferInsert
		meta: any
		typeId: EntryTypeId
	}> = []
	const historyEntryLocalIdToRealId = new Map<number, number>()
	const sceneLocalIdToRealId = new Map<number, number>()
	const entryLocalIdToRealId = new Map<number, number>()
	// An entry's parent is written after every entry exists: a district can be
	// filed before its city is inserted.
	const pendingAnchors: Array<{
		realId: number
		localId: number | null
		anchorLocalId: number
		typeId: string
	}> = []

	/** What the document points at this row with, once the row has an id. */
	const recordEntryRefs = (meta: any, realId: number, typeId: string) => {
		const localId =
			typeof meta?.entryLocalId === "number" ? meta.entryLocalId : null
		if (localId !== null) entryLocalIdToRealId.set(localId, realId)
		if (typeof meta?.anchorEntryLocalId === "number")
			pendingAnchors.push({
				realId,
				localId,
				anchorLocalId: meta.anchorEntryLocalId,
				typeId
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
			...importedKeyColumns(normalized),
			// Who wrote the row, as the file records it — one of the writers
			// this app has (`importedEntryFacts`); `human` otherwise.
			...(mapped.provenance ? { provenance: mapped.provenance } : {})
		}

		rows.push({ values, meta, typeId })
	}

	// Every entry in batches, in the file's order, so ids follow it. A row
	// comes back by its type and position, which the book holds once
	// (`lorebook_entries_position_uq`) — never by where it sits in the reply.
	const idOf = new Map<string, number>()
	const slot = (typeId: string, position: number | undefined) =>
		`${typeId}#${position}`
	for (let i = 0; i < rows.length; i += ENTRY_INSERT_BATCH) {
		const landed = await dbOrTx
			.insert(schema.lorebookEntries)
			.values(rows.slice(i, i + ENTRY_INSERT_BATCH).map((r) => r.values))
			.returning({
				id: schema.lorebookEntries.id,
				typeId: schema.lorebookEntries.typeId,
				position: schema.lorebookEntries.position
			})
		for (const r of landed) idOf.set(slot(r.typeId, r.position), r.id)
	}

	const resolveBindingIds = (raw: unknown): number[] =>
		Array.isArray(raw)
			? raw
					.filter((v): v is number => typeof v === "number")
					.map((localId) => bindingLocalIdToRealId.get(localId))
					.filter((id): id is number => id !== undefined)
			: []
	for (const { values, meta, typeId } of rows) {
		const id = idOf.get(slot(typeId, values.position))!
		recordEntryRefs(meta, id, typeId)
		// Only the dated type carries nested scenes, so only it does more than
		// record the id it got back.
		if (typeId !== HISTORY_TYPE_ID) continue
		if (typeof meta.localId === "number")
			historyEntryLocalIdToRealId.set(meta.localId, id)

		// Nested scenes — each still gets its own document-scoped localId (see
		// mapEntry) so narrativeGraph can reference one. sessionId/
		// selectedMessageIds were deliberately never exported — they're
		// session-instance-specific and can't round-trip.
		// participantCharacters/mentionedCharacters are binding localIds (see
		// the merge plan) — resolved back to real ids via the same map
		// bindingLocalId elsewhere in this format uses. A legacy export's
		// name-string arrays resolve to nothing here (every entry fails the
		// `=== "number"` check) rather than erroring — the scene still
		// imports, just without its old cast list, consistent with this whole
		// function's best-effort philosophy.
		const scenes = Array.isArray(meta.scenes) ? meta.scenes : []
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
					historyEntryId: id,
					sessionId: null,
					name: scene?.name ?? null,
					selectedMessageIds: [],
					summary: scene?.summary ?? null,
					// The import file recorded a cast, so this scene counts as
					// resolved even if every entry was dropped as unresolvable
					// above.
					castResolvedAt: new Date()
				})
				.returning()
			// Cast lives in scene_characters, so it is written after the row
			// exists (the FK requires a scene id).
			await writeSceneCast(
				sceneRow.id,
				{ participantCharacters, mentionedCharacters },
				dbOrTx as any
			)
			if (typeof scene?.localId === "number") {
				sceneLocalIdToRealId.set(scene.localId, sceneRow.id)
			}
		}
	}

	// The `parent` role, once every row it could name exists. A link the file
	// states but this import cannot honour (a missing parent, a cycle, a type
	// that is never filed — a place) leaves the entry at the top level rather
	// than failing the import, which is this whole function's rule for a
	// reference it cannot resolve. The never-filed case is noted like the
	// import's other skips: this door has no receipt to carry it.
	const unfiled = pendingAnchors.filter(unfileable)
	if (unfiled.length)
		console.warn(
			`[lorebooks] Import left ${unfiled.length} ${unfiled.length === 1 ? "entry" : "entries"} at the top level: ` +
				"a place or a history entry is never filed inside anything (link it instead).",
			unfiled.map((p) => p.realId)
		)
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
 * The book's stats as the file carries them (format 2, plan A26): the book's
 * own, its cast members' and its places', each landed on the row the import
 * just made for its owner (`importedStatRows`). Template layer, on main — a
 * file carries nothing else. Runs inside the import's transaction on `tx`
 * alone, after every owner and every entry a value names exists.
 */
async function insertImportedStats(
	tx: Db,
	lorebookId: number,
	serenepub: unknown,
	bindingLocalIdToRealId: Map<number, number>,
	entryRefs: RestoredEntryRefs
) {
	// What each landed entry is, for the rules a place's stats keep.
	const landed = await tx
		.select({
			id: schema.lorebookEntries.id,
			typeId: schema.lorebookEntries.typeId
		})
		.from(schema.lorebookEntries)
		.where(eq(schema.lorebookEntries.lorebookId, lorebookId))
	const { configs, values } = importedStatRows(serenepub, {
		lorebookId,
		bindingLocalIdToRealId,
		entryLocalIdToRealId: entryRefs.entryLocalIdToRealId,
		historyEntryLocalIdToRealId: entryRefs.historyEntryLocalIdToRealId,
		sceneLocalIdToRealId: entryRefs.sceneLocalIdToRealId,
		entryTypeIdByRealId: new Map(landed.map((r) => [r.id, r.typeId])),
		singleRefEntryTypes: singleRefEntryTypesOf
	})
	// In the file's order, which is write order on the way out, so the book
	// this makes exports the same bytes. Chunked to stay inside one
	// statement's bind limit.
	const CHUNK = 500
	for (let i = 0; i < configs.length; i += CHUNK)
		await tx.insert(schema.attributeConfigs).values(
			configs.slice(i, i + CHUNK).map(({ value: _v, config, ...row }) => ({
				...row,
				config: config ?? {}
			}))
		)
	for (let i = 0; i < values.length; i += CHUNK)
		await tx.insert(schema.attributeValues).values(
			values
				.slice(i, i + CHUNK)
				.map(({ config: _c, value, ...row }) => ({ ...row, value: value! }))
		)
}

/**
 * The entry types one reference on its own may name in a slot, as
 * `write.ts assertLoreRefsInSession` reads them: a text slot's
 * `config.entryTypes`, none for a list or a slot that names none, and
 * `undefined` for a slot this install does not declare.
 */
function singleRefEntryTypesOf(slotId: string): readonly string[] | null | undefined {
	const decl = getAttributeSlot(slotId)
	if (!decl) return undefined
	return decl.type !== "list" ? (resolveSlotConfig(decl).entryTypes ?? null) : null
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
	boundEntityByRealId: Map<number, { characterId: number | null }>
): Promise<GraphRestoreReport> {
	const report: GraphRestoreReport = {
		skippedMembers: 0,
		skippedLinks: 0,
		unfiledLinks: 0,
		failed: false
	}
	try {
		const graph = serenepub?.narrativeGraph
		// Only version 1 is understood today — a future bump just means this
		// block is skipped gracefully until the importer catches up
		// (additive, never breaking).
		if (!graph || graph.version !== 1) return report

		const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : []
		const rawRelationships = Array.isArray(graph.relationships)
			? graph.relationships
			: []
		if (rawNodes.length === 0 && rawRelationships.length === 0) return report

		// Pass 1: resolve every node to a real lorebookBindings row —
		// update in place if bindingLocalId points at an already-restored
		// binding, otherwise insert a new unbound row. Track localId -> real
		// id either way (a parent may be defined later in the array).
		const nodeLocalIdToRealId = new Map<number, number>()
		/**
		 * What the first node for each row wrote. A second node lands on the
		 * same row when `restoreBoundEntities` folded a card bound twice into
		 * one member (A16): it fills what the first left empty and adds its
		 * absorbed names, and never overwrites.
		 */
		const landedOn = new Map<
			number,
			{
				summary: string | null
				absorbedAliases: string[]
				historyEntryId: number | null
				sceneId: number | null
			}
		>()
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
					const first = landedOn.get(boundRealId)
					const fieldsToApply: Record<string, unknown> = first
						? {
								summary: first.summary ?? nodeFields.summary,
								absorbedAliases: [
									...new Set([
										...first.absorbedAliases,
										...nodeFields.absorbedAliases
									])
								],
								historyEntryId:
									first.historyEntryId ??
									nodeFields.historyEntryId,
								sceneId: first.sceneId ?? nodeFields.sceneId
							}
						: isEntityLinked
							? rest
							: nodeFields
					const [row] = await db
						.update(schema.lorebookBindings)
						.set(fieldsToApply)
						.where(eq(schema.lorebookBindings.id, boundRealId))
						.returning({
							id: schema.lorebookBindings.id,
							summary: schema.lorebookBindings.summary,
							absorbedAliases:
								schema.lorebookBindings.absorbedAliases,
							historyEntryId:
								schema.lorebookBindings.historyEntryId,
							sceneId: schema.lorebookBindings.sceneId
						})
					realId = row.id
					landedOn.set(row.id, row)
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
				report.skippedMembers++
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
				report.skippedMembers++
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
				// Both endpoints must resolve to a row actually restored above;
				// a link that cannot is one the file carries and the book does
				// not get, so it is counted.
				if (!from || !to) {
					report.skippedLinks++
					continue
				}
				// An entry linked to itself is nothing a book can hold (plan
				// B0's guard; B1's CHECK), counted likewise. A cast self-loop
				// is 0.5.x data and still lands: the cast merge is what clears
				// those.
				if (from.entryId != null && from.entryId === to.entryId) {
					report.skippedLinks++
					continue
				}
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

				const ends = {
					fromNodeId: from.nodeId,
					fromEntryId: from.entryId,
					toNodeId: to.nodeId,
					toEntryId: to.entryId
				}
				// A file's text, cut to `RELATIONSHIP_TEXT_LIMITS` as a
				// model's is (a file is not a person typing); what is not text
				// is empty. The words and the name are trimmed as every
				// writer trims them (plan B1); a description is kept as told.
				const fileText = (value: unknown, limit: number) =>
					typeof value === "string" ? value.slice(0, limit) : ""
				const fileWords = (value: unknown, limit: number) =>
					typeof value === "string"
						? value.trim().slice(0, limit).trim()
						: ""
				const saying = {
					lorebookId,
					branchId: null,
					historyEntryId,
					relationshipType:
						fileWords(
							rel?.relationshipType,
							RELATIONSHIP_TEXT_LIMITS.wording
						) || "neutral",
					// Plan B1: the name, and the words from the far end — kept
					// only with an entry at one end (the reverse CHECK); a
					// file written before either reads unnamed and one way.
					title: fileWords(rel?.name, RELATIONSHIP_TEXT_LIMITS.name),
					reverseRelationshipType:
						from.entryId != null || to.entryId != null
							? fileWords(
									rel?.reverseRelationshipType,
									RELATIONSHIP_TEXT_LIMITS.wording
								) || null
							: null
				}
				// One row per way (plan B1): a row the file repeats — a
				// two-way link and its mirror, say — is the row already landed.
				if ((await findLinkedThatWay(db, ends, saying)) != null) continue

				// A status or visibility the lists do not have reads as the
				// column's default, as the graph build's apply reads one.
				await db.insert(schema.narrativeRelationships).values({
					...ends,
					...saying,
					description: fileText(
						rel?.description,
						RELATIONSHIP_TEXT_LIMITS.description
					),
					visibility: sanitizeRelationshipVisibility(rel?.visibility),
					status: (RELATIONSHIP_STATUSES as readonly unknown[]).includes(
						rel?.status
					)
						? rel.status
						: "active",
					reason:
						typeof rel?.reason === "string"
							? fileText(rel.reason, RELATIONSHIP_TEXT_LIMITS.reason)
							: null,
					sceneId
				})
				// Landed, but without the history entry that dated it or the
				// scene it was filed under: the file names one it does not
				// carry.
				if (
					(typeof rel?.historyEntryLocalId === "number" && historyEntryId === null) ||
					(typeof rel?.sceneLocalId === "number" && sceneId === null)
				)
					report.unfiledLinks++
			} catch (e) {
				report.skippedLinks++
				console.warn(
					"[lorebooks] Skipping malformed narrative relationship on import:",
					e
				)
			}
		}
	} catch (e) {
		report.failed = true
		console.warn(
			"[lorebooks] Narrative graph restoration failed, skipping:",
			e
		)
	}
	return report
}

/**
 * What `restoreNarrativeGraph` could not write back, counted where it skips a
 * row rather than failing the import: cast members (a node, or its place
 * under another member), links (one whose write failed, whose ends the file
 * does not carry, or that links an entry to itself), links that landed
 * without the date or scene the file gave them (`unfiledLinks`), and whether
 * the whole graph stopped.
 */
interface GraphRestoreReport {
	skippedMembers: number
	skippedLinks: number
	unfiledLinks: number
	failed: boolean
}

/** The import's warnings for what the graph could not restore (plan A13). */
function graphRestoreWarnings(report: GraphRestoreReport): string[] {
	if (report.failed)
		return ["Not all of the file's cast members and links could be restored."]
	const warnings: string[] = []
	const { skippedMembers: m, skippedLinks: l } = report
	if (m > 0)
		warnings.push(
			`${m} cast ${m === 1 ? "member" : "members"} from the file could not be fully restored.`
		)
	if (l > 0)
		warnings.push(
			`${l} ${l === 1 ? "link" : "links"} from the file could not be restored.`
		)
	const u = report.unfiledLinks
	if (u > 0)
		warnings.push(
			`${u} ${u === 1 ? "link" : "links"} from the file ${u === 1 ? "was" : "were"} restored without ${u === 1 ? "its" : "their"} date or scene, which the file does not carry.`
		)
	return warnings
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
 * The file's calendar, kept only over dates it can place (plan A18(c)).
 *
 * An import writes the calendar with the book, then its entries and stats;
 * this runs last, in the same transaction, and projects every dated row the
 * book then holds — the file's history and stats, and on an overwrite the
 * clocks of the sessions already reading the book — through the calendar, as
 * `lorebooks:setCalendar`'s preflight does. When one does not land, the book
 * comes in free-form, with the file's clock if free-form places it, and the
 * reply names the dates: every date is kept as it is, and the calendar is
 * still in the file, to declare once they are changed. Refusing the import
 * would cost the whole book for one date, and the calendar never re-dates a
 * row.
 *
 * A calendar the file carries that cannot be read already came in free-form
 * (`importedStoryTime`); the reply says so.
 */
async function landImportedCalendar(
	tx: Db,
	lorebookId: number,
	serenepub: any
): Promise<string[]> {
	const st = serenepub?.storyTime
	if (!st || typeof st !== "object" || st.calendar == null) return []
	const calendar = readStoryCalendar(st.calendar)
	if (!calendar) return ["The file's calendar could not be read, so the book is free-form."]
	const stranded = datesThatDoNotLand(await datedRowsOf(tx, lorebookId), calendar)
	if (!stranded.length) return []
	const c = st.clock
	const clock =
		c && Number.isInteger(c.year) && !clockProblem(c, null) ? (c as StoryClock) : null
	await tx
		.update(schema.lorebooks)
		.set({ storyCalendar: null, ...clockColumns(clock) })
		.where(eq(schema.lorebooks.id, lorebookId))
	const n = stranded.length
	return [
		`The file's calendar was left out: ${n} ${n === 1 ? "date" : "dates"} in the book ` +
			`${n === 1 ? "doesn't" : "don't"} fit it (` +
			stranded
				.slice(0, 5)
				.map((s) => `${s.label}: ${s.problem}`)
				.join("; ") +
			(n > 5 ? "; …" : "") +
			"). The book is free-form; declare the calendar in its settings once those dates are changed."
	]
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
 * What an overwrite-import deletes, or changes, that the file cannot bring
 * back — dated changes, presences, lines (branches) and scenes captured from
 * a session, which no file carries; and, from a format-1 file
 * (`lorebookFileFormatOf`), the book's stats and its places and items, which
 * that format cannot carry: the stats are deleted and the places and items
 * come back as world lore; and, from any file, what `purgeLorebook` takes
 * that no file carries (`statsNoFileCarries`), and what sessions hold of the
 * book's entries, which every new entry leaves naming nothing
 * (`countSessionLoreRefs`). Shown in the conflict prompt before the user
 * chooses Overwrite.
 */
export async function overwriteLosses(
	lorebookId: number,
	fileFormat: number,
	dbOrTx: Db = db,
	/** The file's `extensions.serenepub` and its importer, for `charactersRewritten`. */
	incoming?: { serenepub: any; userId: number }
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
	const olderFile =
		fileFormat < 2
			? await olderFileLosses(lorebookId, dbOrTx)
			: { stats: 0, places: 0, items: 0 }
	return {
		amendments: entryAmendments + castAmendments,
		presences: await countIn(schema.castPresences),
		branches: await countIn(schema.lorebookBranches),
		sceneLinks: await countIn(
			schema.scenes,
			sql`${schema.scenes.sessionId} IS NOT NULL`
		),
		...olderFile,
		...(await statsNoFileCarries(lorebookId, dbOrTx)),
		sessionLoreRefs: await countSessionLoreRefs(dbOrTx, lorebookId),
		charactersRewritten: incoming
			? await countCharactersRewritten(
					incoming.serenepub,
					incoming.userId,
					dbOrTx
				)
			: 0
	}
}

/**
 * What an overwrite deletes of the book's stats that no file carries, whatever
 * its format (plan A13): each session's own stats on the book's places — one
 * per slot on each place in each session, however many dated values or a
 * configuration it has — and every stat sheet assigned to the book, its cast
 * members or its places. The owners are `purgeLorebook`'s own
 * (`bookStatOwners`), so this counts exactly what it deletes.
 */
async function statsNoFileCarries(
	lorebookId: number,
	dbOrTx: Db
): Promise<{ sessionStats: number; sheets: number }> {
	const owners = (await bookStatOwners(dbOrTx, lorebookId)).filter(
		([, ids]) => ids.length > 0
	)
	const ownedBy = (
		t:
			| typeof schema.attributeValues
			| typeof schema.attributeConfigs
			| typeof schema.ownerSheets
	) =>
		or(
			...owners.map(([kinds, ids]) =>
				and(inArray(t.ownerKind, kinds), inArray(t.ownerId, ids))
			)
		)
	const v = schema.attributeValues
	const c = schema.attributeConfigs
	const held = new Set(
		[
			...(await dbOrTx
				.select({ s: v.sessionId, kind: v.ownerKind, id: v.ownerId, slotId: v.slotId })
				.from(v)
				.where(and(ownedBy(v), isNotNull(v.sessionId)))),
			...(await dbOrTx
				.select({ s: c.sessionId, kind: c.ownerKind, id: c.ownerId, slotId: c.slotId })
				.from(c)
				.where(and(ownedBy(c), isNotNull(c.sessionId))))
		].map((r) => `${r.s}:${r.kind}:${r.id}:${r.slotId}`)
	)
	const [sheets] = await dbOrTx
		.select({ n: sql<number>`count(*)::int` })
		.from(schema.ownerSheets)
		.where(ownedBy(schema.ownerSheets))
	return { sessionStats: held.size, sheets: Number(sheets?.n ?? 0) }
}

/**
 * What a format-1 file cannot carry of a book's main line: its stats before
 * play — one per slot on each owner (the book, a cast member, a place),
 * however many dated values or a configuration it has — and its places and
 * items. A branch's own are the branch's, counted with it.
 */
async function olderFileLosses(
	lorebookId: number,
	dbOrTx: Db
): Promise<{ stats: number; places: number; items: number }> {
	const e = schema.lorebookEntries
	const entries = await dbOrTx
		.select({ id: e.id, typeId: e.typeId })
		.from(e)
		.where(and(eq(e.lorebookId, lorebookId), isNull(e.branchId)))
	const placeIds = entries.filter((r) => r.typeId === LOCATION_TYPE_ID).map((r) => r.id)
	const items = entries.filter((r) => r.typeId === ITEM_TYPE_ID).length
	const memberIds = (
		await dbOrTx
			.select({ id: schema.lorebookBindings.id })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, lorebookId))
	).map((r) => r.id)
	const owners = (t: typeof schema.attributeValues | typeof schema.attributeConfigs) =>
		or(
			and(eq(t.ownerKind, "lorebook"), eq(t.ownerId, lorebookId)),
			memberIds.length
				? and(eq(t.ownerKind, "cast_member"), inArray(t.ownerId, memberIds))
				: undefined,
			placeIds.length
				? and(eq(t.ownerKind, "location"), inArray(t.ownerId, placeIds))
				: undefined
		)
	const v = schema.attributeValues
	const c = schema.attributeConfigs
	const stats = new Set(
		[
			...(await dbOrTx
				.select({ kind: v.ownerKind, id: v.ownerId, slotId: v.slotId })
				.from(v)
				.where(and(owners(v), isNull(v.sessionId), isNull(v.branchId)))),
			...(await dbOrTx
				.select({ kind: c.ownerKind, id: c.ownerId, slotId: c.slotId })
				.from(c)
				.where(and(owners(c), isNull(c.sessionId))))
		].map((r) => `${r.kind}:${r.id}:${r.slotId}`)
	)
	return { stats: stats.size, places: placeIds.length, items }
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
		boundEntityByRealId,
		serenepub,
		calendarWarnings
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
			boundEntityByRealId,
			retag
		} = await restoreBoundEntities(book.id, card, userId, tx)
		const retagged = retagImportedBook(card, retag)
		if (retagged.description !== card.description)
			await tx
				.update(schema.lorebooks)
				.set({ description: retagged.description })
				.where(eq(schema.lorebooks.id, book.id))
		const entryRefs = await insertLorebookEntries(
			book.id,
			retagged.entries,
			bindingLocalIdToRealId,
			tx
		)
		await insertImportedStats(
			tx,
			book.id,
			retagged.serenepub,
			bindingLocalIdToRealId,
			entryRefs
		)
		const calendarWarnings = await landImportedCalendar(
			tx,
			book.id,
			card.extensions?.serenepub
		)
		return {
			book,
			bindingLocalIdToRealId,
			entryRefs,
			syncCharacterIds,
			boundEntityByRealId,
			serenepub: retagged.serenepub,
			calendarWarnings
		}
	})

	const warnings = await afterImportCommit({
		lorebookId: book.id,
		lorebookName: book.name,
		userId,
		syncCharacterIds,
		serenepub,
		bindingLocalIdToRealId,
		entryRefs,
		boundEntityByRealId
	})
	return { book, warnings: [...calendarWarnings, ...warnings] }
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
		book,
		bindingLocalIdToRealId,
		entryRefs,
		syncCharacterIds,
		boundEntityByRealId,
		serenepub,
		calendarWarnings
	} = await db.transaction(async (tx) => {
		const [book] = await tx
			.update(schema.lorebooks)
			.set({
				name: card.name || "Imported Lorebook",
				description: card.description,
				extraJson: extractLorebookLevelExtraJson(rawData),
				...overwrittenStoryTime(card.extensions?.serenepub)
			})
			.where(eq(schema.lorebooks.id, existingId))
			.returning()

		// What sessions hold of the book's entries — an item carried, the
		// place someone is in — would name nothing once every entry is new:
		// dropped, as `overwriteLosses` said first (`sessionLoreRefs`).
		await dropSessionLoreRefs(tx, existingId)

		// Everything the book holds goes, by the one rule book delete uses
		// (`purgeLorebook`, the lorebook table registry): its lines, entries,
		// cast, scenes, links, dated changes, presences, binding suggestions,
		// and every stat the book, its cast members and its places own — each
		// session's own layer on a place included. Stat owner ids carry no
		// foreign key, and the file replaces the book: a file that carries no
		// stats says the book has none, the rule `overwrittenStoryTime` holds
		// for the clock. `overwriteLosses` names first what no file brings
		// back. The book row stays, and so do its tags (its labels, like its
		// name). Sessions played on a line fall back to main (`set null`).
		await purgeLorebook(tx, existingId)

		const {
			bindingLocalIdToRealId,
			syncCharacterIds,
			boundEntityByRealId,
			retag
		} = await restoreBoundEntities(existingId, card, userId, tx)
		const retagged = retagImportedBook(card, retag)
		if (retagged.description !== card.description)
			await tx
				.update(schema.lorebooks)
				.set({ description: retagged.description })
				.where(eq(schema.lorebooks.id, existingId))
		const entryRefs = await insertLorebookEntries(
			existingId,
			retagged.entries,
			bindingLocalIdToRealId,
			tx
		)
		await insertImportedStats(
			tx,
			existingId,
			retagged.serenepub,
			bindingLocalIdToRealId,
			entryRefs
		)
		const calendarWarnings = await landImportedCalendar(
			tx,
			existingId,
			card.extensions?.serenepub
		)
		return {
			book,
			bindingLocalIdToRealId,
			entryRefs,
			syncCharacterIds,
			boundEntityByRealId,
			serenepub: retagged.serenepub,
			calendarWarnings
		}
	})

	const warnings = await afterImportCommit({
		lorebookId: existingId,
		lorebookName: book.name,
		userId,
		syncCharacterIds,
		serenepub,
		bindingLocalIdToRealId,
		entryRefs,
		boundEntityByRealId
	})
	return { book, warnings: [...calendarWarnings, ...warnings] }
}

/**
 * Everything an import does once its book is committed (plan A13): the cast
 * members' names from their cards, the graph, and the queues for the book's
 * vectors and annotations, as an entry save queues them. None of it can undo
 * the save, so none of it may report the import as failed: a step that does
 * not finish is logged and named in the reply's `warnings`, and the book
 * stands. Reported as a failure, the person would retry, and the retry would
 * meet the saved book as a conflict.
 */
async function afterImportCommit(opts: {
	lorebookId: number
	lorebookName: string
	userId: number
	syncCharacterIds: Set<number>
	serenepub: any
	bindingLocalIdToRealId: Map<number, number>
	entryRefs: RestoredEntryRefs
	boundEntityByRealId: Map<number, { characterId: number | null }>
}): Promise<string[]> {
	const warnings: string[] = []
	try {
		// The cards are the importer's own (made or overwritten for them), so
		// the card-edit sync reaches this book and every other of theirs an
		// overwritten card is in.
		for (const characterId of opts.syncCharacterIds)
			await syncLorebookBindingsForCharacter(characterId)
	} catch (e) {
		console.error(
			`[lorebooks] Import of book ${opts.lorebookId}: the cast's names were not synced:`,
			e
		)
		warnings.push(
			"The cast members' names were not updated from their character cards."
		)
	}
	warnings.push(
		...graphRestoreWarnings(
			await restoreNarrativeGraph(
				opts.lorebookId,
				opts.serenepub,
				opts.userId,
				opts.bindingLocalIdToRealId,
				opts.entryRefs,
				opts.boundEntityByRealId
			)
		)
	)
	queueImportedBook(opts.lorebookId, opts.lorebookName)
	return warnings
}

/**
 * Queue a book an import wrote for its vectors and its annotations — what an
 * entry save queues (`entries.ts` `afterWrite`), so retrieval does not wait on
 * the periodic scan. Background work: it never throws, and a failure is
 * logged, since the periodic scan picks the book up regardless.
 */
export function queueImportedBook(lorebookId: number, lorebookName: string): void {
	autoEnqueueLorebook(lorebookId, lorebookName, "").catch((e) =>
		console.error(`[lorebooks] Queueing imported book ${lorebookId} for vectors failed:`, e)
	)
	try {
		enqueueLorebookAnnotation(lorebookId, lorebookName)
	} catch (e) {
		console.error(
			`[lorebooks] Queueing imported book ${lorebookId} for annotations failed:`,
			e
		)
	}
}

/**
 * The reply's book once an import is committed: read back whole, or — when
 * the read fails — the row the import wrote, without its entries and cast, so
 * a saved book is never reported as a failed import; `warnings` says so.
 */
async function importedBookOf(
	book: typeof schema.lorebooks.$inferSelect,
	warnings: string[]
): Promise<Sockets.Lorebooks.WireLorebook> {
	try {
		return await fetchCompletedLorebook(book.id)
	} catch (e) {
		console.error(`[lorebooks] Imported book ${book.id} could not be read back:`, e)
		warnings.push("The lorebook was saved, but could not be read back. Reload to see it.")
		return book
	}
}

/**
 * Seat the cast of every session reading a book an overwrite rewrote, as
 * reading a book into a session does (`runLorebookBindingCheck`): the file
 * brings back only its own cast members, so a character who joined a session
 * after the file was written would otherwise have none until the session's
 * cast next changed (plan A13).
 */
async function seatReadingSessions(
	socket: any,
	lorebookId: number,
	emitToUser: (event: string, data: any) => void
): Promise<string[]> {
	try {
		const { runLorebookBindingCheck } = await import("./sessions")
		const reading = await db
			.select({ id: schema.sessions.id })
			.from(schema.sessions)
			.where(eq(schema.sessions.lorebookId, lorebookId))
		// Seated only: the person asked to overwrite a book, not to be asked
		// about its card-less cast members once per reading session.
		for (const { id } of reading)
			await runLorebookBindingCheck(socket, id, lorebookId, emitToUser, {
				askAboutOrphans: false
			})
		return []
	} catch (e) {
		console.error(
			`[lorebooks] Overwrite of book ${lorebookId}: the reading sessions' cast was not seated:`,
			e
		)
		return [
			"The characters of the sessions reading this book were not all added to its cast. They are added when a session's cast next changes."
		]
	}
}

/**
 * A lorebook import's refusal when the server failed rather than refused
 * (`importFailureOf`), and the wrapper's fallback.
 */
const IMPORT_FAILED =
	"The lorebook could not be imported. The server log has the details."

/** The plain sentence for the server's own failures (`serverFailureAs`). */
const importFailureOf = serverFailureAs(IMPORT_FAILED)

/**
 * Import a lorebook file (its text; see `readLorebookImport` for every
 * ceiling it meets first), or a card's book held since its card import.
 *
 * A person runs at most `IMPORTS_RUNNING_PER_USER` imports at once however
 * many sockets they hold (and the server `IMPORTS_RUNNING_ON_SERVER` for
 * everyone), and a conflict HOLDS the file on the server — the
 * reply carries a `heldImportId`, never the file (plan S4). Refusals reach the
 * person as the sentence that says which (`refusable`).
 */
export const lorebookImportHandler = refusable<
	Sockets.Lorebooks.Import.Params,
	Sockets.Lorebooks.Import.Response
>(
	"lorebooks:import",
	async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		return withImportLimit(userId, async () => {
			// A file's text, or a card's book held since its card import
			// (`Characters.HeldCardBook`) — taken once, by its owner only.
			const lorebookJson =
				params?.heldImportId !== undefined
					? takeHeldImport(userId, "lorebook", params.heldImportId)
							.lorebookJson
					: params?.lorebookJson
			const {
				lorebookData,
				card,
				name: rename
			} = readLorebookImport(lorebookJson, params?.name)

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
							heldImportId: holdImport(userId, "lorebook", {
								lorebookJson: lorebookJson as string,
								...(rename ? { name: rename } : {})
							}),
							losses: await overwriteLosses(
								existing.id,
								lorebookFileFormatOf(lorebookData),
								db,
								{
									serenepub: (card as any).extensions
										?.serenepub,
									userId
								}
							)
						}
					}
					emitToUser("lorebooks:import", res)
					return res
				}
			}

			const { book, warnings } = await createLorebookFromParsedCard(
				card,
				lorebookData,
				userId,
				incomingUuid
			)
			// Committed: from here on the reply says the book is in, and names
			// whatever did not finish.
			await relistAfterImport(socket, emitToUser, warnings)

			const res: Sockets.Lorebooks.Import.Response = {
				status: "created",
				lorebook: await importedBookOf(book, warnings),
				...(warnings.length ? { warnings } : {})
			}
			emitToUser("lorebooks:import", res)
			return res
		})
	},
	IMPORT_FAILED,
	importFailureOf
)

/**
 * The book list after an import, lazily and exactly once. The book is already
 * saved, so a list that does not refresh is a warning, never the import's
 * failure. The catch sits INSIDE the lazy payload, as `refreshCharacterList`
 * has it: `emitToUser` builds the payload itself and only logs a build that
 * throws, so a catch around the emit would never see one. A payload no socket
 * wanted is never built — no list to refresh, nothing to say.
 */
async function relistAfterImport(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	warnings: string[]
): Promise<void> {
	if (!emitToUser) return
	await emitToUser("lorebooks:list", async () => {
		try {
			return await buildLorebooksList(socket.user!.id)
		} catch (e) {
			warnings.push(
				"The lorebook list could not be refreshed. Reload to see the new book."
			)
			throw e
		}
	})
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
 * Anyone who may READ the book (`assertReadableBook`): its owner, or a person
 * it is **shared** with (PLAN-private-messages §6.7: read plus Duplicate) — a
 * book the caller may not read is "not found". The copy is always the
 * CALLER's (`user_id` = asker), takes a fresh uuid and carries no share rows.
 * An administrator's read does not stretch to copying another person's book.
 */
/**
 * A copy made from a book SHARED with the asker wears a cover of its own: the
 * original's file is its owner's, so the copy could neither re-crop it nor
 * keep it once the owner deleted it (audit 2026-10-21). Same bytes and crop,
 * the asker's own row, stamped to the copy — `characters:duplicate` gives an
 * avatar the same treatment. A copy that cannot get its own keeps pointing at
 * the original, which its reader may still see.
 */
export async function ownCopiedCover(copyId: number, userId: number) {
	const [copy] = await db
		.select({ coverMediaId: schema.lorebooks.coverMediaId })
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, copyId))
	if (!copy?.coverMediaId) return
	try {
		const original = await readMedia(
			db as unknown as Db,
			copy.coverMediaId,
			MediaVariant.ORIGINAL
		)
		if (!original) return
		const created = await storeLorebookCover({
			userId,
			lorebookId: copyId,
			coverFile: Buffer.from(original.bytes)
		})
		if (created.created && original.file.frame)
			await db
				.update(schema.files)
				.set({ frame: original.file.frame })
				.where(eq(schema.files.id, created.file.id))
		await db
			.update(schema.lorebooks)
			.set({ coverMediaId: created.file.id })
			.where(eq(schema.lorebooks.id, copyId))
	} catch (e) {
		console.error("lorebooks:duplicate: the copy keeps the original's cover:", e)
	}
}

export const lorebooksDuplicateHandler: Handler<
	Sockets.Lorebooks.Duplicate.Params,
	Sockets.Lorebooks.Duplicate.Response
> = refusable(
	"lorebooks:duplicate",
	async (socket, params: Sockets.Lorebooks.Duplicate.Params, emitToUser) => {
		try {
			const userId = socket.user!.id

			// Owner or share recipient; never an admin's read of a stranger's
			// book (lane A3) — same refusal either way.
			const source = await assertReadableBook(db, userId, params.lorebookId, {
				isAdmin: false
			})

			const { id } = await db.transaction((tx) =>
				duplicateLorebookRows(
					tx,
					source.id,
					userId,
					params.name?.trim() || `${source.name} (copy)`
				)
			)
			if (source.userId !== userId) await ownCopiedCover(id, userId)
			const completedBook = await fetchCompletedLorebook(id)

			await relistLorebooks(socket, emitToUser)

			const res: Sockets.Lorebooks.Duplicate.Response = {
				lorebook: completedBook
			}
			emitToUser("lorebooks:duplicate", res)
			return res
		} catch (error: any) {
			console.error("Error duplicating lorebook:", error)
			throw error
		}
	},
	"The lorebook could not be duplicated."
)

/**
 * Carries out the user's choice after lorebooks:import returned a
 * "conflict" status — either overwrite the existing (uuid-matched) lorebook
 * in place, or import the file as a brand-new lorebook with a fresh uuid.
 * The file is the HELD import the conflict named, taken out of the store
 * before anything else: only its owner can take it, and only once.
 */
export const lorebookImportResolveHandler = refusable<
	Sockets.Lorebooks.ImportResolve.Params,
	Sockets.Lorebooks.ImportResolve.Response
>(
	"lorebooks:importResolve",
	async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		return withImportLimit(userId, async () => {
			const held = takeHeldImport(
				userId,
				"lorebook",
				params?.heldImportId
			)
			const { lorebookData, card } = readLorebookImport(
				held.lorebookJson,
				held.name
			)

			let imported: Awaited<ReturnType<typeof createLorebookFromParsedCard>>
			if (params.action === "overwrite") {
				const existing = await assertOwnedBook(db, userId, params.existingId)
				imported = await overwriteLorebookFromParsedCard(
					existing.id,
					card,
					lorebookData,
					userId
				)
				imported.warnings.push(
					...(await seatReadingSessions(socket, existing.id, emitToUser))
				)
			} else {
				const rawIncomingUuid = (lorebookData as any)?.extensions
					?.serenepub?.uuid
				const incomingUuid = isValidUuid(rawIncomingUuid)
					? rawIncomingUuid
					: undefined
				imported = await createLorebookFromParsedCard(
					card,
					lorebookData,
					userId,
					incomingUuid
				)
			}
			// Committed: from here on the reply says the book is in, and names
			// whatever did not finish.
			const { book, warnings } = imported
			await relistAfterImport(socket, emitToUser, warnings)

			const res: Sockets.Lorebooks.ImportResolve.Response = {
				lorebook: await importedBookOf(book, warnings),
				...(warnings.length ? { warnings } : {})
			}
			emitToUser("lorebooks:importResolve", res)
			return res
		})
	},
	IMPORT_FAILED,
	importFailureOf
)

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
	register(socket, lorebooksSessionNotesHandler, emitToUser)
	register(socket, lorebooksCreateHandler, emitToUser)
	register(socket, lorebooksRulesChoicesHandler, emitToUser)
	register(socket, lorebooksLibraryHandler, emitToUser)
	register(socket, lorebooksGetHandler, emitToUser)
	register(socket, lorebooksShareHandler, emitToUser)
	register(socket, lorebooksUpdateHandler, emitToUser)
	register(socket, lorebooksDeleteHandler, emitToUser)
	register(socket, lorebooksDuplicateHandler, emitToUser)

	// Lorebook binding handlers
	register(socket, lorebookBindingListHandler, emitToUser)
	register(socket, lorebookBindingsForCharacterHandler, emitToUser)
	register(socket, createLorebookBindingHandler, emitToUser)
	register(socket, updateLorebookBindingHandler, emitToUser)
	register(socket, uploadMemberFaceHandler, emitToUser)
	register(socket, listMemberFacesHandler, emitToUser)
	register(socket, resolveOrCreateBindingByNameHandler, emitToUser)

	// Lorebook export / import handlers
	register(socket, lorebookExportHandler, emitToUser)
	register(socket, lorebookImportHandler, emitToUser)
	register(socket, lorebookImportResolveHandler, emitToUser)
}
