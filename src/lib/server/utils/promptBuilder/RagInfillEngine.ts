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
import type { TemplateContext } from "./types"

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum number of most-recent messages always included, regardless of budget */
const MIN_GUARANTEED_MESSAGES = 10

/**
 * Most-recent messages used as the "current topic" query.
 * Run first; results take priority slots before the recent query.
 */
const RAG_CURRENT_WINDOW = 2

/**
 * Next-most-recent messages used as the "recent context" query.
 * Run second; fills remaining slots after the current query.
 */
const RAG_RECENT_WINDOW = 3

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

		// ── 2. Embed the last RAG_QUERY_WINDOW guaranteed messages as query ────
		let ragOlderMessageIds = new Set<number>()
		let ragWorldLoreItems: Array<{
			id: number
			name: string
			content: string
		}> = []
		let ragCharLoreItems: Array<{
			id: number
			lorebookId: number
			name: string
			content: string
		}> = []
		let ragHistoryItems: Array<{
			id: number
			lorebookId: number
			content: string
			year: number
			month: number | null
			day: number | null
		}> = []

		if (allMessages.length > 0) {
			try {
				const ragContext = await getChatRagContext(this.chat.id)
				const modelId = getLoadedModelId()!

				// Run two queries: current topic (last 2) then recent context (next 3).
				// Results from the current query take priority — they're added first and
				// deduplicated against, so recent-query items only fill remaining slots.
				const currentMessages = guaranteedMessages.slice(-RAG_CURRENT_WINDOW)
				const recentMessages = guaranteedMessages.slice(
					-(RAG_CURRENT_WINDOW + RAG_RECENT_WINDOW),
					-RAG_CURRENT_WINDOW
				)

				const seenIds = new Set<number>()

				const runQuery = async (messages: SelectChatMessage[]) => {
					const text = messages
						.map((m) => m.content)
						.filter(Boolean)
						.join("\n\n")
					if (!text.trim()) return []
					const embedding = await embed(text)
					const results = await scopedRankBySimilarity(embedding, ragContext, {
						modelId,
						topK: RAG_TOP_K,
						sources: ["message", "worldLore", "characterLore", "historyEntry"],
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
							ragWorldLoreItems.push({
								id: item.id,
								name: item.name,
								content: item.content
							})
						} else if (item.source === "characterLore") {
							ragCharLoreItems.push({
								id: item.id,
								lorebookId: item.lorebookId,
								name: item.name,
								content: item.content
							})
						} else if (item.source === "historyEntry") {
							ragHistoryItems.push({
								id: item.id,
								lorebookId: item.lorebookId,
								content: item.content,
								year: item.year,
								month: item.month,
								day: item.day
							})
						}
					}
				}

				// Current topic first, then recent context
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

		// Pinned lore (constant=true, enabled=true/not-false)
		const pinnedWorldLore: any[] =
			lorebook?.worldLoreEntries?.filter(
				(e: any) => e.constant === true && e.enabled !== false
			) ?? []
		const pinnedCharLore: SelectCharacterLoreEntry[] =
			lorebook?.characterLoreEntries?.filter(
				(e: any) => e.constant === true && e.enabled !== false
			) ?? []
		const pinnedHistory: any[] =
			lorebook?.historyEntries?.filter(
				(e: any) => e.constant === true && e.enabled !== false
			) ?? []

		// World lore: name → content (deduplicated)
		const worldLoreObj: Record<string, string> = {}
		const includedWorldLoreIds = new Set<number>()

		for (const entry of pinnedWorldLore) {
			const populated = this.populateLorebookEntryBindings(entry, this.chat)
			if (populated?.name && populated?.content) {
				worldLoreObj[populated.name] = populated.content
			}
			includedWorldLoreIds.add(entry.id)
		}
		for (const item of ragWorldLoreItems) {
			if (includedWorldLoreIds.has(item.id)) continue
			const fullEntry = lorebook?.worldLoreEntries?.find(
				(e: any) => e.id === item.id
			)
			if (fullEntry) {
				const populated = this.populateLorebookEntryBindings(
					fullEntry,
					this.chat
				)
				if (populated?.name && populated?.content) {
					worldLoreObj[populated.name] = populated.content
				}
			} else if (item.name && item.content) {
				// From a character lorebook not loaded in memory — use raw
				worldLoreObj[item.name] = item.content
			}
			includedWorldLoreIds.add(item.id)
		}

		// Character lore: full SelectCharacterLoreEntry objects for binding resolution
		const characterLoreEntries: SelectCharacterLoreEntry[] = []
		const includedCharLoreIds = new Set<number>()

		for (const entry of pinnedCharLore) {
			characterLoreEntries.push(entry)
			includedCharLoreIds.add(entry.id)
		}
		for (const item of ragCharLoreItems) {
			if (includedCharLoreIds.has(item.id)) continue
			const fullEntry = lorebook?.characterLoreEntries?.find(
				(e: any) => e.id === item.id
			)
			if (fullEntry) {
				characterLoreEntries.push(fullEntry)
			} else {
				// From a character lorebook not in memory — fold into world lore
				if (item.name && item.content) {
					worldLoreObj[item.name] = item.content
				}
			}
			includedCharLoreIds.add(item.id)
		}

		// History entries: dateKey → content (newest-first for currentDate)
		const historyObj: Record<string, string> = {}
		const includedHistoryIds = new Set<number>()
		let mostRecentHistory: {
			year: number
			month: number | null
			day: number | null
		} | null = null

		type HistoryItem = {
			id: number
			year: number
			month: number | null
			day: number | null
			content: string
		}

		const historyToRender: HistoryItem[] = [
			...pinnedHistory,
			...ragHistoryItems.filter((r) => {
				if (pinnedHistory.some((p: any) => p.id === r.id)) return false
				// If entry is in the loaded lorebook, use the full object for binding population
				return true
			})
		].map((e: any) => ({
			id: e.id,
			year: e.year ?? 0,
			month: e.month ?? null,
			day: e.day ?? null,
			content: e.content ?? ""
		}))

		// Sort newest-first for currentDate tracking
		historyToRender.sort((a, b) => {
			const aVal = a.year * 10000 + (a.month ?? 0) * 100 + (a.day ?? 0)
			const bVal = b.year * 10000 + (b.month ?? 0) * 100 + (b.day ?? 0)
			return bVal - aVal
		})

		for (const he of historyToRender) {
			if (includedHistoryIds.has(he.id) || !he.content.trim()) continue
			includedHistoryIds.add(he.id)

			// Try to populate bindings from the full entry if available
			const fullEntry = lorebook?.historyEntries?.find(
				(e: any) => e.id === he.id
			)
			const content = fullEntry
				? this.populateLorebookEntryBindings(fullEntry, this.chat)?.content ??
					he.content
				: he.content

			let dateKey = String(he.year)
			if (he.month !== null) dateKey += `-${String(he.month).padStart(2, "0")}`
			if (he.day !== null) dateKey += `-${String(he.day).padStart(2, "0")}`
			historyObj[dateKey] = content

			if (!mostRecentHistory) {
				mostRecentHistory = {
					year: he.year,
					month: he.month,
					day: he.day
				}
			}
		}

		// ── 4. Build initial message list ──────────────────────────────────────
		const ragOlderMessages = olderMessages.filter((m) =>
			ragOlderMessageIds.has(m.id)
		)
		// Messages not retrieved by RAG (candidates for fill-in if under budget)
		const remainingOlderMessages = olderMessages
			.filter((m) => !ragOlderMessageIds.has(m.id))
			.reverse() // newest-first so we add most-recent-older first

		// Merge RAG older messages + guaranteed, sort oldest-first
		const messagesToInclude = [
			...ragOlderMessages,
			...guaranteedMessages
		].sort((a, b) => a.id - b.id)

		const processMsg = (
			msg: SelectChatMessage
		): ProcessedChatMessage | null =>
			this.chatMessageProcessor.processItem(msg, {
				interpolationContext,
				charName,
				personaName,
				priority: 4
			})

		// Placeholder: the assistant response stub (always at index 0)
		const placeholder: ProcessedChatMessage = {
			id: -2,
			role: "assistant",
			name: charName,
			message: (this.chat as any)._continuationPrefill ?? ""
		}

		// Build array newest-first (template render does .reverse() to get oldest-first)
		const processed = messagesToInclude
			.map(processMsg)
			.filter((m): m is ProcessedChatMessage => m !== null)
			.reverse()

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
				mostRecentHistory
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

		// Over limit: trim oldest messages (they sit at the back of chatMessages)
		while (totalTokens > tokenLimit && chatMessages.length > 1) {
			chatMessages.pop()
			totalTokens = await countTokens(buildCtx())
		}

		// Under threshold: fill in remaining older messages from most-recent first
		const threshold = tokenLimit * contextThresholdPercent
		if (totalTokens < threshold && remainingOlderMessages.length > 0) {
			for (const msg of remainingOlderMessages) {
				const p = processMsg(msg)
				if (!p) continue
				chatMessages.push(p)
				totalTokens = await countTokens(buildCtx())
				if (totalTokens > tokenLimit) {
					chatMessages.pop() // undo — went over limit
					break
				}
				if (totalTokens >= threshold) break
			}
		}

		// ── 7. Final render ────────────────────────────────────────────────────
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

		return {
			renderedPrompt,
			renderedMessages,
			totalTokens,
			chatMessages: {
				included: chatMessages.length - 1,
				includedIds,
				excludedIds
			}
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
		} | null
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

		return context
	}
}
