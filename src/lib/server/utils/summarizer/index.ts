/**
 * Summarizer helpers outside the pipeline executor.
 *
 * The live summarizer is the pipeline — `sockets/summarize.ts` runs the
 * `core:spec/summarize-*` specs. What stays here is what other paths still
 * call directly: `compileScenesForEntry` (scenes.ts — a history entry
 * synthesised from its scenes' summaries) and `extractCharactersFromContent`
 * (graphBuilder.ts). The legacy batch-and-synthesise `generateSummary` that
 * once lived here was reached by tests only and is gone (Phase D).
 */

import { getConnectionAdapter } from "../getConnectionAdapter"
import { composeStopsFor } from "$lib/server/connections/stops"
import { extractJson } from "../extractJson"
import { resolveSampling } from "../resolveSampling"
import { TokenCounters } from "../TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { runQueuedLLMCall } from "../runQueuedLLMCall"
import type { TaskType } from "../resolveTaskConfig"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"
import {
	buildCharacterExtractionPrompt,
	buildSynthesisPrompt,
	type CastEntry,
	type ExtractedCastRef,
	type JsonDraft
} from "./templates"
import { parseSummaryOutput } from "./parser"

export interface SummarizeResult {
	content: string | undefined
	name: string | undefined
	raw: string
	batchCount: number
}

function buildMinimalSession(userPrompt: string): any {
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
		sessionType: SessionTypes.SUMMARIZE,
		sessionMessages: [
			{
				id: 1,
				sessionId: 0,
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
		tokenCounter: TokenCounters
		tokenLimit: number
		maxTokens: number
		taskType: TaskType
		label?: string
		signal?: AbortSignal
	}
): Promise<string> {
	// Fast path: don't even start a new call if cancellation was already
	// requested between batches/phases.
	opts.signal?.throwIfAborted()

	const AdapterClass = await getConnectionAdapter(opts.connection.type)
	const fakeSession = buildMinimalSession(promptData.userPrompt)

	const adapter = new AdapterClass.Adapter({
		connection: opts.connection,
		// Every sub-task's config arrives here as a row, so this is the one place
		// the summarizer turns one into what an adapter takes: the parameters
		// actually switched on, defaults applied. The row's `name` is still read
		// off the row below — identity is not a parameter, and a key called
		// `name` sitting among the samplers is one collision away from being sent
		// as one.
		sampling: {
			...resolveSampling(opts.sampling),
			maxTokens: opts.maxTokens
		},
		systemPrompt: promptData.systemPrompt,
		session: fakeSession,
		currentCharacterId: null,
		tokenCounter: opts.tokenCounter,
		tokenLimit: opts.tokenLimit,
		contextThresholdPercent: 0.9
	})

	// The stop sequences, composed once and handed over (ruling 2026-09-10). An
	// adapter builds none of its own, so a construction site that skips this
	// sends a request with NO stops — and a summary that runs on past its answer
	// reads as a bad model rather than a missing line here.
	//
	// The fake session carries no cast, so nothing composes a speaker label; what
	// reaches the wire is the connection's own completion template, which is what
	// this path always had.
	adapter.withStops(composeStopsFor(opts.connection, fakeSession))

	const result = await runQueuedLLMCall({
		adapter,
		taskType: opts.taskType,
		connectionName: opts.connection.name,
		samplingName: opts.sampling.name,
		label: opts.label,
		signal: opts.signal
	})

	if (result.isAborted) {
		opts.signal?.throwIfAborted() // the expected path — our own signal really was aborted
		// isAborted true but OUR signal isn't — the adapter/queue stopped for
		// a reason of its own, not our cancellation. Don't dress this up as
		// an AbortError: that label means "the user cancelled this," which
		// scenes.ts's catch guard keys on via abortController.signal
		// specifically, not by error name/type.
		throw new Error(
			"Generation stopped unexpectedly (reported aborted without a matching cancellation signal)"
		)
	}

	return result.text
}

/**
 * Extracts character names present/mentioned in a piece of prose via a
 * dedicated LLM call, resolved against a known-cast list. It runs against
 * content that's already final text — e.g. a history entry with no scenes.
 */
export async function extractCharactersFromContent(params: {
	content: string
	connection: SelectConnection
	sampling: SelectSamplingConfig
	characterExtractionSystemPrompt?: string | null
	knownCast?: CastEntry[]
	onLlmCall?: (entry: {
		label: string
		system: string
		user: string
		response: string
	}) => void
	signal?: AbortSignal
}): Promise<{
	participantCharacters: ExtractedCastRef[]
	mentionedCharacters: ExtractedCastRef[]
}> {
	const {
		content,
		connection,
		sampling,
		characterExtractionSystemPrompt,
		knownCast,
		onLlmCall,
		signal
	} = params
	const tokenCounter = new TokenCounters(
		connection.tokenCounter || TokenCounterOptions.ESTIMATE
	)
	// ⚠ 4096 outright, not a fallback. This read
	// `(connection as any).tokenLimit ?? (connection as any).contextSize`
	// first, but `connections` has never had either column — both were
	// `undefined` on every row that has ever been loaded, so the expression
	// always fell through to this literal. The casts were what let the dead
	// reads typecheck; removing them changes nothing at runtime.
	//
	// ⚠ Deliberately NOT widened to the sampling config's `contextTokens`,
	// which is where `dispatchStep.ts` lands after the same removal. This path
	// never read it, so borrowing it here would be a real change to the prompt
	// budget — a decision for the summarizer's own contract, not a side effect
	// of deleting dead code.
	const tokenLimit: number = 4096

	try {
		const extractionPrompt = buildCharacterExtractionPrompt(
			content,
			characterExtractionSystemPrompt,
			knownCast
		)
		const raw = await runGeneration(extractionPrompt, {
			connection,
			sampling,
			tokenCounter,
			tokenLimit,
			maxTokens: 500,
			taskType: "character_extraction",
			label: "character extraction",
			signal
		})
		onLlmCall?.({
			label: "Character Extraction",
			system: extractionPrompt.systemPrompt,
			user: extractionPrompt.userPrompt,
			response: raw
		})
		// Shared extractor rather than a local regex. This used to be
		// `stripped.match(/\{[\s\S]*\}/)`, which is greedy: it runs to the LAST
		// `}` anywhere in the response, so a trailing remark after the object —
		// or a second object — got swallowed into the slice and JSON.parse threw
		// on input a brace-depth walk handles fine. Failures here degrade
		// silently to an empty cast (see the catch below), so this was invisible.
		const parsed = JSON.parse(extractJson(raw))
		return {
			participantCharacters: normalizeCastRefs(parsed.participants),
			mentionedCharacters: normalizeCastRefs(parsed.mentioned)
		}
	} catch (err) {
		// An aborted generation must not degrade into "nobody was in this
		// scene". Callers act on this result — the summarize path persists it,
		// and the graph build feeds it into a proposal the user then reviews
		// and commits — so swallowing a cancel either writes an empty cast over
		// real data or silently produces a proposal missing characters.
		// Non-abort parse/LLM failures still degrade to empty, as before.
		if (signal?.aborted) throw err
		return { participantCharacters: [], mentionedCharacters: [] }
	}
}

/**
 * Normalizes one participants/mentioned array from the extraction LLM's raw
 * JSON into ExtractedCastRef[] — accepting both the current
 * `{"castId": N}` / `{"name": "..."}` object shape and the legacy bare
 * string[] shape (models sometimes ignore structured-output instructions,
 * or a custom prompt override still asks for the old format — this is
 * defense in depth, not a hard cutover).
 */
function normalizeCastRefs(value: unknown): ExtractedCastRef[] {
	if (!Array.isArray(value)) return []
	const refs: ExtractedCastRef[] = []
	for (const entry of value) {
		if (typeof entry === "string") {
			if (entry.trim()) refs.push({ name: entry })
		} else if (entry && typeof entry === "object") {
			const obj = entry as Record<string, unknown>
			if (typeof obj.castId === "number") {
				refs.push({ castId: obj.castId })
			} else if (typeof obj.name === "string" && obj.name.trim()) {
				refs.push({ name: obj.name })
			}
		}
	}
	return refs
}

// Compile (history-entry synthesis from prior scenes) has no naming or
// character-extraction step — so its phase union is only the two phases
// compileScenesForEntry actually emits.
export interface CompileProgressData {
	phase: "drafting" | "synthesizing"
	batch: number
	totalBatches: number
	partial: { content?: string; raw?: string }
}

export interface CompileInput {
	scenes: { name: string | null; summary: string | null }[]
	connection: SelectConnection
	sampling: SelectSamplingConfig
	/**
	 * The history pipeline's configured synth prompt, when a person chose one.
	 * Blank falls back to the template's own default — the same rule the
	 * summarize-synth binding applies.
	 */
	synthSystemPrompt?: string | null
	onProgress?: (data: CompileProgressData) => void
	signal?: AbortSignal
}

/**
 * Synthesize scene summaries into a single history entry content string.
 * Skips the batch-drafting phase — scenes are already drafted.
 */
export async function compileScenesForEntry(
	input: CompileInput
): Promise<SummarizeResult> {
	const {
		scenes,
		connection,
		sampling,
		onProgress,
		signal
	} = input

	// Honor the connection's own configured tokenizer — see the identical
	// fix/comment in generateResponse.ts.
	const tokenCounter = new TokenCounters(
		connection.tokenCounter || TokenCounterOptions.ESTIMATE
	)
	// 4096 outright — see the note in extractCharactersFromContent above.
	const tokenLimit: number = 4096
	const genOpts = {
		connection,
		sampling,
		tokenCounter,
		tokenLimit,
		signal
	}

	const drafts: JsonDraft[] = scenes
		.filter((s) => s.summary?.trim())
		.map((s, i) => ({ part: i + 1, draft: s.summary! }))

	if (drafts.length === 0) {
		throw new Error("No scene summaries to compile.")
	}

	onProgress?.({
		phase: "synthesizing",
		batch: 1,
		totalBatches: 1,
		partial: {}
	})

	if (drafts.length === 1) {
		const content = drafts[0].draft
		onProgress?.({
			phase: "synthesizing",
			batch: 1,
			totalBatches: 1,
			partial: { content }
		})
		return { content, name: undefined, raw: content, batchCount: 1 }
	}

	const jsonDrafts = JSON.stringify(drafts, null, 2)
	const synthesisPrompt = buildSynthesisPrompt({
		jsonDrafts,
		loreType: "history",
		topic: undefined,
		systemPromptOverride: input.synthSystemPrompt?.trim()
			? input.synthSystemPrompt
			: null
	})
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

	return {
		content,
		name: undefined,
		raw: synthesisRaw,
		batchCount: drafts.length
	}
}
