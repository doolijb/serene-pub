/**
 * One verdict for local ONNX, and both lanes reading it.
 *
 * The embedding and entity lanes load one runtime, so they must never disagree
 * about whether it loads — and the client's `localOnnxAvailability` is the same
 * verdict again. The verdict is cached at module scope, so every case starts
 * from a fresh module graph.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const isAndroidWrapperMock = vi.fn(() => false)

vi.mock("$lib/server/utils", () => ({
	getAppDataDir: () => "/tmp/fake-app-data",
	isAndroidWrapper: () => isAndroidWrapperMock()
}))

// embedding/index.ts reaches tokenCrypto, which reaches the real `db` module;
// nothing here touches a database.
vi.mock("$lib/server/db", () => ({
	getCryptoSecretKey: () => "test-crypto-secret-key"
}))

async function fresh() {
	vi.resetModules()
	return {
		runtime: await import("./onnxRuntime"),
		embedding: await import("$lib/server/embedding/index"),
		ner: await import("$lib/server/ner/index")
	}
}

describe("localOnnxAvailability", () => {
	beforeEach(() => {
		isAndroidWrapperMock.mockReturnValue(false)
		vi.doUnmock("@huggingface/transformers")
	})
	afterEach(() => {
		vi.doUnmock("@huggingface/transformers")
	})

	test("available, with no reason, when the runtime imports", async () => {
		vi.doMock("@huggingface/transformers", () => ({}))
		const { runtime } = await fresh()
		await expect(runtime.localOnnxAvailability()).resolves.toEqual({
			available: true,
			reason: null
		})
		await expect(runtime.localOnnxRefusal()).resolves.toBeNull()
	})

	test("unavailable, with a clause naming the runtime, when the import throws", async () => {
		vi.doMock("@huggingface/transformers", () => {
			throw new Error("Cannot find module 'onnxruntime_binding.node'")
		})
		const { runtime } = await fresh()
		const verdict = await runtime.localOnnxAvailability()
		expect(verdict.available).toBe(false)
		// A clause, so a surface can lead it with its own words.
		expect(verdict.reason).toMatch(/^the ONNX runtime didn't load \(/)
		await expect(runtime.localOnnxRefusal()).resolves.toMatch(
			/^Local ONNX models aren't available on this machine: the ONNX runtime didn't load/
		)
	})

	test("Android answers without attempting the import", async () => {
		isAndroidWrapperMock.mockReturnValue(true)
		const importAttempt = vi.fn(() => ({}))
		vi.doMock("@huggingface/transformers", importAttempt)
		const { runtime } = await fresh()
		const verdict = await runtime.localOnnxAvailability()
		expect(verdict).toEqual({
			available: false,
			reason: "the Android app can't run the ONNX runtime"
		})
		expect(importAttempt).not.toHaveBeenCalled()
	})

	test("the embedding and entity lanes read ONE probe, and agree", async () => {
		const importAttempt = vi.fn(() => {
			throw new Error("no binding for this platform")
		})
		vi.doMock("@huggingface/transformers", importAttempt)
		const { runtime, embedding, ner } = await fresh()

		const [verdict, embeddingReason, nerReason] = await Promise.all([
			runtime.localOnnxAvailability(),
			embedding.getLocalEmbeddingUnsupportedReason(),
			ner.getLocalNerUnsupportedReason()
		])
		await ner.getLocalNerUnsupportedReason()
		await embedding.isLocalEmbeddingSupported()

		expect(importAttempt).toHaveBeenCalledTimes(1)
		expect(verdict.available).toBe(false)
		// Each lane's own sentence, carrying the one shared reason.
		expect(embeddingReason).toContain(verdict.reason!)
		expect(nerReason).toContain(verdict.reason!)
		expect(embeddingReason).toMatch(/^Local embeddings/)
		expect(nerReason).toMatch(/^Local entity extraction/)
	})

	test("both lanes say nothing when the runtime loads", async () => {
		vi.doMock("@huggingface/transformers", () => ({}))
		const { embedding, ner } = await fresh()
		await expect(
			embedding.getLocalEmbeddingUnsupportedReason()
		).resolves.toBeNull()
		await expect(ner.getLocalNerUnsupportedReason()).resolves.toBeNull()
	})
})
