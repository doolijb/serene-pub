/**
 * The NER adapter family, with the pipeline stubbed.
 *
 * One backend and one action. `extractEntities` is the ACTION whose presence
 * derives `text->entities` (see `$lib/shared/connectionAdapters/actions`), so
 * what it takes and returns is fixed, and what is checked here is the contract
 * rather than a wire: the catalogue, the refusal, and the span arithmetic.
 *
 * ⚠ **Nothing here downloads a model.** `@huggingface/transformers` is mocked,
 * so these run on a machine with no weights, no `onnxruntime-node` and no
 * network. A test that loaded the real pipeline would be a 100MB download on
 * every CI box and would fail on the platforms this adapter is explicitly
 * allowed not to work on.
 *
 * The span arithmetic is the part worth testing hardest. transformers.js 4.2.0's
 * token-classification pipeline returns `{entity_group, score, word}` and **no
 * character offsets** ("TODO: Add support for start and end" in its source), so
 * the adapter locates each word in the source text itself. Every property that
 * depends on — order, repeats, subword spacing, and the word it cannot find —
 * is asserted below.
 */

import { afterEach, describe, expect, it, vi } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

const conn = (over: Record<string, unknown> = {}) =>
	({
		id: 1,
		name: "entities",
		type: CONNECTION_TYPE.LOCAL_ONNX_NER,
		baseUrl: null,
		model: "Xenova/bert-base-NER",
		extraJson: {},
		capabilities: {},
		...over
	}) as any

/**
 * The database, stubbed to hold no local models.
 *
 * Not an optimisation: importing `$lib/server/db` MIGRATES a fresh PGlite
 * instance at module scope, so without this every case here pays a full
 * migration and fails as a timeout that reads like a flake. The only thing this
 * adapter asks it is which `local_models` rows are NER models, and "none" is the
 * answer that makes the catalogue assertions exact.
 */
vi.mock("$lib/server/db", () => ({
	getCryptoSecretKey: () => "test-secret",
	db: {
		select: () => ({
			from: () => ({
				where: async () => []
			})
		})
	}
}))

/** What the stubbed pipeline was asked, so the options can be asserted. */
let asked: Array<{ text: string; options: any }> = []
/** What the stubbed pipeline answers next. */
let answer: Array<{ entity_group: string; score: number; word: string }> = []
let loaded: string[] = []

vi.mock("@huggingface/transformers", () => ({
	env: {},
	pipeline: vi.fn(async (task: string, model: string) => {
		loaded.push(`${task}:${model}`)
		return async (text: string, options: any) => {
			asked.push({ text, options })
			return answer
		}
	})
}))

afterEach(async () => {
	asked = []
	answer = []
	loaded = []
	const { unloadNerModel } = await import("$lib/server/ner")
	unloadNerModel("test cleanup")
	vi.restoreAllMocks()
})

describe("local ONNX named entities", () => {
	it("offers the shipped catalogue as its model list", async () => {
		const { NER_MODELS } = await import("$lib/server/ner/models")
		const mod = (await import("./LocalOnnxNerAdapter")).default
		const { models } = await mod.listModels(conn())
		for (const m of NER_MODELS)
			expect(models.map((x: any) => x.model)).toContain(m.id)
	})

	it("refuses a model the catalogue does not name", async () => {
		const mod = (await import("./LocalOnnxNerAdapter")).default
		await expect(
			new mod.Adapter(
				conn({ model: "Xenova/not-a-real-model" })
			).extractEntities({ text: "Cade went to Lowmarket." })
		).rejects.toThrow(/Unknown entity model/)
	})

	it("runs token-classification with simple aggregation", async () => {
		answer = [{ entity_group: "PER", score: 0.98, word: "Cade" }]
		const mod = (await import("./LocalOnnxNerAdapter")).default
		await new mod.Adapter(conn()).extractEntities({ text: "Cade waited." })

		expect(loaded).toEqual([
			"token-classification:Xenova/bert-base-NER"
			// One load, and the model id is the one the connection names.
		])
		expect(asked[0].options).toMatchObject({
			aggregation_strategy: "simple"
		})
	})

	it("locates each span in the source text, in order, repeats included", async () => {
		// The pipeline hands back words with no offsets, so the adapter finds
		// them. Two mentions of one name must land on the two DIFFERENT
		// positions, or every repeat would be filed against the first.
		answer = [
			{ entity_group: "PER", score: 0.99, word: "Cade" },
			{ entity_group: "LOC", score: 0.88, word: "Lowmarket" },
			{ entity_group: "PER", score: 0.97, word: "Cade" }
		]
		const text = "Cade crossed Lowmarket before Cade spoke."
		const mod = (await import("./LocalOnnxNerAdapter")).default
		const spans = await new mod.Adapter(conn()).extractEntities({ text })

		expect(spans).toEqual([
			{ text: "Cade", label: "PER", start: 0, end: 4, score: 0.99 },
			{
				text: "Lowmarket",
				label: "LOC",
				start: 13,
				end: 22,
				score: 0.88
			},
			{ text: "Cade", label: "PER", start: 30, end: 34, score: 0.97 }
		])
		// The offsets are offsets INTO THE TEXT, which is the only thing that
		// makes them mergeable with the gazetteer's.
		for (const s of spans) expect(text.slice(s.start, s.end)).toBe(s.text)
	})

	it("tolerates the spacing a subword decoder inserts", async () => {
		// `##` pieces decode with spaces around punctuation and hyphens, so an
		// exact indexOf misses a name the passage really does contain.
		answer = [
			{ entity_group: "ORG", score: 0.9, word: "Ashguard - Riders" }
		]
		const text = "The Ashguard-Riders ride at dawn."
		const mod = (await import("./LocalOnnxNerAdapter")).default
		const spans = await new mod.Adapter(conn()).extractEntities({ text })

		expect(spans).toHaveLength(1)
		expect(text.slice(spans[0].start, spans[0].end)).toBe("Ashguard-Riders")
	})

	it("drops a word it cannot find rather than guessing an offset", async () => {
		// An unavailable mechanism subtracts a signal. A span pointing at text
		// that does not say it would put a wrong key in the store, which is
		// worse than one fewer entity.
		answer = [
			{ entity_group: "PER", score: 0.9, word: "Vell" },
			{ entity_group: "PER", score: 0.9, word: "[UNK]" }
		]
		const mod = (await import("./LocalOnnxNerAdapter")).default
		const spans = await new mod.Adapter(conn()).extractEntities({
			text: "Vell answered."
		})
		expect(spans.map((s) => s.text)).toEqual(["Vell"])
	})

	it("returns nothing for empty text without loading anything", async () => {
		const mod = (await import("./LocalOnnxNerAdapter")).default
		const spans = await new mod.Adapter(conn()).extractEntities({
			text: "   "
		})
		expect(spans).toEqual([])
		expect(loaded).toEqual([])
	})
})

describe("the family is registered", () => {
	it("loads one NER module for the NER type, and no other family", async () => {
		const { ADAPTER_REGISTRY } = await import(
			"$lib/server/adapters/registry"
		)
		const modules = ADAPTER_REGISTRY[CONNECTION_TYPE.LOCAL_ONNX_NER]
		expect(
			modules?.ner,
			"the NER type has no ner module, so nothing can serve its star."
		).toBeTypeOf("function")
		// And no text, image or embedding module: a NER endpoint that derived
		// `text->text` from the wrong family would be offerable as the chat
		// default.
		expect(modules?.text).toBeUndefined()
		expect(modules?.image).toBeUndefined()
		expect(modules?.embedding).toBeUndefined()
	})

	it("routes getNerAdapter through that same map", async () => {
		const { getNerAdapter } = await import(
			"$lib/server/utils/getNerAdapter"
		)
		const mod = await getNerAdapter(CONNECTION_TYPE.LOCAL_ONNX_NER)
		expect(mod.Adapter).toBeTypeOf("function")
		await expect(getNerAdapter("openai")).rejects.toThrow(/No NER adapter/)
	})
})
