/**
 * RAG-based content infill engine.
 *
 * Used instead of KeywordInfillEngine when vectorization is active and the
 * embedding model is ready. Uses semantic similarity search to select the
 * most relevant lore and older messages instead of keyword matching.
 *
 * ## Algorithm
 *
 * ### Guaranteed window (always included)
 * The last MIN_GUARANTEED_MESSAGES chat messages are always present regardless
 * of token budget. This ensures the model always has immediate conversation
 * context.
 *
 * ### Semantic queries (two-pass)
 * Two separate queries are run to handle topic changes gracefully:
 * 1. Current query — the last RAG_CURRENT_WINDOW (2) messages, representing
 *    what is being discussed right now.
 * 2. Recent query — the RAG_RECENT_WINDOW (3) messages before that, representing
 *    broader recent context.
 * Results from the current query are merged first and take priority slots.
 * The recent query only adds items not already returned by the current query.
 *
 * ### Pinned lore (always included)
 * Lore entries with constant=true and enabled=true from all scoped lorebooks
 * are always included regardless of relevance score.
 *
 * ### RAG retrieval
 * scopedRankBySimilarity is called over all content types (messages, worldLore,
 * characterLore, historyEntry) scoped to the chat's linked lorebooks/characters.
 * Results are merged using Reciprocal Rank Fusion (RRF) across per-message
 * queries, reranked with MMR for diversity, and capped per source type.
 *
 * - Message results: older messages that are semantically relevant to the current
 *   conversation are added to the context window.
 * - Lore results: world lore, character lore, and history entries are pulled into
 *   the template context alongside the always-included pinned entries.
 *
 * ### Token budget management
 * 1. All guaranteed + RAG messages are included initially.
 * 2. If over the token limit: oldest messages are trimmed one-by-one.
 * 3. If under the context threshold: remaining older messages (not in RAG) are
 *    added scored by relevance until the budget is consumed.
 */

import { batchEmbed, embed, getLoadedModelId } from "$lib/server/embedding"
import {
	getChatRagContext,
	scopedRankBySimilarity,
	type ScopedRagItem
} from "$lib/server/embedding/ragContext"
import type { BasePromptChat } from "../../connectionAdapters/BaseConnectionAdapter"
import {
	ChatMessageProcessor,
	type ProcessedChatMessage
} from "./ContentProcessors"
import { parseSplitChatPrompt } from "./utils"
import {
	attachCharacterLoreToCharacters,
	isCharacterLoreEntryVisible
} from "./LorebookBindingUtils"
import type {
	RagDiagnostics,
	TemplateContext,
	InfillContentOptions,
	InfillResult
} from "./types"
import { db } from "$lib/server/db"
import { and, asc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { BaseInfillEngine } from "./BaseInfillEngine"
import {
	MAX_GRAPH_PAIRS,
	serializeGraphPairs,
	type GraphPairOutput as SharedGraphPairOutput
} from "./NarrativeGraphContext"
import { resolvePostHistoryContext } from "./PostHistoryContext"

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Most-recent messages used as the "current topic" query.
 * Run first; results take priority slots before the recent query.
 * TODO: make configurable in a future pass.
 */
const RAG_CURRENT_WINDOW = 2

/**
 * Next-most-recent messages used as the "recent context" query.
 * Run second; fills remaining slots after the current query.
 * TODO: make configurable in a future pass.
 */
const RAG_RECENT_WINDOW = 3

/** Per-source-type budget caps applied after RRF + MMR */
const RAG_SOURCE_BUDGET = {
	message: 12,
	worldLore: 8,
	characterLore: 6,
	historyEntry: 6,
	narrativeRelationship: 5
} as const

/** Recency boost amplitude for message scores */
const RAG_RECENCY_BOOST = 0.15
/** Recency decay rate — controls how fast the boost falls off with age */
const RAG_RECENCY_DECAY = 0.01

/** Adaptive score threshold floor */
const RAG_SCORE_THRESHOLD_MIN = 0.3
/** Adaptive threshold: at least this fraction of the top score */
const RAG_RELATIVE_THRESHOLD = 0.7

/** MMR relevance/diversity trade-off (higher = more relevance-focused) */
const MMR_LAMBDA = 0.7

// ─── Helper functions ──────────────────────────────────────────────────────────

type ScoredRagItem = ScopedRagItem & { score: number }

/**
 * Reciprocal Rank Fusion over multiple ranked lists.
 * Returns a map from item id to aggregated RRF score.
 */
function rrfMerge(
	rankedLists: ScopedRagItem[][]
): Map<string, { item: ScopedRagItem; rrfScore: number }> {
	const merged = new Map<string, { item: ScopedRagItem; rrfScore: number }>()
	for (const list of rankedLists) {
		for (let rank = 0; rank < list.length; rank++) {
			const item = list[rank]
			const key = `${item.source}:${item.id}`
			const contribution = 1 / (60 + rank)
			if (merged.has(key)) {
				merged.get(key)!.rrfScore += contribution
			} else {
				merged.set(key, { item, rrfScore: contribution })
			}
		}
	}
	return merged
}

/**
 * Dot product of two vectors (used for MMR inter-item similarity).
 * For normalized embeddings this equals cosine similarity.
 */
function dotProduct(a: number[], b: number[]): number {
	let sum = 0
	const len = Math.min(a.length, b.length)
	for (let i = 0; i < len; i++) sum += a[i] * b[i]
	return sum
}

/**
 * Maximal Marginal Relevance reranking.
 * λ=MMR_LAMBDA balances relevance vs. diversity.
 * Returns items reordered by MMR priority.
 */
function mmrRerank(items: ScoredRagItem[]): ScoredRagItem[] {
	if (items.length <= 1) return items
	const remaining = [...items]
	const selected: ScoredRagItem[] = []

	// Start with highest-scoring item
	remaining.sort((a, b) => b.score - a.score)
	selected.push(remaining.shift()!)

	while (remaining.length > 0) {
		let bestIdx = 0
		let bestMMR = -Infinity
		for (let i = 0; i < remaining.length; i++) {
			const relScore = remaining[i].score
			let maxSim = 0
			for (const sel of selected) {
				const sim = dotProduct(remaining[i].embedding, sel.embedding)
				if (sim > maxSim) maxSim = sim
			}
			const mmr = MMR_LAMBDA * relScore - (1 - MMR_LAMBDA) * maxSim
			if (mmr > bestMMR) {
				bestMMR = mmr
				bestIdx = i
			}
		}
		selected.push(remaining.splice(bestIdx, 1)[0])
	}
	return selected
}

/**
 * Format a chat message for query embedding, including speaker attribution.
 */
function formatMessageForQuery(
	msg: SelectChatMessage,
	chat: BasePromptChat
): string {
	const char = (chat.chatCharacters as any[])?.find(
		(cc: any) => cc.character?.id === msg.characterId
	)?.character
	const persona = (chat.chatPersonas as any[])?.find(
		(cp: any) => cp.persona?.id === msg.personaId
	)?.persona
	const nickname = (char as any)?.nickname
	const speakerName =
		nickname || char?.name || persona?.name || msg.role || "Unknown"
	const cleanContent = (msg.content ?? "").replace(/^\*+|\*+$/gm, "").trim()
	return `[${speakerName}]: ${cleanContent}`
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class RagInfillEngine extends BaseInfillEngine {
	constructor(
		chat: BasePromptChat,
		interpolationEngine: any,
		populateLorebookEntryBindings: (
			entry: any,
			chat: BasePromptChat
		) => any,
		private currentCharacterId: number | null,
		private diagnosticsEnabled: boolean = true
	) {
		super(chat, interpolationEngine, populateLorebookEntryBindings)
	}

	async infillContent({
		charName,
		seedName,
		personaName,
		templateContext,
		useChatFormat = false,
		tokenLimit,
		contextThresholdPercent,
		tokenCounter,
		handlebars,
		contextConfig,
		postHistoryDepth,
		postHistoryTokenTrigger
	}: InfillContentOptions): Promise<InfillResult> {
		const interpolationContext =
			this.interpolationEngine.createInterpolationContext({
				currentCharacterName: charName,
				currentPersonaName: personaName
			})

		// ── 1. Split messages into guaranteed window and older candidates ──────
		const allMessages = this.chat.chatMessages || []
		// allMessages is oldest-first (index 0 = oldest)
		const guaranteedMessages =
			allMessages.length <= RagInfillEngine.MIN_GUARANTEED_MESSAGES
				? allMessages.slice()
				: allMessages.slice(-RagInfillEngine.MIN_GUARANTEED_MESSAGES)
		const olderMessages =
			allMessages.length <= RagInfillEngine.MIN_GUARANTEED_MESSAGES
				? []
				: allMessages.slice(0, -RagInfillEngine.MIN_GUARANTEED_MESSAGES)

		// ── 2. Two-pass RAG retrieval ──────────────────────────────────────────
		const ragOlderMessageIds = new Set<number>()
		const ragWorldLoreItems: Array<{
			id: number
			name: string
			content: string
		}> = []
		const ragCharLoreItems: Array<{
			id: number
			lorebookId: number
			name: string
			content: string
		}> = []
		const ragHistoryItems: Array<{
			id: number
			lorebookId: number
			content: string
			year: number
			month: number | null
			day: number | null
		}> = []
		const ragRelPairMap = new Map<
			string,
			{ fromNodeId: number; toNodeId: number; lorebookId: number }
		>()

		// Diagnostic score tracking
		let diagnosticMessageScores: number[] = []
		let diagnosticLoreScores: number[] = []
		let diagnosticThresholdUsed = 0
		let diagnosticQueryMessageCount = 0

		if (allMessages.length > 0) {
			try {
				const ragContext = await getChatRagContext(this.chat.id)
				const modelId = getLoadedModelId()!

				const currentMessages =
					guaranteedMessages.slice(-RAG_CURRENT_WINDOW)
				const recentMessages = guaranteedMessages.slice(
					-(RAG_CURRENT_WINDOW + RAG_RECENT_WINDOW),
					-RAG_CURRENT_WINDOW
				)

				const seenIds = new Set<string>()

				/**
				 * Run a per-message-embedded query with RRF merging.
				 * Each message is embedded individually; results are fused via RRF.
				 */
				const runQuery = async (messages: SelectChatMessage[]) => {
					const texts = messages
						.map((m) => formatMessageForQuery(m, this.chat))
						.filter((t) => t.trim().length > 0)
					if (texts.length === 0) return []

					// Batch-embed all messages in one call
					let embeddings: number[][]
					try {
						embeddings = await batchEmbed(texts)
					} catch {
						// Fallback: embed individually if batchEmbed fails
						embeddings = await Promise.all(
							texts.map((t) => embed(t))
						)
					}

					// Run a separate scopedRankBySimilarity for each embedding
					const perMsgResults = await Promise.all(
						embeddings.map((emb) =>
							scopedRankBySimilarity(emb, ragContext, {
								modelId,
								topK:
									Math.max(
										RAG_SOURCE_BUDGET.message,
										RAG_SOURCE_BUDGET.worldLore,
										RAG_SOURCE_BUDGET.characterLore,
										RAG_SOURCE_BUDGET.historyEntry,
										RAG_SOURCE_BUDGET.narrativeRelationship
									) * 3,
								sources: [
									"message",
									"worldLore",
									"characterLore",
									"historyEntry",
									"narrativeRelationship"
								],
								excludeRecentMessages: guaranteedMessages.length
							})
						)
					)

					// Merge via RRF
					const rrfMap = rrfMerge(perMsgResults)

					// Convert to array with RRF-as-score for threshold and MMR
					// Normalise RRF scores to [0,1] range relative to max for threshold comparison
					const rrfEntries = Array.from(rrfMap.values())
					if (rrfEntries.length === 0) return []

					const maxRRF = Math.max(
						...rrfEntries.map((e) => e.rrfScore)
					)

					// Produce items with normalised score for threshold filtering & MMR
					const scored = rrfEntries.map(({ item, rrfScore }) => ({
						...item,
						score: maxRRF > 0 ? rrfScore / maxRRF : 0
					}))

					// ── Recency decay boost for messages ────────────────────────────
					const msgCount = allMessages.length
					for (const item of scored) {
						if (item.source !== "message") continue
						// Find position from the end (newer = smaller ageInMessages)
						const idx = allMessages.findIndex(
							(m) => m.id === item.id
						)
						const ageInMessages =
							idx >= 0 ? msgCount - 1 - idx : msgCount
						const boosted =
							item.score *
							(1 +
								RAG_RECENCY_BOOST *
									Math.exp(
										-RAG_RECENCY_DECAY * ageInMessages
									))
						item.score = boosted
					}

					// ── Adaptive score threshold ─────────────────────────────────────
					const topScore = Math.max(...scored.map((s) => s.score), 0)
					const adaptiveThreshold = Math.max(
						RAG_SCORE_THRESHOLD_MIN,
						topScore * RAG_RELATIVE_THRESHOLD
					)
					// Track for diagnostics (update with last computed threshold)
					diagnosticThresholdUsed = adaptiveThreshold

					// ── MMR reranking ────────────────────────────────────────────────
					const aboveThreshold = scored.filter(
						(s) => s.score >= adaptiveThreshold
					)
					const reranked = mmrRerank(aboveThreshold as any)

					// ── Per-source budget caps ───────────────────────────────────────
					const sourceCounts: Record<string, number> = {}
					const budgeted = reranked.filter((item) => {
						const src =
							item.source as keyof typeof RAG_SOURCE_BUDGET
						const budget =
							src in RAG_SOURCE_BUDGET
								? RAG_SOURCE_BUDGET[src]
								: 20
						const count = sourceCounts[src] ?? 0
						if (count >= budget) return false
						sourceCounts[src] = count + 1
						return true
					})

					return budgeted
				}

				const mergeResults = (
					results: Awaited<ReturnType<typeof runQuery>>
				) => {
					for (const item of results) {
						const key = `${item.source}:${item.id}`
						if (seenIds.has(key)) continue
						seenIds.add(key)

						// Accumulate diagnostic scores
						if (this.diagnosticsEnabled) {
							if (item.source === "message") {
								diagnosticMessageScores.push(item.score)
							} else if (
								item.source === "worldLore" ||
								item.source === "characterLore" ||
								item.source === "historyEntry"
							) {
								diagnosticLoreScores.push(item.score)
							}
						}

						if (item.source === "message") {
							ragOlderMessageIds.add(item.id)
						} else if (item.source === "worldLore") {
							ragWorldLoreItems.push({
								id: item.id,
								name: (item as any).name,
								content: item.content
							})
						} else if (item.source === "characterLore") {
							ragCharLoreItems.push({
								id: item.id,
								lorebookId: (item as any).lorebookId,
								name: (item as any).name,
								content: item.content
							})
						} else if (item.source === "historyEntry") {
							ragHistoryItems.push({
								id: item.id,
								lorebookId: (item as any).lorebookId,
								content: item.content,
								year: (item as any).year,
								month: (item as any).month,
								day: (item as any).day
							})
						} else if (item.source === "narrativeRelationship") {
							const pairKey = `${(item as any).fromNodeId}:${(item as any).toNodeId}`
							if (!ragRelPairMap.has(pairKey)) {
								ragRelPairMap.set(pairKey, {
									fromNodeId: (item as any).fromNodeId,
									toNodeId: (item as any).toNodeId,
									lorebookId: (item as any).lorebookId
								})
							}
						}
					}
				}

				// Current-pass results fill slots first; recent-pass fills what remains
				diagnosticQueryMessageCount =
					currentMessages.length + recentMessages.length
				mergeResults(await runQuery(currentMessages))
				mergeResults(await runQuery(recentMessages))
			} catch (err) {
				console.warn(
					"[RagInfillEngine] RAG retrieval failed, continuing without RAG results:",
					err
				)
			}
		}

		// ── 3. Build lore context ──────────────────────────────────────────────
		const lorebook = (this.chat as any).lorebook as
			| {
					worldLoreEntries?: any[]
					characterLoreEntries?: any[]
					historyEntries?: any[]
			  }
			| undefined

		type WorldLoreItem = { id: number; name: string; content: string }
		type HistoryItem = {
			id: number
			year: number
			month: number | null
			day: number | null
			content: string
		}

		// Pinned (constant=true) — never trimmed. RAG-added — trimmable (lowest-score at back).
		const pinnedWorldLoreArr: WorldLoreItem[] = []
		const pinnedCharLoreArr: SelectCharacterLoreEntry[] = []
		const pinnedHistoryArr: HistoryItem[] = []
		const ragWorldLoreArr: WorldLoreItem[] = []
		const ragCharLoreArr: SelectCharacterLoreEntry[] = []
		const ragHistoryArr: HistoryItem[] = []

		const includedWorldLoreIds = new Set<number>()
		const includedCharLoreIds = new Set<number>()
		const includedHistoryIds = new Set<number>()

		// Populate pinned entries first
		for (const entry of (lorebook?.worldLoreEntries ?? []).filter(
			(e: any) => e.constant === true && e.enabled !== false
		)) {
			const populated = this.populateLorebookEntryBindings(
				entry,
				this.chat
			)
			if (populated?.name && populated?.content) {
				pinnedWorldLoreArr.push({
					id: entry.id,
					name: populated.name,
					content: populated.content
				})
			}
			includedWorldLoreIds.add(entry.id)
		}
		for (const entry of (lorebook?.characterLoreEntries ?? []).filter(
			(e: any) =>
				e.constant === true &&
				e.enabled !== false &&
				isCharacterLoreEntryVisible(e, this.chat, this.currentCharacterId)
		)) {
			pinnedCharLoreArr.push(entry)
			includedCharLoreIds.add(entry.id)
		}

		// currentDate = most recent history entry across ALL lorebook entries — a world-state
		// fact, not a RAG-filtered result.
		let mostRecentHistory: {
			year: number
			month: number | null
			day: number | null
		} | null = null
		if (lorebook?.historyEntries?.length) {
			let latestVal = -Infinity
			for (const e of lorebook.historyEntries as any[]) {
				if (e.year == null) continue
				const val =
					(e.year ?? 0) * 10000 + (e.month ?? 0) * 100 + (e.day ?? 0)
				if (val > latestVal) {
					latestVal = val
					mostRecentHistory = {
						year: e.year,
						month: e.month ?? null,
						day: e.day ?? null
					}
				}
			}
		}

		for (const entry of (lorebook?.historyEntries ?? []).filter(
			(e: any) => e.constant === true && e.enabled !== false
		)) {
			const populated = this.populateLorebookEntryBindings(
				entry,
				this.chat
			)
			const content = populated?.content ?? entry.content ?? ""
			if (!content.trim()) continue
			pinnedHistoryArr.push({
				id: entry.id,
				year: entry.year ?? 0,
				month: entry.month ?? null,
				day: entry.day ?? null,
				content
			})
			includedHistoryIds.add(entry.id)
		}
		// Sort pinned history newest-first so the template renders in chronological order
		pinnedHistoryArr.sort((a, b) => {
			const aVal = a.year * 10000 + (a.month ?? 0) * 100 + (a.day ?? 0)
			const bVal = b.year * 10000 + (b.month ?? 0) * 100 + (b.day ?? 0)
			return bVal - aVal
		})

		// Populate RAG-added entries
		for (const item of ragWorldLoreItems) {
			if (includedWorldLoreIds.has(item.id)) continue
			// allLorebookIds is scoped to just chat.lorebook (see ragContext.ts),
			// so every RAG-retrieved item is guaranteed to be found here.
			const fullEntry = lorebook?.worldLoreEntries?.find(
				(e: any) => e.id === item.id
			)
			if (fullEntry) {
				const populated = this.populateLorebookEntryBindings(
					fullEntry,
					this.chat
				)
				if (populated?.name && populated?.content) {
					ragWorldLoreArr.push({
						id: item.id,
						name: populated.name,
						content: populated.content
					})
				}
			}
			includedWorldLoreIds.add(item.id)
		}
		for (const item of ragCharLoreItems) {
			if (includedCharLoreIds.has(item.id)) continue
			const fullEntry = lorebook?.characterLoreEntries?.find(
				(e: any) => e.id === item.id
			)
			if (
				fullEntry &&
				isCharacterLoreEntryVisible(
					fullEntry,
					this.chat,
					this.currentCharacterId
				)
			)
				ragCharLoreArr.push(fullEntry)
			includedCharLoreIds.add(item.id)
		}
		for (const item of ragHistoryItems) {
			if (includedHistoryIds.has(item.id) || !item.content.trim())
				continue
			// allLorebookIds is scoped to just chat.lorebook (see ragContext.ts),
			// so every RAG-retrieved item is guaranteed to be found here.
			const fullEntry = lorebook?.historyEntries?.find(
				(e: any) => e.id === item.id
			)
			if (fullEntry) {
				const content =
					this.populateLorebookEntryBindings(fullEntry, this.chat)
						?.content ?? item.content
				if (content.trim()) {
					ragHistoryArr.push({
						id: item.id,
						year: item.year,
						month: item.month,
						day: item.day,
						content
					})
				}
			}
			includedHistoryIds.add(item.id)
		}
		// RAG history: newest-first so least-recent (oldest) entries are at the back for trimming
		ragHistoryArr.sort((a, b) => {
			const aVal = a.year * 10000 + (a.month ?? 0) * 100 + (a.day ?? 0)
			const bVal = b.year * 10000 + (b.month ?? 0) * 100 + (b.day ?? 0)
			return bVal - aVal
		})

		// ── 3b. Build narrative graph from RAG-retrieved relationship pairs ─────
		// Internal type includes historyEntryId for reason-omission; stripped before output.
		type InternalRelEntry = SharedGraphPairOutput["rels"][number]
		type GraphPairOutput = SharedGraphPairOutput

		const graphPairs: GraphPairOutput[] = []

		if (ragRelPairMap.size > 0) {
			// Current-pass pairs are at the front of the Map — they get priority slots
			const pairsToProcess = Array.from(ragRelPairMap.values()).slice(
				0,
				MAX_GRAPH_PAIRS
			)

			// Batch-fetch node names, summaries, and binding status
			const nodeIdSet = new Set<number>()
			for (const p of pairsToProcess) {
				nodeIdSet.add(p.fromNodeId)
				nodeIdSet.add(p.toNodeId)
			}
			const nodeRows = await db
				.select({
					id: schema.narrativeNodes.id,
					name: schema.narrativeNodes.name,
					summary: schema.narrativeNodes.summary,
					lorebookBindingId: schema.narrativeNodes.lorebookBindingId
				})
				.from(schema.narrativeNodes)
				.where(inArray(schema.narrativeNodes.id, Array.from(nodeIdSet)))
			const nodeInfoMap = new Map(
				nodeRows.map((n) => [
					n.id,
					{
						name: n.name,
						summary: n.summary,
						bound: n.lorebookBindingId != null
					}
				])
			)

			for (const pair of pairsToProcess) {
				const fromInfo = nodeInfoMap.get(pair.fromNodeId)
				const toInfo = nodeInfoMap.get(pair.toNodeId)
				const fromName = fromInfo?.name ?? String(pair.fromNodeId)
				const toName = toInfo?.name ?? String(pair.toNodeId)

				// Fetch all rows for this pair ordered chronologically (id order = insertion order)
				const allRows = await db
					.select({
						id: schema.narrativeRelationships.id,
						relationshipType:
							schema.narrativeRelationships.relationshipType,
						description: schema.narrativeRelationships.description,
						status: schema.narrativeRelationships.status,
						reason: schema.narrativeRelationships.reason,
						historyEntryId:
							schema.narrativeRelationships.historyEntryId
					})
					.from(schema.narrativeRelationships)
					.where(
						and(
							eq(
								schema.narrativeRelationships.lorebookId,
								pair.lorebookId
							),
							eq(
								schema.narrativeRelationships.fromNodeId,
								pair.fromNodeId
							),
							eq(
								schema.narrativeRelationships.toNodeId,
								pair.toNodeId
							)
						)
					)
					.orderBy(asc(schema.narrativeRelationships.id))

				// Dedup by type+status — the retrieved row (possibly historical) plus all active rows
				const seen = new Set<string>()
				const rels: InternalRelEntry[] = []
				for (const r of allRows) {
					const key = `${r.relationshipType}:${r.status}`
					if (seen.has(key)) continue
					seen.add(key)
					const entry: InternalRelEntry = {
						type: r.relationshipType,
						status: r.status,
						historyEntryId: r.historyEntryId
					}
					if (r.description) entry.description = r.description
					if (r.reason) entry.reason = r.reason
					rels.push(entry)
				}

				const fromBound = fromInfo?.bound ?? false
				const toBound = toInfo?.bound ?? false
				graphPairs.push({
					from: fromName,
					fromBound,
					fromDescription: fromBound
						? undefined
						: (fromInfo?.summary ?? undefined),
					to: toName,
					toBound,
					toDescription: toBound
						? undefined
						: (toInfo?.summary ?? undefined),
					fromNodeId: pair.fromNodeId,
					toNodeId: pair.toNodeId,
					lorebookId: pair.lorebookId,
					rels
				})
			}
		}

		// ── 3c. Reason-omission: if a relationship row's source history entry is
		//        already included in the lore section, its reason is redundant ────
		for (const pair of graphPairs) {
			for (const rel of pair.rels) {
				if (
					rel.historyEntryId != null &&
					includedHistoryIds.has(rel.historyEntryId)
				) {
					delete rel.reason
				}
			}
		}

		// ── 3d. Cross-pair node completeness ──────────────────────────────────
		// For every unique node appearing in included pairs, pull in any active
		// relationship between two of those nodes that isn't already included.
		// Happens before message fill-in, after lore (so reason-omission applies).
		const remainingPairSlots = MAX_GRAPH_PAIRS - graphPairs.length
		if (remainingPairSlots > 0 && graphPairs.length >= 2) {
			const includedNodeIds = new Set<number>()
			const includedPairKeys = new Set<string>()
			let sharedLorebookId: number | null = null
			for (const p of graphPairs) {
				includedNodeIds.add(p.fromNodeId)
				includedNodeIds.add(p.toNodeId)
				includedPairKeys.add(`${p.fromNodeId}:${p.toNodeId}`)
				sharedLorebookId = p.lorebookId
			}
			const nodeIdArr = Array.from(includedNodeIds)

			if (sharedLorebookId !== null && nodeIdArr.length >= 2) {
				// Reuse already-fetched node info (name + summary + bound) for cross-pair entries
				const knownInfo = new Map(
					graphPairs.flatMap((p) => [
						[
							p.fromNodeId,
							{
								name: p.from,
								summary: p.fromDescription,
								bound: p.fromBound
							}
						],
						[
							p.toNodeId,
							{
								name: p.to,
								summary: p.toDescription,
								bound: p.toBound
							}
						]
					])
				)

				const crossRels = await db
					.select({
						fromNodeId: schema.narrativeRelationships.fromNodeId,
						toNodeId: schema.narrativeRelationships.toNodeId,
						relationshipType:
							schema.narrativeRelationships.relationshipType,
						description: schema.narrativeRelationships.description,
						status: schema.narrativeRelationships.status,
						reason: schema.narrativeRelationships.reason,
						historyEntryId:
							schema.narrativeRelationships.historyEntryId
					})
					.from(schema.narrativeRelationships)
					.where(
						and(
							eq(
								schema.narrativeRelationships.lorebookId,
								sharedLorebookId
							),
							eq(schema.narrativeRelationships.status, "active"),
							inArray(
								schema.narrativeRelationships.fromNodeId,
								nodeIdArr
							),
							inArray(
								schema.narrativeRelationships.toNodeId,
								nodeIdArr
							)
						)
					)
					.orderBy(asc(schema.narrativeRelationships.id))

				let added = 0
				for (const r of crossRels) {
					if (added >= remainingPairSlots) break
					const pairKey = `${r.fromNodeId}:${r.toNodeId}`
					if (includedPairKeys.has(pairKey)) continue
					includedPairKeys.add(pairKey)

					const fromInfo = knownInfo.get(r.fromNodeId)
					const toInfo = knownInfo.get(r.toNodeId)
					const fromName = fromInfo?.name ?? String(r.fromNodeId)
					const toName = toInfo?.name ?? String(r.toNodeId)
					const rel: InternalRelEntry = {
						type: r.relationshipType,
						status: r.status,
						historyEntryId: r.historyEntryId
					}
					if (r.description) rel.description = r.description
					// Apply reason-omission for cross-pair entries too
					if (
						r.reason &&
						!(
							r.historyEntryId != null &&
							includedHistoryIds.has(r.historyEntryId)
						)
					) {
						rel.reason = r.reason
					}

					const fromBound = fromInfo?.bound ?? false
					const toBound = toInfo?.bound ?? false
					graphPairs.push({
						from: fromName,
						fromBound,
						fromDescription: fromBound
							? undefined
							: (fromInfo?.summary ?? undefined),
						to: toName,
						toBound,
						toDescription: toBound
							? undefined
							: (toInfo?.summary ?? undefined),
						fromNodeId: r.fromNodeId,
						toNodeId: r.toNodeId,
						lorebookId: sharedLorebookId,
						rels: [rel]
					})
					added++
				}
			}
		}

		// Serialize final graph (shared with KeywordInfillEngine's co-occurrence
		// variant so both produce structurally identical output).
		// Wrapped in a single-element array so enforceTokenBudget can pop it to clear.
		const graphSlot: (string | undefined)[] = []
		const serializedGraph = serializeGraphPairs(graphPairs)
		if (serializedGraph !== undefined) {
			graphSlot.push(serializedGraph)
		}

		// ── 4. Determine message sets ──────────────────────────────────────────
		// If lore content was found, historical RAG messages are lower priority
		// (fill-in only). If no lore was found, promote them to the initial set.
		const loreHasContent =
			pinnedWorldLoreArr.length > 0 ||
			ragWorldLoreArr.length > 0 ||
			pinnedCharLoreArr.length > 0 ||
			ragCharLoreArr.length > 0 ||
			pinnedHistoryArr.length > 0 ||
			ragHistoryArr.length > 0

		let initialOlderMessages: SelectChatMessage[]
		let fillInMessages: SelectChatMessage[]

		if (loreHasContent) {
			// Lore present — RAG messages join the fill-in pool with unified scoring
			initialOlderMessages = []
			const maxMsgId =
				olderMessages.length > 0
					? Math.max(...olderMessages.map((m) => m.id), 1)
					: 1
			fillInMessages = olderMessages
				.map((m) => ({
					msg: m,
					score: ragOlderMessageIds.has(m.id)
						? 1.0
						: 0.5 + 0.5 * (m.id / maxMsgId)
				}))
				.sort((a, b) => b.score - a.score)
				.map((x) => x.msg)
		} else {
			// No lore — promote RAG messages into the initial set
			initialOlderMessages = olderMessages.filter((m) =>
				ragOlderMessageIds.has(m.id)
			)
			const maxMsgId =
				olderMessages.length > 0
					? Math.max(...olderMessages.map((m) => m.id), 1)
					: 1
			fillInMessages = olderMessages
				.filter((m) => !ragOlderMessageIds.has(m.id))
				.map((m) => ({
					msg: m,
					score: 0.5 + 0.5 * (m.id / maxMsgId)
				}))
				.sort((a, b) => b.score - a.score)
				.map((x) => x.msg)
		}

		const processMsg = (
			msg: SelectChatMessage
		): ProcessedChatMessage | null =>
			this.chatMessageProcessor.processItem(msg, {
				interpolationContext,
				charName,
				personaName,
				priority: 4
			})

		const placeholder: ProcessedChatMessage = {
			id: -2,
			role: "assistant",
			name: seedName,
			message: (this.chat as any)._continuationPrefill ?? ""
		}

		// Build initial set: guaranteed + any promoted RAG older messages, oldest-first
		const processed = [...initialOlderMessages, ...guaranteedMessages]
			.sort((a, b) => a.id - b.id)
			.map(processMsg)
			.filter((m): m is ProcessedChatMessage => m !== null)
			.reverse() // newest-first (template reverses again for final render)

		const chatMessages: ProcessedChatMessage[] = [placeholder, ...processed]

		// ── 5. Helpers ─────────────────────────────────────────────────────────
		const buildCtx = () =>
			this.buildTemplateContext(
				templateContext,
				charName,
				interpolationContext,
				chatMessages,
				pinnedCharLoreArr,
				ragCharLoreArr,
				pinnedWorldLoreArr,
				ragWorldLoreArr,
				pinnedHistoryArr,
				ragHistoryArr,
				mostRecentHistory,
				graphSlot[0]
			)

		const countTokens = this.makeCountTokens(
			handlebars,
			contextConfig.template,
			useChatFormat ?? false,
			tokenCounter,
			chatMessages,
			buildCtx
		)

		// ── 6. Token budget management ─────────────────────────────────────────
		// Measure the base cost: instructions + guaranteed messages, no variable lore.
		// This is used to compute how much budget is available to split between lore
		// and message history, so lore can't crowd out all conversation context.
		const baseRendered = handlebars.compile(contextConfig.template)({
			...this.buildTemplateContext(
				templateContext,
				charName,
				interpolationContext,
				chatMessages,
				[],
				[],
				[],
				[],
				[],
				[], // empty lore for base measurement
				mostRecentHistory,
				undefined
			),
			chatMessages: [...chatMessages].reverse()
		})
		const baseFinal =
			(useChatFormat ?? false)
				? JSON.stringify(parseSplitChatPrompt(baseRendered))
				: baseRendered
		const baseTokens: number =
			typeof tokenCounter.countTokens === "function"
				? await tokenCounter.countTokens(baseFinal)
				: 0

		// Split the available budget: MESSAGE_FILL_FRACTION goes to message history,
		// the rest goes to lore. Lore is trimmed to its ceiling first; the fill phase
		// then fills messages into the reserved budget.
		const threshold = Math.floor(tokenLimit * contextThresholdPercent)
		const available = Math.max(0, threshold - baseTokens)
		const messageBudget = Math.max(
			RagInfillEngine.MIN_MESSAGE_FILL_TOKENS,
			Math.floor(available * RagInfillEngine.MESSAGE_FILL_FRACTION)
		)
		const loreCeiling = Math.max(baseTokens, threshold - messageBudget)

		// Enforce lore to its ceiling (clear graph → trim RAG history → worldLore →
		// charLore → guaranteed messages if still over ceiling).
		let totalTokens = await this.enforceTokenBudget(
			[graphSlot, ragHistoryArr, ragWorldLoreArr, ragCharLoreArr],
			chatMessages,
			loreCeiling,
			countTokens
		)

		// Fill older messages into the reserved message budget up to threshold.
		totalTokens = await this.fillFromPool(
			fillInMessages,
			chatMessages,
			tokenLimit,
			threshold,
			totalTokens,
			processMsg,
			countTokens
		)

		// ── 7. Re-sort chatMessages chronologically ───────────────────────────
		// RAG prioritization and fill-in may have pushed messages in a non-chronological
		// order (e.g. RAG messages interleaved with non-RAG). Re-sort to newest-first
		// so the final .reverse() at render time always produces oldest→newest output.
		// Placeholder (id === -2) is pinned to index 0.
		chatMessages.sort((a, b) => {
			if (a.id === -2) return -1
			if (b.id === -2) return 1
			return b.id - a.id // newest-first
		})

		// ── 8. Final render ────────────────────────────────────────────────────
		const renderMessages = [...chatMessages].reverse()
		const finalCtx = buildCtx()
		const postHistoryResult = await resolvePostHistoryContext({
			renderMessages,
			instructions: finalCtx.postHistory?.instructions,
			charInstructions: finalCtx.postHistory?.charInstructions,
			exampleDialogue: finalCtx.postHistory?.exampleDialogue,
			postHistoryDepth,
			postHistoryTokenTrigger,
			tokenCounter
		})
		finalCtx.postHistory = postHistoryResult.postHistory

		const rendered = handlebars.compile(contextConfig.template)({
			...finalCtx,
			chatMessages: renderMessages
		})

		let renderedPrompt: string | undefined
		let renderedMessages: any[] | undefined

		if (useChatFormat) {
			renderedMessages = parseSplitChatPrompt(rendered)
			renderedPrompt = undefined
		} else {
			renderedPrompt = rendered
		}

		const includedIds = chatMessages
			.filter((m) => m.id !== -2)
			.map((m) => m.id)
		const allMessageIds = allMessages.map((m) => m.id)
		const excludedIds = allMessageIds.filter(
			(id) => !includedIds.includes(id)
		)

		// ── 9. Build RAG diagnostics ───────────────────────────────────────────
		const includedMsgIdSet = new Set(includedIds)
		const guaranteedIncluded = guaranteedMessages.filter((m) =>
			includedMsgIdSet.has(m.id)
		).length
		const ragOlderIncluded = olderMessages.filter(
			(m) => ragOlderMessageIds.has(m.id) && includedMsgIdSet.has(m.id)
		).length
		const filledInIncluded = olderMessages.filter(
			(m) => !ragOlderMessageIds.has(m.id) && includedMsgIdSet.has(m.id)
		).length

		const rag: RagDiagnostics | undefined = this.diagnosticsEnabled
			? {
					used: true,
					lore: {
						worldLore: {
							pinned: pinnedWorldLoreArr.length,
							rag: ragWorldLoreArr.length
						},
						characterLore: {
							pinned: pinnedCharLoreArr.length,
							rag: ragCharLoreArr.length
						},
						history: {
							pinned: pinnedHistoryArr.length,
							rag: ragHistoryArr.length
						}
					},
					graphPairs: graphPairs.length,
					messages: {
						guaranteed: guaranteedIncluded,
						ragOlder: ragOlderIncluded,
						filledIn: filledInIncluded,
						total: includedIds.length
					},
					scores: {
						messageScores: diagnosticMessageScores,
						loreScores: diagnosticLoreScores,
						thresholdUsed: diagnosticThresholdUsed,
						queryMessageCount: diagnosticQueryMessageCount
					},
					postHistory: postHistoryResult.diagnostics
				}
			: undefined

		return {
			renderedPrompt,
			renderedMessages,
			totalTokens,
			chatMessages: {
				included: chatMessages.length - 1,
				includedIds,
				excludedIds
			},
			rag
		}
	}

	// ── Template context ────────────────────────────────────────────────────────
	// Accepts separate pinned and RAG arrays so that mutations (pops during budget
	// enforcement) are reflected automatically on the next buildCtx() call.

	private buildTemplateContext(
		base: TemplateContext,
		charName: string,
		interpolationContext: any,
		chatMessages: ProcessedChatMessage[],
		pinnedCharLore: SelectCharacterLoreEntry[],
		ragCharLore: SelectCharacterLoreEntry[],
		pinnedWorldLore: Array<{ id: number; name: string; content: string }>,
		ragWorldLore: Array<{ id: number; name: string; content: string }>,
		pinnedHistory: Array<{
			id: number
			year: number
			month: number | null
			day: number | null
			content: string
		}>,
		ragHistory: Array<{
			id: number
			year: number
			month: number | null
			day: number | null
			content: string
		}>,
		mostRecentHistory: {
			year: number
			month: number | null
			day: number | null
		} | null,
		narrativeGraph?: string
	): any {
		const characterLoreEntries = [...pinnedCharLore, ...ragCharLore]

		const context: any = { ...base }
		context.chatMessages = chatMessages
		context.characterLore = characterLoreEntries

		// Characters (use pre-compiled base if available, otherwise build from chat)
		let assistantCharacters: any[]
		if (base.characters && typeof base.characters === "string") {
			try {
				assistantCharacters = JSON.parse(base.characters)
			} catch {
				assistantCharacters = []
			}
		} else {
			assistantCharacters = (this.chat.chatCharacters || [])
				.map((cc: any) => ({
					name: cc.character.name,
					nickname: cc.character.nickname || undefined,
					description: cc.character.description,
					personality: cc.character.personality || undefined
				}))
				.map((c: any) =>
					this.interpolationEngine.interpolateObject(
						c,
						interpolationContext,
						["name", "nickname", "description", "personality"]
					)
				)
		}

		context.characters = JSON.stringify(
			attachCharacterLoreToCharacters(
				assistantCharacters,
				characterLoreEntries,
				this.chat
			),
			null,
			2
		)

		const userCharacters = (this.chat.chatPersonas || [])
			.map((cp: any) => ({
				name: cp.persona.name,
				description: cp.persona.description
			}))
			.map((p: any) =>
				this.interpolationEngine.interpolateObject(
					p,
					interpolationContext,
					["name", "description"]
				)
			)

		context.personas = JSON.stringify(
			attachCharacterLoreToCharacters(
				userCharacters,
				characterLoreEntries,
				this.chat
			),
			null,
			2
		)

		// Build worldLore object from combined pinned + RAG arrays
		const allWorldLore = [...pinnedWorldLore, ...ragWorldLore]
		if (allWorldLore.length > 0) {
			const worldLoreObj: Record<string, string> = {}
			for (const entry of allWorldLore) {
				if (entry.name && entry.content)
					worldLoreObj[entry.name] = entry.content
			}
			context.worldLore =
				Object.keys(worldLoreObj).length > 0
					? JSON.stringify(worldLoreObj, null, 2)
					: undefined
		} else {
			context.worldLore = undefined
		}

		// Build history object from combined pinned + RAG arrays (both sorted newest-first)
		const allHistory = [...pinnedHistory, ...ragHistory]
		if (allHistory.length > 0) {
			const historyObj: Record<string, string> = {}
			for (const he of allHistory) {
				if (!he.content.trim()) continue
				let dateKey = String(he.year)
				if (he.month !== null)
					dateKey += `-${String(he.month).padStart(2, "0")}`
				if (he.day !== null)
					dateKey += `-${String(he.day).padStart(2, "0")}`
				historyObj[dateKey] = he.content
			}
			context.history =
				Object.keys(historyObj).length > 0
					? JSON.stringify(historyObj)
					: undefined
		} else {
			context.history = undefined
		}

		if (mostRecentHistory) {
			const { year: y, month: m, day: d } = mostRecentHistory
			let dateKey = String(y)
			if (m !== null) dateKey += `-${String(m).padStart(2, "0")}`
			if (d !== null) dateKey += `-${String(d).padStart(2, "0")}`
			context.currentDate = dateKey
		} else {
			context.currentDate = undefined
		}

		context.narrativeGraph = narrativeGraph ?? undefined

		return context
	}
}
