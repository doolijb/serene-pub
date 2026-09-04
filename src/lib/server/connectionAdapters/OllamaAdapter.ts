import Handlebars from "handlebars"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import _ from "lodash"
import { StopStrings } from "../utils/StopStrings"
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

	compilePrompt(args: {}) {
		const useSessionFormat = !!this.connection.extraJson?.useSession
		console.log(
			"[OllamaAdapter.compilePrompt] connection.extraJson:",
			this.connection.extraJson
		)
		console.log(
			"[OllamaAdapter.compilePrompt] useSession value:",
			this.connection.extraJson?.useSession
		)
		console.log(
			"[OllamaAdapter.compilePrompt] useSessionFormat:",
			useSessionFormat
		)
		return super.compilePrompt({
			useSessionFormat,
			...args
		})
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
		console.log("[OllamaAdapter] think flag:", think, "stream:", stream)
		const keep_alive = this.connection!.extraJson?.keepAlive || "300ms"
		if (typeof model !== "string")
			throw new Error("OllamaAdapter: model must be a string")

		// Prepare stop strings for Ollama
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

		// Use PromptBuilder for prompt construction

		const compiledPrompt: CompiledPrompt = await this.compilePrompt({})

		console.log(
			"[OllamaAdapter] useSession:",
			this.connection.extraJson?.useSession
		)
		console.log(
			"[OllamaAdapter] compiledPrompt has messages:",
			!!compiledPrompt.messages
		)
		console.log(
			"[OllamaAdapter] compiledPrompt has prompt:",
			!!compiledPrompt.prompt
		)

		/**
		 * Which request shape to send, taken from **what was actually built**.
		 *
		 * This read `extraJson?.useSession ?? true` while `compilePrompt` above
		 * reads `!!extraJson?.useSession` — the same setting with two different
		 * defaults. A connection whose `extraJson` has no `useSession` (the column
		 * defaults to `{}`) therefore had a completion prompt built and a *session*
		 * request sent, with `messages: undefined`. Ollama answers that with an
		 * empty string, which surfaces as "the model returned nothing" and
		 * looks like a model fault rather than a request we built wrong.
		 *
		 * Deriving it from the payload cannot disagree with itself: the
		 * preference already decided which field `compilePrompt` populated, so
		 * following the payload honours it transitively and stays correct even
		 * if the two defaults drift again.
		 */
		const useSession = !!compiledPrompt.messages
		console.log("[OllamaAdapter] useSession (from payload):", useSession)
		let req: GenerateRequest | ChatRequest

		if (useSession) {
			if (!compiledPrompt.messages) {
				console.error(
					"[OllamaAdapter] ERROR: useSession is true but compiledPrompt.messages is undefined!"
				)
				console.error("[OllamaAdapter] compiledPrompt:", compiledPrompt)
			}
			req = {
				model,
				messages: compiledPrompt.messages!,
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
			// For generate mode, append the prompt format stop strings
			// Get the format-specific stop strings based on connection's promptFormat
			const formatStopStrings = StopStrings.get({
				format: this.connection.promptFormat || "vicuna",
				characters: [],
				personas: [],
				currentCharacterId: this.currentCharacterId ?? undefined
			})

			// Combine with the existing stop strings (which include character/persona names)
			const allStopStrings = [...stop, ...formatStopStrings]

			req = {
				model,
				prompt: compiledPrompt.prompt!,
				stream,
				think,
				keep_alive,
				options: {
					...this.mapSamplingConfig(),
					stop: allStopStrings
				},
				// Top-level, and schema-aware, same as the session branch above.
				...(this.responseFormat === "json"
					? { format: this.responseSchema ?? "json" }
					: {})
			} as GenerateRequest
		}

		console.log("OllamaAdapter generate mode request:", req)

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
							let firstPart = true
							for await (const part of result) {
								idle.poke()
								if (this.isAborting) {
									ollama.abort()
									return
								}
								if (firstPart) {
									console.log(
										"[OllamaAdapter] first stream part keys:",
										Object.keys(part),
										"message keys:",
										part.message
											? Object.keys(part.message)
											: "no message",
										"message.thinking:",
										(
											part.message as any
										)?.thinking?.substring(0, 50)
									)
									firstPart = false
								}
								if (part.message) {
									// Forward thinking chunks before content starts
									if (part.message.thinking) {
										console.log(
											"[OllamaAdapter] thinking chunk:",
											part.message.thinking.length,
											"chars"
										)
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
							let genFirstPart = true
							for await (const part of result) {
								idle.poke()
								if (this.isAborting) {
									ollama.abort()
									return
								}
								if (genFirstPart || part.done) {
									console.log(
										"[OllamaAdapter] generate part keys:",
										Object.keys(part),
										"thinking:",
										(part as any).thinking?.length ?? 0,
										"response:",
										part.response?.length ?? 0,
										"done:",
										part.done
									)
									genFirstPart = false
								}
								if (part.thinking) {
									console.log(
										"[OllamaAdapter] generate thinking chunk:",
										part.thinking.length,
										"chars"
									)
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
						console.log("Using non-steaming session API")
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
							console.log(
								"[OllamaAdapter] non-stream session thinking:",
								res.message.thinking
									? res.message.thinking.length + " chars"
									: "none"
							)
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
							console.log(
								"[OllamaAdapter] non-stream generate thinking:",
								res.thinking
									? res.thinking.length + " chars"
									: "none"
							)
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
