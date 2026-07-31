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
	type BasePromptChat
} from "./BaseConnectionAdapter"
import { type CompiledPrompt } from "../utils/promptBuilder"
import {
	type BaseLoadModelOpts,
	type LLM,
	type LLMLoadModelConfig,
	type LLMPredictionOpts,
	LMStudioClient,
	type OngoingPrediction
} from "@lmstudio/sdk"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { lmStudioSamplingKeyMap } from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import {
	createIdleWatchdog,
	LLM_IDLE_TIMEOUT_MS,
	LLM_NONSTREAMING_TIMEOUT_MS
} from "./idleTimeout"

class LMStudioAdapter extends BaseConnectionAdapter {
	private _client?: LMStudioClient
	private _modelClient?: LLM
	private prediction?: OngoingPrediction<unknown>
	private _tokenCounter?: TokenCounters

	constructor({
		connection,
		sampling,
		contextConfig,
		promptConfig,
		chat,
		currentCharacterId,
		generatingMessageMetadata
	}: {
		connection: SelectConnection
		sampling: SelectSamplingConfig
		contextConfig: SelectContextConfig
		promptConfig: SelectPromptConfig
		chat: BasePromptChat
		currentCharacterId: number | null
		generatingMessageMetadata?: any
	}) {
		super({
			connection,
			sampling,
			contextConfig,
			promptConfig,
			chat,
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
		for (const [key, value] of Object.entries(this.sampling)) {
			if (key.endsWith("Enabled")) continue
			const enabledKey = key + "Enabled"
			if ((this.sampling as any)[enabledKey] === false) continue
			if (lmStudioSamplingKeyMap[key]) {
				if (key === "streaming") continue
				// Defensive: skip if value is undefined or not a primitive (unless you expect an object)
				if (value === undefined) continue
				// If you expect only primitives, skip objects:
				if (typeof value === "object" && value !== null) continue
				result[lmStudioSamplingKeyMap[key]] = value
			}
		}
		return result
	}

	// --- LM Studio client instance ---
	getClient() {
		if (!this._client) {
			const baseUrl = normalizeBaseUrl(this.connection.baseUrl) || undefined
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
					contextLength: this.promptBuilder.tokenLimit,
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
						`Failed to load model "${name}" in LM Studio. This may be due to insufficient VRAM/RAM or context length mismatch. Requested context: ${this.promptBuilder.tokenLimit} tokens. Try using a smaller model, reducing context length, or check LM Studio settings. Original error: ${errorMsg}`
					)
				}
				throw error
			}
		}
		return this._modelClient
	}

	async generate(): Promise<{
		completionResult:
			| string
			| ((
					contentCb: (chunk: string) => void,
					thinkingCb?: (chunk: string) => void
			  ) => Promise<void>)
		compiledPrompt: CompiledPrompt
		isAborted: boolean
		thinkingContent?: string
	}> {
		if (!this.sampling || typeof this.sampling !== "object") {
			throw new Error(
				"LMStudioAdapter: sampling config is missing or invalid"
			)
		}
		if (
			this.sampling.responseTokensEnabled === undefined ||
			this.sampling.responseTokens === undefined
		) {
			throw new Error(
				"LMStudioAdapter: sampling config missing required properties"
			)
		}

		const modelName =
			this.connection.model ??
			CONNECTION_DEFAULTS[CONNECTION_TYPE.LM_STUDIO].baseUrl
		const stream = this.connection!.extraJson?.stream || false
		if (typeof modelName !== "string")
			throw new Error("LMStudioAdapter: model must be a string")

		// Prepare stop strings for LM Studio
		const promptFormat = this.connection.promptFormat || "chatml"
		const stopStrings = StopStrings.get({
			format: promptFormat,
			characters:
				this.chat.chatCharacters?.map((cc) => cc.character) || [],
			personas: this.chat.chatPersonas?.map((cp) => cp.persona) || [],
			currentCharacterId: this.currentCharacterId ?? undefined
		})
		const characterName = resolveCharacterName(
			this.chat.chatCharacters?.[0]?.character
		)
		const personaName = this.chat.chatPersonas?.[0]?.persona?.name || "user"
		const stopContext: Record<string, string> = {
			char: characterName,
			user: personaName
		}
		const stop = stopStrings.map((str) =>
			Handlebars.compile(str)(stopContext)
		)

		// Use PromptBuilder for prompt construction
		const compiledPrompt: CompiledPrompt = await this.compilePrompt({})

		const useChat = this.connection.extraJson?.useChat ?? true
		let prompt: string = ""
		let messages: any[] | undefined = undefined

		if (useChat && compiledPrompt.messages) {
			messages = compiledPrompt.messages
		} else {
			prompt = compiledPrompt.prompt!
		}

		const options: LLMPredictionOpts<unknown> = {
			stopStrings: stop,
			maxTokens: this.sampling.responseTokensEnabled
				? this.sampling.responseTokens || 250
				: 250,
			contextOverflowPolicy: "truncateMiddle",
			...this.mapSamplingConfig()
		}

		// --- LM Studio SDK integration ---
		const modelClient = await this.getModelClient(modelName)

		if (stream) {
			return {
				completionResult: async (
					contentCb: (chunk: string) => void,
					_thinkingCb?: (chunk: string) => void
				) => {
					let idleTimedOut = false
					const idle = createIdleWatchdog(LLM_IDLE_TIMEOUT_MS, () => {
						idleTimedOut = true
						this.prediction?.cancel()
					})
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
								if (part?.content) {
									contentCb(part.content)
								}
							}
						} else {
							this.prediction = modelClient.complete(
								prompt,
								options
							)
							for await (const part of this.prediction) {
								idle.poke()
								if (this.isAborting) break
								if (part?.content) {
									contentCb(part.content)
								}
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
			const content = await (async () => {
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
						if (
							result &&
							typeof result === "object" &&
							"content" in result
						) {
							return result.content || ""
						} else {
							throw new Error(
								"Unexpected LM Studio chat result type"
							)
						}
					} else {
						this.prediction = modelClient.complete(prompt, options)
						const result = await this.prediction
						if (
							result &&
							typeof result === "object" &&
							"content" in result
						) {
							return result.content || ""
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
					if (this.isAborting) return ""
					throw e
				} finally {
					clearTimeout(idleTimer)
				}
			})()
			return {
				completionResult: content ?? "",
				compiledPrompt,
				isAborted: this.isAborting
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
		const client = new LMStudioClient({ baseUrl: normalizeBaseUrl(connection.baseUrl) })
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
		const client = new LMStudioClient({ baseUrl: normalizeBaseUrl(connection.baseUrl) })
		const res = await client.system.listDownloadedModels()
		if (res && Array.isArray(res)) {
			const models = res.map((model) => {
				return {
					model: model.modelKey,
					name: model.displayName
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
