import llamaTokenizer from "llama-tokenizer-js"
import mistralTokenizer from "mistral-tokenizer-js"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"

// gpt-tokenizer, llama3-tokenizer-js, and @lenml/tokenizer-gemma all use
// Unicode regex property escapes (\p{L}, \p{N}, etc.) in their BPE
// pretokenization patterns — the standard tiktoken-style split regex. That
// throws a SyntaxError while PARSING (not running) under nodejs-mobile's
// Android build of V8, which lacks full ICU support. Dynamic imports defer
// that parse until a counter that actually needs one of these is used,
// instead of crashing the whole app the moment this module loads (this file
// is core, always-loaded infrastructure — every connection adapter uses
// TokenCounters). llama-tokenizer-js and mistral-tokenizer-js don't use
// \p{...} and stay as ordinary static imports above.

export interface TokenCounter {
	countTokens(text: string): Promise<number> | number
}

/**
 * Estimate should always be the most conservative option
 * It should never overestimate tokens, but can underestimate
 */
export class EstimateTokenCounter implements TokenCounter {
	countTokens(text: string): number {
		return Math.ceil(text.length / 3.4)
	}
}

export class OpenAIGPT2TokenCounter implements TokenCounter {
	async countTokens(text: string): Promise<number> {
		const { countTokens } = await import("gpt-tokenizer/encoding/r50k_base")
		return countTokens(text)
	}
}

export class OpenAIGPT35TokenCounter implements TokenCounter {
	async countTokens(text: string): Promise<number> {
		const { countTokens } = await import(
			"gpt-tokenizer/encoding/cl100k_base"
		)
		return countTokens(text)
	}
}

export class OpenAIGPT4TokenCounter implements TokenCounter {
	async countTokens(text: string): Promise<number> {
		const { countTokens } = await import(
			"gpt-tokenizer/encoding/cl100k_base"
		)
		return countTokens(text)
	}
}

export class OpenAIGPT4oTokenCounter implements TokenCounter {
	async countTokens(text: string): Promise<number> {
		const { countTokens } = await import("gpt-tokenizer/encoding/o200k_base")
		return countTokens(text)
	}
}

export class LlamaTokenCounter implements TokenCounter {
	countTokens(text: string): number {
		return llamaTokenizer.encode(text).length
	}
}

export class Llama3TokenCounter implements TokenCounter {
	async countTokens(text: string): Promise<number> {
		const { default: llama3Tokenizer } = await import("llama3-tokenizer-js")
		return llama3Tokenizer.encode(text).length
	}
}

export class MistralTokenCounter implements TokenCounter {
	countTokens(text: string): number {
		return mistralTokenizer.encode(text).length
	}
}

export class AnthropicClaudeTokenCounter implements TokenCounter {
	countTokens(text: string): number {
		return Math.ceil(text.length / 3.6)
	}
}

export class CohereTokenCounter implements TokenCounter {
	async countTokens(text: string): Promise<number> {
		const { fromPreTrained: getGemmaTokenizer } = await import(
			"@lenml/tokenizer-gemma"
		)
		const tokenizer = getGemmaTokenizer()
		return tokenizer.encode(text, { add_special_tokens: false }).length
		//return Math.ceil(text.length / 5)
	}
}

export class GeminiTokenCounter implements TokenCounter {
	countTokens(text: string): number {
		return Math.ceil(text.length / 4)
	}
}

export class GemmaTokenCounter implements TokenCounter {
	countTokens(text: string): number {
		// Gemma models tend to have slightly different tokenization
		// Use a more conservative estimate that's closer to actual Gemma tokenization
		return Math.ceil(text.length / 3.5) // More conservative than /4
	}
}

export type TokenCounterDescriptor = {
	label: string
	counter: TokenCounter
}

export class TokenCounters {
	static counters: Record<string, TokenCounterDescriptor> =
		Object.fromEntries([
			[
				TokenCounterOptions.ESTIMATE,
				{
					label: TokenCounterOptions.options.find(
						(o) => o.value === TokenCounterOptions.ESTIMATE
					)!.label,
					counter: new EstimateTokenCounter()
				}
			],
			[
				TokenCounterOptions.OPENAI_GPT2,
				{
					label: TokenCounterOptions.options.find(
						(o) => o.value === TokenCounterOptions.OPENAI_GPT2
					)!.label,
					counter: new OpenAIGPT2TokenCounter()
				}
			],
			[
				TokenCounterOptions.OPENAI_GPT35,
				{
					label: TokenCounterOptions.options.find(
						(o) => o.value === TokenCounterOptions.OPENAI_GPT35
					)!.label,
					counter: new OpenAIGPT35TokenCounter()
				}
			],
			[
				TokenCounterOptions.OPENAI_GPT4,
				{
					label: TokenCounterOptions.options.find(
						(o) => o.value === TokenCounterOptions.OPENAI_GPT4
					)!.label,
					counter: new OpenAIGPT4TokenCounter()
				}
			],
			[
				TokenCounterOptions.OPENAI_GPT4O,
				{
					label: TokenCounterOptions.options.find(
						(o) => o.value === TokenCounterOptions.OPENAI_GPT4O
					)!.label,
					counter: new OpenAIGPT4oTokenCounter()
				}
			],
			[
				TokenCounterOptions.LLAMA,
				{
					label: TokenCounterOptions.options.find(
						(o) => o.value === TokenCounterOptions.LLAMA
					)!.label,
					counter: new LlamaTokenCounter()
				}
			],
			[
				TokenCounterOptions.LLAMA3,
				{
					label: TokenCounterOptions.options.find(
						(o) => o.value === TokenCounterOptions.LLAMA3
					)!.label,
					counter: new Llama3TokenCounter()
				}
			],
			[
				TokenCounterOptions.MISTRAL,
				{
					label: TokenCounterOptions.options.find(
						(o) => o.value === TokenCounterOptions.MISTRAL
					)!.label,
					counter: new MistralTokenCounter()
				}
			],
			[
				TokenCounterOptions.ANTHROPIC_CLAUDE,
				{
					label: TokenCounterOptions.options.find(
						(o) => o.value === TokenCounterOptions.ANTHROPIC_CLAUDE
					)!.label,
					counter: new AnthropicClaudeTokenCounter()
				}
			],
			[
				TokenCounterOptions.COHERE,
				{
					label: TokenCounterOptions.options.find(
						(o) => o.value === TokenCounterOptions.COHERE
					)!.label,
					counter: new CohereTokenCounter()
				}
			],
			[
				TokenCounterOptions.GEMINI,
				{
					label: TokenCounterOptions.options.find(
						(o) => o.value === TokenCounterOptions.GEMINI
					)!.label,
					counter: new GeminiTokenCounter()
				}
			],
			[
				TokenCounterOptions.GEMMA,
				{
					label: TokenCounterOptions.options.find(
						(o) => o.value === TokenCounterOptions.GEMMA
					)!.label,
					counter: new GemmaTokenCounter()
				}
			],
			[
				TokenCounterOptions.GEMMA,
				{
					label: TokenCounterOptions.options.find(
						(o) => o.value === TokenCounterOptions.GEMMA
					)!.label,
					counter: new GemmaTokenCounter()
				}
			]
		])

	private active: string

	constructor(strategy: string = "estimate") {
		if (!(strategy in TokenCounters.counters)) {
			throw new Error(`Unknown strategy: ${strategy}`)
		}
		this.active = strategy
	}

	countTokens(text: string): number | Promise<number> {
		return TokenCounters.counters[this.active].counter.countTokens(text)
	}

	static availableStrategies(): Record<string, string> {
		const map: Record<string, string> = {}
		for (const key in TokenCounters.counters) {
			map[key] = TokenCounters.counters[key].label
		}
		return map
	}
}
