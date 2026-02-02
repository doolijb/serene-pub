import Handlebars from "handlebars"
import _ from "lodash"
import { StopStrings } from "../utils/StopStrings"
import { Ollama, type ChatRequest, type GenerateRequest } from "ollama"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { TokenCounters } from "../utils/TokenCounterManager"
import {
	BaseConnectionAdapter,
	type AdapterExports,
	type BasePromptChat
} from "./BaseConnectionAdapter"
import { type CompiledPrompt } from "../utils/promptBuilder"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { ollamaSamplingKeyMap } from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"

class OllamaAdapter extends BaseConnectionAdapter {
	private _client?: Ollama
	private _tokenCounter?: TokenCounters

	constructor({
		connection,
		sampling,
		contextConfig,
		promptConfig,
		chat,
		currentCharacterId,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent,
		isAssistantMode,
		generatingMessageMetadata
	}: {
		connection: SelectConnection
		sampling: SelectSamplingConfig
		contextConfig: SelectContextConfig
		promptConfig: SelectPromptConfig
		chat: BasePromptChat
		currentCharacterId: number | null
		tokenCounter?: TokenCounters
		tokenLimit?: number
		contextThresholdPercent?: number
		isAssistantMode?: boolean
		generatingMessageMetadata?: any
	}) {
		super({
			connection,
			sampling,
			contextConfig,
			promptConfig,
			chat,
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
			isAssistantMode,
			generatingMessageMetadata
		})
	}

	mapSamplingConfig(): Record<string, any> {
		const result: Record<string, any> = {}
		for (const [key, value] of Object.entries(this.sampling)) {
			if (key.endsWith("Enabled")) continue
			const enabledKey = key + "Enabled"
			if ((this.sampling as any)[enabledKey] === false) continue
			if (ollamaSamplingKeyMap[key]) {
				if (key === "streaming") continue
				result[ollamaSamplingKeyMap[key]] = value
			}
		}
		return result
	}

	getClient() {
		if (!this._client) {
			const host = this.connection.baseUrl ?? undefined
			this._client = new Ollama({ host: host ?? undefined })
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
		const useChatFormat = !!this.connection.extraJson?.useChat
		console.log(
			"[OllamaAdapter.compilePrompt] connection.extraJson:",
			this.connection.extraJson
		)
		console.log(
			"[OllamaAdapter.compilePrompt] useChat value:",
			this.connection.extraJson?.useChat
		)
		console.log(
			"[OllamaAdapter.compilePrompt] useChatFormat:",
			useChatFormat
		)
		return super.compilePrompt({
			useChatFormat,
			...args
		})
	}

	async generate(): Promise<{
		completionResult:
			| string
			| ((cb: (chunk: string) => void) => Promise<void>)
		compiledPrompt: CompiledPrompt
		isAborted: boolean
	}> {
		const model =
			this.connection.model ??
			CONNECTION_DEFAULTS[CONNECTION_TYPE.OLLAMA].baseUrl
		const stream = this.connection!.extraJson?.stream || false
		const think = this.connection!.extraJson?.think || false
		const keep_alive = this.connection!.extraJson?.keepAlive || "300ms"
		if (typeof model !== "string")
			throw new Error("OllamaAdapter: model must be a string")

		// Prepare stop strings for Ollama
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
		const stop = stopStrings.map((str) =>
			Handlebars.compile(str)(stopContext)
		)

		// Use PromptBuilder for prompt construction

		const compiledPrompt: CompiledPrompt = await this.compilePrompt({})

		console.log(
			"[OllamaAdapter] useChat:",
			this.connection.extraJson?.useChat
		)
		console.log(
			"[OllamaAdapter] compiledPrompt has messages:",
			!!compiledPrompt.messages
		)
		console.log(
			"[OllamaAdapter] compiledPrompt has prompt:",
			!!compiledPrompt.prompt
		)

		const useChat = this.connection.extraJson?.useChat ?? true
		console.log("[OllamaAdapter] useChat after coalescing:", useChat)
		let req: GenerateRequest | ChatRequest

		if (useChat) {
			if (!compiledPrompt.messages) {
				console.error(
					"[OllamaAdapter] ERROR: useChat is true but compiledPrompt.messages is undefined!"
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
				}
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
				}
			} as GenerateRequest
		}

		console.log("OllamaAdapter generate mode request:", req)

		if (stream) {
			return {
				completionResult: async (cb: (chunk: string) => void) => {
					let content = ""
					let abortedEarly = false
					try {
						const ollama = this.getClient()

						if (useChat) {
							// Use Ollama's chat api
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
								if (this.isAborting) {
									ollama.abort()
									return
								}
								if (part.message) {
									content += part.message.content
									cb(part.message.content)
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
								if (this.isAborting) {
									ollama.abort()
									return
								}
								if (part.response) {
									content += part.response
									cb(part.response)
								}
							}
						}
						// No need to apply stop strings here, Ollama will handle it
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
				let content = ""
				try {
					const ollama = this.getClient()
					if (useChat) {
						console.log("Using non-steaming chat API")
						// Use Ollama's chat api
						const result = await ollama.chat({
							...(req as ChatRequest),
							stream: false
						})
						if (this.isAborting) {
							return undefined
						}
						if (
							result &&
							typeof result === "object" &&
							"message" in result
						) {
							content = result.message.content || ""
							// No need to apply stop strings here, Ollama will handle it
							return content
						} else {
							return "FAILURE: Unexpected Ollama result type"
						}
					} else {
						const result = await ollama.generate({
							...(req as GenerateRequest),
							stream: false
						})
						if (this.isAborting) {
							return undefined
						}
						if (
							result &&
							typeof result === "object" &&
							"response" in result
						) {
							content = result.response || ""
							// No need to apply stop strings here, Ollama will handle it
							return content
						} else {
							return "FAILURE: Unexpected Ollama result type"
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
			host: connection.baseUrl ?? undefined
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
			host: connection.baseUrl ?? undefined
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
