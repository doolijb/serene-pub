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
	asc,
	desc,
	ne,
	or,
	sql,
	type SQL
} from "drizzle-orm"
import type { PgColumn } from "drizzle-orm/pg-core"
import * as schema from "$lib/server/db/schema"
import { castEdgeOnly } from "$lib/server/utils/narrativeEdges"
import { DEFAULT_VECTOR_NAME } from "$lib/server/utils/lorebookEntries"
import {
	EMBEDDABLE_ENTRY_TYPES,
	ENTRY_INDEX_SOURCES,
	embeddableEntryType,
	entryTypesOfSource,
	type EntryIndexSource
} from "./entrySources"
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
import { messageHasText } from "./messageText"
import { RECENT_MESSAGES_IN_PROMPT, type SessionRagContext } from "./ragContext"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VectorizationProgressEvent = {
	status: "idle" | "running"
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

/** The event an embedded item is announced on — to its owner (`tellItemOwner`). */
const VECTORIZATION_ITEM_EVENT = "vectorization:itemUpdated"

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
			case "characterLore":
			case "historyEntry":
				return pickEntryOfSource(ref.source, modelId, undefined, ref.id)
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
			name: VECTORIZATION_ITEM_EVENT,
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

/**
 * The administrators' listeners: the lane's progress, never its items — an
 * item goes to its owner alone (`tellItemOwner`), administrators included.
 */
const progressListeners = new Map<EmitFn, EmitFn>()

export function registerProgressEmitter(fn: EmitFn) {
	if (progressListeners.has(fn)) return
	const progressOnly: EmitFn = (event, data) => {
		if (event !== VECTORIZATION_ITEM_EVENT) fn(event, data)
	}
	progressListeners.set(fn, progressOnly)
	embeddingLane.registerEmitter(progressOnly)
}

export function unregisterProgressEmitter(fn: EmitFn) {
	const progressOnly = progressListeners.get(fn)
	if (!progressOnly) return
	progressListeners.delete(fn)
	embeddingLane.unregisterEmitter(progressOnly)
}

/**
 * Who hears `vectorization:itemUpdated` (plan A7): the item's OWNER — the
 * user whose book, card or session it is — admin or not, and nobody else.
 * Progress telemetry (`vectorization:progress`) spans every user's content
 * and stays with administrators (`registerProgressEmitter`); an item's badge
 * refresh names one row of one person's, and is theirs.
 *
 * One `emitToUser` per user is enough: it reaches every tab of theirs, and
 * the interest gate narrows it to the tabs that asked (scoped by the item's
 * `lorebookId`, bare for a card's). Each connected socket registers its own,
 * so a closed tab's goes with it and the user's other tabs still hear.
 */
const ownerEmitters = new Map<number, Set<EmitFn>>()

export function registerOwnerEmitter(userId: number, fn: EmitFn) {
	const mine = ownerEmitters.get(userId) ?? new Set<EmitFn>()
	mine.add(fn)
	ownerEmitters.set(userId, mine)
}

export function unregisterOwnerEmitter(userId: number, fn: EmitFn) {
	const mine = ownerEmitters.get(userId)
	if (!mine) return
	mine.delete(fn)
	if (!mine.size) ownerEmitters.delete(userId)
}

/** The user an embedded item belongs to, or null when its row is gone. */
async function ownerOfItem(
	payload: VectorizationItemUpdatedEvent
): Promise<number | null> {
	if (payload.lorebookId != null) {
		const [book] = await db
			.select({ userId: schema.lorebooks.userId })
			.from(schema.lorebooks)
			.where(eq(schema.lorebooks.id, payload.lorebookId))
			.limit(1)
		return book?.userId ?? null
	}
	if (payload.type === "character") {
		const [card] = await db
			.select({ userId: schema.characters.userId })
			.from(schema.characters)
			.where(eq(schema.characters.id, payload.id))
			.limit(1)
		return card?.userId ?? null
	}
	if (payload.type === "message") {
		const [session] = await db
			.select({ userId: schema.sessions.userId })
			.from(schema.sessionMessages)
			.innerJoin(
				schema.sessions,
				eq(schema.sessions.id, schema.sessionMessages.sessionId)
			)
			.where(eq(schema.sessionMessages.id, payload.id))
			.limit(1)
		return session?.userId ?? null
	}
	return null
}

/**
 * The lane's item listener: hands `vectorization:itemUpdated` to its owner's
 * tabs (plan A7). Any other event is not an item's and goes nowhere from here.
 * Asks who owns the row only while somebody is connected to hear it.
 */
export async function tellItemOwner(event: string, payload: unknown) {
	if (event !== VECTORIZATION_ITEM_EVENT || !ownerEmitters.size) return
	const item = payload as VectorizationItemUpdatedEvent
	const userId = await ownerOfItem(item)
	if (userId == null) return
	const [emit] = ownerEmitters.get(userId) ?? []
	emit?.(event, item)
}

embeddingLane.registerEmitter((event, payload) => {
	tellItemOwner(event, payload).catch((err) =>
		console.error("[embedding] could not tell an item's owner:", err)
	)
})

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
	if (embeddingLane.isRunning()) {
		// ⚠ Re-arm it, never just return. `stopVectorization()` does not wait,
		// so a run with an `embed()` in flight is still running when the
		// embedding star's consequence asks for the start that follows its
		// stop; a bare return leaves the stop standing, the loop leaves after
		// that item, and nothing indexes until the 15-minute sweep.
		// `lane.start()` clears the stop and wakes the loop. The run keeps its
		// count and its backoff state: the sweep asks for a start every tick.
		embeddingLane.start()
		return
	}
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
	embeddingLane.start()

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

	embeddingLane.start()
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

	embeddingLane.start()
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
 * sha-256 of a text's UTF-8, first 16 hex characters — the digest every
 * `source_hash`, `embedding_source_hash` and `embed_text_hash` in the index
 * records, and the one `entry_annotations.source_hash` uses
 * (`annotations/index.ts` `contentHash`).
 *
 * Over the whole text rather than the `MAX_EMBED_INPUT_LENGTH` slice the model
 * is handed: an edit past the cut re-embeds, which is still an edit to the
 * content.
 */
const textDigest = (text: SQL) =>
	sql<string>`left(encode(sha256(convert_to(${text}, 'UTF8')), 'hex'), 16)`

/**
 * What a session message embeds: its content.
 *
 * `session_messages.embed_text_hash` (GENERATED) spells the same recipe in the
 * schema; `columnStoreEmbedTextHash.int.test.ts` pins the two equal.
 */
export const messageEmbedText = sql<string>`${schema.sessionMessages.content}`

/**
 * What a character (a persona is a character) embeds: its name, a newline and
 * its description. Nothing else on the card — so a folder move, an avatar, the
 * persona flags and a soft delete change nothing here.
 */
export const characterEmbedText = sql<string>`(${schema.characters.name} || chr(10) || ${schema.characters.description})`

/**
 * What a cast member (`lorebook_bindings`) embeds: its name, and its summary
 * under it when there is one. Aliases are not embedded, so an alias edit and
 * the character sync's rewrite of an unchanged name change nothing here.
 */
export const bindingEmbedText = sql<string>`(CASE WHEN coalesce(${schema.lorebookBindings.summary}, '') <> '' THEN ${schema.lorebookBindings.name} || chr(10) || ${schema.lorebookBindings.summary} ELSE ${schema.lorebookBindings.name} END)`

/** One end of a cast edge, by the member's name (its id when the row is gone). */
const relationshipEndName = (end: PgColumn) =>
	sql<string>`coalesce((SELECT "b"."name" FROM "lorebook_bindings" AS "b" WHERE "b"."id" = ${end}), ${end}::text)`

/**
 * What a relationship embeds: both members' names either side of its type,
 * then its description and its reason — `Alder ally Birch: Old friends. An
 * oath`. Cast edges only (`castEdgeOnly`): an edge with an entry end has no
 * second name, and its text is NULL here.
 *
 * ⚠ **The names are another table's**, so this cannot be a generated column:
 * renaming a member moves the text of every relationship that names it, and
 * that is exactly the change the hash has to see. So the relationship store's
 * current hash is this expression, hashed where it is read
 * (`RELATIONSHIP_STORE`) — two primary-key lookups and one short digest per
 * row, over a store of tens to hundreds of edges per book.
 */
export const relationshipEmbedText = sql<string>`(${relationshipEndName(schema.narrativeRelationships.fromNodeId)} || ' ' || ${schema.narrativeRelationships.relationshipType} || ' ' || ${relationshipEndName(schema.narrativeRelationships.toNodeId)} || CASE WHEN ${schema.narrativeRelationships.description} <> '' THEN ': ' || ${schema.narrativeRelationships.description} ELSE '' END || CASE WHEN coalesce(${schema.narrativeRelationships.reason}, '') <> '' THEN '. ' || ${schema.narrativeRelationships.reason} ELSE '' END)`

/** The four tables that keep their vector on the row itself. */
type ColumnStoreTable =
	| typeof schema.sessionMessages
	| typeof schema.characters
	| typeof schema.lorebookBindings
	| typeof schema.narrativeRelationships

/**
 * A store whose vector is three columns of the row it describes —
 * `embedding`, `embedding_model`, `embedding_source_hash` — rather than a row
 * of its own, as an entry's is.
 *
 * `embedText` is what the row embeds, as SQL, so the text handed to the model
 * is read in the same statement as its hash and what is hashed IS what was
 * embedded. `embedTextHash` is that text's digest as it stands now: the row's
 * own GENERATED `embed_text_hash` where the text is the row's alone, and the
 * digest computed on read for relationships, whose text names other rows.
 */
interface ColumnStore {
	table: ColumnStoreTable
	embedText: SQL<string>
	embedTextHash: SQL<string> | PgColumn
	/**
	 * The rows whose text is final, where a store has rows whose text is not;
	 * absent, every row. Only such a row is embedded or counted as waiting.
	 */
	settled?: SQL
	/**
	 * The rows with any text to embed, where a store has rows with none;
	 * absent, every row. A row with none is never embedded, nor counted as
	 * waiting.
	 */
	hasText?: SQL
}

const MESSAGE_STORE: ColumnStore = {
	table: schema.sessionMessages,
	embedText: messageEmbedText,
	embedTextHash: schema.sessionMessages.embedTextHash,
	/**
	 * A reply still generating is not embedded. Its text moves with every
	 * chunk the stream persists, so an embed of it would be written by no
	 * one — the freshness guard refuses a vector over text that has moved —
	 * and the picker would take the same row again at once: a paid call per
	 * chunk, none of them kept. The row is embedded once, when the finishing
	 * write settles it (`settledMessage`), or by the next sweep.
	 */
	settled: eq(schema.sessionMessages.isGenerating, false),
	hasText: messageHasText
}
const CHARACTER_STORE: ColumnStore = {
	table: schema.characters,
	embedText: characterEmbedText,
	embedTextHash: schema.characters.embedTextHash
}
const BINDING_STORE: ColumnStore = {
	table: schema.lorebookBindings,
	embedText: bindingEmbedText,
	embedTextHash: schema.lorebookBindings.embedTextHash
}
const RELATIONSHIP_STORE: ColumnStore = {
	table: schema.narrativeRelationships,
	embedText: relationshipEmbedText,
	embedTextHash: textDigest(relationshipEmbedText)
}

/**
 * Whether a column-store row needs a vector — judged by the **text**, never by
 * `updated_at` (the rule entries follow, `entryNeedsEmbedding`).
 *
 * A row needs one when it has none, when its vector came from another model,
 * or when the hash of the text it embeds now differs from the
 * `embedding_source_hash` its vector was computed over. Nothing else: a
 * folder move, an avatar, the persona flags, a soft delete, a hidden message,
 * an alias edit, the character sync rewriting an unchanged name and a
 * relationship's status all move `updated_at` and none of them changes the
 * text, so none of them costs a call to a paid embedding API. A content write
 * that pins `updated_at` is caught all the same. A row whose text is not final
 * yet — a reply still streaming (`ColumnStore.settled`) — needs nothing until
 * it is, and a row with no text at all (`ColumnStore.hasText`) never does.
 *
 * A vector with no `embedding_source_hash` is stale. Every write stores one;
 * the backfill migration (`*_column_store_embedding_source_hash`) hashed every
 * vector the timestamp rule called fresh, so what is left without one is
 * exactly what that rule would have re-embedded anyway.
 *
 * ⚠ A vector with a NULL `embedding_model` is not picked up by the model arm:
 * `NULL <> 'x'` is NULL, not true — the same as `entryNeedsEmbedding`.
 */
function columnStoreNeedsEmbedding(store: ColumnStore, currentModel: string) {
	const t = store.table
	return and(
		store.settled,
		store.hasText,
		or(
			isNull(t.embedding),
			ne(t.embeddingModel, currentModel),
			isNull(t.embeddingSourceHash),
			sql`${t.embeddingSourceHash} <> ${store.embedTextHash}`
		)
	)
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
 * The entry types whose `embedText` role names the title — `[title, content]`
 * — as opposed to history's `[content]`. Derived from the declarations, never
 * listed by hand (`entrySources.ts`).
 */
const TITLED_ENTRY_TYPE_IDS = EMBEDDABLE_ENTRY_TYPES.filter(
	(t) => t.withTitle
).map((t) => t.typeId)

/**
 * What the default space embeds for an entry — its type's `embedText` role —
 * as SQL over `lorebook_entries`.
 *
 * `title ? title + "\n" + content : content` for the titled types, `content`
 * for history, which is dated and has no title to prepend. Over the **base
 * row**: an amendment never reaches the content vector (lorebooks ruling R1,
 * "content vectors stay base-text"), so an amendment costs no embed either.
 *
 * ⚠ **SQL and not JS, and that is the point.** The text the picker embeds is
 * read in the same statement as the entry's `embed_text_hash`, so what is
 * hashed IS what was embedded.
 *
 * ⚠ That column (`lorebook_entries.embed_text_hash`, GENERATED) spells this
 * recipe a second time, in the schema, with the titled types frozen as of its
 * migration — a generated column cannot read the declarations. The two are
 * pinned equal for every embeddable type by `entryEmbedTextHash.int.test.ts`.
 */
export const entryEmbedText = sql<string>`(CASE WHEN ${schema.lorebookEntries.typeId} IN (${sql.join(
	TITLED_ENTRY_TYPE_IDS.map((id) => sql`${id}`),
	sql`, `
)}) AND coalesce(${schema.lorebookEntries.title}, '') <> '' THEN ${schema.lorebookEntries.title} || chr(10) || ${schema.lorebookEntries.content} ELSE ${schema.lorebookEntries.content} END)`

/**
 * The entry's `source_hash` — `entryEmbedText`, hashed, as the entry row
 * stores it (`lorebook_entries.embed_text_hash`).
 *
 * The same digest `entry_annotations.source_hash` uses (sha-256, first 16 hex
 * characters; `annotations/index.ts` `contentHash`). Over the whole text rather
 * than the `MAX_EMBED_INPUT_LENGTH` slice the model is handed: an edit past the
 * cut re-embeds, which is still an edit to the content.
 *
 * ⚠ Read from the column, never computed here. The picker's `LIMIT 1` scan
 * re-reads every up-to-date entry on each pick, and each reply's scoped count
 * reads them too; hashing whole texts inside that predicate would make the
 * check cost many times the comparison it is.
 */
const entryEmbedTextHash = schema.lorebookEntries.embedTextHash

/**
 * `columnStoreNeedsEmbedding`, read across the join instead of down a row —
 * judged by the **text**, not by `updated_at` (plan A9).
 *
 * A row needs a vector when it has none, when its vector came from another
 * model, or when the entry's `embed_text_hash` differs from the
 * `source_hash` its vector was computed over. Nothing else: a mark, an
 * archive, a drag reorder, a keys or `fields` edit, the siblings
 * `iterateNext` shifts, and a graph build's `graphed` flag all move
 * `updated_at` and none of them changes the text, so none of them costs a
 * call to a paid embedding API. A content write that pins `updated_at` is
 * caught all the same.
 *
 * A vector with no `source_hash` is stale. Every write stores one; the only
 * vectors without one are those an install left from before content hashes,
 * and the backfill migration (`*_entry_vector_source_hash`) hashed every one
 * the old timestamp rule called fresh — so what is left without a hash is
 * exactly what that rule would have re-embedded anyway.
 *
 * ⚠ A vector with a NULL `model` is deliberately **not** picked up by the
 * model arm, which is what `ne(model, current)` already did: `NULL <> 'x'` is
 * NULL, not true. The backfill carried such vectors from rows whose
 * `embedding_model` was NULL, and they were unpickable before this table
 * existed for exactly the same reason.
 */
const entryNeedsEmbedding = (currentModel: string) =>
	or(
		isNull(schema.lorebookEntryVectors.entryId),
		ne(schema.lorebookEntryVectors.model, currentModel),
		isNull(schema.lorebookEntryVectors.sourceHash),
		ne(schema.lorebookEntryVectors.sourceHash, entryEmbedTextHash)
	)

/**
 * `writeEmbeddingIfFresh` for an entry, whose vector is a row of its own.
 *
 * The optimistic-concurrency guard is the **text**: the write lands only while
 * the entry still hashes to what was embedded, so an entry whose title or
 * content moved while `embed()` was in flight selects nothing and writes
 * nothing (and is picked again, by `entryNeedsEmbedding`). A mark or a reorder
 * landing in that window changes no text, so the finished embed is kept.
 *
 * ⚠ The self-pinned `updatedAt` that `writeEmbeddingIfFresh`
 * needs has no counterpart here, and needs none: this statement does not touch
 * the entry row at all, so drizzle's `$onUpdate` never fires and vectorizing
 * is never mistaken for an edit — the circular staleness the separate vector
 * table exists to prevent.
 */
export async function writeEntryVectorIfFresh(
	id: number,
	capturedSourceHash: string,
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
	// No table alias: `entryEmbedTextHash` names its columns by table.
	await db.execute(sql`
		INSERT INTO "lorebook_entry_vectors"
			("entry_id", "vector_name", "chunk_index", "model", "dims", "vector", "source_hash", "vectorized_at")
		SELECT ${schema.lorebookEntries.id}, ${DEFAULT_VECTOR_NAME}, 0, ${currentModel},
		       ${vector.length}, ${literal}::real[], ${capturedSourceHash}, now()
		FROM ${schema.lorebookEntries}
		WHERE ${schema.lorebookEntries.id} = ${id}
		  AND ${entryEmbedTextHash} = ${capturedSourceHash}
		ON CONFLICT ("entry_id", "vector_name", "chunk_index") DO UPDATE SET
			"model" = EXCLUDED."model",
			"model_version" = NULL,
			"normalization" = NULL,
			"dims" = EXCLUDED."dims",
			"vector" = EXCLUDED."vector",
			"source_hash" = EXCLUDED."source_hash",
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

	// 2. Lorebook content (world lore, places and items → character lore →
	// history entries → narrative graph). Every declared entry type, by its
	// index source (`entrySources.ts`, finding #150).
	for (const lorebookId of group.lorebookIds) {
		for (const source of ENTRY_INDEX_SOURCES) {
			const entry = await pickEntryOfSource(source, currentModel, lorebookId)
			if (entry) return entry
		}

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
	const message = await pickSessionMessage(currentModel)
	if (message) return message
	for (const source of ENTRY_INDEX_SOURCES) {
		const entry = await pickEntryOfSource(source, currentModel)
		if (entry) return entry
	}
	return (
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
 * The freshness-guarded write for a column store, shared by every column-store
 * picker's `process()` closure and by `ensureSessionMessageEmbedded`. Two races
 * this closes:
 *  - **Edit during embed.** The write lands only while the row still hashes to
 *    what was embedded (`capturedSourceHash`, read in the picker's own
 *    statement). A row whose embedded text moved while `embed()` was in flight
 *    writes nothing and is picked again by `columnStoreNeedsEmbedding`; a write
 *    that moved no embedded text (a folder move, a hidden message) keeps the
 *    finished embed. For a relationship the guard is its names too, so a
 *    member renamed mid-flight drops the vector of the old name.
 *  - **Backend switch mid-flight.** When the active embedding model changed
 *    while `embed()` was in flight, nothing is written — otherwise a vector
 *    computed under one model is labelled as another's.
 *
 * `updated_at` is pinned to itself: every one of these tables declares
 * `updatedAt: ...$onUpdate(() => new Date())`, which drizzle applies to any
 * update on the row unless the statement sets the column itself. Computing an
 * embedding is not a modification of the content, and `updated_at` is read as
 * a content timestamp elsewhere (the recency signals in
 * `pipelines/ranking/weights.ts` among them).
 */
export async function writeEmbeddingIfFresh(
	store: ColumnStore,
	id: number,
	capturedSourceHash: string,
	currentModel: string,
	vector: number[]
): Promise<void> {
	if (getLoadedModelId() !== currentModel) return
	const t = store.table
	await db
		.update(t)
		.set({
			embedding: vector,
			embeddingModel: currentModel,
			embeddingSourceHash: capturedSourceHash,
			vectorizedAt: new Date(),
			updatedAt: sql`${t.updatedAt}`
		})
		.where(
			and(
				eq(t.id, id),
				sql`${store.embedTextHash} = ${capturedSourceHash}`
			)
		)
}

async function pickSessionMessage(
	currentModel: string,
	sessionId?: number,
	onlyId?: number
): Promise<QueueItem | null> {
	const where = and(
		sessionId ? eq(schema.sessionMessages.sessionId, sessionId) : undefined,
		onlyId ? eq(schema.sessionMessages.id, onlyId) : undefined,
		columnStoreNeedsEmbedding(MESSAGE_STORE, currentModel)
	)

	const rows = await db
		.select({
			id: schema.sessionMessages.id,
			text: MESSAGE_STORE.embedText,
			sourceHash: sql<string>`${MESSAGE_STORE.embedTextHash}`
		})
		.from(schema.sessionMessages)
		.where(where)
		.orderBy(
			desc(schema.sessionMessages.sessionId),
			asc(schema.sessionMessages.id)
		)
		.limit(1)

	if (!rows.length) return null
	const { id, text, sourceHash } = rows[0]
	return queueItem({
		type: "message",
		label: `Session message #${id}`,
		id,
		currentModel,
		process: async () => {
			const vector = await embed(truncateForEmbedding(text))
			await writeEmbeddingIfFresh(
				MESSAGE_STORE,
				id,
				sourceHash,
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
// existing caller (e.g. the 0.5 RAG path's query-time batchEmbed(), which
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
 * Reuses the exact staleness predicate (`columnStoreNeedsEmbedding`) and safe
 * write (`writeEmbeddingIfFresh`) the background queue itself uses for this row, so
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

	const rows = await db
		.select({
			id: schema.sessionMessages.id,
			text: MESSAGE_STORE.embedText,
			sourceHash: sql<string>`${MESSAGE_STORE.embedTextHash}`
		})
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.id, messageId),
				columnStoreNeedsEmbedding(MESSAGE_STORE, currentModel)
			)
		)
		.limit(1)

	if (!rows.length) return // already fresh (or row gone) — nothing to do
	const { id, text, sourceHash } = rows[0]

	let vector: number[]
	try {
		vector = await withTimeout(
			embed(truncateForEmbedding(text)),
			INLINE_EMBED_TIMEOUT_MS
		)
	} catch (err) {
		if (err instanceof InlineEmbedTimeoutError) {
			inlineEmbedDisabledUntil = Date.now() + INLINE_EMBED_COOLDOWN_MS
		}
		throw err
	}

	await writeEmbeddingIfFresh(
		MESSAGE_STORE,
		id,
		sourceHash,
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
	typeIds: readonly string[],
	labelType: VectorizationItemLabel["type"],
	currentModel: string,
	lorebookId?: number,
	onlyId?: number
): Promise<QueueItem | null> {
	if (!typeIds.length) return null
	const where = and(
		typeIds.length === 1
			? eq(schema.lorebookEntries.typeId, typeIds[0]!)
			: inArray(schema.lorebookEntries.typeId, [...typeIds]),
		lorebookId
			? eq(schema.lorebookEntries.lorebookId, lorebookId)
			: undefined,
		onlyId ? eq(schema.lorebookEntries.id, onlyId) : undefined,
		entryNeedsEmbedding(currentModel)
	)

	const rows = await db
		.select({
			id: schema.lorebookEntries.id,
			typeId: schema.lorebookEntries.typeId,
			title: schema.lorebookEntries.title,
			lorebookId: schema.lorebookEntries.lorebookId,
			// The text and its hash from the one SQL recipe the staleness
			// predicate and the write guard read, so what is embedded is what
			// is hashed.
			text: entryEmbedText,
			sourceHash: entryEmbedTextHash
		})
		.from(schema.lorebookEntries)
		.leftJoin(schema.lorebookEntryVectors, defaultVectorJoin)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const {
		id,
		typeId,
		title,
		lorebookId: rowLorebookId,
		text,
		sourceHash
	} = rows[0]
	const kind = embeddableEntryType(typeId)
	const noun = kind?.noun ?? typeId
	return queueItem({
		type: labelType,
		label: kind?.withTitle ? `${noun}: ${title || id}` : `${noun} #${id}`,
		id,
		lorebookId: rowLorebookId,
		currentModel,
		process: async () => {
			const vector = await embed(truncateForEmbedding(text))
			await writeEntryVectorIfFresh(
				id,
				sourceHash,
				currentModel,
				vector
			)
		}
	})
}

/**
 * The next row of one index source needing a vector — every declared type
 * that indexes under it (`entrySources.ts`): world lore, places and items
 * under `worldLore`; character lore; history under `historyEntry`.
 */
const pickEntryOfSource = (
	source: EntryIndexSource,
	currentModel: string,
	lorebookId?: number,
	onlyId?: number
) =>
	pickEntry(
		entryTypesOfSource(source),
		source,
		currentModel,
		lorebookId,
		onlyId
	)

async function pickNarrativeNode(
	currentModel: string,
	lorebookId?: number,
	onlyId?: number
): Promise<QueueItem | null> {
	const where = and(
		lorebookId
			? eq(schema.lorebookBindings.lorebookId, lorebookId)
			: undefined,
		onlyId ? eq(schema.lorebookBindings.id, onlyId) : undefined,
		columnStoreNeedsEmbedding(BINDING_STORE, currentModel)
	)

	const rows = await db
		.select({
			id: schema.lorebookBindings.id,
			name: schema.lorebookBindings.name,
			lorebookId: schema.lorebookBindings.lorebookId,
			text: BINDING_STORE.embedText,
			sourceHash: sql<string>`${BINDING_STORE.embedTextHash}`
		})
		.from(schema.lorebookBindings)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const { id, name, lorebookId: rowLorebookId, text, sourceHash } = rows[0]
	return queueItem({
		type: "narrativeNode",
		label: `Narrative node: ${name}`,
		id,
		lorebookId: rowLorebookId,
		currentModel,
		process: async () => {
			const vector = await embed(truncateForEmbedding(text))
			await writeEmbeddingIfFresh(
				BINDING_STORE,
				id,
				sourceHash,
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
	const where = and(
		lorebookId
			? eq(schema.narrativeRelationships.lorebookId, lorebookId)
			: undefined,
		onlyId ? eq(schema.narrativeRelationships.id, onlyId) : undefined,
		// Cast edges only: the text embedded here is two member names either
		// side of a type, which an edge with an entry end has no second name
		// for. Entry edges reach retrieval through the link hop instead.
		castEdgeOnly,
		columnStoreNeedsEmbedding(RELATIONSHIP_STORE, currentModel)
	)

	const rows = await db
		.select({
			id: schema.narrativeRelationships.id,
			fromName: relationshipEndName(
				schema.narrativeRelationships.fromNodeId
			),
			toName: relationshipEndName(schema.narrativeRelationships.toNodeId),
			lorebookId: schema.narrativeRelationships.lorebookId,
			text: RELATIONSHIP_STORE.embedText,
			sourceHash: sql<string>`${RELATIONSHIP_STORE.embedTextHash}`
		})
		.from(schema.narrativeRelationships)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const {
		id,
		fromName,
		toName,
		lorebookId: rowLorebookId,
		text,
		sourceHash
	} = rows[0]
	return queueItem({
		type: "narrativeRelationship",
		label: `Narrative relationship: ${fromName} → ${toName}`,
		id,
		lorebookId: rowLorebookId,
		currentModel,
		process: async () => {
			const vector = await embed(truncateForEmbedding(text))
			await writeEmbeddingIfFresh(
				RELATIONSHIP_STORE,
				id,
				sourceHash,
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

	const where = and(
		characterIds && characterIds.length > 0
			? inArray(schema.characters.id, characterIds)
			: undefined,
		onlyId ? eq(schema.characters.id, onlyId) : undefined,
		columnStoreNeedsEmbedding(CHARACTER_STORE, currentModel)
	)

	const rows = await db
		.select({
			id: schema.characters.id,
			name: schema.characters.name,
			text: CHARACTER_STORE.embedText,
			sourceHash: sql<string>`${CHARACTER_STORE.embedTextHash}`
		})
		.from(schema.characters)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const { id, name, text, sourceHash } = rows[0]
	return queueItem({
		type: "character",
		label: `Character: ${name}`,
		id,
		currentModel,
		process: async () => {
			const vector = await embed(truncateForEmbedding(text))
			await writeEmbeddingIfFresh(
				CHARACTER_STORE,
				id,
				sourceHash,
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
 * Count how many items still need embedding, across every store.
 *
 * With the current model's id, what the queue would pick: no vector, another
 * model's, or a text that moved since (`columnStoreNeedsEmbedding`,
 * `entryNeedsEmbedding`). Without one, only the rows with no vector at all.
 * Relationships count their cast edges only — the edges the picker embeds.
 */
export async function countUnembedded(currentModel?: string): Promise<number> {
	const condition = (store: ColumnStore) =>
		currentModel
			? columnStoreNeedsEmbedding(store, currentModel)
			: and(store.settled, store.hasText, isNull(store.table.embedding))

	const counts = await Promise.all([
		db.$count(schema.sessionMessages, condition(MESSAGE_STORE)),
		// One count for all three entry types, because they are one table. The
		// no-current-model arm is `isNull(embedding)`'s equivalent: an entry
		// with no default-space vector at all.
		countUnembeddedEntries(currentModel),
		db.$count(schema.lorebookBindings, condition(BINDING_STORE)),
		db.$count(
			schema.narrativeRelationships,
			and(castEdgeOnly, condition(RELATIONSHIP_STORE))
		),
		db.$count(schema.characters, condition(CHARACTER_STORE))
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
 * `columnStoreNeedsEmbedding` / `entryNeedsEmbedding`. That is what makes the answer
 * *"missing from what this query will look at"* rather than *"unembedded
 * somewhere"*: hash staleness distinguishes a stale vector
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
		/**
		 * The index sources the search will fetch — `fetchScopedCandidates`'
		 * own `sources`, in the index's vocabulary. Absent is every source.
		 */
		sources?: readonly string[]
		excludeRecentMessages?: number
		channel?: string
	} = {}
): Promise<LaneItemRef[]> {
	const limit = Math.max(0, opts.limit ?? PROMOTION_SCAN_CAP)
	if (limit === 0) return []
	const refs: LaneItemRef[] = []
	const room = () => limit - refs.length
	const searched = (source: string) =>
		!opts.sources || opts.sources.includes(source)

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
		for (const source of ENTRY_INDEX_SOURCES) {
			const typeIds = entryTypesOfSource(source)
			if (room() <= 0) break
			if (!searched(source)) continue
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
							inArray(schema.lorebookEntries.typeId, typeIds),
							entryNeedsEmbedding(currentModel)
						)
					)
					.orderBy(desc(schema.lorebookEntries.id))
					.limit(room())
			)
		}

		if (room() > 0 && searched("narrativeNode"))
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
							columnStoreNeedsEmbedding(BINDING_STORE, currentModel)
						)
					)
					.orderBy(desc(schema.lorebookBindings.id))
					.limit(room())
			)

		if (room() > 0 && searched("narrativeRelationship"))
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
							// The picker embeds cast edges only; naming an
							// entry edge would spend a promotion slot on a row
							// it answers null for.
							castEdgeOnly,
							columnStoreNeedsEmbedding(
								RELATIONSHIP_STORE,
								currentModel
							)
						)
					)
					.orderBy(desc(schema.narrativeRelationships.id))
					.limit(room())
			)
	}

	if (room() > 0 && characterIds.length > 0 && searched("character"))
		push(
			"character",
			await db
				.select({ id: schema.characters.id })
				.from(schema.characters)
				.where(
					and(
						inArray(schema.characters.id, characterIds),
						columnStoreNeedsEmbedding(CHARACTER_STORE, currentModel)
					)
				)
				.limit(room())
		)

	// The voiced characters, under the SAME source as the cast: one table, one
	// picker, one item kind. A row in both lists is pushed twice and picked
	// once — the second pick fails the staleness filter and answers null.
	if (room() > 0 && personaIds.length > 0 && searched("persona"))
		push(
			"character",
			await db
				.select({ id: schema.characters.id })
				.from(schema.characters)
				.where(
					and(
						inArray(schema.characters.id, personaIds),
						columnStoreNeedsEmbedding(CHARACTER_STORE, currentModel)
					)
				)
				.limit(room())
		)

	if (room() > 0 && sessionId !== undefined && searched("message")) {
		const messageChannel = channelWhere(
			schema.sessionMessages.channel,
			opts.channel
		)
		const excludeRecent =
			opts.excludeRecentMessages ?? RECENT_MESSAGES_IN_PROMPT
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
						columnStoreNeedsEmbedding(MESSAGE_STORE, currentModel)
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
		/** The sources the search will fetch; see `scopedMissingVectors`. */
		sources?: readonly string[]
		excludeRecentMessages?: number
		channel?: string
	} = {}
): Promise<PromotionReport> {
	let refs: LaneItemRef[]
	try {
		refs = await scopedMissingVectors(context, currentModel, {
			limit: opts.scanLimit,
			sources: opts.sources,
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
