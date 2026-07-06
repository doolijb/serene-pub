/**
 * KeywordInfillEngine — Non-RAG context infill using a reserve → score → fill → trim pipeline.
 *
 * Seven scoring signals (keyword, name-match, entity co-occurrence, TF-IDF, scene affinity,
 * last-ref recency, message density/recency) are combined as weighted sums. Per-entry
 * diagnostics explain inclusion reasons.
 */

import type { BasePromptChat } from "../../connectionAdapters/BaseConnectionAdapter"
import { ChatMessageProcessor, type ProcessedChatMessage } from "./ContentProcessors"
import { attachCharacterLoreToCharacters } from "./LorebookBindingUtils"
import { parseSplitChatPrompt } from "./utils"
import type { NonRagDiagnostics, ScoredEntry, ScoreBreakdown, TemplateContext, InfillContentOptions, InfillResult } from "./types"
import { ChatCharacterVisibility } from "$lib/shared/constants/ChatCharacterVisibility"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { BaseInfillEngine } from "./BaseInfillEngine"

// ─── Constants ────────────────────────────────────────────────────────────────

const FILL_BUDGET = {
	worldLore:     20,
	characterLore: 15,
	history:       10,
	messages:      50,
} as const

// ─── Internal types ───────────────────────────────────────────────────────────

interface SceneRow {
	id: number
	selectedMessageIds: number[]
	historyEntryId: number
}

interface ScoringContext {
	guaranteedWindowText: string   // lowercase concat of guaranteed message content
	guaranteedWindowRaw: string    // original concat (for caseSensitive matching)
	idfMap: Map<string, number>
	guaranteedTermFreq: Map<string, number>
	allMessages: SelectChatMessage[]
	guaranteedMessages: SelectChatMessage[]
	olderMessages: SelectChatMessage[]
	avgMessageLength: number
	lastRefMap: Map<number, number>  // entryId → last message index containing a key
	guaranteedWindowCharacterIds: Set<number>
	chatCharacterNames: Set<string>   // lowercase
	chatPersonaNames: Set<string>     // lowercase
	currentSceneIds: Set<number>
	messageToSceneId: Map<number, number>   // messageId → sceneId
	historyEntryToSceneId: Map<number, number> // historyEntryId → sceneId
	historyRecencyMap: Map<number, number>  // entryId → 0–1 (1 = newest)
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export class KeywordInfillEngine extends BaseInfillEngine {
	constructor(
		chat: BasePromptChat,
		interpolationEngine: any,
		populateLorebookEntryBindings: (entry: any, chat: BasePromptChat) => any,
		private currentCharacterId: number | null
	) {
		super(chat, interpolationEngine, populateLorebookEntryBindings)
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
	}: InfillContentOptions): Promise<InfillResult> {
		const interpolationContext = this.interpolationEngine.createInterpolationContext({
			currentCharacterName: charName,
			currentPersonaName: personaName
		})

		// ── Phase 0: Pre-computation ──────────────────────────────────────────

		const allMessages = this.chat.chatMessages || []
		const guaranteedMessages =
			allMessages.length <= KeywordInfillEngine.MIN_GUARANTEED_MESSAGES
				? allMessages.slice()
				: allMessages.slice(-KeywordInfillEngine.MIN_GUARANTEED_MESSAGES)
		const olderMessages =
			allMessages.length <= KeywordInfillEngine.MIN_GUARANTEED_MESSAGES
				? []
				: allMessages.slice(0, -KeywordInfillEngine.MIN_GUARANTEED_MESSAGES)

		// Guaranteed window text
		const guaranteedWindowRaw = guaranteedMessages.map((m) => m.content ?? "").join(" ")
		const guaranteedWindowText = guaranteedWindowRaw.toLowerCase()

		// TF-IDF: build term frequency over all messages
		const allText = allMessages.map((m) => m.content ?? "").join(" ").toLowerCase()
		const allTerms = tokenize(allText)
		const corpusTermFreq = buildTermFreq(allTerms)

		const guaranteedTerms = tokenize(guaranteedWindowText)
		const guaranteedTermFreq = buildTermFreq(guaranteedTerms)

		// IDF: simple inverse document frequency over messages (doc = message)
		const idfMap = buildIdf(allMessages)

		// Average message length
		const avgMessageLength =
			allMessages.length > 0
				? allMessages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0) / allMessages.length
				: 1

		// lastRefMap: last message index (in allMessages) where any key of entry appears
		const lorebook = (this.chat as any).lorebook as {
			worldLoreEntries?: SelectWorldLoreEntry[]
			characterLoreEntries?: SelectCharacterLoreEntry[]
			historyEntries?: SelectHistoryEntry[]
		} | undefined

		const lastRefMap = buildLastRefMap(allMessages, lorebook)

		// Characters speaking in guaranteed window
		const guaranteedWindowCharacterIds = new Set<number>()
		for (const msg of guaranteedMessages) {
			if (msg.characterId != null) {
				guaranteedWindowCharacterIds.add(msg.characterId)
			}
		}

		// Chat character and persona names (lowercase)
		const chatCharacterNames = new Set<string>()
		for (const cc of (this.chat.chatCharacters || []) as any[]) {
			if (cc.character?.name) chatCharacterNames.add(cc.character.name.toLowerCase())
			if (cc.character?.nickname) chatCharacterNames.add(cc.character.nickname.toLowerCase())
		}
		const chatPersonaNames = new Set<string>()
		for (const cp of (this.chat.chatPersonas || []) as any[]) {
			if (cp.persona?.name) chatPersonaNames.add(cp.persona.name.toLowerCase())
		}

		// Scene DB query
		let scenes: SceneRow[] = []
		try {
			const rows = await db
				.select({
					id: schema.scenes.id,
					selectedMessageIds: schema.scenes.selectedMessageIds,
					historyEntryId: schema.scenes.historyEntryId
				})
				.from(schema.scenes)
				.where(eq(schema.scenes.chatId, this.chat.id))
			scenes = rows as SceneRow[]
		} catch {
			scenes = []
		}

		// Maps
		const messageToSceneId = new Map<number, number>()
		const historyEntryToSceneId = new Map<number, number>()
		for (const scene of scenes) {
			for (const msgId of (scene.selectedMessageIds || [])) {
				messageToSceneId.set(msgId, scene.id)
			}
			if (scene.historyEntryId) {
				historyEntryToSceneId.set(scene.historyEntryId, scene.id)
			}
		}

		// Current scene IDs: scenes that contain any guaranteed message
		const currentSceneIds = new Set<number>()
		for (const msg of guaranteedMessages) {
			const sceneId = messageToSceneId.get(msg.id)
			if (sceneId != null) currentSceneIds.add(sceneId)
		}

		// History recency map
		const historyRecencyMap = buildHistoryRecencyMap(lorebook?.historyEntries ?? [])

		// mostRecentHistory: from full lorebook history list
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

		const scoringCtx: ScoringContext = {
			guaranteedWindowText,
			guaranteedWindowRaw,
			idfMap,
			guaranteedTermFreq,
			allMessages,
			guaranteedMessages,
			olderMessages,
			avgMessageLength,
			lastRefMap,
			guaranteedWindowCharacterIds,
			chatCharacterNames,
			chatPersonaNames,
			currentSceneIds,
			messageToSceneId,
			historyEntryToSceneId,
			historyRecencyMap
		}

		// ── Phase 1: Reserve ──────────────────────────────────────────────────

		const placeholder: ProcessedChatMessage = {
			id: -2,
			role: "assistant",
			name: charName,
			message: (this.chat as any)._continuationPrefill ?? ""
		}

		const processMsg = (msg: SelectChatMessage): ProcessedChatMessage | null =>
			this.chatMessageProcessor.processItem(msg, {
				interpolationContext,
				charName,
				personaName,
				priority: 4
			})

		// Guaranteed messages (newest-first order, placeholder at index 0)
		const processedGuaranteed = guaranteedMessages
			.slice()
			.sort((a, b) => b.id - a.id)
			.map(processMsg)
			.filter((m): m is ProcessedChatMessage => m !== null)

		const chatMessages: ProcessedChatMessage[] = [placeholder, ...processedGuaranteed]

		// Reserved lore: constant === true && enabled !== false
		const reservedWorldLore: SelectWorldLoreEntry[] = []
		const reservedCharacterLore: SelectCharacterLoreEntry[] = []
		const reservedHistory: SelectHistoryEntry[] = []

		for (const entry of (lorebook?.worldLoreEntries ?? [])) {
			if (entry.constant === true && entry.enabled !== false) {
				reservedWorldLore.push({ ...entry })
			}
		}

		for (const entry of (lorebook?.characterLoreEntries ?? [])) {
			if (entry.constant === true && entry.enabled !== false) {
				if (!this.isCharacterLoreVisible(entry)) continue
				reservedCharacterLore.push({ ...entry })
			}
		}

		for (const entry of (lorebook?.historyEntries ?? [])) {
			if ((entry as any).constant === true && (entry as any).enabled !== false) {
				reservedHistory.push({ ...entry } as SelectHistoryEntry)
			}
		}

		// Populate bindings on reserved entries
		const populatedReservedWorldLore = reservedWorldLore.map((e) => {
			const cloned = { ...e }
			return this.populateLorebookEntryBindings(cloned, this.chat) as SelectWorldLoreEntry
		})
		const populatedReservedCharLore = reservedCharacterLore.map((e) => {
			const cloned = { ...e }
			return this.populateLorebookEntryBindings(cloned, this.chat) as SelectCharacterLoreEntry
		})
		const populatedReservedHistory = reservedHistory.map((e) => {
			const cloned = { ...e }
			return this.populateLorebookEntryBindings(cloned, this.chat) as SelectHistoryEntry
		})

		// Track sets of reserved IDs
		const reservedWorldLoreIds = new Set(reservedWorldLore.map((e) => e.id))
		const reservedCharLoreIds = new Set(reservedCharacterLore.map((e) => e.id))
		const reservedHistoryIds = new Set(reservedHistory.map((e) => e.id))

		// Working included lore arrays (start with reserved)
		const includedWorldLore: SelectWorldLoreEntry[] = [...populatedReservedWorldLore]
		const includedCharLore: SelectCharacterLoreEntry[] = [...populatedReservedCharLore]
		const includedHistory: SelectHistoryEntry[] = [...populatedReservedHistory]

		// Build reserve token count
		const buildCtx = () =>
			this.buildTemplateContext(
				templateContext,
				charName,
				interpolationContext,
				chatMessages,
				includedCharLore,
				includedWorldLore,
				includedHistory,
				mostRecentHistory
			)

		const countTokens = this.makeCountTokens(
			handlebars, contextConfig.template, useChatFormat ?? false,
			tokenCounter, chatMessages, buildCtx
		)

		const reserveTokens = await countTokens()

		// ── Phase 2: Score all non-reserved candidates ────────────────────────

		// Candidate lists (non-reserved, enabled)
		const candidateWorldLore: SelectWorldLoreEntry[] = (lorebook?.worldLoreEntries ?? [])
			.filter((e) => !reservedWorldLoreIds.has(e.id) && e.enabled !== false)
		const candidateCharLore: SelectCharacterLoreEntry[] = (lorebook?.characterLoreEntries ?? [])
			.filter((e) => !reservedCharLoreIds.has(e.id) && e.enabled !== false)
			.filter((e) => this.isCharacterLoreVisible(e))
		const visibilityFilteredCharLore: SelectCharacterLoreEntry[] = (lorebook?.characterLoreEntries ?? [])
			.filter((e) => !reservedCharLoreIds.has(e.id) && e.enabled !== false)
			.filter((e) => !this.isCharacterLoreVisible(e))
		const candidateHistory: SelectHistoryEntry[] = (lorebook?.historyEntries ?? [])
			.filter((e) => !reservedHistoryIds.has((e as any).id) && (e as any).enabled !== false) as SelectHistoryEntry[]
		const candidateOlderMessages: SelectChatMessage[] = olderMessages.slice()

		// Also track disabled entries for diagnostics
		const disabledWorldLore = (lorebook?.worldLoreEntries ?? []).filter((e) => e.enabled === false)
		const disabledCharLore = (lorebook?.characterLoreEntries ?? []).filter((e) => (e as any).enabled === false)
		const disabledHistory = (lorebook?.historyEntries ?? []).filter((e) => (e as any).enabled === false)

		// Score worldLore candidates (raw tfidf)
		interface ScoredWorldLore { entry: SelectWorldLoreEntry; score: ScoreBreakdown }
		const scoredWorldLore: ScoredWorldLore[] = candidateWorldLore.map((entry) => ({
			entry,
			score: this.scoreWorldLore(entry, scoringCtx, 0)
		}))

		// Score characterLore candidates
		interface ScoredCharLore { entry: SelectCharacterLoreEntry; score: ScoreBreakdown }
		const scoredCharLore: ScoredCharLore[] = candidateCharLore.map((entry) => ({
			entry,
			score: this.scoreCharacterLore(entry, scoringCtx, 0)
		}))

		// Score history candidates
		interface ScoredHistory { entry: SelectHistoryEntry; score: ScoreBreakdown }
		const scoredHistory: ScoredHistory[] = candidateHistory.map((entry) => ({
			entry,
			score: this.scoreHistory(entry as any, scoringCtx, 0)
		}))

		// Score older messages
		interface ScoredMessage { msg: SelectChatMessage; score: ScoreBreakdown }
		const scoredMessages: ScoredMessage[] = candidateOlderMessages.map((msg, idx) => ({
			msg,
			score: this.scoreMessage(msg, idx, candidateOlderMessages.length, scoringCtx, 0)
		}))

		// TF-IDF normalization: normalize raw tfidf across all candidates by global max
		const allRawTfidf = [
			...scoredWorldLore.map((s) => s.score.tfidf),
			...scoredCharLore.map((s) => s.score.tfidf),
			...scoredHistory.map((s) => s.score.tfidf),
			...scoredMessages.map((s) => s.score.tfidf)
		]
		const maxTfidf = Math.max(...allRawTfidf, 1)

		// Re-score with normalized tfidf
		for (const s of scoredWorldLore) {
			s.score = this.scoreWorldLore(s.entry, scoringCtx, maxTfidf)
		}
		for (const s of scoredCharLore) {
			s.score = this.scoreCharacterLore(s.entry, scoringCtx, maxTfidf)
		}
		for (const s of scoredHistory) {
			s.score = this.scoreHistory(s.entry as any, scoringCtx, maxTfidf)
		}
		for (const s of scoredMessages) {
			const idx = candidateOlderMessages.indexOf(s.msg)
			s.score = this.scoreMessage(s.msg, idx, candidateOlderMessages.length, scoringCtx, maxTfidf)
		}

		// ── Phase 3: Fill ─────────────────────────────────────────────────────

		// Build unified fill candidate pool sorted by score.total descending
		interface FillCandidate {
			type: "worldLore" | "characterLore" | "history" | "message"
			id: number
			name: string
			score: ScoreBreakdown
			payload: SelectWorldLoreEntry | SelectCharacterLoreEntry | SelectHistoryEntry | SelectChatMessage
		}

		const fillPool: FillCandidate[] = [
			...scoredWorldLore.map((s) => ({
				type: "worldLore" as const,
				id: s.entry.id,
				name: s.entry.name ?? String(s.entry.id),
				score: s.score,
				payload: s.entry
			})),
			...scoredCharLore.map((s) => ({
				type: "characterLore" as const,
				id: s.entry.id,
				name: (s.entry as any).name ?? String(s.entry.id),
				score: s.score,
				payload: s.entry
			})),
			...scoredHistory.map((s) => ({
				type: "history" as const,
				id: (s.entry as any).id,
				name: formatHistoryDateKey(s.entry as any),
				score: s.score,
				payload: s.entry
			})),
			...scoredMessages.map((s) => ({
				type: "message" as const,
				id: s.msg.id,
				name: `msg#${s.msg.id}`,
				score: s.score,
				payload: s.msg
			}))
		]

		fillPool.sort((a, b) => b.score.total - a.score.total)

		// Per-type counters
		const typeCounts: Record<string, number> = {
			worldLore: 0,
			characterLore: 0,
			history: 0,
			message: 0
		}

		const typeBudgets: Record<string, number> = {
			worldLore: FILL_BUDGET.worldLore,
			characterLore: FILL_BUDGET.characterLore,
			history: FILL_BUDGET.history,
			message: FILL_BUDGET.messages
		}

		// Track diagnostics per candidate
		const allScoredEntries: ScoredEntry[] = []

		// Add reserved entries to diagnostics
		for (const entry of populatedReservedWorldLore) {
			allScoredEntries.push({
				type: "worldLore",
				id: entry.id,
				name: entry.name ?? String(entry.id),
				score: zeroScoreWith("reserved_constant")
			})
		}
		for (const entry of populatedReservedCharLore) {
			allScoredEntries.push({
				type: "characterLore",
				id: entry.id,
				name: (entry as any).name ?? String(entry.id),
				score: zeroScoreWith("reserved_constant")
			})
		}
		for (const entry of populatedReservedHistory) {
			allScoredEntries.push({
				type: "history",
				id: (entry as any).id,
				name: formatHistoryDateKey(entry as any),
				score: zeroScoreWith("reserved_constant")
			})
		}
		for (const msg of guaranteedMessages) {
			allScoredEntries.push({
				type: "message",
				id: msg.id,
				name: `msg#${msg.id}`,
				score: zeroScoreWith("reserved_guaranteed")
			})
		}
		// Add disabled entries
		for (const entry of disabledWorldLore) {
			allScoredEntries.push({ type: "worldLore", id: entry.id, name: entry.name ?? String(entry.id), score: zeroScoreWith("excluded_disabled") })
		}
		for (const entry of disabledCharLore) {
			allScoredEntries.push({ type: "characterLore", id: (entry as any).id, name: (entry as any).name ?? String((entry as any).id), score: zeroScoreWith("excluded_disabled") })
		}
		for (const entry of disabledHistory) {
			allScoredEntries.push({ type: "history", id: (entry as any).id, name: formatHistoryDateKey(entry as any), score: zeroScoreWith("excluded_disabled") })
		}
		// Add visibility-filtered char lore entries
		for (const entry of visibilityFilteredCharLore) {
			allScoredEntries.push({ type: "characterLore", id: entry.id, name: (entry as any).name ?? String(entry.id), score: zeroScoreWith("excluded_visibility") })
		}

		// Budget split: reserve MESSAGE_FILL_FRACTION of available budget for chat
		// messages so that high-scoring lore entries can't crowd out conversation history.
		const contentBudget = Math.max(0, tokenLimit - reserveTokens)
		const messageBudget = Math.max(
			KeywordInfillEngine.MIN_MESSAGE_FILL_TOKENS,
			Math.floor(contentBudget * KeywordInfillEngine.MESSAGE_FILL_FRACTION)
		)
		const messageTarget = reserveTokens + messageBudget  // ceiling for message fill pass

		const messageFillPool = fillPool.filter(c => c.type === "message")
		const loreFillPool    = fillPool.filter(c => c.type !== "message")

		let totalTokens = reserveTokens

		// ── Phase 3a: Messages first ──────────────────────────────────────────────
		// Fill older messages (sorted by score) up to messageTarget before lore competes.
		for (const candidate of messageFillPool) {
			if (typeCounts[candidate.type] >= (typeBudgets[candidate.type] ?? 999)) {
				candidate.score.includedReason = "excluded_budget"
				allScoredEntries.push({ type: candidate.type, id: candidate.id, name: candidate.name, score: { ...candidate.score } })
				continue
			}

			const msg = candidate.payload as SelectChatMessage
			const processed = processMsg(msg)
			if (!processed) {
				allScoredEntries.push({ type: candidate.type, id: candidate.id, name: candidate.name, score: { ...candidate.score, includedReason: "excluded_budget" } })
				continue
			}
			chatMessages.push(processed)
			totalTokens = await countTokens()
			if (totalTokens > messageTarget) {
				chatMessages.pop()
				totalTokens = await countTokens()
				candidate.score.includedReason = "excluded_token_limit"
				allScoredEntries.push({ type: candidate.type, id: candidate.id, name: candidate.name, score: { ...candidate.score } })
				continue
			}
			typeCounts[candidate.type]++
			candidate.score.includedReason = candidate.score.total > 0 ? "filled_scored" : "filled_zero_score"
			allScoredEntries.push({ type: candidate.type, id: candidate.id, name: candidate.name, score: { ...candidate.score } })
		}

		// ── Phase 3b: Lore fills remaining budget ─────────────────────────────────
		// Lore candidates (sorted by score) fill whatever budget remains up to tokenLimit.
		for (const candidate of loreFillPool) {
			if (typeCounts[candidate.type] >= (typeBudgets[candidate.type] ?? 999)) {
				candidate.score.includedReason = "excluded_budget"
				allScoredEntries.push({ type: candidate.type, id: candidate.id, name: candidate.name, score: { ...candidate.score } })
				continue
			}

			let rollback: (() => void) | null = null
			if (candidate.type === "worldLore") {
				const entry = candidate.payload as SelectWorldLoreEntry
				const populated = this.populateLorebookEntryBindings({ ...entry }, this.chat) as SelectWorldLoreEntry
				includedWorldLore.push(populated)
				rollback = () => { includedWorldLore.pop() }
			} else if (candidate.type === "characterLore") {
				const entry = candidate.payload as SelectCharacterLoreEntry
				const populated = this.populateLorebookEntryBindings({ ...entry }, this.chat) as SelectCharacterLoreEntry
				includedCharLore.push(populated)
				rollback = () => { includedCharLore.pop() }
			} else if (candidate.type === "history") {
				const entry = candidate.payload as SelectHistoryEntry
				const populated = this.populateLorebookEntryBindings({ ...entry }, this.chat) as SelectHistoryEntry
				includedHistory.push(populated)
				rollback = () => { includedHistory.pop() }
			}

			totalTokens = await countTokens()
			if (totalTokens > tokenLimit) {
				rollback?.()
				totalTokens = await countTokens()
				candidate.score.includedReason = "excluded_token_limit"
				allScoredEntries.push({ type: candidate.type, id: candidate.id, name: candidate.name, score: { ...candidate.score } })
				continue
			}
			typeCounts[candidate.type]++
			candidate.score.includedReason = candidate.score.total > 0 ? "filled_scored" : "filled_zero_score"
			allScoredEntries.push({ type: candidate.type, id: candidate.id, name: candidate.name, score: { ...candidate.score } })
		}

		// ── Phase 4: Enforce budget ───────────────────────────────────────────
		// The fill pool already rolled back over-budget lore candidates; only
		// messages may need trimming here (as a safety net for reserve overflows).
		if (totalTokens > tokenLimit) {
			totalTokens = await this.enforceTokenBudget(
				[], chatMessages, tokenLimit, countTokens
			)
		}

		// ── Phase 5: Re-sort + Render ─────────────────────────────────────────
		chatMessages.sort((a, b) => {
			if (a.id === -2) return -1
			if (b.id === -2) return 1
			return b.id - a.id  // newest-first
		})

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
		const excludedIds = allMessageIds.filter((id) => !includedIds.includes(id))

		// ── Diagnostics ───────────────────────────────────────────────────────
		allScoredEntries.sort((a, b) => b.score.total - a.score.total)

		const worldLoreIncluded = includedWorldLore.length
		const worldLoreCandidates = candidateWorldLore.length
		const worldLoreTopScore = scoredWorldLore.length > 0 ? Math.max(...scoredWorldLore.map((s) => s.score.total)) : 0

		const charLoreIncluded = includedCharLore.length
		const charLoreCandidates = candidateCharLore.length
		const charLoreTopScore = scoredCharLore.length > 0 ? Math.max(...scoredCharLore.map((s) => s.score.total)) : 0

		const historyIncluded = includedHistory.length
		const historyCandidates = candidateHistory.length
		const historyTopScore = scoredHistory.length > 0 ? Math.max(...scoredHistory.map((s) => s.score.total)) : 0

		let mostRecentDateStr: string | undefined
		if (mostRecentHistory) {
			mostRecentDateStr = formatDate(mostRecentHistory.year, mostRecentHistory.month, mostRecentHistory.day)
		}

		const guaranteedCount = guaranteedMessages.length
		const filledMessages = chatMessages.filter((m) => m.id !== -2 && !guaranteedMessages.some((g) => g.id === m.id)).length

		const rag: NonRagDiagnostics = {
			used: false,
			lore: {
				worldLore: {
					pinned: reservedWorldLore.length,
					candidates: worldLoreCandidates,
					included: worldLoreIncluded,
					budget: FILL_BUDGET.worldLore,
					topScore: worldLoreTopScore
				},
				characterLore: {
					pinned: reservedCharacterLore.length,
					candidates: charLoreCandidates,
					included: charLoreIncluded,
					budget: FILL_BUDGET.characterLore,
					topScore: charLoreTopScore
				},
				history: {
					pinned: reservedHistory.length,
					candidates: historyCandidates,
					included: historyIncluded,
					budget: FILL_BUDGET.history,
					topScore: historyTopScore,
					mostRecentDate: mostRecentDateStr
				}
			},
			messages: {
				guaranteed: guaranteedCount,
				candidates: candidateOlderMessages.length,
				filledIn: filledMessages,
				budget: FILL_BUDGET.messages,
				total: chatMessages.length - 1  // excluding placeholder
			},
			tokens: {
				reserve: reserveTokens,
				total: totalTokens,
				limit: tokenLimit,
				threshold: Math.floor(tokenLimit * contextThresholdPercent)
			},
			entries: allScoredEntries
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

	// ── Visibility filter for characterLore ──────────────────────────────────────

	private isCharacterLoreVisible(entry: SelectCharacterLoreEntry): boolean {
		if (!entry.lorebookBindingId) return false
		const lorebook = (this.chat as any).lorebook as any
		if (!lorebook) return false
		if (this.chat.lorebookId !== entry.lorebookId) return false

		const binding = lorebook.lorebookBindings?.find(
			(b: any) => b.id === entry.lorebookBindingId
		)
		if (!binding) return false

		if (binding.characterId) {
			// Always include current character
			if (binding.characterId === this.currentCharacterId) return true

			const chatCharacter = (this.chat.chatCharacters || []).find(
				(cc: any) => cc.character.id === binding.characterId
			)
			if (!chatCharacter) return false

			// Exclude hidden or minimal
			if (
				(chatCharacter as any).visibility === ChatCharacterVisibility.HIDDEN ||
				(chatCharacter as any).visibility === ChatCharacterVisibility.MINIMAL
			) {
				return false
			}
			return true
		} else if (binding.personaId) {
			return (this.chat.chatPersonas || []).some(
				(cp: any) => cp.persona.id === binding.personaId
			)
		}
		return false
	}

	// ── Scoring methods ──────────────────────────────────────────────────────────

	private scoreWorldLore(
		entry: SelectWorldLoreEntry,
		ctx: ScoringContext,
		maxTfidf: number
	): ScoreBreakdown {
		const keyword = computeKeywordSignal(entry, ctx.guaranteedWindowText, ctx.guaranteedWindowRaw)
		const nameMatch = entry.name ? (ctx.guaranteedWindowText.includes(entry.name.toLowerCase()) ? 1 : 0) : 0
		const entityCooccurrence = computeWorldLoreEntityCooccurrence(entry, ctx)
		const tfidfRaw = computeTfidfSignal(entry.keys + " " + entry.name, ctx)
		const tfidf = maxTfidf > 0 ? tfidfRaw / maxTfidf : 0
		const lastRefRecency = computeLastRefRecency(entry.id, ctx)

		const total =
			0.35 * keyword +
			0.25 * nameMatch +
			0.20 * entityCooccurrence +
			0.10 * tfidf +
			0.10 * lastRefRecency

		return {
			total,
			keyword,
			nameMatch,
			entityCooccurrence,
			tfidf,
			sceneAffinity: 0,
			lastRefRecency,
			recency: 0,
			density: 0,
			includedReason: "excluded_zero_score"
		}
	}

	private scoreCharacterLore(
		entry: SelectCharacterLoreEntry,
		ctx: ScoringContext,
		maxTfidf: number
	): ScoreBreakdown {
		const keyword = computeKeywordSignal(entry, ctx.guaranteedWindowText, ctx.guaranteedWindowRaw)
		const nameMatch = (entry as any).name
			? (ctx.guaranteedWindowText.includes(((entry as any).name as string).toLowerCase()) ? 1 : 0)
			: 0

		// entityCooccurrence: 1 if binding's characterId is in guaranteedWindowCharacterIds
		let entityCooccurrence = 0
		const lorebook = (this.chat as any).lorebook as any
		if (lorebook && entry.lorebookBindingId) {
			const binding = lorebook.lorebookBindings?.find((b: any) => b.id === entry.lorebookBindingId)
			if (binding?.characterId && ctx.guaranteedWindowCharacterIds.has(binding.characterId)) {
				entityCooccurrence = 1
			}
		}

		const entryText = ((entry as any).keys ?? "") + " " + ((entry as any).name ?? "")
		const tfidfRaw = computeTfidfSignal(entryText, ctx)
		const tfidf = maxTfidf > 0 ? tfidfRaw / maxTfidf : 0
		const lastRefRecency = computeLastRefRecency(entry.id, ctx)

		const total =
			0.35 * keyword +
			0.25 * nameMatch +
			0.20 * entityCooccurrence +
			0.10 * tfidf +
			0.10 * lastRefRecency

		return {
			total,
			keyword,
			nameMatch,
			entityCooccurrence,
			tfidf,
			sceneAffinity: 0,
			lastRefRecency,
			recency: 0,
			density: 0,
			includedReason: "excluded_zero_score"
		}
	}

	private scoreHistory(
		entry: { id: number; year: number; month: number | null; day: number | null; keys?: string; content?: string; caseSensitive?: boolean; useRegex?: boolean },
		ctx: ScoringContext,
		maxTfidf: number
	): ScoreBreakdown {
		const recency = ctx.historyRecencyMap.get(entry.id) ?? 0
		const keyword = entry.keys
			? computeKeywordSignal(entry as any, ctx.guaranteedWindowText, ctx.guaranteedWindowRaw)
			: 0
		const tfidfRaw = computeTfidfSignal((entry.keys ?? "") + " " + (entry.content ?? ""), ctx)
		const tfidf = maxTfidf > 0 ? tfidfRaw / maxTfidf : 0
		const sceneId = ctx.historyEntryToSceneId.get(entry.id)
		const sceneAffinity = sceneId != null && ctx.currentSceneIds.has(sceneId) ? 1 : 0
		const lastRefRecency = computeLastRefRecency(entry.id, ctx)

		const total =
			0.20 * recency +
			0.35 * keyword +
			0.10 * tfidf +
			0.10 * sceneAffinity +
			0.10 * lastRefRecency

		return {
			total,
			keyword,
			nameMatch: 0,
			entityCooccurrence: 0,
			tfidf,
			sceneAffinity,
			lastRefRecency,
			recency,
			density: 0,
			includedReason: "excluded_zero_score"
		}
	}

	private scoreMessage(
		msg: SelectChatMessage,
		idx: number,
		totalOlderMessages: number,
		ctx: ScoringContext,
		maxTfidf: number
	): ScoreBreakdown {
		const recency = totalOlderMessages > 1 ? idx / (totalOlderMessages - 1) : 0
		const tfidfRaw = computeTfidfSignal(msg.content ?? "", ctx)
		const tfidf = maxTfidf > 0 ? tfidfRaw / maxTfidf : 0
		const sceneId = ctx.messageToSceneId.get(msg.id)
		const sceneAffinity = sceneId != null && ctx.currentSceneIds.has(sceneId) ? 1 : 0
		const msgLen = msg.content?.length ?? 0
		const density = Math.min(1, msgLen / Math.max(ctx.avgMessageLength, 1))

		const total =
			0.30 * recency +
			0.10 * tfidf +
			0.15 * sceneAffinity +
			0.10 * density

		return {
			total,
			keyword: 0,
			nameMatch: 0,
			entityCooccurrence: 0,
			tfidf,
			sceneAffinity,
			lastRefRecency: 0,
			recency,
			density,
			includedReason: "excluded_zero_score"
		}
	}

	// ── Template context builder ──────────────────────────────────────────────────

	private buildTemplateContext(
		base: TemplateContext,
		charName: string,
		interpolationContext: any,
		chatMessages: ProcessedChatMessage[],
		characterLoreEntries: SelectCharacterLoreEntry[],
		worldLoreEntries: SelectWorldLoreEntry[],
		historyEntries: SelectHistoryEntry[],
		mostRecentHistory: { year: number; month: number | null; day: number | null } | null
	): any {
		const context: any = { ...base }
		context.chatMessages = chatMessages
		context.characterLore = characterLoreEntries

		// Characters
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
					aliases: cc.character.aliases?.length ? cc.character.aliases.filter((a: string) => a.trim()) : undefined,
					description: cc.character.description,
					personality: cc.character.personality || undefined
				}))
				.map((c: any) =>
					this.interpolationEngine.interpolateObject(c, interpolationContext, [
						"name", "nickname", "aliases", "description", "personality"
					])
				)
		}

		context.characters = JSON.stringify(
			attachCharacterLoreToCharacters(assistantCharacters, characterLoreEntries, this.chat),
			null, 2
		)

		const userCharacters = (this.chat.chatPersonas || [])
			.map((cp: any) => ({ name: cp.persona.name, description: cp.persona.description }))
			.map((p: any) =>
				this.interpolationEngine.interpolateObject(p, interpolationContext, ["name", "description"])
			)

		context.personas = JSON.stringify(
			attachCharacterLoreToCharacters(userCharacters, characterLoreEntries, this.chat),
			null, 2
		)

		// World lore: JSON.stringify({ [entry.name]: entry.content })
		if (worldLoreEntries.length > 0) {
			const worldLoreObj: Record<string, string> = {}
			for (const entry of worldLoreEntries) {
				if (entry?.name && entry?.content) {
					worldLoreObj[entry.name] = entry.content
				}
			}
			context.worldLore = Object.keys(worldLoreObj).length > 0
				? JSON.stringify(worldLoreObj)
				: undefined
		} else {
			context.worldLore = undefined
		}

		// History: JSON.stringify({ [dateKey]: content })
		if (historyEntries.length > 0) {
			const historyObj: Record<string, string> = {}
			// Sort history newest-first
			const sortedHistory = historyEntries.slice().sort((a, b) => {
				const aVal = ((a as any).year ?? 0) * 10000 + ((a as any).month ?? 0) * 100 + ((a as any).day ?? 0)
				const bVal = ((b as any).year ?? 0) * 10000 + ((b as any).month ?? 0) * 100 + ((b as any).day ?? 0)
				return bVal - aVal
			})
			for (const entry of sortedHistory) {
				const content = (entry as any).content ?? ""
				if (!content.trim()) continue
				const dateKey = formatHistoryDateKey(entry as any)
				historyObj[dateKey] = content
			}
			context.history = Object.keys(historyObj).length > 0
				? JSON.stringify(historyObj)
				: undefined
		} else {
			context.history = undefined
		}

		// currentDate from mostRecentHistory
		if (mostRecentHistory) {
			context.currentDate = formatDate(mostRecentHistory.year, mostRecentHistory.month, mostRecentHistory.day)
		} else {
			context.currentDate = undefined
		}

		context.narrativeGraph = undefined

		return context
	}
}

// ─── Pure helper functions ────────────────────────────────────────────────────

function tokenize(text: string): string[] {
	return text.toLowerCase().split(/\W+/).filter((t) => t.length > 1)
}

function buildTermFreq(terms: string[]): Map<string, number> {
	const freq = new Map<string, number>()
	for (const t of terms) {
		freq.set(t, (freq.get(t) ?? 0) + 1)
	}
	return freq
}

/**
 * Build a simple IDF map using messages as "documents".
 * idf(t) = log(N / (1 + df(t))) where df(t) = number of messages containing term t
 */
function buildIdf(messages: SelectChatMessage[]): Map<string, number> {
	const N = messages.length || 1
	const df = new Map<string, number>()
	for (const msg of messages) {
		const terms = new Set(tokenize(msg.content ?? ""))
		for (const t of terms) {
			df.set(t, (df.get(t) ?? 0) + 1)
		}
	}
	const idf = new Map<string, number>()
	for (const [t, d] of df) {
		idf.set(t, Math.log(N / (1 + d)))
	}
	return idf
}

/**
 * Build lastRefMap: entryId → last message index (in allMessages) where any key appears.
 */
function buildLastRefMap(
	allMessages: SelectChatMessage[],
	lorebook: { worldLoreEntries?: any[]; characterLoreEntries?: any[]; historyEntries?: any[] } | undefined
): Map<number, number> {
	const refMap = new Map<number, number>()

	const allEntries: Array<{ id: number; keys: string; caseSensitive?: boolean; useRegex?: boolean }> = [
		...(lorebook?.worldLoreEntries ?? []),
		...(lorebook?.characterLoreEntries ?? []),
		...(lorebook?.historyEntries ?? [])
	].filter((e) => e.keys)

	for (let i = 0; i < allMessages.length; i++) {
		const msgContent = allMessages[i].content ?? ""
		for (const entry of allEntries) {
			const keys = entry.keys.split(",")
			const msgText = entry.caseSensitive ? msgContent : msgContent.toLowerCase()
			const matched = keys.some((key) => {
				const k = entry.caseSensitive ? key.trim() : key.trim().toLowerCase()
				if (entry.useRegex) {
					try { return new RegExp(k).test(msgText) } catch { return msgText.includes(k) }
				}
				return msgText.includes(k)
			})
			if (matched) {
				refMap.set(entry.id, i)
			}
		}
	}

	return refMap
}

/**
 * Build historyRecencyMap: entryId → 0..1 (1 = newest, 0 = oldest)
 */
function buildHistoryRecencyMap(historyEntries: any[]): Map<number, number> {
	const map = new Map<number, number>()
	if (historyEntries.length === 0) return map

	// Sort by date ascending
	const sorted = historyEntries
		.filter((e) => e.year != null)
		.map((e) => ({ id: e.id, val: (e.year ?? 0) * 10000 + (e.month ?? 0) * 100 + (e.day ?? 0) }))
		.sort((a, b) => a.val - b.val)

	if (sorted.length === 0) return map
	if (sorted.length === 1) {
		map.set(sorted[0].id, 1)
		return map
	}

	sorted.forEach((item, idx) => {
		map.set(item.id, idx / (sorted.length - 1))
	})

	return map
}

/**
 * Compute keyword signal: fraction of entry keys matched in the guaranteed window text.
 */
function computeKeywordSignal(
	entry: { keys?: string; caseSensitive?: boolean | null; useRegex?: boolean | null },
	guaranteedWindowText: string,
	guaranteedWindowRaw: string
): number {
	if (!entry.keys) return 0
	const keys = entry.keys.split(",").map((k) => k.trim()).filter((k) => k.length > 0)
	if (keys.length === 0) return 0

	let matched = 0
	for (const key of keys) {
		const text = entry.caseSensitive ? guaranteedWindowRaw : guaranteedWindowText
		const k = entry.caseSensitive ? key : key.toLowerCase()
		if (entry.useRegex) {
			try {
				if (new RegExp(k).test(text)) matched++
			} catch {
				if (text.includes(k)) matched++
			}
		} else {
			if (text.includes(k)) matched++
		}
	}
	return matched / keys.length
}

/**
 * Compute entity co-occurrence for worldLore: 1 if any chat character/persona name
 * appears in the entry name + keys.
 */
function computeWorldLoreEntityCooccurrence(
	entry: SelectWorldLoreEntry,
	ctx: ScoringContext
): number {
	const entryText = ((entry.name ?? "") + " " + (entry.keys ?? "")).toLowerCase()
	for (const name of ctx.chatCharacterNames) {
		if (entryText.includes(name)) return 1
	}
	for (const name of ctx.chatPersonaNames) {
		if (entryText.includes(name)) return 1
	}
	return 0
}

/**
 * Compute TF-IDF overlap of entry text with guaranteed window terms.
 * Returns raw (un-normalized) score.
 */
function computeTfidfSignal(entryText: string, ctx: ScoringContext): number {
	if (!entryText) return 0
	const terms = tokenize(entryText)
	if (terms.length === 0) return 0

	let score = 0
	for (const t of terms) {
		const tf = (ctx.guaranteedTermFreq.get(t) ?? 0) / Math.max(ctx.guaranteedMessages.length, 1)
		const idf = ctx.idfMap.get(t) ?? 0
		score += tf * idf
	}
	return score
}

/**
 * Compute lastRefRecency signal: exp(-0.01 * (totalMessages - lastRefIdx))
 */
function computeLastRefRecency(entryId: number, ctx: ScoringContext): number {
	const lastIdx = ctx.lastRefMap.get(entryId)
	if (lastIdx == null) return 0
	const totalMessages = ctx.allMessages.length
	return Math.exp(-0.01 * (totalMessages - lastIdx))
}

function formatHistoryDateKey(entry: { year?: number; month?: number | null; day?: number | null }): string {
	return formatDate(entry.year ?? 0, entry.month ?? null, entry.day ?? null)
}

function formatDate(year: number, month: number | null | undefined, day: number | null | undefined): string {
	let key = String(year)
	if (month != null) key += `-${String(month).padStart(2, "0")}`
	if (day != null) key += `-${String(day).padStart(2, "0")}`
	return key
}

function zeroScoreWith(reason: import("./types").InclusionReason): ScoreBreakdown {
	return {
		total: 1,
		keyword: 0,
		nameMatch: 0,
		entityCooccurrence: 0,
		tfidf: 0,
		sceneAffinity: 0,
		lastRefRecency: 0,
		recency: 0,
		density: 0,
		includedReason: reason
	}
}
