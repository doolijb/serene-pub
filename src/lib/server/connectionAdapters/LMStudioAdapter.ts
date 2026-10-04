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
import {
	type BaseLoadModelOpts,
	type LLM,
	type LLMLoadModelConfig,
	type LLMPredictionFragment,
	type LLMPredictionOpts,
	LMStudioClient,
	type OngoingPrediction
} from "@lmstudio/sdk"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import {
	isReasoningKey,
	lmStudioSamplingKeyMap,
	reasoningOf
} from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import {
	createIdleWatchdog,
	LLM_IDLE_TIMEOUT_MS,
	LLM_NONSTREAMING_TIMEOUT_MS
} from "./idleTimeout"

/**
 * Split an LM Studio `PredictionResult` into reply text and native reasoning.
 *
 * ⚠ `result.content` is the WHOLE generation, reasoning included — the SDK
 * documents `reasoningContent` and `nonReasoningContent` as the two halves of
 * it, not as extras beside it. Returning `content` verbatim while also reporting
 * `reasoningContent` would show the reader the model's scratchpad twice, once
 * as prose with its `<think>` markup still around it.
 *
 * Substituted ONLY when there is reasoning to split off, so a plain reply — and
 * an SDK result old enough to carry neither field — comes back byte-for-byte
 * what it did before.
 */
function splitReasoning(result: {
	content: string
	reasoningContent?: string
	nonReasoningContent?: string
}): { content: string; reasoningContent: string | undefined } {
	const reasoning = result.reasoningContent
	if (typeof reasoning === "string" && reasoning) {
		return {
			content:
				typeof result.nonReasoningContent === "string"
					? result.nonReasoningContent
					: result.content || "",
			reasoningContent: reasoning
		}
	}
	return { content: result.content || "", reasoningContent: undefined }
}

/** What the model wrote, as this SDK's prediction stats count it. */
function completionTokensFrom(result: unknown): { tokensCompletion?: number } {
	const count = (result as any)?.stats?.predictedTokensCount
	return typeof count === "number" && Number.isFinite(count)
		? { tokensCompletion: count }
		: {}
}

class LMStudioAdapter extends BaseConnectionAdapter {
	/**
	 * 🚧 Yes, on the chat wire (PLAN-composer-attachments §3.6): `.respond()`
	 * takes `images` per message as file handles, which `client.files.
	 * prepareImageBase64` makes (`@lmstudio/sdk` 1.5, verified against its
	 * declarations). `.complete()` takes none. A fact about the CODE, not a
	 * capability claim — see the base class. Constant, because the conformance
	 * pin reads it off the prototype; a completion-wire request with files is
	 * refused in `dispatch.ts` from the manifest's `sendsAttachments.completion`.
	 */
	override get consumesAttachments(): boolean {
		return true
	}

	/**
	 * Each turn's files as LM Studio image handles, on `images` beside the
	 * turn's text. Images only; anything else is refused naming the file.
	 */
	private async withImageHandles(messages: any[]): Promise<any[]> {
		const files = await this.filesByMessage(messages, { transport: "raw" })
		const client = this.getClient()
		let n = 0
		const out: any[] = []
		for (const [i, msg] of messages.entries()) {
			const own = files[i] ?? []
			if (!own.length) {
				out.push(msg)
				continue
			}
			const images = []
			for (const file of own) {
				n++
				if (file.kind !== "image")
					throw new Error(
						`${file.filename ?? `attachment ${n}`} is ${file.mime}, and LM Studio reads only images ` +
							`alongside a prompt. It is not sent rather than sent as something it is not.`
					)
				images.push(
					await client.files.prepareImageBase64(
						file.filename ?? `attachment-${n}.${file.ext}`,
						file.bytes.toString("base64")
					)
				)
			}
			out.push({ ...msg, images })
		}
		return out
	}

	private _client?: LMStudioClient
	private _modelClient?: LLM
	private prediction?: OngoingPrediction<unknown>
	private _tokenCounter?: TokenCounters

	constructor({
		connection,
		sampling,
		systemPrompt,
		session,
		currentCharacterId,
		generatingMessageMetadata
	}: {
		connection: SelectConnection
		sampling: ResolvedSampling
		systemPrompt?: string
		session: BasePromptSession
		currentCharacterId: number | null
		generatingMessageMetadata?: any
	}) {
		super({
			connection,
			sampling,
			systemPrompt,
			session,
			currentCharacterId,
			tokenCounter: new TokenCounters(
				connection.tokenCounter || TokenCounterOptions.ESTIMATE
			),
			tokenLimit: 0, // This is set dynamically based on the LM Studio API
			contextThresholdPercent: 0.9,
			generatingMessageMetadata
		})
	}

	mapSamplingConfig(): Record<string, any> {
		const result: Record<string, any> = {}
		// `sampling` arrives already resolved (resolveSampling.ts), so a key
		// being present IS the switch being on — there is nothing left to test
		// and the key map is the whole filter: a key it doesn't name is one
		// LM Studio has no field for.
		for (const [key, value] of Object.entries(this.sampling)) {
			if (lmStudioSamplingKeyMap[key]) {
				if (key === "streaming") continue
				// Translated below rather than copied — the level has a word
				// for "off" that is not the word the config uses.
				if (isReasoningKey(key)) continue
				// Defensive: skip if value is undefined or not a primitive (unless you expect an object)
				if (value === undefined) continue
				// If you expect only primitives, skip objects:
				if (typeof value === "object" && value !== null) continue
				result[lmStudioSamplingKeyMap[key]] = value
			}
		}
		return result
	}

	/**
	 * `reasoning_effort`, in the OpenAI spelling LM Studio's own server speaks.
	 *
	 * Nothing at all when the sampler is switched off, which keeps every
	 * request this adapter has ever sent byte-identical — see the twin of this
	 * method on `OpenAIChatAdapter`, which carries the full argument for
	 * sending `"none"` rather than withholding it.
	 *
	 * It rides in `options` beside the rest of `mapSamplingConfig`, which is
	 * where this file has always put a key the SDK may or may not forward.
	 * `reasoningBudget` has no field in this format at all, so a config
	 * carrying one is recorded as ignored.
	 */
	private reasoningParams(): Record<string, string> {
		const { level, budget } = reasoningOf(this.sampling)
		if (!level) return {}
		if (budget !== undefined) this.noteIgnoredSampler("reasoningBudget")
		return { reasoning_effort: level === "off" ? "none" : level }
	}

	// --- LM Studio client instance ---
	getClient() {
		if (!this._client) {
			const baseUrl =
				normalizeBaseUrl(this.connection.baseUrl) || undefined
			this._client = new LMStudioClient({ baseUrl })
		}
		return this._client
	}

	async getModelClient(modelName?: string): Promise<LLM> {
		if (!this._modelClient) {
			const client = this.getClient()
			const name = modelName || this.connection.model
			if (!name || typeof name !== "string")
				throw new Error("Model name required for getModelClient")

			// Check available models first
			try {
				const availableModels =
					await client.system.listDownloadedModels()
				const modelExists = availableModels.some(
					(model) => model.modelKey === name
				)
				if (!modelExists) {
					throw new Error(
						`Model "${name}" is not downloaded in LM Studio. Available models: ${availableModels.map((m) => m.modelKey).join(", ")}`
					)
				}
			} catch (error) {
				console.warn("Could not check available models:", error)
			}

			const opts: BaseLoadModelOpts<LLMLoadModelConfig> = {
				config: {
					contextLength: this.tokenLimit,
					keepModelInMemory: false // TODO: make configurable?
				},
				ttl: this.connection.extraJson.ttl || 60 // Increased TTL to avoid frequent reloading
			}
			console.log("LM Studio getModelClient opts", opts)

			try {
				this._modelClient = await client.llm.model(name, opts)
				const modelInstCtxLength =
					await this._modelClient.getContextLength()
				console.log(
					"Model loaded successfully with context length:",
					modelInstCtxLength
				)
			} catch (error) {
				const errorMsg =
					error instanceof Error ? error.message : String(error)
				if (errorMsg.includes("Error loading model")) {
					throw new Error(
						`Failed to load model "${name}" in LM Studio. This may be due to insufficient VRAM/RAM or context length mismatch. Requested context: ${this.tokenLimit} tokens. Try using a smaller model, reducing context length, or check LM Studio settings. Original error: ${errorMsg}`
					)
				}
				throw error
			}
		}
		return this._modelClient
	}

	async generateText(): Promise<TextGenResult> {
		if (!this.sampling || typeof this.sampling !== "object") {
			throw new Error(
				"LMStudioAdapter: sampling config is missing or invalid"
			)
		}

		const modelName =
			this.connection.model ??
			CONNECTION_DEFAULTS[CONNECTION_TYPE.LM_STUDIO].baseUrl
		const stream = this.streamingOn(
			this.connection!.extraJson?.stream || false
		)
		if (typeof modelName !== "string")
			throw new Error("LMStudioAdapter: model must be a string")

		// The stop sequences this request will send — composed by
		// `connections/stops.ts` and handed over at construction, never built
		// here (ruling 2026-09-10).
		const stop = this.stops

		// Use PromptBuilder for prompt construction
		const compiledPrompt: CompiledPrompt = await this.compilePrompt({})

		/**
		 * `.respond()` (messages) or `.complete()` (one prompt) — the connection's
		 * own answer, not an `extraJson` flag of this adapter's.
		 *
		 * This read `extraJson.useChat ?? true` while the payload was built
		 * from a flag the pipeline never set, so a chat-mode connection reached
		 * the `&& compiledPrompt.messages` half, found none, and silently fell
		 * through to the completion branch. That degradation is why LM Studio
		 * never showed the defect the way Anthropic and KoboldCPP did — the
		 * prompt still went out, in the wrong shape, with nothing to say so.
		 */
		const useChat = this.isChatWire
		let prompt: string = ""
		let messages: any[] | undefined = undefined

		if (useChat) {
			// Checked rather than silently degraded — see above. Not rebuilt
			// through `promptTextFor`: that is the local decision this change
			// removes, and it is what hid the fault here for a release.
			if (!Array.isArray(compiledPrompt.messages))
				throw new Error(
					"this LM Studio connection is chat wire mode, but the prompt it was " +
						"handed carries no messages. The render and the send are reading " +
						"different wire modes — check that the assemble node's connection " +
						"slot is wired to the sending Provider (slot.connectionOf)."
				)
			messages = compiledPrompt.messages
			// 🚧 The files, each on its own turn (PLAN-composer-attachments §3.6).
			if (this.carriesAttachments)
				messages = await this.withImageHandles(messages!)
		} else {
			// See `promptTextFor`: `compiledPrompt.prompt!` asserted a string
			// that a chat-shaped payload does not carry.
			prompt = this.promptTextFor(compiledPrompt)
		}

		const options: LLMPredictionOpts<unknown> = {
			stopStrings: stop,
			// One fallback covers both cases:
			// a switched-off Response Tokens leaves no key at all, and an
			// enabled-but-zero one is still the "no usable limit" it always was.
			maxTokens: this.sampling.responseTokens || 250,
			contextOverflowPolicy: "truncateMiddle",
			...this.mapSamplingConfig(),
			...this.reasoningParams(),
			// LM Studio's SDK takes the constraint as a `structured` option
			// rather than a request field. `{ type: "json" }` is its
			// any-valid-JSON mode — the SDK also accepts a jsonSchema here if a
			// schema-level contract is ever added.
			...(this.responseFormat === "json"
				? {
						structured: this.responseSchema
							? {
									type: "json" as const,
									jsonSchema: this.responseSchema
								}
							: { type: "json" as const }
					}
				: {})
		}

		// --- LM Studio SDK integration ---
		const modelClient = await this.getModelClient(modelName)

		// The record the inspector reads instead of a proxy. This SDK speaks its
		// own transport rather than HTTP, so the call it makes stands where a
		// method would: `respond` takes turns, `complete` takes one string.
		const wire = this.beginExchange({
			url:
				normalizeBaseUrl(this.connection.baseUrl) ||
				CONNECTION_DEFAULTS[CONNECTION_TYPE.LM_STUDIO].baseUrl,
			method: useChat ? "respond" : "complete",
			body: {
				model: modelName,
				...(useChat ? { messages } : { prompt }),
				options
			}
		})

		if (stream) {
			return {
				completionResult: async (
					contentCb: (chunk: string) => void,
					reasoningCb?: (chunk: string) => void
				) => {
					let idleTimedOut = false
					const idle = createIdleWatchdog(LLM_IDLE_TIMEOUT_MS, () => {
						idleTimedOut = true
						this.prediction?.cancel()
					})
					// Native reasoning, LM Studio's way: there is no wire field
					// to read, because the SDK tags every FRAGMENT instead.
					const route = (part: LLMPredictionFragment | undefined) => {
						wire.frame(part)
						if (!part?.content) return
						switch (part.reasoningType) {
							case "reasoning":
								reasoningCb?.(part.content)
								return
							// The literal <think>/</think> tokens. Structure, not
							// prose — the reasoning is already on its own channel,
							// so forwarding these as content would only show the
							// reader raw markup with nothing between it.
							case "reasoningStartTag":
							case "reasoningEndTag":
								return
							// "none", and an SDK old enough not to tag at all.
							default:
								contentCb(part.content)
						}
					}
					try {
						if (useChat && messages) {
							this.prediction = modelClient.respond(
								messages,
								options
							)
							for await (const part of this.prediction) {
								idle.poke()
								// A second line of defense alongside abort()'s
								// prediction.cancel() call — every other
								// streaming adapter also polls isAborting
								// per-chunk, in case cancel() doesn't reliably
								// unblock this loop on its own.
								if (this.isAborting) break
								route(part)
							}
						} else {
							this.prediction = modelClient.complete(
								prompt,
								options
							)
							for await (const part of this.prediction) {
								idle.poke()
								if (this.isAborting) break
								route(part)
							}
						}
					} catch (e: any) {
						if (idleTimedOut) {
							throw new Error(
								`LM Studio did not respond for ${LLM_IDLE_TIMEOUT_MS / 60_000} minutes — connection may be hung.`
							)
						}
						// An intentional cancel() rejects the iterator too —
						// don't surface that as an error.
						if (this.isAborting) return
						throw e
					} finally {
						idle.clear()
					}
				},
				compiledPrompt,
				isAborted: this.isAborting
			}
		} else {
			const { content, reasoningContent } = await (async () => {
				// No intermediate chunks to reset an idle timer against for a
				// non-streaming response — a genuine, documented exception to
				// the idle-based design used in the streaming branch above: a
				// flat bound, sized generously to cover a full slow
				// generation end-to-end.
				let idleTimedOut = false
				const idleTimer = setTimeout(() => {
					idleTimedOut = true
					this.prediction?.cancel()
				}, LLM_NONSTREAMING_TIMEOUT_MS)
				try {
					if (useChat && messages) {
						this.prediction = modelClient.respond(messages, options)
						const result = await this.prediction
						wire.received(result)
						// Through the adapter's usage seam rather than the
						// result object: this SDK reports counts on its own
						// `stats`, and the caller reads both places.
						this.recordStreamedUsage(completionTokensFrom(result))
						if (
							result &&
							typeof result === "object" &&
							"content" in result
						) {
							return splitReasoning(result)
						} else {
							throw new Error(
								"Unexpected LM Studio session result type"
							)
						}
					} else {
						this.prediction = modelClient.complete(prompt, options)
						const result = await this.prediction
						wire.received(result)
						// Through the adapter's usage seam rather than the
						// result object: this SDK reports counts on its own
						// `stats`, and the caller reads both places.
						this.recordStreamedUsage(completionTokensFrom(result))
						if (
							result &&
							typeof result === "object" &&
							"content" in result
						) {
							return splitReasoning(result)
						} else {
							throw new Error("Unexpected LM Studio result type")
						}
					}
				} catch (e: any) {
					if (idleTimedOut) {
						throw new Error(
							`LM Studio did not respond within ${LLM_NONSTREAMING_TIMEOUT_MS / 60_000} minutes.`
						)
					}
					if (this.isAborting)
						return { content: "", reasoningContent: undefined }
					throw e
				} finally {
					clearTimeout(idleTimer)
				}
			})()
			return {
				completionResult: content ?? "",
				compiledPrompt,
				isAborted: this.isAborting,
				reasoningContent
			}
		}
	}

	abort() {
		this.isAborting = true
		if (this.prediction) {
			this.prediction.cancel()
		}
	}

	async getContextTokenLimit(): Promise<number> {
		const limit = await super.getContextTokenLimit()

		const models = await this.getClient().system.listDownloadedModels()
		const modelName = this.connection.model
		const modelInfo = models.find((m) => m.modelKey === modelName)
		if (!modelInfo) {
			console.warn(
				`LM Studio getContextTokenLimit: Model "${modelName}" not found in downloaded models`
			)
		} else if (modelInfo.maxContextLength < limit) {
			console.warn(
				`LM Studio getContextTokenLimit: The configured context limit ${limit} exceeds the model's maximum context length of ${modelInfo.maxContextLength}. This may cause the model to crash.`
			)
		}

		return limit
	}
}

async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string }> {
	try {
		const client = new LMStudioClient({
			baseUrl: normalizeBaseUrl(connection.baseUrl)
		})
		const res = await client.system.getLMStudioVersion()
		if (res && typeof res === "object" && "version" in res) {
			// Also check if any models are available
			try {
				const models = await client.system.listDownloadedModels()
				if (!models || models.length === 0) {
					return {
						ok: true,
						error: "LM Studio is running but no models are downloaded. Please download a model in LM Studio first."
					}
				}
			} catch (modelError) {
				console.warn(
					"Could not check models during connection test:",
					modelError
				)
			}
			return {
				ok: true
			}
		} else {
			return {
				ok: false,
				error: "Could not get LM Studio version. Make sure LM Studio server is running on the specified URL."
			}
		}
	} catch (error) {
		return {
			ok: false,
			error: `Connection failed: ${error instanceof Error ? error.message : String(error)}`
		}
	}
}

async function listModels(
	connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	try {
		const client = new LMStudioClient({
			baseUrl: normalizeBaseUrl(connection.baseUrl)
		})
		const res = await client.system.listDownloadedModels()
		if (res && Array.isArray(res)) {
			// The identifier and the label are renamed to the shape every
			// adapter shares; the rest of the SDK's descriptor rides along
			// untouched so `readModelFacts` can read the context window,
			// parameter string, quantisation and size it already holds. Mapping
			// to two fields here would lose them before the shared normalizer
			// ever saw the entry.
			const models = res.map((model) => {
				const { modelKey, displayName, ...rest } =
					model as unknown as Record<string, unknown> & {
						modelKey: string
						displayName: string
					}
				return {
					...rest,
					model: modelKey,
					name: displayName
				}
			})
			return {
				models: models,
				error: undefined
			}
		} else {
			console.error(
				"LM Studio listModels error: Unexpected response format",
				res
			)
			return {
				models: [],
				error: "Unexpected response format from LM Studio API"
			}
		}
	} catch (error) {
		console.error("LM Studio listModels error:", error)
		return {
			models: [],
			error: "Failed to list models from LM Studio API, is the server running?"
		}
	}
}

const exports: AdapterExports = {
	Adapter: LMStudioAdapter,
	testConnection,
	listModels,
	connectionDefaults: CONNECTION_DEFAULTS[CONNECTION_TYPE.LM_STUDIO],
	samplingKeyMap: lmStudioSamplingKeyMap
}

export default exports
