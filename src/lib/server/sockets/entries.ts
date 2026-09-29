/**
 * The `entries:*` namespace — one door for every lorebook entry type.
 *
 * `worldLoreEntries:*`, `characterLoreEntries:*` and `historyEntries:*` were
 * three copies of one file. They differed in six places and agreed everywhere
 * else, and every one of the six is now a question put to the type's own
 * declaration rather than a branch on which namespace was called:
 *
 *   · **which column is the title** — the `title` field role, absent on history
 *   · **which column is the anchor, and under whose policy** — the `anchor`
 *     field role, absent on both world lore and history
 *   · **which fields the row carries, and what they default to** — the declared
 *     `fields` schema
 *   · **what a list is ordered by** — a type declaring an `order` field role has
 *     authored sequence, so its list comes back in `position` order
 *   · **where a new row lands** — appended for an ordered type, first free slot
 *     otherwise
 *   · **whether "the next one" means anything** — `entries:iterateNext` refuses
 *     for a type with no `order` field role
 *
 * ⚠ `typeId` is not decoration on these payloads: **every read and every write
 * is scoped by it**, so a world lore id presented to a history update finds no
 * row rather than being edited through the wrong shape. That is the guard the
 * three separate namespaces got from having three separate tables, kept.
 *
 * Two deliberate unifications, where the three files had drifted apart:
 *
 *  1. **`syncLorebookBindings` runs for every type.** World and character lore
 *     called it on create/update/delete; history never did, so a `{{char:N}}`
 *     token typed into a history entry minted no binding until the next edit of
 *     some *other* entry in the same book. The scan reads content and has never
 *     cared which shape it came out of.
 *  2. **The create/update/delete acks are emitted for every type.** Only
 *     history emitted its own, so the two lore managers had listeners wired to
 *     an event the server never sent.
 */

import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	lte,
	or,
	sql
} from "drizzle-orm"
import type { Handler } from "$lib/shared/events"
import { relistBindings, syncLorebookBindings } from "./lorebooks"
import { autoEnqueueLorebook } from "$lib/server/embedding/vectorizationQueue"
import { enqueueLorebookAnnotation } from "$lib/server/annotations/queue"
import { entryDeclaration } from "$lib/server/entries/declarations"
// Imported, never copied: session access is owner-OR-guest and every handler
// that decided that for itself got it wrong in one direction or the other.
import { checkSessionAccess } from "$lib/server/utils/sessionAccess"
import { nextStoryDate } from "$lib/shared/lorebooks/storyDate"
import { MAIN_LINE, type Line } from "$lib/shared/lorebooks/lineReading"
import { LOCATION_TYPE_ID } from "$lib/shared/entries/types"
import { assertDateLands, bookCalendarOf } from "$lib/server/state/storyTime"
import { BranchRefusal, lineOfBook, sessionReadingOf } from "$lib/server/state/reading"
import { MAIN_HEAD, entryAt, entryOverlaysFor } from "$lib/server/state/entriesOnReading"
import { splitKeys, type KeyList } from "$lib/server/pipelines/ranking/signals"
import {
	historyDateColumns,
	onLineAtSql,
	onLineSql
} from "$lib/server/state/lineSql"
import {
	DEFAULT_VECTOR_NAME,
	ENTRY_TYPE_IDS,
	HISTORY_TYPE_ID,
	assertDeclaredFields,
	entryInsert,
	inBookOfType,
	isEntryTypeId,
	loadDefaultVectors,
	mergeFields,
	nextPosition,
	parkingFloor,
	splitUpdate,
	toEntryRow,
	type EntryTypeId,
	type LorebookEntry
} from "$lib/server/utils/lorebookEntries"

/**
 * A payload's `typeId`, refused if it is not one this build declares.
 *
 * The column is a foreign key into the type registry, so an unknown id would
 * fail at the database anyway — but it would fail as a constraint violation
 * several frames later, and a read would simply return nothing at all. Refusing
 * here is the difference between "History entry not found" and an error naming
 * what was actually wrong.
 */
function assertTypeId(typeId: unknown): EntryTypeId {
	if (!isEntryTypeId(typeId))
		throw new Error(
			`Unknown entry type '${String(typeId)}'. The declared types are ` +
				`${ENTRY_TYPE_IDS.join(", ")}.`
		)
	return typeId
}

/** `WHERE id = … AND type_id = …` — the scoping every single-row op needs. */
const entryOfType = (id: number, typeId: string) =>
	and(
		eq(schema.lorebookEntries.id, id),
		eq(schema.lorebookEntries.typeId, typeId)
	)

/**
 * ⚠ Two list orders, preserved rather than unified.
 *
 * History has always come back in `position` order — its list is an authored
 * sequence and the manager renders it as one — while the two lore lists came
 * back in `id` order and are re-sorted client-side by whichever key the toolbar
 * picked. The `order` field role is what says which a type is, so this is the
 * declaration answering rather than the namespace; unifying them would be a
 * visible reordering of a list nobody asked to reorder.
 */
const listOrder = (typeId: string) =>
	entryDeclaration(typeId)?.roles.order
		? asc(schema.lorebookEntries.position)
		: asc(schema.lorebookEntries.id)

/**
 * Every row of one type in one lorebook, in the wire shape.
 *
 * The vectors are loaded and sent because they always were: the relations this
 * replaces selected every column, `embedding` included, and the manager reads
 * `embeddingModel` off the row to show whether an entry is vectorized.
 */
export async function listEntryRows(
	lorebookId: number,
	typeId: EntryTypeId
): Promise<LorebookEntry[]> {
	const rows = await db
		.select()
		.from(schema.lorebookEntries)
		.where(inBookOfType(lorebookId, typeId))
		.orderBy(listOrder(typeId))
	const vectors = await loadDefaultVectors(
		db,
		rows.map((r) => r.id)
	)
	return rows.map((r) => toEntryRow(r, vectors.get(r.id)))
}

/**
 * Drop the entry's **content** vector.
 *
 * The legacy update nulled `embedding`/`embeddingModel`/`vectorizedAt` on the
 * row so the vectorizer would pick it up again and RAG would stop matching
 * against a vector of text that no longer exists. Deleting the row is the same
 * statement in the shape the vectors live in now.
 *
 * ⚠ **Scoped to `core:vec/default@1`, and that is the point of a named space.**
 * It used to delete every name an entry had, on the reasoning that the content
 * they were all computed over had changed — true while `default` was the only
 * space, and false the moment a second one exists whose input is *not* the
 * content. `core:vec/entity@1` embeds the entry's **names**, and the whole
 * argument for a separate space is that the two invalidate independently:
 * rewriting a body must not re-embed the names, and renaming must re-embed them
 * without touching the content vector. Its own freshness triple is what decides
 * that, so a blanket delete here would throw away work this statement cannot
 * know had gone stale — and would make every body edit pay for a re-embedding
 * of every name.
 *
 * Behaviour is unchanged for every install that has one: `default` is the only
 * space the vectorizer writes, so this deletes exactly what it deleted before.
 */
async function clearEntryVectors(entryId: number) {
	await db
		.delete(schema.lorebookEntryVectors)
		.where(
			and(
				eq(schema.lorebookEntryVectors.entryId, entryId),
				eq(schema.lorebookEntryVectors.vectorName, DEFAULT_VECTOR_NAME)
			)
		)
}

/**
 * Whether an update's column half touches what the default space embeds.
 *
 * The vectorizer embeds `[title, content]` (history: `[content]`) —
 * `pickEntry` in `vectorizationQueue.ts`. Nothing in `fields` is embedded.
 */
export function touchesEmbeddedText(columns: Record<string, unknown>): boolean {
	return "title" in columns || "content" in columns
}

/** The entry plus its lorebook's name and owner, for the ownership checks. */
async function findOwnedEntry(id: number, typeId: string) {
	const [row] = await db
		.select({
			entry: schema.lorebookEntries,
			lorebookName: schema.lorebooks.name,
			lorebookUserId: schema.lorebooks.userId
		})
		.from(schema.lorebookEntries)
		.innerJoin(
			schema.lorebooks,
			eq(schema.lorebooks.id, schema.lorebookEntries.lorebookId)
		)
		.where(entryOfType(id, typeId))
	return row
}

/** The lorebook, if this user owns it. */
async function findOwnedBook(lorebookId: number, userId: number) {
	return db.query.lorebooks.findFirst({
		where: (l, { and, eq }) =>
			and(eq(l.id, lorebookId), eq(l.userId, userId)),
		columns: { id: true, name: true, userId: true }
	})
}

/**
 * A client-supplied anchor must name a binding in the *same* lorebook.
 *
 * Without this an entry could be linked to a binding row from another lorebook
 * (including another user's), permanently pinning that foreign binding as "in
 * use" for `syncLorebookBindings`' auto-create tracking.
 */
async function assertAnchorInBook(
	bindingId: number | null | undefined,
	lorebookId: number
) {
	if (bindingId == null) return
	const binding = await db.query.lorebookBindings.findFirst({
		where: eq(schema.lorebookBindings.id, bindingId),
		columns: { lorebookId: true }
	})
	if (!binding || binding.lorebookId !== lorebookId)
		throw new Error("Lorebook binding not found.")
}

/**
 * How far a re-parent walks before it calls the chain a loop.
 *
 * A tree that deep is not a tree anybody is reading, and an unbounded walk over
 * a chain that already contains a cycle never returns. Refusing at the ceiling
 * is the same answer as refusing a cycle: this parent cannot be set.
 */
const MAX_ANCHOR_DEPTH = 32

/**
 * A client-supplied parent entry, checked before it is written.
 *
 * Four refusals, and each names a different broken tree: a parent in another
 * lorebook (an entry filed under something its book does not contain), a parent
 * that does not exist, the entry itself, and a parent whose own chain of
 * parents leads back to the entry being moved. The last is the one that cannot
 * be checked locally — hence the walk.
 *
 * `entryId` is absent on a create: a row that does not exist yet cannot be its
 * own ancestor, so only the first two refusals can fire.
 */
/**
 * The branch an entry is being written on must be a line of ITS book.
 *
 * ⚠ Without this a crafted id files a new entry onto another book's line,
 * where deleting that line would cascade it away. `null` is main and needs no
 * check: main is the absence of a branch, not a row anyone can name.
 */
async function assertEntryBranch(
	branchId: number | null | undefined,
	lorebookId: number
) {
	if (branchId == null) return
	const branch = await db.query.lorebookBranches.findFirst({
		where: (b, { and: a, eq: e }) =>
			a(e(b.id, branchId), e(b.lorebookId, lorebookId)),
		columns: { id: true }
	})
	if (!branch) throw new Error("That branch is not a line of this lorebook.")
}

async function assertAnchorEntry(
	anchorEntryId: number | null | undefined,
	lorebookId: number,
	entryId: number | undefined,
	/** The line the CHILD is on (null = shared). */
	childBranchId: number | null,
	dbOrTx: Db = db
) {
	if (anchorEntryId == null) return
	if (entryId != null && anchorEntryId === entryId)
		throw new Error("An entry cannot be filed under itself.")

	let cursor: number | null = anchorEntryId
	for (let depth = 0; depth < MAX_ANCHOR_DEPTH; depth++) {
		if (cursor == null) return
		const row:
			| {
					lorebookId: number
					anchorEntryId: number | null
					branchId: number | null
			  }
			| undefined = await dbOrTx.query.lorebookEntries.findFirst({
			where: eq(schema.lorebookEntries.id, cursor),
			columns: { lorebookId: true, anchorEntryId: true, branchId: true }
		})
		if (!row) throw new Error("Parent entry not found.")
		if (row.lorebookId !== lorebookId)
			throw new Error("Parent entry not found.")
		// ⚠ The direct parent only: a parent that passes is itself under the
		// same rule. `anchor_entry_id` cascades, so a shared (or other-line)
		// entry filed under a line's own entry would be deleted with that
		// line — the child must be on the parent's line, or the parent shared.
		if (depth === 0 && row.branchId != null && row.branchId !== childBranchId)
			throw new Error(
				childBranchId == null
					? "An entry on main cannot be filed under one that exists only on a branch."
					: "An entry cannot be filed under one that exists only on another line."
			)
		if (entryId != null && row.anchorEntryId === entryId)
			throw new Error(
				"That would file the entry under one of its own children."
			)
		cursor = row.anchorEntryId
	}
	throw new Error(`Entries may be nested ${MAX_ANCHOR_DEPTH} deep at most.`)
}

/**
 * Apply the column half and the merged `fields` half of an update.
 *
 * ⚠ **A payload that names nothing is a real case, not a client bug** — the
 * scoping suites send `{ id, typeId, lorebookId }`, and `lorebookId` is stripped
 * by the relocation guard. The legacy statement always had the three embedding
 * columns to null, so it never met an empty `SET`; this one would, and drizzle
 * refuses one. Re-reading is the honest answer: an update that names no field
 * changes no field.
 */
async function applyEntryUpdate(
	id: number,
	typeId: string,
	columns: Record<string, any>,
	fields: Record<string, unknown>,
	dbOrTx: Db = db
) {
	const set = {
		...columns,
		...(Object.keys(fields).length ? { fields: mergeFields(fields) } : {})
	}
	if (!Object.keys(set).length)
		return dbOrTx
			.select()
			.from(schema.lorebookEntries)
			.where(entryOfType(id, typeId))
	return dbOrTx
		.update(schema.lorebookEntries)
		.set(set)
		.where(entryOfType(id, typeId))
		.returning()
}

/**
 * Everything a write does after the row lands: bindings, the vectorizer, and
 * the two lists a client is holding.
 *
 * One function because all three namespaces did all of it, in the same order,
 * with one of them quietly skipping the first step.
 */
async function afterWrite(
	socket: any,
	emitToUser: ((event: string, data: any) => void) | undefined,
	lorebookId: number,
	typeId: EntryTypeId,
	lorebookName: string,
	opts: { enqueue?: boolean } = {}
) {
	await syncLorebookBindings({ lorebookId })
	if (opts.enqueue !== false)
		autoEnqueueLorebook(lorebookId, lorebookName, "").catch(console.error)

	/**
	 * Entity annotations, persisted on write (design §13.4).
	 *
	 * After `syncLorebookBindings`, and the order is load-bearing: the
	 * vocabulary this extracts against is built from the bindings, so running it
	 * first would annotate against the names as they were before this write
	 * minted or renamed one.
	 *
	 * **Queued, exactly as the vectorizer above and for the same reason:** a
	 * write should not wait on derived data, and nothing is lost if the pass
	 * does not land — every row carries the triple `(extractorVersion,
	 * sourceHash, gazetteerHash)` and the entity mechanism promotes whatever does not
	 * match to the front of that same queue before it reads. This is the fast
	 * path, not the correctness one.
	 *
	 * It goes on the annotation lane rather than running as a detached
	 * `annotateLorebook` promise so that both halves of *"new and stale content
	 * gets queued automatically"* meet in one place: a write enqueues, a query
	 * promotes, and one loop decides the order.
	 */
	enqueueLorebookAnnotation(lorebookId, lorebookName)

	if (!emitToUser) return
	// The cast, because `syncLorebookBindings` above can have minted a row
	// for a `{{char:N}}` token this write introduced.
	//
	// One event, and it is the namespaced one. An un-namespaced
	// `emitToUser("lorebookBindingList", …)` beside this call is a second
	// copy of the same payload under a name nothing on the client listens
	// for — every client hit of that word is a field name inside
	// `lorebooks:bindingList`. One stood here; it is gone.
	await relistBindings(socket, lorebookId, emitToUser)

	// Lazy for the same reason: exactly one `entries:list` per write, and
	// none at all when no workspace is showing this type.
	await relistEntries(socket, lorebookId, typeId, emitToUser)
}

/**
 * One type's entries, for one book.
 *
 * Split out of the handler below so the four cascades that re-send this list
 * (`afterWrite`'s three verbs, plus the reorder and the iterate) can hand it
 * to `emitToUser` as a thunk: ONE source of truth for the payload, and the
 * row read behind it is paid only when a workspace is actually showing this
 * type (socket-interest plan, ruling 4).
 *
 * Ownership is re-checked here rather than trusted from the caller, in the
 * same statement that finds the book — this file's rule for every read.
 */
async function buildEntriesList(
	userId: number,
	lorebookId: number,
	typeId: EntryTypeId
): Promise<Sockets.Entries.List.Response> {
	const book = await findOwnedBook(lorebookId, userId)
	if (!book) throw new Error("Lorebook not found.")

	return {
		lorebookId,
		typeId,
		entryList: await listEntryRows(lorebookId, typeId)
	}
}

/**
 * The list, re-sent to the caller after a write that changed it.
 *
 * The lazy counterpart of the handler below, and the ONE spelling of this
 * event name for every cascade.
 *
 * ⚠ A build that THROWS is logged by `emitToUser` and emits nothing — right
 * for a push the caller's own reply does not depend on, and reachable here
 * only if the book vanished between the write and this refresh.
 */
function relistEntries(
	socket: any,
	lorebookId: number,
	typeId: EntryTypeId,
	emitToUser: (event: string, data: any) => void
) {
	return emitToUser("entries:list", () =>
		buildEntriesList(socket.user!.id, lorebookId, typeId)
	)
}

export const entryListHandler: Handler<
	Sockets.Entries.List.Params,
	Sockets.Entries.List.Response
> = {
	event: "entries:list",
	handler: async (socket, params, emitToUser) => {
		const res = await buildEntriesList(
			socket.user!.id,
			params.lorebookId,
			assertTypeId(params.typeId)
		)
		emitToUser("entries:list", res)
		return res
	}
}

export const createEntryHandler: Handler<
	Sockets.Entries.Create.Params,
	Sockets.Entries.Create.Response
> = {
	event: "entries:create",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const typeId = assertTypeId(params.entry?.typeId)

		// A raw client payload may never set these. A forged
		// vectorizedAt/embedding would make `vectorizationQueue.ts`'s staleness
		// check treat the entry as already current, permanently skipping real
		// embedding; a forged `position` collides with the unique constraint the
		// allocator below exists to respect.
		const {
			id: _id,
			createdAt: _createdAt,
			updatedAt: _updatedAt,
			vectorizedAt: _vectorizedAt,
			embedding: _embedding,
			embeddingModel: _embeddingModel,
			position: _position,
			...safeInsert
		} = params.entry as Record<string, any>
		const data: Record<string, any> = { ...safeInsert, typeId }
		if (typeof data.name === "string") data.name = data.name.trim()
		data.content =
			typeof data.content === "string" ? data.content.trim() : ""

		const book = await findOwnedBook(data.lorebookId, userId)
		if (!book)
			throw new Error(
				"Lorebook not found or you do not have permission to create an entry."
			)

		await assertAnchorInBook(data.lorebookBindingId, data.lorebookId)
		await assertEntryBranch((data as any).branchId, data.lorebookId)
		await assertAnchorEntry(
			data.anchorEntryId,
			data.lorebookId,
			undefined,
			(data as any).branchId ?? null
		)
		// Declared fields are typed; a wrong-typed value is refused here,
		// never stored in jsonb where no column type could refuse it.
		assertDeclaredFields(typeId, data)
		// A dated entry's date must land in the book's calendar, once it
		// declares one (DESIGN-story-time §0: validated at entry, so the
		// preflight list can never refill).
		if (entryDeclaration(typeId)?.roles.order && data.year != null)
			await assertDateLands(db, data.lorebookId, {
				year: Number(data.year),
				month: data.month ?? null,
				day: data.day ?? null
			})

		// Advisory lock scoped to lorebookId — without it, two concurrent
		// creates read the same free position and the second one raises a
		// unique violation, since `position` is unique per (lorebook, type).
		// Same fix, same reason, as resolveOrCreateBinding's already-fixed race.
		const [newEntry] = await db.transaction(async (tx) => {
			await tx.execute(
				sql`select pg_advisory_xact_lock(${data.lorebookId})`
			)
			return tx
				.insert(schema.lorebookEntries)
				.values(
					entryInsert({
						...(data as any),
						position: await allocatePosition(
							tx,
							data.lorebookId,
							typeId
						)
					})
				)
				.returning()
		})

		const entry = toEntryRow(newEntry)
		if (emitToUser) emitToUser("entries:create", { entry })
		await afterWrite(
			socket,
			emitToUser,
			newEntry.lorebookId,
			typeId,
			book.name
		)

		return { entry }
	}
}

/**
 * Where a new row of this type lands.
 *
 * ⚠ Two allocators, preserved rather than unified. A type with an `order` field
 * role
 * has an authored sequence, so a new row is **appended** past the last one; one
 * without takes the **first free slot**, which is what reuses the hole a delete
 * left. Unifying them would drop a new dated entry into the middle of the list
 * after any deletion.
 */
async function allocatePosition(
	tx: Db,
	lorebookId: number,
	typeId: EntryTypeId
): Promise<number> {
	if (!entryDeclaration(typeId)?.roles.order)
		return nextPosition(tx, lorebookId, typeId)
	const [last] = await tx
		.select({ position: schema.lorebookEntries.position })
		.from(schema.lorebookEntries)
		.where(inBookOfType(lorebookId, typeId))
		.orderBy(desc(schema.lorebookEntries.position))
		.limit(1)
	return (last?.position ?? -1) + 1
}

export const updateEntryHandler: Handler<
	Sockets.Entries.Update.Params,
	Sockets.Entries.Update.Response
> = {
	event: "entries:update",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const typeId = assertTypeId(params.entry?.typeId)

		const existing = await findOwnedEntry(params.entry.id, typeId)
		if (!existing || existing.lorebookUserId !== userId)
			throw new Error("Entry not found or access denied.")

		// `lorebookId` is deliberately excluded — ownership is verified against
		// the entry's *current* lorebook above, so a client-supplied replacement
		// would let a user relocate their own entry into a lorebook they do not
		// own with no re-validation. `position` is excluded too: the real
		// reorder UI goes through the separately IDOR-checked updatePositions
		// batch handler, and this singular update must not let a raw client set
		// an arbitrary or colliding value.
		const {
			id: _id,
			typeId: _typeId,
			lorebookId: _lorebookId,
			createdAt: _createdAt,
			updatedAt: _updatedAt,
			vectorizedAt: _vectorizedAt,
			embedding: _embedding,
			embeddingModel: _embeddingModel,
			position: _position,
			...updateData
		} = params.entry as Record<string, any>

		if (typeof updateData.name === "string")
			updateData.name = updateData.name.trim()
		if (typeof updateData.content === "string")
			updateData.content = updateData.content.trim()

		// Client-supplied, and this path can also *change* which binding an
		// entry is anchored to — so the same cross-lorebook check as on create.
		if (
			Object.prototype.hasOwnProperty.call(
				updateData,
				"lorebookBindingId"
			)
		)
			await assertAnchorInBook(
				updateData.lorebookBindingId,
				existing.entry.lorebookId
			)

		assertDeclaredFields(typeId, updateData)
		const reparents = Object.prototype.hasOwnProperty.call(
			updateData,
			"anchorEntryId"
		)

		// A moved date must land in the book's calendar (see create). The
		// parts not being changed are the stored ones.
		if (
			entryDeclaration(typeId)?.roles.order &&
			["year", "month", "day"].some((k) =>
				Object.prototype.hasOwnProperty.call(updateData, k)
			)
		) {
			const was = toEntryRow(existing.entry) as Record<string, any>
			const pick = (k: string) =>
				Object.prototype.hasOwnProperty.call(updateData, k)
					? updateData[k]
					: was[k]
			if (pick("year") != null)
				await assertDateLands(db, existing.entry.lorebookId, {
					year: Number(pick("year")),
					month: pick("month") ?? null,
					day: pick("day") ?? null
				})
		}

		// ⚠ `fields` is merged, never replaced: `graphed` and `isCompleted` are
		// machine-written by the graph builder and the summarizer concurrently
		// with a user editing `content`, and a whole-object jsonb write from
		// either side clobbers the other.
		const { columns, fields } = splitUpdate(typeId, updateData)
		// The re-parent. Same book, real row, not itself, no walk back to
		// itself, and never under another line's own entry — checked here
		// rather than trusted, because the tree the workspace draws is this
		// column and nothing else. Serialised with the book's other writes
		// (the create's advisory lock): two concurrent re-parents each
		// passing the walk alone could otherwise close a cycle together.
		const [updatedRow] = reparents
			? await db.transaction(async (tx) => {
					await tx.execute(
						sql`select pg_advisory_xact_lock(${existing.entry.lorebookId})`
					)
					await assertAnchorEntry(
						updateData.anchorEntryId,
						existing.entry.lorebookId,
						params.entry.id,
						existing.entry.branchId ?? null,
						tx
					)
					return applyEntryUpdate(
						params.entry.id,
						typeId,
						columns,
						fields,
						tx
					)
				})
			: await applyEntryUpdate(params.entry.id, typeId, columns, fields)
		// The content vector goes stale only when what it embeds changed —
		// the title and the content (the type's `embedText` role). An
		// archive toggle, a re-parent, a date or a mark embeds nothing new,
		// and dropping the vector for one took the entry out of vector
		// retrieval until the queue caught up.
		if (touchesEmbeddedText(columns))
			await clearEntryVectors(params.entry.id)

		const entry = toEntryRow(updatedRow)
		if (emitToUser) emitToUser("entries:update", { entry })
		await afterWrite(
			socket,
			emitToUser,
			existing.entry.lorebookId,
			typeId,
			existing.lorebookName ?? ""
		)

		return { entry }
	}
}

/**
 * An entry's two marks — **Off** (`enabled`) and **Pin** (`constant`) — and
 * nothing else (L1, R58). For the book's owner or an admin. Never touches
 * the vectors: a mark changes whether retrieval may use the entry, not what
 * it says, so it forces no re-embed (neither does `entries:update`, unless
 * the title or the content changed). Writes the base row only (undated, on
 * main); a dated or per-branch mark is an entry amendment (see
 * `offWindowAmendments`).
 */
export const entrySetMarksHandler: Handler<
	Sockets.Entries.SetMarks.Params,
	Sockets.Entries.SetMarks.Response
> = {
	event: "entries:setMarks",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const [found] = await db
			.select({
				entry: schema.lorebookEntries,
				lorebookUserId: schema.lorebooks.userId
			})
			.from(schema.lorebookEntries)
			.innerJoin(
				schema.lorebooks,
				eq(schema.lorebooks.id, schema.lorebookEntries.lorebookId)
			)
			.where(eq(schema.lorebookEntries.id, params.entryId))
			.limit(1)
		if (!found || (found.lorebookUserId !== userId && !socket.user?.isAdmin)) {
			const res = { entryId: params.entryId, error: "Entry not found or access denied." }
			if (emitToUser) emitToUser("entries:setMarks:error", res)
			return res
		}
		const patch: Record<string, boolean> = {}
		if (typeof params.off === "boolean") patch.enabled = !params.off
		if (typeof params.pinned === "boolean") patch.constant = params.pinned
		if (!Object.keys(patch).length) {
			const res = { entryId: params.entryId, error: "Say which mark: off, pinned or both." }
			if (emitToUser) emitToUser("entries:setMarks:error", res)
			return res
		}
		const [updated] = await db
			.update(schema.lorebookEntries)
			.set(patch)
			.where(eq(schema.lorebookEntries.id, params.entryId))
			.returning()
		const entry = toEntryRow(updated)
		// The row everybody already listens for, so an open list updates.
		if (emitToUser) emitToUser("entries:update", { entry })
		const res = {
			entryId: params.entryId,
			// Whose book: a page tells its widgets of a mark only in its own
			// session's book (`hearLoreMarked`).
			lorebookId: updated.lorebookId,
			off: updated.enabled === false,
			pinned: updated.constant === true
		}
		if (emitToUser) emitToUser("entries:setMarks", res)
		return res
	}
}

/**
 * The entry-management widget's one read (L1, R58): the session's book's
 * entries with what this session's rankings made of each, off the rollup
 * (`ranking_subject_stats`) — searched by title and keys, sorted, filtered,
 * paged, in one query. Archived entries are out, as they are out of
 * retrieval. For the book's owner and admins; anyone else is told whose it
 * is (`ownerOnly`) and shown nothing.
 */
export const entrySessionEntriesHandler: Handler<
	Sockets.Entries.SessionEntries.Params,
	Sockets.Entries.SessionEntries.Response
> = {
	event: "entries:sessionEntries",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const answer = (part: Sockets.Entries.SessionEntries.Response) => {
			const res = params.request ? { ...part, request: params.request } : part
			if (emitToUser) emitToUser("entries:sessionEntries", res)
			return res
		}
		const base = { sessionId: params.sessionId, rows: [], total: 0 }
		const access = await checkSessionAccess(params.sessionId, userId)
		if (!access.hasAccess && !socket.user?.isAdmin)
			return answer({ ...base, error: "Session not found." })
		const [session] = await db
			.select({ lorebookId: schema.sessions.lorebookId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, params.sessionId))
			.limit(1)
		if (!session?.lorebookId) return answer({ ...base, lorebookId: null })
		const [book] = await db
			.select({ userId: schema.lorebooks.userId, name: schema.lorebooks.name })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, session.lorebookId))
			.limit(1)
		if (!book) return answer({ ...base, lorebookId: null })
		if (book.userId !== userId && !socket.user?.isAdmin)
			return answer({ ...base, lorebookId: session.lorebookId, ownerOnly: true })

		const limit = Math.min(Math.max(params.limit ?? 50, 1), 200)
		let offset = Math.max(params.offset ?? 0, 0)
		// A search is a substring, never a pattern: `%` and `_` are literal.
		const q = (params.query ?? "").trim().replace(/[\\%_]/g, (c) => `\\${c}`)
		const e = schema.lorebookEntries
		const st = schema.rankingSubjectStats
		const stats = and(
			eq(st.sessionId, params.sessionId),
			eq(st.subjectKind, "lore-entry"),
			sql`${st.subjectId} = ${e.id}::text`
		)
		// The session's reading (ruling 15): its line — with the ancestor
		// chain and every fork cut — and its story clock. A fork's own rows
		// are not another fork's, and a history entry dated past the clock
		// has not happened yet in this session. The same rule retrieval
		// applies (`onLineAtSql`), so what is listed is what can fire.
		const reading = await sessionReadingOf(db, params.sessionId)
		const wheres = [
			eq(e.lorebookId, session.lorebookId),
			eq(e.archived, false),
			onLineAtSql(
				e.branchId,
				historyDateColumns(e.fields),
				reading?.line ?? MAIN_LINE,
				reading?.moment ?? null
			)
		]
		if (q)
			wheres.push(
				sql`(coalesce(${e.title}, '') ILIKE ${"%" + q + "%"} OR array_to_string(${e.keys}, ' ') ILIKE ${"%" + q + "%"})`
			)
		if (params.filter === "fired") wheres.push(eq(st.lastIncluded, true))
		if (params.filter === "pinned") wheres.push(eq(e.constant, true))
		if (params.filter === "off") wheres.push(eq(e.enabled, false))
		// 🚧 A state widget's item picker asks for item entries first (phase 3c).
		const typeIds = Array.isArray(params.typeIds)
			? params.typeIds.filter((t): t is string => typeof t === "string" && t.length > 0)
			: []
		if (typeIds.length) wheres.push(inArray(e.typeId, typeIds))
		const order =
			params.sort === "lastRead"
				? [sql`${st.lastJudgedAt} DESC NULLS LAST`, asc(e.id)]
				: params.sort === "timesRead"
					? [sql`coalesce(${st.timesIncluded}, 0) DESC`, asc(e.id)]
					: params.sort === "rank"
						? [sql`${st.lastRank} ASC NULLS LAST`, asc(e.id)]
						: [sql`lower(coalesce(${e.title}, '')) ASC`, asc(e.id)]
		const page = (at: number) => db
			.select({
				id: e.id,
				typeId: e.typeId,
				title: e.title,
				keys: e.keys,
				enabled: e.enabled,
				constant: e.constant,
				timesJudged: st.timesJudged,
				timesIncluded: st.timesIncluded,
				lastJudgedAt: st.lastJudgedAt,
				lastIncluded: st.lastIncluded,
				lastReason: st.lastReason,
				lastRank: st.lastRank,
				total: sql<number>`count(*) OVER ()`.mapWith(Number)
			})
			.from(e)
			.leftJoin(st, stats)
			.where(and(...wheres))
			.orderBy(...order)
			.limit(limit)
			.offset(at)
		let rows = await page(offset)
		// A page past the end (the last row on the last page just left the
		// filter) is the last real page, never "no entries".
		if (!rows.length && offset > 0) {
			const [{ n }] = await db
				.select({ n: sql<number>`count(*)::int` })
				.from(e)
				.leftJoin(st, stats)
				.where(and(...wheres))
			offset = n ? Math.floor((n - 1) / limit) * limit : 0
			if (n) rows = await page(offset)
		}
		// Each listed row as the session reads it: its title, keys and marks
		// with the line's amendments applied by the session's clock, so the
		// widget names an entry what the prompt calls it. (The search, the
		// filters and the sort still read the stored columns.)
		const overlays = await entryOverlaysFor(
			db,
			session.lorebookId,
			reading ?? MAIN_HEAD,
			rows.map((r) => r.id)
		)
		rows = rows.map((r) => {
			const seen = entryAt(
				{ id: r.id, name: r.title, keys: r.keys, enabled: r.enabled, constant: r.constant },
				overlays,
				reading ?? MAIN_HEAD
			)
			return {
				...r,
				title: typeof seen.name === "string" ? seen.name : r.title,
				// An amendment saved from the editor writes the comma string.
				keys: splitKeys(seen.keys as KeyList),
				enabled: seen.enabled as boolean,
				constant: seen.constant as boolean
			}
		})
		return answer({
			sessionId: params.sessionId,
			lorebookId: session.lorebookId,
			bookName: book.name,
			offset,
			total: rows[0]?.total ?? 0,
			rows: rows.map((r) => ({
				id: r.id,
				typeId: r.typeId,
				title: r.title ?? "",
				keys: r.keys ?? [],
				off: r.enabled === false,
				pinned: r.constant === true,
				timesJudged: r.timesJudged ?? 0,
				timesIncluded: r.timesIncluded ?? 0,
				lastJudgedAt: r.lastJudgedAt ? new Date(r.lastJudgedAt).toISOString() : null,
				lastIncluded: r.lastIncluded ?? null,
				lastReason: r.lastReason ?? null,
				lastRank: r.lastRank ?? null
			}))
		})
	}
}

export const deleteEntryHandler: Handler<
	Sockets.Entries.Delete.Params,
	Sockets.Entries.Delete.Response
> = {
	event: "entries:delete",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const typeId = assertTypeId(params.typeId)

		const existing = await findOwnedEntry(params.id, typeId)
		if (!existing || existing.lorebookUserId !== userId)
			throw new Error("Entry not found or access denied.")

		await db
			.delete(schema.lorebookEntries)
			.where(entryOfType(params.id, typeId))

		// `lorebookId`/`entryId` are present so the interest scope can be
		// derived: `{ success }` on its own named neither the row nor its
		// book, so this reply could only ever reach a bare key — and a
		// workspace could not tell whose delete it was.
		const res: Sockets.Entries.Delete.Response = {
			success: "Entry deleted successfully.",
			lorebookId: existing.entry.lorebookId,
			entryId: params.id,
			typeId
		}
		if (emitToUser) emitToUser("entries:delete", res)
		await afterWrite(
			socket,
			emitToUser,
			existing.entry.lorebookId,
			typeId,
			existing.lorebookName ?? "",
			// Nothing new to embed — the row is gone.
			{ enqueue: false }
		)

		return res
	}
}

export const updateEntryPositionsHandler: Handler<
	Sockets.Entries.UpdatePositions.Params,
	Sockets.Entries.UpdatePositions.Response
> = {
	event: "entries:updatePositions",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const typeId = assertTypeId(params.typeId)

		const book = await findOwnedBook(params.lorebookId, userId)
		if (!book) throw new Error("Lorebook not found or access denied.")

		// Every id in the request must belong to THIS lorebook and THIS type —
		// without it, owning any lorebook was enough to reposition (and thus
		// write to) another user's entries by id.
		const ids = params.positions.map((p) => p.id)
		const rows = await db
			.select({
				id: schema.lorebookEntries.id,
				lorebookId: schema.lorebookEntries.lorebookId
			})
			.from(schema.lorebookEntries)
			.where(
				and(
					inArray(schema.lorebookEntries.id, ids),
					eq(schema.lorebookEntries.typeId, typeId)
				)
			)
		if (
			rows.length !== ids.length ||
			rows.some((r) => r.lorebookId !== params.lorebookId)
		)
			throw new Error("Access denied to some entries.")

		await reorderEntries(params.positions)

		const res: Sockets.Entries.UpdatePositions.Response = {
			success: "Entry positions updated successfully.",
			lorebookId: params.lorebookId,
			typeId
		}
		if (emitToUser) {
			emitToUser("entries:updatePositions", res)
			await relistEntries(socket, params.lorebookId, typeId, emitToUser)
		}

		return res
	}
}

/**
 * Renumber a set of entries, in one transaction, in two passes.
 *
 * ⚠ **The transaction is the point, not a tidiness.** `position` is unique per
 * `(lorebook_id, type_id)`, and a reorder is a permutation: it has to land as
 * one unit or the list is left half-renumbered. The updates are also not issued
 * concurrently — `Promise.all` over one connection is not parallelism here.
 *
 * ⚠ **And the transaction is not enough on its own.** The constraint is a
 * plain, non-deferrable `UNIQUE`, so it is enforced as each index tuple lands
 * rather than at COMMIT, and a straight 1..n rewrite duplicates a position
 * partway through a finished state that has none — A→3 collides with C before
 * C→1 vacates it. So the rows are **parked** in a free range below everything
 * first and then **placed** at their finals:
 *
 *  · the parked values are distinct and all ≤ `parkingFloor`, which sits under
 *    every live position *and* every requested final, so no park collides;
 *  · by the time a final is written, every affected row is out of the positive
 *    range, so a final can only collide with an *unaffected* row or with another
 *    final — which is exactly the state being invalid, and rightly refused.
 *
 * The constraint therefore still holds at every instant, and a genuine
 * permutation no longer needs it relaxed to get through.
 */
export async function reorderEntries(
	updates: ReadonlyArray<{ id: number; position: number }>
) {
	if (!updates.length) return
	await db.transaction(async (tx) => {
		// Derived from the rows rather than taken from the caller: the parking
		// range is only free if it is measured against the group the rows
		// actually live in, and a caller that was wrong about that would park
		// on top of somebody.
		const groups = await tx
			.selectDistinct({
				lorebookId: schema.lorebookEntries.lorebookId,
				typeId: schema.lorebookEntries.typeId
			})
			.from(schema.lorebookEntries)
			.where(
				inArray(
					schema.lorebookEntries.id,
					updates.map((u) => u.id)
				)
			)
		if (!groups.length) return

		const floor = await parkingFloor(
			tx,
			or(...groups.map((g) => inBookOfType(g.lorebookId, g.typeId)))!,
			updates.map((u) => u.position)
		)

		for (const [i, u] of updates.entries())
			await tx
				.update(schema.lorebookEntries)
				.set({ position: floor - i })
				.where(eq(schema.lorebookEntries.id, u.id))

		for (const u of updates)
			await tx
				.update(schema.lorebookEntries)
				.set({ position: u.position })
				.where(eq(schema.lorebookEntries.id, u.id))
	})
}

/**
 * The next sibling of an ordered entry.
 *
 * A type that declares no `order` field role has no notion of a "next" one, and
 * this
 * refuses rather than inventing one. For a type that does, the step is
 * `nextStoryDate`'s: rolled over by the book's declared calendar, and not at
 * all in a free-form book. History is the only ordered type there is, and a
 * second one would want a **named policy**, the way the anchor field role does,
 * rather than a branch here.
 */
export const iterateNextEntryHandler: Handler<
	Sockets.Entries.IterateNext.Params,
	Sockets.Entries.IterateNext.Response
> = {
	event: "entries:iterateNext",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const typeId = assertTypeId(params.typeId)

		if (!entryDeclaration(typeId)?.roles.order)
			throw new Error(
				`'${typeId}' declares no order, so it has no next entry.`
			)

		const existing = await findOwnedEntry(params.id, typeId)
		if (!existing || existing.lorebookUserId !== userId)
			throw new Error("Entry not found or access denied.")

		// The line the new entry lands on: the one being read, as the create
		// path takes it — checked against the book. Absent, it is the source
		// entry's own line, so "next" from a fork's own entry stays on the
		// fork rather than landing on main.
		const branchId =
			params.branchId !== undefined
				? (params.branchId ?? null)
				: (existing.entry.branchId ?? null)
		await assertEntryBranch(branchId, existing.entry.lorebookId)

		const from = toEntryRow(existing.entry) as LorebookEntry<
			typeof HISTORY_TYPE_ID
		>
		// Rolled over by the book's calendar when it declares one; free-form
		// (the default) never rolls over.
		const { year, month, day } = nextStoryDate(
			from,
			await bookCalendarOf(db, existing.entry.lorebookId)
		)
		const position = existing.entry.position + 1

		// Shift every entry already at or past the target position forward by
		// one — otherwise the new entry and whatever was already there share a
		// position, with ambiguous ordering until someone fixes it by hand.
		//
		// ⚠ **`SET position = position + 1` cannot do that in one statement.**
		// `lorebook_entries_position_uq` is a plain, non-deferrable `UNIQUE`, so
		// it is enforced as each index tuple lands: over a contiguous run the
		// shift is unique at the end of the statement and duplicated during it,
		// and the constraint rejects the finished state on the way to producing
		// it. So the run is parked below every live position first and then
		// placed at its finals — two `C - position` reflections, each injective
		// and each landing in a range nothing else occupies.
		const [newRow] = await db.transaction(async (tx) => {
			const inBook = inBookOfType(existing.entry.lorebookId, typeId)
			// Every final is ≥ `position`, and `position` is one past a row that
			// is itself in this group, so the finals are all above the floor and
			// only the live rows bound it.
			const floor = await parkingFloor(tx, inBook)

			// Park: a row at `x ≥ position` goes to `floor - (x - position)`, so
			// the run lands at `floor` and below — free by construction, and in
			// reverse order, which is what keeps it injective.
			await tx
				.update(schema.lorebookEntries)
				.set({
					position: sql`${floor + position} - ${schema.lorebookEntries.position}`
				})
				.where(
					and(inBook, gte(schema.lorebookEntries.position, position))
				)

			// Place: the same reflection back, one slot further along. `≤ floor`
			// selects exactly the rows just parked — the floor is one under the
			// group's minimum, so nothing live can be there. Their targets start
			// at `position + 1`, leaving the slot the new row wants empty.
			await tx
				.update(schema.lorebookEntries)
				.set({
					position: sql`${floor + position + 1} - ${schema.lorebookEntries.position}`
				})
				.where(and(inBook, lte(schema.lorebookEntries.position, floor)))

			return tx
				.insert(schema.lorebookEntries)
				.values(
					entryInsert({
						typeId,
						lorebookId: existing.entry.lorebookId,
						// Blank: the point is a fresh entry on the next date.
						keys: [],
						content: "",
						useRegex: from.useRegex,
						caseSensitive: from.caseSensitive,
						// Carried with its two neighbours: the new row is a
						// sibling of this one, and inheriting two of the three
						// match settings would be the odd one out rather than a
						// decision.
						recursionDepth: from.recursionDepth,
						extraJson: from.extraJson || {},
						year,
						month,
						day,
						position,
						branchId
					} as any)
				)
				.returning()
		})

		const entry = toEntryRow(newRow)
		if (emitToUser) {
			emitToUser("entries:iterateNext", { entry })
			await relistEntries(
				socket,
				existing.entry.lorebookId,
				typeId,
				emitToUser
			)
		}

		return { entry }
	}
}

/**
 * The two doors whose rows are not entries, under the names the wire uses.
 *
 * `Sockets.Entries.Counts` declares this vocabulary: a count is keyed by the
 * **pool kind**, which is a declared type id for an entry and one of these for
 * the two sections drawing rows out of another table.
 */
const SCENE_KIND = "scene"
const CAST_KIND = "cast"

/**
 * The third such door: places.
 *
 * ⚠ **A place is a `core:entry/location` entry** — one definition, shared by
 * this count and the Places board (decided 2026-09-28). Never count "an
 * entry on a travel edge or an entry-to-entry edge" here: the board does not
 * use that definition, and the rail and the board would disagree about the
 * same book.
 */
const PLACE_KIND = "places"

export const entryCountsHandler: Handler<
	Sockets.Entries.Counts.Params,
	Sockets.Entries.Counts.Response
> = {
	event: "entries:counts",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id
		const book = await findOwnedBook(params.lorebookId, userId)
		if (!book) throw new Error("Lorebook not found.")

		// The line being read, with its ancestor chain and fork cuts (ruling
		// 5). A branch of another book is refused, never counted as main.
		let line: Line
		try {
			line = await lineOfBook(db, params.lorebookId, params.branchId ?? null)
		} catch (e) {
			if (e instanceof BranchRefusal)
				throw new Error("That branch is not a line of this lorebook.")
			throw e
		}

		// Every declared kind starts at zero, so a door the book has nothing
		// behind reads "0" rather than going blank — an absent figure is how a
		// reader learns a count has not arrived, and it must not also be how
		// they learn there is nothing there.
		const counts: Record<string, number> = {}
		for (const typeId of ENTRY_TYPE_IDS) counts[typeId] = 0
		counts[SCENE_KIND] = 0
		counts[CAST_KIND] = 0

		// ⚠ The pool's own rule: archived rows are out (the default list
		// hides them), rows on a line outside the chain are out, and a shared
		// history entry dated after a fork is cut from the branch — the same
		// `rowReadsOnLine` the workspace filters its rows by.
		const byType = await db
			.select({
				typeId: schema.lorebookEntries.typeId,
				total: sql<number>`count(*)::int`
			})
			.from(schema.lorebookEntries)
			.where(
				and(
					eq(schema.lorebookEntries.lorebookId, params.lorebookId),
					eq(schema.lorebookEntries.archived, false),
					onLineAtSql(
						schema.lorebookEntries.branchId,
						historyDateColumns(schema.lorebookEntries.fields),
						line
					)
				)
			)
			.groupBy(schema.lorebookEntries.typeId)
		for (const row of byType) counts[row.typeId] = Number(row.total)

		const [scenes] = await db
			.select({ total: sql<number>`count(*)::int` })
			.from(schema.scenes)
			.where(
				and(
					eq(schema.scenes.lorebookId, params.lorebookId),
					onLineSql(schema.scenes.branchId, line)
				)
			)
		counts[SCENE_KIND] = Number(scenes?.total ?? 0)

		const [cast] = await db
			.select({ total: sql<number>`count(*)::int` })
			.from(schema.lorebookBindings)
			.where(eq(schema.lorebookBindings.lorebookId, params.lorebookId))
		counts[CAST_KIND] = Number(cast?.total ?? 0)

		counts[PLACE_KIND] = counts[LOCATION_TYPE_ID] ?? 0

		const res = { lorebookId: params.lorebookId, counts }
		emitToUser("entries:counts", res)
		return res
	}
}


export const entryRecentDecisionsHandler: Handler<
	Sockets.Entries.RecentDecisions.Params,
	Sockets.Entries.RecentDecisions.Response
> = {
	event: "entries:recentDecisions",
	handler: async (socket, params, emitToUser) => {
		const userId = socket.user!.id

		/**
		 * ⚠ **Two checks, and neither stands in for the other** — the same
		 * rule `pipelines:previewRetrieval` is scoped by. The book is the
		 * asker's by this file's ownership rule; the session is theirs by the
		 * shared owner-OR-guest one.
		 */
		// The book's owner — decisions on guests' turns in their sessions
		// included — and admins (R58). A guest gets nothing.
		const book =
			(await findOwnedBook(params.lorebookId, userId)) ??
			(socket.user?.isAdmin
				? await db.query.lorebooks.findFirst({
						where: (l, { eq }) => eq(l.id, params.lorebookId),
						columns: { id: true, name: true, userId: true }
					})
				: undefined)
		if (!book) throw new Error("Lorebook not found.")

		// An admin reads without being in the session (R58); the session must
		// still read THIS book, which the check below enforces for everyone.
		if (!socket.user?.isAdmin) {
			const access = await checkSessionAccess(params.sessionId, userId)
			if (!access.hasAccess)
				throw new Error("Session not found or access denied.")
		}

		const answer = (
			part: Omit<
				Sockets.Entries.RecentDecisions.Response,
				"lorebookId" | "sessionId"
			>
		) => {
			const res: Sockets.Entries.RecentDecisions.Response = {
				lorebookId: params.lorebookId,
				sessionId: params.sessionId,
				...part
			}
			emitToUser("entries:recentDecisions", res)
			return res
		}

		const [session] = await db
			.select({ lorebookId: schema.sessions.lorebookId })
			.from(schema.sessions)
			.where(eq(schema.sessions.id, params.sessionId))
			.limit(1)
		// A session reading another book decided nothing about this
		// book's rows. That is an empty answer rather than a refusal: the
		// question was asked and it has a true answer.
		if (!session || session.lorebookId !== params.lorebookId)
			return answer({ decisions: {} })

		/**
		 * The newest run in this session that ranked anything, read from the
		 * ranking store (R58, R64) — never a receipt. A run that ranked once
		 * per voice holds several rankings; all of them are that turn's.
		 */
		// …and judged LORE: a plugin ranker's turn, or a run with no lore in
		// reach, has nothing to say about this book's entries.
		const [latest] = await db
			.select({ runId: schema.rankings.runId })
			.from(schema.rankings)
			.where(
				and(
					eq(schema.rankings.sessionId, params.sessionId),
					sql`exists (select 1 from ${schema.rankingDecisions} where ${schema.rankingDecisions.rankingId} = ${schema.rankings.id} and ${schema.rankingDecisions.subjectKind} = 'lore-entry')`
				)
			)
			.orderBy(desc(schema.rankings.id))
			.limit(1)
		if (!latest) return answer({ decisions: {} })
		const turn = await db
			.select({
				id: schema.rankings.id,
				detail: schema.rankings.detail,
				budgetTotal: schema.rankings.budgetTotal
			})
			.from(schema.rankings)
			.where(eq(schema.rankings.runId, latest.runId))
		const [run] = await db
			.select({ runId: schema.pipelineRuns.runId })
			.from(schema.pipelineRuns)
			.where(eq(schema.pipelineRuns.id, latest.runId))
			.limit(1)
		const rows = await db
			.select({
				rankingId: schema.rankingDecisions.rankingId,
				subjectId: schema.rankingDecisions.subjectId,
				included: schema.rankingDecisions.included,
				rank: schema.rankingDecisions.rank,
				tokens: schema.rankingDecisions.tokens,
				detail: schema.rankingDecisions.detail
			})
			.from(schema.rankingDecisions)
			.innerJoin(
				schema.lorebookEntries,
				sql`${schema.lorebookEntries.id}::text = ${schema.rankingDecisions.subjectId}`
			)
			.where(
				and(
					inArray(
						schema.rankingDecisions.rankingId,
						turn.map((t) => t.id)
					),
					eq(schema.rankingDecisions.subjectKind, "lore-entry"),
					// Entry ids are a separate space from message ids; the book
					// is what says these subjects are THIS book's entries.
					eq(schema.lorebookEntries.lorebookId, params.lorebookId)
				)
			)
		const decisions: Record<number, "fired" | "considered"> = {}
		// The Read-in line's figures for the owner (R58), off the same rows:
		// rank among the entries that ranking read in, what it cost, the key
		// that matched, and the budget the ranking was given.
		// "of" is rank's own denominator: every lore entry the ranking READ IN,
		// whichever book it came from — the rank was counted among all of them.
		const readIn = new Map<number, number>(
			(
				await db
					.select({
						rankingId: schema.rankingDecisions.rankingId,
						n: sql<number>`count(*)::int`
					})
					.from(schema.rankingDecisions)
					.where(
						and(
							inArray(
								schema.rankingDecisions.rankingId,
								turn.map((t) => t.id)
							),
							eq(schema.rankingDecisions.subjectKind, "lore-entry"),
							eq(schema.rankingDecisions.included, true)
						)
					)
					.groupBy(schema.rankingDecisions.rankingId)
			).map((r) => [r.rankingId, r.n])
		)
		const budgetOf = new Map(
			turn.map((t) => [t.id, (t as { budgetTotal?: number | null }).budgetTotal ?? null])
		)
		const facts: NonNullable<Sockets.Entries.RecentDecisions.Response["facts"]> = {}
		for (const r of rows) {
			const id = Number(r.subjectId)
			const fired = decisions[id] === "fired"
			if (r.included) decisions[id] = "fired"
			else if (!fired) decisions[id] = "considered"
			// An inclusion's figures win over another ranking's rejection.
			if (fired && !r.included) continue
			// Only an exact hit is named: a fuzzy one never "matched" its key.
			const matched = (
				r.detail as { matched?: Array<{ key: string; fuzzy?: boolean }> } | null
			)?.matched?.filter((m) => !m.fuzzy)
			facts[id] = {
				...(r.rank != null ? { rank: r.rank } : {}),
				...(r.rank != null ? { of: readIn.get(r.rankingId) ?? 0 } : {}),
				...(r.tokens != null ? { tokens: r.tokens } : {}),
				...(Array.isArray(matched) && matched[0]?.key ? { matched: matched[0].key } : {}),
				...(budgetOf.get(r.rankingId) != null ? { budget: budgetOf.get(r.rankingId)! } : {})
			}
		}
		const relationships = turn
			.map((t) => (t.detail as { relationships?: Sockets.Entries.RecentDecisions.Response["relationships"] } | null)?.relationships)
			.find((r) => !!r)
		return answer({
			...(run ? { runId: run.runId } : {}),
			decisions,
			facts,
			...(relationships ? { relationships } : {})
		})
	}
}

export function registerEntryHandlers(
	socket: any,
	emitToUser: (event: string, data: any) => void,
	register: (
		socket: any,
		handler: Handler<any, any>,
		emitToUser: (event: string, data: any) => void
	) => void
) {
	register(socket, entryListHandler, emitToUser)
	register(socket, createEntryHandler, emitToUser)
	register(socket, updateEntryHandler, emitToUser)
	register(socket, entrySetMarksHandler, emitToUser)
	register(socket, entrySessionEntriesHandler, emitToUser)
	register(socket, deleteEntryHandler, emitToUser)
	register(socket, updateEntryPositionsHandler, emitToUser)
	register(socket, iterateNextEntryHandler, emitToUser)
	register(socket, entryCountsHandler, emitToUser)
	register(socket, entryRecentDecisionsHandler, emitToUser)
}
