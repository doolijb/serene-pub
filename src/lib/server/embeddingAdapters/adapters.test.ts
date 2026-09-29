/**
 * The embedding adapter family, at the wire.
 *
 * Three backends, one action. `embedText` is the ACTION whose presence derives
 * `text->embedding` (see `$lib/shared/connectionAdapters/actions`), so what it
 * takes and returns is fixed for all three and each of these asserts the same
 * contract against a different protocol:
 *
 *   · Ollama speaks `POST /api/embed` with `{model, input}` and answers
 *     `{embeddings: number[][]}`. Not `/v1/embeddings` — that shim exists, but
 *     `/api/embed` is the route Ollama's own documentation names, and it is the
 *     one that takes a batch.
 *   · OpenAI-compatible speaks `POST /embeddings` and answers `{data: [{index,
 *     embedding}]}` — INDEXED, which is the whole reason the adapter sorts
 *     rather than trusting arrival order.
 *   · Local ONNX runs in this process and has no wire at all, so what is checked
 *     here is its catalogue and its refusal, not a request.
 *
 * `dimensions` is read back off the first vector in every case. A stored vector
 * is worthless without the width it was made at, and a width nobody measured is
 * a width that silently corrupts an index the day a backend changes default.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

const conn = (over: Record<string, unknown> = {}) =>
	({
		id: 1,
		name: "embeds",
		type: CONNECTION_TYPE.OLLAMA_EMBEDDINGS,
		baseUrl: "http://localhost:11434",
		model: "nomic-embed-text",
		extraJson: {},
		capabilities: {},
		...over
	}) as any

/**
 * The database, stubbed to hold no local models.
 *
 * Not an optimisation: importing `$lib/server/db` MIGRATES a fresh PGlite
 * instance at module scope, so without this every case here pays a full
 * migration and fails as a five-second timeout that reads like a flake. The only
 * thing these adapters ask it is which `local_models` rows are embeddings, and
 * "none" is the answer that makes the catalogue assertions exact —
 * `registry.rows` is swappable for the one case that needs a downloaded model
 * to be there.
 */
const registry = vi.hoisted(() => ({ rows: [] as any[] }))
vi.mock("$lib/server/db", () => ({
	getCryptoSecretKey: () => "test-secret",
	db: {
		select: () => ({
			from: () => ({
				where: async () => registry.rows
			})
		})
	}
}))

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

describe("Ollama embeddings", () => {
	it("posts the batch to /api/embed and reads the width back", async () => {
		const calls: Array<{ url: string; body: any }> = []
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: any, init: any) => {
				calls.push({ url: String(url), body: JSON.parse(init.body) })
				return {
					ok: true,
					status: 200,
					json: async () => ({
						embeddings: [
							[1, 0, 0],
							[0, 1, 0]
						],
						model: "nomic-embed-text"
					})
				} as any
			})
		)
		const mod = (await import("./OllamaEmbeddingAdapter")).default
		const res = await new mod.Adapter(conn()).embedText({
			input: ["a", "b"]
		})

		expect(calls[0].url).toBe("http://localhost:11434/api/embed")
		expect(calls[0].body).toMatchObject({
			model: "nomic-embed-text",
			input: ["a", "b"]
		})
		expect(res.vectors).toEqual([
			[1, 0, 0],
			[0, 1, 0]
		])
		expect(res.model).toBe("nomic-embed-text")
		expect(res.dimensions).toBe(3)
	})

	it("says what the server said when it refuses", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: false,
				status: 404,
				text: async () => 'model "nope" not found'
			}))
		)
		const mod = (await import("./OllamaEmbeddingAdapter")).default
		await expect(
			new mod.Adapter(conn({ model: "nope" })).embedText({ input: ["a"] })
		).rejects.toThrow(/not found/)
	})

	it("returns nothing for an empty batch without calling the endpoint", async () => {
		const f = vi.fn()
		vi.stubGlobal("fetch", f)
		const mod = (await import("./OllamaEmbeddingAdapter")).default
		const res = await new mod.Adapter(conn()).embedText({ input: [] })
		expect(res.vectors).toEqual([])
		expect(f).not.toHaveBeenCalled()
	})
})

describe("OpenAI-compatible embeddings", () => {
	it("orders vectors by the API's own index, never by arrival", async () => {
		// The one thing that cannot be seen from a passing request: a backend is
		// permitted to answer out of order, and a vector filed against the wrong
		// row is a retrieval bug nothing surfaces.
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({
				ok: true,
				status: 200,
				json: async () => ({
					data: [
						{ index: 1, embedding: [0, 1] },
						{ index: 0, embedding: [1, 0] }
					],
					model: "text-embedding-3-small"
				})
			}))
		)
		const mod = (await import("./OpenAIEmbeddingAdapter")).default
		const res = await new mod.Adapter(
			conn({
				type: CONNECTION_TYPE.OPENAI_EMBEDDINGS,
				baseUrl: "http://localhost:1234/v1",
				model: "text-embedding-3-small"
			})
		).embedText({ input: ["a", "b"] })
		expect(res.vectors).toEqual([
			[1, 0],
			[0, 1]
		])
		expect(res.dimensions).toBe(2)
	})

	it("refuses before the wire when no base URL is set", async () => {
		const f = vi.fn()
		vi.stubGlobal("fetch", f)
		const mod = (await import("./OpenAIEmbeddingAdapter")).default
		const res = await mod.testConnection(
			conn({ type: CONNECTION_TYPE.OPENAI_EMBEDDINGS, baseUrl: "" })
		)
		expect(res.ok).toBe(false)
		expect(res.error).toMatch(/base url/i)
		expect(f).not.toHaveBeenCalled()
	})
})

describe("KoboldCPP embeddings — only from the model the pair names", () => {
	// koboldcpp embeds with whatever it was started with and names it in every
	// response. A mismatch means the operator swapped models between syncs, and
	// filing those vectors beside the old model's would corrupt retrieval.
	function answering(model: string | undefined) {
		const f = vi.fn(async (_url: string, _init?: unknown) => ({
			ok: true,
			status: 200,
			json: async () => ({
				object: "list",
				data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
				model
			})
		}))
		vi.stubGlobal("fetch", f)
		return f
	}
	const kcpp = () =>
		conn({
			type: CONNECTION_TYPE.KOBOLDCPP,
			baseUrl: "http://localhost:5001/",
			model: "nomic-embed-text-v1.5.Q4_K_M"
		})

	it("embeds when koboldcpp names the pair's model, at /v1/embeddings", async () => {
		const f = answering("nomic-embed-text-v1.5.Q4_K_M")
		const mod = (await import("./KoboldCppEmbeddingAdapter")).default
		const res = await new mod.Adapter(kcpp()).embedText({ input: ["a"] })
		expect(res.vectors).toEqual([[0.1, 0.2, 0.3]])
		expect(res.model).toBe("nomic-embed-text-v1.5.Q4_K_M")
		expect(f.mock.calls[0][0]).toBe("http://localhost:5001/v1/embeddings")
	})

	it("REFUSES vectors from a different model, naming both", async () => {
		answering("bge-m3-Q8_0")
		const mod = (await import("./KoboldCppEmbeddingAdapter")).default
		await expect(
			new mod.Adapter(kcpp()).embedText({ input: ["a"] })
		).rejects.toThrow(/"bge-m3-Q8_0".*"nomic-embed-text-v1\.5\.Q4_K_M"/)
	})

	it("refuses a response that names no model at all", async () => {
		answering(undefined)
		const mod = (await import("./KoboldCppEmbeddingAdapter")).default
		await expect(
			new mod.Adapter(kcpp()).embedText({ input: ["a"] })
		).rejects.toThrow(/did not say which embedding model/)
	})
})

describe("local ONNX embeddings", () => {
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
		const { EMBEDDING_MODELS } = await import(
			"$lib/server/embedding/models"
		)
		const mod = (await import("./LocalOnnxEmbeddingAdapter")).default
		const { models } = await mod.listModels(
			conn({
				type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
				baseUrl: null,
				model: null
			})
		)
		for (const m of EMBEDDING_MODELS)
			expect(models.map((x: any) => x.model ?? x.id ?? x)).toContain(m.id)
	})

	/**
	 * ⚠ The listing feeds `syncConnectionModels`, whose `(connection_id, model)`
	 * unique index refuses a second row for an id it already wrote — so an id
	 * appearing twice here does not show a model twice, it aborts that
	 * endpoint's whole sync with a duplicate-key error. Every source overlaps
	 * by design: the published list names the same ids the built-in catalogue
	 * does, and a downloaded model is usually one of them.
	 */
	it("names each id exactly once when every source overlaps", async () => {
		const { resetRecommendedLists } = await import(
			"$lib/server/localModels/onnxList"
		)
		const { EMBEDDING_MODELS } = await import(
			"$lib/server/embedding/models"
		)
		// A published list that names a built-in id, and repeats one of its own.
		const yaml = `
models:
  - id: Xenova/all-MiniLM-L6-v2
    name: all-MiniLM-L6-v2
    dtype: q8
    size: 24
    dimensions: 384
    pooling: mean
    tier: fast
    details:
      description: "The smallest model that still works."
  - id: Xenova/all-MiniLM-L6-v2
    name: all-MiniLM-L6-v2 (a duplicated entry)
    dtype: q8
    size: 24
    dimensions: 384
    pooling: mean
    tier: best
    details:
      description: "The same id a second time."
`
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: true, text: async () => yaml }) as any)
		)
		resetRecommendedLists()
		// …and a downloaded model that is also a catalogue model.
		registry.rows = [
			{
				modelName: "Xenova/all-MiniLM-L6-v2",
				filename: "Xenova/all-MiniLM-L6-v2",
				description: "Downloaded"
			},
			{
				modelName: "some-org/hand-placed",
				filename: "some-org/hand-placed.onnx",
				description: "Downloaded"
			}
		]
		try {
			const mod = (await import("./LocalOnnxEmbeddingAdapter")).default
			const { models } = await mod.listModels(
				conn({
					type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
					baseUrl: null,
					model: null
				})
			)
			const ids = models.map((m: any) => m.model)
			expect(new Set(ids).size).toBe(ids.length)
			for (const m of EMBEDDING_MODELS) expect(ids).toContain(m.id)
			expect(ids).toContain("some-org/hand-placed")
		} finally {
			registry.rows = []
			resetRecommendedLists()
		}
	})

	it("refuses a model the catalogue does not name", async () => {
		const mod = (await import("./LocalOnnxEmbeddingAdapter")).default
		await expect(
			new mod.Adapter(
				conn({
					type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
					baseUrl: null,
					model: "Xenova/not-a-real-model"
				})
			).embedText({ input: ["a"] })
		).rejects.toThrow(/Unknown embedding model/)
	})
})

describe("the family is registered", () => {
	it("loads one embedding module per embedding type", async () => {
		const { ADAPTER_REGISTRY } = await import(
			"$lib/server/adapters/registry"
		)
		for (const type of [
			CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS,
			CONNECTION_TYPE.OPENAI_EMBEDDINGS,
			CONNECTION_TYPE.OLLAMA_EMBEDDINGS
		]) {
			expect(
				ADAPTER_REGISTRY[type]?.embedding,
				`${type} has no embedding module, so nothing can serve its star.`
			).toBeTypeOf("function")
			// And no text or image module: an embedding endpoint that derived
			// `text->text` from the wrong family would be offerable as the chat
			// default.
			expect(ADAPTER_REGISTRY[type]?.text).toBeUndefined()
			expect(ADAPTER_REGISTRY[type]?.image).toBeUndefined()
		}
	})

	it("serves Ollama's embeddings from the chat connection's own host", async () => {
		// One Ollama host, every modality it serves (owner ruling 2026-09-25).
		// The OPPOSITE of the rule above, deliberately: that one keeps an
		// embedding-ONLY type from growing a text family it cannot serve. Ollama
		// serves both from one host, so both families are real — and the lane
		// must reach the embedding one through the same map, by type, with no
		// `ollama-embeddings` row required.
		const { ADAPTER_REGISTRY } = await import(
			"$lib/server/adapters/registry"
		)
		expect(ADAPTER_REGISTRY[CONNECTION_TYPE.OLLAMA]?.text).toBeTypeOf("function")
		expect(ADAPTER_REGISTRY[CONNECTION_TYPE.OLLAMA]?.embedding).toBeTypeOf(
			"function"
		)
		const { getEmbeddingAdapter } = await import(
			"$lib/server/utils/getEmbeddingAdapter"
		)
		const viaChatType = await getEmbeddingAdapter(CONNECTION_TYPE.OLLAMA)
		const viaOldType = await getEmbeddingAdapter(
			CONNECTION_TYPE.OLLAMA_EMBEDDINGS
		)
		// The SAME module either way, so a merged row embeds exactly as the
		// row it replaced did.
		expect(viaChatType).toBe(viaOldType)
	})

	it("routes getEmbeddingAdapter through that same map", async () => {
		const { getEmbeddingAdapter } = await import(
			"$lib/server/utils/getEmbeddingAdapter"
		)
		const mod = await getEmbeddingAdapter(CONNECTION_TYPE.OLLAMA_EMBEDDINGS)
		expect(mod.Adapter).toBeTypeOf("function")
		await expect(getEmbeddingAdapter("openai")).rejects.toThrow(
			/No embedding adapter/
		)
	})
})
