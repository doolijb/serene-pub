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
			// No sdModelFile here, deliberately — a connection names exactly ONE
			// model, and this one names a text GGUF. An image model riding along
			// in the same row would be a second model on a row that has no way
			// to say which of the two `connection.model` means, which is the
			// shape KOBOLDCPP_MANAGED_IMAGE exists to replace. What is RESIDENT
			// in the process at any moment is the model manager's business
			// (planResidency), not this row's.
			managedConfig: {
				gpuLayers: -1,
				flashAttention: false,
				batchSize: 512
			}
		}
	},
	[CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE]: {
		type: CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE,
		// Display only, and the same value the managed text type carries: this
		// type never reads its own baseUrl. The Manager's settings are
		// authoritative for where the process actually is, which is why both the
		// render path (dispatchImage.resolveBaseUrl) and the adapter's own
		// testConnection resolve it from there instead.
		baseUrl: "http://localhost:5001",
		// What `withConnectionDefaults` writes into `connections.modality`, which
		// is what shapeOfModality and the sidebar's Text/Image filter read.
		modality: "image-gen",
		// The image model this connection names. Empty until one is picked —
		// either in the Manager ("Use for image generation") or from the
		// Checkpoint list the form's Test button fills in.
		model: "",
		// No `profile` block, unlike managedConfig above — and the same choice
		// A1111 makes below. The image load knobs (sdThreads/sdQuant) live in
		// `extraJson.profile`, whose defaults are declared by the adapter
		// (KoboldCppManagedImageAdapter) and materialised into the row by
		// ImageConnectionForm, so a second copy here could only ever disagree
		// with the schema that renders it.
		extraJson: {
			apiKey: ""
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
	},
	[CONNECTION_TYPE.A1111]: {
		type: CONNECTION_TYPE.A1111,
		// KoboldCPP's port, since that is the quickest of the four to get running
		// and the app already manages it. An image connection, so no prompt-format
		// or token-counter — those are text-only concerns.
		baseUrl: "http://localhost:5001",
		modality: "image-gen",
		extraJson: {
			apiKey: ""
		}
	}
}

/**
 * OpenAI Session presets used in ConnectionsSidebar.
 *
 * ## `slug`
 *
 * A stable key into `PRESET_CAPABILITIES` (connectionAdapters/manifest.ts), and
 * the only reason the preset layer of capability resolution ever fires. It is
 * NOT `value`: that is a display-order integer which would key nothing while
 * looking like it should, and it is not `name` either, which is a label people
 * rename.
 *
 * The slug is what stores "this connection is OpenRouter" on the row, which is
 * what lets its defaults be recomputed on edit and what "reset to preset
 * defaults" resets to. A preset with no capability entry needs no slug — absent
 * means "custom", which is the correct answer for a bare OpenAI-compatible URL
 * and for every row that predates this column.
 *
 * Adding a slug here without a matching key in `PRESET_CAPABILITIES` is
 * harmless; adding capabilities there without a slug here is what makes them
 * dead data, so add the pair together.
 */
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
		slug: "openrouter",
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
		slug: "openai-official",
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
		slug: "local-ai",
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
		slug: "groq",
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
		slug: "together-ai",
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
		slug: "mistral-ai",
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
		slug: "deepseek",
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
		slug: "google-gemini",
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
		slug: "text-generation-webui",
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
		slug: "vllm",
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
		slug: "sglang",
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
		slug: "aphrodite-engine",
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

/**
 * A preset slug's human name, for a sentence that has to say who decided
 * something — "The OpenRouter preset sets this", on the capability panel.
 *
 * Falls back to the slug itself rather than to an anonymous "a preset":
 * `PRESET_CAPABILITIES` can key a slug this list never offers (`anthropic` does
 * today, per the docblock above), and a name nobody recognises still answers
 * "who decided this" better than no name at all.
 */
export function presetLabel(slug: string | null | undefined): string {
	if (!slug) return "custom"
	return (
		OPENAI_CHAT_PRESETS.find((p) => (p as { slug?: string }).slug === slug)
			?.name ?? slug
	)
}

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
