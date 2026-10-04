/**
 * One parser for the reasoning delimiters models emit inline, shared by every
 * path that turns a completion into a durable record.
 *
 * ## Why this is shared rather than local
 *
 * Reasoning that is not lifted out here is not merely displayed wrong — it is
 * *stored*. A `<think>` block left in a completion goes into the message row,
 * and from there into the next turn's prompt, the embedding, the annotations
 * and the summaries built from that message. There is no later step that can
 * take it back out, because by then it is indistinguishable from what the
 * character said. So the strip has to happen at every seam that produces a
 * durable string, and those seams have to agree — hence one module, not a
 * private helper per path.
 *
 * ## What counts as a delimiter family
 *
 * Each entry in {@link REASONING_DELIMITER_FAMILIES} is a claim about a real
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
 * parser decides is reasoning is returned in `reasoning`, and every caller has a
 * home for it (the row's reasoning fold — stored as `metadata.reasoning` /
 * `swipes.reasoningHistory` — and the `reasoning` port on the pipeline
 * result). A false positive is text in
 * the wrong pane, which a reader can see and an operator can recover. That is a
 * different order of harm from silently deleting a sentence.
 *
 * ## The three shapes
 *
 *  - **Paired** — `<think>reasoning</think>reply`. The ordinary case.
 *  - **Prefilled open** — `reasoning</think>reply`. DeepSeek-R1's chat template
 *    emits the opening `<think>` itself, so the model's own output starts inside
 *    the block and only the close is ever generated. This is common, not exotic.
 *    The BUFFER cannot say so mid-stream: until the close arrives there is no
 *    delimiter in it at all. The REQUEST can — a prompt that ends inside an
 *    open block, or a chat template asked to open one — and that fact is what
 *    {@link splitReasoningStream} takes as `opensInReasoning`, so the live view
 *    routes the trace into the reasoning fold from its first token. Without
 *    the fact the displayed text corrects itself the moment the close lands,
 *    and the stored record — which is what the hazard is about — is always
 *    right either way.
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

export interface ReasoningDelimiterFamily {
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
): ReasoningDelimiterFamily {
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
export const REASONING_DELIMITER_FAMILIES: readonly ReasoningDelimiterFamily[] = [
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
	family: ReasoningDelimiterFamily
	kind: "open" | "close"
}

/**
 * Every family's open and close in one pass, so the tokens come back in the
 * order they appear rather than per-family. Group `2i+1` is family `i`'s open
 * and `2i+2` is its close, which is how a match is mapped back to a family.
 */
const TOKEN_RE = new RegExp(
	REASONING_DELIMITER_FAMILIES.map(
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
			const family = REASONING_DELIMITER_FAMILIES[(g - 1) >> 1]!
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

export interface ReasoningExtraction {
	/** The completion with every reasoning block removed. */
	content: string
	/** The reasoning, blocks joined by a blank line, or undefined if there was none. */
	reasoning: string | undefined
	/**
	 * Whether any delimiter was found. Distinguishes "there was no reasoning" from
	 * "there was an empty reasoning block", and lets a caller keep the input by
	 * identity when there is nothing to do.
	 */
	matched: boolean
}

/** The whole parse, including the one fact the public shape leaves out. */
interface Parse extends ReasoningExtraction {
	/** The buffer ended inside a block that was opened and not yet closed. */
	unclosed: boolean
}

function parse(raw: string): Parse {
	const tokens = scanTokens(raw)
	if (tokens.length === 0)
		return {
			content: raw,
			reasoning: undefined,
			matched: false,
			unclosed: false
		}

	const reasoningParts: string[] = []
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
				reasoningParts.push(raw.slice(cursor, token.index))
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
			reasoningParts.push(raw.slice(cursor, token.index))
			open = null
			cursor = token.index + token.length
		}
	}

	const unclosed = open !== null
	if (unclosed) {
		// Unclosed: the rest of the buffer is reasoning, captured rather than
		// dropped. Mid-stream this is a block still being written; at the end of
		// a run it is a generation that was cut off inside one.
		reasoningParts.push(raw.slice(cursor))
		cursor = raw.length
	}
	content += raw.slice(cursor)

	const reasoning = reasoningParts
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.join("\n\n")

	return {
		// Leading whitespace is what a stripped preamble leaves behind; the tail
		// is the caller's to trim, as it was before this module existed.
		content: content.trimStart(),
		reasoning: reasoning.length > 0 ? reasoning : undefined,
		matched: true,
		unclosed
	}
}

/**
 * Lift inline reasoning out of a completion.
 *
 * Safe to call on a partial buffer and safe to call repeatedly: see the module
 * header for the three shapes it recognises, the rule that keeps it from eating
 * text a model legitimately wrote, and why idempotence is load-bearing here.
 */
export function extractReasoning(raw: string): ReasoningExtraction {
	const { content, reasoning, matched } = parse(raw)
	return { content, reasoning, matched }
}

/**
 * Whether `text` ends inside a reasoning block — its last delimiter is an
 * opener with no close after it.
 *
 * Asked of a REQUEST, never of a reply: a completion prompt (or the trailing
 * assistant turn of a chat payload) that ends `…<think>\n` has put the model
 * inside the block before its first token, so the model will only ever write
 * the close. That is a fact about bytes this app sent, which is what lets the
 * live split route the trace from the first token instead of guessing.
 */
export function endsInsideReasoning(text: string): boolean {
	const tokens = scanTokens(text)
	return tokens.length > 0 && tokens[tokens.length - 1]!.kind === "open"
}

/**
 * The two questions a generation path has to answer about one buffer, kept
 * apart on purpose:
 *
 *  1. **Did we get reasoning natively?** — from a streaming `reasoningCb` or a
 *     non-streaming `reasoningContent`. When we did, that is the trace to show
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
export function resolveReasoning(
	buffer: string,
	nativeReasoning: string | undefined
): { content: string; reasoning: string | undefined } {
	const { content, reasoning } = resolveParse(buffer, nativeReasoning)
	return { content, reasoning }
}

function resolveParse(
	buffer: string,
	nativeReasoning: string | undefined
): Parse {
	const extracted = parse(buffer)
	const native = nativeReasoning?.trim()
	if (!native) return extracted
	const inline = extracted.reasoning
	return {
		...extracted,
		reasoning:
			inline && !native.includes(inline)
				? `${native}\n\n${inline}`
				: native
	}
}

/**
 * Where a reply is right now: still in its reasoning, writing its body, or not
 * started. What the live row's status follows (*{speaker} is reasoning* →
 * *{speaker} is typing*) — derived from the same split as the text, so the
 * status can never say "reasoning" over a body that is already streaming.
 */
export type ReplyPhase = "waiting" | "reasoning" | "writing"

/**
 * Whether the request put the model inside a reasoning block before its first
 * token — and how sure that is.
 *
 *  - `prompt` — the bytes this app sent end inside an open block
 *    ({@link endsInsideReasoning}). Certain: a generation that stops before
 *    its close is a truncated trace, and is kept as one.
 *  - `requested` — a chat template was asked to reason (KoboldCPP's
 *    `chat_template_kwargs.enable_thinking: true`) and the service hands the
 *    text back inline. Many such templates open the block themselves (Qwen3's
 *    thinking line, Qwen 3.5), so only the close is ever generated; a model
 *    that opens it itself is handled the same way. NOT certain — a model that
 *    ignores the switch never reasons at all — so a generation that ends with
 *    no close is the reply after all, and the record says so.
 *
 * Absent: nothing opened a block, and only the buffer's own delimiters count.
 */
export type ReasoningOpening = "prompt" | "requested"

export interface ReasoningStreamSplit {
	/** The body so far — never any reasoning, never a delimiter. */
	content: string
	/** The reasoning so far, native first. */
	reasoning: string | undefined
	phase: ReplyPhase
}

/** The opener a request-opened block is parsed as if it had been sent. */
const IMPLICIT_OPEN = "<think>"

/** The first delimiter opens a block, with nothing but whitespace before it. */
function opensItself(buffer: string): boolean {
	const first = scanTokens(buffer)[0]
	return (
		first !== undefined &&
		first.kind === "open" &&
		buffer.slice(0, first.index).trim().length === 0
	)
}

/**
 * The live split of a streaming reply — and, with `final`, the stored one.
 *
 * ONE function for both, so the frames a reader watches and the row that is
 * written cannot disagree about where reasoning ends: the only difference
 * `final` makes is what a block the REQUEST opened means when its close never
 * arrived (see {@link ReasoningOpening}). Everything else is
 * {@link resolveReasoning}, unchanged.
 *
 * ## The request-opened block
 *
 * With `opensInReasoning` set, the buffer is read as if the opener had been
 * sent in front of it — so `reasoning…` streams into the reasoning fold from
 * its first token, and the body starts with the first token after the close.
 * Three things turn that reading off, each a fact rather than a guess:
 *
 *  - the buffer opens a block itself (the template did not, the model did);
 *  - native reasoning has arrived — the service is separating the trace on
 *    its own channel, so the text channel is the body;
 *  - `final`, with a `requested` opening and no close — the model never
 *    reasoned, and the whole buffer is its reply.
 *
 * Never a reading of the content: nothing here decides that text
 * "looks like" reasoning. Only delimiters, native fields and what the request
 * said can move a sentence between the fold and the body.
 */
export function splitReasoningStream(
	buffer: string,
	nativeReasoning: string | undefined,
	opts: { opensInReasoning?: ReasoningOpening | null; final?: boolean } = {}
): ReasoningStreamSplit {
	const native = nativeReasoning?.trim() ? nativeReasoning : undefined
	const implicit =
		!!opts.opensInReasoning &&
		!native &&
		!opensItself(buffer) &&
		!(
			opts.final &&
			opts.opensInReasoning === "requested" &&
			!hasClose(buffer)
		)
	const parsed = resolveParse(
		implicit ? IMPLICIT_OPEN + buffer : buffer,
		native
	)
	const content = parsed.content.trim()
	const phase: ReplyPhase = parsed.unclosed
		? "reasoning"
		: content.length > 0
			? "writing"
			: parsed.reasoning !== undefined || implicit
				? "reasoning"
				: "waiting"
	return {
		content: parsed.content,
		reasoning: parsed.reasoning,
		phase
	}
}

function hasClose(buffer: string): boolean {
	return scanTokens(buffer).some((token) => token.kind === "close")
}
