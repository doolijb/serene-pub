import { CONNECTION_TYPE } from "../constants/ConnectionTypes"

// OpenAI sampling key mappings
export const openAISamplingKeyMap: Record<string, string> = {
	// Core sampling parameters
	temperature: "temperature",
	topP: "top_p",
	seed: "seed",

	// Penalty parameters
	frequencyPenalty: "frequency_penalty",
	presencePenalty: "presence_penalty",

	// Generation control
	responseTokens: "max_tokens",
	logitBias: "logit_bias"
}

// Ollama sampling key mappings
export const ollamaSamplingKeyMap: Record<string, string> = {
	// Core sampling parameters
	temperature: "temperature",
	topP: "top_p",
	topK: "top_k",
	seed: "seed",

	// Repetition control
	repetitionPenalty: "repeat_penalty",
	repeatLastN: "repeat_last_n",

	// Min-P sampling
	minP: "min_p",

	// Tail Free Sampling
	tfsZ: "tfs_z",

	// Mirostat sampling
	mirostat: "mirostat",
	mirostatTau: "mirostat_tau",
	mirostatEta: "mirostat_eta",

	// Generation limits
	responseTokens: "num_predict",
	contextTokens: "num_ctx"
}

// LM Studio sampling key mappings
export const lmStudioSamplingKeyMap: Record<string, string> = {
	// Core sampling parameters
	temperature: "temperature",
	topP: "top_p",
	topK: "top_k",
	minP: "min_p",
	seed: "seed",

	// Repetition control
	repetitionPenalty: "repetition_penalty",
	frequencyPenalty: "frequency_penalty",
	presencePenalty: "presence_penalty",

	// Tail Free Sampling
	tfsZ: "tfs_z",

	// Typical sampling
	typicalP: "typical_p",

	// Generation limits
	responseTokens: "max_tokens",
	contextTokens: "max_context_length",

	// Stop sequences
	stop: "stop"
}

// Llama.cpp sampling key mappings
export const llamaCppSamplingKeyMap: Record<string, string> = {
	// Core sampling parameters
	temperature: "temperature",
	topP: "top_p",
	topK: "top_k",
	minP: "min_p",
	seed: "seed",

	// Tail Free Sampling
	tfsZ: "tfs_z",

	// Typical sampling
	typicalP: "typical_p",

	// Mirostat sampling
	mirostat: "mirostat",
	mirostatTau: "mirostat_tau",
	mirostatEta: "mirostat_eta",

	// Repetition control
	repetitionPenalty: "repeat_penalty",
	repeatLastN: "repeat_last_n",
	penalizeNewline: "penalize_newline",
	frequencyPenalty: "frequency_penalty",
	presencePenalty: "presence_penalty",

	// DRY (Don't Repeat Yourself) sampling
	dryMultiplier: "dry_multiplier",
	dryBase: "dry_base",
	dryAllowedLength: "dry_allowed_length",
	dryPenaltyLastN: "dry_penalty_last_n",
	drySequenceBreakers: "dry_sequence_breakers",

	// XTC (Exclude Top Choices) sampling
	xtcProbability: "xtc_probability",
	xtcThreshold: "xtc_threshold",

	// Dynamic temperature
	dynatempRange: "dynatemp_range",
	dynatempExponent: "dynatemp_exponent",

	// Generation control
	responseTokens: "n_predict",
	contextTokens: "n_ctx",
	logitBias: "logit_bias",
	stop: "stop"
}

// KoboldCpp sampling key mappings
export const koboldCppSamplingKeyMap: Record<string, string> = {
	// Core sampling parameters
	temperature: "temperature",
	topP: "top_p",
	topK: "top_k",
	minP: "min_p",
	seed: "sampler_seed",

	// Tail Free Sampling
	tfsZ: "tfs",

	// Typical sampling
	typicalP: "typical",

	// Top-A sampling (KoboldCpp specific)
	topA: "top_a",

	// Mirostat sampling
	mirostat: "mirostat",
	mirostatTau: "mirostat_tau",
	mirostatEta: "mirostat_eta",

	// Repetition control
	repetitionPenalty: "rep_pen",
	repeatLastN: "rep_pen_range",

	// Dynamic temperature
	dynatempRange: "dynatemp_range",
	dynatempExponent: "dynatemp_exponent",

	// Smoothing factor (KoboldCpp specific)
	smoothingFactor: "smoothing_factor",

	// DRY (Don't Repeat Yourself) sampling
	dryMultiplier: "dry_multiplier",
	dryBase: "dry_base",
	dryAllowedLength: "dry_allowed_length",
	drySequenceBreakers: "dry_sequence_breakers",

	// XTC (Exclude Top Choices) sampling
	xtcProbability: "xtc_probability",
	xtcThreshold: "xtc_threshold",

	// N-Sigma sampling (KoboldCpp specific)
	nsigma: "nsigma",

	// Generation limits
	responseTokens: "max_length",
	contextTokens: "max_context_length",

	// Stop sequences
	stop: "stop_sequence",

	// Logit bias
	logitBias: "logit_bias",

	// Banned tokens
	bannedTokens: "banned_tokens"
}

// Anthropic sampling key mappings
export const anthropicSamplingKeyMap: Record<string, string> = {
	// Core sampling parameters
	temperature: "temperature",
	topP: "top_p",
	topK: "top_k",

	// Generation limits
	responseTokens: "max_tokens"
}

// Get sampling key map by connection type
export function getSamplingKeyMap(
	connectionType: string
): Record<string, string> {
	switch (connectionType) {
		case CONNECTION_TYPE.OPENAI_CHAT:
			return openAISamplingKeyMap
		case CONNECTION_TYPE.OLLAMA:
			return ollamaSamplingKeyMap
		case CONNECTION_TYPE.LM_STUDIO:
			return lmStudioSamplingKeyMap
		case CONNECTION_TYPE.LLAMACPP_COMPLETION:
			return llamaCppSamplingKeyMap
		case CONNECTION_TYPE.KOBOLDCPP:
		case CONNECTION_TYPE.KOBOLDCPP_MANAGED:
			return koboldCppSamplingKeyMap
		case CONNECTION_TYPE.ANTHROPIC:
			return anthropicSamplingKeyMap
		default:
			return {}
	}
}

// Get supported samplers for a connection type
export function getSupportedSamplers(connectionType: string): Set<string> {
	const keyMap = getSamplingKeyMap(connectionType)
	return new Set(Object.keys(keyMap))
}

// Check if a sampler is supported by a connection type
export function isSamplerSupported(
	connectionType: string,
	samplerKey: string
): boolean {
	const supported = getSupportedSamplers(connectionType)
	return supported.has(samplerKey)
}

// Sampler metadata for UI display
export const samplerMetadata: Record<
	string,
	{
		label: string
		description: string
		type: "number" | "boolean" | "array" | "object"
		min?: number
		max?: number
		step?: number
		default?: any
	}
> = {
	// Core sampling parameters
	temperature: {
		label: "Temperature",
		description:
			"Controls randomness in generation (0 = deterministic, higher = more random)",
		type: "number",
		min: 0,
		max: 2,
		step: 0.01,
		default: 1
	},
	topP: {
		label: "Top P",
		description:
			"Nucleus sampling - keeps tokens whose cumulative probability exceeds this threshold",
		type: "number",
		min: 0,
		max: 1,
		step: 0.01,
		default: 1
	},
	topK: {
		label: "Top K",
		description: "Limits token selection to K most likely tokens",
		type: "number",
		min: 0,
		max: 200,
		step: 1,
		default: 40
	},
	minP: {
		label: "Min P",
		description: "Minimum probability threshold for token selection",
		type: "number",
		min: 0,
		max: 1,
		step: 0.01,
		default: 0.05
	},
	seed: {
		label: "Seed",
		description: "Random seed for reproducible generation (-1 = random)",
		type: "number",
		min: -1,
		max: 2147483647,
		step: 1,
		default: -1
	},

	// Repetition control
	repetitionPenalty: {
		label: "Repetition Penalty",
		description: "Penalty applied to repeated tokens (1.0 = no penalty)",
		type: "number",
		min: 0.1,
		max: 2,
		step: 0.01,
		default: 1.1
	},
	repeatLastN: {
		label: "Repeat Last N",
		description: "Window size for repetition penalty",
		type: "number",
		min: 0,
		max: 2048,
		step: 1,
		default: 64
	},
	frequencyPenalty: {
		label: "Frequency Penalty",
		description: "Penalty based on token frequency in the text",
		type: "number",
		min: -2,
		max: 2,
		step: 0.01,
		default: 0
	},
	presencePenalty: {
		label: "Presence Penalty",
		description: "Penalty based on whether token appears in the text",
		type: "number",
		min: -2,
		max: 2,
		step: 0.01,
		default: 0
	},

	// Advanced sampling methods
	mirostat: {
		label: "Mirostat",
		description:
			"Mirostat sampling algorithm (0 = disabled, 1 or 2 = version)",
		type: "number",
		min: 0,
		max: 2,
		step: 1,
		default: 0
	},
	mirostatTau: {
		label: "Mirostat Tau",
		description: "Target perplexity for Mirostat",
		type: "number",
		min: 0,
		max: 10,
		step: 0.01,
		default: 5
	},
	mirostatEta: {
		label: "Mirostat Eta",
		description: "Learning rate for Mirostat",
		type: "number",
		min: 0,
		max: 1,
		step: 0.01,
		default: 0.1
	},
	tfs: {
		label: "TFS (Tail Free Sampling)",
		description: "Tail-free sampling parameter (1.0 = disabled)",
		type: "number",
		min: 0,
		max: 1,
		step: 0.01,
		default: 1
	},
	typicalP: {
		label: "Typical P",
		description: "Typical sampling parameter (1.0 = disabled)",
		type: "number",
		min: 0,
		max: 1,
		step: 0.01,
		default: 1
	},

	// DRY sampling
	dryMultiplier: {
		label: "DRY Multiplier",
		description:
			"Penalty multiplier for DRY (Don't Repeat Yourself) sampling",
		type: "number",
		min: 0,
		max: 5,
		step: 0.1,
		default: 0
	},
	dryBase: {
		label: "DRY Base",
		description: "Exponential base for DRY sampling",
		type: "number",
		min: 1,
		max: 10,
		step: 0.1,
		default: 1.75
	},
	dryAllowedLength: {
		label: "DRY Allowed Length",
		description: "Allowed repetition length for DRY",
		type: "number",
		min: 1,
		max: 20,
		step: 1,
		default: 2
	},
	dryPenaltyLastN: {
		label: "DRY Penalty Last N",
		description: "Context window for DRY penalty (-1 = full context)",
		type: "number",
		min: -1,
		max: 2048,
		step: 1,
		default: -1
	},

	// XTC sampling
	xtcProbability: {
		label: "XTC Probability",
		description:
			"Probability of applying XTC (Exclude Top Choices) sampling",
		type: "number",
		min: 0,
		max: 1,
		step: 0.01,
		default: 0
	},
	xtcThreshold: {
		label: "XTC Threshold",
		description: "Threshold for XTC sampling",
		type: "number",
		min: 0,
		max: 0.5,
		step: 0.01,
		default: 0.1
	},

	// Dynamic temperature
	dynatempRange: {
		label: "Dynamic Temperature Range",
		description: "Range for dynamic temperature adjustment",
		type: "number",
		min: 0,
		max: 5,
		step: 0.1,
		default: 0
	},
	dynatempExponent: {
		label: "Dynamic Temperature Exponent",
		description: "Exponent for dynamic temperature scaling",
		type: "number",
		min: 0.1,
		max: 5,
		step: 0.1,
		default: 1
	},

	// Generation control
	responseTokens: {
		label: "Response Tokens",
		description: "Maximum number of tokens to generate",
		type: "number",
		min: 1,
		max: 4096,
		step: 1,
		default: 512
	},
	contextTokens: {
		label: "Context Tokens",
		description: "Maximum context size in tokens",
		type: "number",
		min: 512,
		max: 32768,
		step: 128,
		default: 4096
	},
	penalizeNewline: {
		label: "Penalize Newline",
		description: "Apply penalty to newline tokens",
		type: "boolean",
		default: false
	},
	logitBias: {
		label: "Logit Bias",
		description: "Token ID to bias value mapping",
		type: "object",
		default: {}
	},
	stop: {
		label: "Stop Sequences",
		description: "Sequences that stop generation",
		type: "array",
		default: []
	},

	// KoboldCpp-specific samplers
	topA: {
		label: "Top A",
		description: "Top-a sampling value (KoboldCPP only)",
		type: "number",
		min: 0,
		max: 1,
		step: 0.01,
		default: 0
	},
	nsigma: {
		label: "N-Sigma",
		description:
			"Top N-Sigma value. Set above 0 to enable (KoboldCPP only)",
		type: "number",
		min: 0,
		max: 10,
		step: 0.1,
		default: 0
	},
	smoothingFactor: {
		label: "Smoothing Factor",
		description:
			"Modifies temperature behavior. Greater than 0 uses smoothing (KoboldCPP only)",
		type: "number",
		min: 0,
		max: 10,
		step: 0.1,
		default: 0
	},
	bannedTokens: {
		label: "Banned Tokens",
		description:
			"Words/phrases prevented from being generated (KoboldCPP only)",
		type: "array",
		default: []
	}
}

// Get unsupported samplers for a connection type with explanations
export function getUnsupportedSamplers(
	connectionType: string
): Map<string, string> {
	const supported = getSupportedSamplers(connectionType)
	const unsupported = new Map<string, string>()

	// Get all possible samplers from metadata
	for (const samplerKey of Object.keys(samplerMetadata)) {
		if (!supported.has(samplerKey)) {
			let explanation = ""
			switch (connectionType) {
				case CONNECTION_TYPE.OPENAI_CHAT:
					explanation = "OpenAI API does not support this sampler"
					break
				case CONNECTION_TYPE.OLLAMA:
					explanation =
						"Ollama does not currently support this sampler"
					break
				case CONNECTION_TYPE.LM_STUDIO:
					explanation = "LM Studio API does not support this sampler"
					break
				case CONNECTION_TYPE.LLAMACPP_COMPLETION:
					explanation = "This sampler is not available in llama.cpp"
					break
				case CONNECTION_TYPE.KOBOLDCPP:
				case CONNECTION_TYPE.KOBOLDCPP_MANAGED:
					explanation = "KoboldCpp does not support this sampler"
					break
				case CONNECTION_TYPE.ANTHROPIC:
					explanation = "Anthropic API does not support this sampler"
					break
				default:
					explanation =
						"This connection type does not support this sampler"
			}
			unsupported.set(samplerKey, explanation)
		}
	}

	return unsupported
}
