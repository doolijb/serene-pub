import { describe, it, expect } from "vitest"
import {
	endsInsideReasoning,
	extractReasoning,
	resolveReasoning,
	splitReasoningStream,
	REASONING_DELIMITER_FAMILIES,
	type ReasoningOpening,
	type ReasoningStreamSplit
} from "./reasoningDelimiters"

/**
 * This path had zero coverage, which is why four defects survived in it. The
 * cases below are named after the shapes a real model produces, not after the
 * branches of the implementation — a rewrite that keeps the shapes working is
 * allowed to fail none of these.
 */
describe("extractReasoning — delimiter families", () => {
	it("every family is attributed to a real model", () => {
		for (const family of REASONING_DELIMITER_FAMILIES) {
			expect(family.emittedBy.length).toBeGreaterThan(0)
		}
	})

	it("<think> — the de-facto standard", () => {
		expect(extractReasoning("<think>reasoning</think>Hello")).toEqual({
			content: "Hello",
			reasoning: "reasoning",
			matched: true
		})
	})

	it("<thinking>", () => {
		expect(extractReasoning("<thinking>reasoning</thinking>Hello")).toEqual({
			content: "Hello",
			reasoning: "reasoning",
			matched: true
		})
	})

	it("<reasoning>", () => {
		expect(
			extractReasoning("<reasoning>reasoning</reasoning>Hello")
		).toEqual({
			content: "Hello",
			reasoning: "reasoning",
			matched: true
		})
	})

	it("<seed:think> — ByteDance Seed-OSS", () => {
		expect(
			extractReasoning("<seed:think>reasoning</seed:think>Hello")
		).toEqual({
			content: "Hello",
			reasoning: "reasoning",
			matched: true
		})
	})

	it("<|begin_of_thought|> — OpenThoughts/Sky-T1 distills", () => {
		expect(
			extractReasoning(
				"<|begin_of_thought|>reasoning<|end_of_thought|>Hello"
			)
		).toEqual({
			content: "Hello",
			reasoning: "reasoning",
			matched: true
		})
	})

	it("◁think▷ — Moonshot Kimi", () => {
		expect(extractReasoning("◁think▷reasoning◁/think▷Hello")).toEqual({
			content: "Hello",
			reasoning: "reasoning",
			matched: true
		})
	})

	it("[THINK] — Mistral Magistral", () => {
		expect(extractReasoning("[THINK]reasoning[/THINK]Hello")).toEqual({
			content: "Hello",
			reasoning: "reasoning",
			matched: true
		})
	})

	it("<think> does not swallow the start of <thinking>", () => {
		// The open pattern requires `>` or whitespace after the name, so the
		// six-character prefix cannot match a longer family's tag.
		const out = extractReasoning("<thinking>r</thinking>Hello")
		expect(out.content).toBe("Hello")
		expect(out.reasoning).toBe("r")
	})
})

describe("extractReasoning — well-formedness and tolerance", () => {
	it("is case-insensitive for the XML families", () => {
		expect(extractReasoning("<THINK>r</Think>Hello").content).toBe("Hello")
		expect(extractReasoning("<ThInKiNg>r</THINKING>Hello").content).toBe(
			"Hello"
		)
	})

	it("tolerates whitespace inside the tag", () => {
		expect(extractReasoning("<think >r</think >Hello").content).toBe("Hello")
		expect(extractReasoning("<think\n>r</think\t>Hello").content).toBe(
			"Hello"
		)
	})

	it("tolerates attributes on the opening tag", () => {
		expect(
			extractReasoning('<think budget="512">r</think>Hello').content
		).toBe("Hello")
	})

	it("does not leave the blank line a stripped preamble sat on", () => {
		// The realistic shape: the model puts a newline or two between the close
		// and the reply. Left in, every reasoning model's replies would start
		// with leading whitespace the reader can see.
		expect(extractReasoning("<think>r</think>\n\nHello").content).toBe(
			"Hello"
		)
		expect(extractReasoning("r</think>\n  Hello").content).toBe("Hello")
	})

	it("strips several blocks and joins the traces", () => {
		expect(
			extractReasoning("<think>one</think>A<think>two</think>B")
		).toEqual({
			content: "AB",
			reasoning: "one\n\ntwo",
			matched: true
		})
	})

	it("a mismatched close still ends the block", () => {
		// Strictly matching families would read this as "never closed" and
		// swallow the whole reply into the reasoning pane.
		expect(extractReasoning("<think>r</thinking>Hello")).toEqual({
			content: "Hello",
			reasoning: "r",
			matched: true
		})
	})

	it("an empty block leaves no trace and no markup", () => {
		expect(extractReasoning("<think></think>Hello")).toEqual({
			content: "Hello",
			reasoning: undefined,
			matched: true
		})
	})

	it("delimiters inside a block are reasoning text, not structure", () => {
		expect(
			extractReasoning("<think>I could emit <think> here</think>Hello")
		).toEqual({
			content: "Hello",
			reasoning: "I could emit <think> here",
			matched: true
		})
	})
})

describe("extractReasoning — prefilled close (an opener the template emitted)", () => {
	it("treats everything before a lone close as reasoning", () => {
		// DeepSeek-R1's chat template emits the opening <think> itself, so the
		// model generates only the close. This is the common case, not an edge.
		expect(extractReasoning("reasoning</think>Hello")).toEqual({
			content: "Hello",
			reasoning: "reasoning",
			matched: true
		})
	})

	it("works for every family's close", () => {
		expect(extractReasoning("r[/THINK]Hello").reasoning).toBe("r")
		expect(extractReasoning("r◁/think▷Hello").reasoning).toBe("r")
		expect(extractReasoning("r<|end_of_thought|>Hello").reasoning).toBe("r")
		expect(extractReasoning("r</seed:think>Hello").reasoning).toBe("r")
	})

	it("a close with nothing before it is just a stray tag", () => {
		expect(extractReasoning("</think>Hello")).toEqual({
			content: "Hello",
			reasoning: undefined,
			matched: true
		})
	})

	it("only the FIRST delimiter can be a prefilled close", () => {
		// A close that appears after a pair has already been resolved is not a
		// prefill artifact — it is a stray tag, and the text around it is the
		// reply. Reading it as a prefill would eat the reply written before it.
		expect(
			extractReasoning("<think>r</think>Reply one</think>Reply two")
		).toEqual({
			content: "Reply oneReply two",
			reasoning: "r",
			matched: true
		})
	})
})

describe("extractReasoning — unclosed (truncated or still streaming)", () => {
	it("CAPTURES the remainder rather than discarding it", () => {
		// The old parser sliced the tail off and dropped it, so a cancelled
		// reasoning-only generation ended as an empty message with no reasoning.
		expect(extractReasoning("<think>partial reasoning")).toEqual({
			content: "",
			reasoning: "partial reasoning",
			matched: true
		})
	})

	it("keeps content written before the opener", () => {
		expect(extractReasoning("Hello <think>partial")).toEqual({
			content: "Hello ",
			reasoning: "partial",
			matched: true
		})
	})

	it("an opener at the very end yields no trace and no markup", () => {
		expect(extractReasoning("Hello <think>")).toEqual({
			content: "Hello ",
			reasoning: undefined,
			matched: true
		})
	})
})

describe("extractReasoning — idempotence", () => {
	const samples = [
		"<think>r</think>Hello",
		"reasoning</think>Hello",
		"<think>partial",
		"<think>one</think>A<think>two</think>B",
		"Hello with no delimiters at all",
		""
	]

	it("a second pass over stripped content is a no-op", () => {
		for (const sample of samples) {
			const once = extractReasoning(sample)
			const twice = extractReasoning(once.content)
			expect(twice.content).toBe(once.content)
			expect(twice.reasoning).toBeUndefined()
		}
	})

	it("a pass that matches nothing returns the input by identity", () => {
		const raw = "  Hello, nothing to strip here.  "
		const out = extractReasoning(raw)
		expect(out.matched).toBe(false)
		expect(out.content).toBe(raw)
		expect(out.reasoning).toBeUndefined()
	})

	it("survives a growing buffer, frame by frame", () => {
		// No COMPLETE delimiter ever reaches content, at any prefix length.
		// A *partial* one can (`"<think"` before its `>` arrives) and that is
		// deliberately not handled: the parse runs over the accumulated buffer,
		// so the next frame completes the tag and resolves it. Hiding a trailing
		// partial would mean deleting characters that might turn out to be
		// ordinary text, which is the one thing this module will not do.
		const full = "<think>reasoning about it</think>Hello there, friend."
		for (let i = 1; i <= full.length; i++) {
			const out = extractReasoning(full.slice(0, i))
			expect(out.content).not.toMatch(/<\/?think[^<]*>/i)
		}
	})
})

describe("extractReasoning — false positives", () => {
	it("a lone mention of an opening tag is CAPTURED, never deleted", () => {
		const raw = "Wrap your reasoning in a <think> tag, like so."
		// No close anywhere, so this IS read as an unclosed block. The rule is
		// permissive on purpose — an unclosed opener is how a truncated
		// generation looks — and the tail lands in the reasoning fold rather
		// than being dropped. A false positive here is text in the wrong place,
		// which a reader can see and an operator can recover.
		const out = extractReasoning(raw)
		expect(out.content).toBe("Wrap your reasoning in a ")
		expect(out.reasoning).toBe("tag, like so.")
	})

	it("leaves prose containing no delimiter untouched", () => {
		const raw = "I think, therefore I am. <b>Bold</b> and </p> too."
		expect(extractReasoning(raw)).toEqual({
			content: raw,
			reasoning: undefined,
			matched: false
		})
	})

	it("does not match a lowercase [think] — Magistral is uppercase only", () => {
		const raw = "press [think] to continue, then [/think]"
		expect(extractReasoning(raw)).toEqual({
			content: raw,
			reasoning: undefined,
			matched: false
		})
	})

	it("does not match tags whose name merely starts the same way", () => {
		const raw = "<thinker>x</thinker> and <reason>y</reason>"
		expect(extractReasoning(raw)).toEqual({
			content: raw,
			reasoning: undefined,
			matched: false
		})
	})

	it("never destroys text: content + reasoning accounts for what was there", () => {
		// The defence for the permissive rules above. Whatever the parser
		// decides, both halves come back to the caller.
		const sorted = (s: string) => [...s.replace(/\s/g, "")].sort().join("")
		for (const raw of [
			"reasoning</think>Hello",
			"<think>partial",
			"Wrap it in <think> like this"
		]) {
			const out = extractReasoning(raw)
			// Order moves — a prefilled close puts the reasoning first — so this
			// accounts for characters, not sequence.
			expect(sorted(out.content + (out.reasoning ?? ""))).toBe(
				sorted(raw.replace(/<\/?think[^>]*>/gi, ""))
			)
		}
	})
})

describe("resolveReasoning — precedence (Defect 1)", () => {
	it("native reasoning wins the trace, and the buffer is STILL stripped", () => {
		// The exact shape of Defect 1: the old guard skipped the strip whenever
		// native reasoning was present, leaving markup in the stored content.
		expect(
			resolveReasoning("<think>inline</think>Reply", "native trace")
		).toEqual({
			content: "Reply",
			reasoning: "native trace\n\ninline"
		})
	})

	it("native leads, but an inline trace is kept behind it, never deleted", () => {
		// "Native wins" decides the ORDER, not whether the other one survives.
		// Anything the parser lifted out of the text has to land somewhere a
		// reader can find it — that property is what the permissive matching
		// rules rest on, and it cannot be contingent on whether the adapter
		// happened to also report a trace of its own.
		const out = resolveReasoning(
			"Some reply <think>a block the model quoted</think>text",
			"the real trace"
		)
		expect(out.content).toBe("Some reply text")
		expect(out.reasoning).toBe("the real trace\n\na block the model quoted")
	})

	it("does not repeat a trace a backend reported twice", () => {
		// A backend that fills `reasoning_content` AND leaves the same block in
		// the text would otherwise show the reasoning twice.
		expect(
			resolveReasoning("<think>weighing it</think>Reply", "weighing it")
				.reasoning
		).toBe("weighing it")
		expect(
			resolveReasoning(
				"<think>weighing it</think>Reply",
				"I was weighing it up carefully"
			).reasoning
		).toBe("I was weighing it up carefully")
	})

	it("falls back to the inline trace when there is no native one", () => {
		expect(resolveReasoning("<think>inline</think>Reply", "")).toEqual({
			content: "Reply",
			reasoning: "inline"
		})
		expect(
			resolveReasoning("<think>inline</think>Reply", undefined)
		).toEqual({
			content: "Reply",
			reasoning: "inline"
		})
	})

	it("whitespace-only native reasoning is not native reasoning", () => {
		expect(resolveReasoning("<think>inline</think>Reply", "  \n ")).toEqual({
			content: "Reply",
			reasoning: "inline"
		})
	})

	it("strips EVERY frame of a growing buffer, not just the first", () => {
		// Deterministic replacement for the timing-dependent original: the
		// frames are driven explicitly rather than left to the ~120ms throttle.
		// Under the old code frame 2 set the trace, which disabled the strip
		// on frame 3 and let `<think>…</think>Hello there` reach the content
		// column verbatim.
		const frames = [
			"<think>reason",
			"<think>reasoning</think>Hel",
			"<think>reasoning</think>Hello there"
		]
		let nativeReasoning = ""
		const persisted = frames.map((frame) => {
			const resolved = resolveReasoning(frame, nativeReasoning)
			// Mirrors the loop: only the native callback may grow this.
			return resolved
		})
		expect(nativeReasoning).toBe("")
		for (const frame of persisted) {
			expect(frame.content).not.toMatch(/<\/?think/i)
		}
		expect(persisted.at(-1)).toEqual({
			content: "Hello there",
			reasoning: "reasoning"
		})
	})

	it("strips every frame when native reasoning is arriving too", () => {
		// The same loop with a live reasoningCb: the trace comes from the
		// callback, and the content is clean on every single frame.
		const frames = [
			"Hel",
			"Hello there",
			"Hello there<think>a stray block</think>!"
		]
		let nativeReasoning = ""
		const persisted = frames.map((frame) => {
			nativeReasoning += "native "
			return {
				resolved: resolveReasoning(frame, nativeReasoning),
				expectedTrace: nativeReasoning.trim()
			}
		})
		for (const { resolved, expectedTrace } of persisted) {
			expect(resolved.content).not.toMatch(/<\/?think/i)
			// The native trace as it stood on THAT frame always leads.
			expect(resolved.reasoning!.startsWith(expectedTrace)).toBe(true)
		}
		// The last frame carried a complete inline block as well: the text is
		// cleaned of it, and it is kept behind the native trace rather than lost.
		expect(persisted.at(-1)!.resolved).toEqual({
			content: "Hello there!",
			reasoning: "native native native\n\na stray block"
		})
	})
})

/**
 * The live split, driven the way the live row drives it: chunks appended to a
 * buffer, the whole buffer re-split on every frame. Each frame's view is what a
 * reader sees; the last call with `final` is what the row stores.
 */
function stream(
	chunks: string[],
	opts: {
		opensInReasoning?: ReasoningOpening
		native?: string[]
	} = {}
): { frames: ReasoningStreamSplit[]; final: ReasoningStreamSplit } {
	let buffer = ""
	let native = ""
	const frames: ReasoningStreamSplit[] = []
	const count = Math.max(chunks.length, opts.native?.length ?? 0)
	for (let i = 0; i < count; i++) {
		native += opts.native?.[i] ?? ""
		buffer += chunks[i] ?? ""
		frames.push(
			splitReasoningStream(buffer, native, {
				opensInReasoning: opts.opensInReasoning
			})
		)
	}
	return {
		frames,
		final: splitReasoningStream(buffer, native, {
			opensInReasoning: opts.opensInReasoning,
			final: true
		})
	}
}

describe("splitReasoningStream — live routing over chunk sequences", () => {
	it("no reasoning: every frame is body, phase writing", () => {
		const { frames, final } = stream(["Hel", "lo ", "there."])
		expect(frames.map((f) => f.content)).toEqual([
			"Hel",
			"Hello ",
			"Hello there."
		])
		expect(frames.every((f) => f.reasoning === undefined)).toBe(true)
		expect(frames.every((f) => f.phase === "writing")).toBe(true)
		expect(final).toEqual({
			content: "Hello there.",
			reasoning: undefined,
			phase: "writing"
		})
	})

	it("a <think> split across chunk boundaries never reaches the body", () => {
		const { frames, final } = stream([
			"<thi",
			"nk>weigh",
			"ing it</th",
			"ink>\n\nHe",
			"llo."
		])
		// "<thi" alone is no delimiter yet — it is shown as body for one frame
		// at most, and is gone the frame the opener completes.
		for (const frame of frames.slice(1, 3)) {
			expect(frame.content).toBe("")
			expect(frame.phase).toBe("reasoning")
		}
		expect(frames[2]!.reasoning).toBe("weighing it</th")
		expect(frames[3]).toEqual({
			content: "He",
			reasoning: "weighing it",
			phase: "writing"
		})
		expect(final).toEqual({
			content: "Hello.",
			reasoning: "weighing it",
			phase: "writing"
		})
	})

	it("a template-opened block (only </think> arrives): routed from the FIRST token when the request opened it", () => {
		const { frames, final } = stream(
			["Okay, the", " user wants", " a greeting.</th", "ink>\n\nHi", "!"],
			{ opensInReasoning: "requested" }
		)
		expect(frames[0]).toEqual({
			content: "",
			reasoning: "Okay, the",
			phase: "reasoning"
		})
		expect(frames[1]!.content).toBe("")
		expect(frames[2]!.content).toBe("")
		expect(frames[2]!.phase).toBe("reasoning")
		expect(frames[3]).toEqual({
			content: "Hi",
			reasoning: "Okay, the user wants a greeting.",
			phase: "writing"
		})
		expect(final).toEqual({
			content: "Hi!",
			reasoning: "Okay, the user wants a greeting.",
			phase: "writing"
		})
	})

	it("without the request fact the same stream corrects itself when the close lands, and the record agrees", () => {
		const { frames, final } = stream([
			"Okay, the",
			" user wants a greeting.</think>",
			"Hi!"
		])
		expect(frames[0]!.content).toBe("Okay, the")
		expect(frames[1]).toEqual({
			content: "",
			reasoning: "Okay, the user wants a greeting.",
			phase: "reasoning"
		})
		expect(final.content).toBe("Hi!")
		expect(final.reasoning).toBe("Okay, the user wants a greeting.")
	})

	it("a model that opens the block itself is handled the same under a requested opening", () => {
		const { frames, final } = stream(
			["<think>", "hm", "</think>", "Yes."],
			{ opensInReasoning: "requested" }
		)
		expect(frames[1]).toEqual({
			content: "",
			reasoning: "hm",
			phase: "reasoning"
		})
		expect(final).toEqual({
			content: "Yes.",
			reasoning: "hm",
			phase: "writing"
		})
	})

	it("unterminated reasoning under a REQUESTED opening is the reply after all — the model never reasoned", () => {
		const { frames, final } = stream(["Hello", " there."], {
			opensInReasoning: "requested"
		})
		// Live it waits in the fold: nothing yet says it is not reasoning.
		expect(frames.every((f) => f.content === "")).toBe(true)
		expect(frames.at(-1)!.phase).toBe("reasoning")
		// Stored, it is the body: no close ever arrived.
		expect(final).toEqual({
			content: "Hello there.",
			reasoning: undefined,
			phase: "writing"
		})
	})

	it("unterminated reasoning under a PROMPT opening is a truncated trace, kept as one", () => {
		const { final } = stream(["Weighing the", " door"], {
			opensInReasoning: "prompt"
		})
		expect(final).toEqual({
			content: "",
			reasoning: "Weighing the door",
			phase: "reasoning"
		})
	})

	it("an unterminated inline <think> is captured as reasoning, live and stored", () => {
		const { frames, final } = stream(["<think>still go", "ing"])
		expect(frames.at(-1)).toEqual({
			content: "",
			reasoning: "still going",
			phase: "reasoning"
		})
		expect(final.reasoning).toBe("still going")
		expect(final.content).toBe("")
	})

	it("reasoning-only, then body: native trace first, then the text channel is the body", () => {
		const { frames, final } = stream(["", "", "Sure", ", here."], {
			opensInReasoning: "requested",
			native: ["Think", "ing hard", "", ""]
		})
		expect(frames[0]).toEqual({
			content: "",
			reasoning: "Think",
			phase: "reasoning"
		})
		expect(frames[1]!.phase).toBe("reasoning")
		// Native reasoning arrived, so the request-opened reading is off: the
		// content channel is the body from its first token.
		expect(frames[2]).toEqual({
			content: "Sure",
			reasoning: "Thinking hard",
			phase: "writing"
		})
		expect(final).toEqual({
			content: "Sure, here.",
			reasoning: "Thinking hard",
			phase: "writing"
		})
	})

	it("the live frame with the close and the stored record never disagree", () => {
		const chunks = ["R1 ", "R2</think>", "\n\nBody ", "text"]
		for (const opensInReasoning of [undefined, "requested", "prompt"] as const) {
			const { frames, final } = stream(chunks, { opensInReasoning })
			const last = frames.at(-1)!
			expect(last.content).toBe(final.content)
			expect(last.reasoning).toBe(final.reasoning)
		}
	})
})

describe("endsInsideReasoning — a fact about the request", () => {
	it("a prompt ending on an opener is inside", () => {
		expect(endsInsideReasoning("<|im_start|>assistant\n<think>\n")).toBe(true)
	})
	it("a closed block, or none, is not", () => {
		expect(endsInsideReasoning("<think>\n\n</think>\n\nVerity:")).toBe(false)
		expect(endsInsideReasoning("<|im_start|>assistant\nVerity:")).toBe(false)
	})
})
