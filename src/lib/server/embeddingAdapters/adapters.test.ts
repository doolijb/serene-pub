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

import { afterEach, describe, expect, it, vi } from "vitest"
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
 * "none" is the answer that makes the catalogue assertions exact.
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

describe("local ONNX embeddings", () => {
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
