import {
	BaseConnectionAdapter,
	type AdapterExports,
	type BasePromptSession
} from "./BaseConnectionAdapter"
import { type CompiledPrompt } from "./types"
import type { TextGenResult } from "$lib/server/adapters/actions"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { TokenCounters } from "../utils/TokenCounterManager"
import { OpenAI } from "openai"
import type {
	ChatCompletionCreateParamsBase,
	ChatCompletionMessageParam
} from "openai/resources/chat/completions/completions"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	isReasoningKey,
	openAISamplingKeyMap,
	reasoningOf
} from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"
import { ToolCallDeltaAccumulator } from "./streamingToolCalls"
import { modelServerFetchOptions } from "./modelServerFetch"

/**
 * What an OpenAI-shaped `usage` block says a call cost.
 *
 * ⚠ **Every field is checked rather than read.** Twenty-four services answer in
 * this envelope and `usage` is whatever each of them chose to put there; a
 * string where a count belongs must produce silence, not `NaN` on a receipt.
 *
 * `cached_tokens` is absent, never zero, on a service that does not report
 * reuse — see `TextGenResult.tokensCached` for why the two must not collapse.
 */
function cacheUsageFrom(usage: unknown): {
	tokensPrompt?: number
	tokensCached?: number
	tokensCompletion?: number
	tokensReasoning?: number
} {
	const u: any = usage
	if (!u || typeof u !== "object") return {}
	const num = (v: unknown) =>
		typeof v === "number" && Number.isFinite(v) ? v : undefined
	const prompt = num(u.prompt_tokens)
	const cached = num(u.prompt_tokens_details?.cached_tokens)
	const completion = num(u.completion_tokens)
	// How much of what the model WROTE it spent thinking. Part of
	// `completion_tokens` rather than beside it, so this is a breakdown of a
	// number already reported and never an addition to it — which is why a
	// reader needs it: a 512-token cap that produced a 40-word reply is a
	// reasoning budget, not a short model.
	const reasoning = num(u.completion_tokens_details?.reasoning_tokens)
	return {
		...(prompt !== undefined ? { tokensPrompt: prompt } : {}),
		...(cached !== undefined ? { tokensCached: cached } : {}),
		...(completion !== undefined ? { tokensCompletion: completion } : {}),
		...(reasoning !== undefined ? { tokensReasoning: reasoning } : {})
	}
}

/**
 * The native reasoning text on an OpenAI-compatible `delta` or `message`.
 *
 * ⚠ This adapter is "OpenAI" in wire shape only. It is what people point at
 * DeepSeek's API, OpenRouter, vLLM, SGLang, TabbyAPI and Together — which is
 * where most of the reasoning models actually in use live — so the field names
 * that matter here are theirs, not OpenAI's.
 *
 * Two names, each naming a real backend rather than covering a guess:
 *
 *   `reasoning_content` — DeepSeek's own API field, and the de-facto
 *     OpenAI-compatible spelling that followed it: SGLang, TabbyAPI, llama.cpp's
 *     `/v1/chat/completions` under `--reasoning-format deepseek`, KoboldCPP
 *     (see `KoboldCppAdapter`, which reads exactly this), and vLLM before
 *     vllm-project/vllm#27752.
 *   `reasoning` — vLLM since that PR, which moved to `reasoning` to follow
 *     OpenAI's gpt-oss guidance while keeping the old key for compatibility,
 *     and OpenRouter, whose documented field this is.
 *
 * FIRST MATCH WINS, and that is the point of reading rather than summing:
 * OpenRouter documents `reasoning_content` as an alias that "functions
 * identically to `reasoning`", so a response carrying both is carrying one
 * thought twice. Concatenating would print the model's scratchpad doubled.
 *
 * Deliberately NOT read:
 *   - OpenAI's own o-series reasoning summaries. Those are a Responses API
 *     (`/v1/responses`) item type; on `/v1/chat/completions` — the only route
 *     this adapter speaks — OpenAI returns no reasoning text at all, only a
 *     `usage.completion_tokens_details.reasoning_tokens` count. There is no key
 *     here to read, so none is invented.
 *   - OpenRouter's `reasoning_details[]`. It is a structured array of typed
 *     objects (`reasoning.text`, `reasoning.summary`, `reasoning.encrypted`),
 *     one of which carries no readable text at all, and it is one gateway's
 *     shape rather than a compatible-API convention. Worth adding deliberately
 *     if OpenRouter streaming turns out not to also carry plain `reasoning`;
 *     not worth guessing at here.
 */
function reasoningTextFrom(source: any): string | undefined {
	if (!source) return undefined
	if (
		typeof source.reasoning_content === "string" &&
		source.reasoning_content
	)
		return source.reasoning_content
	if (typeof source.reasoning === "string" && source.reasoning)
		return source.reasoning
	return undefined
}

export class OpenAIChatAdapter extends BaseConnectionAdapter {
	/**
	 * 🚧 Yes, on the chat wire (PLAN-composer-attachments §3.6): images ride each turn as
	 * `image_url` content parts (data URLs).
	 * A fact about the CODE, not a capability claim — see the base class.
	 * Constant, because the conformance pin reads it off the prototype; a
	 * completion-wire request with files is refused in `dispatch.ts` from the
	 * manifest's `sendsAttachments.completion`.
	 */
	override get consumesAttachments(): boolean {
		return true
	}

	private abortController?: AbortController

	/**
	 * `/v1/chat/completions` takes a `tools` array and answers with
	 * `tool_calls`, so this class genuinely sends them — which is the only
	 * question this property answers. See `consumesTools` on the base class for
	 * why that is not the same as the connection being allowed to use tools.
	 */
	get consumesTools(): boolean {
		return true
	}

	constructor({
		connection,
		sampling,
		systemPrompt,
		session,
		currentCharacterId,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent,
		generatingMessageMetadata
	}: {
		connection: SelectConnection
		sampling: ResolvedSampling
		systemPrompt?: string
		session: BasePromptSession
		currentCharacterId?: number | null
		tokenCounter?: TokenCounters
		tokenLimit?: number
		contextThresholdPercent?: number
		generatingMessageMetadata?: any
	}) {
		super({
			connection,
			sampling,
			systemPrompt,
			session,
			currentCharacterId: currentCharacterId ?? null,
			tokenCounter:
				tokenCounter ||
				new TokenCounters(
					connection.tokenCounter || TokenCounterOptions.ESTIMATE
				),
			tokenLimit:
				tokenLimit ||
				(typeof sampling.contextTokens === "number"
					? sampling.contextTokens
					: 4096),
			contextThresholdPercent: contextThresholdPercent || 0.9,
			generatingMessageMetadata
		})
	}

	async generateText(): Promise<TextGenResult> {
		const apiKey = decryptApiKeyField(this.connection.extraJson?.apiKey)
		const baseURL =
			normalizeBaseUrl(this.connection.baseUrl) ||
			normalizeBaseUrl(
				CONNECTION_DEFAULTS[CONNECTION_TYPE.OPENAI].baseUrl
			)
		const model = this.connection.model || "gpt-3.5-turbo"
		const stream = this.streamingOn(
			this.connection.extraJson?.stream || false
		)
		const compiledPrompt: CompiledPrompt = await this.compilePrompt({})

		/**
		 * The turns that go on the wire, decided by the connection's WIRE MODE.
		 *
		 * ⚠ Both branches POST `/v1/chat/completions`; this adapter speaks no
		 * other route. What the mode selects is what the MODEL receives —
		 * role-tagged turns, or one prompt rendered flat through the connection's
		 * completion template and carried in a single user turn because the
		 * envelope has nowhere else to put it. That second arm is what
		 * `extraJson.prerenderPrompt` used to name.
		 *
		 * It replaced a test on the PAYLOAD (`if (compiledPrompt.prompt) … else
		 * if (compiledPrompt.messages)`), which followed whatever shape arrived —
		 * and on the pipeline path what arrived was one flat string on every run,
		 * whatever the connection wanted. So a chat connection quietly sent its
		 * whole assembled prompt as a single user message: not the outright loss
		 * Anthropic and KoboldCPP suffered, but the roles were gone and nothing
		 * said so.
		 *
		 * Each branch refuses the shape it cannot send rather than reaching for
		 * the other. Recovering here would put an adapter-local wire mode back,
		 * and the disagreement it papers over is the thing worth reporting.
		 */
		let messages: Array<ChatCompletionMessageParam> = []
		if (this.isChatWire) {
			if (!Array.isArray(compiledPrompt.messages))
				throw new Error(
					"this OpenAI connection is chat wire mode, but the prompt it was " +
						"handed carries no messages. The render and the send are reading " +
						"different wire modes — check that the assemble node's connection " +
						"slot is wired to the sending Provider (slot.connectionOf)."
				)
			messages = compiledPrompt.messages
		} else {
			// `promptTextFor` rather than `compiledPrompt.prompt!`: a payload
			// that arrived as messages is rebuilt into the connection's own
			// completion template, which is the same construction the summarizer
			// has always used. Faithful rather than guessed, and it raises a
			// named error for a payload carrying neither shape.
			messages = [
				{ role: "user", content: this.promptTextFor(compiledPrompt) }
			]
		}

		const params: ChatCompletionCreateParamsBase = {
			model,
			messages,
			...this.mapSamplingConfig(),
			...this.reasoningParams(),
			// Several OpenAI-compatible backends reject json_object mode unless
			// the word "JSON" appears somewhere in the prompt. Every caller that
			// sets responseFormat here sends a prompt whose first line states
			// the JSON contract, so this holds — but it is a real constraint on
			// those prompts, not an incidental detail.
			// With a schema this upgrades to json_schema mode. `strict: true` is
			// safe here because jsonSchemaToGbnf's contract already requires
			// what strict mode requires — additionalProperties:false and every
			// property listed in `required` — so a schema that reaches this
			// line has necessarily satisfied both.
			//
			// Backends vary: the OpenAI-compatible zoo supports json_object far
			// more widely than json_schema, so this is the one adapter where a
			// schema may be rejected by a server that accepts plain JSON mode.
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
					: { response_format: { type: "json_object" as const } }
				: {})
		}

		/**
		 * The tools, in the field this format calls them (20 §9).
		 *
		 * ⚠ Only when there are any. An empty `tools: []` is not the same
		 * request as no `tools` key: several OpenAI-compatible servers reject
		 * the empty array outright, and others switch on tool-calling mode for
		 * it — so every pipeline that is not a tool loop would start paying for
		 * a feature it never asked for.
		 *
		 * `tool_choice: "auto"` is stated rather than left to the default,
		 * because the default is not the same across the twenty-four services
		 * behind this format. Auto is what a tool loop means: the model decides
		 * whether this turn is work or an answer, and the answer is how the
		 * loop ends.
		 */
		if (this.tools.length) {
			params.tools = this.tools.map((t) => ({
				type: "function" as const,
				function: {
					name: t.name,
					description: t.description,
					parameters: t.parameters
				}
			}))
			params.tool_choice = "auto"
		}

		// The composed list, already filtered by the wire rule — the ternary
		// that stood here is `connections/stops.ts`'s job now (ruling
		// 2026-09-10). Its reasoning is unchanged and lives there: in chat wire
		// mode the roles carry the structure, so role-label stops have nothing
		// to bite on and override the model's native stop tokens (`<|im_end|>`
		// on a ChatML model) in servers such as Ollama's OpenAI compatibility
		// layer. What the ternary could not express is the difference this
		// replaces it for: the author's OWN stop sequences are their choice
		// rather than the template's, so they ride either wire — and the old
		// shape sent an empty array on chat, which discarded them.
		params["stop"] = this.stops

		// 🚧 The files, each on its own turn (PLAN-composer-attachments §3.6),
		// measured against the request as it stands without them. Chat wire
		// only: `dispatch.ts` refuses files on a completion-wire connection.
		if (this.carriesAttachments && this.isChatWire)
			params.messages = await this.openAIChatMessagesWithFiles(
				messages,
				params
			)

		const openaiClient = new OpenAI({
			apiKey,
			baseURL: baseURL || undefined,
			defaultHeaders: {
				"User-Agent": "Mozilla/5.0 (compatible; SerenePub/1.0)"
			},
			// undici's five-minute timeouts sit under this client's own;
			// see `modelServerFetch`.
			fetchOptions: modelServerFetchOptions()
		})

		this.abortController = new AbortController()

		// The record the inspector reads instead of a proxy: this format's own
		// rendering of the request, filled in below as the response is read.
		// Headers stay out of it — the key travels in one.
		const wire = this.beginExchange({
			url: `${baseURL || "https://api.openai.com/v1"}/chat/completions`,
			body: { ...params, stream }
		})

		try {
			if (stream) {
				return {
					completionResult: async (
						contentCb: (chunk: string) => void,
						reasoningCb?: (chunk: string) => void
					) => {
						const streamResp =
							await openaiClient.chat.completions.create(
								{ ...params, stream: true },
								{ signal: this.abortController?.signal }
							)
						/**
						 * The call, assembled from its fragments (20 §9).
						 *
						 * Declared for every streaming request rather than only
						 * a tool-carrying one, so the field below is `null`
						 * ("nothing was called") rather than `undefined` ("this
						 * adapter did not look") on both — the distinction the
						 * loop's predicate reads.
						 */
						const calls = new ToolCallDeltaAccumulator()
						for await (const part of streamResp as any) {
							wire.frame(part)
							if (this.isAborting) break
							// The last chunk of a stream carries no delta and,
							// where the server was asked for it, the usage
							// block — so this is read before the `continue`
							// below rather than inside the delta branch.
							this.recordStreamedUsage(cacheUsageFrom(part.usage))
							const delta = part.choices?.[0]?.delta
							if (!delta) continue
							// Native reasoning, off the same delta as the text.
							// See `reasoningTextFrom` for which backend each
							// name serves and why only one is read.
							const reasoning = reasoningTextFrom(delta)
							if (reasoning) reasoningCb?.(reasoning)
							if (delta.content) {
								contentCb(delta.content)
							}
							calls.push(delta.tool_calls)
						}
						// A call that arrived is a call the model made,
						// whatever the server called the ending:
						// `finish_reason` is not consulted, because several
						// servers behind this format close a tool-calling
						// stream on `"stop"`.
						this.streamedToolCall = calls.first()
					},
					compiledPrompt,
					isAborted: this.isAborting
				}
			} else {
				const response = await openaiClient.chat.completions.create(
					{ ...params, stream: false },
					{ signal: this.abortController?.signal }
				)
				wire.received(response)
				let content = ""
				let reasoningContent: string | undefined
				let toolCall: ReturnType<OpenAIChatAdapter["toolCallFrom"]> =
					null
				if (
					response.choices &&
					response.choices[0] &&
					response.choices[0].message
				) {
					const message = response.choices[0].message
					content = message.content || ""
					// The same two names the streaming branch reads, on the
					// assembled message rather than a delta.
					reasoningContent = reasoningTextFrom(message) || undefined
					// The first call only — see `TextGenResult.toolCall`.
					const first = (message as any).tool_calls?.[0]
					if (first)
						toolCall = this.toolCallFrom(
							first.function?.name,
							// A JSON **string** on this format, which is why the
							// normalizer parses rather than assigns.
							first.function?.arguments
						)
				}
				return {
					completionResult: content,
					compiledPrompt,
					isAborted: this.isAborting,
					reasoningContent,
					toolCall,
					// Recorded, never acted on: see `TextGenResult.tokensCached`.
					...cacheUsageFrom((response as any).usage)
				}
			}
		} catch (err: any) {
			console.error(
				"[OpenAIAdapter] Error from openai.chat.completions.create:",
				err
			)
			// Enhanced error reporting for upstream/proxy errors
			let errorMsg = "OpenAI API error."
			if (err?.status || err?.code) {
				errorMsg += ` Status: ${err.status || err.code}.`
			}
			if (err?.error?.message) {
				errorMsg += ` Message: ${err.error.message}`
			}
			// `provider_name` is the upstream proxy's own field name, and the
			// label echoes it verbatim so an administrator can match this line
			// against that proxy's dashboard. Foreign vocabulary reconciled at
			// the seam rather than merged (NOMENCLATURE R5); our own word for a
			// vendor is "service".
			if (err?.error?.provider_name) {
				errorMsg += ` Provider: ${err.error.provider_name}`
			}
			throw new Error(errorMsg)
		}
	}

	mapSamplingConfig(): Record<string, any> {
		const result: Record<string, any> = {}
		// `sampling` arrives already resolved (resolveSampling.ts): a key being
		// present IS the switch being on, so the key map is the only filter left.
		for (const [key, value] of Object.entries(this.sampling)) {
			if (openAISamplingKeyMap[key]) {
				// Translated below rather than copied — `reasoning_effort`
				// takes this format's own word for "none", and a budget has no
				// field here at all.
				if (isReasoningKey(key)) continue
				result[openAISamplingKeyMap[key]] = value
			}
		}
		return result
	}

	/**
	 * `reasoning_effort`, or nothing at all.
	 *
	 * ⚠ **Nothing at all is the default**, and it has to be: the config's
	 * `reasoning` field being absent means the switch is off, and a request
	 * with no `reasoning_effort` key is the request this adapter has always
	 * sent. Only a config that turned the sampler on changes a byte.
	 *
	 * `"none"` is this format's own word for off, and it is SENT rather than
	 * withheld. Twenty-four services answer in this envelope and they disagree
	 * about it — OpenAI's newer models take it, several proxies reject an
	 * effort they do not know, and there is no per-connection flag saying
	 * which. Sending it is the honest reading of a person who switched the
	 * sampler on and chose Off, and the Wire tab shows exactly what went out
	 * when a server refuses it. A connection-level opt-out belongs here the day
	 * one exists; guessing per host does not.
	 *
	 * `reasoningBudget` has no field in this format, so a config carrying one
	 * is recorded as ignored rather than silently dropped.
	 */
	private reasoningParams(): Record<string, string> {
		const { level, budget } = reasoningOf(this.sampling)
		if (!level) return {}
		if (budget !== undefined) this.noteIgnoredSampler("reasoningBudget")
		return { reasoning_effort: level === "off" ? "none" : level }
	}

	abort() {
		this.isAborting = true
		this.abortController?.abort()
	}
}

/**
 * What one listed model is FOR, in the app's modality words, from the
 * `architecture.output_modalities` OpenRouter puts on every entry (and any
 * OpenAI-compatible host that copies its shape).
 *
 * Only a one-sided answer is an answer, as for Ollama's `capabilities`
 * (`ollamaModelModality`): `embeddings` without `text` is an embedding model,
 * `text` without `embeddings` a text model — an image or audio model that also
 * writes text included, since it can chat. Both, neither, or no list at all is
 * undefined, which the sync stores as NULL and `capabilityRefusal` leaves
 * ungated. Most services' `/models` say nothing here, and nothing guesses from
 * a model's id.
 */
export function openAIModelModality(entry: unknown): string | undefined {
	const out = (
		entry as { architecture?: { output_modalities?: unknown } } | null
	)?.architecture?.output_modalities
	if (!Array.isArray(out)) return undefined
	const embeds = out.includes("embeddings")
	const writes = out.includes("text")
	if (embeds === writes) return undefined
	return embeds ? "embeddings" : "text-gen"
}

/**
 * Whether this connection lists from OpenRouter: its preset says so, or its
 * address is OpenRouter's whatever the preset.
 */
function isOpenRouter(connection: SelectConnection, baseURL: string): boolean {
	if (connection.preset === "openrouter") return true
	try {
		return new URL(baseURL).hostname.toLowerCase() === "openrouter.ai"
	} catch {
		return false
	}
}

/**
 * OpenRouter's `/models` lists only text models unless asked
 * (`output_modalities` defaults to `text`), so its embedding models would
 * never be listed — and the sync would mark a starred one missing. Asked for
 * both, the two the `openai` type serves; nothing else, because every listed
 * model is a row in the pickers.
 */
const OPENROUTER_LISTING = { output_modalities: "text,embeddings" }

async function listModels(
	connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	try {
		const apiKey = decryptApiKeyField(connection.extraJson?.apiKey)
		const baseURL =
			normalizeBaseUrl(connection.baseUrl) ||
			normalizeBaseUrl(
				CONNECTION_DEFAULTS[CONNECTION_TYPE.OPENAI].baseUrl
			)
		const openai = new OpenAI({
			apiKey,
			baseURL: baseURL || undefined,
			defaultHeaders: {
				"User-Agent": "Mozilla/5.0 (compatible; SerenePub/1.0)"
			}
		})
		const res = await openai.models.list(
			isOpenRouter(connection, baseURL)
				? { query: OPENROUTER_LISTING }
				: undefined
		)
		if (res && Array.isArray(res.data)) {
			// The entries ride along whole, so `readModelFacts` reads the
			// context window, price and input modalities they carry; what each
			// model is FOR is added where the host said (`openAIModelModality`).
			return {
				models: res.data.map((m) => {
					const modality = openAIModelModality(m)
					return modality ? { ...m, modality } : m
				})
			}
		} else {
			return {
				models: [],
				error: "Unexpected response format from OpenAI API"
			}
		}
	} catch (e: any) {
		console.error("OpenAI listModels error:", e)
		return { models: [], error: e.message || String(e) }
	}
}

async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string }> {
	try {
		const apiKey = decryptApiKeyField(connection.extraJson?.apiKey)
		const baseURL =
			normalizeBaseUrl(connection.baseUrl) ||
			normalizeBaseUrl(
				CONNECTION_DEFAULTS[CONNECTION_TYPE.OPENAI].baseUrl
			)
		const openai = new OpenAI({
			apiKey,
			baseURL: baseURL || undefined,
			defaultHeaders: {
				"User-Agent": "Mozilla/5.0 (compatible; SerenePub/1.0)"
			}
		})
		// Try to list models as a test
		try {
			const res = await openai.models.list()
			if (res && Array.isArray(res.data)) {
				return { ok: true }
			} else {
				return {
					ok: false,
					error: "Unexpected response format from OpenAI API"
				}
			}
		} catch (e: any) {
			console.error("OpenAI testConnection error:", e)
			return { ok: false, error: e.message || String(e) }
		}
	} catch (e: any) {
		console.error("OpenAI testConnection error:", e)
		return { ok: false, error: e.message || String(e) }
	}
}

const exports: AdapterExports = {
	Adapter: OpenAIChatAdapter,
	listModels,
	testConnection,
	connectionDefaults: CONNECTION_DEFAULTS[CONNECTION_TYPE.OPENAI],
	samplingKeyMap: openAISamplingKeyMap
}

export default exports
