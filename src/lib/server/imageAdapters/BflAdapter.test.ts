import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import bfl, {
	BFL_FLUX2_FLEX_SHEET,
	BFL_FLUX2_SHEET,
	BFL_FLUX3_SHEET,
	BFL_KONTEXT_SHEET,
	bflSheetFor,
	bflTiming,
	safePollingUrl
} from "./BflAdapter"
import type { MediaRef } from "@serene-pub/sdk"

vi.mock("$lib/server/db", () => ({ db: { query: {} } }))

/**
 * The BFL dialect (DESIGN-image-generation §4.4): submit then poll, the
 * per-model body (`input_image_N` vs `images`, size vs aspect + tier), the
 * moderation statuses as refusals, and the static listing with prices.
 */

const conn = (over: Record<string, unknown> = {}) =>
	({
		id: 9,
		name: "bfl",
		type: "bfl",
		modality: "image-gen",
		baseUrl: "https://api.bfl.ai",
		model: "flux-2-pro",
		extraJson: { apiKey: "bfl-key" },
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

function stub(polls: Array<Record<string, unknown>> = [{ status: "Pending", progress: 0.4 }, { status: "Ready", result: { sample: "https://delivery-eu.bfl.ai/x.png", seed: 77 } }]): Call[] {
	const calls: Call[] = []
	let i = 0
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
			let status = 200
			let body: unknown = null
			let bytes: Uint8Array | undefined
			if (method === "POST") body = { id: "task-1", polling_url: "https://api.eu.bfl.ai/v1/get_result?id=task-1" }
			else if (url.includes("get_result")) body = polls[Math.min(i++, polls.length - 1)]
			else if (url.includes("delivery")) bytes = new Uint8Array([9, 9])
			else status = 404
			return {
				ok: status === 200,
				status,
				headers: new Headers(bytes ? { "content-type": "image/png" } : {}),
				json: async () => body,
				text: async () => JSON.stringify(body),
				arrayBuffer: async () => (bytes ?? new Uint8Array()).buffer
			} as unknown as Response
		})
	)
	return calls
}

beforeEach(() => {
	bflTiming.pollMs = 0
})
afterEach(() => vi.unstubAllGlobals())

const adapter = (over: Record<string, unknown> = {}) => new bfl.Adapter(conn(over) as any) as any

describe("FLUX.2", () => {
	test("x-key, size, seed, canvas then references as input_image…; then poll until Ready", async () => {
		const calls = stub()
		const progress: any[] = []
		const r = await adapter().generateImage(
			{
				prompt: "a lighthouse",
				width: 1024,
				height: 1536,
				seed: 5,
				init: ref("canvas"),
				references: ["a", "b"].map(ref),
				negativePrompt: "blur",
				steps: 30
			},
			{ loadMedia, onProgress: (p: any) => progress.push(p) }
		)
		const submit = calls[0]!
		expect(submit.url).toBe("https://api.bfl.ai/v1/flux-2-pro")
		expect(submit.headers["x-key"]).toBe("bfl-key")
		expect(submit.json).toMatchObject({
			prompt: "a lighthouse",
			width: 1024,
			height: 1536,
			seed: 5,
			input_image: b64("canvas"),
			input_image_2: b64("a"),
			input_image_3: b64("b"),
			safety_tolerance: 2,
			output_format: "png"
		})
		expect(submit.json).not.toHaveProperty("steps")
		expect(r.ignored).toEqual(expect.arrayContaining(["negativePrompt", "steps"]))
		// Polled the BFL-owned polling URL with the key, then fetched the sample.
		expect(calls.map((c) => c.url)).toEqual([
			"https://api.bfl.ai/v1/flux-2-pro",
			"https://api.eu.bfl.ai/v1/get_result?id=task-1",
			"https://api.eu.bfl.ai/v1/get_result?id=task-1",
			"https://delivery-eu.bfl.ai/x.png"
		])
		expect(calls[1]!.headers["x-key"]).toBe("bfl-key")
		expect(calls[3]!.headers?.["x-key"]).toBeUndefined()
		expect(progress.some((p) => p.stage === "sampling" && p.percent === 40)).toBe(true)
		expect(r.media[0]).toMatchObject({ mime: "image/png", seed: 77, base64: Buffer.from([9, 9]).toString("base64") })
	})

	test("flex takes steps and guidance, clamped to its ranges", async () => {
		const calls = stub()
		const r = await adapter({ model: "flux-2-flex" }).generateImage({ prompt: "x", steps: 80, cfg: 1 })
		expect(calls[0]!.json).toMatchObject({ steps: 50, guidance: 1.5 })
		expect(r.applied).toEqual(expect.arrayContaining(["steps", "cfg"]))
	})

	test("a size past 4 megapixels is reported, never sent", async () => {
		const calls = stub()
		const r = await adapter().generateImage({ prompt: "x", width: 2048, height: 2560 })
		expect(calls[0]!.json).not.toHaveProperty("width")
		expect(r.ignored).toEqual(expect.arrayContaining(["width", "height"]))
	})
})

describe("Kontext and FLUX 3", () => {
	test("Kontext: an aspect ratio, four input pictures at most", async () => {
		const calls = stub()
		const r = await adapter({ model: "flux-kontext-pro" }).generateImage(
			{ prompt: "x", aspect: "16:9", width: 1344, height: 768, references: ["a", "b", "c", "d", "e"].map(ref) },
			{ loadMedia }
		)
		expect(calls[0]!.json).toMatchObject({ aspect_ratio: "16:9", input_image: b64("a"), input_image_4: b64("d") })
		expect(calls[0]!.json).not.toHaveProperty("input_image_5")
		expect(calls[0]!.json).not.toHaveProperty("width")
		expect(r.ignored).toContain("references")
	})

	test("FLUX 3: images[], aspect and tier, no seed, safety capped at 4", async () => {
		const calls = stub()
		const r = await adapter({
			model: "flux-3-image",
			extraJson: { apiKey: "k", profile: { safetyTolerance: 5, promptUpsampling: true } }
		}).generateImage({ prompt: "x", aspect: "3:2", width: 1536, height: 1024, seed: 3, references: [ref("a")] }, { loadMedia })
		expect(calls[0]!.url).toBe("https://api.bfl.ai/v1/flux-3-image")
		expect(calls[0]!.json).toEqual({
			prompt: "x",
			aspect_ratio: "3:2",
			resolution: "1.5k",
			safety_tolerance: 4,
			images: [b64("a")]
		})
		expect(r.ignored).toEqual(expect.arrayContaining(["seed", "promptUpsampling"]))
	})
})

describe("refusals and failures", () => {
	test("Request Moderated is a refusal with noRetry", async () => {
		stub([{ status: "Request Moderated", details: { reason: "flagged" } }])
		const r = await adapter().generateImage({ prompt: "x" })
		expect(r.media).toEqual([])
		expect(r.refusal).toMatchObject({ code: "Request Moderated", noRetry: true, details: { reason: "flagged" } })
	})

	test("Content Moderated is a refusal with noRetry", async () => {
		stub([{ status: "Content Moderated" }])
		const r = await adapter().generateImage({ prompt: "x" })
		expect(r.refusal).toMatchObject({ code: "Content Moderated", noRetry: true })
	})

	test("Error throws", async () => {
		stub([{ status: "Error" }])
		await expect(adapter().generateImage({ prompt: "x" })).rejects.toThrow(/BFL could not draw/)
	})

	test("abort stops the wait", async () => {
		const controller = new AbortController()
		stub([{ status: "Pending" }])
		const p = adapter().generateImage({ prompt: "x" }, { signal: controller.signal })
		setTimeout(() => controller.abort(), 5)
		expect((await p).isAborted).toBe(true)
	})

	test("a polling URL off BFL's hosts never receives the key", () => {
		expect(safePollingUrl("https://evil.example/poll", "https://api.bfl.ai", "t1")).toBe(
			"https://api.bfl.ai/v1/get_result?id=t1"
		)
		expect(safePollingUrl("https://api.us.bfl.ai/v1/get_result?id=t1", "https://api.bfl.ai", "t1")).toBe(
			"https://api.us.bfl.ai/v1/get_result?id=t1"
		)
	})
})

describe("sheets and listing", () => {
	test("per model", () => {
		expect(bflSheetFor({ model: "flux-2-pro" })).toBe(BFL_FLUX2_SHEET)
		expect(bflSheetFor({ model: "flux-2-max" })).toBe(BFL_FLUX2_SHEET)
		expect(bflSheetFor({ model: "flux-2-flex" })).toBe(BFL_FLUX2_FLEX_SHEET)
		expect(bflSheetFor({ model: "flux-kontext-max" })).toBe(BFL_KONTEXT_SHEET)
		expect(bflSheetFor({ model: "flux-3-image" })).toBe(BFL_FLUX3_SHEET)
		expect(BFL_FLUX2_SHEET).toMatchObject({ negative: false, transparent: "none", perCall: 1, references: { max: 8 } })
		expect(BFL_FLUX3_SHEET).toMatchObject({ seed: false, references: { max: 10 } })
	})

	test("region profile picks the host", async () => {
		const calls = stub()
		await adapter({ extraJson: { apiKey: "k", profile: { region: "eu" } } }).generateImage({ prompt: "x" })
		expect(calls[0]!.url).toBe("https://api.eu.bfl.ai/v1/flux-2-pro")
	})

	test("static list with flat per-image prices where BFL states them", async () => {
		const { models } = await bfl.listModels(conn())
		const kontext = models.find((m: any) => m.id === "flux-kontext-pro") as any
		expect(kontext.facts.pricing).toEqual({ perImage: { default: 0.04 }, currency: "USD" })
		expect((models.find((m: any) => m.id === "flux-2-pro") as any).facts).toBeUndefined()
	})
})
