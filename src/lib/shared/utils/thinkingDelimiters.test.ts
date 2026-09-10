import { describe, it, expect } from "vitest"
import {
	extractThinking,
	resolveThinking,
	THINKING_DELIMITER_FAMILIES
} from "./thinkingDelimiters"

/**
 * This path had zero coverage, which is why four defects survived in it. The
 * cases below are named after the shapes a real model produces, not after the
 * branches of the implementation — a rewrite that keeps the shapes working is
 * allowed to fail none of these.
 */
describe("extractThinking — delimiter families", () => {
	it("every family is attributed to a real model", () => {
		for (const family of THINKING_DELIMITER_FAMILIES) {
			expect(family.emittedBy.length).toBeGreaterThan(0)
		}
	})

	it("<think> — the de-facto standard", () => {
		expect(extractThinking("<think>reasoning</think>Hello")).toEqual({
			content: "Hello",
			thinking: "reasoning",
			matched: true
		})
	})

	it("<thinking>", () => {
		expect(extractThinking("<thinking>reasoning</thinking>Hello")).toEqual({
			content: "Hello",
			thinking: "reasoning",
			matched: true
		})
	})

	it("<reasoning>", () => {
		expect(
			extractThinking("<reasoning>reasoning</reasoning>Hello")
		).toEqual({
			content: "Hello",
			thinking: "reasoning",
			matched: true
		})
	})

	it("<seed:think> — ByteDance Seed-OSS", () => {
		expect(
			extractThinking("<seed:think>reasoning</seed:think>Hello")
		).toEqual({
			content: "Hello",
			thinking: "reasoning",
			matched: true
		})
	})

	it("<|begin_of_thought|> — OpenThoughts/Sky-T1 distills", () => {
		expect(
			extractThinking(
				"<|begin_of_thought|>reasoning<|end_of_thought|>Hello"
			)
		).toEqual({
			content: "Hello",
			thinking: "reasoning",
			matched: true
		})
	})

	it("◁think▷ — Moonshot Kimi", () => {
		expect(extractThinking("◁think▷reasoning◁/think▷Hello")).toEqual({
			content: "Hello",
			thinking: "reasoning",
			matched: true
		})
	})

	it("[THINK] — Mistral Magistral", () => {
		expect(extractThinking("[THINK]reasoning[/THINK]Hello")).toEqual({
			content: "Hello",
			thinking: "reasoning",
			matched: true
		})
	})

	it("<think> does not swallow the start of <thinking>", () => {
		// The open pattern requires `>` or whitespace after the name, so the
		// six-character prefix cannot match a longer family's tag.
		const out = extractThinking("<thinking>r</thinking>Hello")
		expect(out.content).toBe("Hello")
		expect(out.thinking).toBe("r")
	})
})

describe("extractThinking — well-formedness and tolerance", () => {
	it("is case-insensitive for the XML families", () => {
		expect(extractThinking("<THINK>r</Think>Hello").content).toBe("Hello")
		expect(extractThinking("<ThInKiNg>r</THINKING>Hello").content).toBe(
			"Hello"
		)
	})

	it("tolerates whitespace inside the tag", () => {
		expect(extractThinking("<think >r</think >Hello").content).toBe("Hello")
		expect(extractThinking("<think\n>r</think\t>Hello").content).toBe(
			"Hello"
		)
	})

	it("tolerates attributes on the opening tag", () => {
		expect(
			extractThinking('<think budget="512">r</think>Hello').content
		).toBe("Hello")
	})

	it("does not leave the blank line a stripped preamble sat on", () => {
		// The realistic shape: the model puts a newline or two between the close
		// and the reply. Left in, every reasoning model's replies would start
		// with leading whitespace the reader can see.
		expect(extractThinking("<think>r</think>\n\nHello").content).toBe(
			"Hello"
		)
		expect(extractThinking("r</think>\n  Hello").content).toBe("Hello")
	})

	it("strips several blocks and joins the traces", () => {
		expect(
			extractThinking("<think>one</think>A<think>two</think>B")
		).toEqual({
			content: "AB",
			thinking: "one\n\ntwo",
			matched: true
		})
	})

	it("a mismatched close still ends the block", () => {
		// Strictly matching families would read this as "never closed" and
		// swallow the whole reply into the reasoning pane.
		expect(extractThinking("<think>r</thinking>Hello")).toEqual({
			content: "Hello",
			thinking: "r",
			matched: true
		})
	})

	it("an empty block leaves no trace and no markup", () => {
		expect(extractThinking("<think></think>Hello")).toEqual({
			content: "Hello",
			thinking: undefined,
			matched: true
		})
	})

	it("delimiters inside a block are reasoning text, not structure", () => {
		expect(
			extractThinking("<think>I could emit <think> here</think>Hello")
		).toEqual({
			content: "Hello",
			thinking: "I could emit <think> here",
			matched: true
		})
	})
})

describe("extractThinking — prefilled close (an opener the template emitted)", () => {
	it("treats everything before a lone close as reasoning", () => {
		// DeepSeek-R1's chat template emits the opening <think> itself, so the
		// model generates only the close. This is the common case, not an edge.
		expect(extractThinking("reasoning</think>Hello")).toEqual({
			content: "Hello",
			thinking: "reasoning",
			matched: true
		})
	})

	it("works for every family's close", () => {
		expect(extractThinking("r[/THINK]Hello").thinking).toBe("r")
		expect(extractThinking("r◁/think▷Hello").thinking).toBe("r")
		expect(extractThinking("r<|end_of_thought|>Hello").thinking).toBe("r")
		expect(extractThinking("r</seed:think>Hello").thinking).toBe("r")
	})

	it("a close with nothing before it is just a stray tag", () => {
		expect(extractThinking("</think>Hello")).toEqual({
			content: "Hello",
			thinking: undefined,
			matched: true
		})
	})

	it("only the FIRST delimiter can be a prefilled close", () => {
		// A close that appears after a pair has already been resolved is not a
		// prefill artifact — it is a stray tag, and the text around it is the
		// reply. Reading it as a prefill would eat the reply written before it.
		expect(
			extractThinking("<think>r</think>Reply one</think>Reply two")
		).toEqual({
			content: "Reply oneReply two",
			thinking: "r",
			matched: true
		})
	})
})

describe("extractThinking — unclosed (truncated or still streaming)", () => {
	it("CAPTURES the remainder rather than discarding it", () => {
		// The old parser sliced the tail off and dropped it, so a cancelled
		// reasoning-only generation ended as an empty message with no thinking.
		expect(extractThinking("<think>partial reasoning")).toEqual({
			content: "",
			thinking: "partial reasoning",
			matched: true
		})
	})

	it("keeps content written before the opener", () => {
		expect(extractThinking("Hello <think>partial")).toEqual({
			content: "Hello ",
			thinking: "partial",
			matched: true
		})
	})

	it("an opener at the very end yields no trace and no markup", () => {
		expect(extractThinking("Hello <think>")).toEqual({
			content: "Hello ",
			thinking: undefined,
			matched: true
		})
	})
})

describe("extractThinking — idempotence", () => {
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
			const once = extractThinking(sample)
			const twice = extractThinking(once.content)
			expect(twice.content).toBe(once.content)
			expect(twice.thinking).toBeUndefined()
		}
	})

	it("a pass that matches nothing returns the input by identity", () => {
		const raw = "  Hello, nothing to strip here.  "
		const out = extractThinking(raw)
		expect(out.matched).toBe(false)
		expect(out.content).toBe(raw)
		expect(out.thinking).toBeUndefined()
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
			const out = extractThinking(full.slice(0, i))
			expect(out.content).not.toMatch(/<\/?think[^<]*>/i)
		}
	})
})

describe("extractThinking — false positives", () => {
	it("a lone mention of an opening tag is CAPTURED, never deleted", () => {
		const raw = "Wrap your reasoning in a <think> tag, like so."
		// No close anywhere, so this IS read as an unclosed block. The rule is
		// permissive on purpose — an unclosed opener is how a truncated
		// generation looks — and the tail lands in the thinking pane rather
		// than being dropped. A false positive here is text in the wrong place,
		// which a reader can see and an operator can recover.
		const out = extractThinking(raw)
		expect(out.content).toBe("Wrap your reasoning in a ")
		expect(out.thinking).toBe("tag, like so.")
	})

	it("leaves prose containing no delimiter untouched", () => {
		const raw = "I think, therefore I am. <b>Bold</b> and </p> too."
		expect(extractThinking(raw)).toEqual({
			content: raw,
			thinking: undefined,
			matched: false
		})
	})

	it("does not match a lowercase [think] — Magistral is uppercase only", () => {
		const raw = "press [think] to continue, then [/think]"
		expect(extractThinking(raw)).toEqual({
			content: raw,
			thinking: undefined,
			matched: false
		})
	})

	it("does not match tags whose name merely starts the same way", () => {
		const raw = "<thinker>x</thinker> and <reason>y</reason>"
		expect(extractThinking(raw)).toEqual({
			content: raw,
			thinking: undefined,
			matched: false
		})
	})

	it("never destroys text: content + thinking accounts for what was there", () => {
		// The defence for the permissive rules above. Whatever the parser
		// decides, both halves come back to the caller.
		const sorted = (s: string) => [...s.replace(/\s/g, "")].sort().join("")
		for (const raw of [
			"reasoning</think>Hello",
			"<think>partial",
			"Wrap it in <think> like this"
		]) {
			const out = extractThinking(raw)
			// Order moves — a prefilled close puts the reasoning first — so this
			// accounts for characters, not sequence.
			expect(sorted(out.content + (out.thinking ?? ""))).toBe(
				sorted(raw.replace(/<\/?think[^>]*>/gi, ""))
			)
		}
	})
})

describe("resolveThinking — precedence (Defect 1)", () => {
	it("native reasoning wins the trace, and the buffer is STILL stripped", () => {
		// The exact shape of Defect 1: the old guard skipped the strip whenever
		// native thinking was present, leaving markup in the stored content.
		expect(
			resolveThinking("<think>inline</think>Reply", "native trace")
		).toEqual({
			content: "Reply",
			thinking: "native trace\n\ninline"
		})
	})

	it("native leads, but an inline trace is kept behind it, never deleted", () => {
		// "Native wins" decides the ORDER, not whether the other one survives.
		// Anything the parser lifted out of the text has to land somewhere a
		// reader can find it — that property is what the permissive matching
		// rules rest on, and it cannot be contingent on whether the adapter
		// happened to also report a trace of its own.
		const out = resolveThinking(
			"Some reply <think>a block the model quoted</think>text",
			"the real trace"
		)
		expect(out.content).toBe("Some reply text")
		expect(out.thinking).toBe("the real trace\n\na block the model quoted")
	})

	it("does not repeat a trace a backend reported twice", () => {
		// A backend that fills `reasoning_content` AND leaves the same block in
		// the text would otherwise show the reasoning twice.
		expect(
			resolveThinking("<think>weighing it</think>Reply", "weighing it")
				.thinking
		).toBe("weighing it")
		expect(
			resolveThinking(
				"<think>weighing it</think>Reply",
				"I was weighing it up carefully"
			).thinking
		).toBe("I was weighing it up carefully")
	})

	it("falls back to the inline trace when there is no native one", () => {
		expect(resolveThinking("<think>inline</think>Reply", "")).toEqual({
			content: "Reply",
			thinking: "inline"
		})
		expect(
			resolveThinking("<think>inline</think>Reply", undefined)
		).toEqual({
			content: "Reply",
			thinking: "inline"
		})
	})

	it("whitespace-only native reasoning is not native reasoning", () => {
		expect(resolveThinking("<think>inline</think>Reply", "  \n ")).toEqual({
			content: "Reply",
			thinking: "inline"
		})
	})

	it("strips EVERY frame of a growing buffer, not just the first", () => {
		// Deterministic replacement for the timing-dependent original: the
		// frames are driven explicitly rather than left to the ~120ms throttle.
		// Under the old code frame 2 set `thinking`, which disabled the strip
		// on frame 3 and let `<think>…</think>Hello there` reach the content
		// column verbatim.
		const frames = [
			"<think>reason",
			"<think>reasoning</think>Hel",
			"<think>reasoning</think>Hello there"
		]
		let nativeThinking = ""
		const persisted = frames.map((frame) => {
			const resolved = resolveThinking(frame, nativeThinking)
			// Mirrors the loop: only the native callback may grow this.
			return resolved
		})
		expect(nativeThinking).toBe("")
		for (const frame of persisted) {
			expect(frame.content).not.toMatch(/<\/?think/i)
		}
		expect(persisted.at(-1)).toEqual({
			content: "Hello there",
			thinking: "reasoning"
		})
	})

	it("strips every frame when native reasoning is arriving too", () => {
		// The same loop with a live thinkingCb: the trace comes from the
		// callback, and the content is clean on every single frame.
		const frames = [
			"Hel",
			"Hello there",
			"Hello there<think>a stray block</think>!"
		]
		let nativeThinking = ""
		const persisted = frames.map((frame) => {
			nativeThinking += "native "
			return {
				resolved: resolveThinking(frame, nativeThinking),
				expectedTrace: nativeThinking.trim()
			}
		})
		for (const { resolved, expectedTrace } of persisted) {
			expect(resolved.content).not.toMatch(/<\/?think/i)
			// The native trace as it stood on THAT frame always leads.
			expect(resolved.thinking!.startsWith(expectedTrace)).toBe(true)
		}
		// The last frame carried a complete inline block as well: the text is
		// cleaned of it, and it is kept behind the native trace rather than lost.
		expect(persisted.at(-1)!.resolved).toEqual({
			content: "Hello there!",
			thinking: "native native native\n\na stray block"
		})
	})
})
