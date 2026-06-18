/**
 * RAG context scoping helpers.
 *
 * When performing similarity search, results should be limited to content that
 * is actually associated with the current chat. This prevents pulling in
 * irrelevant context from completely unrelated chats, characters, or lorebooks.
 *
 * Use `getChatRagContext` to resolve a chat's linked content IDs, then pass
 * those IDs to `scopedRankBySimilarity` (or filter manually) to ensure all
 * RAG results are relevant to the active conversation.
 */

import { db } from "$lib/server/db"
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { cosineSimilarity } from "./index"

// ---------------------------------------------------------------------------
// Context resolution
// ---------------------------------------------------------------------------

export type ChatRagContext = {
	chatId: number
	/** IDs of characters linked to the chat via chatCharacters */
	characterIds: number[]
	/** IDs of personas linked to the chat via chatPersonas */
	personaIds: number[]
	/** The chat's primary lorebook ID, if any */
	lorebookId: number | null
	/** IDs of all lorebooks in scope (chat lorebook + each character's lorebook + each persona's lorebook) */
	allLorebookIds: number[]
	/** Map of characterId → that character's lorebookId (only populated characters that have a lorebook) */
	characterLorebookMap: Record<number, number>
	/** Map of personaId → that persona's lorebookId (only populated personas that have a lorebook) */
	personaLorebookMap: Record<number, number>
}

/**
 * Resolve all content IDs that are in scope for RAG search in a given chat.
 * Results from outside this set should not be used as RAG context.
 */
export async function getChatRagContext(chatId: number): Promise<ChatRagContext> {
	const [chat, chatCharsRows, chatPersonasRows] = await Promise.all([
		db.query.chats.findFirst({
			where: eq(schema.chats.id, chatId),
			columns: { lorebookId: true }
		}),
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
			.select({
				personaId: schema.chatPersonas.personaId,
				personaLorebookId: schema.personas.lorebookId
			})
			.from(schema.chatPersonas)
			.leftJoin(schema.personas, eq(schema.chatPersonas.personaId, schema.personas.id))
			.where(eq(schema.chatPersonas.chatId, chatId))
	])

	const lorebookId = chat?.lorebookId ?? null
	const allLorebookIds: number[] = lorebookId ? [lorebookId] : []

	const characterIds: number[] = []
	const characterLorebookMap: Record<number, number> = {}
	for (const cc of chatCharsRows) {
		if (cc.characterId) {
			characterIds.push(cc.characterId)
			if (cc.charLorebookId) {
				characterLorebookMap[cc.characterId] = cc.charLorebookId
				if (!allLorebookIds.includes(cc.charLorebookId)) {
					allLorebookIds.push(cc.charLorebookId)
				}
			}
		}
	}

	const personaIds: number[] = []
	const personaLorebookMap: Record<number, number> = {}
	for (const cp of chatPersonasRows) {
		if (cp.personaId) {
			personaIds.push(cp.personaId)
			if (cp.personaLorebookId) {
				personaLorebookMap[cp.personaId] = cp.personaLorebookId
				if (!allLorebookIds.includes(cp.personaLorebookId)) {
					allLorebookIds.push(cp.personaLorebookId)
				}
			}
		}
	}

	return { chatId, characterIds, personaIds, lorebookId, allLorebookIds, characterLorebookMap, personaLorebookMap }
}

// ---------------------------------------------------------------------------
// Scoped similarity search
// ---------------------------------------------------------------------------

export type ScopedRagItem =
	| {
			source: "message"
			chatId: number
			id: number
			content: string
			embedding: number[]
			embeddingModel: string | null
			score: number
	  }
	| {
			source: "worldLore" | "characterLore"
			lorebookId: number
			id: number
			name: string
			content: string
			embedding: number[]
			embeddingModel: string | null
			score: number
	  }
	| {
			source: "historyEntry"
			lorebookId: number
			id: number
			name: ""
			content: string
			year: number
			month: number | null
			day: number | null
			embedding: number[]
			embeddingModel: string | null
			score: number
	  }
	| {
			source: "narrativeNode"
			lorebookId: number
			id: number
			nodeType: string
			name: string
			summary: string | null
			embedding: number[]
			embeddingModel: string | null
			score: number
	  }
	| {
			source: "narrativeRelationship"
			lorebookId: number
			id: number
			fromNodeId: number
			toNodeId: number
			relationshipType: string
			description: string
			status: string
			reason: string | null
			embedding: number[]
			embeddingModel: string | null
			score: number
	  }
	| {
			source: "character"
			id: number
			name: string
			description: string
			embedding: number[]
			embeddingModel: string | null
			score: number
	  }
	| {
			source: "persona"
			id: number
			name: string
			description: string
			embedding: number[]
			embeddingModel: string | null
			score: number
	  }

export type ScopedRagOptions = {
	topK?: number
	/** Only return results from these content types */
	sources?: Array<
		| "message"
		| "worldLore"
		| "characterLore"
		| "historyEntry"
		| "narrativeNode"
		| "narrativeRelationship"
		| "character"
		| "persona"
	>
	/** Active embedding model — items from other models are excluded */
	modelId: string
	/**
	 * For messages: exclude the N most recent (they're already in the context window).
	 * Defaults to 10.
	 */
	excludeRecentMessages?: number
}

/**
 * Run a similarity search over all content associated with the given chat context.
 * Results are scoped to only include content linked to this chat, filtered to the
 * active embedding model, and sorted by cosine similarity descending.
 */
export async function scopedRankBySimilarity(
	queryEmbedding: number[],
	context: ChatRagContext,
	opts: ScopedRagOptions
): Promise<ScopedRagItem[]> {
	const { modelId, topK, sources, excludeRecentMessages = 10 } = opts

	const include = (source: ScopedRagItem["source"]) =>
		!sources || sources.includes(source as any)

	const candidates: ScopedRagItem[] = []

	// Messages from this chat (exclude the N most recent)
	if (include("message")) {
		// Get recent message IDs to skip
		let recentIds: number[] = []
		if (excludeRecentMessages > 0) {
			const recent = await db
				.select({ id: schema.chatMessages.id })
				.from(schema.chatMessages)
				.where(eq(schema.chatMessages.chatId, context.chatId))
				.orderBy(desc(schema.chatMessages.id))
				.limit(excludeRecentMessages)
			recentIds = recent.map((r) => r.id)
		}

		const messages = await db
			.select({
				id: schema.chatMessages.id,
				content: schema.chatMessages.content,
				embedding: schema.chatMessages.embedding,
				embeddingModel: schema.chatMessages.embeddingModel
			})
			.from(schema.chatMessages)
			.where(
				and(
					eq(schema.chatMessages.chatId, context.chatId),
					eq(schema.chatMessages.isHidden, false),
					isNotNull(schema.chatMessages.embedding),
					eq(schema.chatMessages.embeddingModel, modelId)
				)
			)
			.orderBy(asc(schema.chatMessages.id))

		for (const msg of messages) {
			if (recentIds.includes(msg.id)) continue
			if (!msg.embedding) continue
			candidates.push({
				source: "message",
				chatId: context.chatId,
				id: msg.id,
				content: msg.content,
				embedding: msg.embedding,
				embeddingModel: msg.embeddingModel,
				score: cosineSimilarity(queryEmbedding, msg.embedding)
			})
		}
	}

	// Lorebook content (world lore, character lore, history entries)
	if (context.allLorebookIds.length > 0) {

		if (include("worldLore")) {
			const wles = await db
				.select({
					id: schema.worldLoreEntries.id,
					lorebookId: schema.worldLoreEntries.lorebookId,
					name: schema.worldLoreEntries.name,
					content: schema.worldLoreEntries.content,
					embedding: schema.worldLoreEntries.embedding,
					embeddingModel: schema.worldLoreEntries.embeddingModel
				})
				.from(schema.worldLoreEntries)
				.where(
					and(
						inArray(schema.worldLoreEntries.lorebookId, context.allLorebookIds),
						eq(schema.worldLoreEntries.enabled, true),
						isNotNull(schema.worldLoreEntries.embedding),
						eq(schema.worldLoreEntries.embeddingModel, modelId)
					)
				)

			for (const wle of wles) {
				if (!wle.embedding) continue
				candidates.push({
					source: "worldLore",
					lorebookId: wle.lorebookId,
					id: wle.id,
					name: wle.name,
					content: wle.content,
					embedding: wle.embedding,
					embeddingModel: wle.embeddingModel,
					score: cosineSimilarity(queryEmbedding, wle.embedding)
				})
			}
		}

		if (include("characterLore")) {
			const cles = await db
				.select({
					id: schema.characterLoreEntries.id,
					lorebookId: schema.characterLoreEntries.lorebookId,
					name: schema.characterLoreEntries.name,
					content: schema.characterLoreEntries.content,
					embedding: schema.characterLoreEntries.embedding,
					embeddingModel: schema.characterLoreEntries.embeddingModel
				})
				.from(schema.characterLoreEntries)
				.where(
					and(
						inArray(schema.characterLoreEntries.lorebookId, context.allLorebookIds),
						eq(schema.characterLoreEntries.enabled, true),
						isNotNull(schema.characterLoreEntries.embedding),
						eq(schema.characterLoreEntries.embeddingModel, modelId)
					)
				)

			for (const cle of cles) {
				if (!cle.embedding) continue
				candidates.push({
					source: "characterLore",
					lorebookId: cle.lorebookId,
					id: cle.id,
					name: cle.name,
					content: cle.content,
					embedding: cle.embedding,
					embeddingModel: cle.embeddingModel,
					score: cosineSimilarity(queryEmbedding, cle.embedding)
				})
			}
		}

		if (include("historyEntry")) {
			const hes = await db
				.select({
					id: schema.historyEntries.id,
					lorebookId: schema.historyEntries.lorebookId,
					content: schema.historyEntries.content,
					year: schema.historyEntries.year,
					month: schema.historyEntries.month,
					day: schema.historyEntries.day,
					embedding: schema.historyEntries.embedding,
					embeddingModel: schema.historyEntries.embeddingModel
				})
				.from(schema.historyEntries)
				.where(
					and(
						inArray(schema.historyEntries.lorebookId, context.allLorebookIds),
						eq(schema.historyEntries.enabled, true),
						isNotNull(schema.historyEntries.embedding),
						eq(schema.historyEntries.embeddingModel, modelId)
					)
				)

			for (const he of hes) {
				if (!he.embedding) continue
				candidates.push({
					source: "historyEntry",
					lorebookId: he.lorebookId,
					id: he.id,
					name: "",
					content: he.content,
					year: he.year,
					month: he.month,
					day: he.day,
					embedding: he.embedding,
					embeddingModel: he.embeddingModel,
					score: cosineSimilarity(queryEmbedding, he.embedding)
				})
			}
		}

		if (include("narrativeNode")) {
			const nodes = await db
				.select({
					id: schema.narrativeNodes.id,
					lorebookId: schema.narrativeNodes.lorebookId,
					nodeType: schema.narrativeNodes.nodeType,
					name: schema.narrativeNodes.name,
					summary: schema.narrativeNodes.summary,
					embedding: schema.narrativeNodes.embedding,
					embeddingModel: schema.narrativeNodes.embeddingModel
				})
				.from(schema.narrativeNodes)
				.where(
					and(
						inArray(schema.narrativeNodes.lorebookId, context.allLorebookIds),
						isNotNull(schema.narrativeNodes.embedding),
						eq(schema.narrativeNodes.embeddingModel, modelId)
					)
				)
			for (const node of nodes) {
				if (!node.embedding) continue
				candidates.push({
					source: "narrativeNode",
					lorebookId: node.lorebookId,
					id: node.id,
					nodeType: node.nodeType,
					name: node.name,
					summary: node.summary,
					embedding: node.embedding,
					embeddingModel: node.embeddingModel,
					score: cosineSimilarity(queryEmbedding, node.embedding)
				})
			}
		}

		if (include("narrativeRelationship")) {
			const rels = await db
				.select({
					id: schema.narrativeRelationships.id,
					lorebookId: schema.narrativeRelationships.lorebookId,
					fromNodeId: schema.narrativeRelationships.fromNodeId,
					toNodeId: schema.narrativeRelationships.toNodeId,
					relationshipType: schema.narrativeRelationships.relationshipType,
					description: schema.narrativeRelationships.description,
					status: schema.narrativeRelationships.status,
					reason: schema.narrativeRelationships.reason,
					embedding: schema.narrativeRelationships.embedding,
					embeddingModel: schema.narrativeRelationships.embeddingModel
				})
				.from(schema.narrativeRelationships)
				.where(
					and(
						inArray(schema.narrativeRelationships.lorebookId, context.allLorebookIds),
						isNotNull(schema.narrativeRelationships.embedding),
						eq(schema.narrativeRelationships.embeddingModel, modelId)
					)
				)
			for (const rel of rels) {
				if (!rel.embedding) continue
				candidates.push({
					source: "narrativeRelationship",
					lorebookId: rel.lorebookId,
					id: rel.id,
					fromNodeId: rel.fromNodeId,
					toNodeId: rel.toNodeId,
					relationshipType: rel.relationshipType,
					description: rel.description,
					status: rel.status,
					reason: rel.reason,
					embedding: rel.embedding,
					embeddingModel: rel.embeddingModel,
					score: cosineSimilarity(queryEmbedding, rel.embedding)
				})
			}
		}
	}

	// Characters linked to this chat
	if (include("character") && context.characterIds.length > 0) {
		const chars = await db
			.select({
				id: schema.characters.id,
				name: schema.characters.name,
				description: schema.characters.description,
				embedding: schema.characters.embedding,
				embeddingModel: schema.characters.embeddingModel
			})
			.from(schema.characters)
			.where(
				and(
					inArray(schema.characters.id, context.characterIds),
					isNotNull(schema.characters.embedding),
					eq(schema.characters.embeddingModel, modelId)
				)
			)

		for (const char of chars) {
			if (!char.embedding) continue
			candidates.push({
				source: "character",
				id: char.id,
				name: char.name,
				description: char.description,
				embedding: char.embedding,
				embeddingModel: char.embeddingModel,
				score: cosineSimilarity(queryEmbedding, char.embedding)
			})
		}
	}

	// Personas linked to this chat
	if (include("persona") && context.personaIds.length > 0) {
		const ps = await db
			.select({
				id: schema.personas.id,
				name: schema.personas.name,
				description: schema.personas.description,
				embedding: schema.personas.embedding,
				embeddingModel: schema.personas.embeddingModel
			})
			.from(schema.personas)
			.where(
				and(
					inArray(schema.personas.id, context.personaIds),
					isNotNull(schema.personas.embedding),
					eq(schema.personas.embeddingModel, modelId)
				)
			)

		for (const p of ps) {
			if (!p.embedding) continue
			candidates.push({
				source: "persona",
				id: p.id,
				name: p.name,
				description: p.description,
				embedding: p.embedding,
				embeddingModel: p.embeddingModel,
				score: cosineSimilarity(queryEmbedding, p.embedding)
			})
		}
	}

	// Sort by score descending and apply topK
	candidates.sort((a, b) => b.score - a.score)
	return topK ? candidates.slice(0, topK) : candidates
}
