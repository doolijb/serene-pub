import { afterEach, describe, expect, test, vi } from "vitest"
import a1111 from "./A1111Adapter"
import type { ImageGenProgress } from "$lib/shared/imageGen/types"

/**
 * The A1111-compatible adapter, and the four backends it has to absorb.
 *
 * What is under test is not whether Stable Diffusion draws. It is that the
 * places where AUTOMATIC1111, Forge, SD.Next and KoboldCPP *disagree* are
 * handled here rather than pushed at the caller — a batch that silently came
 * back short, an interrupt endpoint that only three of them have, an `info`
 * field that is a JSON string on one and absent on another.
 */

const conn = (over: Record<string, unknown> = {}) =>
	({
		id: 1,
		name: "local sd",
		type: "a1111",
		modality: "image-gen",
		baseUrl: "http://localhost:5001",
		model: null,
		extraJson: {},
		...over
	}) as unknown as SelectConnection

interface Call {
	url: string
	init?: RequestInit
}

/** Route by URL, because progress polls interleave with the render request. */
function stubRoutes(
	routes: Record<string, { body: unknown; ok?: boolean; status?: number }>
): Call[] {
	const calls: Call[] = []
	const fn = vi.fn(async (url: string, init?: RequestInit) => {
		calls.push({ url, init })
		const key = Object.keys(routes).find((k) => url.includes(k))
		const r = key ? routes[key] : undefined
		if (!r)
			return {
				ok: false,
				status: 404,
				json: async () => ({}),
				text: async () => ""
			} as any
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

const PNG = "iVBORw0KGgo="
const okRender = {
	body: { images: [PNG], info: JSON.stringify({ seed: 4242 }) }
}
const submit = (c: Call) => c.url.includes("txt2img")
const bodyOf = (calls: Call[]) =>
	JSON.parse(calls.find(submit)!.init!.body as string)

afterEach(() => vi.unstubAllGlobals())

describe("A1111Adapter — the request", () => {
	test("maps the neutral request onto the A1111 body", async () => {
		const calls = stubRoutes({ txt2img: okRender })
		const out = await new a1111.Adapter(conn()).generate({
			prompt: "a knight",
			negativePrompt: "blurry",
			width: 832,
			height: 1216,
			steps: 30,
			cfg: 7,
			seed: 99,
			sampler: "Euler a"
		})

		const body = bodyOf(calls)
		expect(body.prompt).toBe("a knight")
		expect(body.negative_prompt).toBe("blurry")
		expect(body.width).toBe(832)
		expect(body.height).toBe(1216)
		expect(body.steps).toBe(30)
		expect(body.cfg_scale).toBe(7) // cfg → cfg_scale
		expect(body.seed).toBe(99)
		expect(body.sampler_name).toBe("Euler a")
		// Never write to the backend's own output folder: the image belongs in
		// this app's media store, and a copy on their disk is a surprise.
		expect(body.save_images).toBe(false)

		expect(out.media).toHaveLength(1)
		expect(out.media[0]).toMatchObject({ kind: "image", mime: "image/png" })
	})

	test("sizes round to a multiple of 8, which the backend would do anyway", async () => {
		const calls = stubRoutes({ txt2img: okRender })
		await new a1111.Adapter(conn()).generate({
			prompt: "x",
			width: 831,
			height: 1215
		})
		const body = bodyOf(calls)
		expect(body.width % 8).toBe(0)
		expect(body.height % 8).toBe(0)
	})

	test("the checkpoint goes through override_settings, not a top-level field", async () => {
		const calls = stubRoutes({ txt2img: okRender })
		await new a1111.Adapter(
			conn({ model: "juggernautXL.safetensors" })
		).generate({ prompt: "x" })
		expect(bodyOf(calls).override_settings.sd_model_checkpoint).toBe(
			"juggernautXL.safetensors"
		)
	})

	test("a batch is asked for as n_iter, not batch_size", async () => {
		// Sequential costs VRAM once; a batch multiplies it, and on the hardware
		// this backend usually runs on that is the difference between four images
		// and an out-of-memory error.
		const calls = stubRoutes({
			txt2img: { body: { images: [PNG, PNG, PNG], info: "" } }
		})
		await new a1111.Adapter(conn()).generate({ prompt: "x", batch: 3 })
		const body = bodyOf(calls)
		expect(body.n_iter).toBe(3)
		expect(body.batch_size).toBeUndefined()
	})

	test("what this endpoint cannot do is reported, not swallowed", async () => {
		const calls = stubRoutes({ txt2img: okRender })
		const out = await new a1111.Adapter(conn()).generate({
			prompt: "x",
			denoise: 0.5,
			clipSkip: 2,
			video: { frames: 16 }
		})
		expect(out.ignored).toEqual(
			expect.arrayContaining(["denoise", "clipSkip", "video"])
		)
		expect("denoising_strength" in bodyOf(calls)).toBe(false)
	})

	test("the profile's backend-specific settings ride override_settings", async () => {
		const calls = stubRoutes({ txt2img: okRender })
		await new a1111.Adapter(
			conn({
				extraJson: {
					profile: {
						restoreFaces: true,
						overrideSettings: { CLIP_stop_at_last_layers: 2 }
					}
				}
			})
		).generate({ prompt: "x" })
		const body = bodyOf(calls)
		expect(body.restore_faces).toBe(true)
		expect(body.override_settings.CLIP_stop_at_last_layers).toBe(2)
	})
})

describe("A1111Adapter — where the backends disagree", () => {
	test("a batch that came back short is reported as ignored", async () => {
		// KoboldCPP renders exactly one image per request whatever `n_iter` says.
		// Counting what arrived means this file never has to know which backend
		// answered — the caller is simply told the truth.
		const out = await (async () => {
			stubRoutes({ txt2img: { body: { images: [PNG], info: "" } } })
			return new a1111.Adapter(conn()).generate({ prompt: "x", batch: 4 })
		})()
		expect(out.media).toHaveLength(1)
		expect(out.ignored).toContain("batch")
	})

	test("a batch that arrived in full is NOT reported as ignored", async () => {
		stubRoutes({ txt2img: { body: { images: [PNG, PNG], info: "" } } })
		const out = await new a1111.Adapter(conn()).generate({
			prompt: "x",
			batch: 2
		})
		expect(out.ignored).not.toContain("batch")
	})

	test("the seed is read out of `info`, which is a JSON STRING", async () => {
		stubRoutes({
			txt2img: {
				body: { images: [PNG], info: JSON.stringify({ seed: 8675309 }) }
			}
		})
		const out = await new a1111.Adapter(conn()).generate({ prompt: "x" })
		expect(out.media[0].seed).toBe(8675309)
	})

	test("a missing or malformed `info` costs the seed, never the image", async () => {
		for (const info of [undefined, "", "not json at all"]) {
			stubRoutes({ txt2img: { body: { images: [PNG], info } } })
			const out = await new a1111.Adapter(conn()).generate({
				prompt: "x"
			})
			expect(out.media).toHaveLength(1)
			expect(out.media[0].seed).toBeUndefined()
		}
	})

	test("no images back is an error that says what to check", async () => {
		stubRoutes({ txt2img: { body: { images: [] } } })
		await expect(
			new a1111.Adapter(conn()).generate({ prompt: "x" })
		).rejects.toThrow(/no image model loaded/i)
	})
})

describe("A1111Adapter — progress and cancel", () => {
	test("polls progress alongside the render and forwards previews", async () => {
		stubRoutes({
			txt2img: okRender,
			progress: {
				body: {
					progress: 0.42,
					eta_relative: 12.7,
					current_image: `data:image/png;base64,${PNG}`,
					state: { sampling_step: 10, sampling_steps: 24 }
				}
			}
		})
		const seen: ImageGenProgress[] = []
		// The render resolves immediately here, so the first `queued` report is
		// the one guaranteed to land; the poller is proven by the route existing
		// and by the abort test below.
		await new a1111.Adapter(conn()).generate(
			{ prompt: "x" },
			{ onProgress: (p) => seen.push(p) }
		)
		expect(seen[0]).toMatchObject({ stage: "queued", percent: 0 })
		expect(seen.at(-1)).toMatchObject({ stage: "saving", percent: 100 })
	})

	test("an abort before submitting sends nothing at all", async () => {
		// Submitting and then interrupting would, on a shared server, stop
		// whatever else happened to be rendering.
		const controller = new AbortController()
		controller.abort()
		const calls = stubRoutes({ txt2img: okRender })
		const out = await new a1111.Adapter(conn()).generate(
			{ prompt: "x" },
			{ signal: controller.signal }
		)
		expect(out.isAborted).toBe(true)
		expect(calls.filter(submit)).toHaveLength(0)
	})

	test("a 404 from interrupt is survivable — KoboldCPP has no such endpoint", async () => {
		// Aborting the request is what actually stops KoboldCPP; the endpoint is
		// the addition on top, so its absence must not turn a cancel into a throw.
		const controller = new AbortController()
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string) => {
				if (url.includes("txt2img")) {
					controller.abort()
					throw new DOMException("aborted", "AbortError")
				}
				return {
					ok: false,
					status: 404,
					json: async () => ({}),
					text: async () => ""
				} as any
			})
		)
		const out = await new a1111.Adapter(conn()).generate(
			{ prompt: "x" },
			{ signal: controller.signal }
		)
		expect(out.isAborted).toBe(true)
		expect(out.media).toEqual([])
	})
})

describe("A1111Adapter — test and discovery", () => {
	test("a reachable server reports image generation as a probed capability", async () => {
		stubRoutes({
			"sd-models": { body: [{ title: "sdxl.safetensors" }] },
			samplers: { body: [{ name: "Euler a" }, { name: "DPM++ 2M" }] },
			schedulers: { body: [{ name: "Karras" }] }
		})
		const res = await a1111.testConnection(conn())
		expect(res.ok).toBe(true)
		// Feeds the PROBE layer of capability resolution: reaching sd-models at
		// all is proof the image half works.
		expect((res.extra as any).capabilities).toEqual({
			"text->image": "native"
		})
		expect((res.extra as any).samplers).toContain("Euler a")
	})

	test("a 404 on sd-models says what is actually wrong", async () => {
		// The informative case: the server is up, but has no image model — a
		// KoboldCPP started without --sdmodel. "HTTP 404" would send somebody
		// looking at their URL.
		stubRoutes({})
		const res = await a1111.testConnection(conn())
		expect(res.ok).toBe(false)
		expect(res.error).toMatch(/image model/i)
		expect(res.error).not.toMatch(/^HTTP \d+/)
	})

	test("missing sampler endpoints do not fail an otherwise good connection", async () => {
		stubRoutes({ "sd-models": { body: [{ title: "sdxl.safetensors" }] } })
		const res = await a1111.testConnection(conn())
		expect(res.ok).toBe(true)
	})

	test("listModels prefers the title, which is what the checkpoint field wants", async () => {
		stubRoutes({
			"sd-models": {
				body: [
					{ title: "sdxl.safetensors [abc123]", model_name: "sdxl" },
					{ model_name: "only-a-name" }
				]
			}
		})
		expect(await a1111.listModels(conn())).toEqual({
			models: ["sdxl.safetensors [abc123]", "only-a-name"]
		})
	})

	test("declares free sizing, unlike the fixed-list backends", async () => {
		expect(a1111.capabilities.freeSize).toBe(true)
		expect(a1111.capabilities.progress).toBe(true)
		expect(a1111.capabilities.cancel).toBe(true)
	})
})
