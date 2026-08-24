import {
	BaseConnectionAdapter,
	type AdapterExports,
	type BasePromptSession
} from "./BaseConnectionAdapter"
import { type CompiledPrompt } from "./types"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { TokenCounters } from "../utils/TokenCounterManager"
import { OpenAI } from "openai"
import { StopStrings } from "../utils/StopStrings"
import { PromptFormats } from "$lib/shared/constants/PromptFormats"
import type {
	ChatCompletionCreateParamsBase,
	ChatCompletionMessageParam
} from "openai/resources/chat/completions/completions"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { openAISamplingKeyMap } from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"

export class OpenAIChatAdapter extends BaseConnectionAdapter {
	private abortController?: AbortController

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
		sampling: SelectSamplingConfig
		contextConfig: SelectContextConfig
		promptConfig: SelectPromptConfig
		session: BasePromptSession
		currentCharacterId?: number | null
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
			currentCharacterId: currentCharacterId ?? null,
			tokenCounter:
				tokenCounter ||
				new TokenCounters(
					connection.tokenCounter || TokenCounterOptions.ESTIMATE
				),
			tokenLimit:
				tokenLimit ||
				(typeof sampling.contextTokens === "number"
					? sampling.contextTokens
					: 4096),
			contextThresholdPercent: contextThresholdPercent || 0.9,
			generatingMessageMetadata
		})
	}

	compilePrompt(args: {}) {
		let useSessionFormat = true
		if (this.connection.extraJson?.prerenderPrompt) {
			useSessionFormat = false
		}
		return super.compilePrompt({ useSessionFormat, ...args })
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
		const apiKey = decryptApiKeyField(this.connection.extraJson?.apiKey)
		const baseURL =
			normalizeBaseUrl(this.connection.baseUrl) ||
			normalizeBaseUrl(
				CONNECTION_DEFAULTS[CONNECTION_TYPE.OPENAI_CHAT].baseUrl
			)
		const model = this.connection.model || "gpt-3.5-turbo"
		const stream = this.connection.extraJson?.stream || false
		const compiledPrompt: CompiledPrompt = await this.compilePrompt({})

		// Configure messages
		let messages: Array<ChatCompletionMessageParam> = []
		const prompt = compiledPrompt.prompt || ""
		if (compiledPrompt.prompt) {
			messages = [{ role: "user", content: prompt }]
		} else if (compiledPrompt.messages) {
			messages = compiledPrompt.messages
		}

		const params: ChatCompletionCreateParamsBase = {
			model,
			messages,
			...this.mapSamplingConfig(),
			// Several OpenAI-compatible backends reject json_object mode unless
			// the word "JSON" appears somewhere in the prompt. Every caller that
			// sets responseFormat here sends a prompt whose first line states
			// the JSON contract, so this holds — but it is a real constraint on
			// those prompts, not an incidental detail.
			// With a schema this upgrades to json_schema mode. `strict: true` is
			// safe here because jsonSchemaToGbnf's contract already requires
			// what strict mode requires — additionalProperties:false and every
			// property listed in `required` — so a schema that reaches this
			// line has necessarily satisfied both.
			//
			// Backends vary: the OpenAI-compatible zoo supports json_object far
			// more widely than json_schema, so this is the one adapter where a
			// schema may be rejected by a server that accepts plain JSON mode.
			...(this.responseFormat === "json"
				? this.responseSchema
					? {
							response_format: {
								type: "json_schema" as const,
								json_schema: {
									name: "response",
									strict: true,
									schema: this.responseSchema
								}
							}
						}
					: { response_format: { type: "json_object" as const } }
				: {})
		}

		const promptFormat = this.connection?.extraJson?.prerenderPrompt
			? this.connection.promptFormat || "chatml"
			: PromptFormats.OPENAI

		// In native session completion mode (no pre-rendered template), don't send role-label
		// stop strings — they override the model's native stop tokens (e.g. <|im_end|> for
		// ChatML models like Qwen) in servers such as Ollama's OpenAI compatibility layer.
		// Only apply stop strings when pre-rendering, where role labels are plain text.
		params["stop"] = this.connection?.extraJson?.prerenderPrompt
			? StopStrings.get({
					format: promptFormat,
					characters:
						this.session.sessionCharacters?.map(
							(cc) => cc.character
						) || [],
					personas:
						this.session.sessionPersonas?.map((cp) => cp.persona) ||
						[],
					currentCharacterId: this.currentCharacterId ?? undefined
				}) || []
			: []

		const openaiClient = new OpenAI({
			apiKey,
			baseURL: baseURL || undefined,
			defaultHeaders: {
				"User-Agent": "Mozilla/5.0 (compatible; SerenePub/1.0)"
			}
		})

		this.abortController = new AbortController()

		try {
			if (stream) {
				return {
					completionResult: async (
						contentCb: (chunk: string) => void,
						_thinkingCb?: (chunk: string) => void
					) => {
						const streamResp =
							await openaiClient.chat.completions.create(
								{ ...params, stream: true },
								{ signal: this.abortController?.signal }
							)
						for await (const part of streamResp as any) {
							if (this.isAborting) break
							if (
								part.choices &&
								part.choices[0] &&
								part.choices[0].delta &&
								part.choices[0].delta.content
							) {
								contentCb(part.choices[0].delta.content)
							}
						}
					},
					compiledPrompt,
					isAborted: this.isAborting
				}
			} else {
				const response = await openaiClient.chat.completions.create(
					{ ...params, stream: false },
					{ signal: this.abortController?.signal }
				)
				let content = ""
				if (
					response.choices &&
					response.choices[0] &&
					response.choices[0].message
				) {
					content = response.choices[0].message.content || ""
				}
				return {
					completionResult: content,
					compiledPrompt,
					isAborted: this.isAborting
				}
			}
		} catch (err: any) {
			console.error(
				"[OpenAIAdapter] Error from openai.session.completions.create:",
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
			if (openAISamplingKeyMap[key]) {
				result[openAISamplingKeyMap[key]] = value
			}
		}
		return result
	}

	abort() {
		this.isAborting = true
		this.abortController?.abort()
	}
}

async function listModels(
	connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	try {
		const apiKey = decryptApiKeyField(connection.extraJson?.apiKey)
		const baseURL =
			normalizeBaseUrl(connection.baseUrl) ||
			normalizeBaseUrl(
				CONNECTION_DEFAULTS[CONNECTION_TYPE.OPENAI_CHAT].baseUrl
			)
		const openai = new OpenAI({
			apiKey,
			baseURL: baseURL || undefined,
			defaultHeaders: {
				"User-Agent": "Mozilla/5.0 (compatible; SerenePub/1.0)"
			}
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
		const apiKey = decryptApiKeyField(connection.extraJson?.apiKey)
		const baseURL =
			normalizeBaseUrl(connection.baseUrl) ||
			normalizeBaseUrl(
				CONNECTION_DEFAULTS[CONNECTION_TYPE.OPENAI_CHAT].baseUrl
			)
		const openai = new OpenAI({
			apiKey,
			baseURL: baseURL || undefined,
			defaultHeaders: {
				"User-Agent": "Mozilla/5.0 (compatible; SerenePub/1.0)"
			}
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
	connectionDefaults: CONNECTION_DEFAULTS[CONNECTION_TYPE.OPENAI_CHAT],
	samplingKeyMap: openAISamplingKeyMap
}

export default exports
