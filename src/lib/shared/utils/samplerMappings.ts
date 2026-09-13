import { CONNECTION_TYPE } from "../constants/ConnectionTypes"

/**
 * The four levels `core:shape/text-gen@1` declares for `reasoning`.
 *
 * Reasoning effort is a SAMPLING parameter, chosen per stage through the
 * sampling slot (ruling 2026-09-12) — not a connection setting. It was three
 * different connection flags before, which meant one answer for every stage
 * that shared a connection.
 */
export type ReasoningLevel = "off" | "low" | "medium" | "high"

/** Is this what the shape's `reasoning` field says, rather than a stray string? */
export function isReasoningLevel(value: unknown): value is ReasoningLevel {
	return (
		value === "off" ||
		value === "low" ||
		value === "medium" ||
		value === "high"
	)
}

/**
 * What a level is worth to a service that takes a NUMBER rather than a word.
 *
 * One table, read by every adapter whose API wants a token count, so "medium"
 * cannot mean two different budgets depending on which backend answered. A
 * config that sets `reasoningBudget` outright overrides it — a number somebody
 * typed is a choice, and this is only the translation of a word.
 */
export const REASONING_LEVEL_BUDGET: Record<
	Exclude<ReasoningLevel, "off">,
	number
> = {
	low: 2048,
	medium: 8000,
	high: 32000
}

/**
 * The two keys no key map copies verbatim.
 *
 * Every `mapSamplingConfig` below walks its map and assigns the value straight
 * across, which is right for a number a backend spells differently and wrong
 * for these: a level is a word one service takes as a string, another as a
 * boolean, a third as a token count, and a fourth nests inside an object. They
 * are in the maps so `getSupportedSamplers` can answer "will this connection
 * honour it" for the config panel's note, and skipped by the copy loops so each
 * adapter can translate them where it builds its request.
 */
export const REASONING_KEYS: readonly string[] = [
	"reasoning",
	"reasoningBudget"
]

/** Is this a key an adapter translates rather than copies? */
export const isReasoningKey = (key: string): boolean =>
	REASONING_KEYS.includes(key)

/**
 * What a resolved sampling config asks of the model, or nothing.
 *
 * ⚠ **Absence is the whole contract.** `sampling` arrives already resolved
 * (`resolveSamplingValues`), so a key being present IS the switch being on —
 * and a switched-off `reasoning` must leave a request byte-identical to what it
 * was before this vocabulary existed. Every adapter therefore reads this and
 * does nothing at all when `level` is undefined.
 */
export function reasoningOf(sampling: Record<string, unknown>): {
	level?: ReasoningLevel
	budget?: number
} {
	const level = isReasoningLevel(sampling.reasoning)
		? sampling.reasoning
		: undefined
	const raw = sampling.reasoningBudget
	const budget =
		typeof raw === "number" && Number.isFinite(raw) && raw >= 0
			? Math.round(raw)
			: undefined
	return {
		...(level ? { level } : {}),
		...(budget !== undefined ? { budget } : {})
	}
}

/** The token count a request carries: the config's own number, else the level's. */
export function reasoningBudgetFor(
	level: Exclude<ReasoningLevel, "off">,
	budget?: number
): number {
	return budget ?? REASONING_LEVEL_BUDGET[level]
}

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
	logitBias: "logit_bias",

	// Reasoning — a level word, in the field the Chat Completions API calls it.
	// No budget entry: this format takes an effort, never a token count.
	reasoning: "reasoning_effort"
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
	contextTokens: "num_ctx",

	// Reasoning — `think`, which takes a boolean on every model and a level
	// word on the gpt-oss family. No budget entry: Ollama has no field for one.
	reasoning: "think"
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
	stop: "stop",

	// Reasoning — the OpenAI spelling, which is what LM Studio's own server
	// speaks. No budget entry, for the same reason OpenAI has none.
	reasoning: "reasoning_effort"
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
	stop: "stop",

	// Reasoning. llama-server takes a TOKEN COUNT rather than a word, so both
	// keys land on the same field: the level is read through the shared table
	// above unless a budget was set outright. The on/off half rides
	// `chat_template_kwargs.enable_thinking` beside it.
	reasoning: "reasoning_budget",
	reasoningBudget: "reasoning_budget"
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
	bannedTokens: "banned_tokens",

	// Reasoning, on/off only: KoboldCPP reads `enable_thinking` out of a nested
	// `chat_template_kwargs`, and it is a Jinja variable with two states. A
	// level is honoured as "on" and `reasoningBudget` has no field at all, so
	// it is deliberately absent from this map.
	reasoning: "enable_thinking"
}

// Anthropic sampling key mappings
export const anthropicSamplingKeyMap: Record<string, string> = {
	// Core sampling parameters
	temperature: "temperature",
	topP: "top_p",
	topK: "top_k",

	// Generation limits
	responseTokens: "max_tokens",

	// Reasoning — `thinking`, the one field carrying both halves: the level
	// decides `type`, and the budget (or the shared level table) fills
	// `budget_tokens`.
	reasoning: "thinking",
	reasoningBudget: "thinking"
}

// Get sampling key map by connection type
export function getSamplingKeyMap(
	connectionType: string
): Record<string, string> {
	switch (connectionType) {
		case CONNECTION_TYPE.OPENAI:
			return openAISamplingKeyMap
		case CONNECTION_TYPE.OLLAMA:
			return ollamaSamplingKeyMap
		case CONNECTION_TYPE.LM_STUDIO:
			return lmStudioSamplingKeyMap
		case CONNECTION_TYPE.LLAMACPP:
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
