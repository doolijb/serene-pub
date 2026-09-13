/**
 * `loadConfiguredEmbeddingModel()` — "bring the configured backend up from
 * cold", and the one place that decides WHICH backend that is.
 *
 * It exists because that decision was once made twice: correctly in the
 * boot-time auto-load, and mode-unaware in the queue's own `runQueue()`, which
 * called the local loader regardless — silently breaking every host-backed setup
 * the moment nothing else had loaded the right backend first.
 *
 * What it branches on has changed. It was `vectorization_configs.mode`, a column
 * every handler had to keep "in step" with two others; it is now the starred
 * CONNECTION'S TYPE, which is the same fact with nowhere to drift to — and it
 * has to be the type rather than a local/api flag, because `openai-embeddings`
 * and `ollama-embeddings` are both hosts and speak different routes.
 *
 * The resolution itself is `target.int.test.ts`, against a real database. What
 * is checked here is the BRANCH — which backend comes up, and that it is
 * validated with a real call before anything reports ready.
 *
 * ⚠ The idle TTL is applied before the load rather than after, because the timer
 * starts at load time (`resetTtlTimer` runs at the end of activation) and a TTL
 * set afterwards would leave the first window running on the previous value.
 * That ordering has no observable consequence for a host-backed star — see the
 * last case — and the value itself is asserted where it is read.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/db", () => ({
	getCryptoSecretKey: () => "test-crypto-secret-key",
	db: {}
}))

/** What the star resolves to. Set per test. */
let target: any = null
vi.mock("./target", async (orig) => {
	const actual = (await orig()) as any
	return { ...actual, resolveEmbeddingTarget: async () => target }
})

const embedText = vi.fn(async () => ({
	vectors: [Array(384).fill(0.1)],
	model: "m",
	dimensions: 384
}))
const built: string[] = []
vi.mock("$lib/server/utils/getEmbeddingAdapter", () => ({
	getEmbeddingAdapter: async (type: string) => {
		built.push(type)
		return {
			Adapter: class {
				constructor(public connection: any) {}
				embedText = embedText
			}
		}
	}
}))

const apiTarget = (type: string) => ({
	connectionId: 7,
	connectionName: "Embeddings",
	type,
	mode: "api" as const,
	modelId: `api::http://host/v1::${type}-model`,
	ttlMinutes: 11,
	apiBaseUrl: "http://host/v1",
	apiKey: null,
	apiModel: `${type}-model`,
	connection: {
		id: 7,
		name: "Embeddings",
		type,
		baseUrl: "http://host/v1",
		model: `${type}-model`,
		extraJson: {}
	}
})

beforeEach(() => {
	target = null
	built.length = 0
	embedText.mockClear()
})

afterEach(async () => {
	const { unloadEmbeddingModel } = await import("./index")
	unloadEmbeddingModel()
})

describe("with no star", () => {
	test("loads nothing and does not throw", async () => {
		const { loadConfiguredEmbeddingModel, isModelReady, getLoadedModelId } =
			await import("./index")
		await loadConfiguredEmbeddingModel()
		expect(built).toEqual([])
		expect(isModelReady()).toBe(false)
		expect(getLoadedModelId()).toBeNull()
	})
})

describe("a host-backed star", () => {
	test("builds the adapter for the connection's OWN type", async () => {
		// Not "api" — the mode says a host is involved and says nothing about
		// which route. Ollama's `/api/embed` and an OpenAI-compatible
		// `/embeddings` are both `api`.
		target = apiTarget("ollama-embeddings")
		const { loadConfiguredEmbeddingModel } = await import("./index")
		await loadConfiguredEmbeddingModel()
		expect(built).toEqual(["ollama-embeddings"])

		const { unloadEmbeddingModel } = await import("./index")
		unloadEmbeddingModel()
		built.length = 0
		target = apiTarget("openai-embeddings")
		await loadConfiguredEmbeddingModel()
		expect(built).toEqual(["openai-embeddings"])
	})

	test("validates with a real embed call before reporting ready", async () => {
		// A config that fails validation must never reach "ready", or the RAG
		// gate skips nothing and every retrieval surfaces empty context.
		target = apiTarget("openai-embeddings")
		const { loadConfiguredEmbeddingModel, isModelReady, getLoadedModelId } =
			await import("./index")
		await loadConfiguredEmbeddingModel()
		expect(embedText).toHaveBeenCalledTimes(1)
		expect(isModelReady()).toBe(true)
		// The identity every embedded row will be stamped with.
		expect(getLoadedModelId()).toBe(
			"api::http://host/v1::openai-embeddings-model"
		)
	})

	test("is not ready when the probe call fails", async () => {
		target = apiTarget("openai-embeddings")
		embedText.mockRejectedValueOnce(new Error("401 Unauthorized") as never)
		const { loadConfiguredEmbeddingModel, isModelReady, getLoadError } =
			await import("./index")
		await expect(loadConfiguredEmbeddingModel()).rejects.toThrow(/401/)
		expect(isModelReady()).toBe(false)
		expect(getLoadError()).toMatch(/401/)
	})

	test("is never idle-unloaded: the TTL is a LOCAL concern", async () => {
		// `resetTtlTimer` starts nothing without a resident pipeline, and that is
		// right — there is no memory to reclaim from a host, and unloading would
		// only mean paying the validation round trip again on the next embed.
		// The knob is still per-connection (see `target.int.test.ts`); it simply
		// has nothing to do on a row of this kind, which is what the old panel's
		// "no-op in API mode" note said out loud.
		vi.useFakeTimers()
		try {
			target = apiTarget("openai-embeddings")
			const { loadConfiguredEmbeddingModel, isModelReady } = await import(
				"./index"
			)
			await loadConfiguredEmbeddingModel()
			expect(isModelReady()).toBe(true)
			vi.advanceTimersByTime(60 * 60 * 1000)
			expect(isModelReady()).toBe(true)
		} finally {
			vi.useRealTimers()
		}
	})
})

describe("a local star", () => {
	test("never reaches the adapter registry", async () => {
		// The in-process pipeline is not an adapter call, and building one for a
		// local model would try to speak HTTP to a connection with no base URL.
		target = {
			connectionId: 3,
			connectionName: "Local",
			type: "local-onnx",
			mode: "local" as const,
			modelId: "Xenova/not-a-real-model",
			ttlMinutes: 5,
			localModelName: "Xenova/not-a-real-model",
			connection: {
				id: 3,
				type: "local-onnx",
				model: "Xenova/not-a-real-model",
				extraJson: {}
			}
		}
		const { loadConfiguredEmbeddingModel } = await import("./index")
		// It refuses — the model is in neither the catalogue nor the registry,
		// or the platform cannot load ONNX at all — and either way the point
		// stands: it went down the local path.
		await expect(loadConfiguredEmbeddingModel()).rejects.toThrow()
		expect(built).toEqual([])
	})
})
