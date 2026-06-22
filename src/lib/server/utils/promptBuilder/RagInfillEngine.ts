/**
 * RAG-based content infill engine.
 *
 * Replaces ContentInfillEngine when vectorization is active and the embedding
 * model is ready. Uses semantic similarity search to select the most relevant
 * lore and older messages instead of keyword matching.
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
 * Results are filtered to score ≥ RAG_SCORE_THRESHOLD and capped at RAG_TOP_K.
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
 *    added from most-recent to oldest until the budget is consumed.
 */

import { embed, getLoadedModelId } from "$lib/server/embedding"
import {
	getChatRagContext,
	scopedRankBySimilarity
} from "$lib/server/embedding/ragContext"
import type { BasePromptChat } from "../../connectionAdapters/BaseConnectionAdapter"
import {
	ChatMessageProcessor,
	type ProcessedChatMessage
} from "./ContentProcessors"
import { parseSplitChatPrompt } from "./utils"
import { attachCharacterLoreToCharacters } from "./LorebookBindingUtils"
import type { RagDiagnostics, TemplateContext } from "./types"
import { db } from "$lib/server/db"
import { and, asc, eq, inArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum number of most-recent messages always included, regardless of budget.
 * TODO: make configurable per-chat or per-context-config in a future pass.
 */
const MIN_GUARANTEED_MESSAGES = 10

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

/**
 * Maximum narrative graph relationship pairs included in context.
 * Current-pass (more relevant) pairs fill first; recent-pass fills the remainder.
 * TODO: make configurable per-chat or per-context-config in a future pass.
 */
const MAX_GRAPH_PAIRS = 10

/** Maximum items returned from similarity search */
const RAG_TOP_K = 20

/** Minimum cosine similarity score to include a RAG result */
const RAG_SCORE_THRESHOLD = 0.4

// ─── Engine ───────────────────────────────────────────────────────────────────

export class RagInfillEngine {
	private chatMessageProcessor: ChatMessageProcessor

	constructor(
		private chat: BasePromptChat,
		private interpolationEngine: any,
		private populateLorebookEntryBindings: (
			entry: any,
			chat: BasePromptChat
		) => any
	) {
		this.chatMessageProcessor = new ChatMessageProcessor(
			chat,
			interpolationEngine
		)
	}

	async infillContent({
		charName,
		personaName,
		templateContext,
		useChatFormat = false,
		tokenLimit,
		contextThresholdPercent,
		tokenCounter,
		handlebars,
		contextConfig
	}: {
		charName: string
		personaName: string
		templateContext: TemplateContext
		useChatFormat?: boolean
		tokenLimit: number
		contextThresholdPercent: number
		tokenCounter: any
		handlebars: any
		contextConfig: any
	}) {
		const interpolationContext =
			this.interpolationEngine.createInterpolationContext({
				currentCharacterName: charName,
				currentPersonaName: personaName
			})

		// ── 1. Split messages into guaranteed window and older candidates ──────
		const allMessages = this.chat.chatMessages || []
		// allMessages is oldest-first (index 0 = oldest)
		const guaranteedMessages =
			allMessages.length <= MIN_GUARANTEED_MESSAGES
				? allMessages.slice()
				: allMessages.slice(-MIN_GUARANTEED_MESSAGES)
		const olderMessages =
			allMessages.length <= MIN_GUARANTEED_MESSAGES
				? []
				: allMessages.slice(0, -MIN_GUARANTEED_MESSAGES)

		// ── 2. Two-pass RAG retrieval ──────────────────────────────────────────
		// Map preserves insertion order: current-pass pairs inserted first, so they
		// occupy the priority slots when MAX_GRAPH_PAIRS cap is applied.
		const ragOlderMessageIds = new Set<number>()
		const ragWorldLoreItems: Array<{ id: number; name: string; content: string }> = []
		const ragCharLoreItems: Array<{ id: number; lorebookId: number; name: string; content: string }> = []
		const ragHistoryItems: Array<{
			id: number; lorebookId: number; content: string
			year: number; month: number | null; day: number | null
		}> = []
		const ragRelPairMap = new Map<string, { fromNodeId: number; toNodeId: number; lorebookId: number }>()

		if (allMessages.length > 0) {
			try {
				const ragContext = await getChatRagContext(this.chat.id)
				const modelId = getLoadedModelId()!

				const currentMessages = guaranteedMessages.slice(-RAG_CURRENT_WINDOW)
				const recentMessages = guaranteedMessages.slice(
					-(RAG_CURRENT_WINDOW + RAG_RECENT_WINDOW),
					-RAG_CURRENT_WINDOW
				)

				const seenIds = new Set<number>()

				const runQuery = async (messages: SelectChatMessage[]) => {
					const text = messages.map((m) => m.content).filter(Boolean).join("\n\n")
					if (!text.trim()) return []
					const embedding = await embed(text)
					const results = await scopedRankBySimilarity(embedding, ragContext, {
						modelId,
						topK: RAG_TOP_K,
						sources: ["message", "worldLore", "characterLore", "historyEntry", "narrativeRelationship"],
						excludeRecentMessages: guaranteedMessages.length
					})
					return results.filter((r) => r.score >= RAG_SCORE_THRESHOLD)
				}

				const mergeResults = (results: Awaited<ReturnType<typeof runQuery>>) => {
					for (const item of results) {
						if (seenIds.has(item.id)) continue
						seenIds.add(item.id)
						if (item.source === "message") {
							ragOlderMessageIds.add(item.id)
						} else if (item.source === "worldLore") {
							ragWorldLoreItems.push({ id: item.id, name: item.name, content: item.content })
						} else if (item.source === "characterLore") {
							ragCharLoreItems.push({ id: item.id, lorebookId: item.lorebookId, name: item.name, content: item.content })
						} else if (item.source === "historyEntry") {
							ragHistoryItems.push({ id: item.id, lorebookId: item.lorebookId, content: item.content, year: item.year, month: item.month, day: item.day })
						} else if (item.source === "narrativeRelationship") {
							const pairKey = `${item.fromNodeId}:${item.toNodeId}`
							if (!ragRelPairMap.has(pairKey)) {
								ragRelPairMap.set(pairKey, { fromNodeId: item.fromNodeId, toNodeId: item.toNodeId, lorebookId: item.lorebookId })
							}
						}
					}
				}

				// Current-pass results fill slots first; recent-pass fills what remains
				mergeResults(await runQuery(currentMessages))
				mergeResults(await runQuery(recentMessages))
			} catch (err) {
				console.warn("[RagInfillEngine] RAG retrieval failed, continuing without RAG results:", err)
			}
		}

		// ── 3. Build lore context ──────────────────────────────────────────────
		const lorebook = (this.chat as any).lorebook as
			| { worldLoreEntries?: any[]; characterLoreEntries?: any[]; historyEntries?: any[] }
			| undefined

		const pinnedWorldLore: any[] = lorebook?.worldLoreEntries?.filter((e: any) => e.constant === true && e.enabled !== false) ?? []
		const pinnedCharLore: SelectCharacterLoreEntry[] = lorebook?.characterLoreEntries?.filter((e: any) => e.constant === true && e.enabled !== false) ?? []
		const pinnedHistory: any[] = lorebook?.historyEntries?.filter((e: any) => e.constant === true && e.enabled !== false) ?? []

		const worldLoreObj: Record<string, string> = {}
		const includedWorldLoreIds = new Set<number>()

		for (const entry of pinnedWorldLore) {
			const populated = this.populateLorebookEntryBindings(entry, this.chat)
			if (populated?.name && populated?.content) worldLoreObj[populated.name] = populated.content
			includedWorldLoreIds.add(entry.id)
		}
		for (const item of ragWorldLoreItems) {
			if (includedWorldLoreIds.has(item.id)) continue
			const fullEntry = lorebook?.worldLoreEntries?.find((e: any) => e.id === item.id)
			if (fullEntry) {
				const populated = this.populateLorebookEntryBindings(fullEntry, this.chat)
				if (populated?.name && populated?.content) worldLoreObj[populated.name] = populated.content
			} else if (item.name && item.content) {
				worldLoreObj[item.name] = item.content
			}
			includedWorldLoreIds.add(item.id)
		}

		const characterLoreEntries: SelectCharacterLoreEntry[] = []
		const includedCharLoreIds = new Set<number>()

		for (const entry of pinnedCharLore) {
			characterLoreEntries.push(entry)
			includedCharLoreIds.add(entry.id)
		}
		for (const item of ragCharLoreItems) {
			if (includedCharLoreIds.has(item.id)) continue
			const fullEntry = lorebook?.characterLoreEntries?.find((e: any) => e.id === item.id)
			if (fullEntry) {
				characterLoreEntries.push(fullEntry)
			} else if (item.name && item.content) {
				worldLoreObj[item.name] = item.content
			}
			includedCharLoreIds.add(item.id)
		}

		const historyObj: Record<string, string> = {}
		const includedHistoryIds = new Set<number>()

		// currentDate = most recent history entry across ALL lorebook entries, not just
		// those included in context. It's a world-state fact, not a RAG-filtered result.
		let mostRecentHistory: { year: number; month: number | null; day: number | null } | null = null
		if (lorebook?.historyEntries?.length) {
			let latestVal = -Infinity
			for (const e of lorebook.historyEntries as any[]) {
				if (e.year == null) continue
				const val = (e.year ?? 0) * 10000 + (e.month ?? 0) * 100 + (e.day ?? 0)
				if (val > latestVal) {
					latestVal = val
					mostRecentHistory = { year: e.year, month: e.month ?? null, day: e.day ?? null }
				}
			}
		}

		type HistoryItem = { id: number; year: number; month: number | null; day: number | null; content: string }

		const historyToRender: HistoryItem[] = [
			...pinnedHistory,
			...ragHistoryItems.filter((r) => !pinnedHistory.some((p: any) => p.id === r.id))
		].map((e: any) => ({ id: e.id, year: e.year ?? 0, month: e.month ?? null, day: e.day ?? null, content: e.content ?? "" }))

		historyToRender.sort((a, b) => {
			const aVal = a.year * 10000 + (a.month ?? 0) * 100 + (a.day ?? 0)
			const bVal = b.year * 10000 + (b.month ?? 0) * 100 + (b.day ?? 0)
			return bVal - aVal // newest-first
		})

		for (const he of historyToRender) {
			if (includedHistoryIds.has(he.id) || !he.content.trim()) continue
			includedHistoryIds.add(he.id)
			const fullEntry = lorebook?.historyEntries?.find((e: any) => e.id === he.id)
			const content = fullEntry
				? this.populateLorebookEntryBindings(fullEntry, this.chat)?.content ?? he.content
				: he.content
			let dateKey = String(he.year)
			if (he.month !== null) dateKey += `-${String(he.month).padStart(2, "0")}`
			if (he.day !== null) dateKey += `-${String(he.day).padStart(2, "0")}`
			historyObj[dateKey] = content
		}

		// ── 3b. Build narrative graph from RAG-retrieved relationship pairs ─────
		// Internal type includes historyEntryId for reason-omission; stripped before output.
		type InternalRelEntry = {
			type: string; status: string
			description?: string; reason?: string
			historyEntryId: number | null
		}
		type GraphPairOutput = { from: string; fromDescription?: string; to: string; toDescription?: string; fromNodeId: number; toNodeId: number; lorebookId: number; rels: InternalRelEntry[] }

		const graphPairs: GraphPairOutput[] = []

		if (ragRelPairMap.size > 0) {
			// Current-pass pairs are at the front of the Map — they get priority slots
			const pairsToProcess = Array.from(ragRelPairMap.values()).slice(0, MAX_GRAPH_PAIRS)

			// Batch-fetch node names
			const nodeIdSet = new Set<number>()
			for (const p of pairsToProcess) { nodeIdSet.add(p.fromNodeId); nodeIdSet.add(p.toNodeId) }
			const nodeRows = await db
				.select({ id: schema.narrativeNodes.id, name: schema.narrativeNodes.name, summary: schema.narrativeNodes.summary })
				.from(schema.narrativeNodes)
				.where(inArray(schema.narrativeNodes.id, Array.from(nodeIdSet)))
			const nodeInfoMap = new Map(nodeRows.map((n) => [n.id, { name: n.name, summary: n.summary }]))

			for (const pair of pairsToProcess) {
				const fromInfo = nodeInfoMap.get(pair.fromNodeId)
				const toInfo = nodeInfoMap.get(pair.toNodeId)
				const fromName = fromInfo?.name ?? String(pair.fromNodeId)
				const toName = toInfo?.name ?? String(pair.toNodeId)

				// Fetch all rows for this pair ordered chronologically (id order = insertion order)
				const allRows = await db
					.select({
						id: schema.narrativeRelationships.id,
						relationshipType: schema.narrativeRelationships.relationshipType,
						description: schema.narrativeRelationships.description,
						status: schema.narrativeRelationships.status,
						reason: schema.narrativeRelationships.reason,
						historyEntryId: schema.narrativeRelationships.historyEntryId
					})
					.from(schema.narrativeRelationships)
					.where(and(
						eq(schema.narrativeRelationships.lorebookId, pair.lorebookId),
						eq(schema.narrativeRelationships.fromNodeId, pair.fromNodeId),
						eq(schema.narrativeRelationships.toNodeId, pair.toNodeId)
					))
					.orderBy(asc(schema.narrativeRelationships.id))

				// Dedup by type+status — the retrieved row (possibly historical) plus all active rows
				const seen = new Set<string>()
				const rels: InternalRelEntry[] = []
				for (const r of allRows) {
					const key = `${r.relationshipType}:${r.status}`
					if (seen.has(key)) continue
					seen.add(key)
					const entry: InternalRelEntry = { type: r.relationshipType, status: r.status, historyEntryId: r.historyEntryId }
					if (r.description) entry.description = r.description
					if (r.reason) entry.reason = r.reason
					rels.push(entry)
				}

				graphPairs.push({
					from: fromName,
					fromDescription: fromInfo?.summary ?? undefined,
					to: toName,
					toDescription: toInfo?.summary ?? undefined,
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
				if (rel.historyEntryId != null && includedHistoryIds.has(rel.historyEntryId)) {
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
				// Reuse already-fetched node info (name + summary) for cross-pair entries
				const knownInfo = new Map(graphPairs.flatMap((p) => [
					[p.fromNodeId, { name: p.from, summary: p.fromDescription }],
					[p.toNodeId, { name: p.to, summary: p.toDescription }]
				]))

				const crossRels = await db
					.select({
						fromNodeId: schema.narrativeRelationships.fromNodeId,
						toNodeId: schema.narrativeRelationships.toNodeId,
						relationshipType: schema.narrativeRelationships.relationshipType,
						description: schema.narrativeRelationships.description,
						status: schema.narrativeRelationships.status,
						reason: schema.narrativeRelationships.reason,
						historyEntryId: schema.narrativeRelationships.historyEntryId
					})
					.from(schema.narrativeRelationships)
					.where(and(
						eq(schema.narrativeRelationships.lorebookId, sharedLorebookId),
						eq(schema.narrativeRelationships.status, "active"),
						inArray(schema.narrativeRelationships.fromNodeId, nodeIdArr),
						inArray(schema.narrativeRelationships.toNodeId, nodeIdArr)
					))
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
					const rel: InternalRelEntry = { type: r.relationshipType, status: r.status, historyEntryId: r.historyEntryId }
					if (r.description) rel.description = r.description
					// Apply reason-omission for cross-pair entries too
					if (r.reason && !(r.historyEntryId != null && includedHistoryIds.has(r.historyEntryId))) {
						rel.reason = r.reason
					}

					graphPairs.push({
						from: fromName,
						fromDescription: fromInfo?.summary ?? undefined,
						to: toName,
						toDescription: toInfo?.summary ?? undefined,
						fromNodeId: r.fromNodeId,
						toNodeId: r.toNodeId,
						lorebookId: sharedLorebookId,
						rels: [rel]
					})
					added++
				}
			}
		}

		// Serialize final graph (strip internal historyEntryId before output)
		let narrativeGraph: string | undefined
		if (graphPairs.length > 0) {
			const output = graphPairs.map((p) => {
				const entry: Record<string, any> = { from: p.from }
				if (p.fromDescription) entry.from_description = p.fromDescription
				entry.to = p.to
				if (p.toDescription) entry.to_description = p.toDescription
				entry.relationships = p.rels.map(({ historyEntryId: _he, ...rest }) => rest)
				return entry
			})
			narrativeGraph = JSON.stringify({ story_relationships: output }, null, 2)
		}

		// ── 4. Determine message sets ──────────────────────────────────────────
		// If lore content was found, historical RAG messages are lower priority
		// (fill-in only). If no lore was found, promote them to the initial set.
		const loreHasContent =
			Object.keys(worldLoreObj).length > 0 ||
			characterLoreEntries.length > 0 ||
			Object.keys(historyObj).length > 0

		let initialOlderMessages: SelectChatMessage[]
		let fillInMessages: SelectChatMessage[]

		if (loreHasContent) {
			// Lore present — RAG messages join the fill-in pool (but first, so most relevant)
			initialOlderMessages = []
			fillInMessages = [
				...olderMessages.filter((m) => ragOlderMessageIds.has(m.id)).reverse(),
				...olderMessages.filter((m) => !ragOlderMessageIds.has(m.id)).reverse()
			]
		} else {
			// No lore — promote RAG messages into the initial set
			initialOlderMessages = olderMessages.filter((m) => ragOlderMessageIds.has(m.id))
			fillInMessages = olderMessages.filter((m) => !ragOlderMessageIds.has(m.id)).reverse()
		}

		const processMsg = (msg: SelectChatMessage): ProcessedChatMessage | null =>
			this.chatMessageProcessor.processItem(msg, {
				interpolationContext,
				charName,
				personaName,
				priority: 4
			})

		const placeholder: ProcessedChatMessage = {
			id: -2,
			role: "assistant",
			name: charName,
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
				characterLoreEntries,
				worldLoreObj,
				historyObj,
				mostRecentHistory,
				narrativeGraph
			)

		const countTokens = async (ctx: any): Promise<number> => {
			const rendered = handlebars.compile(contextConfig.template)({
				...ctx,
				chatMessages: [...chatMessages].reverse()
			})
			const final = useChatFormat
				? JSON.stringify(parseSplitChatPrompt(rendered))
				: rendered
			return typeof tokenCounter.countTokens === "function"
				? await tokenCounter.countTokens(final)
				: 0
		}

		// ── 6. Token budget management ─────────────────────────────────────────
		let totalTokens = await countTokens(buildCtx())

		// Over limit: trim oldest messages (they sit at the back of chatMessages).
		// Never trim below the guaranteed window — +1 accounts for the placeholder.
		// If there are fewer total messages than MIN_GUARANTEED_MESSAGES, cap at
		// chatMessages.length so we don't try to trim a window larger than what exists.
		const minChatMessages = Math.min(
			MIN_GUARANTEED_MESSAGES + 1,
			chatMessages.length
		)
		while (totalTokens > tokenLimit && chatMessages.length > minChatMessages) {
			chatMessages.pop()
			totalTokens = await countTokens(buildCtx())
		}

		// Under threshold: fill in older messages from fill-in pool (newest-first)
		const threshold = tokenLimit * contextThresholdPercent
		if (totalTokens < threshold && fillInMessages.length > 0) {
			for (const msg of fillInMessages) {
				const p = processMsg(msg)
				if (!p) continue
				chatMessages.push(p)
				totalTokens = await countTokens(buildCtx())
				if (totalTokens > tokenLimit) {
					chatMessages.pop()
					break
				}
				if (totalTokens >= threshold) break
			}
		}

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
		const finalCtx = buildCtx()
		const rendered = handlebars.compile(contextConfig.template)({
			...finalCtx,
			chatMessages: [...chatMessages].reverse()
		})

		let renderedPrompt: string | undefined
		let renderedMessages: any[] | undefined

		if (useChatFormat) {
			renderedMessages = parseSplitChatPrompt(rendered)
			renderedPrompt = undefined
		} else {
			renderedPrompt = rendered
		}

		const includedIds = chatMessages.filter((m) => m.id !== -2).map((m) => m.id)
		const allMessageIds = allMessages.map((m) => m.id)
		const excludedIds = allMessageIds.filter(
			(id) => !includedIds.includes(id)
		)

		// ── 9. Build RAG diagnostics ───────────────────────────────────────────
		const includedMsgIdSet = new Set(includedIds)
		const guaranteedIncluded = guaranteedMessages.filter((m) => includedMsgIdSet.has(m.id)).length
		const ragOlderIncluded = olderMessages.filter((m) => ragOlderMessageIds.has(m.id) && includedMsgIdSet.has(m.id)).length
		const filledInIncluded = olderMessages.filter((m) => !ragOlderMessageIds.has(m.id) && includedMsgIdSet.has(m.id)).length

		const ragWorldLoreAdded = ragWorldLoreItems.filter((r) => !pinnedWorldLore.some((p: any) => p.id === r.id)).length
		const ragCharLoreAdded = ragCharLoreItems.filter((r) => !pinnedCharLore.some((p: any) => p.id === r.id)).length
		const ragHistoryAdded = ragHistoryItems.filter((r) => !pinnedHistory.some((p: any) => p.id === r.id)).length

		const rag: RagDiagnostics = {
			used: true,
			lore: {
				worldLore: { pinned: pinnedWorldLore.length, rag: ragWorldLoreAdded },
				characterLore: { pinned: pinnedCharLore.length, rag: ragCharLoreAdded },
				history: { pinned: pinnedHistory.length, rag: ragHistoryAdded }
			},
			graphPairs: graphPairs.length,
			messages: {
				guaranteed: guaranteedIncluded,
				ragOlder: ragOlderIncluded,
				filledIn: filledInIncluded,
				total: includedIds.length
			}
		}

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

	private buildTemplateContext(
		base: TemplateContext,
		charName: string,
		interpolationContext: any,
		chatMessages: ProcessedChatMessage[],
		characterLoreEntries: SelectCharacterLoreEntry[],
		worldLoreObj: Record<string, string>,
		historyObj: Record<string, string>,
		mostRecentHistory: {
			year: number
			month: number | null
			day: number | null
		} | null,
		narrativeGraph?: string
	): any {
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
					this.interpolationEngine.interpolateObject(c, interpolationContext, [
						"name",
						"nickname",
						"description",
						"personality"
					])
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
				this.interpolationEngine.interpolateObject(p, interpolationContext, [
					"name",
					"description"
				])
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

		context.worldLore =
			Object.keys(worldLoreObj).length > 0
				? JSON.stringify(worldLoreObj, null, 2)
				: undefined

		context.history =
			Object.keys(historyObj).length > 0
				? JSON.stringify(historyObj)
				: undefined

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
