/**
 * Indexing progress, written to Activity (playtest 2, §0-C).
 *
 * The composer's notice used to carry "Indexing 12 of 40 lorebook entries".
 * That moved here: while a lorebook still has entries to index, one
 * `lorebook_indexing` activity per book says how far it is, to administrators
 * and to the book's owner (`activityStore.getFor` is that rule). It ends by
 * itself, when every entry is indexed or the lane goes idle.
 *
 * This module owns two things: the one counter of a book's entries by index
 * state (`lorebookIndexCounts`, read by `vectorization:checkRagStatus` too),
 * and the lane listener that turns an indexed entry into an activity write.
 * It takes the database as a parameter and never imports `$lib/server/db`.
 */
import { and, eq, isNotNull, isNull, ne, sql, type SQL } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { DEFAULT_VECTOR_NAME } from "$lib/server/utils/lorebookEntries"
import { activityStore } from "$lib/server/utils/activityStore"
import type { VectorizationItemUpdatedEvent } from "./vectorizationQueue"

/** A lorebook's entries, split by index state. */
export interface LorebookIndexCounts {
	total: number
	/** Entries with no index at all. */
	nullCount: number
	/** Entries indexed by a model other than the active one. */
	staleCount: number
	readyCount: number
}

/**
 * Count a lorebook's entries by index state: what Search by meaning searches
 * (`SEMANTIC_SEARCH_SOURCES`), and nothing else.
 *
 * The vector is a row in another table, so `IS NULL` is "no default-space
 * vector" and stale is "a vector whose model is not the active one".
 */
export async function lorebookIndexCounts(
	db: Db,
	lorebookId: number,
	activeModel: string
): Promise<LorebookIndexCounts> {
	const entryWhere = eq(schema.lorebookEntries.lorebookId, lorebookId)
	const countEntries = async (extra?: SQL) => {
		const [row] = await db
			.select({ n: sql<number>`count(*)` })
			.from(schema.lorebookEntries)
			.leftJoin(
				schema.lorebookEntryVectors,
				and(
					eq(
						schema.lorebookEntryVectors.entryId,
						schema.lorebookEntries.id
					),
					eq(
						schema.lorebookEntryVectors.vectorName,
						DEFAULT_VECTOR_NAME
					),
					eq(schema.lorebookEntryVectors.chunkIndex, 0)
				)
			)
			.where(extra ? and(entryWhere, extra) : entryWhere)
		return Number(row?.n ?? 0)
	}

	const [total, nullCount, staleCount] = await Promise.all([
		countEntries(),
		countEntries(isNull(schema.lorebookEntryVectors.entryId)),
		countEntries(
			and(
				isNotNull(schema.lorebookEntryVectors.entryId),
				ne(schema.lorebookEntryVectors.model, activeModel)
			)
		)
	])
	return {
		total,
		nullCount,
		staleCount,
		readyCount: total - nullCount - staleCount
	}
}

/** The item types that are a lorebook's entries. */
const ENTRY_TYPES = new Set<string>([
	"worldLore",
	"characterLore",
	"historyEntry"
])

/** One book's recount: running, and whether another is wanted after it. */
interface Recount {
	dirty: boolean
	model: string
	done: Promise<void>
}
const recounts = new Map<number, Recount>()
/** Bumped by each lane `idle`; a recount started before it writes no card. */
let idleGeneration = 0

async function recountOnce(
	db: Db,
	lorebookId: number,
	model: string
): Promise<void> {
	const startedIn = idleGeneration
	const counts = await lorebookIndexCounts(db, lorebookId, model)
	// The lane went idle while this counted: its cards are ended, and a stale
	// count must not raise one that nothing would end again.
	if (startedIn !== idleGeneration) return
	if (counts.readyCount >= counts.total) {
		activityStore.endLorebookIndexing(lorebookId)
		return
	}
	const [book] = await db
		.select({
			userId: schema.lorebooks.userId,
			name: schema.lorebooks.name
		})
		.from(schema.lorebooks)
		.where(eq(schema.lorebooks.id, lorebookId))
		.limit(1)
	if (!book) {
		activityStore.endLorebookIndexing(lorebookId)
		return
	}
	activityStore.upsertLorebookIndexing({
		userId: book.userId,
		lorebookId,
		lorebookLabel: book.name,
		indexedCount: counts.readyCount,
		total: counts.total
	})
}

/**
 * The lane's listener. An indexed entry recounts its book; while a recount is
 * in flight a new event only marks the book dirty and one more runs after
 * (the composer's `statusAsker`, server side). `vectorization:progress` going
 * idle ends every open indexing activity: the lane stopped, nothing is in
 * progress. Resolves when the work this event caused has settled.
 */
export function tellIndexingActivity(
	db: Db,
	event: string,
	payload: unknown
): Promise<void> {
	if (event === "vectorization:progress") {
		if ((payload as { status?: string } | null)?.status === "idle") {
			// The lane stopped: every card ends, and a recount still in flight
			// may not raise one again (its result is older than this idle).
			idleGeneration++
			activityStore.endAllLorebookIndexing()
		}
		return Promise.resolve()
	}
	if (event !== "vectorization:itemUpdated") return Promise.resolve()
	const item = payload as VectorizationItemUpdatedEvent
	if (item.lorebookId == null || !ENTRY_TYPES.has(item.type))
		return Promise.resolve()
	const lorebookId = item.lorebookId

	const running = recounts.get(lorebookId)
	if (running) {
		running.dirty = true
		running.model = item.embeddingModel
		return running.done
	}
	const state: Recount = {
		dirty: false,
		model: item.embeddingModel,
		done: Promise.resolve()
	}
	recounts.set(lorebookId, state)
	state.done = (async () => {
		try {
			do {
				state.dirty = false
				await recountOnce(db, lorebookId, state.model)
			} while (state.dirty)
		} finally {
			recounts.delete(lorebookId)
		}
	})()
	return state.done
}

let wired = false

/**
 * Listen on the embedding lane. Idempotent. The lane is passed in rather than
 * imported so this module binds no lane (and no database) of its own.
 */
export function wireIndexingActivity(
	db: Db,
	lane: {
		registerEmitter(fn: (event: string, payload: unknown) => void): void
	}
): void {
	if (wired) return
	wired = true
	lane.registerEmitter((event, payload) => {
		tellIndexingActivity(db, event, payload).catch((err) =>
			console.error(
				"[embedding] could not record indexing progress:",
				err
			)
		)
	})
}
