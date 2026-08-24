import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const isAndroidWrapperMock = vi.fn(() => false)

vi.mock("$lib/server/utils", () => ({
	getAppDataDir: () => "/tmp/fake-app-data",
	isAndroidWrapper: () => isAndroidWrapperMock()
}))

// index.ts imports tokenCrypto.ts (for resolveVectorizationApiKey), which
// imports the real `db` module for getCryptoSecretKey() — that otherwise
// triggers a real connection/lock-check against the on-disk dev database
// purely as an import side effect. A bare stub is enough since nothing in
// this file calls it.
vi.mock("$lib/server/db", () => ({
	getCryptoSecretKey: () => "test-crypto-secret-key"
}))

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
