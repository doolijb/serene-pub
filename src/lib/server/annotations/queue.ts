/**
 * The **annotation lane** — the second instance of the shared queue primitives.
 *
 * Same machinery as the embedding lane in `embedding/vectorizationQueue.ts`,
 * initialised on a different lane: its own work source, its own TTL, its own
 * autostart, its own force-start. Not a mode flag on one queue and not a second
 * copy of the loop.
 *
 * ## This lane runs with a model or without one, and *without* is the default
 *
 * The entity extractor is **dictionary-based and works with nothing
 * configured**, so the zero-setup path keeps working: a lorebook with no
 * keywords, no model and nothing downloaded still gets its names matched. On top
 * of that, and only when a `text->entities` connection is starred, `nerBroker`
 * loads that connection's model and the extractor gets a third tier
 * (`ranking/entities.ts`, tier zero).
 *
 * ⚠ The conditional runs THAT way round and must keep running that way round.
 * With no star the broker answers `{kind: "none"}` — the arm the loop treats as
 * an ordinary answer — and never `unconfigured`, which is the arm it reads as
 * *stop*. A star whose model cannot load degrades to the same `none` rather than
 * halting the lane; see the broker, which explains why taking the lexical tier
 * down with a broken model is the one outcome forbidden here.
 *
 * That is the lane contract's third constraint — *nothing may assume a model is
 * immediately available* — arrived at from the other direction. **"No model
 * configured for this lane" is a first-class normal state**, and the shape it
 * replaces is the old vectorization queue's `if (!candidateModel) break`, which
 * would have made a model-free feature impossible to run inside it.
 *
 * ## What is stale: the text, never a clock
 *
 * A row's annotation is fresh when its stored triple `(extractorVersion,
 * sourceHash, gazetteerHash)` still describes it, and all three are SQL
 * comparisons: the extractor's version and the lorebook's vocabulary hash are
 * known before the query, and the content hash is a GENERATED column on the
 * row the text lives on (`annotationTextHash`: an entry's
 * `annotation_text_hash`, a message's `embed_text_hash`) — the rule the
 * embedding lane follows (plan A9, A23). So a mark, a reorder, a hidden message
 * or a graph build's `graphed` flag costs no extraction and no entity-model
 * lease, a write that pins `updated_at` is still seen when it moves the text,
 * and no timestamp from one clock is compared with one from another.
 *
 * ⚠ The lane's unit of work stamps the column it read with the text (see
 * `annotateEntry`), which is what closes the loop: the picker compares against
 * that same column, so it hands a row back only when its text moved after the
 * read. `writeAnnotations` never touches the parent row, so it cannot
 * re-trigger itself.
 *
 * ## What the background sweep will and will not start
 *
 * Entries, in every lorebook whose owner's account is live — a deleted
 * account's books are nobody's to index. Transcripts,
 * **only through a group**: the entity arm enqueues the session it is running
 * in, and only when its message half is switched on, so the group's existence
 * is the opt-in. An install that has not asked for retrieval over its
 * transcript should not have a background pass building an index for it, and
 * this lane continues what a turn started rather than starting it.
 */

import { and, asc, desc, eq, sql, notExists } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { EXTRACTOR_VERSION } from "$lib/server/pipelines/ranking/entities"
import {
	IndexingLane,
	registerLane,
	type LaneItem,
	type LaneItemRef,
	type LanePickContext,
	type LaneWorkSource,
	type PriorityGroup,
	type PromotionReport
} from "$lib/server/indexing/lane"
import {
	ANNOTATION_BATCH,
	annotateEntry,
	annotateMessage,
	annotationTextHash,
	loadVocabulary,
	type AnnotationVocabulary
} from "./index"
import { nerBroker } from "$lib/server/ner/broker"

// db is the global Db — see db/types.d.ts

/**
 * ⚠ There is no `ANNOTATION_MODEL_TTL_MINUTES` here any more.
 *
 * It was a module constant standing in for a number nothing could set. The TTL
 * is now a property of the STARRED CONNECTION (`extraJson.nerModelTtlMinutes`,
 * edited on its own form, defaulted by `DEFAULT_NER_TTL_MINUTES`), which is what
 * lets two entity connections want two windows — and a constant here would be a
 * second spelling of that number that an admin surface could read and never
 * change. `nerBroker.spec.ttlMinutes` reports whichever value is in force.
 */

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
 * The three checks are the freshness triple; the content hash is compared with
 * the entry's own GENERATED column, as this file's header explains. Any one of
 * them failing makes the row work.
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
					eq(
						schema.entryAnnotations.sourceHash,
						annotationTextHash.entry
					)
				)
			)
	)

/**
 * A settled message with no fresh annotation.
 *
 * A reply still generating is not work yet: its text moves with every chunk
 * the stream persists, so an annotation of it is stale at the next chunk and
 * the picker would take it again at once — an entity-model call per chunk,
 * none of them kept. The embedding lane waits for the same thing (`settled` on
 * its message store); the next pass over the session takes the finished text.
 */
const messageNeedsAnnotation = (db: Db, gazetteerHash: string) =>
	and(
		eq(schema.sessionMessages.isGenerating, false),
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
						eq(
							schema.messageAnnotations.gazetteerHash,
							gazetteerHash
						),
						eq(
							schema.messageAnnotations.sourceHash,
							annotationTextHash.message
						)
					)
				)
		)
	)

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

/**
 * ⚠ `modelId` is the lane's residency key, and passing it through is what makes
 * the model tier happen at all.
 *
 * A non-null `modelId` on an item is what makes the loop take a LEASE before
 * processing it (see `IndexingLane.run`), so the model is resident by the time
 * `annotateEntry` asks for spans; a null one is the model-free pass, unchanged.
 * The same value then reaches `annotateEntry`, which will only use a resident
 * model whose identity matches — so a model that was swapped between the lease
 * and the write contributes nothing rather than contributing the wrong thing.
 */
const entryItem = (
	db: Db,
	entryId: number,
	lorebookId: number,
	title: string | null,
	vocabulary: AnnotationVocabulary,
	modelId: string | null
): LaneItem => ({
	ref: { source: ENTRY_ANNOTATION, id: entryId },
	label: {
		type: ENTRY_ANNOTATION,
		label: `Entry names: ${title || entryId}`
	},
	lorebookId,
	modelId,
	process: async () => {
		await annotateEntry(db, entryId, vocabulary, modelId)
	}
})

const messageItem = (
	db: Db,
	messageId: number,
	vocabulary: AnnotationVocabulary,
	modelId: string | null
): LaneItem => ({
	ref: { source: MESSAGE_ANNOTATION, id: messageId },
	label: {
		type: MESSAGE_ANNOTATION,
		label: `Message names: #${messageId}`
	},
	modelId,
	process: async () => {
		await annotateMessage(db, messageId, vocabulary, modelId)
	}
})

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

async function pickStaleEntry(
	db: Db,
	lorebookId: number,
	modelId: string | null,
	onlyId?: number
): Promise<LaneItem | null> {
	const vocabulary = await vocabularyFor(db, lorebookId)
	const rows = await db
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
		.limit(1)
	if (!rows.length) return null
	return entryItem(
		db,
		rows[0].id,
		lorebookId,
		rows[0].title ?? null,
		vocabulary,
		modelId
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
	modelId: string | null,
	onlyId?: number
): Promise<LaneItem | null> {
	const vocabulary = lorebookId
		? await vocabularyFor(db, lorebookId)
		: await loadVocabulary(db, null)
	const rows = await db
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
		.limit(1)
	if (!rows.length) return null
	return messageItem(db, rows[0].id, vocabulary, modelId)
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
		async fromGroup(
			group: PriorityGroup,
			modelId: string | null,
			pick?: LanePickContext
		) {
			const db = await getDb()
			for (const lorebookId of group.lorebookIds) {
				const entry = await pickStaleEntry(db, lorebookId, modelId)
				if (entry) return entry
				// Each book costs a vocabulary build; give way between them.
				if (await pick?.giveWay()) return null
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
				const [session] = await db
					.select({ lorebookId: schema.sessions.lorebookId })
					.from(schema.sessions)
					.where(eq(schema.sessions.id, group.sessionId))
					.limit(1)
				const message = await pickStaleMessage(
					db,
					group.sessionId,
					session?.lorebookId ?? null,
					modelId
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
		 *
		 * ⚠ Only books whose owner's account is live. A deleted account is
		 * soft-deleted and keeps its rows, and a sweep over every book would
		 * index them for ever for nobody (plan A23).
		 */
		async global(modelId: string | null, pick?: LanePickContext) {
			const db = await getDb()
			const books = await db
				.select({ id: schema.lorebooks.id })
				.from(schema.lorebooks)
				.innerJoin(
					schema.users,
					eq(schema.users.id, schema.lorebooks.userId)
				)
				.where(eq(schema.users.isDeleted, false))
				.orderBy(asc(schema.lorebooks.id))
			for (const book of books) {
				/**
				 * Gives way before each book: this walk builds every book's
				 * vocabulary to find one stale entry, which on a big pub is
				 * the longest stretch of PGlite work the lane does — and the
				 * lane starts on every turn. A turn or a promotion that turns
				 * up mid-walk is served first; the lane reads the `null` as
				 * interrupted and walks again afterwards.
				 */
				if (await pick?.giveWay()) return null
				const item = await pickStaleEntry(db, book.id, modelId)
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
		async specific(ref: LaneItemRef, modelId, context: unknown) {
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
				const rows = await db
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
					.limit(1)
				if (!rows.length) return null
				return entryItem(
					db,
					rows[0].id,
					rows[0].lorebookId,
					rows[0].title ?? null,
					ctx.vocabulary,
					modelId
				)
			}
			if (ref.source === MESSAGE_ANNOTATION) {
				if (!ctx.vocabulary) return null
				const rows = await db
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
					.limit(1)
				if (!rows.length) return null
				return messageItem(db, rows[0].id, ctx.vocabulary, modelId)
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
		 * Constraint 2 — the lane's model need, as data. `role: "ner"` says
		 * *this lane's model is an entity model*, which an admin surface can
		 * read off `annotationLane.declaration` alongside the embedding lane's
		 * `role: "embedding"` without either loop being consulted. Whether one
		 * is CONFIGURED is the broker's `peek`, not the declaration: a role that
		 * flipped to null when nothing was starred would make the lane's
		 * identity depend on a setting.
		 */
		model: nerBroker,
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
