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
import { ollamaSamplingKeyMap } from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import {
	createIdleWatchdog,
	LLM_IDLE_TIMEOUT_MS,
	LLM_NONSTREAMING_TIMEOUT_MS
} from "./idleTimeout"

class OllamaAdapter extends BaseConnectionAdapter {
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
				result[ollamaSamplingKeyMap[key]] = value
			}
		}
		return result
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
		const stream = this.connection!.extraJson?.stream || false
		const think = this.connection!.extraJson?.think || false
		// Ollama's OWN default, and deliberately not a shorter one. This read
		// `|| "300ms"`, so a connection that had never opened the form unloaded
		// the weights a third of a second after each turn — measured against a
		// 14B model, that is a ~9 GB reload on every single message, paid before
		// the first token of the next reply. The per-connection override below is
		// untouched; only the fallback moves.
		const keep_alive = this.connection!.extraJson?.keepAlive || "5m"
		if (typeof model !== "string")
			throw new Error("OllamaAdapter: model must be a string")

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
				think,
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
				think,
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

		if (stream) {
			return {
				completionResult: async (
					contentCb: (chunk: string) => void,
					thinkingCb?: (chunk: string) => void
				) => {
					let content = ""
					let idleTimedOut = false
					const ollama = this.getClient()
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
								if (this.isAborting) {
									ollama.abort()
									return
								}
								if (part.message) {
									// Forward thinking chunks before content starts
									if (part.message.thinking) {
										thinkingCb?.(part.message.thinking)
									}
									if (part.message.content) {
										content += part.message.content
										contentCb(part.message.content)
									}
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
								if (this.isAborting) {
									ollama.abort()
									return
								}
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
								thinking: res.message.thinking
							}
						} else {
							throw new Error("Unexpected Ollama result type")
						}
					} else {
						const res = await ollama.generate({
							...(req as GenerateRequest),
							stream: false
						})
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
								thinking: res.thinking
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
			return {
				completionResult: result.content ?? "",
				compiledPrompt,
				isAborted: this.isAborting,
				thinkingContent: result.thinking || undefined
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
