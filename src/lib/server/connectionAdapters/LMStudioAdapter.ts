import Handlebars from "handlebars"
import _ from "lodash"
import { StopStrings } from "../utils/StopStrings"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { TokenCounters } from "../utils/TokenCounterManager"
import {
	BaseConnectionAdapter,
	type AdapterExports
} from "./BaseConnectionAdapter"
import {
	type BaseLoadModelOpts,
	type LLM,
	type LLMLoadModelConfig,
	type LLMPredictionOpts,
	LMStudioClient,
	type OngoingPrediction
} from "@lmstudio/sdk"

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
		currentCharacterId
	}: {
		connection: SelectConnection
		sampling: SelectSamplingConfig
		contextConfig: SelectContextConfig
		promptConfig: SelectPromptConfig
		chat: SelectChat & {
			chatCharacters?: (SelectChatCharacter & {
				character: SelectCharacter
			})[]
			chatPersonas?: (SelectChatPersona & { persona: SelectPersona })[]
			chatMessages: SelectChatMessage[]
		}
		currentCharacterId: number
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
			contextThresholdPercent: 0.9
		})
	}

	mapSamplingConfig(): Record<string, any> {
		const result: Record<string, any> = {}
		for (const [key, value] of Object.entries(this.sampling)) {
			if (key.endsWith("Enabled")) continue
			const enabledKey = key + "Enabled"
			if ((this.sampling as any)[enabledKey] === false) continue
			if (samplingKeyMap[key]) {
				if (key === "streaming") continue
				// Defensive: skip if value is undefined or not a primitive (unless you expect an object)
				if (value === undefined) continue
				// If you expect only primitives, skip objects:
				if (typeof value === "object" && value !== null) continue
				result[samplingKeyMap[key]] = value
			}
		}
		return result
	}

	// --- LM Studio client instance ---
	getClient() {
		if (!this._client) {
			const baseUrl = this.connection.baseUrl ?? undefined
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
			| ((cb: (chunk: string) => void) => Promise<void>)
		compiledPrompt: CompiledPrompt
		isAborted: boolean
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

		const modelName = this.connection.model ?? connectionDefaults.baseUrl
		const stream = this.connection!.extraJson?.stream || false
		if (typeof modelName !== "string")
			throw new Error("LMStudioAdapter: model must be a string")

		// Prepare stop strings for LM Studio
		const promptFormat = this.connection.promptFormat || "chatml"
		const stopStrings = StopStrings.get({
			format: promptFormat,
			characters: this.chat.chatCharacters?.map(
				(cc: any) => cc.character
			),
			personas: this.chat.chatPersonas?.map((cp: any) => cp.persona),
			currentCharacterId: this.currentCharacterId
		})
		const characterName =
			this.chat.chatCharacters?.[0]?.character?.nickname ||
			this.chat.chatCharacters?.[0]?.character?.name ||
			"assistant"
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
				completionResult: async (cb: (chunk: string) => void) => {
					let fullContent = ""
					let lastChunk = ""
					let abortedEarly = false
					try {
						if (useChat && messages) {
							this.prediction = modelClient.respond(
								messages,
								options
							)
							for await (const part of this.prediction) {
								if (part?.content) {
									const newChunk = part.content
									fullContent += newChunk
									lastChunk = newChunk
									cb(newChunk)
								}
							}
						} else {
							this.prediction = modelClient.complete(
								prompt,
								options
							)
							for await (const part of this.prediction) {
								if (part?.content) {
									const newChunk = part.content
									fullContent += newChunk
									lastChunk = newChunk
									cb(newChunk)
								}
							}
						}
						// Only emit final content if it's different from the last streamed piece
						if (
							!fullContent.endsWith(lastChunk) ||
							fullContent !== lastChunk
						) {
							return
						}
					} catch (e: any) {
						if (!abortedEarly)
							cb("FAILURE: " + (e.message || String(e)))
					}
				},
				compiledPrompt,
				isAborted: this.isAborting
			}
		} else {
			const content = await (async () => {
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
							return "FAILURE: Unexpected LM Studio chat result type"
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
							return "FAILURE: Unexpected LM Studio result type"
						}
					}
				} catch (e: any) {
					return "FAILURE: " + (e.message || String(e))
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

const connectionDefaults = {
	baseUrl: "ws://localhost:1234",
	promptFormat: PromptFormats.VICUNA,
	tokenCounter: TokenCounterOptions.ESTIMATE, // Use Gemma tokenizer for better accuracy with Gemma models
	extraJson: {
		useChat: true, // Use chat (response api)
		stream: true,
		ttl: 60
	}
}

// --- SamplingConfig mapping ---
const samplingKeyMap: Record<string, string> = {
	temperature: "temperature",
	topP: "topPSampling",
	topK: "topKSampling",
	repetitionPenalty: "repeatPenalty",
	minP: "minPSampling",
	xtcProbability: "xtcProbability",
	xtcThreshold: "xtcThreshold",
	responseTokens: "maxTokens",
	stopStrings: "stopStrings"
}

async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string }> {
	try {
		const client = new LMStudioClient({ baseUrl: connection.baseUrl || "" })
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
		const client = new LMStudioClient({ baseUrl: connection.baseUrl || "" })
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
	connectionDefaults,
	samplingKeyMap
}

export default exports
