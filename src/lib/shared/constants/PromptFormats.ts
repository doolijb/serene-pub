export class PromptFormats {
	static readonly VICUNA = "vicuna"
	static readonly CHATML = "chatml"
	static readonly BASIC = "basic"
	static readonly OPENAI = "openai"
	static readonly LLAMA2_INST = "llama2_inst"
	static readonly CLAUDE = "claude"
	static readonly INSTRUCT = "instruct"
	/**
	 * ⚠ NOT a completion template and not expressible as one.
	 *
	 * `PromptBlockFormatter.tekkenBlock` takes a WHOLE CONVERSATION
	 * (`{system, user, assistant}`) and emits one `[INST]…[/INST]` envelope
	 * around all three. A template row is a prefix and a suffix per block, so
	 * there is no row that renders it — recording the limit here rather than
	 * contorting the schema around one arm nothing reaches.
	 *
	 * It is dead code today: unreachable from `makeBlock`, absent from every
	 * picker, and selecting `"tekken"` renders the default template. The
	 * commented-out `// PromptFormats.TEKKEN // ← new` entries that used to sit
	 * in `keys` and `options` are deleted rather than left commented, because a
	 * comment there reads as "one uncomment away from working" and it is not.
	 */
	static readonly TEKKEN = "tekken"
	static readonly SPLIT_CHAT = "split_chat" // This is a hidden format for splitting chat completions

	/**
	 * The one spelling of "and if there isn't one", for every layer.
	 *
	 * `promptFormatOf` below, `DEFAULT_COMPLETION_TEMPLATE_KEY`
	 * (`completionTemplates.ts`), `PromptBlockFormatter`'s unresolved-template
	 * arm and `connections.prompt_format`'s column default all read this rather
	 * than each writing a literal. Six hand-written copies of this operator is
	 * how two of them came to disagree.
	 */
	static readonly DEFAULT = PromptFormats.VICUNA

	static readonly keys = [
		PromptFormats.VICUNA,
		PromptFormats.CHATML,
		PromptFormats.BASIC,
		PromptFormats.OPENAI,
		PromptFormats.LLAMA2_INST,
		PromptFormats.CLAUDE,
		PromptFormats.INSTRUCT,
		PromptFormats.SPLIT_CHAT
	]

	static readonly options = [
		{ value: PromptFormats.VICUNA, label: "Vicuna (Default)" },
		{ value: PromptFormats.CHATML, label: "ChatML" },
		{ value: PromptFormats.BASIC, label: "Basic / Legacy" },
		{ value: PromptFormats.OPENAI, label: "OpenAI" },
		{ value: PromptFormats.LLAMA2_INST, label: "LLaMA2/Mistral Instruct" },
		{ value: PromptFormats.CLAUDE, label: "Claude (Human/Assistant)" },
		{ value: PromptFormats.INSTRUCT, label: "Instruct (Alpaca)" }
	]
}

/**
 * The wire format to render in, from whatever value carried it.
 *
 * ⚠ **`||`, never `??`.** `connections.prompt_format` is a nullable text column
 * with no check constraint, so `""` is a state a row can be in, and
 * `"" ?? "vicuna"` is `""`. An empty format is a CLEARED one, which means the
 * same thing as an absent one.
 *
 * ## The disagreement this used to sit on top of
 *
 * `PromptBlockFormatter.makeBlock`'s `default:` arm used to return **ChatML**
 * while this returned Vicuna, so the two ways of writing "and if there isn't
 * one" disagreed on exactly one input — and a prompt could be rendered as
 * Vicuna and stopped as ChatML in the same request. That arm is gone: an
 * unresolved format now resolves through `completionTemplateOf`, which answers
 * `PromptFormats.DEFAULT` here too. Both spellings agree by construction now,
 * and `completionTemplates.test.ts` pins that they do.
 *
 * Kept as a named function rather than an inline `||` so that the render
 * (`runtime/bindings.ts`), the receipt (`runtime/dispatch.ts`) and the adapters'
 * text fallback are one edit rather than three.
 */
export const promptFormatOf = (format?: string | null): string =>
	format || PromptFormats.DEFAULT
