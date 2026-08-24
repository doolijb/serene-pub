import { CONNECTION_TYPE } from "../constants/ConnectionTypes"
import { PromptFormats } from "../constants/PromptFormats"
import { TokenCounterOptions } from "../constants/TokenCounters"

export const CONNECTION_DEFAULTS = {
	[CONNECTION_TYPE.OLLAMA]: {
		type: CONNECTION_TYPE.OLLAMA,
		baseUrl: "http://localhost:11434/",
		promptFormat: PromptFormats.VICUNA,
		tokenCounter: TokenCounterOptions.ESTIMATE,
		extraJson: {
			stream: true,
			think: false,
			keepAlive: "300ms",
			useSession: true
		}
	},
	[CONNECTION_TYPE.OPENAI_CHAT]: {
		type: CONNECTION_TYPE.OPENAI_CHAT,
		baseUrl: "",
		promptFormat: PromptFormats.VICUNA,
		tokenCounter: TokenCounterOptions.ESTIMATE,
		extraJson: {
			stream: true,
			prerenderPrompt: false,
			apiKey: ""
		}
	},
	[CONNECTION_TYPE.LM_STUDIO]: {
		type: CONNECTION_TYPE.LM_STUDIO,
		baseUrl: "ws://localhost:1234",
		promptFormat: PromptFormats.VICUNA,
		tokenCounter: TokenCounterOptions.ESTIMATE,
		extraJson: {
			useSession: true,
			stream: true,
			ttl: 60
		}
	},
	[CONNECTION_TYPE.LLAMACPP_COMPLETION]: {
		type: CONNECTION_TYPE.LLAMACPP_COMPLETION,
		baseUrl: "http://localhost:8080/",
		promptFormat: PromptFormats.VICUNA,
		tokenCounter: TokenCounterOptions.ESTIMATE,
		extraJson: {
			stream: true
		}
	},
	[CONNECTION_TYPE.KOBOLDCPP]: {
		type: CONNECTION_TYPE.KOBOLDCPP,
		baseUrl: "http://localhost:5001",
		apiKey: "",
		model: "koboldcpp",
		promptFormat: PromptFormats.VICUNA,
		tokenCounter: TokenCounterOptions.ESTIMATE,
		extraJson: {
			stream: true,
			useSession: true,
			useMemory: false,
			memory: "",
			// Must match KoboldCppForm.svelte's own extraJsonToExtraFields
			// defaults exactly — these 6 fields are invented by the form
			// (not read anywhere by KoboldCppAdapter.ts today), and any
			// mismatch here makes a freshly-opened connection look dirty
			// before the user has touched anything (the form's mount effect
			// writes them into `connection`, while the server-sourced
			// `originalConnection` baseline never had them).
			trimStop: true,
			renderSpecial: false,
			bypassEos: false,
			grammarRetainState: false,
			logprobs: false,
			replaceInstructPlaceholders: false,
			enableThinking: null as boolean | null
		}
	},
	[CONNECTION_TYPE.KOBOLDCPP_MANAGED]: {
		type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
		baseUrl: "http://localhost:5001",
		apiKey: "",
		model: "",
		promptFormat: PromptFormats.VICUNA,
		tokenCounter: TokenCounterOptions.ESTIMATE,
		extraJson: {
			stream: true,
			useSession: true,
			useMemory: false,
			memory: "",
			// See CONNECTION_TYPE.KOBOLDCPP above — same fix, same reason,
			// matching KoboldCppManagedForm.svelte's own defaults.
			trimStop: true,
			renderSpecial: false,
			bypassEos: false,
			grammarRetainState: false,
			logprobs: false,
			replaceInstructPlaceholders: false,
			enableThinking: null as boolean | null,
			managedConfig: {
				gpuLayers: -1,
				flashAttention: false,
				batchSize: 512
			}
		}
	},
	[CONNECTION_TYPE.ANTHROPIC]: {
		type: CONNECTION_TYPE.ANTHROPIC,
		baseUrl: "https://api.anthropic.com",
		model: "claude-sonnet-4-5",
		promptFormat: PromptFormats.OPENAI,
		tokenCounter: TokenCounterOptions.ANTHROPIC_CLAUDE,
		extraJson: {
			stream: true,
			apiKey: "",
			thinking: false,
			thinkingBudget: 8000
		}
	}
}

// OpenAI Session presets used in ConnectionsSidebar
export const OPENAI_CHAT_PRESETS = [
	{
		name: "Empty",
		value: 0,
		category: "custom",
		connectionDefaults: {
			baseUrl: "",
			promptFormat: PromptFormats.VICUNA,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "Ollama",
		value: 1,
		category: "local",
		connectionDefaults: {
			baseUrl: "http://localhost:11434/v1/",
			promptFormat: PromptFormats.VICUNA,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "OpenRouter",
		value: 3,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://openrouter.ai/api/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "OpenAI (Official)",
		value: 4,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://api.openai.com/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.OPENAI_GPT4O,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "LocalAI",
		value: 5,
		category: "local",
		connectionDefaults: {
			baseUrl: "http://localhost:8080/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "AnyScale",
		value: 6,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://api.endpoints.anyscale.com/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "Groq",
		value: 7,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://api.groq.com/openai/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "Together AI",
		value: 8,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://api.together.xyz/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "DeepInfra",
		value: 9,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://api.deepinfra.com/v1/openai/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "Fireworks AI",
		value: 10,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://api.fireworks.ai/inference/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "Perplexity AI",
		value: 11,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://api.perplexity.ai/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "KoboldCPP",
		value: 12,
		category: "local",
		connectionDefaults: {
			baseUrl: "http://localhost:5001/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	// ── Experimental presets ──────────────────────────────────────────────
	// Added from their official OpenAI-compatibility endpoints, not yet
	// verified end-to-end against a live account/server by us — the request
	// shape and auth match the documented contract, but sampler param
	// support, streaming edge cases, etc. haven't been soak-tested the way
	// the presets above have. Report issues and we'll drop "Experimental".
	{
		name: "Mistral AI (Experimental)",
		value: 13,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://api.mistral.ai/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "xAI Grok (Experimental)",
		value: 14,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://api.x.ai/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "DeepSeek (Experimental)",
		value: 15,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://api.deepseek.com/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "Google Gemini (Experimental)",
		value: 16,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "Cohere (Experimental)",
		value: 17,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://api.cohere.ai/compatibility/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "Novita AI (Experimental)",
		value: 18,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://api.novita.ai/openai/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "Featherless AI (Experimental)",
		value: 19,
		category: "cloud",
		connectionDefaults: {
			baseUrl: "https://api.featherless.ai/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "text-generation-webui (Experimental)",
		value: 20,
		category: "local",
		connectionDefaults: {
			baseUrl: "http://127.0.0.1:5000/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "vLLM (Experimental)",
		value: 21,
		category: "local",
		connectionDefaults: {
			baseUrl: "http://localhost:8000/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "SGLang (Experimental)",
		value: 22,
		category: "local",
		connectionDefaults: {
			baseUrl: "http://localhost:30000/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	},
	{
		name: "Aphrodite Engine (Experimental)",
		value: 23,
		category: "local",
		connectionDefaults: {
			baseUrl: "http://localhost:2242/v1/",
			promptFormat: PromptFormats.OPENAI,
			tokenCounter: TokenCounterOptions.ESTIMATE,
			extraJson: {
				apiKey: ""
			}
		}
	}
]

// Helper function to get connection defaults by type
export function getConnectionDefaults(type: string): Record<string, any> {
	return CONNECTION_DEFAULTS[type] || {}
}

function isPlainObject(value: unknown): value is Record<string, any> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function deepMerge<T>(base: T, override: Partial<T> | undefined | null): T {
	if (!isPlainObject(base) || !isPlainObject(override)) {
		return override === undefined ? base : (override as T)
	}
	const result: any = { ...base }
	for (const key of Object.keys(override)) {
		const overrideVal = (override as any)[key]
		if (overrideVal === undefined) continue
		result[key] =
			isPlainObject(overrideVal) && isPlainObject(result[key])
				? deepMerge(result[key], overrideVal)
				: overrideVal
	}
	return result
}

/**
 * Single source of truth for filling in a connection's missing fields with
 * its type's defaults (including nested extraJson/managedConfig fields).
 * Used both server-side, to persist backfilled defaults before a connection
 * is handed to the edit form, and by generation-time adapter code — so the
 * value a form displays always matches what generation actually falls back
 * to, instead of each side keeping its own separate copy of "the defaults."
 */
export function withConnectionDefaults<T extends { type: string }>(
	connection: T
): T {
	const defaults =
		CONNECTION_DEFAULTS[connection.type as keyof typeof CONNECTION_DEFAULTS]
	if (!defaults) return connection
	return deepMerge(defaults as any, connection as any)
}

/**
 * A JSON.stringify whose output doesn't depend on object key insertion
 * order — used to compare connection records for "did backfilling actually
 * change anything" (server) and "are there real unsaved changes" (client),
 * since plain JSON.stringify treats two logically-identical objects with
 * differently-ordered keys as different strings.
 */
export function stableStringify(value: any): string {
	if (value === null || typeof value !== "object")
		return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
	const keys = Object.keys(value).sort()
	return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`
}
