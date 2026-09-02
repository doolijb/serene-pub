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

// KoboldCPP sampling key mappings
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

	// Top-A sampling (KoboldCPP specific)
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

	// Smoothing factor (KoboldCPP specific)
	smoothingFactor: "smoothing_factor",

	// DRY (Don't Repeat Yourself) sampling
	dryMultiplier: "dry_multiplier",
	dryBase: "dry_base",
	dryAllowedLength: "dry_allowed_length",
	drySequenceBreakers: "dry_sequence_breakers",

	// XTC (Exclude Top Choices) sampling
	xtcProbability: "xtc_probability",
	xtcThreshold: "xtc_threshold",

	// N-Sigma sampling (KoboldCPP specific)
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

/**
 * `samplerMetadata` and `getUnsupportedSamplers` used to live here: a table of
 * label / description / min / max / step / default for every sampler, and a
 * helper that walked it.
 *
 * Both are gone (0171). That table was a second source of truth for the same
 * facts the shape vocabulary now declares (`SAMPLING_SCHEMAS` in the SDK), and
 * the two had already drifted in ways nothing could catch: it gave temperature a
 * default of 1 where the column defaulted to 0.7, top P 1 where the column said
 * 0.92, and it keyed tail-free sampling `tfs` while every key map below — and
 * the column — call it `tfsZ`, so that entry could never have matched anything.
 *
 * The maps above stay, because they are the one fact that genuinely belongs to
 * this file: the wire name each backend uses. They are keyed by exactly the
 * names the vocabulary declares, which is what `getSupportedSamplers` relies on
 * to tell a reader which parameters their chosen connection will actually honour.
 */
