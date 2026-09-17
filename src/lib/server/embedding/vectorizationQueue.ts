/**
 * The **embedding lane** — one instance of the shared queue primitives.
 *
 * Processes embedding jobs one at a time with:
 *  - Pause/resume support
 *  - Socket progress events for the global UI indicator
 *  - Priority groups: sessions (with their lorebooks + characters) can be moved
 *    to the front of the queue; items within a group are processed in a fixed
 *    order (messages → lorebook content → characters → personas)
 *  - Model tracking: embeddingModel is written alongside each vector so RAG
 *    can filter to only compare vectors from the active model, and so rows
 *    produced by a previous model are treated as stale and re-embedded.
 *
 * ## What moved, and what did not
 *
 * The loop, the round-robin fairness, the per-item failure backoff, the
 * progress fan-out and the promotion machinery are all in
 * `$lib/server/indexing/lane.ts` now, shared with the annotation lane. What
 * stays here is what is actually about *embeddings*: the staleness predicates,
 * the pickers, the two freshness-guarded writes, and the broker that speaks for
 * the embedding model.
 *
 * ⚠ **The model coupling this removes.** The old loop opened with
 * `if (!candidateModel) break` — a check that ran before any picker, so a lane
 * that needs no model could not exist inside it. Residency is now requested
 * through `embeddingBroker`, and only once real work is in hand, which keeps
 * the old "an instance with nothing to embed never pays a load cost" property
 * while making the check a lane's own business rather than the loop's.
 *
 * Every exported function below keeps the name and shape its callers already
 * use — the socket handlers, `generateResponse`, and the four existing test
 * files — and delegates to the lane.
 */

import { db } from "$lib/server/db"
import {
	and,
	eq,
	inArray,
	isNull,
	isNotNull,
	asc,
	desc,
	ne,
	or,
	gt,
	sql
} from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { castEdgeOnly, isCastEdge } from "$lib/server/utils/narrativeEdges"
import {
	CHARACTER_LORE_TYPE_ID,
	DEFAULT_VECTOR_NAME,
	HISTORY_TYPE_ID,
	WORLD_LORE_TYPE_ID
} from "$lib/server/utils/lorebookEntries"
import {
	embed,
	isModelReady,
	isModelLoading,
	getLoadedModelId,
	loadConfiguredEmbeddingModel,
	getConfiguredModelId,
	getConfiguredEmbeddingTarget
} from "./index"
import { embeddingsEnabled } from "./target"
import {
	IndexingLane,
	registerLane,
	type CompletedGroup as LaneCompletedGroup,
	type LaneItem,
	type LaneItemRef,
	type LaneModelBroker,
	type LaneWorkSource,
	type ModelLease,
	type PriorityGroup as LanePriorityGroup,
	type PromotionReport
} from "$lib/server/indexing/lane"
import { channelWhere } from "$lib/server/messages/channels"
import type { SessionRagContext } from "./ragContext"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VectorizationProgressEvent = {
	status: "idle" | "running" | "paused"
	currentItem?: {
		type:
			| "message"
			| "worldLore"
			| "characterLore"
			| "historyEntry"
			| "narrativeNode"
			| "narrativeRelationship"
			| "character"
		label: string
	}
	queued: number
	completed: number
	/** Snapshot of the priority queue for the UI */
	priorityQueue: PriorityGroup[]
	history: CompletedGroup[]
}

/**
 * A priority group represents a set of related content that should be
 * embedded together before moving to other groups in the queue.
 * Typically one group per session, containing the session's messages, its
 * lorebook entries, and its linked characters/personas.
 *
 * Re-exported from the lane primitives rather than redeclared, so the socket
 * payloads and the queue cannot drift apart.
 */
export type PriorityGroup = LanePriorityGroup
export type CompletedGroup = LaneCompletedGroup

// Session messages are already bounded to MAX_CHAT_MESSAGE_LENGTH before
// insert, so their embed() call is implicitly safe. Every other embedded
// content type (lore entries, narrative nodes/relationships, character/
// persona descriptions) is an unbounded text column with no cap before it
// reaches here — this truncates only the text handed to the embedding
// model, not the stored content itself (which stays full-length for
// prompt-building/display), as a safety net against a pasted
// megabyte-scale entry driving an uncapped local-model tokenization cost or
// an uncapped payload to an external embeddings API.
export const MAX_EMBED_INPUT_LENGTH = 20_000
export function truncateForEmbedding(text: string): string {
	return text.length > MAX_EMBED_INPUT_LENGTH
		? text.slice(0, MAX_EMBED_INPUT_LENGTH)
		: text
}

type EmitFn = (event: string, data: any) => void

type VectorizationItemLabel = NonNullable<
	VectorizationProgressEvent["currentItem"]
>

/**
 * One embedding job.
 *
 * The lane's `LaneItem` with this lane's label union pinned, and `id` kept as a
 * top-level field because four existing tests and the item-updated socket
 * payload read it there. `ref.source` is deliberately the same string as
 * `label.type` — that vocabulary is also `RAG_INDEX_SOURCES`, which is what
 * lets `scopedMissingVectors` name a missing row and `specific()` find it again.
 */
type QueueItem = Omit<LaneItem, "label" | "modelId"> & {
	label: VectorizationItemLabel
	id: number
	embeddingModel: string
	modelId: string
}

/** `QueueItem`, assembled so `ref`, `id` and `label.type` cannot disagree. */
function queueItem(args: {
	type: VectorizationItemLabel["type"]
	label: string
	id: number
	lorebookId?: number
	currentModel: string
	process: () => Promise<void>
}): QueueItem {
	return {
		ref: { source: args.type, id: args.id },
		label: { type: args.type, label: args.label },
		id: args.id,
		lorebookId: args.lorebookId,
		embeddingModel: args.currentModel,
		modelId: args.currentModel,
		process: args.process
	}
}

export type VectorizationItemUpdatedEvent = {
	type: NonNullable<VectorizationProgressEvent["currentItem"]>["type"]
	id: number
	lorebookId?: number
	embeddingModel: string
	vectorizedAt: string
}

// ---------------------------------------------------------------------------
// The lane
// ---------------------------------------------------------------------------

/**
 * The embedding model, spoken for.
 *
 * **Constraint 1's seam.** The lane never calls a loader; it calls this. When
 * the admin *Servers* pages arrive, an arbiter deciding which models may be
 * resident together replaces this object and the loop is untouched.
 *
 * `peek()` is the pre-load identity — `getConfiguredModelId()` is verified
 * byte-identical to the post-load id in both modes — so the lane can ask
 * "is there anything to embed?" without paying a load cost for the answer.
 */
export const embeddingBroker: LaneModelBroker = {
	get spec() {
		return {
			role: "embedding",
			/**
			 * Constraint 4's TTL, read where it is stored rather than copied
			 * into a constant here. Synchronous because `spec` is a
			 * declaration an admin surface reads; the authoritative value is
			 * applied by `loadConfiguredEmbeddingModel()` at load time, which
			 * is the only moment it can act on anything.
			 */
			ttlMinutes: lastKnownTtlMinutes
		}
	},
	async peek() {
		const modelId = await getConfiguredModelId()
		if (!modelId)
			return {
				kind: "unconfigured",
				reason: "no embedding model is configured, or embedding is switched off"
			}
		return { kind: "configured", modelId }
	},
	async request(opts): Promise<ModelLease> {
		const loaded = getLoadedModelId()
		if (isModelReady() && loaded)
			return { kind: "resident", modelId: loaded }

		if (!opts?.wait) {
			/**
			 * Constraint 3, at the only call site where it bites. A promotion
			 * runs inside a turn and a first-ever local model load is a
			 * download; waiting for it here would stall the reply for minutes.
			 * So the load is *started* and the answer is `pending` — the lane
			 * degrades this turn with a receipt line and the background pass
			 * uses what this warmed.
			 */
			if (!isModelLoading())
				void loadConfiguredEmbeddingModel().catch((err) => {
					console.error(
						"[vectorization] Failed to auto-load model:",
						err
					)
				})
			return {
				kind: "pending",
				modelId: null,
				reason: "the embedding model is not resident yet — it has been requested"
			}
		}

		try {
			// Branches on the starred connection's TYPE to load the local
			// pipeline or activate the right host adapter, and sets the TTL
			// from the connection before loading so the idle timer starts
			// correctly.
			await loadConfiguredEmbeddingModel()
		} catch (err) {
			return {
				kind: "unavailable",
				modelId: null,
				reason:
					err instanceof Error
						? `the embedding model failed to load: ${err.message}`
						: "the embedding model failed to load"
			}
		}
		const after = getLoadedModelId()
		if (!isModelReady() || !after)
			return {
				kind: "unavailable",
				modelId: null,
				reason: "embedding is switched off, or the backend did not come up"
			}
		return { kind: "resident", modelId: after }
	}
}

/**
 * The TTL last read out of `vectorization_configs`, so `spec` can answer
 * synchronously.
 *
 * Refreshed by `refreshEmbeddingLaneTtl()` below rather than cached forever —
 * a declaration that lies about the configured value is worse than no
 * declaration. The number the model actually runs on is always the one
 * `loadConfiguredEmbeddingModel()` applies; this is the reporting copy.
 */
let lastKnownTtlMinutes = 5

/** Re-read the lane's TTL from its config. Called by the periodic scan. */
export async function refreshEmbeddingLaneTtl(): Promise<number> {
	try {
		const target = await getConfiguredEmbeddingTarget()
		if (target) lastKnownTtlMinutes = target.ttlMinutes
	} catch {
		// A broken API config throws here; the TTL declaration is not the
		// place to surface that. The loader still does, on a real load.
	}
	return lastKnownTtlMinutes
}

/**
 * Where the lane's work comes from.
 *
 * `fromGroup` and `global` are the two orders this queue has always had.
 * `specific` is new and is what makes promotion possible without a second
 * synchronous path: given one row's identity it returns the *same* item the
 * background sweep would have produced for it, or `null` when the row needs no
 * work — which is also how a promotion of forty already-fresh rows costs forty
 * cheap queries and no embeddings.
 */
const embeddingWork: LaneWorkSource = {
	async fromGroup(group, modelId) {
		if (!modelId) return null
		return pickFromGroup(group, modelId)
	},
	async global(modelId) {
		if (!modelId) return null
		return pickGlobalNextItem(modelId)
	},
	async specific(ref, modelId) {
		if (!modelId) return null
		switch (ref.source) {
			case "message":
				return pickSessionMessage(modelId, undefined, ref.id)
			case "worldLore":
				return pickWorldLoreEntry(modelId, undefined, ref.id)
			case "characterLore":
				return pickCharacterLoreEntry(modelId, undefined, ref.id)
			case "historyEntry":
				return pickHistoryEntry(modelId, undefined, ref.id)
			case "narrativeNode":
				return pickNarrativeNode(modelId, undefined, ref.id)
			case "narrativeRelationship":
				return pickNarrativeRelationship(modelId, undefined, ref.id)
			case "character":
				return pickCharacter(modelId, undefined, ref.id)
			default:
				return null
		}
	}
}

/**
 * Whether the embedding lane indexes at all.
 *
 * ⚠ **The star IS the switch.** Embeddings are on when something is registered
 * for `text->embedding` in `connection_defaults`, and off when nothing is — one
 * fact, one row, so unstarring or deleting the connection turns the lane off by
 * itself. A stored boolean beside it would be "on" and "which endpoint" as two
 * values that can contradict each other, which every handler would then have to
 * keep in step.
 */
async function isVectorizationEnabled(): Promise<boolean> {
	return embeddingsEnabled(db)
}

export const embeddingLane = registerLane(
	new IndexingLane({
		key: "embedding",
		label: "embedding",
		model: embeddingBroker,
		work: embeddingWork,
		isEnabled: isVectorizationEnabled,
		/**
		 * Constraint 4's autostart. Always on for this lane today — there is no
		 * stored control for it and inventing one would be a knob nothing sets
		 * — but it is a per-lane resolver rather than a hardcoded `true` inside
		 * the loop, which is the part that has to be true for the admin surface
		 * to be able to set it later.
		 */
		autostart: async () => true,
		progressEvent: "vectorization:progress",
		itemEvent: {
			name: "vectorization:itemUpdated",
			/**
			 * Per-item DB rows get their embedding/vectorizedAt updated inside
			 * process(), but nothing otherwise tells connected clients which
			 * specific item changed — the per-item "vectorized/stale" badges in
			 * list UIs only refreshed on the next explicit CRUD action.
			 */
			payload: (item): VectorizationItemUpdatedEvent => ({
				type: (item as QueueItem).label.type,
				id: (item as QueueItem).id,
				lorebookId: item.lorebookId,
				embeddingModel: (item as QueueItem).embeddingModel,
				vectorizedAt: new Date().toISOString()
			})
		}
	})
)

// ---------------------------------------------------------------------------
// Public control API
// ---------------------------------------------------------------------------

export function registerProgressEmitter(fn: EmitFn) {
	embeddingLane.registerEmitter(fn)
}

export function unregisterProgressEmitter(fn: EmitFn) {
	embeddingLane.unregisterEmitter(fn)
}

export function pauseVectorization() {
	embeddingLane.pause()
}

export function resumeVectorization() {
	embeddingLane.resume()
}

export function stopVectorization() {
	embeddingLane.stop()
}

export function isVectorizationRunning() {
	return embeddingLane.isRunning()
}

/** Exported so a config change that could fix a previously-failing item
 * (e.g. correcting the embedding API endpoint) doesn't leave it excluded
 * until the next full restart — see vectorization.ts's setApiConfig/
 * setModel handlers. */
export function clearVectorizationFailureTracking() {
	embeddingLane.clearFailureTracking()
}

export async function startVectorizationQueue(opts?: {
	startFromBeginning?: boolean
}) {
	if (embeddingLane.isRunning()) return
	if (opts?.startFromBeginning) embeddingLane.resetCompleted()
	embeddingLane.clearFailureTracking()
	embeddingLane.start()
}

const PERIODIC_SCAN_INTERVAL_MS = 15 * 60 * 1000

let scanTimer: ReturnType<typeof setInterval> | null = null

/**
 * Periodically (re-)triggers the queue so missing/stale embeddings get
 * picked up even without a reactive create/update trigger or a manual
 * "Start Queue" click — e.g. after a server restart with a backlog already
 * present, or content that went stale for a reason unrelated to its own
 * create/update (a model switch, say). Deliberately does NOT load the
 * embedding model itself — the lane only requests residency (via
 * `embeddingBroker`, mode-aware) once a picker actually finds something to
 * embed, so an instance with nothing to do never pays any model-load cost,
 * on this timer or at boot.
 *
 * Call once at boot; the first tick runs immediately (that *is* the
 * boot-time trigger, not a separate code path) and every
 * PERIODIC_SCAN_INTERVAL_MS after. Idempotent — a second call is a no-op,
 * mirroring startVectorizationQueue()'s own isRunning guard, so this is
 * safe to call again if it's ever wired up somewhere other than boot.
 *
 * ⚠ Kept here rather than delegated to `IndexingLane.startPeriodicScan()`
 * because the enabled read *is* the observable proxy this lane's own tests
 * use for "a tick ran", and because the TTL declaration is refreshed on the
 * same tick — a lane-generic scan has no reason to know about either.
 */
export function startPeriodicVectorizationScan() {
	if (scanTimer) return
	const tick = async () => {
		try {
			if (await embeddingsEnabled(db)) {
				void refreshEmbeddingLaneTtl()
				await startVectorizationQueue()
			}
		} catch (err) {
			console.error("[vectorization] Periodic scan tick failed:", err)
		}
	}
	void tick()
	scanTimer = setInterval(tick, PERIODIC_SCAN_INTERVAL_MS).unref()
}

// ---------------------------------------------------------------------------
// Priority queue API
// ---------------------------------------------------------------------------

export function getPriorityQueue(): PriorityGroup[] {
	return embeddingLane.snapshotGroups()
}

export function getCompletedHistory(): CompletedGroup[] {
	return embeddingLane.snapshotHistory()
}

/**
 * Enqueue a session and all its associated content (lorebooks, characters, personas)
 * at the front of the priority queue. If the session is already in the queue, it is
 * moved to the front. Starts the queue if it isn't already running.
 */
export async function enqueueSessionGroup(
	sessionId: number
): Promise<PriorityGroup> {
	const session = await db.query.sessions.findFirst({
		where: eq(schema.sessions.id, sessionId),
		columns: { id: true, name: true, lorebookId: true, userId: true }
	})

	if (!session) throw new Error(`Session ${sessionId} not found`)

	const [sessionCharsRows, sessionPersonasRows] = await Promise.all([
		db
			.select({
				characterId: schema.sessionCharacters.characterId,
				charLorebookId: schema.characters.lorebookId
			})
			.from(schema.sessionCharacters)
			.leftJoin(
				schema.characters,
				eq(schema.sessionCharacters.characterId, schema.characters.id)
			)
			.where(eq(schema.sessionCharacters.sessionId, sessionId)),
		db
			.select({ personaId: schema.sessionPersonas.personaId })
			.from(schema.sessionPersonas)
			.where(eq(schema.sessionPersonas.sessionId, sessionId))
	])

	const lorebookIds: number[] = []
	if (session.lorebookId) lorebookIds.push(session.lorebookId)

	const characterIds: number[] = []
	for (const cc of sessionCharsRows) {
		if (cc.characterId) characterIds.push(cc.characterId)
		if (cc.charLorebookId && !lorebookIds.includes(cc.charLorebookId)) {
			lorebookIds.push(cc.charLorebookId)
		}
	}

	const personaIds: number[] = []
	for (const cp of sessionPersonasRows) {
		if (cp.personaId) personaIds.push(cp.personaId)
	}

	const owner = await db.query.users.findFirst({
		where: eq(schema.users.id, session.userId),
		columns: { username: true, displayName: true }
	})
	const ownerDisplayName = owner?.displayName ?? owner?.username ?? "Unknown"

	// Remove any existing group for this session, then prepend.
	const group = embeddingLane.enqueueGroup(
		{
			label: session.name ?? `Session #${sessionId}`,
			ownerDisplayName,
			sessionId,
			lorebookIds,
			characterIds,
			personaIds
		},
		(g) => g.sessionId === sessionId
	)

	// Force-start, as an explicit operation rather than a side effect of
	// enqueueing (constraint 4). The lane's own guard makes it idempotent.
	if (!embeddingLane.isPaused()) embeddingLane.start()

	return group
}

/**
 * Enqueue a lorebook (and only its entries) at the front of the queue.
 */
export function enqueueLorebookGroup(
	lorebookId: number,
	label: string,
	ownerDisplayName: string
): PriorityGroup {
	// Remove existing standalone group for this lorebook
	const group = embeddingLane.enqueueGroup(
		{
			label,
			ownerDisplayName,
			lorebookIds: [lorebookId],
			characterIds: [],
			personaIds: []
		},
		(g) =>
			g.lorebookIds.includes(lorebookId) &&
			!g.sessionId &&
			g.characterIds.length === 0
	)

	if (!embeddingLane.isPaused()) embeddingLane.start()
	return group
}

/**
 * Enqueue a character (and its own lorebook if any) at the front of the queue.
 */
export async function enqueueCharacterGroup(
	characterId: number,
	name: string
): Promise<PriorityGroup> {
	const char = await db.query.characters.findFirst({
		where: eq(schema.characters.id, characterId),
		columns: { lorebookId: true, userId: true }
	})

	const owner = await db.query.users.findFirst({
		where: eq(schema.users.id, char!.userId),
		columns: { username: true, displayName: true }
	})
	const ownerDisplayName = owner?.displayName ?? owner?.username ?? "Unknown"

	// Remove existing standalone group for this character
	const group = embeddingLane.enqueueGroup(
		{
			label: name,
			ownerDisplayName,
			lorebookIds: char?.lorebookId ? [char.lorebookId] : [],
			characterIds: [characterId],
			personaIds: []
		},
		(g) => g.characterIds.includes(characterId) && !g.sessionId
	)

	if (!embeddingLane.isPaused()) embeddingLane.start()
	return group
}

// ⚠ There is no persona enqueue: a persona is a character, so
// `enqueueCharacterGroup` above is the one standalone enqueue.

export function moveQueueGroup(
	groupId: string,
	direction: "up" | "down"
): void {
	embeddingLane.moveGroup(groupId, direction)
}

export function removeQueueGroup(groupId: string): void {
	embeddingLane.removeGroup(groupId)
}

// ---------------------------------------------------------------------------
// Item picking
// ---------------------------------------------------------------------------

/**
 * A row needs (re-)embedding if:
 *   - embedding IS NULL  (never embedded), OR
 *   - embeddingModel != currentModel  (stale from a previous model), OR
 *   - vectorizedAt IS NOT NULL AND updatedAt > vectorizedAt  (content changed since last embedding)
 *
 * The third condition is only applied when both timestamp columns are provided.
 * Rows that pre-date the vectorizedAt column (vectorizedAt IS NULL but embedding IS NOT NULL)
 * are treated as current — we rely on explicit embedding clearing in update handlers for those.
 */
function needsEmbedding(
	embeddingCol: any,
	modelCol: any,
	currentModel: string,
	updatedAtCol?: any,
	vectorizedAtCol?: any
) {
	const base = or(isNull(embeddingCol), ne(modelCol, currentModel))
	if (updatedAtCol && vectorizedAtCol) {
		// Re-embed if content changed after the last vectorization (both timestamps must be set)
		return or(
			base,
			and(isNotNull(vectorizedAtCol), gt(updatedAtCol, vectorizedAtCol))
		)
	}
	return base
}

/**
 * The join onto an entry's default-space vector.
 *
 * A `LEFT JOIN` and not an `EXISTS`, because the staleness predicate reads the
 * vector's own `model` and `vectorized_at`, and the pickers want the same
 * shape as the counts.
 */
const defaultVectorJoin = and(
	eq(schema.lorebookEntryVectors.entryId, schema.lorebookEntries.id),
	eq(schema.lorebookEntryVectors.vectorName, DEFAULT_VECTOR_NAME),
	eq(schema.lorebookEntryVectors.chunkIndex, 0)
)!

/**
 * `needsEmbedding`, read across the join instead of down a row.
 *
 * Clause for clause the same predicate: no vector at all replaces
 * `embedding IS NULL`, the vector's model replaces the row's, and the
 * timestamp comparison is the entry's `updated_at` against the *vector's*
 * `vectorized_at`.
 *
 * ⚠ A vector with a NULL `model` is deliberately **not** picked up, which is
 * what `ne(model, current)` already did: `NULL <> 'x'` is NULL, not true. The
 * backfill carried such vectors from rows whose `embedding_model` was NULL, and
 * they were unpickable before this table existed for exactly the same reason.
 */
const entryNeedsEmbedding = (currentModel: string) =>
	or(
		isNull(schema.lorebookEntryVectors.entryId),
		ne(schema.lorebookEntryVectors.model, currentModel),
		and(
			isNotNull(schema.lorebookEntryVectors.vectorizedAt),
			gt(
				schema.lorebookEntries.updatedAt,
				schema.lorebookEntryVectors.vectorizedAt
			)
		)
	)

/**
 * `writeEmbeddingIfFresh` for an entry, whose vector is a row of its own.
 *
 * The optimistic-concurrency guard is unchanged in meaning — the entry's
 * `updated_at`, compared as text for the precision reason above — and it moves
 * into the `INSERT … SELECT`'s `WHERE`, so an entry edited while `embed()` was
 * in flight selects nothing and writes nothing.
 *
 * ⚠ The self-pinned `updatedAt` that `writeEmbeddingIfFresh`
 * needs has no counterpart here, and needs none: this statement does not touch
 * the entry row at all, so drizzle's `$onUpdate` never fires and vectorizing
 * can no longer be mistaken for an edit. That is the circular-staleness bug the
 * separate vector table exists to close.
 */
export async function writeEntryVectorIfFresh(
	id: number,
	capturedUpdatedAtRaw: string,
	currentModel: string,
	vector: number[]
): Promise<void> {
	if (getLoadedModelId() !== currentModel) return
	// ⚠ The vector goes in as a Postgres array *literal*, not as a JS array:
	// drizzle interpolates an array parameter as a record — `(1,2,3)` — and
	// `record` does not cast to `real[]`. Every element is a finite float by
	// construction (an embedding), so `{…}` needs no quoting; a non-finite one
	// would be a broken embedding rather than a value to store.
	const literal = `{${vector.map((n) => (Number.isFinite(n) ? n : 0)).join(",")}}`
	await db.execute(sql`
		INSERT INTO "lorebook_entry_vectors"
			("entry_id", "vector_name", "chunk_index", "model", "dims", "vector", "vectorized_at")
		SELECT e."id", ${DEFAULT_VECTOR_NAME}, 0, ${currentModel},
		       ${vector.length}, ${literal}::real[], now()
		FROM "lorebook_entries" e
		WHERE e."id" = ${id} AND e."updated_at"::text = ${capturedUpdatedAtRaw}
		ON CONFLICT ("entry_id", "vector_name", "chunk_index") DO UPDATE SET
			"model" = EXCLUDED."model",
			"model_version" = NULL,
			"normalization" = NULL,
			"dims" = EXCLUDED."dims",
			"vector" = EXCLUDED."vector",
			"source_hash" = NULL,
			"vectorized_at" = EXCLUDED."vectorized_at"
	`)
}

/**
 * The lane's round-robin pick, kept as a module function for its callers.
 *
 * Exported only so tests can exercise the fairness logic directly — the real
 * caller is the lane's loop, through `embeddingWork`.
 *
 * `modelIdOverride` lets a caller check for pending work against a model that
 * is not resident yet (the lane's peek, using `getConfiguredModelId()`'s
 * pre-load candidate) — it defaults to the loaded model's id, the original and
 * still normal once-resident behaviour.
 */
export async function pickNextItem(
	modelIdOverride?: string
): Promise<QueueItem | null> {
	const currentModel = modelIdOverride ?? getLoadedModelId()
	if (!currentModel) return null
	return (await embeddingLane.pickNext(currentModel)) as QueueItem | null
}

async function pickFromGroup(
	group: PriorityGroup,
	currentModel: string
): Promise<QueueItem | null> {
	// 1. Session messages
	if (group.sessionId) {
		const item = await pickSessionMessage(currentModel, group.sessionId)
		if (item) return item
	}

	// 2. Lorebook content (world lore → character lore → history entries → narrative graph)
	for (const lorebookId of group.lorebookIds) {
		const wle = await pickWorldLoreEntry(currentModel, lorebookId)
		if (wle) return wle

		const cle = await pickCharacterLoreEntry(currentModel, lorebookId)
		if (cle) return cle

		const he = await pickHistoryEntry(currentModel, lorebookId)
		if (he) return he

		const nn = await pickNarrativeNode(currentModel, lorebookId)
		if (nn) return nn

		const nr = await pickNarrativeRelationship(currentModel, lorebookId)
		if (nr) return nr
	}

	// 3. Characters
	if (group.characterIds.length > 0) {
		const char = await pickCharacter(currentModel, group.characterIds)
		if (char) return char
	}

	// 4. The characters this session's users voice. A separate list from the
	// cast above over the same table — a row already picked as cast is
	// embedded by the time this runs, so the staleness filter skips it.
	if (group.personaIds.length > 0) {
		const persona = await pickCharacter(currentModel, group.personaIds)
		if (persona) return persona
	}

	return null
}

async function pickGlobalNextItem(
	currentModel: string
): Promise<QueueItem | null> {
	return (
		(await pickSessionMessage(currentModel)) ??
		(await pickWorldLoreEntry(currentModel)) ??
		(await pickCharacterLoreEntry(currentModel)) ??
		(await pickHistoryEntry(currentModel)) ??
		(await pickNarrativeNode(currentModel)) ??
		(await pickNarrativeRelationship(currentModel)) ??
		(await pickCharacter(currentModel)) ??
		null
	)
}

// ---------------------------------------------------------------------------
// Per-type pickers (optional scope filters)
// ---------------------------------------------------------------------------

/**
 * Optimistic-concurrency + model-freshness guarded write, shared by every
 * pick* function's process() closure below. Two races this closes:
 *  - Edit-during-embed: if the row changed after it was read (compared via
 *    updatedAtRaw, captured as text — see the precision note below), the
 *    write is silently dropped; needsEmbedding()'s existing staleness check
 *    already ensures the row gets correctly re-picked next iteration.
 *  - Backend-switch mid-flight: if the active embedding model changed while
 *    embed() was in flight, skip the write entirely — otherwise a vector
 *    computed under the new model gets mislabeled as belonging to the old
 *    one.
 *
 * updatedAt is compared as text, not as a JS Date, on purpose: these
 * timestamp columns have no explicit precision, so Postgres stores them at
 * microsecond resolution, but Drizzle's default "date" mode reads them back
 * as a millisecond-precision JS Date — round-tripping the captured value
 * through that would silently truncate it, so a row that was inserted via
 * defaultNow() and never since edited would never match on comparison,
 * permanently blocking its embedding from persisting.
 */
export async function writeEmbeddingIfFresh(
	table: any,
	idCol: any,
	updatedAtCol: any,
	id: number,
	capturedUpdatedAtRaw: string,
	currentModel: string,
	vector: number[]
): Promise<void> {
	if (getLoadedModelId() !== currentModel) return
	await db
		.update(table)
		.set({
			embedding: vector,
			embeddingModel: currentModel,
			vectorizedAt: new Date(),
			/**
			 * Pinned to itself so this write does not count as an edit.
			 *
			 * Every one of these tables declares
			 * `updatedAt: ...$onUpdate(() => new Date())`, which drizzle applies
			 * to *any* update on the row — including this one. That made
			 * vectorizing bump `updatedAt`, and the bump is a second, separate
			 * `new Date()` from the `vectorizedAt` above: whenever the two
			 * straddle a millisecond boundary the row lands with
			 * `updated_at > vectorized_at`, which is exactly `needsEmbedding`'s
			 * "content changed since we vectorized" condition. The queue then
			 * picks the row straight back up and embeds it again — measured at
			 * roughly 1% of writes, and on a paid embedding API that is a silent
			 * double charge on one row in a hundred.
			 *
			 * Self-assignment keeps the stored value exactly, and an explicit
			 * value in `.set()` is what stops drizzle substituting `$onUpdate`'s.
			 * Semantically it is also the correct answer on its own: computing an
			 * embedding is not a modification of the content, and `updatedAt` is
			 * read as a content timestamp elsewhere (the recency signals in
			 * `pipelines/ranking/weights.ts` among them).
			 */
			updatedAt: sql`${updatedAtCol}`
		})
		.where(
			and(
				eq(idCol, id),
				sql`${updatedAtCol}::text = ${capturedUpdatedAtRaw}`
			)
		)
}

async function pickSessionMessage(
	currentModel: string,
	sessionId?: number,
	onlyId?: number
): Promise<QueueItem | null> {
	const staleness = needsEmbedding(
		schema.sessionMessages.embedding,
		schema.sessionMessages.embeddingModel,
		currentModel,
		schema.sessionMessages.updatedAt,
		schema.sessionMessages.vectorizedAt
	)
	const where = and(
		sessionId ? eq(schema.sessionMessages.sessionId, sessionId) : undefined,
		onlyId ? eq(schema.sessionMessages.id, onlyId) : undefined,
		staleness
	)

	const rows = await db
		.select({
			id: schema.sessionMessages.id,
			content: schema.sessionMessages.content,
			updatedAtRaw: sql<string>`${schema.sessionMessages.updatedAt}::text`
		})
		.from(schema.sessionMessages)
		.where(where)
		.orderBy(
			desc(schema.sessionMessages.sessionId),
			asc(schema.sessionMessages.id)
		)
		.limit(1)

	if (!rows.length) return null
	const { id, content, updatedAtRaw } = rows[0]
	return queueItem({
		type: "message",
		label: `Session message #${id}`,
		id,
		currentModel,
		process: async () => {
			const vector = await embed(truncateForEmbedding(content))
			await writeEmbeddingIfFresh(
				schema.sessionMessages,
				schema.sessionMessages.id,
				schema.sessionMessages.updatedAt,
				id,
				updatedAtRaw,
				currentModel,
				vector
			)
		}
	})
}

// ensureSessionMessageEmbedded() is awaited from inside runGenerateAndPersist()
// (generateResponse.ts) — itself llmQueue's execute() callback, and llmQueue
// has a single global lane (llmQueue.ts:85), so only one generation runs at
// a time, server-wide. That makes a hung embed() call here worse than any
// existing caller (e.g. RagInfillEngine's query-time batchEmbed(), which
// only blocks the one generation that triggered it): it would stall every
// other user's queued session generation too. The two constants below guard
// two different things:
//   - INLINE_EMBED_TIMEOUT_MS bounds how long ONE call waits on embed()
//     before giving up (embed()/batchEmbed() in embedding/index.ts have no
//     timeout of their own — a general fix belongs there, for every caller,
//     and is out of scope here).
//   - INLINE_EMBED_COOLDOWN_MS bounds how often a genuinely wedged backend
//     gets retried at all. Without it, every subsequent round-robin turn
//     would independently pay the full timeout again — a 4-character round
//     becomes 4x INLINE_EMBED_TIMEOUT_MS of added stall, repeated every
//     round, indefinitely. A timeout (not a normal embed() rejection, e.g.
//     an auth error, which shouldn't silence this) instead suppresses
//     further attempts until the cooldown elapses, degrading to "inline
//     embedding is off, the background queue catches up later."
const INLINE_EMBED_TIMEOUT_MS = 10_000
const INLINE_EMBED_COOLDOWN_MS = 60_000
let inlineEmbedDisabledUntil = 0

/** Exported so a corrected embedding config (see vectorization.ts's
 * setApiConfig/setModel handlers, which already do the same for
 * clearVectorizationFailureTracking()) doesn't leave inline embedding
 * suppressed until the cooldown happens to elapse on its own — and so
 * tests can isolate cases without leaking cooldown state between them. */
export function clearInlineEmbedCooldown() {
	inlineEmbedDisabledUntil = 0
}

class InlineEmbedTimeoutError extends Error {}

/**
 * Doesn't cancel the underlying call — embed()/batchEmbed() accept no
 * AbortSignal, so there's nothing to cancel — it only stops waiting for it.
 * `promise.catch(() => {})` attaches a handler directly to the original,
 * abandoned promise so a rejection that arrives after the timeout has
 * already won the race (e.g. the API client's own eventual socket error)
 * can't surface as an unhandled rejection. Deliberately NOT
 * `Promise.race([promise.catch(() => {}), timeout])` — racing a *derived*
 * catch-copy would resolve that branch to `undefined` on a genuine
 * pre-timeout rejection instead of propagating it, silently writing a
 * garbage embedding. The no-op catch must sit on a copy that is never
 * itself raced; `promise` (the original) is still what's raced below.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	promise.catch(() => {})
	let timer!: ReturnType<typeof setTimeout>
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new InlineEmbedTimeoutError("Inline embed timed out")),
			ms
		)
	})
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Ensures one specific session message has a current embedding — embedding and
 * saving it inline if missing/stale, or no-op'ing immediately if it's
 * already up to date (or the model isn't currently loaded). Called from
 * generateResponse.ts, awaited right after a generated message's final
 * content is persisted, so the very next round-robin turn's RAG retrieval
 * can find it as a candidate instead of only the background queue
 * eventually getting to it.
 *
 * Reuses the exact staleness predicate (needsEmbedding) and safe write
 * (writeEmbeddingIfFresh) the background queue itself uses for this row, so
 * this is safe to call even while the queue is concurrently running: if the
 * queue's pickSessionMessage() happens to grab the same row at nearly the same
 * time, both compute the same vector for the same content and both writes
 * land harmlessly; if the queue gets there first, this query simply finds
 * nothing stale left to do. writeEmbeddingIfFresh's optimistic-concurrency
 * guard is what prevents either from clobbering a genuine concurrent edit.
 */
export async function ensureSessionMessageEmbedded(
	messageId: number
): Promise<void> {
	if (!isModelReady()) return
	if (Date.now() < inlineEmbedDisabledUntil) return
	// Non-null assertion is safe: isModelReady() (embedding/index.ts) already
	// requires loadedModelId !== null for both the "local" and "api" backend
	// branches, and nothing async happens between that check and this read —
	// JS run-to-completion means nothing (incl. a TTL unload timer) can run
	// in between. Do NOT insert an await between the checks above and this
	// line — that would reopen the window this relies on. writeEmbeddingIfFresh's
	// own model-freshness guard is a second, independent backstop regardless.
	const currentModel = getLoadedModelId()!

	const staleness = needsEmbedding(
		schema.sessionMessages.embedding,
		schema.sessionMessages.embeddingModel,
		currentModel,
		schema.sessionMessages.updatedAt,
		schema.sessionMessages.vectorizedAt
	)

	const rows = await db
		.select({
			id: schema.sessionMessages.id,
			content: schema.sessionMessages.content,
			updatedAtRaw: sql<string>`${schema.sessionMessages.updatedAt}::text`
		})
		.from(schema.sessionMessages)
		.where(and(eq(schema.sessionMessages.id, messageId), staleness))
		.limit(1)

	if (!rows.length) return // already fresh (or row gone) — nothing to do
	const { id, content, updatedAtRaw } = rows[0]

	let vector: number[]
	try {
		vector = await withTimeout(
			embed(truncateForEmbedding(content)),
			INLINE_EMBED_TIMEOUT_MS
		)
	} catch (err) {
		if (err instanceof InlineEmbedTimeoutError) {
			inlineEmbedDisabledUntil = Date.now() + INLINE_EMBED_COOLDOWN_MS
		}
		throw err
	}

	await writeEmbeddingIfFresh(
		schema.sessionMessages,
		schema.sessionMessages.id,
		schema.sessionMessages.updatedAt,
		id,
		updatedAtRaw,
		currentModel,
		vector
	)
}

/**
 * The three entry pickers, as one.
 *
 * They read the same rows of the same table now, so what used to be three
 * near-identical blocks is one parameterised by the declared type, the label
 * the progress event carries, and whether the embed text is prefixed with a
 * title. That last one is the only real difference between them, and it is what
 * the type's `embedText` role declares: `[title, content]` for the two lore
 * shapes, `[content]` for history, which has no title to prepend.
 */
async function pickEntry(
	typeId: string,
	labelType: VectorizationItemLabel["type"],
	labelFor: (row: { id: number; title: string | null }) => string,
	withTitle: boolean,
	currentModel: string,
	lorebookId?: number,
	onlyId?: number
): Promise<QueueItem | null> {
	const where = and(
		eq(schema.lorebookEntries.typeId, typeId),
		lorebookId
			? eq(schema.lorebookEntries.lorebookId, lorebookId)
			: undefined,
		onlyId ? eq(schema.lorebookEntries.id, onlyId) : undefined,
		entryNeedsEmbedding(currentModel)
	)

	const rows = await db
		.select({
			id: schema.lorebookEntries.id,
			content: schema.lorebookEntries.content,
			title: schema.lorebookEntries.title,
			lorebookId: schema.lorebookEntries.lorebookId,
			updatedAtRaw: sql<string>`${schema.lorebookEntries.updatedAt}::text`
		})
		.from(schema.lorebookEntries)
		.leftJoin(schema.lorebookEntryVectors, defaultVectorJoin)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const {
		id,
		content,
		title,
		lorebookId: rowLorebookId,
		updatedAtRaw
	} = rows[0]
	// `title ? title + "\n" + content : content` — the type's `embedText` role
	// spelled out: `[title, content]` for the two lore shapes, `[content]` for
	// history, which has no title to prepend.
	const text = withTitle && title ? `${title}\n${content}` : content
	return queueItem({
		type: labelType,
		label: labelFor({ id, title }),
		id,
		lorebookId: rowLorebookId,
		currentModel,
		process: async () => {
			const vector = await embed(truncateForEmbedding(text))
			await writeEntryVectorIfFresh(
				id,
				updatedAtRaw,
				currentModel,
				vector
			)
		}
	})
}

const pickWorldLoreEntry = (
	currentModel: string,
	lorebookId?: number,
	onlyId?: number
) =>
	pickEntry(
		WORLD_LORE_TYPE_ID,
		"worldLore",
		(r) => `World lore: ${r.title || r.id}`,
		true,
		currentModel,
		lorebookId,
		onlyId
	)

const pickCharacterLoreEntry = (
	currentModel: string,
	lorebookId?: number,
	onlyId?: number
) =>
	pickEntry(
		CHARACTER_LORE_TYPE_ID,
		"characterLore",
		(r) => `Character lore: ${r.title || r.id}`,
		true,
		currentModel,
		lorebookId,
		onlyId
	)

const pickHistoryEntry = (
	currentModel: string,
	lorebookId?: number,
	onlyId?: number
) =>
	pickEntry(
		HISTORY_TYPE_ID,
		"historyEntry",
		(r) => `History entry #${r.id}`,
		false,
		currentModel,
		lorebookId,
		onlyId
	)

async function pickNarrativeNode(
	currentModel: string,
	lorebookId?: number,
	onlyId?: number
): Promise<QueueItem | null> {
	const staleness = needsEmbedding(
		schema.lorebookBindings.embedding,
		schema.lorebookBindings.embeddingModel,
		currentModel,
		schema.lorebookBindings.updatedAt,
		schema.lorebookBindings.vectorizedAt
	)
	const where = and(
		lorebookId
			? eq(schema.lorebookBindings.lorebookId, lorebookId)
			: undefined,
		onlyId ? eq(schema.lorebookBindings.id, onlyId) : undefined,
		staleness
	)

	const rows = await db
		.select({
			id: schema.lorebookBindings.id,
			name: schema.lorebookBindings.name,
			summary: schema.lorebookBindings.summary,
			lorebookId: schema.lorebookBindings.lorebookId,
			updatedAtRaw: sql<string>`${schema.lorebookBindings.updatedAt}::text`
		})
		.from(schema.lorebookBindings)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const {
		id,
		name,
		summary,
		lorebookId: rowLorebookId,
		updatedAtRaw
	} = rows[0]
	const text = summary ? `${name}\n${summary}` : name
	return queueItem({
		type: "narrativeNode",
		label: `Narrative node: ${name}`,
		id,
		lorebookId: rowLorebookId,
		currentModel,
		process: async () => {
			const vector = await embed(truncateForEmbedding(text))
			await writeEmbeddingIfFresh(
				schema.lorebookBindings,
				schema.lorebookBindings.id,
				schema.lorebookBindings.updatedAt,
				id,
				updatedAtRaw,
				currentModel,
				vector
			)
		}
	})
}

async function pickNarrativeRelationship(
	currentModel: string,
	lorebookId?: number,
	onlyId?: number
): Promise<QueueItem | null> {
	const staleness = needsEmbedding(
		schema.narrativeRelationships.embedding,
		schema.narrativeRelationships.embeddingModel,
		currentModel,
		schema.narrativeRelationships.updatedAt,
		schema.narrativeRelationships.vectorizedAt
	)
	const where = and(
		lorebookId
			? eq(schema.narrativeRelationships.lorebookId, lorebookId)
			: undefined,
		onlyId ? eq(schema.narrativeRelationships.id, onlyId) : undefined,
		// Cast edges only: the text embedded here is two binding names either
		// side of a type, which an edge with an entry end has no second name
		// for. Entry edges reach retrieval through the link hop instead.
		castEdgeOnly,
		staleness
	)

	const rows = await db
		.select({
			id: schema.narrativeRelationships.id,
			fromNodeId: schema.narrativeRelationships.fromNodeId,
			toNodeId: schema.narrativeRelationships.toNodeId,
			relationshipType: schema.narrativeRelationships.relationshipType,
			description: schema.narrativeRelationships.description,
			reason: schema.narrativeRelationships.reason,
			lorebookId: schema.narrativeRelationships.lorebookId,
			updatedAtRaw: sql<string>`${schema.narrativeRelationships.updatedAt}::text`
		})
		.from(schema.narrativeRelationships)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	// `castEdgeOnly` above already excluded the entry-endpoint rows; this is the
	// same rule at the type level, so the two ids below are ids.
	if (!isCastEdge(rows[0])) return null
	const {
		id,
		fromNodeId,
		toNodeId,
		relationshipType,
		description,
		reason,
		lorebookId: rowLorebookId,
		updatedAtRaw
	} = rows[0]

	// Fetch node names for richer embedding text
	const [fromNode, toNode] = await Promise.all([
		db.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, fromNodeId),
			columns: { name: true }
		}),
		db.query.lorebookBindings.findFirst({
			where: eq(schema.lorebookBindings.id, toNodeId),
			columns: { name: true }
		})
	])

	const fromName = fromNode?.name ?? String(fromNodeId)
	const toName = toNode?.name ?? String(toNodeId)
	let text = `${fromName} ${relationshipType} ${toName}`
	if (description) text += `: ${description}`
	if (reason) text += `. ${reason}`

	return queueItem({
		type: "narrativeRelationship",
		label: `Narrative relationship: ${fromName} → ${toName}`,
		id,
		lorebookId: rowLorebookId,
		currentModel,
		process: async () => {
			const vector = await embed(truncateForEmbedding(text))
			await writeEmbeddingIfFresh(
				schema.narrativeRelationships,
				schema.narrativeRelationships.id,
				schema.narrativeRelationships.updatedAt,
				id,
				updatedAtRaw,
				currentModel,
				vector
			)
		}
	})
}

async function pickCharacter(
	currentModel: string,
	characterIds?: number[],
	onlyId?: number
): Promise<QueueItem | null> {
	if (characterIds !== undefined && characterIds.length === 0) return null

	const staleness = needsEmbedding(
		schema.characters.embedding,
		schema.characters.embeddingModel,
		currentModel,
		schema.characters.updatedAt,
		schema.characters.vectorizedAt
	)
	const where = and(
		characterIds && characterIds.length > 0
			? inArray(schema.characters.id, characterIds)
			: undefined,
		onlyId ? eq(schema.characters.id, onlyId) : undefined,
		staleness
	)

	const rows = await db
		.select({
			id: schema.characters.id,
			name: schema.characters.name,
			description: schema.characters.description,
			updatedAtRaw: sql<string>`${schema.characters.updatedAt}::text`
		})
		.from(schema.characters)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const { id, name, description, updatedAtRaw } = rows[0]
	const text = `${name}\n${description}`
	return queueItem({
		type: "character",
		label: `Character: ${name}`,
		id,
		currentModel,
		process: async () => {
			const vector = await embed(truncateForEmbedding(text))
			await writeEmbeddingIfFresh(
				schema.characters,
				schema.characters.id,
				schema.characters.updatedAt,
				id,
				updatedAtRaw,
				currentModel,
				vector
			)
		}
	})
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Count how many items still need embedding (null or wrong model) across all tables.
 * Pass the current model ID to also count stale rows from previous models.
 */
export async function countUnembedded(currentModel?: string): Promise<number> {
	const condition = (embeddingCol: any, modelCol: any) =>
		currentModel
			? needsEmbedding(embeddingCol, modelCol, currentModel)
			: isNull(embeddingCol)

	const counts = await Promise.all([
		db.$count(
			schema.sessionMessages,
			condition(
				schema.sessionMessages.embedding,
				schema.sessionMessages.embeddingModel
			)
		),
		// One count for all three entry types, because they are one table. The
		// no-current-model arm is `isNull(embedding)`'s equivalent: an entry
		// with no default-space vector at all.
		countUnembeddedEntries(currentModel),
		db.$count(
			schema.lorebookBindings,
			condition(
				schema.lorebookBindings.embedding,
				schema.lorebookBindings.embeddingModel
			)
		),
		db.$count(
			schema.narrativeRelationships,
			condition(
				schema.narrativeRelationships.embedding,
				schema.narrativeRelationships.embeddingModel
			)
		),
		db.$count(
			schema.characters,
			condition(
				schema.characters.embedding,
				schema.characters.embeddingModel
			)
		)
	])
	return counts.reduce((sum, n) => sum + Number(n), 0)
}

async function countUnembeddedEntries(currentModel?: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(schema.lorebookEntries)
		.leftJoin(schema.lorebookEntryVectors, defaultVectorJoin)
		.where(
			currentModel
				? entryNeedsEmbedding(currentModel)
				: isNull(schema.lorebookEntryVectors.entryId)
		)
	return Number(row?.n ?? 0)
}

// ---------------------------------------------------------------------------
// Eager promotion — the query-time half
// ---------------------------------------------------------------------------

/**
 * How many rows one eager promotion may name.
 *
 * The *scan* bound, above the lane's own item bound. Both exist because they
 * fail differently: naming ten thousand rows is expensive before a single one
 * is indexed, and indexing ten thousand rows is expensive after. Whatever the
 * scan leaves out is still picked up by the background sweep, which is the
 * whole point of promoting into the queue rather than beside it.
 */
export const PROMOTION_SCAN_CAP = 60

/**
 * The rows a session's semantic arm would search, that have no current vector.
 *
 * **The same scope and the same staleness identities the arm itself uses** —
 * `fetchScopedCandidates`'s filters (in-scope lorebooks, `enabled`, the
 * session's own channel, the recent window excluded) crossed with this file's
 * `needsEmbedding` / `entryNeedsEmbedding`. That is what makes the answer
 * *"missing from what this query will look at"* rather than *"unembedded
 * somewhere"*: `sourceHash`-equivalent staleness distinguishes a stale vector
 * from an absent one, and both are equally invisible to a search keyed on the
 * loaded model.
 *
 * **Ordered lore first, messages last, and that ordering is load-bearing.**
 * The lane's item bound cuts the tail, so whatever is at the front is what a
 * turn actually gets. A lorebook is tens of rows and each one is a candidate
 * the ranker may choose; a transcript is thousands of rows that the recent
 * window already carries verbatim, and letting a message backlog eat the bound
 * would starve the lore it exists for.
 */
export async function scopedMissingVectors(
	context: SessionRagContext,
	currentModel: string,
	opts: {
		limit?: number
		excludeRecentMessages?: number
		channel?: string
	} = {}
): Promise<LaneItemRef[]> {
	const limit = Math.max(0, opts.limit ?? PROMOTION_SCAN_CAP)
	if (limit === 0) return []
	const refs: LaneItemRef[] = []
	const room = () => limit - refs.length

	const push = (source: string, rows: Array<{ id: number }>) => {
		for (const row of rows) refs.push({ source, id: row.id })
	}

	/**
	 * Read defensively rather than destructured. A context is assembled
	 * elsewhere and this runs inside a turn, so a field that is not there has to
	 * mean "no rows of that kind in scope" — the governing rule's *subtracts a
	 * signal* — rather than an exception on the reply path.
	 */
	const lorebookIds = context.allLorebookIds ?? []
	const characterIds = context.characterIds ?? []
	const personaIds = context.personaIds ?? []
	const sessionId = Number.isFinite(context.sessionId)
		? context.sessionId
		: undefined

	if (lorebookIds.length > 0) {
		const entryTypes: Array<[string, string]> = [
			[WORLD_LORE_TYPE_ID, "worldLore"],
			[CHARACTER_LORE_TYPE_ID, "characterLore"],
			[HISTORY_TYPE_ID, "historyEntry"]
		]
		for (const [typeId, source] of entryTypes) {
			if (room() <= 0) break
			push(
				source,
				await db
					.select({ id: schema.lorebookEntries.id })
					.from(schema.lorebookEntries)
					.leftJoin(schema.lorebookEntryVectors, defaultVectorJoin)
					.where(
						and(
							inArray(
								schema.lorebookEntries.lorebookId,
								lorebookIds
							),
							eq(schema.lorebookEntries.enabled, true),
							eq(schema.lorebookEntries.typeId, typeId),
							entryNeedsEmbedding(currentModel)
						)
					)
					.orderBy(desc(schema.lorebookEntries.id))
					.limit(room())
			)
		}

		if (room() > 0)
			push(
				"narrativeNode",
				await db
					.select({ id: schema.lorebookBindings.id })
					.from(schema.lorebookBindings)
					.where(
						and(
							inArray(
								schema.lorebookBindings.lorebookId,
								lorebookIds
							),
							needsEmbedding(
								schema.lorebookBindings.embedding,
								schema.lorebookBindings.embeddingModel,
								currentModel,
								schema.lorebookBindings.updatedAt,
								schema.lorebookBindings.vectorizedAt
							)
						)
					)
					.orderBy(desc(schema.lorebookBindings.id))
					.limit(room())
			)

		if (room() > 0)
			push(
				"narrativeRelationship",
				await db
					.select({ id: schema.narrativeRelationships.id })
					.from(schema.narrativeRelationships)
					.where(
						and(
							inArray(
								schema.narrativeRelationships.lorebookId,
								lorebookIds
							),
							needsEmbedding(
								schema.narrativeRelationships.embedding,
								schema.narrativeRelationships.embeddingModel,
								currentModel,
								schema.narrativeRelationships.updatedAt,
								schema.narrativeRelationships.vectorizedAt
							)
						)
					)
					.orderBy(desc(schema.narrativeRelationships.id))
					.limit(room())
			)
	}

	if (room() > 0 && characterIds.length > 0)
		push(
			"character",
			await db
				.select({ id: schema.characters.id })
				.from(schema.characters)
				.where(
					and(
						inArray(schema.characters.id, characterIds),
						needsEmbedding(
							schema.characters.embedding,
							schema.characters.embeddingModel,
							currentModel,
							schema.characters.updatedAt,
							schema.characters.vectorizedAt
						)
					)
				)
				.limit(room())
		)

	// The voiced characters, under the SAME source as the cast: one table, one
	// picker, one item kind. A row in both lists is pushed twice and picked
	// once — the second pick fails the staleness filter and answers null.
	if (room() > 0 && personaIds.length > 0)
		push(
			"character",
			await db
				.select({ id: schema.characters.id })
				.from(schema.characters)
				.where(
					and(
						inArray(schema.characters.id, personaIds),
						needsEmbedding(
							schema.characters.embedding,
							schema.characters.embeddingModel,
							currentModel,
							schema.characters.updatedAt,
							schema.characters.vectorizedAt
						)
					)
				)
				.limit(room())
		)

	if (room() > 0 && sessionId !== undefined) {
		const messageChannel = channelWhere(
			schema.sessionMessages.channel,
			opts.channel
		)
		const excludeRecent = opts.excludeRecentMessages ?? 10
		let floorId = 0
		if (excludeRecent > 0) {
			// The recent window is already in the prompt verbatim, so a vector
			// for it buys the turn nothing — scoped exactly like the fetch's
			// own exclusion, which is one channel's.
			const recent = await db
				.select({ id: schema.sessionMessages.id })
				.from(schema.sessionMessages)
				.where(
					and(
						eq(schema.sessionMessages.sessionId, sessionId),
						messageChannel
					)
				)
				.orderBy(desc(schema.sessionMessages.id))
				.limit(excludeRecent)
			floorId = recent.length ? (recent[recent.length - 1]!.id ?? 0) : 0
		}
		push(
			"message",
			await db
				.select({ id: schema.sessionMessages.id })
				.from(schema.sessionMessages)
				.where(
					and(
						eq(schema.sessionMessages.sessionId, sessionId),
						eq(schema.sessionMessages.isHidden, false),
						messageChannel,
						floorId > 0
							? sql`${schema.sessionMessages.id} < ${floorId}`
							: undefined,
						needsEmbedding(
							schema.sessionMessages.embedding,
							schema.sessionMessages.embeddingModel,
							currentModel,
							schema.sessionMessages.updatedAt,
							schema.sessionMessages.vectorizedAt
						)
					)
				)
				.orderBy(desc(schema.sessionMessages.id))
				.limit(room())
		)
	}

	return refs
}

/**
 * Index what this query is about to search and is missing, then let it run.
 *
 * ⚠ **Awaited from inside a turn**, so it is bounded twice and cannot hang:
 * the scan above caps how much can be named, and the lane caps how much is
 * indexed and for how long. A promotion that cannot complete — the lane off,
 * the model not resident, either bound reached — comes back as a report rather
 * than an exception or a stall, and the caller puts it on the receipt.
 */
export async function promoteScopedVectors(
	context: SessionRagContext,
	currentModel: string,
	opts: {
		scanLimit?: number
		maxItems?: number
		timeoutMs?: number
		excludeRecentMessages?: number
		channel?: string
	} = {}
): Promise<PromotionReport> {
	let refs: LaneItemRef[]
	try {
		refs = await scopedMissingVectors(context, currentModel, {
			limit: opts.scanLimit,
			excludeRecentMessages: opts.excludeRecentMessages,
			channel: opts.channel
		})
	} catch (err) {
		/**
		 * ⚠ The scan itself must not reach the turn.
		 *
		 * `promote()` is already contracted never to reject; this closes the
		 * half above it. A failed scan means the search runs over whatever is
		 * already indexed and the receipt says why it might be less — which is
		 * the rule: an unavailable mechanism subtracts a signal, it never halts.
		 */
		console.error("[vectorization] Missing-vector scan failed:", err)
		return {
			requested: 0,
			processed: 0,
			remaining: 0,
			boundHit: false,
			reason: "the missing-vector scan failed"
		}
	}
	return embeddingLane.promote({
		refs,
		maxItems: opts.maxItems,
		timeoutMs: opts.timeoutMs
	})
}

// ---------------------------------------------------------------------------
// Auto-enqueue helpers — called by socket handlers after content saves
// ---------------------------------------------------------------------------

export async function autoEnqueueLorebook(
	lorebookId: number,
	lorebookLabel: string,
	ownerDisplayName: string
) {
	if (!(await isVectorizationEnabled())) return
	enqueueLorebookGroup(lorebookId, lorebookLabel, ownerDisplayName)
}

export async function autoEnqueueCharacter(
	characterId: number,
	characterName: string
) {
	if (!(await isVectorizationEnabled())) return
	await enqueueCharacterGroup(characterId, characterName)
}

export async function autoEnqueueSession(sessionId: number) {
	if (!(await isVectorizationEnabled())) return
	await enqueueSessionGroup(sessionId)
}
