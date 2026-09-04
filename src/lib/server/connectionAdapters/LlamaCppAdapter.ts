import Handlebars from "handlebars"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import _ from "lodash"
import { StopStrings } from "../utils/StopStrings"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { TokenCounters } from "../utils/TokenCounterManager"
import {
	BaseConnectionAdapter,
	type AdapterExports,
	type BasePromptSession
} from "./BaseConnectionAdapter"
import { type CompiledPrompt } from "./types"
import type { TextGenResult } from "$lib/server/adapters/actions"
import axios from "axios"
import { Readable } from "stream"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { llamaCppSamplingKeyMap } from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { JSON_OBJECT_GBNF } from "./jsonGrammar"
import { jsonSchemaToGbnf } from "./jsonSchemaToGbnf"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { LLM_IDLE_TIMEOUT_MS } from "./idleTimeout"

// GET /health
export type HealthResponse =
	| { status: "ok" }
	| { error: { code: number; message: string; type: string } }

// POST /completion (non-OAI-compatible)
export interface CompletionRequest {
	prompt: string | (string | number)[]
	temperature?: number
	dynatemp_range?: number
	dynatemp_exponent?: number
	top_k?: number
	top_p?: number
	min_p?: number
	n_predict?: number
	n_indent?: number
	n_keep?: number
	stream?: boolean
	stop?: string[]
	typical_p?: number
	repeat_penalty?: number
	repeat_last_n?: number
	presence_penalty?: number
	frequency_penalty?: number
	dry_multiplier?: number
	dry_base?: number
	dry_allowed_length?: number
	dry_penalty_last_n?: number
	dry_sequence_breakers?: string[]
	xtc_probability?: number
	xtc_threshold?: number
	mirostat?: 0 | 1 | 2
	mirostat_tau?: number
	mirostat_eta?: number
	grammar?: string
	json_schema?: object
	seed?: number
	ignore_eos?: boolean
	logit_bias?: [number, number][]
	n_probs?: number
	min_keep?: number
	t_max_predict_ms?: number
	image_data?: { id: string; data: string }[]
	id_slot?: number
	cache_prompt?: boolean
	return_tokens?: boolean
	samplers?: string[]
	timings_per_token?: boolean
	post_sampling_probs?: boolean
	response_fields?: string[]
	lora?: { id: number; scale: number }[]
	[key: string]: any
}

export interface CompletionResponse {
	content: string
	tokens?: number[]
	stop?: boolean
	generation_settings?: Record<string, any>
	model?: string
	prompt?: string | (string | number)[]
	stop_type?: "none" | "eos" | "limit" | "word"
	stopping_word?: string
	timings?: Record<string, any>
	tokens_cached?: number
	tokens_evaluated?: number
	truncated?: boolean
	probs?: Array<{
		id: number
		logprob?: number
		token: string
		bytes: number[]
		top_logprobs?: Array<{
			id: number
			logprob?: number
			token: string
			bytes: number[]
			prob?: number
		}>
		top_probs?: Array<{
			id: number
			token: string
			bytes: number[]
			prob: number
		}>
	}>
	[key: string]: any
}

// POST /tokenize
export interface TokenizeRequest {
	content: string
	add_special?: boolean
	with_pieces?: boolean
}
export type TokenizeResponse =
	| { tokens: number[] }
	| { tokens: { id: number; piece: string | number[] }[] }

// POST /detokenize
export interface DetokenizeRequest {
	tokens: number[]
}

// POST /apply-template
export interface ApplyTemplateRequest {
	messages: any[] // Format as in /v1/chat/completions
}
export interface ApplyTemplateResponse {
	prompt: string
}

// POST /embedding
export interface EmbeddingRequest {
	content: string
	image_data?: { id: string; data: string }[]
}
export interface EmbeddingResponse {
	embedding: number[]
	[key: string]: any
}

// POST /reranking
export interface RerankingRequest {
	query: string
	documents: string[]
}
export interface RerankingResponse {
	rankings: number[] // or similar structure (not fully specified in README)
}

// POST /infill
export interface InfillRequest {
	input_prefix: string
	input_suffix: string
	input_extra?: { filename: string; text: string }[]
	prompt?: string
	[key: string]: any // All /completion options supported
}

// GET /props & POST /props
export interface PropsResponse {
	default_generation_settings: Record<string, any>
	total_slots: number
	model_path: string
	chat_template: string
	modalities: Record<string, boolean>
	build_info: string
}

// POST /embeddings (non-OAI)
export interface EmbeddingsRequest {
	content: string
}
export type EmbeddingsResponse = Array<{
	index: number
	embedding: number[] | number[][]
}>

// GET /slots
export type SlotState = {
	id: number
	id_task: number
	n_ctx: number
	speculative: boolean
	is_processing: boolean
	params: Record<string, any>
	prompt: string
	next_token: {
		has_next_token: boolean
		has_new_line: boolean
		n_remain: number
		n_decoded: number
		stopping_word: string
	}
}
export type SlotsResponse = SlotState[]

// POST /slots/{id_slot}?action=save
export interface SlotSaveResponse {
	id_slot: number
	filename: string
	n_saved: number
	n_written: number
	timings: { save_ms: number }
}

// POST /slots/{id_slot}?action=restore
export interface SlotRestoreResponse {
	id_slot: number
	filename: string
	n_restored: number
	n_read: number
	timings: { restore_ms: number }
}

// POST /slots/{id_slot}?action=erase
export interface SlotEraseResponse {
	id_slot: number
	n_erased: number
}

// GET /lora-adapters
export interface LoraAdapter {
	id: number
	scale: number
	[key: string]: any
}
export type LoraAdaptersResponse = LoraAdapter[]

class LlamaCppAdapter extends BaseConnectionAdapter {
	private abortController?: AbortController
	// Stored on `this` (not a local const, as it was before) for the exact
	// same reason as abortController above — abort() is called externally
	// while a streaming request is in flight, and a local variable inside
	// the streaming closure can never be reached from outside it. Without
	// this, abort() during a streaming generation did nothing at all until
	// the next per-chunk isAborting poll (or never, if the server never
	// sent a first chunk).
	private cancelTokenSource?: ReturnType<typeof axios.CancelToken.source>

	constructor({
		connection,
		sampling,
		contextConfig,
		promptConfig,
		session,
		currentCharacterId,
		generatingMessageMetadata
	}: {
		connection: SelectConnection
		sampling: ResolvedSampling
		contextConfig: SelectContextConfig
		promptConfig: SelectPromptConfig
		session: BasePromptSession
		currentCharacterId: number | null
		generatingMessageMetadata?: any
	}) {
		super({
			connection,
			sampling,
			contextConfig,
			promptConfig,
			session: {
				...session,
				sessionCharacters: session.sessionCharacters || [],
				sessionPersonas: session.sessionPersonas || [],
				sessionMessages: session.sessionMessages || []
			},
			currentCharacterId,
			tokenCounter: new TokenCounters(
				connection.tokenCounter || TokenCounterOptions.ESTIMATE
			),
			tokenLimit:
				typeof sampling.contextTokens === "number"
					? sampling.contextTokens
					: 2048,
			contextThresholdPercent: 0.9,
			generatingMessageMetadata
		})
	}

	mapSamplingConfig(): Record<string, any> {
		const result: Record<string, any> = {}
		// `sampling` arrives already resolved (resolveSampling.ts), so a key
		// being present IS the switch being on — there is nothing left to test
		// and the key map is the whole filter: a key it doesn't name is one
		// llama.cpp has no field for.
		for (const [key, value] of Object.entries(this.sampling)) {
			if (llamaCppSamplingKeyMap[key]) {
				result[llamaCppSamplingKeyMap[key]] = value
			}
		}
		return result
	}

	async generateText(): Promise<TextGenResult> {
		const stream = this.connection.extraJson?.stream || false
		// Prepare stop strings
		const stopStrings = StopStrings.get({
			format: this.connection.promptFormat || "chatml",
			characters:
				this.session.sessionCharacters?.map((cc) => cc.character) || [],
			personas:
				this.session.sessionPersonas?.map((cp) => cp.persona) || [],
			currentCharacterId: this.currentCharacterId ?? undefined
		})
		const characterName = resolveCharacterName(
			this.session.sessionCharacters?.[0]?.character
		)
		const personaName =
			this.session.sessionPersonas?.[0]?.persona?.name || "user"
		const stopContext: Record<string, string> = {
			char: characterName,
			user: personaName
		}
		const stop = stopStrings.map((str) =>
			Handlebars.compile(str)(stopContext)
		)

		const compiledPrompt: CompiledPrompt = await this.compilePrompt({})
		let prompt: string
		if (
			"prompt" in compiledPrompt &&
			typeof compiledPrompt.prompt === "string"
		) {
			prompt = compiledPrompt.prompt
		} else if (
			"messages" in compiledPrompt &&
			Array.isArray(compiledPrompt.messages)
		) {
			prompt = compiledPrompt.messages.map((m) => m.content).join("\n")
		} else {
			throw new Error(
				"CompiledPrompt must have either 'prompt' or 'messages'."
			)
		}

		const req: CompletionRequest = {
			prompt,
			stream,
			stop,
			...this.mapSamplingConfig(),
			// `grammar` has been declared on CompletionRequest since this
			// adapter was written and was never populated. llama.cpp applies it
			// at the decoder, so non-JSON becomes unrepresentable rather than
			// merely discouraged. Omitted entirely for plain-text generation.
			// llama.cpp also accepts a `json_schema` field it converts itself;
			// this goes through our converter instead so both GBNF providers
			// share one tested path rather than two that can diverge.
			...(this.responseFormat === "json"
				? {
						grammar: this.responseSchema
							? jsonSchemaToGbnf(this.responseSchema)
							: JSON_OBJECT_GBNF
					}
				: {})
		}

		const baseUrl =
			normalizeBaseUrl(this.connection.baseUrl) || "http://localhost:8080"

		if (stream) {
			return {
				completionResult: async (
					contentCb: (chunk: string) => void,
					_thinkingCb?: (chunk: string) => void
				) => {
					let content = ""
					this.cancelTokenSource = axios.CancelToken.source()
					try {
						const response = await axios.post<CompletionResponse>(
							baseUrl + "/completion",
							req,
							{
								responseType: "stream",
								cancelToken: this.cancelTokenSource.token,
								// Idle/inactivity timeout, not wall-clock — Node
								// resets this on any socket activity, including
								// each streamed chunk (verified against
								// axios's http adapter source).
								timeout: LLM_IDLE_TIMEOUT_MS
							}
						)
						const stream = response.data as any
						let buffer = ""
						for await (const chunk of Readable.from(stream)) {
							if (this.isAborting) {
								this.cancelTokenSource.cancel(
									"Request aborted by user."
								)
								break
							}
							buffer += chunk.toString()
							let lines = buffer.split(/\r?\n/)
							buffer = lines.pop() || ""
							for (const line of lines) {
								const trimmed = line.trim()
								if (!trimmed || !trimmed.startsWith("data:"))
									continue
								const jsonStr = trimmed.slice(5).trim()
								if (!jsonStr) continue
								try {
									const data = JSON.parse(jsonStr)
									if (
										typeof data.content === "string" &&
										data.content.length > 0
									) {
										content += data.content
										contentCb(data.content)
									}
								} catch (err) {
									// ignore JSON parse errors
								}
							}
						}
					} catch (e: any) {
						// A cancel() call rejects the in-flight request too —
						// don't surface that as an error, the caller already
						// knows this was cancelled.
						const wasCancelled =
							this.isAborting || axios.isCancel?.(e)
						if (!wasCancelled) throw e
					} finally {
						// Clear the reference once this request is done so a
						// later, unrelated abort() call (e.g. from the next
						// generation on this same adapter instance) can't
						// cancel a stale token.
						this.cancelTokenSource = undefined
					}
				},
				compiledPrompt,
				isAborted: this.isAborting
			}
		} else {
			// Stored on `this` (not a local const) so abort() below — called
			// externally, from the queue's cancel handler, while this single
			// non-yielding axios.post() await is in flight — actually has
			// something to reach. A local AbortController here can never be
			// cancelled from outside this function.
			this.abortController = new AbortController()
			if (this.isAborting) {
				this.abortController.abort()
				return {
					completionResult: "",
					compiledPrompt,
					isAborted: true
				}
			}
			try {
				const response = await axios.post<CompletionResponse>(
					baseUrl + "/completion",
					req,
					{
						signal: this.abortController.signal,
						timeout: LLM_IDLE_TIMEOUT_MS
					}
				)
				const result = response.data
				const content = result?.content || result?.response || ""
				return {
					completionResult: content,
					compiledPrompt,
					isAborted: this.isAborting
				}
			} catch (e: any) {
				// Only a genuine cancellation should report isAborted: true —
				// this used to be unconditional in the fallback branch below,
				// so a real network error or 5xx during generation was
				// silently rebranded as "the user cancelled this", hiding the
				// actual failure from anyone looking at the result.
				const wasCancelled =
					this.isAborting ||
					axios.isCancel?.(e) ||
					e?.code === "ERR_CANCELED" ||
					e?.message?.includes("aborted")
				if (wasCancelled) {
					return {
						completionResult: "",
						compiledPrompt,
						isAborted: true
					}
				}
				throw e
			}
		}
	}

	abort() {
		this.isAborting = true
		this.abortController?.abort()
		this.cancelTokenSource?.cancel("Request aborted by user.")
	}
}

async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string }> {
	try {
		const baseUrl =
			normalizeBaseUrl(connection.baseUrl) || "http://localhost:8080"
		const res = await axios.get<HealthResponse>(baseUrl + "/health")

		if (
			res &&
			typeof res.data === "object" &&
			"status" in res.data &&
			res.data.status === "ok"
		) {
			return { ok: true }
		} else {
			return {
				ok: false,
				error: "Unexpected response from llama.cpp server"
			}
		}
	} catch (e: any) {
		return { ok: false, error: e.message || String(e) }
	}
}

async function listModels(
	connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	try {
		const baseUrl =
			normalizeBaseUrl(connection.baseUrl) || "http://localhost:8080"
		const res = await axios.get<{ model?: string }>(baseUrl + "/show")
		if (res && typeof res.data === "object" && res.data.model) {
			return {
				models: [{ model: res.data.model, name: res.data.model }],
				error: undefined
			}
		} else {
			return {
				models: [],
				error: "No model loaded or unexpected response from llama.cpp server"
			}
		}
	} catch (e: any) {
		return { models: [], error: e.message || String(e) }
	}
}

const exports: AdapterExports = {
	Adapter: LlamaCppAdapter,
	testConnection,
	listModels,
	connectionDefaults:
		CONNECTION_DEFAULTS[CONNECTION_TYPE.LLAMACPP_COMPLETION],
	samplingKeyMap: llamaCppSamplingKeyMap
}

export default exports
