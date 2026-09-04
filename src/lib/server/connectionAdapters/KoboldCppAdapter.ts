import Handlebars from "handlebars"
import {
	capabilitiesFromFlags,
	flagsFrom
} from "$lib/server/koboldcpp/probeCapabilities"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import { StopStrings } from "../utils/StopStrings"
import { TokenCounters } from "../utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import {
	BaseConnectionAdapter,
	type AdapterExports,
	type BasePromptSession
} from "./BaseConnectionAdapter"
import { JSON_OBJECT_GBNF } from "./jsonGrammar"
import { jsonSchemaToGbnf } from "./jsonSchemaToGbnf"
import { type CompiledPrompt } from "./types"
import type { TextGenResult } from "$lib/server/adapters/actions"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { koboldCppSamplingKeyMap } from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { fetchCurrentModelName } from "$lib/server/koboldcpp/kcppHttp"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import {
	createIdleWatchdog,
	LLM_IDLE_TIMEOUT_MS,
	LLM_NONSTREAMING_TIMEOUT_MS
} from "./idleTimeout"

// Plain/"dumb" KoboldCPP connection: the user runs and configures their own
// koboldcpp instance entirely themselves. No admin API is assumed, so there's
// no preflight — generateText() just sends the request. For a connection that
// works with Serene Pub's KoboldCPP Manager (subprocess lifecycle, model
// swapping via the admin API), see KoboldCppManagedAdapter, which subclasses
// this and only adds a preflight() step.
export class KoboldCppAdapter extends BaseConnectionAdapter {
	private _tokenCounter?: TokenCounters
	private abortController?: AbortController
	// KoboldCPP does not treat a dropped client connection as a cancel signal —
	// it keeps computing the abandoned generation server-side (occupying its
	// one generation slot in managed/single-user mode, blocking everything
	// queued behind it) unless explicitly told to stop via genkey + the
	// /api/extra/abort endpoint. abortController.abort() alone only stops
	// *this app* from reading the response.
	private genKey?: string

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
			session,
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

		// Map the sampling parameters according to KoboldCPP API.
		// `sampling` arrives already resolved (resolveSampling.ts): a key being
		// present IS the switch being on, so the key map is the only filter left.
		for (const [key, value] of Object.entries(this.sampling)) {
			if (koboldCppSamplingKeyMap[key]) {
				result[koboldCppSamplingKeyMap[key]] = value
			}
		}

		// Handle special mappings for KoboldCpp
		// Ensure we handle sampler_order if needed
		if (!result.sampler_order) {
			// Default sampler order for KoboldCPP - must be at least 6 items
			result.sampler_order = [6, 0, 1, 3, 4, 2, 5]
		}

		return result
	}

	getTokenCounter() {
		if (!this._tokenCounter) {
			this._tokenCounter = new TokenCounters(
				this.connection.tokenCounter || TokenCounterOptions.ESTIMATE
			)
		}
		return this._tokenCounter
	}

	async getContextTokenLimit(): Promise<number> {
		const samplingLimit = await super.getContextTokenLimit()
		const baseUrl =
			normalizeBaseUrl(this.connection.baseUrl) || "http://localhost:5001"
		try {
			const res = await fetch(
				`${baseUrl}/api/extra/true_max_context_length`,
				{
					signal: AbortSignal.timeout(3000)
				}
			)
			if (res.ok) {
				const data = await res.json()
				const serverMax =
					typeof data.value === "number" ? data.value : null
				if (serverMax) return Math.min(samplingLimit, serverMax)
			}
		} catch {
			// KoboldCPP unreachable — fall through to sampling limit
		}
		return samplingLimit
	}

	compilePrompt(args: {}) {
		return super.compilePrompt({
			// Default true — matches every connection type's actual form
			// default (connectionDefaults.ts) and Ollama/LMStudio's adapter
			// fallback. Only an old/malformed connection missing this field
			// entirely would ever hit the fallback.
			useSessionFormat: this.connection.extraJson?.useSession ?? true,
			...args
		})
	}

	async generateText(): Promise<TextGenResult> {
		const baseUrl =
			normalizeBaseUrl(this.connection.baseUrl) || "http://localhost:5001"
		// Default true — matches CONNECTION_DEFAULTS[KOBOLDCPP].extraJson.stream
		// (connectionDefaults.ts), same reasoning as useSession below.
		const stream = this.connection.extraJson?.stream ?? true
		const useMemory = this.connection.extraJson?.useMemory ?? false
		// Default true — see compilePrompt() above for why.
		const useSession = this.connection.extraJson?.useSession ?? true
		// A fresh key per generation — lets abort() tell KoboldCPP exactly which
		// in-flight generation to actually stop computing.
		this.genKey = crypto.randomUUID()
		// null = Auto (omit from request), true/false = explicit override
		const enableThinking: boolean | null =
			this.connection.extraJson?.enableThinking ?? null

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
		const stop_sequence = stopStrings.map((str) =>
			Handlebars.compile(str)(stopContext)
		)

		// Compile prompt using PromptBuilder
		const compiledPrompt: CompiledPrompt = await this.compilePrompt({})

		// Map sampling config
		const samplingParams = this.mapSamplingConfig()

		// Response-shape contract, translated to KoboldCPP's native mechanism.
		// KoboldCPP accepts a GBNF `grammar` on BOTH the OpenAI-compat session
		// endpoint and the raw completion endpoints, so this applies either way.
		// Empty object when the caller wants plain text, so unconstrained
		// generation — every session message — sends no grammar key at all.
		// A responseSchema narrows this from "any JSON object" to the exact
		// shape the caller needs; without one it stays object-level.
		const formatParams =
			this.responseFormat === "json"
				? {
						grammar: this.responseSchema
							? jsonSchemaToGbnf(this.responseSchema)
							: JSON_OBJECT_GBNF
					}
				: {}

		// Prepare the request body according to KoboldCPP API
		let requestBody: Record<string, any>

		if (useSession) {
			// Use OpenAI-style session completion format. genkey is a KoboldCPP
			// extension the OpenAI-compat endpoint may or may not honor — harmless
			// to include either way, and abort() below still works via the plain
			// fetch abort for this mode regardless.
			requestBody = {
				model: this.connection.model || "koboldcpp",
				messages: compiledPrompt.messages!,
				max_tokens:
					samplingParams.max_length ||
					samplingParams.n_predict ||
					100,
				stream,
				genkey: this.genKey,
				...samplingParams,
				// Bugfix: koboldcpp never reads a top-level "enable_thinking"
				// from a request — grepped its source, every occurrence of
				// that key is in the Tkinter GUI's own launch-config code,
				// building the --jinja_kwargs CLI argument for someone
				// running the GUI directly. The actual per-request path
				// (sessioncompletions handler, ~L4348-4354) only reads a nested
				// chat_template_kwargs object and merges it over the
				// server's cached/launch-time jinja kwargs — a top-level
				// field here was silently ignored, so no enable_thinking
				// value ever reached the model's chat template no matter
				// what this app sent.
				...(enableThinking !== null
					? {
							chat_template_kwargs: {
								enable_thinking: enableThinking
							}
						}
					: {}),
				...formatParams
			}
		} else {
			// Use text completion format. enable_thinking is deliberately
			// omitted here — it's a session-template (Jinja) variable, only
			// meaningful to the OpenAI-session-completions code path a model's
			// template can reference; the raw completion endpoints don't run
			// the session-template pipeline at all, so including it here was a
			// silent no-op regardless of the Thinking/Reasoning setting.
			requestBody = {
				prompt: compiledPrompt.prompt,
				max_length:
					samplingParams.max_length ||
					samplingParams.n_predict ||
					100,
				max_context_length: await this.getContextTokenLimit(),
				stop_sequence,
				genkey: this.genKey,
				...samplingParams,
				...formatParams
			}

			// Add memory if enabled (only for text completion)
			if (useMemory && this.connection.extraJson?.memory) {
				requestBody.memory = this.connection.extraJson.memory
			}
		}

		// TEMPORARY DEBUG — remove after diagnosing the Gemma 4
		// thinking-not-appearing report.
		console.log(
			"[KCPP DEBUG] useSession:",
			useSession,
			"stream:",
			stream,
			"enableThinking:",
			enableThinking,
			"requestBody keys:",
			Object.keys(requestBody)
		)

		// Handle streaming vs non-streaming
		if (stream) {
			return {
				completionResult: async (
					contentCb: (chunk: string) => void,
					thinkingCb?: (chunk: string) => void
				) => {
					const abortController = new AbortController()
					this.abortController = abortController
					let content = ""
					let idleTimedOut = false
					const idle = createIdleWatchdog(LLM_IDLE_TIMEOUT_MS, () => {
						idleTimedOut = true
						abortController.abort()
					})

					try {
						const endpoint = useSession
							? `${baseUrl}/v1/chat/completions`
							: `${baseUrl}/api/extra/generate/stream`

						const response = await fetch(endpoint, {
							method: "POST",
							headers: {
								"Content-Type": "application/json"
							},
							body: JSON.stringify(requestBody),
							signal: this.abortController.signal
						})

						if (!response.ok) {
							throw new Error(
								`KoboldCPP API error: ${response.status} ${response.statusText}`
							)
						}

						const reader = response.body?.getReader()
						if (!reader) {
							throw new Error("No response body")
						}

						const decoder = new TextDecoder()
						let buffer = ""

						while (true) {
							if (this.isAborting) {
								this.abortController.abort()
								break
							}

							const { done, value } = await reader.read()
							idle.poke()
							if (done) break

							buffer += decoder.decode(value, { stream: true })
							const lines = buffer.split("\n")
							buffer = lines.pop() || ""

							for (const line of lines) {
								if (line.startsWith("data: ")) {
									// Parsing alone is wrapped narrowly so a
									// malformed SSE line is ignored — but a
									// recognized-and-rejected response (below)
									// must still propagate to the outer catch,
									// not be swallowed here as "just a parse
									// error".
									let data: any
									try {
										data = JSON.parse(line.slice(6))
									} catch (e) {
										continue
									}
									if (useSession) {
										// TEMPORARY DEBUG — remove after diagnosing
										// the Gemma 4 thinking-not-appearing report.
										console.log(
											"[KCPP DEBUG] raw delta:",
											JSON.stringify(data.choices?.[0])
										)
										// OpenAI session format
										// A 200 stream doesn't guarantee a real
										// completion — eg. no model loaded comes
										// back as a single chunk with an empty
										// delta and finish_reason "error", then
										// [DONE]. Left unchecked, that silently
										// produces an empty-but-"successful" reply.
										if (
											data.choices?.[0]?.finish_reason ===
											"error"
										) {
											throw new Error(
												"KoboldCPP rejected the request (finish_reason: error) — is a model loaded?"
											)
										}
										// Native reasoning — koboldcpp scans the
										// model's raw output for known think-tag
										// pairs and lifts whatever's inside into
										// reasoning_content (stripped out of
										// content), gated by its own
										// encapsulate_thinking genparam (default
										// true, never overridden by this app).
										// Only actually appears when the loaded
										// model emits thinking output at all.
										if (
											data.choices?.[0]?.delta
												?.reasoning_content
										) {
											thinkingCb?.(
												data.choices[0].delta
													.reasoning_content
											)
										}
										if (data.choices?.[0]?.delta?.content) {
											const chunk =
												data.choices[0].delta.content
											content += chunk
											contentCb(chunk)
										}
									} else {
										// KoboldCPP text format
										if (data.token) {
											content += data.token
											contentCb(data.token)
										}
									}
								}
							}
						}
					} catch (e: any) {
						if (idleTimedOut) {
							throw new Error(
								`KoboldCPP connection idle — no response for ${LLM_IDLE_TIMEOUT_MS / 60_000} minutes.`
							)
						}
						if (e.name !== "AbortError") {
							throw e
						}
					} finally {
						idle.clear()
					}
				},
				compiledPrompt,
				isAborted: this.isAborting
			}
		} else {
			// Non-streaming request
			this.abortController = new AbortController()

			try {
				const endpoint = useSession
					? `${baseUrl}/v1/chat/completions`
					: `${baseUrl}/api/v1/generate`

				// No intermediate chunks to reset an idle timer against for a
				// non-streaming response — this is a genuine, documented
				// exception to the idle-based design used elsewhere in this
				// file: a flat bound, sized generously to cover a full slow
				// generation end-to-end.
				const response = await fetch(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json"
					},
					body: JSON.stringify(requestBody),
					signal: AbortSignal.any([
						this.abortController.signal,
						AbortSignal.timeout(LLM_NONSTREAMING_TIMEOUT_MS)
					])
				})

				if (this.isAborting) {
					return {
						completionResult: "",
						compiledPrompt,
						isAborted: true
					}
				}

				if (!response.ok) {
					const error = await response.text()
					throw new Error(
						`KoboldCPP API error: ${response.status} ${error}`
					)
				}

				const data = await response.json()

				// A 200 response doesn't guarantee a real completion — eg. no
				// model loaded (--nomodel, or nothing loaded yet) comes back as
				// HTTP 200 with an empty message and finish_reason "error".
				// Silently accepting that as a successful-but-empty reply leaves
				// the user staring at a blank message with no explanation.
				if (
					useSession &&
					data.choices?.[0]?.finish_reason === "error"
				) {
					throw new Error(
						"KoboldCPP rejected the request (finish_reason: error) — is a model loaded?"
					)
				}

				let content: string
				let thinkingContent: string | undefined
				if (useSession) {
					// TEMPORARY DEBUG — remove after diagnosing the Gemma 4
					// thinking-not-appearing report.
					console.log(
						"[KCPP DEBUG] non-stream raw message:",
						JSON.stringify(data.choices?.[0]?.message)
					)
					// OpenAI session format response
					content = data.choices?.[0]?.message?.content || ""
					// See the streaming branch's identical read above for why
					// this is only ever populated in session mode.
					thinkingContent =
						data.choices?.[0]?.message?.reasoning_content ||
						undefined
				} else {
					// KoboldCPP text format response
					content = data.results?.[0]?.text || ""
				}

				return {
					completionResult: content,
					compiledPrompt,
					isAborted: false,
					thinkingContent
				}
			} catch (e: any) {
				if (e.name === "AbortError") {
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
		super.abort()
		if (this.abortController) {
			this.abortController.abort()
		}
		// Tell KoboldCPP itself to stop — without this it keeps computing the
		// abandoned generation after we drop the connection, which in managed
		// mode (a single generation slot) blocks every subsequent request until
		// the zombie generation finishes on its own.
		if (this.genKey) {
			const baseUrl =
				normalizeBaseUrl(this.connection.baseUrl) ||
				"http://localhost:5001"
			fetch(`${baseUrl}/api/extra/abort`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ genkey: this.genKey }),
				signal: AbortSignal.timeout(5000)
			}).catch((err) => {
				console.warn(
					"[KoboldCppAdapter] Failed to send abort to KoboldCPP:",
					err
				)
			})
		}
	}
}

/**
 * Connection test function — reused as-is by KoboldCppManagedAdapter.
 *
 * Reports `extra.capabilities` because this endpoint already carries them and
 * this call already fetches it. Without that, KoboldCPP's `text->image` would
 * sit at the manifest's `{unproven: true, until: "none"}` forever: nothing else
 * probes a text-typed connection, so the one backend that writes replies and
 * draws pictures from the same process could never be shown to do the second.
 */
export async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string; extra?: Record<string, unknown> }> {
	try {
		const baseUrl =
			normalizeBaseUrl(connection.baseUrl) || "http://localhost:5001"
		const response = await fetch(`${baseUrl}/api/extra/version`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json"
			},
			signal: AbortSignal.timeout(5000)
		})

		if (!response.ok) {
			return {
				ok: false,
				error: `Server returned ${response.status} ${response.statusText}`
			}
		}

		const data = await response.json()
		if (!data.version) {
			return {
				ok: false,
				error: "Invalid response from KoboldCPP server"
			}
		}

		// What this instance can do RIGHT NOW — which models are loaded, not
		// which software is running. Mapped from the payload already in hand.
		const flags = flagsFrom(data)
		return {
			ok: true,
			extra: {
				version: data.version,
				koboldCppFlags: flags,
				capabilities: capabilitiesFromFlags(flags)
			}
		}
	} catch (e: any) {
		return {
			ok: false,
			error: e.message || "Failed to connect to KoboldCPP server"
		}
	}
}

// List models function — a dumb connection never assumes an admin API is
// present, so this only ever reports the currently loaded model. See
// KoboldCppManagedAdapter's listModels for the admin-API-backed version.
async function listModels(
	connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	try {
		const baseUrl =
			normalizeBaseUrl(connection.baseUrl) || "http://localhost:5001"

		const currentModel =
			(await fetchCurrentModelName(baseUrl)) || "No model loaded"

		const models = [
			{
				id: "[current]",
				name: `Currently Loaded: ${currentModel}`,
				object: "model",
				isCurrent: true
			}
		]

		return { models }
	} catch (e: any) {
		return {
			models: [],
			error: e.message || "Failed to fetch models from KoboldCpp"
		}
	}
}

const exports: AdapterExports = {
	Adapter: KoboldCppAdapter,
	testConnection,
	listModels,
	connectionDefaults: CONNECTION_DEFAULTS[CONNECTION_TYPE.KOBOLDCPP],
	samplingKeyMap: koboldCppSamplingKeyMap
}

export default exports
