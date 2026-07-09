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
			useChat: true
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
			useChat: true,
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
			useChat: true,
			useMemory: false,
			memory: "",
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
			useChat: true,
			useMemory: false,
			memory: "",
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

// OpenAI Chat presets used in ConnectionsSidebar
export const OPENAI_CHAT_PRESETS = [
	{
		name: "Empty",
		value: 0,
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
		connectionDefaults: {
			baseUrl: "http://localhost:5001/v1/",
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
