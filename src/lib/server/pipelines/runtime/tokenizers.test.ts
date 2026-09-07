/**
 * The twelve tokenizers, offered once and spelled the same on both paths.
 *
 * A person picks a tokenizer on a connection form. Two entirely separate pieces
 * of machinery then have to honour that one choice: `TokenCounterManager`, which
 * the adapters and the legacy generation path use, and the SDK's registry, which
 * a pipeline run budgets with. They are different code with different shapes —
 * one is async-or-sync per call, the other loads once and counts synchronously —
 * and nothing in either type system says they must agree.
 *
 * So it is asserted here, id by id, on real text. Two counters that disagree
 * about what "Llama 3" means would show up as a context that fits in the prompt
 * preview and overflows on the wire, or the reverse, and the person who chose
 * the setting would have no way to tell which number was the lie.
 *
 * The other half of the file is the one the `wiring.test.ts` family exists for:
 * an id core stores and nothing can load is a setting that silently does
 * nothing. `TokenCounterOptions.keys` is the vocabulary the UI offers and the
 * column stores; every one of them must resolve to a real counter here.
 */

import { describe, expect, it } from "vitest"
import {
	loadTokenizer,
	registeredTokenizers,
	ROUGH_TOKENIZER_ID,
	TOKENIZER_IDS
} from "@serene-pub/sdk/tokenizers"
import { roughTokens } from "@serene-pub/sdk"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { TokenCounters } from "$lib/server/utils/TokenCounterManager"
// Importing the module is what registers the eight data-bearing loaders — the
// same fact-about-the-code route `runTurn` takes, rather than a list beside it.
import "$lib/server/pipelines/runtime/tokenizers"

/**
 * Deliberately mixed. Pure ASCII would let a byte-per-token approximation pass
 * for a real BPE tokenizer; the emoji and the CJK are where the two diverge, and
 * where a wrong tokenizer silently under-counts a user's context.
 */
const SAMPLES = [
	"The quick brown fox jumps over the lazy dog.",
	"Vell swore the oath twice — once in spring, once in the dark.",
	"日本語のテキストとemoji 🜁🜂 mixed with ASCII",
	""
]

describe("every id the app offers can actually be loaded", () => {
	it("has a loader registered for each of the twelve", () => {
		const registered = new Set(registeredTokenizers())
		const missing = TokenCounterOptions.keys.filter(
			(id) => !registered.has(id)
		)
		expect(
			missing,
			`These ids are offered in every connection form and stored in ` +
				`connections.token_counter, and nothing can load them:\n` +
				missing.map((m) => `  • ${m}`).join("\n") +
				`\n\nA run configured with one of these budgets with the rough ` +
				`estimate instead — silently, which is exactly how choosing a ` +
				`tokenizer came to mean nothing in the first place. Register it ` +
				`in this directory's tokenizers.ts.`
		).toEqual([])
	})

	it("names no id the SDK has not heard of", () => {
		const unknown = TokenCounterOptions.keys.filter(
			(id) => !TOKENIZER_IDS.includes(id)
		)
		expect(
			unknown,
			`The connection form offers ids the SDK's vocabulary does not ` +
				`contain: ${unknown.join(", ")}. Add them to TOKENIZER_IDS, or ` +
				`the SDK reports them as typos rather than as a wiring gap.`
		).toEqual([])
	})
})

describe("the SDK's counters and TokenCounterManager agree", () => {
	// Every id, including the four the SDK implements itself as a ratio: those
	// are the ones most likely to drift, because a ratio is a number somebody
	// can plausibly "improve" in one file without knowing about the other.
	for (const id of TokenCounterOptions.keys) {
		it(`${id} counts the same on both paths`, async () => {
			const sdk = await loadTokenizer(id)
			expect(
				sdk.degraded,
				`'${id}' did not load: ${sdk.degraded}`
			).toBeUndefined()
			expect(sdk.id).toBe(id)

			const legacy = new TokenCounters(id)
			for (const s of SAMPLES) {
				expect(
					sdk.count(s),
					`'${id}' disagrees about ${JSON.stringify(s)}`
				).toBe(await legacy.countTokens(s))
			}
		}, 60_000)
	}
})

describe("a real tokenizer is a real tokenizer", () => {
	// The floor under everything above: if the packages did not resolve at all,
	// every id would degrade to `roughTokens` and the agreement tests would
	// still pass for the four ratios while proving nothing about the eight.
	it("GPT-4o does not merely approximate by character count", async () => {
		const gpt4o = await loadTokenizer(TokenCounterOptions.OPENAI_GPT4O)
		expect(gpt4o.id).toBe(TokenCounterOptions.OPENAI_GPT4O)

		const cjk = "日本語のテキストとemoji 🜁🜂 mixed with ASCII"
		expect(gpt4o.count(cjk)).not.toBe(roughTokens(cjk))
		// A single common English word is one token in any BPE vocabulary and
		// four characters' worth of estimate in none of them.
		expect(gpt4o.count(" the")).toBe(1)
	}, 60_000)

	it("counts an object the way the estimate does — as its JSON", async () => {
		// A wire payload is a messages array as often as it is prose, and the
		// receipt's figure has to measure the same thing the budget spent.
		const llama = await loadTokenizer(TokenCounterOptions.LLAMA)
		const payload = [{ role: "user", content: "hello" }]
		expect(llama.count(payload)).toBe(llama.count(JSON.stringify(payload)))
	}, 60_000)
})

describe("an id that cannot be honoured degrades rather than throwing", () => {
	it("falls back to the rough estimate and says which id it was", async () => {
		const t = await loadTokenizer("openai-gpt5-imaginary")
		expect(t.id).toBe(ROUGH_TOKENIZER_ID)
		expect(t.count("hello")).toBe(roughTokens("hello"))
		expect(t.degraded).toMatch(/openai-gpt5-imaginary/)
	})
})
