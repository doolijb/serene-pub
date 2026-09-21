import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { writeFile } from "fs/promises"

// modelManager.ts keeps module-level mutable state (loadedSignature,
// loadingPromise) that isn't exported for reset — vi.resetModules() plus a
// fresh dynamic import per test is the only reliable way to isolate tests
// from each other.

const fetchCurrentModelStatusMock = vi.fn()
const fetchModelStatusForPollMock = vi.fn()
const fetchImageModelStatusMock = vi.fn()
vi.mock("./kcppHttp", () => ({
	fetchCurrentModelStatus: (...args: any[]) =>
		fetchCurrentModelStatusMock(...args),
	fetchModelStatusForPoll: (...args: any[]) =>
		fetchModelStatusForPollMock(...args),
	fetchImageModelStatus: (...args: any[]) =>
		fetchImageModelStatusMock(...args)
}))

vi.mock("fs/promises", () => ({
	writeFile: vi.fn().mockResolvedValue(undefined)
}))

const TEXT_PATH = "/models/llm/some-model.gguf"
const IMAGE_PATH = "/models/image/sdxl_q4_0.gguf"

function textRequest(over: Record<string, any> = {}) {
	return {
		kind: "text" as const,
		file: "some-model.gguf",
		path: TEXT_PATH,
		gpuLayers: -1,
		flashAttention: false,
		batchSize: 512,
		contextSize: 4096,
		...over
	}
}

function imageRequest(over: Record<string, any> = {}) {
	return {
		kind: "image" as const,
		file: "sdxl_q4_0.gguf",
		path: IMAGE_PATH,
		...over
	}
}

function baseOpts(
	request: any = textRequest(),
	overrides: Record<string, any> = {}
) {
	return {
		connectionId: 1,
		request,
		baseUrl: "http://localhost:5001",
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

/** Drive a load to completion under fake timers: the readiness polls sleep
 * between ticks, so a bare `await` on the returned promise would hang. */
async function settle<T>(promise: Promise<T>): Promise<T> {
	let done = false
	promise.then(
		() => (done = true),
		() => (done = true)
	)
	while (!done) await vi.advanceTimersByTimeAsync(500)
	return promise
}

const lastConfig = () =>
	JSON.parse(vi.mocked(writeFile).mock.calls.at(-1)![1] as string)
const lastConfigFilename = () =>
	String(vi.mocked(writeFile).mock.calls.at(-1)![0])

// The three answers /api/extra/version can give about an image model. The
// third is the one that matters: "we could not ask", never "nothing is loaded".
const IMAGE_OFF = { present: false, refused: false, determined: true }
const IMAGE_ON = { present: true, refused: false, determined: true }
const IMAGE_UNANSWERED = { present: false, refused: false, determined: false }

describe("ensureModelLoaded", () => {
	let fetchMock: ReturnType<typeof vi.fn>

	beforeEach(() => {
		vi.useFakeTimers()
		// Cleared per test because several below read mock.calls to inspect the
		// .kcpps that was written — without this they'd be reading the config
		// some earlier test wrote and would pass on it.
		vi.mocked(writeFile).mockClear()
		fetchCurrentModelStatusMock.mockReset()
		fetchModelStatusForPollMock.mockReset()
		fetchImageModelStatusMock.mockReset()
		fetchMock = vi.fn()
		vi.stubGlobal("fetch", fetchMock)
	})

	afterEach(() => {
		vi.useRealTimers()
		vi.unstubAllGlobals()
	})

	/** koboldcpp answers everything, with the text model already resident.
	 *
	 * The readiness poll is scripted the way the real binary behaves on a
	 * reload: the OUTGOING listener still answers with the old name for a
	 * moment, then the port is down for the whole load, then the new process
	 * answers. A wait that returns on the first affirmative tick is the bug
	 * (see "does not accept the outgoing model" below). */
	function textHappyPath(modelName: string | null = "some-model") {
		fetchCurrentModelStatusMock.mockResolvedValue({
			modelName,
			refused: false,
			determined: true
		})
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: true })
		})
		fetchModelStatusForPollMock
			.mockResolvedValueOnce({ modelName: "some-model", refused: false })
			.mockResolvedValueOnce({ modelName: null, refused: true })
			.mockResolvedValue({ modelName: "some-model", refused: false })
	}

	/** koboldcpp answers everything; no image model resident until the reload. */
	function imageHappyPath() {
		fetchImageModelStatusMock
			.mockResolvedValueOnce(IMAGE_OFF)
			.mockResolvedValue(IMAGE_ON)
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: true })
		})
	}

	test("reloads even when the right model is already loaded, if this process has no record of ever loading it (post-restart)", async () => {
		const { ensureModelLoaded } = await freshImport()
		textHappyPath()

		await settle(ensureModelLoaded(baseOpts()))

		expect(fetchMock).toHaveBeenCalledWith(
			"http://localhost:5001/api/admin/reload_config",
			expect.objectContaining({ method: "POST" })
		)
	})

	test("skips reload when this process already loaded the same model with matching config and sufficient context", async () => {
		const { ensureModelLoaded } = await freshImport()
		textHappyPath()

		// First call establishes the residency record.
		await settle(ensureModelLoaded(baseOpts()))
		fetchMock.mockClear()

		// Second call, identical request — should skip the reload entirely.
		await settle(ensureModelLoaded(baseOpts()))
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
			textHappyPath()

			await settle(ensureModelLoaded(baseOpts()))
			fetchMock.mockClear()

			// Now it goes quiet — busy loading or generating.
			fetchCurrentModelStatusMock.mockResolvedValue(undetermined)
			await settle(ensureModelLoaded(baseOpts()))

			expect(fetchMock).not.toHaveBeenCalled()
		})

		test("still reloads if it has no record of loading this model", async () => {
			const { ensureModelLoaded } = await freshImport()
			textHappyPath()
			fetchCurrentModelStatusMock.mockResolvedValue(undetermined)

			await settle(ensureModelLoaded(baseOpts()))

			expect(fetchMock).toHaveBeenCalledWith(
				"http://localhost:5001/api/admin/reload_config",
				expect.objectContaining({ method: "POST" })
			)
		})

		test("still reloads if the request now needs a bigger context than it loaded", async () => {
			const { ensureModelLoaded } = await freshImport()
			textHappyPath()

			await settle(ensureModelLoaded(baseOpts()))
			fetchMock.mockClear()

			fetchCurrentModelStatusMock.mockResolvedValue(undetermined)
			await settle(
				ensureModelLoaded(baseOpts(textRequest({ contextSize: 8192 })))
			)

			expect(fetchMock).toHaveBeenCalled()
		})

		test("a refused connection is definitive, so it still reloads", async () => {
			const { ensureModelLoaded } = await freshImport()
			textHappyPath()

			await settle(ensureModelLoaded(baseOpts()))
			fetchMock.mockClear()

			// ECONNREFUSED means the process is genuinely gone — not ambiguous.
			fetchCurrentModelStatusMock.mockResolvedValue({
				modelName: null,
				refused: true,
				determined: true
			})
			await settle(ensureModelLoaded(baseOpts()))

			expect(fetchMock).toHaveBeenCalled()
		})

		// The image half MIRRORS the guard above rather than merely inheriting
		// it: an image load blocks koboldcpp's single worker for minutes in
		// exactly the same way, so treating an unanswered /api/extra/version as
		// "the wrong model is loaded" would produce the same reload livelock.
		test("the image skip-check trusts the in-process record when the version endpoint is unanswered", async () => {
			const { ensureModelLoaded } = await freshImport()
			imageHappyPath()

			await settle(ensureModelLoaded(baseOpts(imageRequest())))
			fetchMock.mockClear()

			fetchImageModelStatusMock.mockResolvedValue(IMAGE_UNANSWERED)
			await settle(ensureModelLoaded(baseOpts(imageRequest())))

			expect(fetchMock).not.toHaveBeenCalled()
		})

		test("but a definite 'no image model is loaded' still forces a reload", async () => {
			const { ensureModelLoaded } = await freshImport()
			imageHappyPath()

			await settle(ensureModelLoaded(baseOpts(imageRequest())))
			fetchMock.mockClear()
			// Somebody unloaded it behind our back. koboldcpp answering "no"
			// is an ANSWER, unlike silence, and it outranks our record.
			fetchImageModelStatusMock
				.mockResolvedValueOnce(IMAGE_OFF)
				.mockResolvedValue(IMAGE_ON)

			await settle(ensureModelLoaded(baseOpts(imageRequest())))

			expect(fetchMock).toHaveBeenCalled()
		})
	})

	test("reloads when the previously loaded context size is smaller than what's now requested", async () => {
		const { ensureModelLoaded } = await freshImport()
		textHappyPath()

		await settle(ensureModelLoaded(baseOpts()))
		fetchMock.mockClear()

		await settle(ensureModelLoaded(baseOpts(textRequest({ contextSize: 8192 }))))
		expect(fetchMock).toHaveBeenCalled()
	})

	test("reloads when gpuLayers/flashAttention/batchSize differ from what this process last loaded", async () => {
		const { ensureModelLoaded } = await freshImport()
		textHappyPath()

		await settle(ensureModelLoaded(baseOpts()))
		fetchMock.mockClear()

		await settle(ensureModelLoaded(baseOpts(textRequest({ gpuLayers: 10 }))))
		expect(fetchMock).toHaveBeenCalled()
	})

	describe("the generated .kcpps", () => {
		// Bugfix: koboldcpp's admin reload_config resets every non-protected arg
		// to its argparse default before reapplying whatever's in the .kcpps
		// file — a spawn-time-only --jinja flag (subprocessManager.ts) gets
		// silently wiped the moment the first model loads through this path.
		test("a text-only plan writes exactly the keys it always has, and no sdmodel", async () => {
			const { ensureModelLoaded } = await freshImport()
			textHappyPath()

			await settle(ensureModelLoaded(baseOpts()))

			expect(lastConfig()).toEqual({
				model: [TEXT_PATH],
				gpulayers: -1,
				contextsize: 4096,
				flashattention: false,
				batchsize: 512,
				jinja: true
			})
		})

		// Verified against the real binary: reload_config accepts this and comes
		// up reporting txt2img on and llm off. An empty `model` list plus a
		// dangling `model_param` would be the dishonest way to say "no text
		// model"; saying nothing at all is the honest one.
		test("an image-only plan writes nomodel and sdmodel, and none of the text knobs", async () => {
			const { ensureModelLoaded } = await freshImport()
			imageHappyPath()

			await settle(
				ensureModelLoaded(baseOpts(imageRequest({ threads: 7, quant: 1 })))
			)

			expect(lastConfig()).toEqual({
				nomodel: true,
				jinja: true,
				sdmodel: IMAGE_PATH,
				sdthreads: 7,
				sdquant: 1
			})
		})

		// koboldcpp's --model is nargs='+' and arrives as a list; --sdmodel is a
		// bare string (confirmed against a .kcpps written by koboldcpp's own
		// GUI). reload_config setattrs the JSON value with no coercion at all
		// and the loader hands it to os.path.abspath(), which turns a
		// one-element list into the literal "['/path']" and then can't find it.
		test("sdmodel is a plain string, not a one-element list like model", async () => {
			const { ensureModelLoaded } = await freshImport()
			imageHappyPath()

			await settle(ensureModelLoaded(baseOpts(imageRequest())))

			expect(lastConfig().sdmodel).toBe(IMAGE_PATH)
		})

		test("omits sdthreads and sdquant when they are absent or zero", async () => {
			const { ensureModelLoaded } = await freshImport()
			imageHappyPath()

			await settle(ensureModelLoaded(baseOpts(imageRequest({ quant: 0 }))))

			// 0 is koboldcpp's own default, so sending it says nothing extra.
			expect("sdquant" in lastConfig()).toBe(false)
			expect("sdthreads" in lastConfig()).toBe(false)
		})

		// The two models share one --admindir. Without the kind in the name,
		// "foo.gguf" as a text model and "foo.safetensors" as an image model
		// would write the same serene_foo.kcpps and silently overwrite each
		// other's load config.
		test("names the config file after the KIND as well as the model", async () => {
			const { ensureModelLoaded } = await freshImport()
			textHappyPath()
			await settle(ensureModelLoaded(baseOpts()))
			expect(lastConfigFilename()).toContain(
				"serene_text_some-model.kcpps"
			)

			imageHappyPath()
			await settle(ensureModelLoaded(baseOpts(imageRequest())))
			expect(lastConfigFilename()).toContain(
				"serene_image_sdxl_q4_0.kcpps"
			)
		})
	})

	describe("residency", () => {
		test("planResidency evicts: today exactly one model is resident", async () => {
			const { planResidency } = await freshImport()

			const after = planResidency(imageRequest(), {
				text: {
					file: "some-model.gguf",
					path: TEXT_PATH,
					gpuLayers: -1,
					flashAttention: false,
					batchSize: 512,
					contextSize: 4096
				}
			})

			expect(Object.keys(after)).toEqual(["image"])
		})

		// The point of the seam. Nothing in production builds a two-entry plan,
		// so if the builder quietly forbade one, "co-loading is one function
		// away" would be false and nobody would find out until they tried.
		test("the .kcpps builder emits both blocks for a two-entry plan", async () => {
			const { buildConfigContent } = await freshImport()

			const config = buildConfigContent({
				text: {
					file: "some-model.gguf",
					path: TEXT_PATH,
					gpuLayers: -1,
					flashAttention: false,
					batchSize: 512,
					contextSize: 8192
				},
				image: { file: "sdxl_q4_0.gguf", path: IMAGE_PATH }
			})

			expect(config).toEqual({
				model: [TEXT_PATH],
				gpulayers: -1,
				contextsize: 8192,
				flashattention: false,
				batchsize: 512,
				jinja: true,
				sdmodel: IMAGE_PATH
			})
			// The one key that would be a lie in a co-loaded config.
			expect("nomodel" in config).toBe(false)
		})

		test("switching from a text model to an image model reloads exactly once", async () => {
			const { ensureModelLoaded } = await freshImport()
			textHappyPath()
			await settle(ensureModelLoaded(baseOpts()))

			fetchMock.mockClear()
			vi.mocked(writeFile).mockClear()
			imageHappyPath()
			await settle(ensureModelLoaded(baseOpts(imageRequest())))

			const reloads = fetchMock.mock.calls.filter(([url]) =>
				String(url).endsWith("/api/admin/reload_config")
			)
			expect(reloads).toHaveLength(1)
			// The text model is gone from the config, not merely joined.
			expect("model" in lastConfig()).toBe(false)
		})

		test("switching back to the text model reloads again rather than trusting the old record", async () => {
			const { ensureModelLoaded } = await freshImport()
			textHappyPath()
			await settle(ensureModelLoaded(baseOpts()))
			imageHappyPath()
			await settle(ensureModelLoaded(baseOpts(imageRequest())))

			fetchMock.mockClear()
			textHappyPath()
			await settle(ensureModelLoaded(baseOpts()))

			expect(fetchMock).toHaveBeenCalled()
		})
	})

	describe("waiting for an image model to become ready", () => {
		// The sharpest hang available. /api/v1/model reports the TEXT model, and
		// with an image-only load it answers the literal string "inactive" —
		// definitive, and equal to no expected filename ever — so the text wait
		// would sit for the full 30-minute isAlive budget on every render.
		test("an image-only load never touches /api/v1/model", async () => {
			const { ensureModelLoaded } = await freshImport()
			imageHappyPath()

			await settle(ensureModelLoaded(baseOpts(imageRequest())))

			expect(fetchCurrentModelStatusMock).not.toHaveBeenCalled()
			expect(fetchModelStatusForPollMock).not.toHaveBeenCalled()
		})

		// Measured against the real binary: on an image→image reload txt2img
		// reads TRUE for the first half-second (the OUTGOING model), because it
		// never goes false in between. A poll that just waited for `true` would
		// return before the requested model had loaded a byte.
		test("does not accept a txt2img that was already true before the reload", async () => {
			const { ensureModelLoaded } = await freshImport()
			// Something else is resident, so our record cannot match and we
			// reload — and the flag says "yes" throughout.
			fetchImageModelStatusMock.mockResolvedValue(IMAGE_ON)
			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => ({ success: true })
			})

			let settled = false
			const promise = ensureModelLoaded(baseOpts(imageRequest()))
			promise.then(() => {
				settled = true
			})

			await vi.advanceTimersByTimeAsync(6000)
			expect(settled).toBe(false)

			// koboldcpp takes its listener down for the whole of a load — that
			// gap is the thing that actually changed.
			fetchImageModelStatusMock.mockResolvedValue(IMAGE_UNANSWERED)
			await vi.advanceTimersByTimeAsync(2000)
			fetchImageModelStatusMock.mockResolvedValue(IMAGE_ON)
			await vi.advanceTimersByTimeAsync(2000)

			await promise
			expect(settled).toBe(true)
		})

		test("gives up waiting for a change once the endpoint has answered without interruption long enough", async () => {
			// The backstop against the opposite failure. A load takes the
			// listener down; twenty seconds of uninterrupted answers means the
			// gap was missed between two polls, not that a load is still
			// running — and hanging would be far worse than proceeding.
			const { ensureModelLoaded } = await freshImport()
			fetchImageModelStatusMock.mockResolvedValue(IMAGE_ON)
			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => ({ success: true })
			})

			const promise = ensureModelLoaded(baseOpts(imageRequest()))
			await vi.advanceTimersByTimeAsync(21_000)

			await expect(promise).resolves.toBeUndefined()
		})

		test("accepts the first affirmative answer when the flag was known to be off before the reload", async () => {
			// A cold process, or a text model being evicted — both verified to
			// report txt2img: false — so there is nothing stale to confuse.
			const { ensureModelLoaded } = await freshImport()
			imageHappyPath()

			const promise = ensureModelLoaded(baseOpts(imageRequest()))
			await vi.advanceTimersByTimeAsync(0)

			await expect(promise).resolves.toBeUndefined()
		})
	})

	test("retries the reload_config POST through ECONNREFUSED as long as isAlive() is true, and eventually succeeds", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelStatusMock.mockResolvedValue({
			modelName: null,
			refused: false,
			determined: true
		})
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

		const promise = ensureModelLoaded(
			baseOpts(textRequest(), { isAlive: () => true })
		)
		await vi.advanceTimersByTimeAsync(2000)
		await vi.advanceTimersByTimeAsync(2000)
		await promise
		expect(attempts).toBe(3)
	})

	test("gives up on reload_config ECONNREFUSED without isAlive, after the fixed fallback ceiling", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelStatusMock.mockResolvedValue({
			modelName: null,
			refused: false,
			determined: true
		})
		fetchMock.mockImplementation(async () => {
			const err: any = new Error("fetch failed")
			err.cause = { code: "ECONNREFUSED" }
			throw err
		})

		const promise = ensureModelLoaded(baseOpts())
		promise.catch(() => {})
		// Refusals alone no longer end the wait early — a load takes the
		// listener down for far longer than a few ticks — so it is the 60s
		// ceiling on the reload_config request itself that has to trip.
		for (let i = 0; i < 32; i++) {
			await vi.advanceTimersByTimeAsync(2000)
		}
		await expect(promise).rejects.toThrow(/did not become ready|crashed|not reachable/i)
	})

	describe("waiting for a text model to become ready", () => {
		function reloadAccepted() {
			fetchMock.mockResolvedValue({
				ok: true,
				json: async () => ({ success: true })
			})
		}
		const SAME = { modelName: "some-model", refused: false }
		const DOWN = { modelName: null, refused: true }

		// Measured against the real binary: after reload_config returns
		// success, the OUTGOING listener keeps answering /api/v1/model with
		// the same name for over a second, then the port is down for the whole
		// load (6s warm, 23s for a cold 16 GB model). This is every dev-loop
		// restart (koboldcpp adopted with the model still up) and every knob
		// change on the same file.
		test("does not accept the outgoing model when it was already reported resident before the reload", async () => {
			const { ensureModelLoaded } = await freshImport()
			fetchCurrentModelStatusMock.mockResolvedValue({
				modelName: "some-model",
				refused: false,
				determined: true
			})
			reloadAccepted()
			fetchModelStatusForPollMock.mockResolvedValue(SAME)

			let settled = false
			const promise = ensureModelLoaded(baseOpts())
			promise.then(() => {
				settled = true
			})

			await vi.advanceTimersByTimeAsync(6000)
			expect(settled).toBe(false)

			fetchModelStatusForPollMock.mockResolvedValue(DOWN)
			await vi.advanceTimersByTimeAsync(1000)
			fetchModelStatusForPollMock.mockResolvedValue(SAME)
			await vi.advanceTimersByTimeAsync(1000)

			await promise
			expect(settled).toBe(true)
		})

		test("gives up waiting for a change once the same answer has come without interruption long enough", async () => {
			const { ensureModelLoaded } = await freshImport()
			fetchCurrentModelStatusMock.mockResolvedValue({
				modelName: "some-model",
				refused: false,
				determined: true
			})
			reloadAccepted()
			fetchModelStatusForPollMock.mockResolvedValue(SAME)

			const promise = ensureModelLoaded(baseOpts())
			await vi.advanceTimersByTimeAsync(21_000)

			await expect(promise).resolves.toBeUndefined()
		})

		test("accepts the first affirmative answer when nothing was resident before the reload", async () => {
			const { ensureModelLoaded } = await freshImport()
			fetchCurrentModelStatusMock.mockResolvedValue({
				modelName: null,
				refused: false,
				determined: true
			})
			reloadAccepted()
			fetchModelStatusForPollMock.mockResolvedValue(SAME)

			const promise = ensureModelLoaded(baseOpts())
			await vi.advanceTimersByTimeAsync(0)

			await expect(promise).resolves.toBeUndefined()
		})

		// Without a process handle (external, or adopted-external) the old
		// wait gave up after three refused ticks — about six seconds — which
		// is shorter than the listener is down on ANY real load.
		test("without isAlive, tolerates the listener being down for the whole of a real load", async () => {
			const { ensureModelLoaded } = await freshImport()
			fetchCurrentModelStatusMock.mockResolvedValue({
				modelName: null,
				refused: false,
				determined: true
			})
			reloadAccepted()
			let pollCalls = 0
			fetchModelStatusForPollMock.mockImplementation(async () => {
				pollCalls++
				// 15 refused ticks at 2s = 30s down, then up.
				return pollCalls <= 15 ? DOWN : SAME
			})

			const promise = ensureModelLoaded(baseOpts())
			promise.catch(() => {})
			for (let i = 0; i < 16; i++) {
				await vi.advanceTimersByTimeAsync(2000)
			}

			await expect(promise).resolves.toBeUndefined()
			expect(pollCalls).toBe(16)
		})

		test("without isAlive, still gives up once refusals outlast the grace", async () => {
			const { ensureModelLoaded } = await freshImport()
			fetchCurrentModelStatusMock.mockResolvedValue({
				modelName: null,
				refused: false,
				determined: true
			})
			reloadAccepted()
			fetchModelStatusForPollMock.mockResolvedValue(DOWN)

			const promise = ensureModelLoaded(baseOpts())
			promise.catch(() => {})
			for (let i = 0; i < 152; i++) {
				await vi.advanceTimersByTimeAsync(2000)
			}

			await expect(promise).rejects.toThrow(/refused connections for 300s/)
		})
	})

	test("does not retry a non-refusal reload_config failure (e.g. a real HTTP error)", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelStatusMock.mockResolvedValue({
			modelName: null,
			refused: false,
			determined: true
		})
		fetchMock.mockResolvedValue({
			ok: false,
			status: 401,
			text: async () => "unauthorized"
		})

		await expect(
			ensureModelLoaded(baseOpts(textRequest(), { isAlive: () => true }))
		).rejects.toThrow(/reload_config failed: 401/)
		expect(fetchMock).toHaveBeenCalledTimes(1)
	})

	test("throws when reload_config responds ok but success: false", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelStatusMock.mockResolvedValue({
			modelName: null,
			refused: false,
			determined: true
		})
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
		fetchCurrentModelStatusMock.mockResolvedValue({
			modelName: null,
			refused: false,
			determined: true
		})
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

		const promise = ensureModelLoaded(
			baseOpts(textRequest(), { isAlive: () => true })
		)
		await vi.advanceTimersByTimeAsync(2000)
		await vi.advanceTimersByTimeAsync(2000)
		await promise
		expect(pollCalls).toBe(3)
	})

	test("waitForModelReady fails fast once isAlive() reports the process died mid-load", async () => {
		const { ensureModelLoaded } = await freshImport()
		fetchCurrentModelStatusMock.mockResolvedValue({
			modelName: null,
			refused: false,
			determined: true
		})
		fetchMock.mockResolvedValue({
			ok: true,
			json: async () => ({ success: true })
		})
		let alive = true
		fetchModelStatusForPollMock.mockResolvedValue({
			modelName: null,
			refused: true
		})

		const promise = ensureModelLoaded(
			baseOpts(textRequest(), { isAlive: () => alive })
		)
		promise.catch(() => {})
		await vi.advanceTimersByTimeAsync(0)
		alive = false
		await vi.advanceTimersByTimeAsync(2000)
		await expect(promise).rejects.toThrow(/no longer running/)
	})
})
