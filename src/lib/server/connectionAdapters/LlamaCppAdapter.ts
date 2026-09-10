import _ from "lodash"
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
		/**
		 * Which of llama-server's two endpoints this request goes to.
		 *
		 * The same `useSession = this.isChatWire` idiom as `OllamaAdapter` and
		 * `KoboldCppAdapter`, and it arrived here for the same reason they have
		 * it: wire mode is a CONNECTION CAPABILITY, resolved once from the row's
		 * four layers and read by the render as well as by this send, so the
		 * shape the prompt was built in and the shape it is sent in are one
		 * value rather than two that have to agree.
		 *
		 * Until this branch existed the type id itself said `completion` and
		 * this adapter had no chat leg at all — the way to reach llama-server's
		 * chat API was an `openai` connection pointed at the same process.
		 * `llamacpp` is the SERVICE now (ruling 2026-09-08: one connection type
		 * per service, wire mode as a property), and the manifest declares
		 * `wire_chat` as supported-but-not-defaulted so an upgrading install
		 * keeps the completion leg it was already on.
		 */
		const useSession = this.isChatWire
		// The stop sequences this request will send — composed by
		// `connections/stops.ts` and handed over at construction, never built
		// here (ruling 2026-09-10). The chat branch below used to be given
		// nothing on purpose; it now sends whatever survived the composer's wire
		// rule, which on that wire is the author's own list and nothing else.
		const stop = this.stops

		const compiledPrompt: CompiledPrompt = await this.compilePrompt({})

		const baseUrl =
			normalizeBaseUrl(this.connection.baseUrl) || "http://localhost:8080"
		const endpoint = useSession
			? `${baseUrl}/v1/chat/completions`
			: `${baseUrl}/completion`

		let req: Record<string, any>

		if (useSession) {
			// Checked rather than asserted, the same way `OllamaAdapter` and
			// `KoboldCppAdapter` check it. `compiledPrompt.messages!` on a
			// completion-shaped payload sends `undefined`, `JSON.stringify`
			// drops the key outright, and llama-server is asked to continue a
			// conversation it was never shown. A refusal naming the
			// disagreement is worth more than a request that loses the prompt.
			//
			// Deliberately NOT a fallback to `promptTextFor`: rebuilding a flat
			// prompt here would put an adapter-local wire mode back, which is
			// the defect rather than the recovery.
			if (!Array.isArray(compiledPrompt.messages))
				throw new Error(
					"this llama.cpp connection is chat wire mode, but the prompt it was " +
						"handed carries no messages. The render and the send are reading " +
						"different wire modes — check that the assemble node's connection " +
						"slot is wired to the sending Provider (slot.connectionOf)."
				)
			req = {
				// llama-server ignores the field — it serves whatever model it
				// was started with — but a proxy in front of it may not, and
				// this row often has no model at all (`connectionDefaults` names
				// none), so it is sent only when there is one to send.
				...(this.connection.model
					? { model: this.connection.model }
					: {}),
				messages: compiledPrompt.messages,
				stream,
				// The composer has already removed what must not be here: in
				// chat wire mode the roles carry the structure, so the
				// completion template's role labels have nothing to stop on —
				// and sending them OVERRIDES the model's native stop tokens
				// (`<|im_end|>` on a ChatML model), truncating replies for no
				// gain. What survives is the author's own list, which is their
				// choice rather than the template's and belongs on either wire;
				// the old blanket omission here discarded it.
				//
				// Placed BEFORE the sampling spread deliberately, matching the
				// completion branch: no `samplingKeyMap` in this repo produces a
				// `stop` key today, and if one ever did the user's sampler
				// should win over a list composed for them.
				...(stop.length ? { stop } : {}),
				...this.mapSamplingConfig(),
				// The OpenAI-compatible mechanism rather than `grammar`, because
				// this is the OpenAI-compatible route: llama-server implements
				// `response_format` with both `json_object` and `json_schema`
				// there and converts the schema to GBNF itself. The `/completion`
				// branch below still goes through our own converter — that
				// endpoint has no `response_format` to speak.
				...(this.responseFormat === "json"
					? this.responseSchema
						? {
								response_format: {
									type: "json_schema" as const,
									json_schema: {
										name: "response",
										strict: true,
										schema: this.responseSchema
									}
								}
							}
						: {
								response_format: {
									type: "json_object" as const
								}
							}
					: {})
			}
		} else {
			// Both shapes, through the one accessor the other adapters use.
			//
			// The three-branch version this replaced flattened a message array by
			// joining `m.content` with newlines, which dropped every role marker —
			// the model was handed the system prompt, the lore and the dialogue as
			// one unlabelled blob. `promptTextFor` rebuilds the blocks in the
			// connection's own format instead, and raises the same "neither shape"
			// error the third branch did.
			const prompt: string = this.promptTextFor(compiledPrompt)

			req = {
				prompt,
				stream,
				stop,
				...this.mapSamplingConfig(),
				// `grammar` has been declared on CompletionRequest since this
				// adapter was written and was never populated. llama.cpp applies it
				// at the decoder, so non-JSON becomes unrepresentable rather than
				// merely discouraged. Omitted entirely for plain-text generation.
				// llama.cpp also accepts a `json_schema` field it converts itself;
				// this goes through our converter instead so both GBNF services
				// share one tested path rather than two that can diverge.
				...(this.responseFormat === "json"
					? {
							grammar: this.responseSchema
								? jsonSchemaToGbnf(this.responseSchema)
								: JSON_OBJECT_GBNF
						}
					: {})
			} satisfies CompletionRequest
		}

		if (stream) {
			return {
				/**
				 * ⚠ `thinkingCb` fires on ONE of this adapter's two routes, and
				 * which one is the whole of the fact — read both halves before
				 * concluding anything about whether this connection can reason.
				 *
				 * **`/completion` has no reasoning FIELD.** llama.cpp's native
				 * endpoint carries no structured reasoning channel. Checked
				 * twice against the current tree rather than from memory: the
				 * server README's `/completion` response-field list does not
				 * include `reasoning_content`, and `to_json_non_oaicompat()` —
				 * both the final and the partial result serializers,
				 * `tools/server/server-task.cpp` — never sets that key on
				 * either. `--reasoning-format` and `chat_template_kwargs` are
				 * `/v1/chat/completions` features; `/completion` runs no chat
				 * template at all.
				 *
				 * The reasoning still COMES BACK on that route.
				 * `to_json_non_oaicompat()` serializes the raw accumulated text
				 * — `common_chat_parse()` and the `oaicompat_msg` it fills are
				 * read only by the OAI-compat serializers — so a reasoning
				 * model's `<think>` tags arrive inline in `content`, exactly as
				 * the model wrote them, unstripped. That is the INLINE-TAG path:
				 * the shared parser's job, not an adapter field's.
				 *
				 * **`/v1/chat/completions` DOES have the field**, because it is
				 * the OAI-compat serializer this adapter could not previously
				 * reach — `reasoning_content` on the delta, and on the message
				 * for a non-streaming reply. That is why the callback is named
				 * rather than `_`-prefixed now: the chat branch feeds it, and no
				 * field is invented on the native route to match. Which channel
				 * a given generation uses follows the connection's wire mode,
				 * one value resolved once (`useSession` above).
				 */
				completionResult: async (
					contentCb: (chunk: string) => void,
					thinkingCb?: (chunk: string) => void
				) => {
					let content = ""
					this.cancelTokenSource = axios.CancelToken.source()
					try {
						const response = await axios.post<CompletionResponse>(
							endpoint,
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
								// The OpenAI-compatible route terminates the
								// stream with a literal sentinel rather than
								// with JSON; parsing it would throw once per
								// generation into the swallowing catch below.
								if (!jsonStr || jsonStr === "[DONE]") continue
								try {
									const data = JSON.parse(jsonStr)
									// Two envelopes, one loop. `/completion`
									// puts the text at the top level;
									// `/v1/chat/completions` puts it under
									// `choices[0].delta`, and puts the model's
									// reasoning in a SIBLING FIELD there —
									// which the native route has no equivalent
									// of at all (see the note on this
									// callback's `_thinkingCb` history below).
									const delta = useSession
										? data.choices?.[0]?.delta
										: data
									const thinking = delta?.reasoning_content
									if (
										typeof thinking === "string" &&
										thinking.length > 0
									)
										thinkingCb?.(thinking)
									if (
										typeof delta?.content === "string" &&
										delta.content.length > 0
									) {
										content += delta.content
										contentCb(delta.content)
									}
									// The final `/completion` frame names the
									// sequence it stopped on. Read here rather
									// than returned, because a stream is
									// drained AFTER `generateText()` has
									// already handed its result back — see
									// `BaseConnectionAdapter.stopHit`.
									if (
										!useSession &&
										typeof data?.stopping_word ===
											"string" &&
										data.stopping_word.length > 0
									)
										this.stopHit = data.stopping_word
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
					endpoint,
					req,
					{
						signal: this.abortController.signal,
						timeout: LLM_IDLE_TIMEOUT_MS
					}
				)
				const result = response.data
				// The chat route answers in OpenAI's envelope and carries the
				// reasoning in its own field; the native route answers flat and
				// carries it inline in `content`, which is the whole of the
				// long note on the streaming callback above.
				const message = useSession
					? (result as any)?.choices?.[0]?.message
					: undefined
				const content = useSession
					? message?.content || ""
					: result?.content || result?.response || ""
				const thinkingContent = useSession
					? typeof message?.reasoning_content === "string" &&
						message.reasoning_content.length > 0
						? message.reasoning_content
						: undefined
					: undefined
				// Which stop sequence actually ended it — llama.cpp's native
				// route is the ONE service in this app that reports the word
				// rather than a reason code, so this is the only place `hit`
				// can be filled honestly (ruling 2026-09-10). The OAI-compat
				// route answers `finish_reason: "stop"` and names nothing, so
				// it stays undefined there.
				this.stopHit = !useSession ? result?.stopping_word : undefined
				return {
					completionResult: content,
					compiledPrompt,
					isAborted: this.isAborting,
					...(thinkingContent ? { thinkingContent } : {})
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
		CONNECTION_DEFAULTS[CONNECTION_TYPE.LLAMACPP],
	samplingKeyMap: llamaCppSamplingKeyMap
}

export default exports
