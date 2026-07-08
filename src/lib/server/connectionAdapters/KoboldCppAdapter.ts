import Handlebars from "handlebars"
import { StopStrings } from "../utils/StopStrings"
import { TokenCounters } from "../utils/TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import {
	BaseConnectionAdapter,
	type AdapterExports,
	type BasePromptChat
} from "./BaseConnectionAdapter"
import { type CompiledPrompt } from "../utils/promptBuilder"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { koboldCppSamplingKeyMap } from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { db } from "$lib/server/db"
import * as path from "path"
import * as subprocessManager from "$lib/server/koboldcpp/subprocessManager"
import { ensureModelLoaded, DEFAULT_MANAGED_CONFIG } from "$lib/server/koboldcpp/modelManager"

class KoboldCppAdapter extends BaseConnectionAdapter {
	private _tokenCounter?: TokenCounters
	private abortController?: AbortController

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

		// Map the sampling parameters according to KoboldCpp API
		for (const [key, value] of Object.entries(this.sampling)) {
			if (key.endsWith("Enabled")) continue
			const enabledKey = key + "Enabled"
			if ((this.sampling as any)[enabledKey] === false) continue

			if (koboldCppSamplingKeyMap[key]) {
				result[koboldCppSamplingKeyMap[key]] = value
			}
		}

		// Handle special mappings for KoboldCpp
		// Ensure we handle sampler_order if needed
		if (!result.sampler_order) {
			// Default sampler order for KoboldCpp - must be at least 6 items
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
		const baseUrl = this.connection.baseUrl || "http://localhost:5001"
		try {
			const res = await fetch(`${baseUrl}/api/extra/true_max_context_length`, {
				signal: AbortSignal.timeout(3000)
			})
			if (res.ok) {
				const data = await res.json()
				const serverMax = typeof data.value === "number" ? data.value : null
				if (serverMax) return Math.min(samplingLimit, serverMax)
			}
		} catch {
			// KoboldCPP unreachable — fall through to sampling limit
		}
		return samplingLimit
	}

	compilePrompt(args: {}) {
		return super.compilePrompt({
			useChatFormat: !!this.connection.extraJson?.useChat,
			...args
		})
	}

	async managedPreflight(): Promise<void> {
		const settings = await db.query.koboldCppSettings.findFirst()
		if (!settings?.koboldCppManagerEnabled) {
			console.log("[KoboldCPP] preflight skip: manager not enabled")
			return
		}
		if (settings?.koboldCppManagedMode !== "managed") {
			console.log("[KoboldCPP] preflight skip: mode is", settings?.koboldCppManagedMode)
			return
		}

		let managedConfig = this.connection.extraJson?.managedConfig
		if (!managedConfig?.modelFile && this.connection.model) {
			// Connection predates managed mode — derive config from the stored model field
			managedConfig = { ...DEFAULT_MANAGED_CONFIG, modelFile: path.basename(this.connection.model) }
		}
		if (!managedConfig?.modelFile) {
			console.log("[KoboldCPP] preflight skip: no model on connection", this.connection.id)
			return
		}

		console.log("[KoboldCPP] preflight: connection", this.connection.id, "model", managedConfig.modelFile)

		if (!subprocessManager.isRunning()) {
			console.log("[KoboldCPP] preflight: subprocess not running, starting...")
			await subprocessManager.start()
			console.log("[KoboldCPP] preflight: subprocess started")
		}

		const contextSize = this.sampling.contextTokens ?? 4096
		console.log("[KoboldCPP] preflight: calling ensureModelLoaded, contextSize=", contextSize)
		try {
			await ensureModelLoaded({
				connectionId: this.connection.id,
				managedConfig,
				baseUrl: settings.koboldCppManagerBaseUrl,
				modelsDir: settings.koboldCppManagerModelsDir ?? null,
				adminPassword: settings.koboldCppManagedAdminPassword ?? "",
				ttlSecs: settings.koboldCppManagedModelTtlSecs ?? 300,
				contextSize
			})
			console.log("[KoboldCPP] preflight: ensureModelLoaded completed OK")
			subprocessManager.pingActivity()
		} catch (err) {
			console.error("[KoboldCPP] preflight: ensureModelLoaded FAILED:", err)
		}
	}

	async generate(): Promise<{
		completionResult:
			| string
			| ((contentCb: (chunk: string) => void, thinkingCb?: (chunk: string) => void) => Promise<void>)
		compiledPrompt: CompiledPrompt
		isAborted: boolean
		thinkingContent?: string
	}> {
		await this.managedPreflight()

		const baseUrl = this.connection.baseUrl || "http://localhost:5001"
		const stream = this.connection.extraJson?.stream ?? false
		const useMemory = this.connection.extraJson?.useMemory ?? false
		const useChat = this.connection.extraJson?.useChat ?? false
		// null = Auto (omit from request), true/false = explicit override
		const enableThinking: boolean | null = this.connection.extraJson?.enableThinking ?? null

		// Prepare stop strings
		const stopStrings = StopStrings.get({
			format: this.connection.promptFormat || "chatml",
			characters:
				this.chat.chatCharacters?.map((cc) => cc.character) || [],
			personas: this.chat.chatPersonas?.map((cp) => cp.persona) || [],
			currentCharacterId: this.currentCharacterId ?? undefined
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
		const stop_sequence = stopStrings.map((str) =>
			Handlebars.compile(str)(stopContext)
		)

		// Compile prompt using PromptBuilder
		const compiledPrompt: CompiledPrompt = await this.compilePrompt({})

		// Map sampling config
		const samplingParams = this.mapSamplingConfig()

		// Prepare the request body according to KoboldCpp API
		let requestBody: Record<string, any>

		if (useChat) {
			// Use OpenAI-style chat completion format
			requestBody = {
				model: this.connection.model || "koboldcpp",
				messages: compiledPrompt.messages!,
				max_tokens:
					samplingParams.max_length ||
					samplingParams.n_predict ||
					100,
				stream,
				...samplingParams,
				...(enableThinking !== null ? { enable_thinking: enableThinking } : {})
			}
		} else {
			// Use text completion format
			requestBody = {
				prompt: compiledPrompt.prompt,
				max_length:
					samplingParams.max_length ||
					samplingParams.n_predict ||
					100,
				max_context_length: await this.getContextTokenLimit(),
				stop_sequence,
				...samplingParams,
				...(enableThinking !== null ? { enable_thinking: enableThinking } : {})
			}

			// Add memory if enabled (only for text completion)
			if (useMemory && this.connection.extraJson?.memory) {
				requestBody.memory = this.connection.extraJson.memory
			}
		}

		// Handle streaming vs non-streaming
		if (stream) {
			return {
				completionResult: async (contentCb: (chunk: string) => void, _thinkingCb?: (chunk: string) => void) => {
					this.abortController = new AbortController()
					let content = ""

					try {
						const endpoint = useChat
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
								`KoboldCpp API error: ${response.status} ${response.statusText}`
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
							if (done) break

							buffer += decoder.decode(value, { stream: true })
							const lines = buffer.split("\n")
							buffer = lines.pop() || ""

							for (const line of lines) {
								if (line.startsWith("data: ")) {
									try {
										const data = JSON.parse(line.slice(6))
										if (useChat) {
											// OpenAI chat format
											if (
												data.choices?.[0]?.delta
													?.content
											) {
												const chunk =
													data.choices[0].delta
														.content
												content += chunk
												contentCb(chunk)
											}
										} else {
											// KoboldCpp text format
											if (data.token) {
												content += data.token
												contentCb(data.token)
											}
										}
									} catch (e) {
										// Ignore parse errors
									}
								}
							}
						}
					} catch (e: any) {
						if (e.name !== "AbortError") {
							contentCb("FAILURE: " + (e.message || String(e)))
						}
					}
				},
				compiledPrompt,
				isAborted: this.isAborting
			}
		} else {
			// Non-streaming request
			this.abortController = new AbortController()

			try {
				const endpoint = useChat
					? `${baseUrl}/v1/chat/completions`
					: `${baseUrl}/api/v1/generate`

				const response = await fetch(endpoint, {
					method: "POST",
					headers: {
						"Content-Type": "application/json"
					},
					body: JSON.stringify(requestBody),
					signal: this.abortController.signal
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
						`KoboldCpp API error: ${response.status} ${error}`
					)
				}

				const data = await response.json()

				let content: string
				if (useChat) {
					// OpenAI chat format response
					content = data.choices?.[0]?.message?.content || ""
				} else {
					// KoboldCpp text format response
					content = data.results?.[0]?.text || ""
				}

				return {
					completionResult: content,
					compiledPrompt,
					isAborted: false
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
	}
}

// Connection test function
async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string }> {
	try {
		const baseUrl = connection.baseUrl || "http://localhost:5001"
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
				error: "Invalid response from KoboldCpp server"
			}
		}

		return { ok: true }
	} catch (e: any) {
		return {
			ok: false,
			error: e.message || "Failed to connect to KoboldCpp server"
		}
	}
}

// List models function
async function listModels(
	connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	try {
		const baseUrl = connection.baseUrl || "http://localhost:5001"

		// First, get the currently loaded model
		const currentModelResponse = await fetch(`${baseUrl}/api/v1/model`, {
			method: "GET",
			headers: {
				"Content-Type": "application/json"
			},
			signal: AbortSignal.timeout(5000)
		})

		let currentModel = "No model loaded"
		if (currentModelResponse.ok) {
			const data = await currentModelResponse.json()
			currentModel = data.result || "No model loaded"
		}

		// Only query the admin API for .kcpps config files when the manager is enabled.
		// When the manager is disabled, KoboldCPP may not be running or may not have
		// admin mode active, so skip this call to avoid spurious errors.
		const settings = await db.query.koboldCppSettings.findFirst()
		const managerEnabled = settings?.koboldCppManagerEnabled ?? false

		let availableModels: string[] = []
		if (managerEnabled) {
			const availableModelsResponse = await fetch(
				`${baseUrl}/api/admin/list_options`,
				{
					method: "GET",
					headers: {
						"Content-Type": "application/json"
					},
					signal: AbortSignal.timeout(5000)
				}
			)
			if (availableModelsResponse.ok) {
				availableModels = await availableModelsResponse.json()
			}
		}

		// Combine the results
		const models = []

		// Add currently loaded model first
		models.push({
			id: "[current]",
			name: `Currently Loaded: ${currentModel}`,
			object: "model",
			isCurrent: true
		})

		// Add available .kcpps files (only populated when manager is enabled)
		for (const filename of availableModels) {
			models.push({
				id: filename,
				name: filename,
				object: "model",
				isCurrent: false
			})
		}

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
