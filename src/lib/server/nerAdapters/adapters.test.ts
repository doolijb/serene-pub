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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
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
 * answer that makes the catalogue assertions exact — `registry.rows` is
 * swappable for the one case that needs a downloaded model to be there.
 */
const registry = vi.hoisted(() => ({ rows: [] as any[], reads: 0 }))
vi.mock("$lib/server/db", () => ({
	getCryptoSecretKey: () => "test-secret",
	db: {
		select: () => ({
			from: () => ({
				// Awaitable as it is (the adapter's listing) and with `.limit`
				// (the loader's registry check), counting every read.
				where: () => {
					registry.reads++
					return Object.assign(Promise.resolve(registry.rows), {
						limit: async () => registry.rows
					})
				}
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
	/**
	 * ⚠ Offline, deliberately.
	 *
	 * `listModels` merges the PUBLISHED recommended list
	 * (`localModels/onnxList`) over the built-in catalogue, and this file must
	 * not reach the Hub — see the header. With the fetch refused the merge
	 * falls back to the built-ins, which is also what makes the assertions
	 * below exact rather than "contains at least".
	 */
	beforeEach(async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => {
				throw new Error("offline")
			})
		)
		const { resetRecommendedLists } = await import(
			"$lib/server/localModels/onnxList"
		)
		resetRecommendedLists()
	})

	it("offers the shipped catalogue as its model list", async () => {
		const { NER_MODELS } = await import("$lib/server/ner/models")
		const mod = (await import("./LocalOnnxNerAdapter")).default
		const { models } = await mod.listModels(conn())
		for (const m of NER_MODELS)
			expect(models.map((x: any) => x.model)).toContain(m.id)
	})

	/**
	 * ⚠ The listing feeds `syncConnectionModels`, whose `(connection_id, model)`
	 * unique index refuses a second row for an id it already wrote — so an id
	 * appearing twice here aborts that endpoint's whole sync with a
	 * duplicate-key error rather than showing a model twice. The real
	 * `ner.yaml` names BOTH built-in ids, so the overlap is the ordinary case.
	 */
	it("names each id exactly once when every source overlaps", async () => {
		const { resetRecommendedLists } = await import(
			"$lib/server/localModels/onnxList"
		)
		const { NER_MODELS } = await import("$lib/server/ner/models")
		const yaml = `
models:
  - id: Xenova/bert-base-NER
    name: bert-base-NER
    dtype: q8
    size: 110
    labels: [PER, LOC, ORG, MISC]
    tier: balanced
    details:
      description: "The standard English CoNLL-2003 model."
  - id: Xenova/distilbert-base-multilingual-cased-ner-hrl
    name: distilbert-multilingual-NER
    dtype: q8
    size: 139
    labels: [PER, LOC, ORG, DATE]
    tier: fast
    details:
      description: "Ten high-resource languages."
  - id: Xenova/bert-base-NER
    name: bert-base-NER (a duplicated entry)
    dtype: q8
    size: 110
    labels: [PER]
    tier: best
    details:
      description: "The same id a second time."
`
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: true, text: async () => yaml }) as any)
		)
		resetRecommendedLists()
		registry.rows = [
			{
				modelName: "Xenova/bert-base-NER",
				filename: "Xenova/bert-base-NER",
				description: "Downloaded"
			},
			{
				modelName: "some-org/hand-placed",
				filename: "some-org/hand-placed.onnx",
				description: "Downloaded"
			}
		]
		try {
			const mod = (await import("./LocalOnnxNerAdapter")).default
			const { models } = await mod.listModels(conn())
			const ids = models.map((m: any) => m.model)
			expect(new Set(ids).size).toBe(ids.length)
			for (const m of NER_MODELS) expect(ids).toContain(m.id)
			expect(ids).toContain("some-org/hand-placed")
		} finally {
			registry.rows = []
			resetRecommendedLists()
		}
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

	/**
	 * The annotation lane's path. Its broker loaded the model, so a row reads
	 * the resident pipeline and nothing else: a downloaded model is not looked
	 * up in the registry again for every row of a thousand-row book.
	 */
	it("reads a resident model without consulting the registry again", async () => {
		registry.rows = [
			{
				modelName: "some-org/hand-placed",
				filename: "some-org/hand-placed.onnx",
				description: "Downloaded"
			}
		]
		try {
			answer = [{ entity_group: "PER", score: 0.9, word: "Vell" }]
			const mod = (await import("./LocalOnnxNerAdapter")).default
			const adapter = new mod.Adapter(
				conn({ model: "some-org/hand-placed" })
			)
			await adapter.extractEntities({ text: "Vell answered." })
			const readsAfterLoad = registry.reads
			expect(readsAfterLoad).toBeGreaterThan(0)

			const spans = await adapter.extractEntities({ text: "Vell left." })
			expect(spans.map((s) => s.text)).toEqual(["Vell"])
			expect(registry.reads).toBe(readsAfterLoad)
			expect(loaded).toEqual([
				"token-classification:some-org/hand-placed"
			])
		} finally {
			registry.rows = []
		}
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

/**
 * The residency the module lends the annotation lane's broker. The broker
 * loads through this and never names `$lib/server/ner`, so this is the one
 * place that says the local backend's residency IS that module's.
 */
describe("local ONNX residency", () => {
	it("loads with the connection's idle window and reports what is resident", async () => {
		const mod = (await import("./LocalOnnxNerAdapter")).default
		expect(mod.residency).toBeTypeOf("function")
		const residency = await mod.residency!()
		const { getNerTtlMinutes } = await import("$lib/server/ner")

		expect(residency.resident()).toBeNull()
		expect(residency.loading()).toBe(false)

		await residency.load("Xenova/bert-base-NER", 9)
		expect(residency.resident()).toBe("Xenova/bert-base-NER")
		expect(getNerTtlMinutes()).toBe(9)
		expect(loaded).toEqual(["token-classification:Xenova/bert-base-NER"])
	})

	it("loads at the catalogue's dtype, exactly as the lane always has", async () => {
		const { pipeline } = await import("@huggingface/transformers")
		const mod = (await import("./LocalOnnxNerAdapter")).default
		await (await mod.residency!()).load("Xenova/bert-base-NER", 5)
		expect(vi.mocked(pipeline).mock.lastCall?.[2]).toMatchObject({
			dtype: "q8"
		})
	})

	it("refuses a model the catalogue and the registry do not name", async () => {
		const mod = (await import("./LocalOnnxNerAdapter")).default
		const residency = await mod.residency!()
		await expect(
			residency.load("Xenova/not-a-real-model", 5)
		).rejects.toThrow(/Unknown entity model/)
		expect(residency.resident()).toBeNull()
	})

	/**
	 * A Hub-added model's precision is set on its model row and used by the
	 * DOWNLOAD, which records it on the registry row (`local_models.
	 * quantization`). Loading at any other precision asks for a weights file
	 * that was never fetched.
	 */
	it("loads a downloaded model at the precision its download recorded", async () => {
		registry.rows = [
			{
				modelName: "some-org/hand-added",
				filename: "some-org/hand-added",
				quantization: "fp16"
			}
		]
		try {
			const { pipeline } = await import("@huggingface/transformers")
			const mod = (await import("./LocalOnnxNerAdapter")).default
			await (await mod.residency!()).load("some-org/hand-added", 5)
			expect(vi.mocked(pipeline).mock.lastCall?.[2]).toMatchObject({
				dtype: "fp16"
			})
		} finally {
			registry.rows = []
		}
	})

	it("names no precision for a downloaded model whose row records none", async () => {
		registry.rows = [
			{
				modelName: "some-org/hand-placed",
				filename: "some-org/hand-placed.onnx",
				quantization: null
			}
		]
		try {
			const { pipeline } = await import("@huggingface/transformers")
			const mod = (await import("./LocalOnnxNerAdapter")).default
			await (await mod.residency!()).load("some-org/hand-placed", 5)
			expect(vi.mocked(pipeline).mock.lastCall?.[2]).not.toHaveProperty(
				"dtype"
			)
		} finally {
			registry.rows = []
		}
	})
})

/**
 * ⚠ A model already on disk loads from its DIRECTORY, by path.
 *
 * transformers.js 4.2.0 decides which files a repo id needs by looking in
 * `env.cacheDir`, not the per-call `cache_dir`, so offline a repo id finds no
 * `config.json` (or no tokenizer) and the load fails. A path is not a repo id:
 * every file is read straight from it. Verified against the real
 * `Xenova/bert-base-NER` with remote models refused (lane C1, 2026-10-05).
 */
describe("local ONNX loading from disk", () => {
	const MODEL = "Xenova/bert-base-NER"
	let dir: string

	beforeEach(async () => {
		const { modelDirFor, clearCachedScans } = await import(
			"$lib/server/localModels/onnxCache"
		)
		dir = modelDirFor(MODEL, "ner")!
		const fs = await import("node:fs/promises")
		const path = await import("node:path")
		await fs.mkdir(path.join(dir, "onnx"), { recursive: true })
		await fs.writeFile(path.join(dir, "onnx", "model_quantized.onnx"), "")
		clearCachedScans()
	})

	afterEach(async () => {
		const fs = await import("node:fs/promises")
		await fs.rm(dir, { recursive: true, force: true })
		const { clearCachedScans } = await import(
			"$lib/server/localModels/onnxCache"
		)
		clearCachedScans()
		const { env } = await import("@huggingface/transformers")
		delete (env as any).allowRemoteModels
	})

	it("hands the pipeline the model's directory, not its repo id", async () => {
		const path = await import("node:path")
		const mod = (await import("./LocalOnnxNerAdapter")).default
		await (await mod.residency!()).load(MODEL, 5)
		expect(path.isAbsolute(dir)).toBe(true)
		expect(loaded).toEqual([`token-classification:${dir}`])
	})

	it("falls back to the repo id when the directory cannot serve the load", async () => {
		const { pipeline } = await import("@huggingface/transformers")
		vi.mocked(pipeline).mockImplementationOnce(async () => {
			throw new Error("model_quantized.onnx is not here")
		})
		const mod = (await import("./LocalOnnxNerAdapter")).default
		const residency = await mod.residency!()
		await residency.load(MODEL, 5)
		expect(vi.mocked(pipeline).mock.calls.at(-1)?.[1]).toBe(MODEL)
		expect(residency.resident()).toBe(MODEL)
	})

	it("does not reach for the Hub when remote models are refused", async () => {
		const { env, pipeline } = await import("@huggingface/transformers")
		;(env as any).allowRemoteModels = false
		vi.mocked(pipeline).mockImplementationOnce(async () => {
			throw new Error("model_quantized.onnx is not here")
		})
		const calls = vi.mocked(pipeline).mock.calls.length
		const mod = (await import("./LocalOnnxNerAdapter")).default
		const residency = await mod.residency!()
		await expect(residency.load(MODEL, 5)).rejects.toThrow(/is not here/)
		expect(vi.mocked(pipeline).mock.calls.length).toBe(calls + 1)
		expect(residency.resident()).toBeNull()
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
