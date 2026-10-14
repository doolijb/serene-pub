/**
 * The label and one-line help of the connection form fields that appear in
 * more than one form, written ONCE so the forms cannot drift apart: the two
 * KoboldCPP forms (the one you run yourself and the one Serene Pub runs) draw
 * the same request switches, and every text connection draws Prompt format
 * and Token counter.
 *
 * Each help line is one plain sentence: what the field does, then when to
 * change it. KoboldCPP's own API documentation is the reference for its
 * switches (`trim_stop`, `render_special`, `bypass_eos`,
 * `grammar_retain_state`, `replace_instruct_placeholders`, `--flashattention`),
 * and `docs/connections.md` says the same at more length.
 */

export interface ConnectionFieldWords {
	label: string
	help: string
}

/** Shown when the connection sends a text completion (`usesCompletionTemplate`). */
export const PROMPT_FORMAT: ConnectionFieldWords = {
	label: "Prompt format",
	help: "How each turn is marked in the text the model reads; pick the format the model was trained on, which its download page usually names."
}

export const TOKEN_COUNTER: ConnectionFieldWords = {
	label: "Token counter",
	help: "How Serene Pub estimates what fits in the model's context; Estimate suits most models, or pick the model's own family."
}

/** The boolean `extraJson` keys both KoboldCPP forms switch, in drawn order. */
export type KoboldCppRequestSwitchKey =
	| "stream"
	| "useMemory"
	| "trimStop"
	| "renderSpecial"
	| "bypassEos"
	| "grammarRetainState"
	| "replaceInstructPlaceholders"

/**
 * The KoboldCPP request switches, in the order both forms draw them. **Use
 * memory** reveals the Memory text box under it.
 */
export const KOBOLDCPP_REQUEST_SWITCHES: ReadonlyArray<
	ConnectionFieldWords & { key: KoboldCppRequestSwitchKey }
> = [
	{
		key: "stream",
		label: "Stream",
		help: "Shows each reply as it is written; turn it off only if replies stall or arrive broken."
	},
	{
		key: "useMemory",
		label: "Use memory",
		help: "Adds your memory text to the start of every text-completion prompt; turn it on for notes the model should always see."
	},
	{
		key: "trimStop",
		label: "Trim stop sequences",
		help: "Cuts the stop sequence that ended a reply off its end; leave it on unless you want to see where a reply stopped."
	},
	{
		key: "renderSpecial",
		label: "Render special tokens",
		help: "Shows the model's special tokens, such as end-of-turn markers, in the reply; turn it on only to check a prompt format."
	},
	{
		key: "bypassEos",
		label: "Bypass EOS token",
		help: "Keeps the model writing past the point where it would end its reply; turn it on only if replies stop too early."
	},
	{
		key: "grammarRetainState",
		label: "Retain grammar state",
		help: "Keeps a response grammar's place from one request to the next; turn it on only if a grammar should carry across replies."
	},
	{
		key: "replaceInstructPlaceholders",
		label: "Replace instruct placeholders",
		help: "Swaps KoboldCPP placeholders such as {{[INPUT]}} for the model's instruct tags; turn it on only if you typed them yourself."
	}
]

/** KoboldCPP, run by Serene Pub: a launch setting, applied on the next load. */
export const KOBOLDCPP_FLASH_ATTENTION: ConnectionFieldWords = {
	label: "Flash attention",
	help: "Speeds up processing and uses less graphics memory on cards that support it; turn it on if yours does."
}
