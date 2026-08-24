/**
 * Background vectorization queue.
 *
 * Processes embedding jobs one at a time with:
 *  - Pause/resume support (paused during active session generation)
 *  - Socket progress events for the global UI indicator
 *  - Priority groups: sessions (with their lorebooks + characters) can be moved
 *    to the front of the queue; items within a group are processed in a fixed
 *    order (messages → lorebook content → characters → personas)
 *  - Model tracking: embeddingModel is written alongside each vector so RAG
 *    can filter to only compare vectors from the active model, and so rows
 *    produced by a previous model are treated as stale and re-embedded.
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
import {
	embed,
	isModelReady,
	getLoadedModelId,
	loadConfiguredEmbeddingModel,
	getConfiguredModelId
} from "./index"
import { randomUUID } from "crypto"

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
			| "persona"
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
 */
export type PriorityGroup = {
	groupId: string
	label: string
	ownerDisplayName: string
	sessionId?: number
	/** All lorebook IDs associated with this group (session lorebook + character lorebooks) */
	lorebookIds: number[]
	characterIds: number[]
	personaIds: number[]
}

export type CompletedGroup = PriorityGroup & {
	completedAt: string // ISO timestamp
}

const HISTORY_MAX = 20

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

type QueueItem = {
	label: VectorizationProgressEvent["currentItem"]
	/** DB id of the row being embedded — carried through so processItem() can
	 * broadcast which specific item just got a fresh vector. */
	id: number
	/** Set for lorebook-scoped item types (world/character lore, history,
	 * narrative nodes/relationships) so listeners can filter to the lorebook
	 * they're currently viewing. */
	lorebookId?: number
	embeddingModel: string
	process: () => Promise<void>
}

export type VectorizationItemUpdatedEvent = {
	type: NonNullable<VectorizationProgressEvent["currentItem"]>["type"]
	id: number
	lorebookId?: number
	embeddingModel: string
	vectorizedAt: string
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let isPaused = false
let isRunning = false
let shouldStop = false
let totalCompleted = 0
// A Set, not a single nullable slot — the old single-slot design meant
// setProgressEmitter() from one admin's connection silently replaced
// another's, so with 2+ admins (or, before this fix, ANY connected user —
// see registerVectorizationHandlers) only the most recently (re)connected
// socket ever received progress, including other users' session/lorebook/
// character names via priorityQueue/history. Same
// registerEmitter/unregisterEmitter shape as utils/taskQueue.ts.
const progressEmitters = new Set<EmitFn>()
let priorityQueue: PriorityGroup[] = []
let completedHistory: CompletedGroup[] = []

// Per-item consecutive-failure tracking for runQueue()'s backoff below. A
// persistently-failing item (misconfigured endpoint, one malformed row)
// never gets marked done, so pickNextItem() hands the exact same item back
// every iteration — without this, that's a true busy-loop hammering the
// embedding provider at full speed. Keyed by item identity, not object
// reference, since pickNextItem() re-queries the DB each time.
const itemFailureCounts = new Map<string, number>()

function itemFailureKey(item: QueueItem): string {
	return `${item.label?.type ?? "unknown"}:${item.id}`
}

/** Exported so a config change that could fix a previously-failing item
 * (e.g. correcting the embedding API endpoint) doesn't leave it excluded
 * until the next full restart — see vectorization.ts's setApiConfig/
 * setModel handlers. */
export function clearVectorizationFailureTracking() {
	itemFailureCounts.clear()
}

// ---------------------------------------------------------------------------
// Public control API
// ---------------------------------------------------------------------------

export function registerProgressEmitter(fn: EmitFn) {
	progressEmitters.add(fn)
}

export function unregisterProgressEmitter(fn: EmitFn) {
	progressEmitters.delete(fn)
}

export function pauseVectorization() {
	isPaused = true
	broadcastStatus("paused")
}

export function resumeVectorization() {
	isPaused = false
	if (!isRunning) {
		runQueue()
	} else {
		broadcastStatus("running")
	}
}

export function stopVectorization() {
	shouldStop = true
	isPaused = false
}

export function isVectorizationRunning() {
	return isRunning
}

export async function startVectorizationQueue(opts?: {
	startFromBeginning?: boolean
}) {
	if (isRunning) return
	if (opts?.startFromBeginning) {
		totalCompleted = 0
	}
	shouldStop = false
	clearVectorizationFailureTracking()
	runQueue()
}

const PERIODIC_SCAN_INTERVAL_MS = 15 * 60 * 1000

let scanTimer: ReturnType<typeof setInterval> | null = null

/**
 * Periodically (re-)triggers the queue so missing/stale embeddings get
 * picked up even without a reactive create/update trigger or a manual
 * "Start Queue" click — e.g. after a server restart with a backlog already
 * present, or content that went stale for a reason unrelated to its own
 * create/update (a model switch, say). Deliberately does NOT load the
 * embedding model itself — startVectorizationQueue() -> runQueue() only
 * loads it (via loadConfiguredEmbeddingModel(), mode-aware) once
 * pickNextItem() actually finds something to embed, so an instance with
 * nothing to do never pays any model-load cost, on this timer or at boot.
 *
 * Call once at boot; the first tick runs immediately (that *is* the
 * boot-time trigger, not a separate code path) and every
 * PERIODIC_SCAN_INTERVAL_MS after. Idempotent — a second call is a no-op,
 * mirroring startVectorizationQueue()'s own isRunning guard, so this is
 * safe to call again if it's ever wired up somewhere other than boot.
 */
export function startPeriodicVectorizationScan() {
	if (scanTimer) return
	const tick = async () => {
		try {
			const settings = await db.query.systemSettings.findFirst({
				columns: { vectorizationEnabled: true }
			})
			if (settings?.vectorizationEnabled) {
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
	return [...priorityQueue]
}

export function getCompletedHistory(): CompletedGroup[] {
	return [...completedHistory]
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

	const group: PriorityGroup = {
		groupId: randomUUID(),
		label: session.name ?? `Session #${sessionId}`,
		ownerDisplayName,
		sessionId,
		lorebookIds,
		characterIds,
		personaIds
	}

	// Remove any existing group for this session, then prepend
	priorityQueue = [
		group,
		...priorityQueue.filter((g) => g.sessionId !== sessionId)
	]

	if (!isRunning && !isPaused) {
		runQueue()
	}

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
	const group: PriorityGroup = {
		groupId: randomUUID(),
		label,
		ownerDisplayName,
		lorebookIds: [lorebookId],
		characterIds: [],
		personaIds: []
	}

	// Remove existing standalone group for this lorebook
	priorityQueue = [
		group,
		...priorityQueue.filter(
			(g) =>
				!(
					g.lorebookIds.includes(lorebookId) &&
					!g.sessionId &&
					g.characterIds.length === 0
				)
		)
	]

	if (!isRunning && !isPaused) runQueue()
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

	const group: PriorityGroup = {
		groupId: randomUUID(),
		label: name,
		ownerDisplayName,
		lorebookIds: char?.lorebookId ? [char.lorebookId] : [],
		characterIds: [characterId],
		personaIds: []
	}

	// Remove existing standalone group for this character
	priorityQueue = [
		group,
		...priorityQueue.filter(
			(g) => !(g.characterIds.includes(characterId) && !g.sessionId)
		)
	]

	if (!isRunning && !isPaused) runQueue()
	return group
}

/**
 * Enqueue a persona at the front of the queue.
 */
export async function enqueuePersonaGroup(
	personaId: number,
	name: string
): Promise<PriorityGroup> {
	const persona = await db.query.personas.findFirst({
		where: eq(schema.personas.id, personaId),
		columns: { userId: true }
	})
	const owner = persona
		? await db.query.users.findFirst({
				where: eq(schema.users.id, persona.userId),
				columns: { username: true, displayName: true }
			})
		: null
	const ownerDisplayName = owner?.displayName ?? owner?.username ?? "Unknown"

	const group: PriorityGroup = {
		groupId: randomUUID(),
		label: name,
		ownerDisplayName,
		lorebookIds: [],
		characterIds: [],
		personaIds: [personaId]
	}

	priorityQueue = [
		group,
		...priorityQueue.filter(
			(g) =>
				!(
					g.personaIds.includes(personaId) &&
					!g.sessionId &&
					g.characterIds.length === 0
				)
		)
	]
	if (!isRunning && !isPaused) runQueue()
	return group
}

export function moveQueueGroup(
	groupId: string,
	direction: "up" | "down"
): void {
	const idx = priorityQueue.findIndex((g) => g.groupId === groupId)
	if (idx === -1) return

	if (direction === "up" && idx > 0) {
		;[priorityQueue[idx - 1], priorityQueue[idx]] = [
			priorityQueue[idx],
			priorityQueue[idx - 1]
		]
	} else if (direction === "down" && idx < priorityQueue.length - 1) {
		;[priorityQueue[idx], priorityQueue[idx + 1]] = [
			priorityQueue[idx + 1],
			priorityQueue[idx]
		]
	}
}

export function removeQueueGroup(groupId: string): void {
	priorityQueue = priorityQueue.filter((g) => g.groupId !== groupId)
}

// ---------------------------------------------------------------------------
// Queue runner
// ---------------------------------------------------------------------------

function broadcastStatus(
	status: VectorizationProgressEvent["status"],
	currentItem?: VectorizationProgressEvent["currentItem"]
) {
	const payload = {
		status,
		currentItem,
		queued: priorityQueue.length,
		completed: totalCompleted,
		priorityQueue: getPriorityQueue(),
		history: getCompletedHistory()
	} satisfies VectorizationProgressEvent
	for (const emit of progressEmitters) {
		try {
			emit("vectorization:progress", payload)
		} catch {}
	}
}

async function runQueue() {
	if (isRunning) return
	isRunning = true
	broadcastStatus("running")

	try {
		while (!shouldStop) {
			if (isPaused) {
				await sleep(500)
				continue
			}

			let item: QueueItem | null
			if (!isModelReady()) {
				// Peek before paying the load cost: pickNextItem() is
				// normally keyed on the *loaded* model's identity, which is
				// always null here — so it'd always report "nothing to do"
				// pre-load regardless of whether a real backlog exists.
				// getConfiguredModelId() gives the identity the model WOULD
				// load under without loading it (verified byte-identical to
				// the post-load id, both modes — see index.ts), so the
				// check can run first. An instance with nothing to do never
				// pays the model-load cost, matching this function's own
				// long-standing intent (see startPeriodicVectorizationScan's
				// doc comment) that the unconditional load below used to
				// silently defeat.
				const candidateModel = await getConfiguredModelId()
				if (!candidateModel) break // disabled or unconfigured

				const peeked = await pickNextItem(candidateModel)
				if (!peeked) break // genuinely nothing to do — never load

				// Mode-aware: branches on vectorizationConfigs.mode to load
				// the local pipeline or activate the API backend correctly
				// (previously always called loadEmbeddingModel() here
				// regardless of mode, which rejected an API-mode composite
				// model id as "Unknown embedding model" — silently masked
				// as long as something else loaded the correct backend
				// first, which stops being guaranteed once this is the only
				// on-demand load path).
				try {
					await loadConfiguredEmbeddingModel()
				} catch (err) {
					console.error(
						"[vectorization] Failed to auto-load model:",
						err
					)
					break
				}
				if (!isModelReady()) {
					console.warn(
						"[vectorization] Queue stopped: vectorization disabled or embedding backend not ready"
					)
					break
				}
				// Reuse the peeked item rather than re-picking now that the
				// model is loaded: a successful pickNextItem() call rotates
				// the front priority group to the back (round-robin
				// fairness) as a side effect of finding an item, not only
				// when a group is exhausted — picking twice for what's
				// conceptually the same "next item" would double-rotate
				// that bookkeeping with only one item actually processed.
				item = peeked
			} else {
				item = await pickNextItem()
			}
			if (!item) break

			broadcastStatus("running", item.label)

			try {
				await processItem(item)
				totalCompleted++
				itemFailureCounts.delete(itemFailureKey(item))
			} catch (err) {
				console.error(
					"[vectorization] Failed to embed item:",
					item.label,
					err
				)
				const key = itemFailureKey(item)
				const failures = (itemFailureCounts.get(key) ?? 0) + 1
				itemFailureCounts.set(key, failures)
				// Exponential backoff, capped at 30s — since the item still
				// isn't marked done, pickNextItem() will hand it straight
				// back next iteration; this just stops that from being an
				// instant, uncapped retry loop.
				await sleep(Math.min(2000 * failures, 30_000))
			}
		}
	} finally {
		isRunning = false
		shouldStop = false
		broadcastStatus("idle")
	}
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

// Exported only so tests can exercise the round-robin fairness logic
// directly — every real caller is runQueue() below.
//
// modelIdOverride lets a caller check for pending work against a model
// that isn't loaded yet (runQueue()'s peek-before-load, using
// getConfiguredModelId()'s pre-load candidate) — defaults to the loaded
// model's id, the original (and still normal, once-loaded) behavior.
export async function pickNextItem(
	modelIdOverride?: string
): Promise<QueueItem | null> {
	const currentModel = modelIdOverride ?? getLoadedModelId()
	if (!currentModel) return null

	// Round-robin across priority groups — one item from the front group,
	// then rotate it to the back, rather than fully draining a group before
	// any other group gets a single item processed. Without this, one large
	// group (eg. a freshly bulk-imported lorebook) starves every other
	// user's group until it finishes completely. A group is only removed
	// (and moved to history) once pickFromGroup returns nothing for it.
	const groupCount = priorityQueue.length
	for (let i = 0; i < groupCount; i++) {
		const group = priorityQueue[0]
		const item = await pickFromGroup(group, currentModel)
		if (item) {
			priorityQueue.push(priorityQueue.shift()!)
			return item
		}
		// Group fully processed — record in history and remove it
		priorityQueue.shift()
		completedHistory.unshift({
			...group,
			completedAt: new Date().toISOString()
		})
		if (completedHistory.length > HISTORY_MAX) completedHistory.pop()
		broadcastStatus("running")
	}

	// Fall through to global sweep (keeps original priority order)
	return pickGlobalNextItem(currentModel)
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

	// 4. Personas
	if (group.personaIds.length > 0) {
		const persona = await pickPersona(currentModel, group.personaIds)
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
		(await pickPersona(currentModel)) ??
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
	sessionId?: number
): Promise<QueueItem | null> {
	const staleness = needsEmbedding(
		schema.sessionMessages.embedding,
		schema.sessionMessages.embeddingModel,
		currentModel,
		schema.sessionMessages.updatedAt,
		schema.sessionMessages.vectorizedAt
	)
	const where = sessionId
		? and(eq(schema.sessionMessages.sessionId, sessionId), staleness)
		: staleness

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
	return {
		label: { type: "message", label: `Session message #${id}` },
		id,
		embeddingModel: currentModel,
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
	}
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

async function pickWorldLoreEntry(
	currentModel: string,
	lorebookId?: number
): Promise<QueueItem | null> {
	const staleness = needsEmbedding(
		schema.worldLoreEntries.embedding,
		schema.worldLoreEntries.embeddingModel,
		currentModel,
		schema.worldLoreEntries.updatedAt,
		schema.worldLoreEntries.vectorizedAt
	)
	const where = lorebookId
		? and(eq(schema.worldLoreEntries.lorebookId, lorebookId), staleness)
		: staleness

	const rows = await db
		.select({
			id: schema.worldLoreEntries.id,
			content: schema.worldLoreEntries.content,
			name: schema.worldLoreEntries.name,
			lorebookId: schema.worldLoreEntries.lorebookId,
			updatedAtRaw: sql<string>`${schema.worldLoreEntries.updatedAt}::text`
		})
		.from(schema.worldLoreEntries)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const {
		id,
		content,
		name,
		lorebookId: rowLorebookId,
		updatedAtRaw
	} = rows[0]
	const text = name ? `${name}\n${content}` : content
	return {
		label: { type: "worldLore", label: `World lore: ${name || id}` },
		id,
		lorebookId: rowLorebookId,
		embeddingModel: currentModel,
		process: async () => {
			const vector = await embed(truncateForEmbedding(text))
			await writeEmbeddingIfFresh(
				schema.worldLoreEntries,
				schema.worldLoreEntries.id,
				schema.worldLoreEntries.updatedAt,
				id,
				updatedAtRaw,
				currentModel,
				vector
			)
		}
	}
}

async function pickCharacterLoreEntry(
	currentModel: string,
	lorebookId?: number
): Promise<QueueItem | null> {
	const staleness = needsEmbedding(
		schema.characterLoreEntries.embedding,
		schema.characterLoreEntries.embeddingModel,
		currentModel,
		schema.characterLoreEntries.updatedAt,
		schema.characterLoreEntries.vectorizedAt
	)
	const where = lorebookId
		? and(eq(schema.characterLoreEntries.lorebookId, lorebookId), staleness)
		: staleness

	const rows = await db
		.select({
			id: schema.characterLoreEntries.id,
			content: schema.characterLoreEntries.content,
			name: schema.characterLoreEntries.name,
			lorebookId: schema.characterLoreEntries.lorebookId,
			updatedAtRaw: sql<string>`${schema.characterLoreEntries.updatedAt}::text`
		})
		.from(schema.characterLoreEntries)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const {
		id,
		content,
		name,
		lorebookId: rowLorebookId,
		updatedAtRaw
	} = rows[0]
	const text = name ? `${name}\n${content}` : content
	return {
		label: {
			type: "characterLore",
			label: `Character lore: ${name || id}`
		},
		id,
		lorebookId: rowLorebookId,
		embeddingModel: currentModel,
		process: async () => {
			const vector = await embed(truncateForEmbedding(text))
			await writeEmbeddingIfFresh(
				schema.characterLoreEntries,
				schema.characterLoreEntries.id,
				schema.characterLoreEntries.updatedAt,
				id,
				updatedAtRaw,
				currentModel,
				vector
			)
		}
	}
}

async function pickHistoryEntry(
	currentModel: string,
	lorebookId?: number
): Promise<QueueItem | null> {
	const staleness = needsEmbedding(
		schema.historyEntries.embedding,
		schema.historyEntries.embeddingModel,
		currentModel,
		schema.historyEntries.updatedAt,
		schema.historyEntries.vectorizedAt
	)
	const where = lorebookId
		? and(eq(schema.historyEntries.lorebookId, lorebookId), staleness)
		: staleness

	const rows = await db
		.select({
			id: schema.historyEntries.id,
			content: schema.historyEntries.content,
			lorebookId: schema.historyEntries.lorebookId,
			updatedAtRaw: sql<string>`${schema.historyEntries.updatedAt}::text`
		})
		.from(schema.historyEntries)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const { id, content, lorebookId: rowLorebookId, updatedAtRaw } = rows[0]
	return {
		label: { type: "historyEntry", label: `History entry #${id}` },
		id,
		lorebookId: rowLorebookId,
		embeddingModel: currentModel,
		process: async () => {
			const vector = await embed(truncateForEmbedding(content))
			await writeEmbeddingIfFresh(
				schema.historyEntries,
				schema.historyEntries.id,
				schema.historyEntries.updatedAt,
				id,
				updatedAtRaw,
				currentModel,
				vector
			)
		}
	}
}

async function pickNarrativeNode(
	currentModel: string,
	lorebookId?: number
): Promise<QueueItem | null> {
	const staleness = needsEmbedding(
		schema.lorebookBindings.embedding,
		schema.lorebookBindings.embeddingModel,
		currentModel,
		schema.lorebookBindings.updatedAt,
		schema.lorebookBindings.vectorizedAt
	)
	const where = lorebookId
		? and(eq(schema.lorebookBindings.lorebookId, lorebookId), staleness)
		: staleness

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
	return {
		label: { type: "narrativeNode", label: `Narrative node: ${name}` },
		id,
		lorebookId: rowLorebookId,
		embeddingModel: currentModel,
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
	}
}

async function pickNarrativeRelationship(
	currentModel: string,
	lorebookId?: number
): Promise<QueueItem | null> {
	const staleness = needsEmbedding(
		schema.narrativeRelationships.embedding,
		schema.narrativeRelationships.embeddingModel,
		currentModel,
		schema.narrativeRelationships.updatedAt,
		schema.narrativeRelationships.vectorizedAt
	)
	const where = lorebookId
		? and(
				eq(schema.narrativeRelationships.lorebookId, lorebookId),
				staleness
			)
		: staleness

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

	return {
		label: {
			type: "narrativeRelationship",
			label: `Narrative relationship: ${fromName} → ${toName}`
		},
		id,
		lorebookId: rowLorebookId,
		embeddingModel: currentModel,
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
	}
}

async function pickCharacter(
	currentModel: string,
	characterIds?: number[]
): Promise<QueueItem | null> {
	if (characterIds !== undefined && characterIds.length === 0) return null

	const staleness = needsEmbedding(
		schema.characters.embedding,
		schema.characters.embeddingModel,
		currentModel,
		schema.characters.updatedAt,
		schema.characters.vectorizedAt
	)
	const where =
		characterIds && characterIds.length > 0
			? and(inArray(schema.characters.id, characterIds), staleness)
			: staleness

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
	return {
		label: { type: "character", label: `Character: ${name}` },
		id,
		embeddingModel: currentModel,
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
	}
}

async function pickPersona(
	currentModel: string,
	personaIds?: number[]
): Promise<QueueItem | null> {
	if (personaIds !== undefined && personaIds.length === 0) return null

	const staleness = needsEmbedding(
		schema.personas.embedding,
		schema.personas.embeddingModel,
		currentModel,
		schema.personas.updatedAt,
		schema.personas.vectorizedAt
	)
	const where =
		personaIds && personaIds.length > 0
			? and(inArray(schema.personas.id, personaIds), staleness)
			: staleness

	const rows = await db
		.select({
			id: schema.personas.id,
			name: schema.personas.name,
			description: schema.personas.description,
			updatedAtRaw: sql<string>`${schema.personas.updatedAt}::text`
		})
		.from(schema.personas)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const { id, name, description, updatedAtRaw } = rows[0]
	const text = `${name}\n${description}`
	return {
		label: { type: "persona", label: `Persona: ${name}` },
		id,
		embeddingModel: currentModel,
		process: async () => {
			const vector = await embed(truncateForEmbedding(text))
			await writeEmbeddingIfFresh(
				schema.personas,
				schema.personas.id,
				schema.personas.updatedAt,
				id,
				updatedAtRaw,
				currentModel,
				vector
			)
		}
	}
}

async function processItem(item: QueueItem) {
	await item.process()
	// Per-item DB rows get their embedding/vectorizedAt updated inside
	// item.process(), but nothing previously told connected clients which
	// specific item changed — the per-item "vectorized/stale" badges in list
	// UIs only ever refreshed on the next explicit CRUD action, leaving them
	// showing a stale state until a manual page refresh.
	if (item.label) {
		const payload = {
			type: item.label.type,
			id: item.id,
			lorebookId: item.lorebookId,
			embeddingModel: item.embeddingModel,
			vectorizedAt: new Date().toISOString()
		} satisfies VectorizationItemUpdatedEvent
		for (const emit of progressEmitters) {
			try {
				emit("vectorization:itemUpdated", payload)
			} catch {}
		}
	}
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms))
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
		db.$count(
			schema.worldLoreEntries,
			condition(
				schema.worldLoreEntries.embedding,
				schema.worldLoreEntries.embeddingModel
			)
		),
		db.$count(
			schema.characterLoreEntries,
			condition(
				schema.characterLoreEntries.embedding,
				schema.characterLoreEntries.embeddingModel
			)
		),
		db.$count(
			schema.historyEntries,
			condition(
				schema.historyEntries.embedding,
				schema.historyEntries.embeddingModel
			)
		),
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
		),
		db.$count(
			schema.personas,
			condition(schema.personas.embedding, schema.personas.embeddingModel)
		)
	])
	return counts.reduce((sum, n) => sum + Number(n), 0)
}

// ---------------------------------------------------------------------------
// Auto-enqueue helpers — called by socket handlers after content saves
// ---------------------------------------------------------------------------

async function isVectorizationEnabled(): Promise<boolean> {
	const settings = await db.query.systemSettings.findFirst({
		columns: { vectorizationEnabled: true }
	})
	return settings?.vectorizationEnabled ?? false
}

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

export async function autoEnqueuePersona(
	personaId: number,
	personaName: string
) {
	if (!(await isVectorizationEnabled())) return
	await enqueuePersonaGroup(personaId, personaName)
}

export async function autoEnqueueSession(sessionId: number) {
	if (!(await isVectorizationEnabled())) return
	await enqueueSessionGroup(sessionId)
}
