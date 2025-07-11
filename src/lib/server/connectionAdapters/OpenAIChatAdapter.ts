import { BaseConnectionAdapter, type AdapterExports } from "./BaseConnectionAdapter"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { TokenCounters } from "../utils/TokenCounterManager"
import { OpenAI } from "openai"
import { StopStrings } from "../utils/StopStrings"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"
import type {
	ChatCompletionCreateParamsBase,
	ChatCompletionMessageParam
} from "../../../../node_modules/openai/src/resources/chat/completions/completions"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

export class OpenAIChatAdapter extends BaseConnectionAdapter {
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
			tokenLimit:
				typeof sampling.contextTokens === "number"
					? sampling.contextTokens
					: 4096,
			contextThresholdPercent: 0.9
		})
	}

	compilePrompt(args: {}) {
		let useChatFormat = true
		if (this.connection.extraJson?.prerenderPrompt) {
			useChatFormat = false
		}
		return super.compilePrompt({ useChatFormat, ...args })
	}

	async generate(): Promise<
		{
			completionResult: string | ((cb: (chunk: string) => void) => Promise<void>),
			compiledPrompt: CompiledPrompt,
			isAborted: boolean
		}
	> {
		const apiKey = this.connection.extraJson?.apiKey
		const baseURL =
			this.connection.baseUrl || connectionDefaults.baseUrl
		const model = this.connection.model || "gpt-3.5-turbo"
		const stream = this.connection.extraJson?.stream || false
		const compiledPrompt: CompiledPrompt =
			await this.compilePrompt({})

		// Configure messages
		let messages: Array<ChatCompletionMessageParam> = []
		const prompt = compiledPrompt.prompt || ""
		if (compiledPrompt.prompt) {
			messages = [{ role: "user", content: prompt }]
		} else if (compiledPrompt.messages) {
			messages = compiledPrompt.messages
		}

		// Minimal params for debugging
		const params: ChatCompletionCreateParamsBase = {
			model,
			messages,
			max_tokens: this.sampling.responseTokensEnabled
				? this.sampling.responseTokens || 2048
				: 2048
		}

		const promptFormat = this.connection?.extraJson?.prerenderPrompt
			? this.connection.promptFormat || "chatml"
			: PromptFormats.OPENAI

		// Add stop string if present in connection or sampling
		params["stop"] =
			StopStrings.get({
				format: promptFormat,
				characters: this.chat.chatCharacters?.map((cc) => cc.character),
				personas: this.chat.chatPersonas?.map((cp) => cp.persona),
				currentCharacterId: this.currentCharacterId
			}) || []

		const openaiClient = new OpenAI({
			apiKey,
			baseURL: baseURL || undefined
		})

		try {
			if (stream) {
				return {
					completionResult:async (cb: (chunk: string) => void) => {
						const streamResp =
							await openaiClient.chat.completions.create({
								...params,
								stream: true
							})
						for await (const part of streamResp as any) {
							if (this.isAborting) break
							if (
								part.choices &&
								part.choices[0] &&
								part.choices[0].delta &&
								part.choices[0].delta.content
							) {
								cb(part.choices[0].delta.content)
							}
						}
					},
					compiledPrompt,
					isAborted: this.isAborting
				}
			} else {
				const response =
					await openaiClient.chat.completions.create(params)
				let content = ""
				if (
					response.choices &&
					response.choices[0] &&
					response.choices[0].message
				) {
					content = response.choices[0].message.content || ""
				}
				return {completionResult: content, compiledPrompt, isAborted: this.isAborting}
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
			if (err?.error?.provider_name) {
				errorMsg += ` Provider: ${err.error.provider_name}`
			}
			throw new Error(errorMsg)
		}
	}

	mapSamplingConfig(): Record<string, any> {
		const result: Record<string, any> = {}
		for (const [key, value] of Object.entries(this.sampling)) {
			if (key.endsWith("Enabled")) continue
			const enabledKey = key + "Enabled"
			if ((this.sampling as any)[enabledKey] === false) continue
			// Map to OpenAI parameter names if needed
			result[key] = value
		}
		return result
	}

	abort() {
		this.isAborting = true
		// TODO: OpenAI does not support aborting requests directly.
	}
}

const connectionDefaults = {
	type: CONNECTION_TYPE.OPENAI_CHAT,
	baseUrl: "",
	promptFormat: PromptFormats.VICUNA,
	tokenCounter: TokenCounterOptions.ESTIMATE,
	extraJson: {
		stream: true,
		prerenderPrompt: false,
		apiKey: ""
	}
}

const samplingKeyMap: Record<string, string> = {
	temperature: "temperature",
	topP: "top_p",
	topK: "top_k",
	frequencyPenalty: "frequency_penalty",
	presencePenalty: "presence_penalty",
	responseTokens: "max_tokens",
	stop: "stop",
	logitBias: "logit_bias",
	seed: "seed"
}

async function listModels(
	connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	try {
		const apiKey = connection.extraJson?.apiKey
		const baseURL =
			connection.baseUrl || connectionDefaults.baseUrl
		const openai = new OpenAI({
			apiKey,
			baseURL: baseURL || undefined
		})
		const res = await openai.models.list()
		if (res && Array.isArray(res.data)) {
			return { models: res.data }
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
		const apiKey = connection.extraJson?.apiKey
		const baseURL =
			connection.baseUrl || connectionDefaults.baseUrl
		const openai = new OpenAI({
			apiKey,
			baseURL: baseURL || undefined
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
	connectionDefaults,
	samplingKeyMap
}

export default exports
