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
	type BaseChat
} from "./BaseConnectionAdapter"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

class OllamaAdapter extends BaseConnectionAdapter {
	private _client?: Ollama
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
		chat: BaseChat
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
					: 2048,
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
				result[samplingKeyMap[key]] = value
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
		return super.compilePrompt({
			useChatFormat: !!this.connection.extraJson?.useChat,
			...args
		})
	}

	async generate(): Promise<
		{
			completionResult: string | ((cb: (chunk: string) => void) => Promise<void>),
			compiledPrompt: CompiledPrompt,
			isAborted: boolean
		}
	> {
		const model = this.connection.model ?? connectionDefaults.baseUrl
		const stream = this.connection!.extraJson?.stream || false
		const think = this.connection!.extraJson?.think || false
		const keep_alive = this.connection!.extraJson?.keepAlive || "300ms"
		// const raw = this.connection!.extraJson?.raw || false
		if (typeof model !== "string")
			throw new Error("OllamaAdapter: model must be a string")

		// Prepare stop strings for Ollama
		const stopStrings = StopStrings.get({
			format: this.connection.promptFormat || "chatml",
			characters:
				this.chat.chatCharacters?.map((cc) => cc.character) || [],
			personas: this.chat.chatPersonas?.map((cp) => cp.persona) || [],
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

		const useChat = this.connection.extraJson?.useChat || true
		let req: GenerateRequest | ChatRequest

		if (useChat) {
			req = {
				model,
				messages: compiledPrompt.messages!,
				stream,
				think,
				raw: false,
				keep_alive,
				options: {
					...this.mapSamplingConfig(),
					stop,
					useChat: this.connection.extraJson?.useChat || true
				}
			} as ChatRequest
		} else {
			req = {
				model,
				prompt: compiledPrompt.prompt!,
				stream,
				think,
				raw: true,
				keep_alive,
				options: {
					...this.mapSamplingConfig(),
					stop
				}
			} as GenerateRequest
		}

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
			return {completionResult: content ?? "", compiledPrompt, isAborted: this.isAborting}
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

const connectionDefaults = {
	type: CONNECTION_TYPE.OLLAMA,
	baseUrl: "http://localhost:11434/",
	promptFormat: PromptFormats.VICUNA,
	tokenCounter: TokenCounterOptions.ESTIMATE,
	extraJson: {
		stream: true,
		think: false,
		keepAlive: "300ms",
		raw: true,
		useChat: true
	}
}

// --- SamplingConfig mapping ---
const samplingKeyMap: Record<string, string> = {
	temperature: "temperature",
	topP: "top_p",
	topK: "top_k",
	repetitionPenalty: "repetition_penalty",
	minP: "min_p",
	tfs: "tfs",
	typicalP: "typical_p",
	mirostat: "mirostat",
	mirostatTau: "mirostat_tau",
	mirostatEta: "mirostat_eta",
	penaltyAlpha: "penalty_alpha",
	frequencyPenalty: "frequency_penalty",
	presencePenalty: "presence_penalty",
	responseTokens: "num_predict",
	contextTokens: "num_ctx",
	noRepeatNgramSize: "no_repeat_ngram_size",
	numBeams: "num_beams",
	lengthPenalty: "length_penalty",
	minLength: "min_length",
	encoderRepetitionPenalty: "encoder_repetition_penalty",
	freqPen: "freq_pen",
	presencePen: "presence_pen",
	skew: "skew",
	doSample: "do_sample",
	earlyStopping: "early_stopping",
	dynatemp: "dynatemp",
	minTemp: "min_temp",
	maxTemp: "max_temp",
	dynatempExponent: "dynatemp_exponent",
	smoothingFactor: "smoothing_factor",
	smoothingCurve: "smoothing_curve",
	dryAllowedLength: "dry_allowed_length",
	dryMultiplier: "dry_multiplier",
	dryBase: "dry_base",
	dryPenaltyLastN: "dry_penalty_last_n",
	maxTokensSecond: "max_tokens_second",
	seed: "seed",
	addBosToken: "add_bos_token",
	banEosToken: "ban_eos_token",
	skipSpecialTokens: "skip_special_tokens",
	includeReasoning: "include_reasoning",
	streaming: "streaming", // Not sent to Ollama, handled separately
	mirostatMode: "mirostat_mode",
	xtcThreshold: "xtc_threshold",
	xtcProbability: "xtc_probability",
	nsigma: "nsigma",
	speculativeNgram: "speculative_ngram",
	guidanceScale: "guidance_scale",
	etaCutoff: "eta_cutoff",
	epsilonCutoff: "epsilon_cutoff",
	repPenRange: "rep_pen_range",
	repPenDecay: "rep_pen_decay",
	repPenSlope: "rep_pen_slope",
	logitBias: "logit_bias",
	bannedTokens: "banned_tokens"
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
			// console.log("Ollama listModels response:", res)
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
			// console.log("Ollama testConnection response:", res)
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
	connectionDefaults,
	samplingKeyMap
}

export default exports
