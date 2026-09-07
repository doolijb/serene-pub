export class PromptFormats {
	static readonly VICUNA = "vicuna"
	static readonly CHATML = "chatml"
	static readonly BASIC = "basic"
	static readonly OPENAI = "openai"
	static readonly LLAMA2_INST = "llama2_inst"
	static readonly CLAUDE = "claude"
	static readonly INSTRUCT = "instruct"
	static readonly TEKKEN = "tekken"
	static readonly SPLIT_CHAT = "split_session" // This is a hidden format for splitting session completions

	static readonly keys = [
		PromptFormats.VICUNA,
		PromptFormats.CHATML,
		PromptFormats.BASIC,
		PromptFormats.OPENAI,
		PromptFormats.LLAMA2_INST,
		PromptFormats.CLAUDE,
		PromptFormats.INSTRUCT,
		PromptFormats.SPLIT_CHAT // ← new
		// PromptFormats.TEKKEN // ← new
	]

	static readonly options = [
		{ value: PromptFormats.VICUNA, label: "Vicuna (Default)" },
		{ value: PromptFormats.CHATML, label: "ChatML" },
		{ value: PromptFormats.BASIC, label: "Basic / Legacy" },
		{ value: PromptFormats.OPENAI, label: "OpenAI" },
		{ value: PromptFormats.LLAMA2_INST, label: "LLaMA2/Mistral Instruct" },
		{ value: PromptFormats.CLAUDE, label: "Claude (Human/Assistant)" },
		{ value: PromptFormats.INSTRUCT, label: "Instruct (Alpaca)" }
		// { value: PromptFormats.TEKKEN, label: "Mistral v7 Tekken" } // ← new
	]
}

/**
 * The wire format to render in, from whatever value carried it.
 *
 * ⚠ **`||`, never `??`,** and the difference is not stylistic.
 * `PromptBlockFormatter.makeBlock`'s `default:` arm returns **ChatML**, so an
 * EMPTY STRING reaching it wraps every block in `<|im_start|>` while an ABSENT
 * value falls to Vicuna here. `connections.prompt_format` is a nullable text
 * column with no check constraint, so `""` is a state a row can be in — and
 * `?? "vicuna"` would send that row a format nobody chose, silently.
 *
 * One spelling for every site that has to answer this: the render
 * (`runtime/bindings.ts`), the receipt (`runtime/dispatch.ts`), and the
 * adapters' own text fallback. Three copies of an operator is how two of them
 * end up disagreeing about a cleared column.
 */
export const promptFormatOf = (format?: string | null): string =>
	format || PromptFormats.VICUNA
