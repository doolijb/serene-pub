import { afterEach, describe, expect, test, vi } from "vitest"
import fooocus from "./FooocusAdapter"
import type { ImageGenProgress } from "$lib/shared/imageGen/types"

const conn = (over: Record<string, unknown> = {}) =>
	({
		id: 1,
		name: "fooocus",
		type: "image_fooocus",
		modality: "image-gen",
		baseUrl: "http://localhost:8888",
		model: null,
		extraJson: {},
		tokenCounter: "estimate",
		promptFormat: "vicuna",
		...over
	}) as unknown as SelectConnection

interface Call {
	url: string
	init?: RequestInit
}

/**
 * Stub global fetch with a SEQUENCE of responses.
 *
 * Generation is now submit-then-poll, so a test has to be able to say "the job
 * was queued, then running, then done" — a single canned body cannot express the
 * thing most worth testing. The last entry repeats, so a test that does not care
 * how many polls happen does not have to count them.
 */
function stubSequence(
	responses: Array<{ body: unknown; ok?: boolean; status?: number }>
): Call[] {
	const calls: Call[] = []
	let i = 0
	const fn = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push({ url, init })
		const r = responses[Math.min(i, responses.length - 1)]
		i++
		return {
			ok: r.ok ?? true,
			status: r.status ?? 200,
			json: async () => r.body,
			text: async () => JSON.stringify(r.body)
		} as unknown as Response
	})
	vi.stubGlobal("fetch", fn)
	return calls
}

/** The single-response case, for the endpoints that are still one call. */
const stubFetch = (
	body: unknown,
	init: { ok?: boolean; status?: number } = {}
) => stubSequence([{ body, ...init }])

const SUBMITTED = { body: { job_id: "job-1", job_stage: "WAITING" } }
const running = (progress: number, preview?: string) => ({
	body: {
		job_id: "job-1",
		job_stage: "RUNNING",
		job_progress: progress,
		...(preview ? { job_step_preview: preview } : {})
	}
})
const succeeded = (
	results: Array<Record<string, unknown>> = [
		{ base64: "AAAA", seed: "42", finish_reason: "SUCCESS" }
	]
) => ({
	body: { job_id: "job-1", job_stage: "SUCCESS", job_result: results }
})

const bodyOf = (c: Call) => JSON.parse(c.init!.body as string)
const submitCall = (calls: Call[]) =>
	calls.find((c) => c.url.includes("/text-to-image"))!

afterEach(() => vi.unstubAllGlobals())

describe("FooocusAdapter.generate — the request", () => {
	test("maps the neutral request onto Fooocus's native body", async () => {
		const calls = stubSequence([SUBMITTED, succeeded()])
		const a = new fooocus.Adapter(
			conn({ model: "juggernautXL.safetensors" })
		)
		const out = await a.generate({
			prompt: "a knight",
			negativePrompt: "blurry",
			cfg: 7,
			width: 832,
			height: 1216,
			seed: 42,
			batch: 2,
			model: "juggernautXL.safetensors"
		})

		const body = bodyOf(submitCall(calls))
		expect(submitCall(calls).url).toBe(
			"http://localhost:8888/v1/generation/text-to-image"
		)
		expect(body.prompt).toBe("a knight")
		expect(body.negative_prompt).toBe("blurry")
		expect(body.guidance_scale).toBe(7) // cfg → guidance_scale
		expect(body.image_number).toBe(2) // batch → image_number
		expect(body.image_seed).toBe(42)
		expect(body.aspect_ratios_selection).toBe("832*1216") // an offered size
		expect(body.base_model_name).toBe("juggernautXL.safetensors")
		expect(body.require_base64).toBe(true)
		// Async, so there is progress to report and a job to cancel.
		expect(body.async_process).toBe(true)

		expect(out.isAborted).toBe(false)
		expect(out.media).toHaveLength(1)
		expect(out.media[0]).toMatchObject({
			kind: "image",
			base64: "AAAA",
			mime: "image/png",
			// A numeric-looking seed comes back as a number, so provenance reads
			// as a seed rather than as text that resembles one.
			seed: 42
		})
	})

	test("steps and sampler go in advanced_params, not at the top level", async () => {
		// Fooocus has no top-level `steps`; `overwrite_step` is where an explicit
		// count goes, overriding whatever the performance preset would have used.
		const calls = stubSequence([SUBMITTED, succeeded()])
		await new fooocus.Adapter(conn()).generate({
			prompt: "x",
			steps: 30,
			sampler: "dpmpp_2m_sde_gpu",
			scheduler: "karras",
			clipSkip: 2
		})
		const body = bodyOf(submitCall(calls))
		expect(body.steps).toBeUndefined()
		expect(body.advanced_params).toEqual({
			overwrite_step: 30,
			sampler_name: "dpmpp_2m_sde_gpu",
			scheduler_name: "karras",
			clip_skip: 2
		})
	})

	test("advanced_params is omitted entirely when nothing needs it", async () => {
		// An empty object would ask Fooocus to override with nothing, which is not
		// the same as not overriding.
		const calls = stubSequence([SUBMITTED, succeeded()])
		await new fooocus.Adapter(conn()).generate({ prompt: "x" })
		expect("advanced_params" in bodyOf(submitCall(calls))).toBe(false)
	})

	test("reads performance, styles and sharpness from the connection profile", async () => {
		// Backend-specific settings live on the CONNECTION, never in the request —
		// the request is the vocabulary every backend shares.
		const calls = stubSequence([SUBMITTED, succeeded()])
		await new fooocus.Adapter(
			conn({
				extraJson: {
					profile: {
						performance: "Quality",
						styles: ["Fooocus V2", "SAI Anime"],
						sharpness: 3
					}
				}
			})
		).generate({ prompt: "x" })
		const body = bodyOf(submitCall(calls))
		expect(body.performance_selection).toBe("Quality")
		expect(body.style_selections).toEqual(["Fooocus V2", "SAI Anime"])
		expect(body.sharpness).toBe(3)
	})

	test("falls back to the adapter's own defaults and omits base_model_name when unset", async () => {
		const calls = stubSequence([SUBMITTED, succeeded([{ base64: "BBBB" }])])
		await new fooocus.Adapter(conn()).generate({ prompt: "sunset" })
		const body = bodyOf(submitCall(calls))
		expect(body.performance_selection).toBe("Speed")
		expect(body.style_selections).toEqual(["Fooocus V2"])
		expect(body.aspect_ratios_selection).toBe("1152*896")
		expect(body.guidance_scale).toBe(4)
		expect(body.image_number).toBe(1)
		expect(body.image_seed).toBe(-1)
		expect("base_model_name" in body).toBe(false)
	})

	test("passes the X-API-KEY header when configured", async () => {
		const calls = stubSequence([SUBMITTED, succeeded()])
		await new fooocus.Adapter(
			conn({ extraJson: { apiKey: "secret" } })
		).generate({ prompt: "x" })
		expect((submitCall(calls).init!.headers as any)["X-API-KEY"]).toBe(
			"secret"
		)
	})
})

describe("FooocusAdapter.generate — sizes are a fixed list", () => {
	test("an unavailable size snaps to the nearest aspect and says so", async () => {
		// The failure this prevents: asking for 1000×1000 and quietly receiving
		// something else shaped, with nothing anywhere admitting it happened.
		const calls = stubSequence([SUBMITTED, succeeded()])
		const out = await new fooocus.Adapter(conn()).generate({
			prompt: "x",
			width: 1000,
			height: 1000
		})
		expect(bodyOf(submitCall(calls)).aspect_ratios_selection).toBe(
			"1024*1024"
		)
		expect(out.ignored).toContain("width")
		expect(out.ignored).toContain("height")
	})

	test("a size that IS offered is applied, not reported as ignored", async () => {
		const calls = stubSequence([SUBMITTED, succeeded()])
		const out = await new fooocus.Adapter(conn()).generate({
			prompt: "x",
			width: 896,
			height: 1152
		})
		expect(bodyOf(submitCall(calls)).aspect_ratios_selection).toBe(
			"896*1152"
		)
		expect(out.applied).toContain("width")
		expect(out.ignored).not.toContain("width")
	})

	test("a portrait request snaps to a portrait size, not merely a near-area one", async () => {
		const calls = stubSequence([SUBMITTED, succeeded()])
		await new fooocus.Adapter(conn()).generate({
			prompt: "x",
			width: 600,
			height: 1200
		})
		const [w, h] = bodyOf(submitCall(calls))
			.aspect_ratios_selection.split("*")
			.map(Number)
		expect(h).toBeGreaterThan(w)
	})

	test("what this backend cannot do at all is reported as ignored", async () => {
		const calls = stubSequence([SUBMITTED, succeeded()])
		const out = await new fooocus.Adapter(conn()).generate({
			prompt: "x",
			denoise: 0.5,
			video: { frames: 16 }
		})
		expect(out.ignored).toContain("denoise")
		expect(out.ignored).toContain("video")
		expect("advanced_params" in bodyOf(submitCall(calls))).toBe(false)
	})
})

describe("FooocusAdapter.generate — progress", () => {
	test("polls the job and reports stage, percent and preview frames", async () => {
		const calls = stubSequence([
			SUBMITTED,
			running(10),
			running(60, "data:image/png;base64,PREVIEW"),
			succeeded()
		])
		const seen: ImageGenProgress[] = []
		const out = await new fooocus.Adapter(conn()).generate(
			{ prompt: "x" },
			{ onProgress: (p) => seen.push(p) }
		)

		expect(calls.filter((c) => c.url.includes("query-job")).length).toBe(3)
		expect(calls[1].url).toContain("job_id=job-1")
		expect(calls[1].url).toContain("require_step_preview=true")

		expect(seen[0]).toMatchObject({ stage: "queued", percent: 0 })
		expect(seen.map((p) => p.percent)).toContain(60)
		// The data-URL header is stripped: the store wants raw base64, and a
		// preview that arrives prefixed renders as a broken image.
		expect(seen.find((p) => p.preview)?.preview).toEqual({
			base64: "PREVIEW",
			mime: "image/png"
		})
		expect(out.media).toHaveLength(1)
	})

	test("a job that fails throws with the reason Fooocus gave", async () => {
		stubSequence([
			SUBMITTED,
			{
				body: {
					job_stage: "ERROR",
					job_status: "CUDA out of memory"
				}
			}
		])
		await expect(
			new fooocus.Adapter(conn()).generate({ prompt: "x" })
		).rejects.toThrow(/CUDA out of memory/)
	})

	test("a submit that is refused throws with the server's message", async () => {
		stubFetch({ detail: "no model loaded" }, { ok: false, status: 500 })
		await expect(
			new fooocus.Adapter(conn()).generate({ prompt: "x" })
		).rejects.toThrow(/Fooocus generation failed \(500\)/)
	})

	test("a submit that returns no job id says so rather than polling nothing", async () => {
		stubSequence([{ body: { job_stage: "WAITING" } }])
		await expect(
			new fooocus.Adapter(conn()).generate({ prompt: "x" })
		).rejects.toThrow(/no job id/)
	})
})

describe("FooocusAdapter.generate — cancel", () => {
	test("an abort mid-poll stops the job and reports isAborted", async () => {
		const controller = new AbortController()
		const calls = stubSequence([SUBMITTED, running(10), running(20)])
		const adapter = new fooocus.Adapter(conn())

		const promise = adapter.generate(
			{ prompt: "x" },
			{
				signal: controller.signal,
				// Abort on the first progress report, i.e. genuinely mid-render.
				onProgress: () => controller.abort()
			}
		)
		const out = await promise

		expect(out.isAborted).toBe(true)
		expect(out.media).toEqual([])
		// The stop endpoint is GLOBAL, so it is only ever called when THIS adapter
		// has a job in flight — otherwise a cancel here would kill a stranger's
		// render on a shared instance.
		expect(calls.some((c) => c.url.includes("/v1/generation/stop"))).toBe(
			true
		)
	})

	test("a signal already aborted never submits a job to stop", async () => {
		const controller = new AbortController()
		controller.abort()
		const calls = stubSequence([SUBMITTED, succeeded()])
		const out = await new fooocus.Adapter(conn()).generate(
			{ prompt: "x" },
			{ signal: controller.signal }
		)
		expect(out.isAborted).toBe(true)
		expect(calls.some((c) => c.url.includes("/v1/generation/stop"))).toBe(
			false
		)
	})
})

describe("FooocusAdapter.generate — results", () => {
	test("drops results without a base64 payload", async () => {
		stubSequence([
			SUBMITTED,
			succeeded([
				{ base64: "OK" },
				{ url: "http://x/y.png", base64: null }
			])
		])
		const out = await new fooocus.Adapter(conn()).generate({ prompt: "x" })
		expect(out.media.map((m) => m.base64)).toEqual(["OK"])
	})

	test("the profile's image format decides the stored mime", async () => {
		stubSequence([SUBMITTED, succeeded([{ base64: "OK" }])])
		const out = await new fooocus.Adapter(
			conn({ extraJson: { profile: { saveExtension: "webp" } } })
		).generate({ prompt: "x" })
		expect(out.media[0].mime).toBe("image/webp")
	})

	test("a non-numeric seed is kept as given rather than coerced to NaN", async () => {
		stubSequence([SUBMITTED, succeeded([{ base64: "OK", seed: "random" }])])
		const out = await new fooocus.Adapter(conn()).generate({ prompt: "x" })
		expect(out.media[0].seed).toBe("random")
	})
})

describe("FooocusAdapter — capabilities and profile", () => {
	test("declares the fixed size list, so a form can stop offering free pixels", () => {
		expect(fooocus.capabilities.freeSize).toBe(false)
		expect(fooocus.capabilities.sizePresets).toContainEqual({
			width: 1152,
			height: 896
		})
		expect(fooocus.capabilities.progress).toBe(true)
		expect(fooocus.capabilities.preview).toBe(true)
		expect(fooocus.capabilities.cancel).toBe(true)
		expect(fooocus.capabilities.img2img).toBe(false)
	})

	test("declares its backend-specific settings as a schema, so the form is generated", () => {
		expect(Object.keys(fooocus.profileSchema!)).toEqual([
			"performance",
			"styles",
			"sharpness",
			"saveExtension"
		])
		expect(fooocus.profileSchema!.performance.of).toContain("Quality")
	})
})

describe("FooocusAdapter.testConnection / listModels", () => {
	test("testConnection ok on 200, and brings back the style list", async () => {
		// The styles come with the test because that is the moment the connection
		// is known to be reachable, and they are the one thing the profile form
		// cannot guess.
		stubSequence([
			{ body: { model_filenames: [] } },
			{ body: ["Fooocus V2", "SAI Anime"] }
		])
		expect(await fooocus.testConnection(conn())).toEqual({
			ok: true,
			extra: { styles: ["Fooocus V2", "SAI Anime"] }
		})
	})

	test("a missing style list is not a failed connection", async () => {
		stubSequence([
			{ body: { model_filenames: [] } },
			{ body: {}, ok: false, status: 404 }
		])
		expect(await fooocus.testConnection(conn())).toEqual({ ok: true })
	})

	test("testConnection reports HTTP error", async () => {
		stubFetch({}, { ok: false, status: 404 })
		expect(await fooocus.testConnection(conn())).toEqual({
			ok: false,
			error: "HTTP 404"
		})
	})

	test("listModels returns model_filenames", async () => {
		stubFetch({
			model_filenames: ["a.safetensors", "b.gguf"],
			lora_filenames: []
		})
		expect(await fooocus.listModels(conn())).toEqual({
			models: ["a.safetensors", "b.gguf"]
		})
	})
})
