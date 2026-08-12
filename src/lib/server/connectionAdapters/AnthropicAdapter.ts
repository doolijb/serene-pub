import Anthropic from "@anthropic-ai/sdk"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { TokenCounters } from "../utils/TokenCounterManager"
import {
	BaseConnectionAdapter,
	type AdapterExports,
	type BasePromptChat
} from "./BaseConnectionAdapter"
import type { CompiledPrompt } from "../utils/promptBuilder"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { anthropicSamplingKeyMap } from "$lib/shared/utils/samplerMappings"
import { CONNECTION_DEFAULTS } from "$lib/shared/utils/connectionDefaults"
import { normalizeBaseUrl } from "$lib/shared/utils/normalizeBaseUrl"
import { decryptApiKeyField } from "$lib/server/utils/tokenCrypto"

// Known Claude models for listModels
const ANTHROPIC_MODELS = [
	{ id: "claude-opus-4-6", name: "Claude Opus 4.6" },
	{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
	{ id: "claude-opus-4-5", name: "Claude Opus 4.5" },
	{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
	{ id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
	{ id: "claude-3-7-sonnet-20250219", name: "Claude 3.7 Sonnet" },
	{ id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
	{ id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
	{ id: "claude-3-opus-20240229", name: "Claude 3 Opus" }
]

class AnthropicAdapter extends BaseConnectionAdapter {
	private _client?: Anthropic
	private abortController?: AbortController

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
					connection.tokenCounter ||
						TokenCounterOptions.ANTHROPIC_CLAUDE
				),
			tokenLimit:
				tokenLimit ||
				(typeof sampling.contextTokens === "number"
					? sampling.contextTokens
					: 8192),
			contextThresholdPercent: contextThresholdPercent || 0.9,
			generatingMessageMetadata
		})
	}

	getClient(): Anthropic {
		if (!this._client) {
			const apiKey =
				decryptApiKeyField(this.connection.extraJson?.apiKey) || ""
			const baseURL =
				normalizeBaseUrl(this.connection.baseUrl) || undefined
			this._client = new Anthropic({
				apiKey,
				...(baseURL ? { baseURL } : {})
			})
		}
		return this._client
	}

	mapSamplingConfig(): Record<string, any> {
		const result: Record<string, any> = {}
		for (const [key, value] of Object.entries(this.sampling)) {
			if (key.endsWith("Enabled")) continue
			const enabledKey = key + "Enabled"
			if ((this.sampling as any)[enabledKey] === false) continue
			if (anthropicSamplingKeyMap[key]) {
				result[anthropicSamplingKeyMap[key]] = value
			}
		}
		return result
	}

	/**
	 * Convert compiled prompt messages to Anthropic format.
	 * Anthropic requires: system as a separate top-level param, and
	 * messages must strictly alternate user/assistant (no consecutive same-role).
	 */
	private buildAnthropicMessages(compiledPrompt: CompiledPrompt): {
		system: string
		messages: Anthropic.MessageParam[]
	} {
		const rawMessages: { role: string; content: string }[] =
			compiledPrompt.messages || []

		let system = ""
		const messages: Anthropic.MessageParam[] = []

		for (const msg of rawMessages) {
			if (msg.role === "system") {
				system = system ? system + "\n\n" + msg.content : msg.content
				continue
			}

			const role: "user" | "assistant" =
				msg.role === "assistant" ? "assistant" : "user"

			// Merge consecutive same-role messages (Anthropic requirement)
			if (
				messages.length > 0 &&
				messages[messages.length - 1].role === role
			) {
				const last = messages[messages.length - 1]
				if (typeof last.content === "string") {
					last.content = last.content + "\n\n" + msg.content
				}
			} else {
				messages.push({ role, content: msg.content })
			}
		}

		// Anthropic requires the last message to be from user
		// If it's assistant, add a placeholder user message
		if (
			messages.length > 0 &&
			messages[messages.length - 1].role === "assistant"
		) {
			messages.push({ role: "user", content: "Please continue." })
		}

		// Must have at least one user message
		if (messages.length === 0) {
			messages.push({ role: "user", content: "Hello" })
		}

		return { system, messages }
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
		const model = this.connection.model || "claude-sonnet-4-5"
		const stream = this.connection.extraJson?.stream ?? true
		const useThinking = this.connection.extraJson?.thinking ?? false
		const thinkingBudget = this.connection.extraJson?.thinkingBudget ?? 8000

		const compiledPrompt: CompiledPrompt = await this.compilePrompt({
			useChatFormat: true
		})

		const { system, messages } = this.buildAnthropicMessages(compiledPrompt)

		const samplingConfig = this.mapSamplingConfig()
		const maxTokens: number =
			samplingConfig.max_tokens ||
			(this.sampling.responseTokensEnabled
				? this.sampling.responseTokens || 1024
				: 1024)

		// Extended thinking: requires betas header and disables temperature/top_p/top_k
		const thinkingParam: Anthropic.ThinkingConfigParam | undefined =
			useThinking
				? { type: "enabled", budget_tokens: thinkingBudget }
				: undefined

		// When thinking is enabled, sampling params are restricted
		const allowedSampling = useThinking
			? {} // temperature/top_p/top_k not allowed with extended thinking
			: {
					...(samplingConfig.temperature !== undefined
						? { temperature: samplingConfig.temperature }
						: {}),
					...(samplingConfig.top_p !== undefined
						? { top_p: samplingConfig.top_p }
						: {}),
					...(samplingConfig.top_k !== undefined
						? { top_k: samplingConfig.top_k }
						: {})
				}

		const baseParams = {
			model,
			max_tokens: maxTokens,
			messages,
			...(system ? { system } : {}),
			...(thinkingParam ? { thinking: thinkingParam } : {}),
			...allowedSampling
		}

		const client = this.getClient()
		// A fresh controller per generation — abort() below fires this, and the
		// signal is threaded into the actual SDK call so cancelling a
		// non-streaming request actually stops the in-flight HTTP call
		// instead of just flipping a flag nothing checks until the response
		// (and its real spend) has already come back.
		this.abortController = new AbortController()

		if (stream) {
			return {
				completionResult: async (
					contentCb: (chunk: string) => void,
					thinkingCb?: (chunk: string) => void
				) => {
					try {
						if (this.isAborting) return

						const streamResp = await client.messages.stream(
							{
								...baseParams,
								...(thinkingParam
									? {
											betas: [
												"interleaved-thinking-2025-05-14"
											]
										}
									: {})
							} as any,
							{ signal: this.abortController?.signal }
						)

						for await (const event of streamResp) {
							if (this.isAborting) {
								streamResp.controller.abort()
								return
							}

							if (event.type === "content_block_delta") {
								const delta = event.delta as any
								if (
									delta.type === "thinking_delta" &&
									delta.thinking
								) {
									thinkingCb?.(delta.thinking)
								} else if (
									delta.type === "text_delta" &&
									delta.text
								) {
									contentCb(delta.text)
								}
							}
						}
					} catch (e: any) {
						// An intentional abort throws too (the SDK rejects the
						// aborted request) — don't surface that as an error,
						// the caller already knows this was cancelled.
						if (this.isAborting) return
						throw e
					}
				},
				compiledPrompt,
				isAborted: this.isAborting
			}
		} else {
			try {
				if (this.isAborting) {
					return {
						completionResult: "",
						compiledPrompt,
						isAborted: true
					}
				}

				const response = await client.messages.create(
					{
						...baseParams,
						...(thinkingParam
							? { betas: ["interleaved-thinking-2025-05-14"] }
							: {})
					} as any,
					{ signal: this.abortController?.signal }
				)

				let content = ""
				let thinking = ""

				for (const block of response.content) {
					if ((block as any).type === "thinking") {
						thinking += (block as any).thinking || ""
					} else if (block.type === "text") {
						content += block.text
					}
				}

				return {
					completionResult: content,
					compiledPrompt,
					isAborted: this.isAborting,
					thinkingContent: thinking || undefined
				}
			} catch (e: any) {
				if (this.isAborting) {
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
		this.isAborting = true
		this.abortController?.abort()
	}
}

async function listModels(
	_connection: SelectConnection
): Promise<{ models: any[]; error?: string }> {
	// Anthropic doesn't have a list models endpoint; return known models
	return { models: ANTHROPIC_MODELS }
}

async function testConnection(
	connection: SelectConnection
): Promise<{ ok: boolean; error?: string }> {
	try {
		const apiKey = decryptApiKeyField(connection.extraJson?.apiKey) || ""
		if (!apiKey) {
			return { ok: false, error: "API key is required" }
		}
		const client = new Anthropic({ apiKey })
		// Cheapest possible call to verify the key works
		await client.messages.create({
			model: "claude-haiku-4-5-20251001",
			max_tokens: 1,
			messages: [{ role: "user", content: "hi" }]
		})
		return { ok: true }
	} catch (e: any) {
		return { ok: false, error: e.message || String(e) }
	}
}

const exports: AdapterExports = {
	Adapter: AnthropicAdapter,
	listModels,
	testConnection,
	connectionDefaults: CONNECTION_DEFAULTS[CONNECTION_TYPE.ANTHROPIC],
	samplingKeyMap: anthropicSamplingKeyMap
}

export default exports
