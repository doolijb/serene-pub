import { describe, it, expect } from "vitest"
import { buildReasoningMetadata } from "./reasoningMetadata"

/**
 * The invariants under test are `projectLegacy`'s, not this function's: the
 * active swipe slot must equal the `content` column, and `reasoningHistory` must
 * stay parallel to `history`. Both storage defects were violations of exactly
 * those, and neither had a test.
 */
describe("buildReasoningMetadata — the parallel-history invariant", () => {
	it("keeps reasoningHistory the same length as history", () => {
		const meta = {
			swipes: { currentIdx: 2, history: ["a", "b", ""] }
		}
		const out = buildReasoningMetadata(meta, "c", "trace", true)
		expect(out.swipes.history).toHaveLength(3)
		expect(out.swipes.reasoningHistory).toHaveLength(3)
		expect(out.swipes.reasoningHistory).toEqual([null, null, "trace"])
	})

	it("pads a short reasoningHistory rather than leaving it ragged", () => {
		const meta = {
			swipes: { currentIdx: 1, history: ["a", ""], reasoningHistory: [] }
		}
		const out = buildReasoningMetadata(meta, "b", undefined, true)
		expect(out.swipes.reasoningHistory).toEqual([null, null])
	})

	it("trims a reasoningHistory that has outgrown history", () => {
		const meta = {
			swipes: {
				currentIdx: 0,
				history: ["a"],
				reasoningHistory: [null, "orphan", "orphan"]
			}
		}
		const out = buildReasoningMetadata(meta, "a", undefined, true)
		expect(out.swipes.reasoningHistory).toEqual([null])
	})

	it("mirrors the active slot's trace into metadata.reasoning", () => {
		const meta = { swipes: { currentIdx: 1, history: ["a", ""] } }
		const out = buildReasoningMetadata(meta, "b", "trace", true)
		expect(out.reasoning).toBe("trace")
		expect(out.swipes.reasoningHistory[1]).toBe("trace")
	})

	it("returns null when there is nothing to change", () => {
		expect(buildReasoningMetadata({}, "content", undefined, true)).toBeNull()
		expect(
			buildReasoningMetadata(null, "content", undefined, true)
		).toBeNull()
	})

	it("stores reasoning directly when the message has no swipes", () => {
		expect(
			buildReasoningMetadata({ isGreeting: true }, "c", "trace", true)
		).toEqual({ isGreeting: true, reasoning: "trace" })
	})

	it("leaves history alone when writeToHistory is false", () => {
		const meta = {
			swipes: { currentIdx: 1, history: ["a", "partial"] }
		}
		const out = buildReasoningMetadata(meta, "IGNORED", "trace", false)
		expect(out.swipes.history).toEqual(["a", "partial"])
		expect(out.swipes.reasoningHistory[1]).toBe("trace")
	})
})

describe("buildReasoningMetadata — storage case B: slot 0", () => {
	/**
	 * `sessionMessages:regenerate` clears `content` and leaves `currentIdx`
	 * untouched, so a message whose active swipe is slot 0 regenerates in place.
	 * The content write used to be guarded on `idx > 0` while the reasoning write
	 * was not, which put the new reasoning against the old text.
	 */
	it("writes content into slot 0, not just the trace", () => {
		const meta = {
			swipes: {
				currentIdx: 0,
				history: ["stale text"],
				reasoningHistory: [null]
			}
		}
		const out = buildReasoningMetadata(
			meta,
			"fresh text",
			"fresh trace",
			true
		)
		expect(out.swipes.history[0]).toBe("fresh text")
		expect(out.swipes.reasoningHistory[0]).toBe("fresh trace")
	})

	it("treats a null currentIdx as slot 0", () => {
		const meta = { swipes: { currentIdx: null, history: ["stale"] } }
		const out = buildReasoningMetadata(meta, "fresh", "trace", true)
		expect(out.swipes.history[0]).toBe("fresh")
		expect(out.swipes.reasoningHistory[0]).toBe("trace")
	})

	it("content and trace land together at every slot", () => {
		// The pair is the invariant; the slot index is not special.
		for (const idx of [0, 1, 2]) {
			const meta = {
				swipes: {
					currentIdx: idx,
					history: ["zero", "one", "two"],
					reasoningHistory: [null, null, null]
				}
			}
			const out = buildReasoningMetadata(meta, "fresh", "trace", true)
			expect(out.swipes.history[idx]).toBe("fresh")
			expect(out.swipes.reasoningHistory[idx]).toBe("trace")
		}
	})
})

describe("buildReasoningMetadata — storage case A: the aborted mid-stream frame", () => {
	/**
	 * On abort, the mid-stream write is the last one that lands: the final
	 * write is fenced out by the `isGenerating`/`queueItemId` predicate, because
	 * the cancel handler has already nulled `queueItemId`. So whatever the last
	 * frame put in `history[idx]` is what a later swipe-away-and-back reads.
	 * Mid-stream used to write the raw buffer there while the `content` column
	 * got the stripped text — reintroducing markup the column had already lost.
	 *
	 * The fix is that both writes now go through this one function, which is
	 * documented to take the content *as it will be written to the column*.
	 */
	it("history[idx] is whatever the content column is given", () => {
		const meta = {
			swipes: {
				currentIdx: 1,
				history: ["first", ""],
				reasoningHistory: [null, null]
			}
		}
		const columnContent = "Hello there"
		const out = buildReasoningMetadata(
			meta,
			columnContent,
			"reasoning",
			true
		)
		expect(out.swipes.history[1]).toBe(columnContent)
		expect(out.swipes.history[1]).not.toMatch(/<\/?think/i)
	})

	it("a continued message stores the joined content, not the delta", () => {
		// `isContinuing` prefixes the preserved text before the column write, so
		// the same string has to reach history or the two disagree on abort.
		const meta = {
			swipes: { currentIdx: 1, history: ["first", "was here"] }
		}
		const joined = "was here and now this"
		const out = buildReasoningMetadata(meta, joined, undefined, true)
		expect(out.swipes.history[1]).toBe(joined)
	})
})

describe("buildReasoningMetadata — null clears what the live frames showed", () => {
	it("clears the shown slot and its mirror on a row with swipes", () => {
		const meta = {
			reasoning: "the reply, streamed into the fold",
			swipes: {
				currentIdx: 1,
				history: ["a", ""],
				reasoningHistory: ["old trace", "the reply, streamed into the fold"]
			}
		}
		const out = buildReasoningMetadata(meta, "b", null, true)
		expect(out.reasoning).toBeNull()
		expect(out.swipes.reasoningHistory).toEqual(["old trace", null])
		expect(out.swipes.history).toEqual(["a", "b"])
	})

	it("clears the mirror on a row without swipes", () => {
		const out = buildReasoningMetadata({ reasoning: "stale" }, "b", null, true)
		expect(out).toEqual({ reasoning: null })
	})
})
