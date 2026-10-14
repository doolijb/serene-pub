import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import horde, {
	HORDE_ANONYMOUS_KEY,
	HORDE_SHEET,
	hordeSampler,
	hordeTiming
} from "./HordeAdapter"
import type { MediaRef } from "@serene-pub/sdk"

vi.mock("$lib/server/db", () => ({ db: { query: {} } }))

/**
 * The Horde dialect (DESIGN-image-generation §4.4): the submit body, the
 * check → status poll loop, cancel, the CorruptPrompt refusal, and listing.
 */

const conn = (over: Record<string, unknown> = {}) =>
	({
		id: 7,
		name: "horde",
		type: "horde",
		modality: "image-gen",
		baseUrl: "https://aihorde.net/api",
		model: null,
		extraJson: { apiKey: "" },
		...over
	}) as unknown as SelectConnection

const ref = (uuid: string): MediaRef => ({ uuid, kind: "image", mime: "image/png", bytes: 3 })
const loadMedia = async (r: MediaRef) => ({ bytes: new TextEncoder().encode(`bytes-of-${r.uuid}`), mime: "image/png" })
const b64 = (s: string) => Buffer.from(`bytes-of-${s}`).toString("base64")

interface Call {
	url: string
	method: string
	headers: Record<string, string>
	json: any
}

type Route = (url: string, method: string) => { status: number; body: unknown; bytes?: Uint8Array } | undefined

function stub(route: Route): Call[] {
	const calls: Call[] = []
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const method = init?.method ?? "GET"
			calls.push({
				url,
				method,
				headers: (init?.headers ?? {}) as Record<string, string>,
				json: typeof init?.body === "string" ? JSON.parse(init.body) : null
			})
			const a = route(url, method) ?? { status: 404, body: { message: "no route" } }
			return {
				ok: a.status >= 200 && a.status < 300,
				status: a.status,
				headers: new Headers(a.bytes ? { "content-type": "image/webp" } : {}),
				json: async () => a.body,
				text: async () => JSON.stringify(a.body),
				arrayBuffer: async () => (a.bytes ?? new Uint8Array()).buffer
			} as unknown as Response
		})
	)
	return calls
}

/** A Horde that queues, works, then finishes; images as R2 URLs. */
function happyHorde(checks = 2) {
	let n = 0
	return stub((url, method) => {
		if (url.endsWith("/v2/generate/async") && method === "POST") return { status: 202, body: { id: "job-1", kudos: 12 } }
		if (url.includes("/v2/generate/check/job-1")) {
			n++
			return n < checks
				? { status: 200, body: { done: false, waiting: 1, processing: 0, queue_position: 3, wait_time: 20, finished: 0, is_possible: true } }
				: { status: 200, body: { done: true, finished: 1 } }
		}
		if (url.includes("/v2/generate/status/job-1") && method === "GET")
			return {
				status: 200,
				body: { kudos: 12, generations: [{ img: "https://r2.example/x.webp", seed: "99", model: "AlbedoBase XL", worker_name: "w1" }] }
			}
		if (url === "https://r2.example/x.webp") return { status: 200, body: null, bytes: new Uint8Array([1, 2, 3]) }
		return undefined
	})
}

beforeEach(() => {
	hordeTiming.pollMs = 0
})
afterEach(() => vi.unstubAllGlobals())

const adapter = (over: Record<string, unknown> = {}) => new horde.Adapter(conn(over) as any) as any

describe("submit", () => {
	test("anonymous key, Client-Agent, inline negative, SD params", async () => {
		const calls = happyHorde()
		const r = await adapter({ model: "AlbedoBase XL" }).generateImage({
			prompt: "a lighthouse",
			negativePrompt: "blur",
			width: 832,
			height: 1216,
			steps: 30,
			cfg: 6,
			seed: 42,
			sampler: "DPM++ 2M Karras",
			clipSkip: 2,
			batch: 2,
			transparent: true
		})
		const submit = calls[0]!
		expect(submit.url).toBe("https://aihorde.net/api/v2/generate/async")
		expect(submit.headers.apikey).toBe(HORDE_ANONYMOUS_KEY)
		expect(submit.headers["Client-Agent"]).toMatch(/^serene-pub:/)
		expect(submit.json).toMatchObject({
			prompt: "a lighthouse ### blur",
			models: ["AlbedoBase XL"],
			nsfw: false,
			r2: true,
			params: {
				n: 2,
				width: 832,
				height: 1216,
				steps: 30,
				cfg_scale: 6,
				seed: "42",
				sampler_name: "k_dpmpp_2m",
				karras: true,
				clip_skip: 2,
				transparent: true
			}
		})
		expect(r.applied).toEqual(expect.arrayContaining(["negativePrompt", "seed", "sampler", "transparent"]))
		// One picture came back for two asked.
		expect(r.ignored).toContain("batch")
		expect(r.media[0]).toMatchObject({ mime: "image/webp", seed: 99, base64: Buffer.from([1, 2, 3]).toString("base64") })
	})

	test("a size off the 64 grid is reported, never sent", async () => {
		const calls = happyHorde(1)
		const r = await adapter().generateImage({ prompt: "x", width: 1000, height: 1024 })
		expect(calls[0]!.json.params).not.toHaveProperty("width")
		expect(calls[0]!.json.params.height).toBe(1024)
		expect(r.ignored).toContain("width")
	})

	test("canvas, mask and references route to source_image, source_mask, extra_source_images", async () => {
		const calls = happyHorde(1)
		const r = await adapter().generateImage(
			{
				prompt: "x",
				init: ref("canvas"),
				mask: ref("mask"),
				denoise: 0.6,
				references: ["a", "b", "c", "d", "e"].map(ref)
			},
			{ loadMedia }
		)
		expect(calls[0]!.json).toMatchObject({
			source_image: b64("canvas"),
			source_mask: b64("mask"),
			source_processing: "inpainting",
			params: { denoising_strength: 0.6 }
		})
		expect(calls[0]!.json.extra_source_images).toHaveLength(4)
		expect(calls[0]!.json.extra_source_images[0]).toEqual({ image: b64("a"), strength: 1 })
		expect(r.ignored).toContain("references")
	})

	test("a registered key is sent as given", async () => {
		const calls = happyHorde(1)
		await adapter({ extraJson: { apiKey: "my-horde-key" } }).generateImage({ prompt: "x" })
		expect(calls[0]!.headers.apikey).toBe("my-horde-key")
	})
})

describe("poll loop", () => {
	test("check until done, then one status call; progress reports the queue", async () => {
		const calls = happyHorde(3)
		const progress: any[] = []
		await adapter().generateImage({ prompt: "x" }, { onProgress: (p: any) => progress.push(p) })
		const kinds = calls.map((c) => `${c.method} ${c.url.replace("https://aihorde.net/api/v2", "")}`)
		expect(kinds).toEqual([
			"POST /generate/async",
			"GET /generate/check/job-1",
			"GET /generate/check/job-1",
			"GET /generate/check/job-1",
			"GET /generate/status/job-1",
			"GET https://r2.example/x.webp"
		])
		expect(progress.some((p) => p.stage === "queued" && /position 3/.test(p.message ?? ""))).toBe(true)
		expect(progress.at(-1)).toMatchObject({ stage: "saving", percent: 100 })
	})

	test("abort cancels with DELETE and reports aborted", async () => {
		const controller = new AbortController()
		const calls = stub((url, method) => {
			if (method === "POST") return { status: 202, body: { id: "job-2" } }
			if (url.includes("/check/job-2")) {
				controller.abort()
				return { status: 200, body: { done: false, waiting: 1 } }
			}
			if (method === "DELETE") return { status: 200, body: {} }
			return undefined
		})
		const r = await adapter().generateImage({ prompt: "x" }, { signal: controller.signal })
		expect(r.isAborted).toBe(true)
		expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: "https://aihorde.net/api/v2/generate/status/job-2" })
	})

	test("an impossible request is cancelled and explained", async () => {
		const calls = stub((url, method) => {
			if (method === "POST") return { status: 202, body: { id: "job-3" } }
			if (url.includes("/check/job-3")) return { status: 200, body: { done: false, is_possible: false } }
			if (method === "DELETE") return { status: 200, body: {} }
			return undefined
		})
		await expect(adapter().generateImage({ prompt: "x" })).rejects.toThrow(/No Horde worker/)
		expect(calls.some((c) => c.method === "DELETE")).toBe(true)
	})
})

describe("refusals", () => {
	test("CorruptPrompt is a refusal with noRetry", async () => {
		stub(() => ({ status: 400, body: { message: "This prompt appears to violate our terms.", rc: "CorruptPrompt" } }))
		const r = await adapter().generateImage({ prompt: "x" })
		expect(r.media).toEqual([])
		expect(r.refusal).toMatchObject({ code: "CorruptPrompt", noRetry: true })
	})

	test("every picture censored is a refusal with noRetry", async () => {
		stub((url, method) => {
			if (method === "POST") return { status: 202, body: { id: "job-4" } }
			if (url.includes("/check/")) return { status: 200, body: { done: true } }
			if (url.includes("/status/")) return { status: 200, body: { generations: [{ img: "x", censored: true }] } }
			return undefined
		})
		const r = await adapter().generateImage({ prompt: "x" })
		expect(r.refusal).toMatchObject({ code: "censored", noRetry: true })
	})

	test("an ordinary failure throws", async () => {
		stub(() => ({ status: 400, body: { message: "Bad params" } }))
		await expect(adapter().generateImage({ prompt: "x" })).rejects.toThrow(/Bad params/)
	})
})

describe("sheet, samplers, listing", () => {
	test("the sheet", () => {
		expect(HORDE_SHEET).toMatchObject({
			negative: true,
			seed: true,
			steps: true,
			cfg: true,
			sampler: true,
			clipSkip: true,
			size: { kind: "free", step: 64, min: 64, max: 3072 },
			references: { max: 4 },
			transparent: "native",
			perCall: 20,
			progress: true,
			cancel: true
		})
	})

	test("sampler names", () => {
		expect(hordeSampler("Euler a")).toBe("k_euler_a")
		expect(hordeSampler("k_dpmpp_sde")).toBe("k_dpmpp_sde")
		expect(hordeSampler("UniPC")).toBeNull()
	})

	test("an unknown sampler is reported", async () => {
		const calls = happyHorde(1)
		const r = await adapter().generateImage({ prompt: "x", sampler: "UniPC" })
		expect(calls[0]!.json.params).not.toHaveProperty("sampler_name")
		expect(r.ignored).toContain("sampler")
	})

	test("lists models with workers, busiest first", async () => {
		const calls = stub(() => ({
			status: 200,
			body: [
				{ name: "Deliberate", count: 2 },
				{ name: "Gone", count: 0 },
				{ name: "AlbedoBase XL", count: 9 }
			]
		}))
		const { models } = await horde.listModels(conn())
		expect(calls[0]!.url).toBe("https://aihorde.net/api/v2/status/models?type=image")
		expect(models.map((m: any) => m.id)).toEqual(["AlbedoBase XL", "Deliberate"])
	})

	test("test: anonymous is fine; img2img read from the workers", async () => {
		stub((url) => {
			if (url.includes("/status/models")) return { status: 200, body: [{ name: "A", count: 1 }] }
			if (url.includes("/workers")) return { status: 200, body: [{ img2img: false }, { img2img: true }] }
			return undefined
		})
		const r = await horde.testConnection(conn())
		expect(r.ok).toBe(true)
		expect(r.extra).toMatchObject({
			anonymous: true,
			capabilities: { "text->image": "native", "text+image->image": "native" }
		})
	})
})
