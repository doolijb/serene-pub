import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const isAndroidWrapperMock = vi.fn(() => false)

vi.mock("$lib/server/utils", () => ({
	getAppDataDir: () => "/tmp/fake-app-data",
	isAndroidWrapper: () => isAndroidWrapperMock()
}))

/**
 * What the local model registry answers, for the loader's dtype lookup. Every
 * select answers these rows; the dtype tests set them.
 */
const { registryRows } = vi.hoisted(() => ({
	registryRows: [] as Array<{ quantization: string | null }>
}))

// index.ts imports tokenCrypto.ts (for resolveVectorizationApiKey), which
// imports the real `db` module for getCryptoSecretKey() — that otherwise
// triggers a real connection/lock-check against the on-disk dev database
// purely as an import side effect. A stub is enough: the one query made here
// is the loader's registry lookup, answered from `registryRows`.
vi.mock("$lib/server/db", () => {
	const chain: any = {
		from: () => chain,
		where: () => chain,
		limit: async () => registryRows
	}
	return {
		getCryptoSecretKey: () => "test-crypto-secret-key",
		db: { select: () => chain }
	}
})

/**
 * The probe result is cached at module scope (deliberately — see
 * index.ts's comment on probeResult/probePromise), so each test needs a
 * fresh module instance to observe a different outcome. Mirrors the
 * freshImport() pattern used elsewhere in this codebase for modules with
 * top-level mutable state (e.g. subprocessManager.test.ts).
 */
async function freshImport() {
	vi.resetModules()
	return await import("./index")
}

describe("getLocalEmbeddingUnsupportedReason / isLocalEmbeddingSupported", () => {
	beforeEach(() => {
		isAndroidWrapperMock.mockReturnValue(false)
		vi.doUnmock("@huggingface/transformers")
	})

	afterEach(() => {
		vi.doUnmock("@huggingface/transformers")
	})

	test("supported when the dynamic import succeeds", async () => {
		vi.doMock("@huggingface/transformers", () => ({}))
		const mod = await freshImport()
		await expect(
			mod.getLocalEmbeddingUnsupportedReason()
		).resolves.toBeNull()
		await expect(mod.isLocalEmbeddingSupported()).resolves.toBe(true)
	})

	test("unsupported when the dynamic import throws", async () => {
		// A factory that throws is intentional here (simulating a native
		// module load failure) — vitest wraps whatever the factory throws
		// into its own mock-setup diagnostic rather than propagating it
		// verbatim, so this only asserts the general shape (a non-null
		// reason surfaces, and supported flips to false), not the exact
		// wrapped wording.
		vi.doMock("@huggingface/transformers", () => {
			throw new Error("Cannot find module 'onnxruntime_binding.node'")
		})
		const mod = await freshImport()
		const reason = await mod.getLocalEmbeddingUnsupportedReason()
		expect(reason).toMatch(/not available on this system/)
		await expect(mod.isLocalEmbeddingSupported()).resolves.toBe(false)
	})

	test("Android short-circuits with a specific message and never attempts the import", async () => {
		isAndroidWrapperMock.mockReturnValue(true)
		const importAttempt = vi.fn(() => ({}))
		vi.doMock("@huggingface/transformers", importAttempt)
		const mod = await freshImport()

		const reason = await mod.getLocalEmbeddingUnsupportedReason()
		expect(reason).toMatch(/Android/)
		expect(importAttempt).not.toHaveBeenCalled()
	})

	test("caches the probe result — the import is only attempted once across repeated calls", async () => {
		const importAttempt = vi.fn(() => ({}))
		vi.doMock("@huggingface/transformers", importAttempt)
		const mod = await freshImport()

		await mod.isLocalEmbeddingSupported()
		await mod.isLocalEmbeddingSupported()
		await mod.getLocalEmbeddingUnsupportedReason()

		expect(importAttempt).toHaveBeenCalledTimes(1)
	})

	test("concurrent first calls share one in-flight probe, not one import attempt per caller", async () => {
		const importAttempt = vi.fn(() => ({}))
		vi.doMock("@huggingface/transformers", importAttempt)
		const mod = await freshImport()

		await Promise.all([
			mod.isLocalEmbeddingSupported(),
			mod.isLocalEmbeddingSupported(),
			mod.getLocalEmbeddingUnsupportedReason()
		])

		expect(importAttempt).toHaveBeenCalledTimes(1)
	})
})

/**
 * The precision the loader asks for: the catalogue's `dtype` first, then the
 * one the download recorded on the registry row (`local_models.
 * quantization`), else none. Loading at any other precision asks for a
 * weights file the download never fetched — a Hub-added model set to `fp16`
 * downloaded `model_fp16.onnx` and then looked for `model.onnx`.
 */
describe("loadEmbeddingModel's dtype", () => {
	const pipelineSpy = vi.fn(async () => ({}))

	beforeEach(() => {
		isAndroidWrapperMock.mockReturnValue(false)
		registryRows.length = 0
		pipelineSpy.mockClear()
		vi.doMock("@huggingface/transformers", () => ({
			pipeline: pipelineSpy,
			env: {}
		}))
		vi.doMock("./models", () => ({
			findModel: (id: string) =>
				id === "catalogued/model"
					? { id, name: "catalogued", dtype: "q8" }
					: undefined
		}))
	})

	afterEach(() => {
		vi.doUnmock("@huggingface/transformers")
		vi.doUnmock("./models")
	})

	/** The options the one `pipeline()` call was handed. */
	const loadedWith = () => (pipelineSpy.mock.lastCall as any)?.[2]

	test("is the catalogue's for a catalogued model, whatever the registry says", async () => {
		registryRows.push({ quantization: "fp16" })
		const mod = await freshImport()
		await mod.loadEmbeddingModel("catalogued/model")
		expect((pipelineSpy.mock.lastCall as any)?.[1]).toBe("catalogued/model")
		expect(loadedWith()).toMatchObject({ dtype: "q8" })
		mod.unloadEmbeddingModel()
	})

	test("is the registry row's for a model the catalogue doesn't name", async () => {
		registryRows.push({ quantization: "fp16" })
		const mod = await freshImport()
		await mod.loadEmbeddingModel("someone/hand-added")
		expect(loadedWith()).toMatchObject({ dtype: "fp16" })
		mod.unloadEmbeddingModel()
	})

	test("is left to the runtime when the registry row records none", async () => {
		registryRows.push({ quantization: null })
		const mod = await freshImport()
		await mod.loadEmbeddingModel("someone/hand-added")
		expect(loadedWith()).not.toHaveProperty("dtype")
		mod.unloadEmbeddingModel()
	})

	test("refuses a model neither the catalogue nor the registry knows", async () => {
		const mod = await freshImport()
		await expect(mod.loadEmbeddingModel("nobody/knows")).rejects.toThrow(
			"Unknown embedding model: nobody/knows"
		)
		expect(pipelineSpy).not.toHaveBeenCalled()
	})
})
