/**
 * The recommended list: what it parses, what it refuses, and what it falls back
 * to.
 *
 * ⚠ No network. `fetch` is stubbed in every test, and each one gets its own
 * data directory so the 24h disk cache written by the previous test cannot
 * answer for it — a cached copy is used without touching `fetch` at all, which
 * is exactly the behaviour under test in `uses a cached copy`.
 */

import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi
} from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { EMBEDDING_MODELS } from "$lib/server/embedding/models"
import { NER_MODELS } from "$lib/server/ner/models"
import {
	catalogView,
	listCacheDir,
	recommendedEmbeddingModels,
	recommendedEmbeddingSnapshot,
	recommendedNerModels,
	resetRecommendedLists
} from "./onnxList"

const EMBEDDINGS_YAML = `
models:
  - id: Xenova/all-MiniLM-L6-v2
    name: all-MiniLM-L6-v2
    dtype: q8
    size: 24
    dimensions: 384
    max_input_tokens: 256
    pooling: mean
    tier: fast
    tags: [english, no-prefixes, legacy]
    details:
      parameter_size: 22M
      released: "2021-08"
      license: apache-2.0
      languages: "English"
      description: "The smallest model that still works."

  - id: Xenova/multilingual-e5-small
    name: multilingual-e5-small
    dtype: q8
    size: 140
    dimensions: 384
    max_input_tokens: 512
    pooling: mean
    prefixes:
      query: "query: "
      document: "passage: "
    tier: fast
    tags: [multilingual, prefixes-required]
    details:
      parameter_size: 118M
      released: "2023-06"
      license: mit
      languages: "About 100 languages"
      description: "The small multilingual choice."

  - id: onnx-community/Qwen3-Embedding-0.6B-ONNX
    name: Qwen3-Embedding-0.6B
    dtype: q8
    size: 625
    dimensions: 1024
    max_input_tokens: 32768
    pooling: last_token
    tier: best
    tags: [multilingual, long-input]
    details:
      parameter_size: 596M
      released: "2025-06"
      license: apache-2.0
      languages: "Over 100 languages"
      description: "Pools on the LAST token."

  - name: no-id-at-all
    dimensions: 768

  - id: broken/no-dimensions
    name: no-dimensions
    size: 10
    pooling: mean
`

const NER_YAML = `
models:
  - id: onnx-community/distilbert-NER-ONNX
    name: distilbert-NER
    dtype: q8
    size: 67
    labels: [PER, LOC, ORG, MISC]
    max_input_tokens: 512
    tier: fast
    tags: [english, cased, conll]
    details:
      parameter_size: 65M
      released: "2024-01"
      license: apache-2.0
      languages: "English"
      description: "Distilled from bert-base-NER."

  - id: broken/no-labels
    name: no-labels
    size: 10
`

let dataDir: string
const originalDataDir = process.env.SERENE_PUB_DATA_DIR
const dirs: string[] = []

/** A stub that answers each modality's URL, and counts what was asked for. */
function stubFetch(
	answer: (url: string) => { ok: boolean; text: string } | Error
) {
	const calls: string[] = []
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: any) => {
			calls.push(String(url))
			const result = answer(String(url))
			if (result instanceof Error) throw result
			return {
				ok: result.ok,
				text: async () => result.text
			} as any
		})
	)
	return calls
}

const bothLists = (url: string) =>
	url.endsWith("ner.yaml")
		? { ok: true, text: NER_YAML }
		: { ok: true, text: EMBEDDINGS_YAML }

beforeEach(async () => {
	resetRecommendedLists()
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-onnx-list-"))
	dirs.push(dataDir)
	process.env.SERENE_PUB_DATA_DIR = dataDir
})

afterEach(() => {
	vi.unstubAllGlobals()
})

afterAll(async () => {
	if (originalDataDir === undefined) delete process.env.SERENE_PUB_DATA_DIR
	else process.env.SERENE_PUB_DATA_DIR = originalDataDir
	for (const dir of dirs)
		await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
})

describe("parsing a published list", () => {
	it("maps every field the catalog view carries", async () => {
		stubFetch(bothLists)
		const models = await recommendedEmbeddingModels()
		const mini = models.find((m) => m.id === "Xenova/all-MiniLM-L6-v2")!
		expect(mini).toBeDefined()
		expect(mini.dtype).toBe("q8")
		expect(mini.sizeMb).toBe(24)
		expect(mini.sizeLabel).toBe("~24 MB")
		expect(mini.dimensions).toBe(384)
		expect(mini.maxInputTokens).toBe(256)
		expect(mini.pooling).toBe("mean")
		expect(mini.tier).toBe("fast")
		expect(mini.tags).toEqual(["english", "no-prefixes", "legacy"])
		expect(mini.license).toBe("apache-2.0")
		expect(mini.released).toBe("2021-08")
		expect(mini.languages).toBe("English")
		expect(mini.parameterSize).toBe("22M")
		expect(mini.description).toContain("smallest model")

		const e5 = models.find((m) => m.id === "Xenova/multilingual-e5-small")!
		expect(e5.prefixes).toEqual({
			query: "query: ",
			document: "passage: "
		})
	})

	it("projects one entry into the wire's catalog shape", async () => {
		stubFetch(bothLists)
		const models = await recommendedEmbeddingModels()
		const view = catalogView(
			models.find((m) => m.id === "Xenova/multilingual-e5-small")!
		)
		expect(view).toMatchObject({
			tier: "fast",
			sizeMb: 140,
			dimensions: 384,
			maxInputTokens: 512,
			pooling: "mean",
			languages: "About 100 languages"
		})
		// An embedding entry publishes no label set, and an absent key is the
		// honest answer rather than an empty array.
		expect(view).not.toHaveProperty("labels")
	})

	it("reads an entity entry's labels", async () => {
		stubFetch(bothLists)
		const models = await recommendedNerModels()
		const distil = models.find(
			(m) => m.id === "onnx-community/distilbert-NER-ONNX"
		)!
		expect(distil.labels).toEqual(["PER", "LOC", "ORG", "MISC"])
		expect(catalogView(distil).labels).toEqual([
			"PER",
			"LOC",
			"ORG",
			"MISC"
		])
	})

	it("drops a malformed entry without losing the rest of the list", async () => {
		stubFetch(bothLists)
		const embeddings = await recommendedEmbeddingModels()
		expect(embeddings.some((m) => m.id === "broken/no-dimensions")).toBe(
			false
		)
		expect(embeddings.some((m) => m.name === "no-id-at-all")).toBe(false)
		expect(embeddings.some((m) => m.id === "Xenova/all-MiniLM-L6-v2")).toBe(
			true
		)

		const ner = await recommendedNerModels()
		expect(ner.some((m) => m.id === "broken/no-labels")).toBe(false)
		expect(
			ner.some((m) => m.id === "onnx-community/distilbert-NER-ONNX")
		).toBe(true)
	})
})

describe("last_token pooling", () => {
	it("is excluded — the loader pools with the mean and cannot be told otherwise", async () => {
		stubFetch(bothLists)
		const models = await recommendedEmbeddingModels()
		expect(
			models.some(
				(m) => m.id === "onnx-community/Qwen3-Embedding-0.6B-ONNX"
			)
		).toBe(false)
		expect(models.some((m) => m.pooling === "last_token")).toBe(false)
	})
})

describe("falling back", () => {
	it("uses the built-in catalogue when the fetch throws and nothing is cached", async () => {
		stubFetch(() => new Error("getaddrinfo ENOTFOUND"))
		const models = await recommendedEmbeddingModels()
		expect(models.map((m) => m.id)).toEqual(
			EMBEDDING_MODELS.map((m) => m.id)
		)
		const ner = await recommendedNerModels()
		expect(ner.map((m) => m.id)).toEqual(NER_MODELS.map((m) => m.id))
	})

	it("uses the built-in catalogue when the document is not a list", async () => {
		stubFetch(() => ({ ok: true, text: "<html>404</html>" }))
		const models = await recommendedEmbeddingModels()
		expect(models.map((m) => m.id)).toEqual(
			EMBEDDING_MODELS.map((m) => m.id)
		)
	})

	it("uses a cached copy on a later failure", async () => {
		const first = stubFetch(bothLists)
		await recommendedEmbeddingModels()
		expect(first.length).toBe(1)
		// The document is on disk now; a new process with no network must still
		// answer with it.
		const cached = await fs.readFile(
			path.join(await listCacheDir(), "embeddings.yaml"),
			"utf8"
		)
		expect(cached).toContain("Xenova/all-MiniLM-L6-v2")

		resetRecommendedLists()
		vi.unstubAllGlobals()
		stubFetch(() => new Error("offline"))
		const models = await recommendedEmbeddingModels()
		expect(
			models.some((m) => m.id === "Xenova/multilingual-e5-small")
		).toBe(true)
	})
})

describe("ids", () => {
	it("are never rewritten, and every built-in id survives the merge", async () => {
		stubFetch(bothLists)
		const models = await recommendedEmbeddingModels()
		for (const builtIn of EMBEDDING_MODELS)
			expect(models.some((m) => m.id === builtIn.id)).toBe(true)
		// The list's own entry wins on a shared id — it is the richer one.
		const mini = models.find((m) => m.id === "Xenova/all-MiniLM-L6-v2")!
		expect(mini.maxInputTokens).toBe(256)
		// …and is listed exactly once.
		expect(
			models.filter((m) => m.id === "Xenova/all-MiniLM-L6-v2")
		).toHaveLength(1)
	})

	it("appear exactly once when the fetched list and the catalogue overlap", async () => {
		// The real `ner.yaml` names BOTH built-in entity ids, so every load of
		// the entity list exercises the overlap. The fixture below adds the
		// other half of the hazard: a published document that repeats an entry.
		const OVERLAPPING_NER = `
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
		stubFetch((url) =>
			url.endsWith("ner.yaml")
				? { ok: true, text: OVERLAPPING_NER }
				: { ok: true, text: EMBEDDINGS_YAML }
		)

		const ner = await recommendedNerModels()
		const nerIds = ner.map((m) => m.id)
		expect(new Set(nerIds).size).toBe(nerIds.length)
		// Both built-in ids are present, contributed by the fetched half.
		for (const builtIn of NER_MODELS) expect(nerIds).toContain(builtIn.id)
		// First occurrence wins: the repeat lower down is dropped, not merged.
		const bert = ner.find((m) => m.id === "Xenova/bert-base-NER")!
		expect(bert.name).toBe("bert-base-NER")
		expect(bert.labels).toEqual(["PER", "LOC", "ORG", "MISC"])

		const embeddings = await recommendedEmbeddingModels()
		const embeddingIds = embeddings.map((m) => m.id)
		expect(new Set(embeddingIds).size).toBe(embeddingIds.length)
		for (const builtIn of EMBEDDING_MODELS)
			expect(embeddingIds).toContain(builtIn.id)
	})

	it("reach the synchronous snapshot the loaders read", async () => {
		stubFetch(bothLists)
		expect(recommendedEmbeddingSnapshot()).toEqual([])
		await recommendedEmbeddingModels()
		expect(
			recommendedEmbeddingSnapshot().some(
				(m) => m.id === "Xenova/multilingual-e5-small"
			)
		).toBe(true)
	})
})
