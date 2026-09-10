/**
 * One parser for the reasoning delimiters models emit inline, shared by every
 * path that turns a completion into a durable record.
 *
 * ## Why this is shared rather than local
 *
 * Reasoning that is not lifted out here is not merely displayed wrong — it is
 * *stored*. A `<think>` block left in a completion goes into the message row,
 * and from there into the next turn's prompt, the embedding, the annotations
 * and the summaries built from that message. There is no later stage that can
 * take it back out, because by then it is indistinguishable from what the
 * character said. So the strip has to happen at every seam that produces a
 * durable string, and those seams have to agree — hence one module, not a
 * private helper per path.
 *
 * ## What counts as a delimiter family
 *
 * Each entry in {@link THINKING_DELIMITER_FAMILIES} is a claim about a real
 * model's chat template, not a guess at what a model *might* emit. Breadth is
 * cheap and a missing family leaks; but an invented family is a way to eat text
 * a model legitimately wrote, so every one carries its attribution below.
 *
 * ## The false-positive rule
 *
 * Two different rules, because the two shapes carry different risk:
 *
 *  - **A matched pair is stripped wherever it appears.** Well-formedness is the
 *    whole test. A reply that merely *mentions* `<think>` almost never also
 *    contains a well-formed close for it, and if a model did emit a matched
 *    pair then reasoning is what it meant.
 *  - **An unmatched close is reasoning only when it is the FIRST delimiter in
 *    the buffer.** That is the prefilled-open case (below) and it is inherently
 *    a prefix rule: the only reason a close can arrive without an open is that
 *    the template already emitted the open, and a template emits it at the very
 *    start of the turn. A `</think>` that shows up *after* other delimiters
 *    have already been resolved is not a prefill artifact, so it is dropped as a
 *    stray tag with the surrounding text left alone.
 *
 * Both rules are backed by the same mitigation, and it is the reason they can
 * afford to be as permissive as they are: **nothing is discarded.** Text this
 * parser decides is reasoning is returned in `thinking`, and every caller has a
 * home for it (`metadata.thinking` / `swipes.thinkingHistory` on the legacy
 * row, the `thinking` port on the pipeline result). A false positive is text in
 * the wrong pane, which a reader can see and an operator can recover. That is a
 * different order of harm from silently deleting a sentence.
 *
 * ## The three shapes
 *
 *  - **Paired** — `<think>reasoning</think>reply`. The ordinary case.
 *  - **Prefilled open** — `reasoning</think>reply`. DeepSeek-R1's chat template
 *    emits the opening `<think>` itself, so the model's own output starts inside
 *    the block and only the close is ever generated. This is common, not exotic.
 *    Note what cannot be done about it mid-stream: until the close arrives there
 *    is no delimiter in the buffer at all and no way to tell reasoning from a
 *    reply. The displayed text corrects itself the moment the close lands, and
 *    the stored record — which is what the hazard is about — is always right.
 *  - **Unclosed** — `<think>reasoning` with no close, because the generation was
 *    cancelled or hit its token limit. The remainder is *captured* as reasoning
 *    rather than dropped, so a truncated reasoning-only generation yields the
 *    partial trace instead of an empty message with nothing to show for it.
 *
 * ## Idempotence
 *
 * `extract(extract(x).content).content === extract(x).content`. The streaming
 * path re-parses a growing buffer on every throttle frame, so a parser that
 * changed its answer on a second pass would corrupt the reply it had already
 * cleaned. A pass that matches nothing returns the input by identity — not a
 * trimmed copy — so a completion with no delimiters is untouched byte for byte.
 */

export interface ThinkingDelimiterFamily {
	/** Stable id — used by tests and by nothing else. */
	id: string
	/** Which real models emit this pair. A family with no answer here is a bug. */
	emittedBy: string
	/** Regex source for the opening delimiter. */
	openSource: string
	/** Regex source for the closing delimiter. */
	closeSource: string
	/**
	 * Matched case-sensitively. Only `[THINK]`, whose bracketed-uppercase shape
	 * is plausible enough as ordinary prose that folding case would widen the
	 * false-positive surface for no gain — Magistral emits it in uppercase and
	 * only in uppercase.
	 */
	caseSensitive?: boolean
}

/**
 * An XML-shaped family: tolerant of whitespace and attributes inside the tag
 * (`<think >`, `<think foo="1">`, `</think >`) but not of whitespace between the
 * `<` and the name, which no model emits and HTML does not permit either.
 *
 * The `(?:\s[^>]*)?` on the open is what keeps `<think>` from matching the first
 * six characters of `<thinking>`: the name must be followed by `>` or by
 * whitespace, never by another name character.
 */
function xmlFamily(
	id: string,
	tag: string,
	emittedBy: string
): ThinkingDelimiterFamily {
	return {
		id,
		emittedBy,
		openSource: `<${tag}(?:\\s[^>]*)?>`,
		closeSource: `</${tag}\\s*>`
	}
}

/**
 * The families this parser recognises, each with the models that emit it.
 *
 * Deliberately **not** here:
 *
 *  - `<analysis>`, `<scratchpad>`, `<reflection>`, `<thought>` — prompted
 *    conventions, not chat-template delimiters. No shipping model emits them as
 *    its own structure, and `<analysis>` in particular is plausible as content in
 *    a roleplay app. A family that only a prompt can produce is a false-positive
 *    generator with no leak to justify it.
 *  - `<answer>`, `<|begin_of_solution|>` — wrappers around the *reply*, not
 *    around reasoning. Unwrapping content is a different operation with a
 *    different failure mode: a wrapper this module fails to recognise leaves
 *    visible markup, where a reasoning family it fails to recognise leaks a
 *    whole trace. Note the consequence for the distill family below — its
 *    thought pair is stripped and its solution markers are left standing.
 *  - OpenAI Harmony (`<|channel|>analysis<|message|>…<|end|>`, gpt-oss) — not a
 *    paired delimiter but a channel protocol, where the reply itself also lives
 *    inside a channel envelope. Half an implementation would strip the analysis
 *    channel and leave the final channel's markers in the reply, which is worse
 *    than leaving both. Excluded on purpose rather than overlooked.
 */
export const THINKING_DELIMITER_FAMILIES: readonly ThinkingDelimiterFamily[] = [
	xmlFamily(
		"think",
		"think",
		// The de-facto standard: DeepSeek-R1 and every distill of it, Qwen3 and
		// QwQ, GLM-4.5/Z1, EXAONE Deep, Phi-4-reasoning, Llama-Nemotron,
		// Hunyuan, ERNIE-4.5-Thinking, Kimi K2/K2.5.
		"DeepSeek-R1 and distills, Qwen3/QwQ, GLM-4.5, EXAONE Deep, Phi-4-reasoning, Nemotron, Kimi K2"
	),
	xmlFamily(
		"thinking",
		"thinking",
		// The Anthropic-style prompted format, which a number of open fine-tunes
		// were trained on directly (Cogito among them), and which several
		// OpenAI-compatible proxies use when they render a `reasoning_content`
		// field back into the text stream.
		"Anthropic-style fine-tunes (Cogito and similar); proxies rendering reasoning_content as a tag"
	),
	xmlFamily(
		"reasoning",
		"reasoning",
		// Third-party gateways and fine-tunes that surface reasoning under its
		// other common name.
		"gateways and fine-tunes that surface reasoning under this tag"
	),
	xmlFamily(
		"seed-think",
		"seed:think",
		// ByteDance's Seed-OSS line ships a deliberately non-standard tag; a
		// backend without a matching reasoning parser hands it through verbatim,
		// which is exactly the case this module exists for.
		"ByteDance Seed-OSS-36B"
	),
	{
		id: "begin-of-thought",
		// The OpenThoughts / Bespoke-Stratos / Sky-T1 distillation format. The
		// `<|…|>` special-token shape means the false-positive risk is nil.
		emittedBy: "OpenThoughts, Bespoke-Stratos, Sky-T1 distills",
		openSource: "<\\|begin_of_thought\\|>",
		closeSource: "<\\|end_of_thought\\|>"
	},
	{
		id: "kimi-triangle",
		// The pre-K2 Moonshot line (Kimi-VL-A3B-Thinking, Kimi-Dev). Reported in
		// the field rather than confirmed from a primary model card here, and
		// carried anyway: U+25C1/U+25B7 do not occur in prose, so the family
		// cannot cost anything even if the attribution is imprecise.
		emittedBy: "Moonshot Kimi (pre-K2 line: Kimi-VL-Thinking, Kimi-Dev)",
		openSource: "◁think▷",
		closeSource: "◁/think▷"
	},
	{
		id: "magistral",
		// Mistral's Magistral encodes these as real special tokens precisely so
		// the trace can be parsed; a backend that decodes them to text instead of
		// splitting on them is how they reach us.
		emittedBy: "Mistral Magistral (Small/Medium)",
		openSource: "\\[THINK\\]",
		closeSource: "\\[/THINK\\]",
		caseSensitive: true
	}
]

/** One delimiter occurrence found in the buffer. */
interface Token {
	index: number
	length: number
	family: ThinkingDelimiterFamily
	kind: "open" | "close"
}

/**
 * Every family's open and close in one pass, so the tokens come back in the
 * order they appear rather than per-family. Group `2i+1` is family `i`'s open
 * and `2i+2` is its close, which is how a match is mapped back to a family.
 */
const TOKEN_RE = new RegExp(
	THINKING_DELIMITER_FAMILIES.map(
		(f) => `(${f.openSource})|(${f.closeSource})`
	).join("|"),
	"gi"
)

/**
 * The case-sensitive families are matched by the case-insensitive scan above and
 * then re-checked here, because JavaScript has no inline `(?-i:…)` to make one
 * branch of an alternation case-sensitive. A token that fails the re-check is
 * not a delimiter at all: it is left in the text untouched.
 */
function respectsCase(token: Token, matched: string): boolean {
	if (!token.family.caseSensitive) return true
	const source =
		token.kind === "open"
			? token.family.openSource
			: token.family.closeSource
	return new RegExp(`^(?:${source})$`).test(matched)
}

function scanTokens(raw: string): Token[] {
	const tokens: Token[] = []
	TOKEN_RE.lastIndex = 0
	let match: RegExpExecArray | null
	while ((match = TOKEN_RE.exec(raw)) !== null) {
		for (let g = 1; g < match.length; g++) {
			if (match[g] === undefined) continue
			const family = THINKING_DELIMITER_FAMILIES[(g - 1) >> 1]!
			const token: Token = {
				index: match.index,
				length: match[0].length,
				family,
				kind: (g - 1) % 2 === 0 ? "open" : "close"
			}
			if (respectsCase(token, match[0])) tokens.push(token)
			break
		}
	}
	return tokens
}

export interface ThinkingExtraction {
	/** The completion with every reasoning block removed. */
	content: string
	/** The reasoning, blocks joined by a blank line, or undefined if there was none. */
	thinking: string | undefined
	/**
	 * Whether any delimiter was found. Distinguishes "there was no reasoning" from
	 * "there was an empty reasoning block", and lets a caller keep the input by
	 * identity when there is nothing to do.
	 */
	matched: boolean
}

/**
 * Lift inline reasoning out of a completion.
 *
 * Safe to call on a partial buffer and safe to call repeatedly: see the module
 * header for the three shapes it recognises, the rule that keeps it from eating
 * text a model legitimately wrote, and why idempotence is load-bearing here.
 */
export function extractThinking(raw: string): ThinkingExtraction {
	const tokens = scanTokens(raw)
	if (tokens.length === 0)
		return { content: raw, thinking: undefined, matched: false }

	const thinkingParts: string[] = []
	let content = ""
	let cursor = 0
	let open: Token | null = null

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i]!

		if (open === null) {
			if (token.kind === "open") {
				content += raw.slice(cursor, token.index)
				open = token
				cursor = token.index + token.length
				continue
			}
			// A close with nothing open. Reasoning only if it is the very first
			// delimiter in the buffer — the prefilled-open case. See the header.
			if (i === 0) {
				thinkingParts.push(raw.slice(cursor, token.index))
			} else {
				content += raw.slice(cursor, token.index)
			}
			cursor = token.index + token.length
			continue
		}

		// Delimiters inside an open block are part of the reasoning text, not
		// structure — except a close, which ends it.
		//
		// Any family's close ends the block, not just the one that opened it.
		// Models do mismatch (`<think>…</thinking>`), and the strict reading of
		// that is "the block never closed", which swallows the entire reply into
		// the reasoning pane. The lenient reading costs nothing: a close that was
		// never going to match anything is dropped as a stray tag either way.
		if (token.kind === "close") {
			thinkingParts.push(raw.slice(cursor, token.index))
			open = null
			cursor = token.index + token.length
		}
	}

	if (open !== null) {
		// Unclosed: the rest of the buffer is reasoning, captured rather than
		// dropped. Mid-stream this is a block still being written; at the end of
		// a run it is a generation that was cut off inside one.
		thinkingParts.push(raw.slice(cursor))
		cursor = raw.length
	}
	content += raw.slice(cursor)

	const thinking = thinkingParts
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.join("\n\n")

	return {
		// Leading whitespace is what a stripped preamble leaves behind; the tail
		// is the caller's to trim, as it was before this module existed.
		content: content.trimStart(),
		thinking: thinking.length > 0 ? thinking : undefined,
		matched: true
	}
}

/**
 * The two questions a generation path has to answer about one buffer, kept
 * apart on purpose:
 *
 *  1. **Did we get reasoning natively?** — from a streaming `thinkingCb` or a
 *     non-streaming `thinkingContent`. When we did, that is the trace to show
 *     and store: the model separated it itself and the separation is exact.
 *  2. **Is the buffer clean?** — a question about the *text*, which has one
 *     right answer whatever the source of (1) was.
 *
 * Conflating them is what left raw `<think>` markup in stored messages: the
 * strip was guarded on "no native reasoning yet", and the inline path wrote its
 * own result into the same variable it was guarded on — so the first frame that
 * found a closed block disabled every strip after it, and the tail of the reply
 * kept its markup. The guard also fired for a genuinely native trace, which is
 * precisely the case where the buffer can still carry a stray delimiter.
 *
 * So: the strip runs unconditionally, every frame, and native reasoning wins on
 * the *trace* only. There is no state here — a caller passes what it has
 * accumulated, and nothing this function returns can turn a later strip off.
 *
 * ## Winning the trace is not the same as deleting the other one
 *
 * A native trace leads, but anything the parser also lifted out of the buffer is
 * kept behind it rather than dropped. That is what makes the module's "nothing
 * is discarded" property unconditional, and the permissive matching rules rest
 * on it: text the parser misjudges as reasoning has to end up *somewhere* a
 * reader can find it, and "the adapter happened to also send a native trace"
 * cannot be what decides whether a sentence survives. The one duplicate this
 * would otherwise produce — a backend that reports its reasoning natively *and*
 * leaves the same block in the text — is caught by the containment check.
 */
export function resolveThinking(
	buffer: string,
	nativeThinking: string | undefined
): { content: string; thinking: string | undefined } {
	const extracted = extractThinking(buffer)
	const native = nativeThinking?.trim()
	if (!native)
		return { content: extracted.content, thinking: extracted.thinking }
	const inline = extracted.thinking
	return {
		content: extracted.content,
		thinking:
			inline && !native.includes(inline)
				? `${native}\n\n${inline}`
				: native
	}
}
