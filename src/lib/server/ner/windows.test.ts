/**
 * A passage longer than the checkpoint's window, read in overlapping windows.
 *
 * transformers.js truncates at the model's token limit (512 on both catalogue
 * models), so `extractNerSpans` cuts a long passage into windows, runs each and
 * maps the spans back onto the whole string. What can go wrong is arithmetic —
 * an offset off by a window's start, a name counted twice in an overlap, a name
 * a cut fell inside reported by its visible half — and none of it fails
 * loudly, so every property is asserted here.
 *
 * ⚠ The pipeline is a stand-in and deterministic. It "recognises" a fixed set
 * of names wherever they appear in the window it is handed, with a score that
 * depends on where in THAT window the name sits, so one name read by two
 * windows comes back with two different scores. A token is a whitespace word;
 * the tokenizer adds two specials, as BERT's does.
 */

import { afterEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
	/** Every window the stand-in pipeline was handed. */
	asked: [] as string[],
	/** The tokenizer's `model_max_length`, or null for a pipeline with no tokenizer. */
	tokenLimit: null as number | null
}))

/** Importing the real database would migrate a PGlite instance per file. */
vi.mock("$lib/server/db", () => ({ db: {} }))

vi.mock("@huggingface/transformers", () => ({
	env: {},
	pipeline: vi.fn(async () => {
		const run = async (window: string) => {
			state.asked.push(window)
			return recognise(window)
		}
		if (state.tokenLimit === null) return run
		return Object.assign(run, {
			tokenizer: {
				encode: (s: string) => new Array(tokenCount(s)).fill(0),
				model_max_length: state.tokenLimit
			},
			model: { config: { max_position_embeddings: 512 } }
		})
	})
}))

const MODEL = "Xenova/bert-base-NER"

/** A whitespace word is a token, plus `[CLS]` and `[SEP]`. */
function tokenCount(s: string): number {
	return s.split(/\s+/).filter(Boolean).length + 2
}

/**
 * The stand-in model: every name it knows, in reading order, with a score that
 * rises towards the END of the window it was handed.
 *
 * `Ashguard` with no `Riders` after it is what a window cut between the two
 * words sees — and it is scored HIGHER than the whole name on purpose, so the
 * rule that drops a clipped span is tested against the score rule, not with
 * its help.
 */
function recognise(window: string) {
	const out: Array<{ entity_group: string; score: number; word: string }> = []
	for (const m of window.matchAll(
		/Ashguard Riders|Ashguard|Lowmarket|Cade|Vell/g
	)) {
		const word = m[0]
		out.push({
			entity_group:
				word === "Lowmarket"
					? "LOC"
					: word.startsWith("Ashguard")
						? "ORG"
						: "PER",
			score:
				word === "Ashguard"
					? 0.999
					: 0.5 + 0.4 * ((m.index ?? 0) / window.length),
			word
		})
	}
	return out
}

/** Every place `name` occurs in `text`, as `[start, end)`. */
function occurrences(text: string, name: RegExp) {
	return [...text.matchAll(name)].map((m) => [
		m.index!,
		m.index! + m[0].length
	])
}

async function loaded() {
	const ner = await import("./index")
	await ner.loadNerModel(MODEL)
	return ner
}

afterEach(async () => {
	state.asked = []
	state.tokenLimit = null
	const { unloadNerModel } = await import("./index")
	unloadNerModel("test cleanup")
})

describe("planWindows", () => {
	const text = Array.from(
		{ length: 120 },
		(_, i) => `Line ${i}: the caravan rolled on through the dust.`
	).join(" ")

	it("is one window for a passage that fits", async () => {
		const { planWindows } = await import("./index")
		expect(planWindows("Cade waited.", () => true)).toEqual([
			{ start: 0, end: 12 }
		])
		expect(planWindows("Cade waited.", null)).toEqual([
			{ start: 0, end: 12 }
		])
	})

	it("covers the passage with overlapping windows that each fit", async () => {
		const { planWindows } = await import("./index")
		const fits = (w: string) => tokenCount(w) <= 64
		const windows = planWindows(text, fits)

		expect(windows.length).toBeGreaterThan(1)
		expect(windows[0].start).toBe(0)
		expect(windows.at(-1)!.end).toBe(text.length)
		for (const [i, w] of windows.entries()) {
			expect(fits(text.slice(w.start, w.end))).toBe(true)
			// A window starts on a word and ends on one, with whitespace
			// either side, so the model is never handed half a word.
			if (w.start > 0) {
				expect(text[w.start - 1]).toMatch(/\s/)
				expect(text[w.start]).toMatch(/\S/)
			}
			if (w.end < text.length) {
				expect(text[w.end]).toMatch(/\s/)
				expect(text[w.end - 1]).toMatch(/\S/)
			}
			if (i > 0) {
				// Strictly forward, and overlapping its predecessor.
				expect(w.start).toBeGreaterThan(windows[i - 1].start)
				expect(w.start).toBeLessThan(windows[i - 1].end)
			}
		}
	})

	it("windows by characters alone when there is no tokenizer", async () => {
		const { planWindows, NER_WINDOW_CHARS } = await import("./index")
		const windows = planWindows(text, null)
		expect(windows.length).toBeGreaterThan(1)
		for (const w of windows)
			expect(w.end - w.start).toBeLessThanOrEqual(NER_WINDOW_CHARS)
	})
})

describe("mergeWindowSpans", () => {
	const span = (over: Record<string, unknown>) =>
		({
			text: "Cade",
			label: "PER",
			start: 10,
			end: 14,
			score: 0.5,
			clipped: false,
			...over
		}) as any

	it("keeps the higher score of one name two windows both read", async () => {
		const { mergeWindowSpans } = await import("./index")
		expect(
			mergeWindowSpans([span({ score: 0.6 }), span({ score: 0.9 })])
		).toEqual([
			{ text: "Cade", label: "PER", start: 10, end: 14, score: 0.9 }
		])
	})

	it("drops a clipped span for the whole one, whatever it scored", async () => {
		const { mergeWindowSpans } = await import("./index")
		const merged = mergeWindowSpans([
			span({
				text: "Ashguard",
				label: "ORG",
				start: 20,
				end: 28,
				score: 0.99,
				clipped: true
			}),
			span({
				text: "Ashguard Riders",
				label: "ORG",
				start: 20,
				end: 35,
				score: 0.7
			})
		])
		expect(merged.map((s) => s.text)).toEqual(["Ashguard Riders"])
	})

	it("leaves spans that do not overlap alone, in order", async () => {
		const { mergeWindowSpans } = await import("./index")
		const merged = mergeWindowSpans([
			span({ text: "Vell", start: 30, end: 34 }),
			span({})
		])
		expect(merged.map((s) => [s.text, s.start])).toEqual([
			["Cade", 10],
			["Vell", 30]
		])
	})
})

describe("extractNerSpans on a long passage", () => {
	const text = Array.from(
		{ length: 80 },
		(_, i) =>
			`Day ${i}: Cade met Vell at Lowmarket, near where the Ashguard Riders camp.`
	).join(" ")

	it("reads past the token window and finds every mention exactly once", async () => {
		state.tokenLimit = 64
		const ner = await loaded()
		const spans = await ner.extractNerSpans(text)

		// It ran in windows, each one inside the limit…
		expect(state.asked.length).toBeGreaterThan(1)
		for (const w of state.asked)
			expect(tokenCount(w)).toBeLessThanOrEqual(64)
		// …and the tail was read, which truncation would not have done.
		expect(spans.at(-1)!.end).toBeGreaterThan(text.length - 20)

		// Every offset spells its own surface in the WHOLE text.
		for (const s of spans) expect(text.slice(s.start, s.end)).toBe(s.text)
		// One span per mention: nothing doubled in an overlap.
		for (let i = 1; i < spans.length; i++)
			expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end)
		for (const [name, re] of [
			["Cade", /Cade/g],
			["Vell", /Vell/g],
			["Lowmarket", /Lowmarket/g],
			["Ashguard Riders", /Ashguard Riders/g]
		] as const)
			expect(
				spans
					.filter((s) => s.text === name)
					.map((s) => [s.start, s.end])
			).toEqual(occurrences(text, re))
		expect(spans.some((s) => s.text === "Ashguard")).toBe(false)
	})

	it("keeps, for a mention two windows read, the higher of their scores", async () => {
		state.tokenLimit = 64
		const ner = await loaded()
		const spans = await ner.extractNerSpans(text)
		const windows = ner.planWindows(text, (w) => tokenCount(w) <= 64)

		let readTwice = 0
		for (const s of spans) {
			const reads = windows
				.filter((w) => w.start <= s.start && s.end <= w.end)
				.map((w) => ({
					score:
						0.5 + 0.4 * ((s.start - w.start) / (w.end - w.start)),
					// In the window's first or last word: it may continue past
					// the cut, so a whole reading elsewhere is preferred to it.
					clipped:
						(w.start > 0 &&
							!/\s/.test(text.slice(w.start, s.start))) ||
						(w.end < text.length &&
							!/\s/.test(text.slice(s.end, w.end)))
				}))
			if (reads.length > 1) readTwice++
			const whole = reads.filter((r) => !r.clipped)
			const best = Math.max(
				...(whole.length ? whole : reads).map((r) => r.score)
			)
			expect(s.score).toBeCloseTo(best, 10)
		}
		// The overlaps really were exercised.
		expect(readTwice).toBeGreaterThan(0)
	})

	it("reports a name a cut fell inside by the window that read it whole", async () => {
		// Purely by characters (no tokenizer), with the first window's cut
		// landing exactly between `Ashguard` and `Riders`.
		const ner = await loaded()
		const filler = "lorem ".repeat(248) + "abc "
		const at = filler.length
		const passage = `${filler}Ashguard Riders rode on. ${"dolor ".repeat(20)}`
		expect(ner.planWindows(passage, null)[0].end).toBe(at + 8)

		const spans = await ner.extractNerSpans(passage)
		expect(state.asked[0].endsWith("Ashguard")).toBe(true)
		expect(spans).toEqual([
			expect.objectContaining({
				text: "Ashguard Riders",
				label: "ORG",
				start: at,
				end: at + 15
			})
		])
	})

	it("hands a passage that fits to the model whole, once", async () => {
		state.tokenLimit = 64
		const ner = await loaded()
		const short = "Cade crossed Lowmarket before Cade spoke."
		const spans = await ner.extractNerSpans(short)
		expect(state.asked).toEqual([short])
		expect(spans.map((s) => [s.text, s.start])).toEqual([
			["Cade", 0],
			["Lowmarket", 13],
			["Cade", 30]
		])
	})
})
