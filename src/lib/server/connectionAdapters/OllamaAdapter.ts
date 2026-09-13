import _ from "lodash"
import { Ollama, type ChatRequest, type GenerateRequest } from "ollama"
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
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	isReasoningKey,
	ollamaSamplingKeyMap,
	reasoningOf
} from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import {
	createIdleWatchdog,
	LLM_IDLE_TIMEOUT_MS,
	LLM_NONSTREAMING_TIMEOUT_MS
} from "./idleTimeout"
import { ToolCallDeltaAccumulator } from "./streamingToolCalls"

/**
 * What this service says a call cost: two counts and nothing else.
 *
 * ⚠ **No cached count, deliberately.** Ollama re-evaluates only what its own KV
 * cache missed and never reports how much that was: `prompt_eval_count` is the
 * whole prompt either way. So the totals are recorded and reuse stays ABSENT,
 * which is a different answer from zero and the only true one available here
 * (see `TextGenResult.tokensCached`).
 */
function usageFrom(response: unknown): {
	tokensPrompt?: number
	tokensCompletion?: number
} {
	const num = (value: unknown) =>
		typeof value === "number" && Number.isFinite(value) ? value : undefined
	const prompt = num((response as any)?.prompt_eval_count)
	// Ollama's name for what the model wrote. Both counts ride the final frame
	// of a stream and the whole body of a non-streamed reply.
	const completion = num((response as any)?.eval_count)
	return {
		...(prompt !== undefined ? { tokensPrompt: prompt } : {}),
		...(completion !== undefined ? { tokensCompletion: completion } : {})
	}
}

/**
 * The models whose `think` field takes a LEVEL rather than a boolean.
 *
 * gpt-oss is the only family that does, and Ollama answers a level sent to
 * anything else with a 400. Kept as a name test rather than a capability read:
 * the alternative is an `/api/show` round trip before every generation, and the
 * cost of being wrong here is one request, not a wrong reply.
 */
const OLLAMA_LEVEL_MODELS = /gpt[-_]?oss/i

/** The service's own word for what ended the generation, where it gave one. */
function doneReasonFrom(response: unknown): string | undefined {
	const reason = (response as any)?.done_reason
	return typeof reason === "string" && reason ? reason : undefined
}

class OllamaAdapter extends BaseConnectionAdapter {
	/**
	 * `ollama.chat()` takes `tools` and answers with `tool_calls`, so this
	 * class sends them — **on the chat wire and only there**.
	 *
	 * `ollama.generate()` takes one flat prompt and has no tools field at all,
	 * so a completion-wire connection cannot carry them. Answering `true`
	 * regardless would let `dispatch.ts` clear its check and this adapter drop
	 * the declarations one branch later, in silence — which is the exact
	 * failure both guards exist to prevent, since a model that was never
	 * offered a tool answers like one that declined. Reading the wire mode here
	 * is what turns that into a refusal naming the adapter.
	 */
	get consumesTools(): boolean {
		return this.isChatWire
	}

	private _client?: Ollama
	private _tokenCounter?: TokenCounters

	constructor({
		connection,
		sampling,
		contextConfig,
		promptConfig,
		session,
		currentCharacterId,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent,
		generatingMessageMetadata
	}: {
		connection: SelectConnection
		sampling: ResolvedSampling
		contextConfig: SelectContextConfig
		promptConfig: SelectPromptConfig
		session: BasePromptSession
		currentCharacterId: number | null
		tokenCounter?: TokenCounters
		tokenLimit?: number
		contextThresholdPercent?: number
		generatingMessageMetadata?: any
	}) {
		super({
			connection,
			sampling,
			contextConfig,
			promptConfig,
			session,
			currentCharacterId,
			tokenCounter:
				tokenCounter ||
				new TokenCounters(
					connection.tokenCounter || TokenCounterOptions.ESTIMATE
				),
			tokenLimit:
				tokenLimit ||
				(typeof sampling.contextTokens === "number"
					? sampling.contextTokens
					: 2048),
			contextThresholdPercent: contextThresholdPercent || 0.9,
			generatingMessageMetadata
		})
	}

	mapSamplingConfig(): Record<string, any> {
		const result: Record<string, any> = {}
		// `sampling` arrives already resolved (resolveSampling.ts), so a key
		// being present IS the switch being on — there is nothing left to test
		// and the key map is the whole filter: a key it doesn't name is one
		// Ollama has no field for.
		for (const [key, value] of Object.entries(this.sampling)) {
			if (ollamaSamplingKeyMap[key]) {
				if (key === "streaming") continue
				// `think` is a TOP-LEVEL field on both Ollama routes, not a
				// sampler inside `options` — see `thinkFor` below, which is
				// also where the level is translated.
				if (isReasoningKey(key)) continue
				result[ollamaSamplingKeyMap[key]] = value
			}
		}
		return result
	}

	/**
	 * What this request's `think` field carries. `undefined` means "say
	 * nothing", which omits the field entirely.
	 *
	 * ⚠ **This read `extraJson.think` until the ruling of 2026-09-12.**
	 * Reasoning effort is a sampling parameter chosen per stage, not a property
	 * of the compute: with the flag on the connection, every stage sharing one
	 * Ollama row thought exactly as hard as every other, and the only way to
	 * split them was a second connection to the same server. A stale `think`
	 * key left in an existing row's `extraJson` is read by nothing now. That is
	 * harmless, since the column is jsonb and unread keys cost nothing, which
	 * is why no migration clears it. Anthropic and KoboldCPP lost the same
	 * connection-level answer on the same terms.
	 *
	 * Saying nothing rather than `think: false` is what "the config did not ask"
	 * has to mean: `false` is a real instruction to a thinking model, and
	 * sending it for every config that never enabled the sampler would switch
	 * reasoning off across the product from a slot nobody set.
	 *
	 * Only the gpt-oss family takes a LEVEL: on every other model `think` is a
	 * boolean, and sending it the word "high" is a request the server rejects.
	 * Matched by model name because that is the only thing this adapter knows
	 * about the weights — Ollama's `/api/show` would say more, at the cost of a
	 * round trip before every generation.
	 */
	private thinkFor(model: string): boolean | string | undefined {
		const { level, budget } = reasoningOf(this.sampling)
		if (!level) return undefined
		// Ollama has no budget field at all, on either route.
		if (budget !== undefined) this.noteIgnoredSampler("reasoningBudget")
		if (level === "off") return false
		if (OLLAMA_LEVEL_MODELS.test(model)) return level
		// The level was honoured as "on" and nothing else: the word could not
		// travel, so a reader is told rather than left to compare two requests.
		this.noteIgnoredSampler("reasoning")
		return true
	}

	getClient() {
		if (!this._client) {
			const host = normalizeBaseUrl(this.connection.baseUrl) || undefined
			this._client = new Ollama({ host })
		}
		return this._client
	}

	getTokenCounter() {
		if (!this._tokenCounter) {
			this._tokenCounter = new TokenCounters(
				this.connection.tokenCounter || TokenCounterOptions.ESTIMATE
			)
		}
		return this._tokenCounter
	}

	static mapRole(role: string): string {
		if (role === "system") return "system"
		if (role === "assistant" || role === "bot") return "assistant"
		return "user"
	}

	// `generateText` is Serene Pub's action; `ollama.generate()` below is the
	// Ollama SDK's completion endpoint, the counterpart to `ollama.chat()`. Two
	// unrelated senses of the word in one file — do not rename the SDK calls.
	async generateText(): Promise<TextGenResult> {
		const model =
			this.connection.model ??
			CONNECTION_DEFAULTS[CONNECTION_TYPE.OLLAMA].baseUrl
		const stream = this.streamingOn(
			this.connection!.extraJson?.stream || false
		)
		// Ollama's OWN default, and deliberately not a shorter one. This read
		// `|| "300ms"`, so a connection that had never opened the form unloaded
		// the weights a third of a second after each turn — measured against a
		// 14B model, that is a ~9 GB reload on every single message, paid before
		// the first token of the next reply. The per-connection override below is
		// untouched; only the fallback moves.
		const keep_alive = this.connection!.extraJson?.keepAlive || "5m"
		if (typeof model !== "string")
			throw new Error("OllamaAdapter: model must be a string")
		// After the check, because the level is decided by the model NAME and a
		// family test against a non-string would coerce rather than refuse.
		const think = this.thinkFor(model)

		// The stop sequences this request will send — composed by
		// `connections/stops.ts` and handed over at construction, never built
		// here. This file used to carry TWO copies of the composition (`||
		// "chatml"` at this line and `|| "vicuna"` at the generate-mode site
		// below), which is how the chat branch came to send the completion
		// template's role labels: they override a ChatML model's own
		// `<|im_end|>` and truncate the reply, for markers a chat request does
		// not contain. The wire rule is the composer's now, so both branches
		// read the one already-filtered list.
		const stop = this.stops

		// Use PromptBuilder for prompt construction

		const compiledPrompt: CompiledPrompt = await this.compilePrompt({})

		/**
		 * Which of Ollama's two calls to make: `ollama.chat()` or
		 * `ollama.generate()`.
		 *
		 * ## What this replaced, twice over
		 *
		 * The setting was `extraJson.useSession`, read in this file with TWO
		 * different defaults — `!!x` in the `compilePrompt` override above and
		 * `x ?? true` here — so a connection whose `extraJson` had no such key
		 * (the column defaults to `{}`) had a completion prompt built and a chat
		 * request sent, with `messages: undefined`. Ollama answers that with an
		 * empty string, which reads as a model fault.
		 *
		 * The interim fix was to read the PAYLOAD (`!!compiledPrompt.messages`),
		 * which cannot disagree with itself — but it also cannot disagree with a
		 * payload that was built wrong, which is exactly what the pipeline path
		 * was handing over: one flat string on every run, whatever the connection
		 * wanted. Following it made the wrong shape self-consistent.
		 *
		 * The connection answers now, resolved once from its capability layers
		 * and read by the render as well as by this send — so the payload and the
		 * request are the same decision rather than two that happen to agree.
		 */
		const useSession = this.isChatWire
		let req: GenerateRequest | ChatRequest

		if (useSession) {
			// Checked rather than asserted: `messages!` on a completion-shaped
			// payload sent `undefined`, and a refusal that names the
			// disagreement is worth more than a request that quietly loses the
			// prompt. Not a fallback to `promptTextFor` — rebuilding a flat
			// prompt here would restore the adapter-local wire mode this change
			// removes.
			if (!Array.isArray(compiledPrompt.messages))
				throw new Error(
					"this Ollama connection is chat wire mode, but the prompt it was " +
						"handed carries no messages. The render and the send are reading " +
						"different wire modes — check that the assemble node's connection " +
						"slot is wired to the sending Provider (slot.connectionOf)."
				)
			req = {
				model,
				messages: compiledPrompt.messages,
				stream,
				// Omitted rather than sent as `false` when no config asked:
				// see `thinkFor`, where the difference is a real instruction.
				...(think !== undefined ? { think } : {}),
				keep_alive,
				options: {
					...this.mapSamplingConfig(),
					stop
				},
				// Ollama's structured-output switch is a TOP-LEVEL field, not a
				// sampler inside `options` — putting it there silently does
				// nothing.
				// A responseSchema narrows this to an exact shape — Ollama's
				// `format` takes a JSON Schema object as well as the "json"
				// literal (structured outputs, Ollama >= 0.5).
				...(this.responseFormat === "json"
					? { format: this.responseSchema ?? "json" }
					: {}),
				/**
				 * The tools, in the field `/api/chat` calls them (20 §9).
				 *
				 * ⚠ **This branch only.** `/api/generate` takes a flat prompt
				 * and has no tools field at all, so a connection in completion
				 * wire mode cannot send them — `dispatch.ts` refuses such a
				 * request rather than sending it stripped, because a model that
				 * was never offered a tool answers exactly like one that
				 * declined.
				 *
				 * Omitted when empty rather than sent as `[]`: Ollama renders a
				 * tool preamble into the model's own template when the key is
				 * present, which every non-tool pipeline would then pay for.
				 */
				...(this.tools.length
					? {
							tools: this.tools.map((t) => ({
								type: "function" as const,
								function: {
									name: t.name,
									description: t.description,
									parameters: t.parameters
								}
							}))
						}
					: {})
			} as ChatRequest
		} else {
			req = {
				model,
				// See `promptTextFor`: `compiledPrompt.prompt!` asserted a
				// string that a chat-shaped payload does not carry.
				prompt: this.promptTextFor(compiledPrompt),
				// This branch sends a prompt WE rendered, in the connection's
				// own completion template. Without `raw`, Ollama wraps it a
				// second time in whatever template the model ships with:
				// measured against Qwen2.5-14B, +8 tokens, and the open
				// assistant seed block was closed and reopened — so the model
				// re-emitted the speaker name the seed had already written.
				//
				// `raw: true` also switches off Ollama's DEFAULT stop
				// handling, which the template's own stop strings replace:
				// `stop` below is on this request precisely because nothing on
				// the server side supplies them here.
				//
				// Only this branch. The chat branch hands over role-tagged
				// messages for the server to template, which is the whole point
				// of that wire — `raw` there would be a request to send nothing.
				raw: true,
				stream,
				// Omitted rather than sent as `false`, as above.
				...(think !== undefined ? { think } : {}),
				keep_alive,
				options: {
					...this.mapSamplingConfig(),
					stop
				},
				// Top-level, and schema-aware, same as the session branch above.
				...(this.responseFormat === "json"
					? { format: this.responseSchema ?? "json" }
					: {})
			} as GenerateRequest
		}

		// The record the inspector reads instead of a proxy: the request as this
		// adapter rendered it, filled in below as the response is read. The host
		// is the same one `getClient` resolves, so the URL names where this went.
		const wire = this.beginExchange({
			url: `${normalizeBaseUrl(this.connection.baseUrl) || CONNECTION_DEFAULTS[CONNECTION_TYPE.OLLAMA].baseUrl}${useSession ? "/api/chat" : "/api/generate"}`,
			body: req
		})

		if (stream) {
			return {
				completionResult: async (
					contentCb: (chunk: string) => void,
					thinkingCb?: (chunk: string) => void
				) => {
					let content = ""
					let idleTimedOut = false
					const ollama = this.getClient()
					/**
					 * The call, assembled from the message deltas (20 §9).
					 *
					 * This SDK does not fragment its arguments the way OpenAI's
					 * does — they arrive as an object, in one part — but they
					 * arrive on a delta all the same, and the shared accumulator
					 * takes either so the two adapters cannot come to disagree
					 * about the shape they publish.
					 */
					const calls = new ToolCallDeltaAccumulator()
					const idle = createIdleWatchdog(LLM_IDLE_TIMEOUT_MS, () => {
						idleTimedOut = true
						ollama.abort()
					})
					try {
						if (useSession) {
							// Use Ollama's session api
							const result = await ollama.chat({
								...(req as ChatRequest),
								stream: true
							})
							// If abort was requested before streaming started, abort and return immediately
							if (this.isAborting) {
								ollama.abort()
								return
							}
							for await (const part of result) {
								idle.poke()
								wire.frame(part)
								if (this.isAborting) {
									ollama.abort()
									return
								}
								this.recordStreamedUsage(usageFrom(part))
								this.finishReason =
									doneReasonFrom(part) ?? this.finishReason
								if (part.message) {
									// Forward thinking chunks before content starts
									if (part.message.thinking) {
										thinkingCb?.(part.message.thinking)
									}
									if (part.message.content) {
										content += part.message.content
										contentCb(part.message.content)
									}
									calls.push((part.message as any).tool_calls)
								}
							}
						} else {
							// Use Ollama's generate/completion api
							const result = await ollama.generate({
								...(req as GenerateRequest),
								stream: true
							})
							// If abort was requested before streaming started, abort and return immediately
							if (this.isAborting) {
								ollama.abort()
								return
							}
							for await (const part of result) {
								idle.poke()
								wire.frame(part)
								if (this.isAborting) {
									ollama.abort()
									return
								}
								this.recordStreamedUsage(usageFrom(part))
								this.finishReason =
									doneReasonFrom(part) ?? this.finishReason
								if (part.thinking) {
									thinkingCb?.(part.thinking)
								}
								if (part.response) {
									content += part.response
									contentCb(part.response)
								}
							}
						}
						// No need to apply stop strings here, Ollama will handle it

						// `ollama.generate()` has no tools field, so a
						// completion-wire stream leaves this null — the same
						// answer `consumesTools` gives that route up front.
						this.streamedToolCall = calls.first()
					} catch (e: any) {
						if (idleTimedOut) {
							throw new Error(
								`Ollama did not respond for ${LLM_IDLE_TIMEOUT_MS / 60_000} minutes — connection may be hung.`
							)
						}
						// A genuine cancellation isn't an error to surface —
						// everything else must propagate so it lands in the
						// message's error column (generateResponse.ts) instead
						// of being silently swallowed into a stream that just
						// stops with no signal at all.
						if (this.isAborting) return
						console.error(
							"[OllamaAdapter] stream error:",
							e.message || String(e)
						)
						throw e
					} finally {
						idle.clear()
					}
				},
				compiledPrompt,
				isAborted: this.isAborting
			}
		} else {
			const result = await (async () => {
				// No intermediate chunks to reset an idle timer against for a
				// non-streaming response — a genuine, documented exception to
				// the idle-based design used in the streaming branch above: a
				// flat bound, sized generously to cover a full slow
				// generation end-to-end.
				let idleTimedOut = false
				const ollama = this.getClient()
				const idleTimer = setTimeout(() => {
					idleTimedOut = true
					ollama.abort()
				}, LLM_NONSTREAMING_TIMEOUT_MS)
				try {
					if (useSession) {
						// Use Ollama's session api
						const res = await ollama.chat({
							...(req as ChatRequest),
							stream: false
						})
						wire.received(res)
						if (this.isAborting) {
							return { content: undefined, thinking: undefined }
						}
						if (
							res &&
							typeof res === "object" &&
							"message" in res
						) {
							return {
								content: res.message.content || "",
								thinking: res.message.thinking,
								usage: usageFrom(res),
								finishReason: doneReasonFrom(res),
								// The first call only — see
								// `TextGenResult.toolCall`. `arguments` is
								// already an object on this SDK, unlike
								// OpenAI's JSON string; the normalizer takes
								// either.
								toolCall: this.toolCallFrom(
									(res.message as any).tool_calls?.[0]
										?.function?.name,
									(res.message as any).tool_calls?.[0]
										?.function?.arguments
								)
							}
						} else {
							throw new Error("Unexpected Ollama result type")
						}
					} else {
						const res = await ollama.generate({
							...(req as GenerateRequest),
							stream: false
						})
						wire.received(res)
						if (this.isAborting) {
							return { content: undefined, thinking: undefined }
						}
						if (
							res &&
							typeof res === "object" &&
							"response" in res
						) {
							return {
								content: res.response || "",
								thinking: res.thinking,
								usage: usageFrom(res),
								finishReason: doneReasonFrom(res)
							}
						} else {
							throw new Error("Unexpected Ollama result type")
						}
					}
				} catch (e: any) {
					if (idleTimedOut) {
						throw new Error(
							`Ollama did not respond within ${LLM_NONSTREAMING_TIMEOUT_MS / 60_000} minutes.`
						)
					}
					if (this.isAborting) {
						return { content: undefined, thinking: undefined }
					}
					throw e
				} finally {
					clearTimeout(idleTimer)
				}
			})()
			this.finishReason =
				(result as { finishReason?: string }).finishReason ??
				this.finishReason
			return {
				completionResult: result.content ?? "",
				compiledPrompt,
				isAborted: this.isAborting,
				thinkingContent: result.thinking || undefined,
				toolCall: (result as { toolCall?: any }).toolCall ?? null,
				// Recorded, never acted on: see `TextGenResult.tokensCached`.
				...((
					result as {
						usage?: {
							tokensPrompt?: number
							tokensCompletion?: number
						}
					}
				).usage ?? {})
			}
		}
	}
	// --- Abort in-flight Ollama request ---
	abort() {
		this.isAborting = true
		const client = this.getClient()
		if (typeof client.abort === "function") {
			client.abort()
		}
	}
}

async function listModels(
	connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	try {
		const ollama = new Ollama({
			// Patch: ensure host is never null
			host: normalizeBaseUrl(connection.baseUrl) || undefined
		})
		const res = await ollama.list()
		if (res && Array.isArray(res.models)) {
			return { models: res.models }
		} else {
			return {
				models: [],
				error: "Unexpected response format from Ollama API"
			}
		}
	} catch (e: any) {
		console.error("Ollama listModels error:", e)
		return { models: [], error: e.message || String(e) }
	}
}

async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string }> {
	try {
		const ollama = new Ollama({
			// Patch: ensure host is never null
			host: normalizeBaseUrl(connection.baseUrl) || undefined
		})
		const res = await ollama.list()
		if (res && Array.isArray(res.models)) {
			return { ok: true }
		} else {
			return {
				ok: false,
				error: "Unexpected response format from Ollama API"
			}
		}
	} catch (e: any) {
		console.error("Ollama testConnection error:", e)
		return { ok: false, error: e.message || String(e) }
	}
}

const exports: AdapterExports = {
	Adapter: OllamaAdapter,
	listModels,
	testConnection,
	connectionDefaults: CONNECTION_DEFAULTS[CONNECTION_TYPE.OLLAMA],
	samplingKeyMap: ollamaSamplingKeyMap
}

export default exports
