/**
 * Summarizer — two-phase lore entry generation.
 *
 * Phase 1 — Batch drafting:
 *   Messages are split into token-sized batches. Each batch is drafted
 *   independently — the LLM only sees that batch's messages (as JSON)
 *   and produces a single <content> draft. Drafts are collected in order.
 *
 * Phase 2 — Synthesis:
 *   All drafts are passed as an ordered JSON array to a synthesis prompt.
 *   The LLM merges them into one coherent, past-tense narrative and
 *   produces a final <content>.
 */

import { getConnectionAdapter } from "../getConnectionAdapter"
import { TokenCounters } from "../TokenCounterManager"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"
import {
	buildBatchPrompt,
	buildNamePrompt,
	buildSynthesisPrompt,
	formatMessagesAsJson,
	type JsonDraft
} from "./templates"
import { parseSummaryOutput } from "./parser"

export type SummarizePhase = "drafting" | "synthesizing"

export interface SummarizeProgressData {
	phase: SummarizePhase
	batch: number
	totalBatches: number
	partial: { content?: string; raw?: string }
}

export interface SummarizeInput {
	messages: { senderName: string; content: string }[]
	loreType: "world" | "history" | "character" | "scene"
	topic?: string
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	summarizePromptConfig?: { batchSystemPrompt: string; synthSystemPrompt: string; nameSystemPrompt: string } | null
	onProgress?: (data: SummarizeProgressData) => void
}

export interface SummarizeResult {
	content: string | undefined
	name: string | undefined
	raw: string
	batchCount: number
}

function estimateTokens(text: string): number {
	return Math.ceil(text.length / 3.5)
}

function batchMessages(
	messages: { senderName: string; content: string }[],
	tokenLimit: number
): { senderName: string; content: string }[][] {
	// Reserve headroom for prompt template + draft output
	const budget = Math.max(tokenLimit - 1500, 500)
	const batches: { senderName: string; content: string }[][] = []
	let current: { senderName: string; content: string }[] = []
	let currentTokens = 0

	for (const msg of messages) {
		const msgTokens = estimateTokens(JSON.stringify({ speaker: msg.senderName, text: msg.content })) + 5
		if (current.length > 0 && currentTokens + msgTokens > budget) {
			batches.push(current)
			current = [msg]
			currentTokens = msgTokens
		} else {
			current.push(msg)
			currentTokens += msgTokens
		}
	}

	if (current.length > 0) batches.push(current)
	return batches.length > 0 ? batches : [[]]
}

function buildMinimalChat(userPrompt: string): any {
	return {
		id: 0,
		userId: 0,
		name: null,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		scenario: null,
		metadata: null,
		lorebookId: null,
		isGroup: false,
		chatType: ChatTypes.SUMMARIZE,
		groupReplyStrategy: null,
		chatMessages: [
			{
				id: 1,
				chatId: 0,
				role: "user",
				content: userPrompt,
				createdAt: new Date().toISOString(),
				isHidden: false,
				isGenerating: false,
				metadata: null
			}
		],
		lorebook: {
			id: 0,
			userId: 0,
			name: "",
			description: null,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			lorebookBindings: []
		}
	}
}

async function runGeneration(
	promptData: { systemPrompt: string; userPrompt: string },
	opts: {
		connection: SelectConnection
		sampling: SelectSamplingConfig
		contextConfig: SelectContextConfig
		promptConfig: SelectPromptConfig
		tokenCounter: TokenCounters
		tokenLimit: number
		maxTokens: number
	}
): Promise<string> {
	const AdapterClass = getConnectionAdapter(opts.connection.type)
	const fakeChat = buildMinimalChat(promptData.userPrompt)

	const adapter = new AdapterClass.Adapter({
		connection: opts.connection,
		sampling: { ...opts.sampling, maxTokens: opts.maxTokens },
		contextConfig: opts.contextConfig,
		promptConfig: { ...opts.promptConfig, systemPrompt: promptData.systemPrompt },
		chat: fakeChat,
		currentCharacterId: null,
		tokenCounter: opts.tokenCounter,
		tokenLimit: opts.tokenLimit,
		contextThresholdPercent: 0.9,
		isAssistantMode: false
	})

	let raw = ""
	const { completionResult } = await adapter.generate()

	if (typeof completionResult === "string") {
		raw = completionResult
	} else {
		await completionResult((chunk: string) => {
			raw += chunk
		})
	}

	return raw.trim()
}

export interface CompileInput {
	scenes: { name: string | null; summary: string | null }[]
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	onProgress?: (data: SummarizeProgressData) => void
}

/**
 * Synthesize scene summaries into a single history entry content string.
 * Skips the batch-drafting phase — scenes are already drafted.
 */
export async function compileScenesForEntry(input: CompileInput): Promise<SummarizeResult> {
	const { scenes, connection, sampling, contextConfig, promptConfig, onProgress } = input

	const tokenCounter = new TokenCounters("estimate")
	const tokenLimit: number = (connection as any).tokenLimit ?? (connection as any).contextSize ?? 4096
	const genOpts = { connection, sampling, contextConfig, promptConfig, tokenCounter, tokenLimit }

	const drafts: JsonDraft[] = scenes
		.filter((s) => s.summary?.trim())
		.map((s, i) => ({ part: i + 1, draft: s.summary! }))

	if (drafts.length === 0) {
		throw new Error("No scene summaries to compile.")
	}

	onProgress?.({ phase: "synthesizing", batch: 1, totalBatches: 1, partial: {} })

	if (drafts.length === 1) {
		const content = drafts[0].draft
		onProgress?.({ phase: "synthesizing", batch: 1, totalBatches: 1, partial: { content } })
		return { content, name: undefined, raw: content, batchCount: 1 }
	}

	const jsonDrafts = JSON.stringify(drafts, null, 2)
	const synthesisPrompt = buildSynthesisPrompt({ jsonDrafts, loreType: "history", topic: undefined })
	const synthesisRaw = await runGeneration(synthesisPrompt, { ...genOpts, maxTokens: 2000 })
	const finalParsed = parseSummaryOutput(synthesisRaw)
	const fallbackContent = drafts.map((d) => d.draft).join("\n\n")
	const content = finalParsed.content || fallbackContent

	onProgress?.({
		phase: "synthesizing",
		batch: 1,
		totalBatches: 1,
		partial: { content: finalParsed.content, raw: synthesisRaw }
	})

	return { content, name: undefined, raw: synthesisRaw, batchCount: drafts.length }
}

export async function generateSummary(
	input: SummarizeInput
): Promise<SummarizeResult> {
	const { messages, loreType, topic, connection, sampling, contextConfig, promptConfig, summarizePromptConfig, onProgress } = input

	const tokenCounter = new TokenCounters("estimate")
	const tokenLimit: number = (connection as any).tokenLimit ?? (connection as any).contextSize ?? 4096
	const genOpts = { connection, sampling, contextConfig, promptConfig, tokenCounter, tokenLimit }

	const batches = batchMessages(messages, tokenLimit)
	const totalBatches = batches.length

	// ── Phase 1: Draft each batch independently ──────────────────────────────
	const drafts: JsonDraft[] = []

	for (let i = 0; i < batches.length; i++) {
		const jsonMessages = formatMessagesAsJson(batches[i])
		const promptData = buildBatchPrompt({ jsonMessages, loreType, topic, systemPromptOverride: summarizePromptConfig?.batchSystemPrompt })
		const raw = await runGeneration(promptData, { ...genOpts, maxTokens: 1000 })
		const parsed = parseSummaryOutput(raw)
		const draftContent = parsed.content || raw // fall back to raw if tags missing

		drafts.push({ part: i + 1, draft: draftContent })

		onProgress?.({
			phase: "drafting",
			batch: i + 1,
			totalBatches,
			partial: { content: parsed.content, raw }
		})
	}

	// ── Phase 2: Synthesize all drafts into one entry ────────────────────────
	onProgress?.({
		phase: "synthesizing",
		batch: totalBatches,
		totalBatches,
		partial: {}
	})

	// ── Name generation helper ───────────────────────────────────────────────
	async function generateName(content: string): Promise<string | undefined> {
		try {
			const namePrompt = buildNamePrompt({ content, loreType, systemPromptOverride: summarizePromptConfig?.nameSystemPrompt })
			const nameRaw = await runGeneration(namePrompt, { ...genOpts, maxTokens: 30 })
			const name = nameRaw.trim().replace(/['".,!?]+$/g, "")
			return name.length > 0 ? name : undefined
		} catch {
			return undefined
		}
	}

	// If only one batch, skip synthesis — the single draft is the final result
	if (drafts.length === 1) {
		const content = drafts[0].draft
		const name = (loreType === "world" || loreType === "character" || loreType === "scene") ? await generateName(content) : undefined
		return {
			content,
			name,
			raw: drafts[0].draft,
			batchCount: totalBatches
		}
	}

	const jsonDrafts = JSON.stringify(drafts, null, 2)
	const synthesisPrompt = buildSynthesisPrompt({ jsonDrafts, loreType, topic, systemPromptOverride: summarizePromptConfig?.synthSystemPrompt })
	const synthesisRaw = await runGeneration(synthesisPrompt, { ...genOpts, maxTokens: 2000 })
	const finalParsed = parseSummaryOutput(synthesisRaw)

	// Fall back to joining drafts if synthesis fails to produce tags
	const fallbackContent = drafts.map((d) => d.draft).join("\n\n")
	const finalContent = finalParsed.content || fallbackContent

	onProgress?.({
		phase: "synthesizing",
		batch: totalBatches,
		totalBatches,
		partial: { content: finalParsed.content, raw: synthesisRaw }
	})

	const name = (loreType === "world" || loreType === "character" || loreType === "scene") ? await generateName(finalContent) : undefined

	return {
		content: finalContent,
		name,
		raw: synthesisRaw,
		batchCount: totalBatches
	}
}
