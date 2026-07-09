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
import { runQueuedLLMCall } from "../runQueuedLLMCall"
import type { TaskType } from "../resolveTaskConfig"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"
import {
	buildBatchPrompt,
	buildCharacterExtractionPrompt,
	buildNamePrompt,
	buildSynthesisPrompt,
	formatMessagesAsJson,
	type CastEntry,
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
	summarizePromptConfig?: { batchSystemPrompt: string; synthSystemPrompt: string; nameSystemPrompt: string; characterExtractionSystemPrompt?: string | null } | null
	/** Per-sub-task connection/sampling overrides — fall back to connection/sampling if not set */
	batchConnection?: SelectConnection | null
	batchSampling?: SelectSamplingConfig | null
	synthConnection?: SelectConnection | null
	synthSampling?: SelectSamplingConfig | null
	nameConnection?: SelectConnection | null
	nameSampling?: SelectSamplingConfig | null
	/** Known cast for scene character extraction — seeded from prior scenes and bindings */
	knownCast?: CastEntry[]
	onProgress?: (data: SummarizeProgressData) => void
	onLlmCall?: (entry: { label: string; system: string; user: string; response: string }) => void
}

export interface SummarizeResult {
	content: string | undefined
	name: string | undefined
	raw: string
	batchCount: number
	/** Populated for loreType === "scene" only */
	participantCharacters?: string[]
	mentionedCharacters?: string[]
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
		taskType: TaskType
		label?: string
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

	const { text } = await runQueuedLLMCall({
		adapter,
		taskType: opts.taskType,
		connectionName: opts.connection.name,
		samplingName: opts.sampling.name,
		label: opts.label
	})

	return text
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
	const synthesisRaw = await runGeneration(synthesisPrompt, {
		...genOpts,
		maxTokens: 2000,
		taskType: "summarize_synth",
		label: "history"
	})
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
	const {
		messages, loreType, topic, connection, sampling, contextConfig, promptConfig,
		summarizePromptConfig, onProgress, onLlmCall, knownCast,
		batchConnection, batchSampling, synthConnection, synthSampling, nameConnection, nameSampling
	} = input

	const batchConn = batchConnection ?? connection
	const batchSamp = batchSampling ?? sampling
	const synthConn = synthConnection ?? connection
	const synthSamp = synthSampling ?? sampling
	const nameConn = nameConnection ?? connection
	const nameSamp = nameSampling ?? sampling

	const tokenCounter = new TokenCounters("estimate")
	const tokenLimit: number = (batchConn as any).tokenLimit ?? (batchConn as any).contextSize ?? 4096
	const batchOpts = { connection: batchConn, sampling: batchSamp, contextConfig, promptConfig, tokenCounter, tokenLimit }
	const synthOpts = { connection: synthConn, sampling: synthSamp, contextConfig, promptConfig, tokenCounter, tokenLimit: (synthConn as any).tokenLimit ?? (synthConn as any).contextSize ?? 4096 }
	const nameOpts = { connection: nameConn, sampling: nameSamp, contextConfig, promptConfig, tokenCounter, tokenLimit: (nameConn as any).tokenLimit ?? (nameConn as any).contextSize ?? 4096 }

	const batches = batchMessages(messages, tokenLimit)
	const totalBatches = batches.length

	// ── Phase 1: Draft each batch independently ──────────────────────────────
	const drafts: JsonDraft[] = []

	for (let i = 0; i < batches.length; i++) {
		const jsonMessages = formatMessagesAsJson(batches[i])
		const promptData = buildBatchPrompt({ jsonMessages, loreType, topic, systemPromptOverride: summarizePromptConfig?.batchSystemPrompt })
		const raw = await runGeneration(promptData, {
			...batchOpts,
			maxTokens: 1000,
			taskType: "summarize_batch",
			label: `${loreType} batch ${i + 1}/${totalBatches}`
		})
		onLlmCall?.({ label: `Batch ${i + 1} / ${totalBatches}`, system: promptData.systemPrompt, user: promptData.userPrompt, response: raw })
		const parsed = parseSummaryOutput(raw)
		const draftContent = parsed.content || raw

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
			const nameRaw = await runGeneration(namePrompt, {
				...nameOpts,
				maxTokens: 30,
				taskType: "summarize_name",
				label: loreType
			})
			const name = nameRaw.trim().replace(/['".,!?]+$/g, "")
			return name.length > 0 ? name : undefined
		} catch {
			return undefined
		}
	}

	// ── Character extraction helper (scene type only) ────────────────────────
	async function extractCharacters(content: string): Promise<{ participantCharacters: string[]; mentionedCharacters: string[] }> {
		try {
			const extractionPrompt = buildCharacterExtractionPrompt(content, summarizePromptConfig?.characterExtractionSystemPrompt, knownCast)
			const raw = await runGeneration(extractionPrompt, {
				...nameOpts,
				maxTokens: 500,
				taskType: "character_extraction",
				label: "character extraction"
			})
			onLlmCall?.({ label: "Character Extraction", system: extractionPrompt.systemPrompt, user: extractionPrompt.userPrompt, response: raw })
			// Strip markdown code fences if present, then extract the first {...} block
			const stripped = raw.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim()
			const jsonMatch = stripped.match(/\{[\s\S]*\}/)
			if (!jsonMatch) throw new Error("No JSON object found in character extraction response")
			const parsed = JSON.parse(jsonMatch[0])
			return {
				participantCharacters: Array.isArray(parsed.participants) ? parsed.participants.filter((n: unknown) => typeof n === "string") : [],
				mentionedCharacters: Array.isArray(parsed.mentioned) ? parsed.mentioned.filter((n: unknown) => typeof n === "string") : []
			}
		} catch {
			return { participantCharacters: [], mentionedCharacters: [] }
		}
	}

	// If only one batch, skip synthesis — the single draft is the final result
	if (drafts.length === 1) {
		const content = drafts[0].draft
		const name = (loreType === "world" || loreType === "character" || loreType === "scene") ? await generateName(content) : undefined
		const { participantCharacters, mentionedCharacters } = loreType === "scene" ? await extractCharacters(content) : {}
		return { content, name, raw: drafts[0].draft, batchCount: totalBatches, participantCharacters, mentionedCharacters }
	}

	const jsonDrafts = JSON.stringify(drafts, null, 2)
	const synthesisPrompt = buildSynthesisPrompt({ jsonDrafts, loreType, topic, systemPromptOverride: summarizePromptConfig?.synthSystemPrompt })
	const synthesisRaw = await runGeneration(synthesisPrompt, {
		...synthOpts,
		maxTokens: 2000,
		taskType: "summarize_synth",
		label: loreType
	})
	onLlmCall?.({ label: "Synthesis", system: synthesisPrompt.systemPrompt, user: synthesisPrompt.userPrompt, response: synthesisRaw })
	const finalParsed = parseSummaryOutput(synthesisRaw)

	const fallbackContent = drafts.map((d) => d.draft).join("\n\n")
	const finalContent = finalParsed.content || fallbackContent

	onProgress?.({
		phase: "synthesizing",
		batch: totalBatches,
		totalBatches,
		partial: { content: finalParsed.content, raw: synthesisRaw }
	})

	const name = (loreType === "world" || loreType === "character" || loreType === "scene") ? await generateName(finalContent) : undefined
	const { participantCharacters, mentionedCharacters } = loreType === "scene" ? await extractCharacters(finalContent) : {}

	return { content: finalContent, name, raw: synthesisRaw, batchCount: totalBatches, participantCharacters, mentionedCharacters }
}
