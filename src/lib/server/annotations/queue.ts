/**
 * The **annotation lane** — the second instance of the shared queue primitives.
 *
 * Same machinery as the embedding lane in `embedding/vectorizationQueue.ts`,
 * initialised on a different lane: its own work source, its own TTL, its own
 * autostart, its own force-start. Not a mode flag on one queue and not a second
 * copy of the loop.
 *
 * ## This lane has no model, and that is not a temporary state
 *
 * The entity extractor is **dictionary-based and deliberately model-free**, so
 * the zero-setup path keeps working: a lorebook with no keywords, no embedding
 * model and nothing downloaded still gets its names matched. The optional ONNX
 * mention detector (retrieval plan phase 9) is not built. So this lane declares
 * `role: null` and `modelFreeBroker` answers *"none"* to every residency
 * question, which the loop treats as an ordinary answer rather than a reason to
 * stop.
 *
 * That is the same requirement as the lane contract's third constraint —
 * *nothing may assume a model is immediately available* — arrived at from the
 * other direction. **"No model configured for this lane" is a first-class
 * normal state**, and the shape it replaces is the old vectorization queue's
 * `if (!candidateModel) break`, which would have made a model-free feature
 * impossible to run inside it.
 *
 * ## What is stale, and how it is found without recomputing a hash
 *
 * A row's annotation is fresh when its stored triple `(extractorVersion,
 * sourceHash, gazetteerHash)` still describes it. Two thirds of that is a
 * cheap SQL comparison — the extractor's version and the lorebook's vocabulary
 * hash are known before the query — and the third, the content hash, is not:
 * it has to be recomputed from the text. So the picker uses the same shape
 * `needsEmbedding` uses for the same problem: **`annotated_at >= updated_at`**
 * stands in for the content hash. It is a superset — an edit that changed no
 * annotated text still moves `updated_at` — which costs one redundant
 * extraction and never misses a real change.
 *
 * ⚠ That is also why the lane's unit of work writes **unconditionally** (see
 * `annotateEntry`): a pass that examined a row and decided it was fresh would
 * leave `annotated_at` where it was, the predicate would still be true, and the
 * picker would hand the same row back for ever. The write is what closes the
 * loop, and `writeAnnotations` never touches the parent row, so it cannot
 * re-trigger itself.
 *
 * ## What the background sweep will and will not start
 *
 * Entries, everywhere — the unscoped sweep walks every lorebook. Transcripts,
 * **only through a group**: the entity arm enqueues the session it is running
 * in, and only when its message half is switched on, so the group's existence
 * is the opt-in. An install that has not asked for retrieval over its
 * transcript should not have a background pass building an index for it, and
 * this lane continues what a turn started rather than starting it.
 */

import { and, asc, desc, eq, gte, sql, notExists } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { EXTRACTOR_VERSION } from "$lib/server/pipelines/ranking/entities"
import {
	IndexingLane,
	modelFreeBroker,
	registerLane,
	type LaneItem,
	type LaneItemRef,
	type LaneWorkSource,
	type PriorityGroup,
	type PromotionReport
} from "$lib/server/indexing/lane"
import {
	ANNOTATION_BATCH,
	annotateEntry,
	annotateMessage,
	loadVocabulary,
	type AnnotationVocabulary
} from "./index"

type Db = any

/**
 * The lane's TTL, as a per-lane value rather than a shared constant.
 *
 * Nothing unloads today because nothing is loaded. It is declared anyway, and
 * declared *here* rather than in the loop, because it is the number the optional
 * mention detector will be governed by and the number an admin *Servers* page
 * has to be able to read and set per lane. Zero would have been a lie in the
 * other direction — "unload immediately" is not what this lane wants.
 */
export const ANNOTATION_MODEL_TTL_MINUTES = 5

/** Item sources this lane understands. Also the `ref.source` vocabulary. */
export const ENTRY_ANNOTATION = "entryAnnotation"
export const MESSAGE_ANNOTATION = "messageAnnotation"

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The lorebook's vocabulary, read fresh for every pick. **Deliberately not
 * cached**, and the cost is real: two queries and a gazetteer build per item on
 * the background sweep.
 *
 * ⚠ A cache here was written and removed, because it produces the failure the
 * whole freshness triple exists to prevent. The picker's predicate and the
 * write it leads to both key on this hash, so a cached one makes them agree
 * with each other and disagree with the readers — `readEntryAnnotations` and
 * `searchMessageAnnotations` both refuse a row whose `gazetteer_hash` is not
 * the current one. The lane would write rows that nothing can use, mark them
 * fresh by its own stale standard, and stop. Retrieval silently loses its
 * whole annotated corpus for as long as the cache lives.
 *
 * The promotion path pays none of this: a promoting caller passes the
 * vocabulary it has already built in `context`, so a turn indexing forty
 * entries builds it once.
 */
const vocabularyFor = (
	db: Db,
	lorebookId: number
): Promise<AnnotationVocabulary> => loadVocabulary(db, lorebookId)

// ---------------------------------------------------------------------------
// Staleness
// ---------------------------------------------------------------------------

/**
 * `NOT EXISTS (a fresh annotation for this entry)`.
 *
 * The three checks are the freshness triple, with the content hash standing in
 * as the timestamp comparison explained in this file's header. Any one of them
 * failing makes the row work.
 */
const entryNeedsAnnotation = (db: Db, gazetteerHash: string) =>
	notExists(
		db
			.select({ _: sql`1` })
			.from(schema.entryAnnotations)
			.where(
				and(
					eq(
						schema.entryAnnotations.entryId,
						schema.lorebookEntries.id
					),
					eq(
						schema.entryAnnotations.extractorVersion,
						EXTRACTOR_VERSION
					),
					eq(schema.entryAnnotations.gazetteerHash, gazetteerHash),
					gte(
						schema.entryAnnotations.annotatedAt,
						schema.lorebookEntries.updatedAt
					)
				)
			)
	)

const messageNeedsAnnotation = (db: Db, gazetteerHash: string) =>
	notExists(
		db
			.select({ _: sql`1` })
			.from(schema.messageAnnotations)
			.where(
				and(
					eq(
						schema.messageAnnotations.messageId,
						schema.messages.id
					),
					eq(
						schema.messageAnnotations.extractorVersion,
						EXTRACTOR_VERSION
					),
					eq(schema.messageAnnotations.gazetteerHash, gazetteerHash),
					gte(
						schema.messageAnnotations.annotatedAt,
						schema.sessionMessages.updatedAt
					)
				)
			)
	)

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const entryItem = (
	db: Db,
	entryId: number,
	lorebookId: number,
	title: string | null,
	vocabulary: AnnotationVocabulary
): LaneItem => ({
	ref: { source: ENTRY_ANNOTATION, id: entryId },
	label: {
		type: ENTRY_ANNOTATION,
		label: `Entry names: ${title || entryId}`
	},
	lorebookId,
	modelId: null,
	process: async () => {
		await annotateEntry(db, entryId, vocabulary)
	}
})

const messageItem = (
	db: Db,
	messageId: number,
	vocabulary: AnnotationVocabulary
): LaneItem => ({
	ref: { source: MESSAGE_ANNOTATION, id: messageId },
	label: {
		type: MESSAGE_ANNOTATION,
		label: `Message names: #${messageId}`
	},
	modelId: null,
	process: async () => {
		await annotateMessage(db, messageId, vocabulary)
	}
})

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

async function pickStaleEntry(
	db: Db,
	lorebookId: number,
	onlyId?: number
): Promise<LaneItem | null> {
	const vocabulary = await vocabularyFor(db, lorebookId)
	const rows = (await db
		.select({
			id: schema.lorebookEntries.id,
			title: schema.lorebookEntries.title
		})
		.from(schema.lorebookEntries)
		.where(
			and(
				eq(schema.lorebookEntries.lorebookId, lorebookId),
				onlyId ? eq(schema.lorebookEntries.id, onlyId) : undefined,
				entryNeedsAnnotation(db, vocabulary.hash)
			)
		)
		.orderBy(asc(schema.lorebookEntries.id))
		.limit(1)) as any[]
	if (!rows.length) return null
	return entryItem(
		db,
		rows[0].id,
		lorebookId,
		rows[0].title ?? null,
		vocabulary
	)
}

/**
 * The session's next un-annotated message, newest first.
 *
 * Newest first because that is where relevance is — a scene is likeliest to be
 * re-treading its own recent past, and a backfill starting at message 1 would
 * leave the useful half until last.
 */
async function pickStaleMessage(
	db: Db,
	sessionId: number,
	lorebookId: number | null,
	onlyId?: number
): Promise<LaneItem | null> {
	const vocabulary = lorebookId
		? await vocabularyFor(db, lorebookId)
		: await loadVocabulary(db, null)
	const rows = (await db
		.select({ id: schema.messages.id })
		.from(schema.messages)
		.innerJoin(
			schema.sessionMessages,
			eq(schema.sessionMessages.id, schema.messages.id)
		)
		.where(
			and(
				eq(schema.messages.sessionId, sessionId),
				onlyId ? eq(schema.messages.id, onlyId) : undefined,
				messageNeedsAnnotation(db, vocabulary.hash)
			)
		)
		.orderBy(desc(schema.messages.id))
		.limit(1)) as any[]
	if (!rows.length) return null
	return messageItem(db, rows[0].id, vocabulary)
}

// ---------------------------------------------------------------------------
// The lane
// ---------------------------------------------------------------------------

/** What a promotion hands the work source, so it does not rebuild a vocabulary. */
export interface AnnotationPromotionContext {
	vocabulary: AnnotationVocabulary
	lorebookId: number | null
}

function makeWorkSource(getDb: () => Promise<Db>): LaneWorkSource {
	return {
		async fromGroup(group: PriorityGroup) {
			const db = await getDb()
			for (const lorebookId of group.lorebookIds) {
				const entry = await pickStaleEntry(db, lorebookId)
				if (entry) return entry
			}
			/**
			 * The transcript, and **only** through a group.
			 *
			 * A session is enqueued by the entity arm and only when its message
			 * half is on, so the group's existence *is* the opt-in: an install
			 * that has not asked for retrieval over its transcript never gets a
			 * group and therefore never has an index built for it. Asking the
			 * data instead ("has this session any annotations yet?") would have
			 * answered no on the first turn and never let the first one be
			 * written.
			 */
			if (group.sessionId !== undefined) {
				const [session] = (await db
					.select({ lorebookId: schema.sessions.lorebookId })
					.from(schema.sessions)
					.where(eq(schema.sessions.id, group.sessionId))
					.limit(1)) as any[]
				const message = await pickStaleMessage(
					db,
					group.sessionId,
					session?.lorebookId ?? null
				)
				if (message) return message
			}
			return null
		},

		/**
		 * The unscoped sweep — *"new and stale content gets queued
		 * automatically in the background"*, and the reason it walks lorebooks
		 * rather than entries: the freshness comparison needs that book's
		 * vocabulary hash, which is a property of the book and not of the row.
		 *
		 * ⚠ **Entries only, deliberately.** Sweeping every session's transcript
		 * here would mean a `SELECT DISTINCT` across the whole annotation table
		 * on every lane start — and the lane starts on every entry write and
		 * every turn — to find sessions nobody asked about. Transcripts are
		 * reached through the group the entity arm enqueues for the session it
		 * is actually in, which is bounded to that session and asked for.
		 */
		async global() {
			const db = await getDb()
			const books = (await db
				.select({ id: schema.lorebooks.id })
				.from(schema.lorebooks)
				.orderBy(asc(schema.lorebooks.id))) as any[]
			for (const book of books) {
				const item = await pickStaleEntry(db, book.id)
				if (item) return item
			}
			return null
		},

		/**
		 * One specific row, for a promotion. The caller's vocabulary is used
		 * when it passed one — the entity arm has already built exactly the one
		 * the annotation must be written under, and rebuilding it per item
		 * would be the same query over and over.
		 */
		async specific(ref: LaneItemRef, _modelId, context: unknown) {
			const db = await getDb()
			const ctx = (context ?? {}) as Partial<AnnotationPromotionContext>
			if (ref.source === ENTRY_ANNOTATION) {
				/**
				 * ⚠ Gated on the vocabulary only, never on `lorebookId`.
				 *
				 * A session with no lorebook gets `EMPTY_VOCABULARY`, and that
				 * is a working state rather than a broken one — both sides fall
				 * to the open tier and their keys still agree. Refusing to
				 * annotate there would take the entity arm's whole entry half
				 * away from exactly the install that has configured least,
				 * which is the shape of signal loss the governing rule forbids.
				 */
				if (!ctx.vocabulary) return null
				const rows = (await db
					.select({
						id: schema.lorebookEntries.id,
						title: schema.lorebookEntries.title,
						lorebookId: schema.lorebookEntries.lorebookId
					})
					.from(schema.lorebookEntries)
					.where(
						and(
							eq(schema.lorebookEntries.id, ref.id),
							entryNeedsAnnotation(db, ctx.vocabulary.hash)
						)
					)
					.limit(1)) as any[]
				if (!rows.length) return null
				return entryItem(
					db,
					rows[0].id,
					rows[0].lorebookId,
					rows[0].title ?? null,
					ctx.vocabulary
				)
			}
			if (ref.source === MESSAGE_ANNOTATION) {
				if (!ctx.vocabulary) return null
				const rows = (await db
					.select({ id: schema.messages.id })
					.from(schema.messages)
					.innerJoin(
						schema.sessionMessages,
						eq(schema.sessionMessages.id, schema.messages.id)
					)
					.where(
						and(
							eq(schema.messages.id, ref.id),
							messageNeedsAnnotation(db, ctx.vocabulary.hash)
						)
					)
					.limit(1)) as any[]
				if (!rows.length) return null
				return messageItem(db, rows[0].id, ctx.vocabulary)
			}
			return null
		}
	}
}

/**
 * The database, resolved lazily.
 *
 * `db/index.ts` must not be imported for its side effects at module load —
 * a top-level await there deadlocks the production bundle — and the tests that
 * mock `$lib/server/db` need the mock in place before the first read. Both are
 * satisfied by resolving it per call.
 */
const getDb = async (): Promise<Db> => (await import("$lib/server/db")).db

export const annotationLane = registerLane(
	new IndexingLane({
		key: "annotation",
		label: "annotation",
		/**
		 * Constraint 2 — the lane's model need, as data. `role: null` says
		 * *this lane needs nothing loaded*, which an admin surface can read
		 * off `annotationLane.declaration` alongside the embedding lane's
		 * `role: "embedding"` without either loop being consulted.
		 */
		model: modelFreeBroker(ANNOTATION_MODEL_TTL_MINUTES),
		work: makeWorkSource(getDb),
		/**
		 * ⚠ Unconditionally enabled, and that is the design rather than an
		 * omission. The whole lexical stack — the gazetteer, the extractor,
		 * every name match — is the level-0 path that works with nothing
		 * configured, so gating it behind a switch would make the zero-setup
		 * install worse than the configured one at the one thing it is
		 * supposed to be good at. A stored switch is what the embedding lane
		 * needs, because embedding costs a download or an API bill; this costs
		 * a regex.
		 */
		isEnabled: async () => true,
		autostart: async () => true,
		/**
		 * **Per-lane bounds, and this is where the per-lane part earns itself.**
		 *
		 * The shared default is 25 items in 5 seconds, sized for the embedding
		 * lane, where one item is a model call or a network round trip. One item
		 * here is a regex over at most `MAX_ANNOTATED_LENGTH` characters, so the
		 * same number would have made a hundred-entry book take four turns to
		 * cover what `annotateEntries` used to cover in one — a regression
		 * dressed as a safety bound. `ANNOTATION_BATCH` is the number that pass
		 * already used, kept so convergence is unchanged, with a shorter
		 * deadline because if two hundred regexes take two seconds the problem
		 * is not the bound.
		 */
		limits: {
			promotionMaxItems: ANNOTATION_BATCH,
			promotionTimeoutMs: 2_000
		}
	})
)

/**
 * Index the names in these entries now, ahead of the queue, and report.
 *
 * Replaces the entity arm's inline repair pass. Same guarantee to the caller —
 * every id named is annotated for the current content and vocabulary, up to the
 * bound — through the queue rather than beside it, so one place owns fairness,
 * failure backoff and what happens when a pass cannot finish.
 *
 * Never rejects. A promotion that cannot complete comes back as a report whose
 * `reason` belongs on the receipt.
 */
export async function promoteEntryAnnotations(
	entryIds: readonly number[],
	vocabulary: AnnotationVocabulary,
	lorebookId: number | null,
	opts: { maxItems?: number; timeoutMs?: number } = {}
): Promise<PromotionReport> {
	return annotationLane.promote({
		refs: entryIds.map((id) => ({ source: ENTRY_ANNOTATION, id })),
		maxItems: opts.maxItems,
		timeoutMs: opts.timeoutMs,
		context: { vocabulary, lorebookId } satisfies AnnotationPromotionContext
	})
}

/**
 * Queue a session's transcript for annotation in the background.
 *
 * The replacement for the fire-and-forget pass the entity arm used to start
 * directly: same "extraction must never block a turn" rule, expressed as a
 * group on the queue instead of a detached promise, so it is visible, bounded
 * and interleaved with everything else the lane owes.
 */
export function enqueueSessionAnnotation(
	sessionId: number,
	lorebookId: number | null,
	label: string
): void {
	annotationLane.enqueueGroup(
		{
			label,
			ownerDisplayName: "",
			sessionId,
			lorebookIds: lorebookId ? [lorebookId] : [],
			characterIds: [],
			personaIds: []
		},
		(g) => g.sessionId === sessionId
	)
	// Force-start, explicitly — enqueueing states that content changed; this
	// states that the lane should run.
	annotationLane.start()
}

/**
 * Queue a lorebook's entries for annotation in the background.
 *
 * The background half of *"new and stale content gets queued automatically"* —
 * called from the entries write path, where a fire-and-forget
 * `annotateLorebook` used to run unbounded.
 */
export function enqueueLorebookAnnotation(
	lorebookId: number,
	label: string
): void {
	annotationLane.enqueueGroup(
		{
			label,
			ownerDisplayName: "",
			lorebookIds: [lorebookId],
			characterIds: [],
			personaIds: []
		},
		(g) => g.lorebookIds.includes(lorebookId) && g.sessionId === undefined
	)
	annotationLane.start()
}

/**
 * Resolves once the annotation lane has no run in flight.
 *
 * **Tests await this**, exactly where they used to await
 * `settleAnnotationPasses()` — the fire-and-forget promise map that the queue
 * replaced. Nothing on a reply path waits for it: a turn that needs specific
 * rows indexed promotes them and waits for *those*, which is bounded, rather
 * than for a whole install's backlog, which is not.
 */
export const settleAnnotationQueue = (): Promise<void> =>
	annotationLane.settled()

/** The lane's periodic sweep. Called once at boot, beside the embedding lane's. */
export function startPeriodicAnnotationScan(): void {
	annotationLane.startPeriodicScan()
}
