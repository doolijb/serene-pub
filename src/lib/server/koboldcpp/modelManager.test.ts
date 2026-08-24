import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { writeFile } from "fs/promises"

// modelManager.ts keeps module-level mutable state (loadedSignature,
// loadingPromise) that isn't exported for reset — vi.resetModules() plus a
// fresh dynamic import per test is the only reliable way to isolate tests
// from each other.

const fetchCurrentModelNameMock = vi.fn()
const fetchCurrentModelStatusMock = vi.fn()
const fetchModelStatusForPollMock = vi.fn()
vi.mock("./kcppHttp", () => ({
	fetchCurrentModelName: (...args: any[]) =>
		fetchCurrentModelNameMock(...args),
	fetchCurrentModelStatus: (...args: any[]) =>
		fetchCurrentModelStatusMock(...args),
	fetchModelStatusForPoll: (...args: any[]) =>
		fetchModelStatusForPollMock(...args)
}))

vi.mock("fs/promises", () => ({
	writeFile: vi.fn().mockResolvedValue(undefined)
}))

function baseOpts(overrides: Record<string, any> = {}) {
	return {
		connectionId: 1,
		managedConfig: {
			modelFile: "some-model.gguf",
			gpuLayers: -1,
			flashAttention: false,
			batchSize: 512
		},
		baseUrl: "http://localhost:5001",
		modelsDir: null,
		adminDir: "/tmp/admin",
		adminPassword: "pw",
		ttlSecs: 0, // 0 disables the TTL unload timer — nothing left running after the test
		...overrides
	}
}

async function freshImport() {
	vi.resetModules()
	return await import("./modelManager")
}

describe("ensureModelLoaded", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.useFakeTimers()
		fetchCurrentModelNameMock.mockReset()
		fetchCurrentModelStatusMock.mockReset()
		fetchModelStatusForPollMock.mockReset()
		// Default: report whatever the name mock says as a *definitive* answer.
		// That reproduces the pre-`determined` semantics, so tests that only
		// care about which model is loaded keep driving the name mock alone.
		fetchCurrentModelStatusMock.mockImplementation(
			async (...args: any[]) => ({
				modelName: await fetchCurrentModelNameMock(...args),
				refused: false,
				determined: true
			})
		)
		fetchMock = vi.fn()
		vi.stubGlobal("fetch", fetchMock)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	test("reloads even when the right model is already loaded, if this process has no record of ever loading it (post-restart)", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelNameMock.mockResolvedValue("some-model")
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: true })
		})
		fetchModelStatusForPollMock.mockResolvedValue({
			modelName: "some-model",
			refused: false
		})

		await ensureModelLoaded(baseOpts())

		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:5001/api/admin/reload_config",
			expect.objectContaining({ method: "POST" })
		)
	})

	test("skips reload when this process already loaded the same model with matching config and sufficient context", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelNameMock.mockResolvedValue("some-model")
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: true })
		})
		fetchModelStatusForPollMock.mockResolvedValue({
			modelName: "some-model",
			refused: false
		})

		// First call establishes loadedSignature.
		await ensureModelLoaded(baseOpts({ contextSize: 4096 }))
		fetchMock.mockClear()

		// Second call, identical config — should skip the reload entirely.
		await ensureModelLoaded(baseOpts({ contextSize: 4096 }))
		expect(fetchMock).not.toHaveBeenCalled()
	})

	// Regression: a busy koboldcpp (mid-load, or holding its single worker for
	// a long generation) cannot answer /api/v1/model. Reading that silence as
	// "the wrong model is loaded" made us reload, which aborted the in-flight
	// load and guaranteed the next probe was also unanswered — a livelock that
	// burned a 15-minute graph build for 39 reloads and 2 generations.
	describe("when koboldcpp cannot answer whether a model is loaded", () => {
		const undetermined = {
			modelName: null,
			refused: false,
			determined: false
		}

		test("trusts its own record instead of reloading", async () => {
			const { ensureModelLoaded } = await freshImport()
			fetchCurrentModelNameMock.mockResolvedValue("some-model")
			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => ({ success: true })
			})
			fetchModelStatusForPollMock.mockResolvedValue({
				modelName: "some-model",
				refused: false
			})

			// First call establishes loadedSignature while the box is responsive.
			await ensureModelLoaded(baseOpts({ contextSize: 4096 }))
			fetchMock.mockClear()

			// Now it goes quiet — busy loading or generating.
			fetchCurrentModelStatusMock.mockResolvedValue(undetermined)
			await ensureModelLoaded(baseOpts({ contextSize: 4096 }))

			expect(fetchMock).not.toHaveBeenCalled()
		})

		test("still reloads if it has no record of loading this model", async () => {
			const { ensureModelLoaded } = await freshImport()
			fetchCurrentModelStatusMock.mockResolvedValue(undetermined)
			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => ({ success: true })
			})
			fetchModelStatusForPollMock.mockResolvedValue({
				modelName: "some-model",
				refused: false
			})

			await ensureModelLoaded(baseOpts({ contextSize: 4096 }))

			expect(fetchMock).toHaveBeenCalledWith(
				"http://localhost:5001/api/admin/reload_config",
				expect.objectContaining({ method: "POST" })
			)
		})

		test("still reloads if the request now needs a bigger context than it loaded", async () => {
			const { ensureModelLoaded } = await freshImport()
			fetchCurrentModelNameMock.mockResolvedValue("some-model")
			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => ({ success: true })
			})
			fetchModelStatusForPollMock.mockResolvedValue({
				modelName: "some-model",
				refused: false
			})

			await ensureModelLoaded(baseOpts({ contextSize: 4096 }))
			fetchMock.mockClear()

			fetchCurrentModelStatusMock.mockResolvedValue(undetermined)
			await ensureModelLoaded(baseOpts({ contextSize: 8192 }))

			expect(fetchMock).toHaveBeenCalled()
		})

		test("a refused connection is definitive, so it still reloads", async () => {
			const { ensureModelLoaded } = await freshImport()
			fetchCurrentModelNameMock.mockResolvedValue("some-model")
			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => ({ success: true })
			})
			fetchModelStatusForPollMock.mockResolvedValue({
				modelName: "some-model",
				refused: false
			})

			await ensureModelLoaded(baseOpts({ contextSize: 4096 }))
			fetchMock.mockClear()

			// ECONNREFUSED means the process is genuinely gone — not ambiguous.
			fetchCurrentModelStatusMock.mockResolvedValue({
				modelName: null,
				refused: true,
				determined: true
			})
			await ensureModelLoaded(baseOpts({ contextSize: 4096 }))

			expect(fetchMock).toHaveBeenCalled()
		})
	})

	test("reloads when the previously loaded context size is smaller than what's now requested", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelNameMock.mockResolvedValue("some-model")
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: true })
		})
		fetchModelStatusForPollMock.mockResolvedValue({
			modelName: "some-model",
			refused: false
		})

		await ensureModelLoaded(baseOpts({ contextSize: 4096 }))
		fetchMock.mockClear()

		await ensureModelLoaded(baseOpts({ contextSize: 8192 }))
		expect(fetchMock).toHaveBeenCalled()
	})

	// Bugfix: koboldcpp's admin reload_config resets every non-protected arg
	// to its argparse default before reapplying whatever's in the .kcpps
	// file — a spawn-time-only --jinja flag (subprocessManager.ts) gets
	// silently wiped the moment the first model loads through this path.
	// jinja must be written into the .kcpps file itself to actually persist,
	// since that's what koboldcpp reapplies on every reload.
	test("writes jinja: true into the generated .kcpps config", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelNameMock.mockResolvedValue("some-model")
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: true })
		})
		fetchModelStatusForPollMock.mockResolvedValue({
			modelName: "some-model",
			refused: false
		})

		await ensureModelLoaded(baseOpts())

		const writeFileMock = vi.mocked(writeFile)
		expect(writeFileMock).toHaveBeenCalled()
		const writtenContent = writeFileMock.mock.calls[0][1] as string
		const parsed = JSON.parse(writtenContent)
		expect(parsed.jinja).toBe(true)
	})

	test("reloads when gpuLayers/flashAttention/batchSize differ from what this process last loaded", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelNameMock.mockResolvedValue("some-model")
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: true })
		})
		fetchModelStatusForPollMock.mockResolvedValue({
			modelName: "some-model",
			refused: false
		})

		await ensureModelLoaded(baseOpts())
		fetchMock.mockClear()

		await ensureModelLoaded(
			baseOpts({
				managedConfig: {
					modelFile: "some-model.gguf",
					gpuLayers: 10, // changed
					flashAttention: false,
					batchSize: 512
				}
			})
		)
		expect(fetchMock).toHaveBeenCalled()
	})

	test("retries the reload_config POST through ECONNREFUSED as long as isAlive() is true, and eventually succeeds", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelNameMock.mockResolvedValue(null)
		let attempts = 0
		fetchMock.mockImplementation(async () => {
			attempts++
			if (attempts < 3) {
				const err: any = new Error("fetch failed")
				err.cause = { code: "ECONNREFUSED" }
				throw err
			}
			return { ok: true, json: async () => ({ success: true }) }
		})
		fetchModelStatusForPollMock.mockResolvedValue({
			modelName: "some-model",
			refused: false
		})

		const promise = ensureModelLoaded(baseOpts({ isAlive: () => true }))
		await vi.advanceTimersByTimeAsync(2000)
		await vi.advanceTimersByTimeAsync(2000)
		await promise
		expect(attempts).toBe(3)
	})

	test("gives up on reload_config ECONNREFUSED without isAlive, after the fixed fallback ceiling", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelNameMock.mockResolvedValue(null)
		fetchMock.mockImplementation(async () => {
			const err: any = new Error("fetch failed")
			err.cause = { code: "ECONNREFUSED" }
			throw err
		})

		const promise = ensureModelLoaded(baseOpts())
		promise.catch(() => {})
		for (let i = 0; i < 5; i++) {
			await vi.advanceTimersByTimeAsync(2000)
		}
		await expect(promise).rejects.toThrow(/crashed|not reachable/i)
	})

	test("does not retry a non-refusal reload_config failure (e.g. a real HTTP error)", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelNameMock.mockResolvedValue(null)
		fetchMock.mockResolvedValue({
			ok: false,
			status: 401,
			text: async () => "unauthorized"
		})

		await expect(
			ensureModelLoaded(baseOpts({ isAlive: () => true }))
		).rejects.toThrow(/reload_config failed: 401/)
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	test("throws when reload_config responds ok but success: false", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelNameMock.mockResolvedValue(null)
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: false })
		})

		await expect(ensureModelLoaded(baseOpts())).rejects.toThrow(
			/rejected the request/
		)
	})

	test("waits for the model swap to complete via waitForModelReady, tolerating refusals while isAlive() is true", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelNameMock.mockResolvedValue(null)
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: true })
		})
		let pollCalls = 0
		fetchModelStatusForPollMock.mockImplementation(async () => {
			pollCalls++
			if (pollCalls < 3) return { modelName: null, refused: true }
			return { modelName: "some-model", refused: false }
		})

		const promise = ensureModelLoaded(baseOpts({ isAlive: () => true }))
		await vi.advanceTimersByTimeAsync(2000)
		await vi.advanceTimersByTimeAsync(2000)
		await promise
		expect(pollCalls).toBe(3)
	})

	test("waitForModelReady fails fast once isAlive() reports the process died mid-load", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelNameMock.mockResolvedValue(null)
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: true })
		})
		let alive = true
		fetchModelStatusForPollMock.mockResolvedValue({
			modelName: null,
			refused: true
		})

		const promise = ensureModelLoaded(baseOpts({ isAlive: () => alive }))
		promise.catch(() => {})
		await vi.advanceTimersByTimeAsync(0)
		alive = false
		await vi.advanceTimersByTimeAsync(2000)
		await expect(promise).rejects.toThrow(/no longer running/)
	})
})
