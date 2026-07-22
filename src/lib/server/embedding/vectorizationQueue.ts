/**
 * Background vectorization queue.
 *
 * Processes embedding jobs one at a time with:
 *  - Pause/resume support (paused during active chat generation)
 *  - Socket progress events for the global UI indicator
 *  - Priority groups: chats (with their lorebooks + characters) can be moved
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
	gt
} from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	embed,
	isModelReady,
	getLoadedModelId,
	loadEmbeddingModel
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
 * Typically one group per chat, containing the chat's messages, its
 * lorebook entries, and its linked characters/personas.
 */
export type PriorityGroup = {
	groupId: string
	label: string
	ownerDisplayName: string
	chatId?: number
	/** All lorebook IDs associated with this group (chat lorebook + character lorebooks) */
	lorebookIds: number[]
	characterIds: number[]
	personaIds: number[]
}

export type CompletedGroup = PriorityGroup & {
	completedAt: string // ISO timestamp
}

const HISTORY_MAX = 20

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
let emitProgress: EmitFn | null = null
let priorityQueue: PriorityGroup[] = []
let completedHistory: CompletedGroup[] = []

// ---------------------------------------------------------------------------
// Public control API
// ---------------------------------------------------------------------------

export function setProgressEmitter(fn: EmitFn) {
	emitProgress = fn
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
	runQueue()
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
 * Enqueue a chat and all its associated content (lorebooks, characters, personas)
 * at the front of the priority queue. If the chat is already in the queue, it is
 * moved to the front. Starts the queue if it isn't already running.
 */
export async function enqueueChatGroup(chatId: number): Promise<PriorityGroup> {
	const chat = await db.query.chats.findFirst({
		where: eq(schema.chats.id, chatId),
		columns: { id: true, name: true, lorebookId: true, userId: true }
	})

	if (!chat) throw new Error(`Chat ${chatId} not found`)

	const [chatCharsRows, chatPersonasRows] = await Promise.all([
		db
			.select({
				characterId: schema.chatCharacters.characterId,
				charLorebookId: schema.characters.lorebookId
			})
			.from(schema.chatCharacters)
			.leftJoin(
				schema.characters,
				eq(schema.chatCharacters.characterId, schema.characters.id)
			)
			.where(eq(schema.chatCharacters.chatId, chatId)),
		db
			.select({ personaId: schema.chatPersonas.personaId })
			.from(schema.chatPersonas)
			.where(eq(schema.chatPersonas.chatId, chatId))
	])

	const lorebookIds: number[] = []
	if (chat.lorebookId) lorebookIds.push(chat.lorebookId)

	const characterIds: number[] = []
	for (const cc of chatCharsRows) {
		if (cc.characterId) characterIds.push(cc.characterId)
		if (cc.charLorebookId && !lorebookIds.includes(cc.charLorebookId)) {
			lorebookIds.push(cc.charLorebookId)
		}
	}

	const personaIds: number[] = []
	for (const cp of chatPersonasRows) {
		if (cp.personaId) personaIds.push(cp.personaId)
	}

	const owner = await db.query.users.findFirst({
		where: eq(schema.users.id, chat.userId),
		columns: { username: true, displayName: true }
	})
	const ownerDisplayName = owner?.displayName ?? owner?.username ?? "Unknown"

	const group: PriorityGroup = {
		groupId: randomUUID(),
		label: chat.name ?? `Chat #${chatId}`,
		ownerDisplayName,
		chatId,
		lorebookIds,
		characterIds,
		personaIds
	}

	// Remove any existing group for this chat, then prepend
	priorityQueue = [group, ...priorityQueue.filter((g) => g.chatId !== chatId)]

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
					!g.chatId &&
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
			(g) => !(g.characterIds.includes(characterId) && !g.chatId)
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
					!g.chatId &&
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
	emitProgress?.("vectorization:progress", {
		status,
		currentItem,
		queued: priorityQueue.length,
		completed: totalCompleted,
		priorityQueue: getPriorityQueue(),
		history: getCompletedHistory()
	} satisfies VectorizationProgressEvent)
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

			if (!isModelReady()) {
				// Try to auto-load the model from system settings
				const settings = await db.query.systemSettings.findFirst({
					columns: {
						vectorizationEnabled: true,
						embeddingModelName: true
					}
				})
				if (
					!settings?.vectorizationEnabled ||
					!settings.embeddingModelName
				) {
					console.warn(
						"[vectorization] Queue stopped: vectorization disabled or no model configured"
					)
					break
				}
				try {
					await loadEmbeddingModel(settings.embeddingModelName)
				} catch (err) {
					console.error(
						"[vectorization] Failed to auto-load model:",
						err
					)
					break
				}
				if (!isModelReady()) break
			}

			const item = await pickNextItem()
			if (!item) break

			broadcastStatus("running", item.label)

			try {
				await processItem(item)
				totalCompleted++
			} catch (err) {
				console.error(
					"[vectorization] Failed to embed item:",
					item.label,
					err
				)
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

async function pickNextItem(): Promise<QueueItem | null> {
	const currentModel = getLoadedModelId()
	if (!currentModel) return null

	// Work through priority groups in order; remove each when exhausted
	while (priorityQueue.length > 0) {
		const group = priorityQueue[0]
		const item = await pickFromGroup(group, currentModel)
		if (item) return item
		// Group fully processed — record in history and remove it
		const finished = priorityQueue.shift()!
		completedHistory.unshift({
			...finished,
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
	// 1. Chat messages
	if (group.chatId) {
		const item = await pickChatMessage(currentModel, group.chatId)
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
		(await pickChatMessage(currentModel)) ??
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

async function pickChatMessage(
	currentModel: string,
	chatId?: number
): Promise<QueueItem | null> {
	const staleness = needsEmbedding(
		schema.chatMessages.embedding,
		schema.chatMessages.embeddingModel,
		currentModel,
		schema.chatMessages.updatedAt,
		schema.chatMessages.vectorizedAt
	)
	const where = chatId
		? and(eq(schema.chatMessages.chatId, chatId), staleness)
		: staleness

	const rows = await db
		.select({
			id: schema.chatMessages.id,
			content: schema.chatMessages.content
		})
		.from(schema.chatMessages)
		.where(where)
		.orderBy(desc(schema.chatMessages.chatId), asc(schema.chatMessages.id))
		.limit(1)

	if (!rows.length) return null
	const { id, content } = rows[0]
	return {
		label: { type: "message", label: `Chat message #${id}` },
		id,
		embeddingModel: currentModel,
		process: async () => {
			const vector = await embed(content)
			await db
				.update(schema.chatMessages)
				.set({
					embedding: vector,
					embeddingModel: currentModel,
					vectorizedAt: new Date()
				})
				.where(eq(schema.chatMessages.id, id))
		}
	}
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
			lorebookId: schema.worldLoreEntries.lorebookId
		})
		.from(schema.worldLoreEntries)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const { id, content, name, lorebookId: rowLorebookId } = rows[0]
	const text = name ? `${name}\n${content}` : content
	return {
		label: { type: "worldLore", label: `World lore: ${name || id}` },
		id,
		lorebookId: rowLorebookId,
		embeddingModel: currentModel,
		process: async () => {
			const vector = await embed(text)
			await db
				.update(schema.worldLoreEntries)
				.set({
					embedding: vector,
					embeddingModel: currentModel,
					vectorizedAt: new Date()
				})
				.where(eq(schema.worldLoreEntries.id, id))
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
			lorebookId: schema.characterLoreEntries.lorebookId
		})
		.from(schema.characterLoreEntries)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const { id, content, name, lorebookId: rowLorebookId } = rows[0]
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
			const vector = await embed(text)
			await db
				.update(schema.characterLoreEntries)
				.set({
					embedding: vector,
					embeddingModel: currentModel,
					vectorizedAt: new Date()
				})
				.where(eq(schema.characterLoreEntries.id, id))
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
			lorebookId: schema.historyEntries.lorebookId
		})
		.from(schema.historyEntries)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const { id, content, lorebookId: rowLorebookId } = rows[0]
	return {
		label: { type: "historyEntry", label: `History entry #${id}` },
		id,
		lorebookId: rowLorebookId,
		embeddingModel: currentModel,
		process: async () => {
			const vector = await embed(content)
			await db
				.update(schema.historyEntries)
				.set({
					embedding: vector,
					embeddingModel: currentModel,
					vectorizedAt: new Date()
				})
				.where(eq(schema.historyEntries.id, id))
		}
	}
}

async function pickNarrativeNode(
	currentModel: string,
	lorebookId?: number
): Promise<QueueItem | null> {
	const staleness = needsEmbedding(
		schema.narrativeNodes.embedding,
		schema.narrativeNodes.embeddingModel,
		currentModel,
		schema.narrativeNodes.updatedAt,
		schema.narrativeNodes.vectorizedAt
	)
	const where = lorebookId
		? and(eq(schema.narrativeNodes.lorebookId, lorebookId), staleness)
		: staleness

	const rows = await db
		.select({
			id: schema.narrativeNodes.id,
			name: schema.narrativeNodes.name,
			summary: schema.narrativeNodes.summary,
			lorebookId: schema.narrativeNodes.lorebookId
		})
		.from(schema.narrativeNodes)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const { id, name, summary, lorebookId: rowLorebookId } = rows[0]
	const text = summary ? `${name}\n${summary}` : name
	return {
		label: { type: "narrativeNode", label: `Narrative node: ${name}` },
		id,
		lorebookId: rowLorebookId,
		embeddingModel: currentModel,
		process: async () => {
			const vector = await embed(text)
			await db
				.update(schema.narrativeNodes)
				.set({
					embedding: vector,
					embeddingModel: currentModel,
					vectorizedAt: new Date()
				})
				.where(eq(schema.narrativeNodes.id, id))
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
			lorebookId: schema.narrativeRelationships.lorebookId
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
		lorebookId: rowLorebookId
	} = rows[0]

	// Fetch node names for richer embedding text
	const [fromNode, toNode] = await Promise.all([
		db.query.narrativeNodes.findFirst({
			where: eq(schema.narrativeNodes.id, fromNodeId),
			columns: { name: true }
		}),
		db.query.narrativeNodes.findFirst({
			where: eq(schema.narrativeNodes.id, toNodeId),
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
			const vector = await embed(text)
			await db
				.update(schema.narrativeRelationships)
				.set({
					embedding: vector,
					embeddingModel: currentModel,
					vectorizedAt: new Date()
				})
				.where(eq(schema.narrativeRelationships.id, id))
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
			description: schema.characters.description
		})
		.from(schema.characters)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const { id, name, description } = rows[0]
	const text = `${name}\n${description}`
	return {
		label: { type: "character", label: `Character: ${name}` },
		id,
		embeddingModel: currentModel,
		process: async () => {
			const vector = await embed(text)
			await db
				.update(schema.characters)
				.set({
					embedding: vector,
					embeddingModel: currentModel,
					vectorizedAt: new Date()
				})
				.where(eq(schema.characters.id, id))
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
			description: schema.personas.description
		})
		.from(schema.personas)
		.where(where)
		.limit(1)

	if (!rows.length) return null
	const { id, name, description } = rows[0]
	const text = `${name}\n${description}`
	return {
		label: { type: "persona", label: `Persona: ${name}` },
		id,
		embeddingModel: currentModel,
		process: async () => {
			const vector = await embed(text)
			await db
				.update(schema.personas)
				.set({
					embedding: vector,
					embeddingModel: currentModel,
					vectorizedAt: new Date()
				})
				.where(eq(schema.personas.id, id))
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
		emitProgress?.("vectorization:itemUpdated", {
			type: item.label.type,
			id: item.id,
			lorebookId: item.lorebookId,
			embeddingModel: item.embeddingModel,
			vectorizedAt: new Date().toISOString()
		} satisfies VectorizationItemUpdatedEvent)
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
			schema.chatMessages,
			condition(
				schema.chatMessages.embedding,
				schema.chatMessages.embeddingModel
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
			schema.narrativeNodes,
			condition(
				schema.narrativeNodes.embedding,
				schema.narrativeNodes.embeddingModel
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

export async function autoEnqueueChat(chatId: number) {
	if (!(await isVectorizationEnabled())) return
	await enqueueChatGroup(chatId)
}
