import { afterEach, describe, expect, test, vi } from "vitest"
import openaiImages, {
	COMPATIBLE_IMAGES_SHEET,
	GPT_IMAGE_1_MINI_SHEET,
	GPT_IMAGE_1_SHEET,
	GPT_IMAGE_2_SHEET,
	TOGETHER_IMAGES_SHEET,
	XAI_IMAGES_SHEET,
	gptImageModel,
	openAIImageModelInfo,
	openAIImagesSheetFor,
	resolutionTier
} from "./OpenAIImagesAdapter"
import { fitRequestToSheet } from "$lib/server/imageGen/buildRequest"
import type { MediaRef } from "@serene-pub/sdk"

vi.mock("$lib/server/db", () => ({ db: { query: {} } }))

/**
 * The OpenAI-images dialect (DESIGN-image-generation §4.4): the call shapes of
 * both routes, the per-model sheet, and the honest report of what each model
 * cannot take.
 */

const conn = (over: Record<string, unknown> = {}) =>
	({
		id: 1,
		name: "openai",
		type: "openai",
		modality: "text-gen",
		baseUrl: "https://api.openai.com/v1/",
		preset: "openai-official",
		model: "gpt-image-2",
		extraJson: { apiKey: "sk-test" },
		...over
	}) as unknown as SelectConnection

const ref = (uuid: string): MediaRef => ({
	uuid,
	kind: "image",
	mime: "image/png",
	bytes: 3
})
const loadMedia = async (r: MediaRef) => ({
	bytes: new TextEncoder().encode(`bytes-of-${r.uuid}`),
	mime: "image/png"
})

interface Call {
	url: string
	headers: Record<string, string>
	json: any
	form: FormData | null
}

function stub(
	answer: () => { status: number; body: unknown } = () => ({
		status: 200,
		body: { data: [{ b64_json: "iVBORw0KGgo=" }], output_format: "png" }
	})
): Call[] {
	const calls: Call[] = []
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			const body = init?.body
			calls.push({
				url,
				headers: (init?.headers ?? {}) as Record<string, string>,
				json: typeof body === "string" ? JSON.parse(body) : null,
				form: body instanceof FormData ? body : null
			})
			const { status, body: out } = answer()
			return {
				ok: status >= 200 && status < 300,
				status,
				json: async () => out,
				text: async () => JSON.stringify(out)
			} as unknown as Response
		})
	)
	return calls
}

afterEach(() => {
	vi.unstubAllGlobals()
})

const adapter = (over: Record<string, unknown> = {}) =>
	new openaiImages.Adapter(conn(over) as any) as any

describe("generations", () => {
	test("JSON to /images/generations with size, n and model; no SD knobs", async () => {
		const calls = stub()
		const r = await adapter().generateImage({
			prompt: "a lighthouse",
			width: 1536,
			height: 1024,
			batch: 2,
			steps: 25,
			cfg: 7,
			seed: 42,
			negativePrompt: "blur"
		})
		expect(calls).toHaveLength(1)
		expect(calls[0]!.url).toBe("https://api.openai.com/v1/images/generations")
		expect(calls[0]!.headers.Authorization).toBe("Bearer sk-test")
		expect(calls[0]!.json).toEqual({
			prompt: "a lighthouse",
			model: "gpt-image-2",
			n: 2,
			size: "1536x1024"
		})
		// gpt-image always answers base64; asking is refused.
		expect(calls[0]!.json).not.toHaveProperty("response_format")
		expect(r.ignored).toEqual(
			expect.arrayContaining(["steps", "cfg", "seed", "negativePrompt"])
		)
		expect(r.media[0]).toMatchObject({ kind: "image", mime: "image/png" })
	})

	test("transparent → background transparent + png; webp when asked", async () => {
		const calls = stub()
		await adapter().generateImage({ prompt: "a sprite", transparent: true })
		expect(calls[0]!.json).toMatchObject({
			background: "transparent",
			output_format: "png"
		})
		await adapter().generateImage({
			prompt: "a sprite",
			transparent: true,
			outputFormat: "webp"
		})
		expect(calls[1]!.json).toMatchObject({
			background: "transparent",
			output_format: "webp"
		})
		// JPEG cannot carry alpha: png is sent and the format reported.
		const r = await adapter().generateImage({
			prompt: "a sprite",
			transparent: true,
			outputFormat: "jpeg"
		})
		expect(calls[2]!.json.output_format).toBe("png")
		expect(r.ignored).toContain("outputFormat")
	})

	test("quality a model lacks is dropped and reported", async () => {
		const calls = stub()
		const r = await adapter({
			model: "gpt-image-1",
			extraJson: { apiKey: "k", profile: { quality: "xhigh" } }
		}).generateImage({ prompt: "x" })
		expect(calls[0]!.json).not.toHaveProperty("quality")
		expect(r.ignored).toContain("quality")

		const r2 = await adapter({
			model: "gpt-image-2.5-sunburst",
			extraJson: { apiKey: "k", profile: { quality: "xhigh" } }
		}).generateImage({ prompt: "x" })
		expect(calls[1]!.json.quality).toBe("xhigh")
		expect(r2.applied).toContain("quality")
	})

	test("a size off the model's grid is reported, never sent", async () => {
		const calls = stub()
		const r = await adapter({ model: "gpt-image-1" }).generateImage({
			prompt: "x",
			width: 1216,
			height: 832
		})
		expect(calls[0]!.json).not.toHaveProperty("size")
		expect(r.ignored).toEqual(expect.arrayContaining(["width", "height"]))
	})
})

describe("edits", () => {
	test("canvas + 3 references + mask → multipart /images/edits, canvas first", async () => {
		const calls = stub()
		const r = await adapter({ model: "gpt-image-1.5" }).generateImage(
			{
				prompt: "same person, smiling",
				init: ref("canvas"),
				references: [ref("a"), ref("b"), ref("c")],
				mask: ref("mask")
			},
			{ loadMedia }
		)
		expect(calls[0]!.url).toBe("https://api.openai.com/v1/images/edits")
		const form = calls[0]!.form!
		expect(form).toBeTruthy()
		// No JSON content type: fetch sets the multipart boundary.
		expect(calls[0]!.headers["Content-Type"]).toBeUndefined()
		const images = form.getAll("image[]") as Blob[]
		expect(images).toHaveLength(4)
		expect(await images[0]!.text()).toBe("bytes-of-canvas")
		expect(await images[3]!.text()).toBe("bytes-of-c")
		expect(await (form.get("mask") as Blob).text()).toBe("bytes-of-mask")
		expect(form.get("prompt")).toBe("same person, smiling")
		expect(form.get("model")).toBe("gpt-image-1.5")
		expect(form.get("input_fidelity")).toBe("high")
		expect(r.applied).toEqual(
			expect.arrayContaining(["init", "references", "mask"])
		)
	})

	test("input_fidelity: never on 2+, never on mini", async () => {
		for (const model of ["gpt-image-2", "gpt-image-1-mini"]) {
			const calls = stub()
			await adapter({ model }).generateImage(
				{ prompt: "x", references: [ref("a")] },
				{ loadMedia }
			)
			expect(calls[0]!.url.endsWith("/images/edits")).toBe(true)
			expect(calls[0]!.form!.get("input_fidelity"), model).toBeNull()
		}
	})

	test("mini takes one reference; the rest are reported", async () => {
		const calls = stub()
		const r = await adapter({ model: "gpt-image-1-mini" }).generateImage(
			{ prompt: "x", references: [ref("a"), ref("b")] },
			{ loadMedia }
		)
		expect(calls[0]!.form!.getAll("image[]")).toHaveLength(1)
		expect(r.ignored).toContain("references")
	})

	test("a mask with nothing to paint on is ignored and the route stays generations", async () => {
		const calls = stub()
		const r = await adapter().generateImage(
			{ prompt: "x", mask: ref("m") },
			{ loadMedia }
		)
		expect(calls[0]!.url.endsWith("/images/generations")).toBe(true)
		expect(r.ignored).toContain("mask")
	})

	test("editImage is the edits route with the first canvas as image 0", async () => {
		const calls = stub()
		await adapter().editImage(
			{ prompt: "x", init: [ref("one"), ref("two")] },
			{ loadMedia }
		)
		const images = calls[0]!.form!.getAll("image[]") as Blob[]
		expect(images).toHaveLength(2)
		expect(await images[0]!.text()).toBe("bytes-of-one")
	})
})

describe("refusals", () => {
	test("moderation_blocked → a noRetry refusal with the provider's details", async () => {
		stub(() => ({
			status: 400,
			body: {
				error: {
					type: "image_generation_user_error",
					code: "moderation_blocked",
					message: "Your request was rejected by the safety system.",
					moderation_details: { categories: ["violence"] }
				}
			}
		}))
		const r = await adapter().generateImage({ prompt: "x" })
		expect(r.media).toEqual([])
		expect(r.refusal).toMatchObject({
			code: "moderation_blocked",
			noRetry: true,
			details: { categories: ["violence"] }
		})
		expect(r.refusal!.message).toContain("rejected by the safety system")
		expect(r.refusal!.message).toContain("violence")
	})

	test("any other error throws with the provider's message", async () => {
		stub(() => ({
			status: 400,
			body: { error: { code: "invalid_value", message: "bad size" } }
		}))
		await expect(adapter().generateImage({ prompt: "x" })).rejects.toThrow(
			/bad size/
		)
	})
})

describe("sheets", () => {
	test("size enum on 1.x, free on 2+; references 16, mini 1", () => {
		expect(openAIImagesSheetFor({ type: "openai", model: "gpt-image-1" })).toBe(
			GPT_IMAGE_1_SHEET
		)
		expect(
			openAIImagesSheetFor({ type: "openai", model: "gpt-image-1.5" }).size.kind
		).toBe("enum")
		expect(
			openAIImagesSheetFor({ type: "openai", model: "gpt-image-1-mini" })
		).toBe(GPT_IMAGE_1_MINI_SHEET)
		expect(GPT_IMAGE_1_MINI_SHEET.references).toEqual({ max: 1 })
		for (const model of ["gpt-image-2", "gpt-image-2.5-flare"]) {
			const sheet = openAIImagesSheetFor({ type: "openai", model })
			expect(sheet).toBe(GPT_IMAGE_2_SHEET)
			expect(sheet.size).toMatchObject({ kind: "free", step: 16, maxRatio: 3 })
			expect(sheet.references).toEqual({ max: 16 })
		}
		// No model on OpenAI: the default model's sheet.
		expect(
			openAIImagesSheetFor({
				type: "openai",
				preset: "openai-official",
				model: null
			})
		).toBe(GPT_IMAGE_2_SHEET)
		expect(GPT_IMAGE_2_SHEET).toMatchObject({
			negative: false,
			seed: false,
			steps: false,
			cfg: false,
			transparent: "native",
			perCall: 10,
			cancel: true
		})
	})

	test("xAI and Together by preset or address; anything else compatible", () => {
		expect(
			openAIImagesSheetFor({ type: "openai", preset: "xai-grok", model: "x" })
		).toBe(XAI_IMAGES_SHEET)
		expect(
			openAIImagesSheetFor({ type: "openai", baseUrl: "https://api.x.ai/v1" })
		).toBe(XAI_IMAGES_SHEET)
		expect(XAI_IMAGES_SHEET.size.kind).toBe("aspect")
		const together = openAIImagesSheetFor({
			type: "openai",
			baseUrl: "https://api.together.xyz/v1/"
		})
		expect(together).toBe(TOGETHER_IMAGES_SHEET)
		expect(together).toMatchObject({ negative: true, steps: true, seed: true })
		expect(
			openAIImagesSheetFor({
				type: "openai",
				baseUrl: "http://localhost:5001/v1",
				model: "sd15"
			})
		).toBe(COMPATIBLE_IMAGES_SHEET)
	})

	test("the host's fit keeps a gpt-image-2 size inside the pixel and shape bounds", () => {
		const tiny = fitRequestToSheet(
			{ prompt: "x", width: 512, height: 512 },
			GPT_IMAGE_2_SHEET
		)
		expect(tiny.width! * tiny.height!).toBeGreaterThanOrEqual(655_360)
		expect(tiny.width! % 16).toBe(0)
		const tall = fitRequestToSheet(
			{ prompt: "x", width: 512, height: 2048 },
			GPT_IMAGE_2_SHEET
		)
		expect(tall.height! / tall.width!).toBeLessThanOrEqual(3)
		expect(tall.width! * tall.height!).toBeGreaterThanOrEqual(655_360)
	})

	test("gptImageModel reads version and mini", () => {
		expect(gptImageModel("gpt-image-2.5-sunburst")).toEqual({
			version: 2.5,
			mini: false
		})
		expect(gptImageModel("gpt-image-1-mini")).toEqual({ version: 1, mini: true })
		expect(gptImageModel("gpt-4o")).toBeNull()
	})
})

describe("other services on the route", () => {
	test("Together sends width/height, steps, seed, negative and asks for base64", async () => {
		const calls = stub()
		await adapter({
			preset: "together-ai",
			baseUrl: "https://api.together.xyz/v1/",
			model: "black-forest-labs/FLUX.1-schnell"
		}).generateImage({
			prompt: "x",
			negativePrompt: "blur",
			width: 1024,
			height: 768,
			steps: 4,
			seed: 7
		})
		expect(calls[0]!.json).toMatchObject({
			width: 1024,
			height: 768,
			steps: 4,
			seed: 7,
			negative_prompt: "blur",
			response_format: "base64"
		})
		expect(calls[0]!.json).not.toHaveProperty("size")
	})

	test("xAI sends the host's aspect", async () => {
		const calls = stub()
		await adapter({
			preset: "xai-grok",
			baseUrl: "https://api.x.ai/v1/",
			model: null
		}).generateImage({ prompt: "x", aspect: "3:2", width: 1216, height: 832 })
		expect(calls[0]!.json).toMatchObject({
			model: "grok-imagine-image-2.0",
			aspect_ratio: "3:2",
			resolution: "1k",
			response_format: "b64_json"
		})
		expect(calls[0]!.json).not.toHaveProperty("size")
	})

	test("xAI sends the resolution tier from the fitted size and reports it", async () => {
		const calls = stub()
		const xai = () =>
			adapter({ preset: "xai-grok", baseUrl: "https://api.x.ai/v1/", model: null })
		const big = await xai().generateImage({ prompt: "x", aspect: "2:3", width: 1344, height: 2016 })
		expect(calls[0]!.json).toMatchObject({ aspect_ratio: "2:3", resolution: "2k" })
		expect(big.applied).toContain("resolution")
		// Exactly 1536 on the long edge is the large tier; 1535 is not.
		await xai().generateImage({ prompt: "x", aspect: "1:1", width: 1536, height: 1536 })
		expect(calls[1]!.json).toMatchObject({ resolution: "2k" })
		await xai().generateImage({ prompt: "x", aspect: "1:1", width: 1535, height: 1024 })
		expect(calls[2]!.json).toMatchObject({ resolution: "1k" })
		// No size: no tier, the service's default.
		const bare = await xai().generateImage({ prompt: "x", aspect: "1:1" })
		expect(calls[3]!.json).not.toHaveProperty("resolution")
		expect(bare.applied).not.toContain("resolution")
	})

	test("resolutionTier picks only a tier the sheet lists", () => {
		expect(resolutionTier(2048, ["1k", "2k"])).toBe("2k")
		expect(resolutionTier(1024, ["1k", "2k"])).toBe("1k")
		expect(resolutionTier(2048, ["1k"])).toBeNull()
	})
})

describe("listing", () => {
	test("listModels keeps only image ids; testConnection is that", async () => {
		stub(() => ({
			status: 200,
			body: {
				data: [
					{ id: "gpt-4o" },
					{ id: "gpt-image-2" },
					{ id: "gpt-image-1-mini" },
					{ id: "dall-e-3" },
					{ id: "text-embedding-3-small" },
					{ id: "gemini-2.5-flash-image" },
					{ id: "flux-schnell", type: "image" }
				]
			}
		}))
		const { models } = await openaiImages.listModels(conn())
		expect(models).toEqual([
			"gpt-image-2",
			"gpt-image-1-mini",
			"dall-e-3",
			"gemini-2.5-flash-image",
			"flux-schnell"
		])
		const t = await openaiImages.testConnection(conn())
		expect(t.ok).toBe(true)
	})

	test("openAIImageModelInfo: image-gen, and a per-image price only where stated", () => {
		expect(openAIImageModelInfo("gpt-4o")).toBeNull()
		expect(openAIImageModelInfo("gpt-image-2")).toEqual({
			modality: "image-gen",
			facts: {
				pricing: {
					perImage: { low: 0.006, medium: 0.053, high: 0.211 },
					currency: "USD"
				},
				source: "list"
			}
		})
		// Token-billed: modality only.
		expect(openAIImageModelInfo("gpt-image-2.5-sunburst")).toEqual({
			modality: "image-gen"
		})
	})
})
