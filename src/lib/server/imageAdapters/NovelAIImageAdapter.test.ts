import { afterEach, describe, expect, test, vi } from "vitest"
import { crc32, deflateRawSync } from "node:zlib"
import novelai, {
	NOVELAI_IMAGE_MODELS,
	NOVELAI_SHEET,
	novelAIExpressionFor,
	novelAIPictures,
	novelAISampler
} from "./NovelAIImageAdapter"
import { imagePixelSize, unzip } from "./hostedImageHelpers"
import type { MediaRef } from "@serene-pub/sdk"

vi.mock("$lib/server/db", () => ({ db: { query: {} } }))

/**
 * The NovelAI dialect (DESIGN-image-generation §4.4): the ZIP answer, the
 * `v4_prompt` V4+ requires, director references, img2img/infill, and the
 * `augment-image` emotion call behind the sheet's `expressions`.
 */

/** A minimal ZIP: one local header + data per file, a central directory, an end record. */
function makeZip(files: Array<{ name: string; data: Uint8Array; deflate?: boolean }>): Uint8Array {
	const locals: Buffer[] = []
	const centrals: Buffer[] = []
	let offset = 0
	for (const f of files) {
		const name = Buffer.from(f.name)
		const body = f.deflate ? deflateRawSync(f.data) : Buffer.from(f.data)
		const crc = crc32(f.data)
		const local = Buffer.alloc(30)
		local.writeUInt32LE(0x04034b50, 0)
		local.writeUInt16LE(20, 4)
		local.writeUInt16LE(f.deflate ? 8 : 0, 8)
		local.writeUInt32LE(crc, 14)
		local.writeUInt32LE(body.length, 18)
		local.writeUInt32LE(f.data.length, 22)
		local.writeUInt16LE(name.length, 26)
		locals.push(local, name, body)
		const central = Buffer.alloc(46)
		central.writeUInt32LE(0x02014b50, 0)
		central.writeUInt16LE(20, 4)
		central.writeUInt16LE(20, 6)
		central.writeUInt16LE(f.deflate ? 8 : 0, 10)
		central.writeUInt32LE(crc, 16)
		central.writeUInt32LE(body.length, 20)
		central.writeUInt32LE(f.data.length, 24)
		central.writeUInt16LE(name.length, 28)
		central.writeUInt32LE(offset, 42)
		centrals.push(central, name)
		offset += 30 + name.length + body.length
	}
	const cd = Buffer.concat(centrals)
	const end = Buffer.alloc(22)
	end.writeUInt32LE(0x06054b50, 0)
	end.writeUInt16LE(files.length, 8)
	end.writeUInt16LE(files.length, 10)
	end.writeUInt32LE(cd.length, 12)
	end.writeUInt32LE(offset, 16)
	return new Uint8Array(Buffer.concat([...locals, cd, end]))
}

/** A PNG header with a size, enough for `imagePixelSize`. */
function pngOf(width: number, height: number): Uint8Array {
	const b = Buffer.alloc(33)
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
	b.writeUInt32BE(13, 8)
	b.write("IHDR", 12, "ascii")
	b.writeUInt32BE(width, 16)
	b.writeUInt32BE(height, 20)
	return new Uint8Array(b)
}

const PNG_A = pngOf(832, 1216)
const PNG_B = pngOf(832, 1216).map((x, i) => (i === 32 ? 7 : x))

const conn = (over: Record<string, unknown> = {}) =>
	({
		id: 3,
		name: "novelai",
		type: "novelai",
		modality: "image-gen",
		baseUrl: "https://image.novelai.net",
		model: "nai-diffusion-5-full",
		extraJson: { apiKey: "pst-abc" },
		...over
	}) as unknown as SelectConnection

const ref = (uuid: string): MediaRef => ({ uuid, kind: "image", mime: "image/png", bytes: 3 })
const loadMedia = async (r: MediaRef) => ({ bytes: new TextEncoder().encode(`bytes-of-${r.uuid}`), mime: "image/png" })
const b64 = (s: string) => Buffer.from(`bytes-of-${s}`).toString("base64")

interface Call {
	url: string
	headers: Record<string, string>
	json: any
}

function stub(answer: () => { status: number; zip?: Uint8Array; body?: unknown } = () => ({
	status: 200,
	zip: makeZip([
		{ name: "image_1.png", data: PNG_B },
		{ name: "image_0.png", data: PNG_A, deflate: true }
	])
})): Call[] {
	const calls: Call[] = []
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({
				url,
				headers: (init?.headers ?? {}) as Record<string, string>,
				json: typeof init?.body === "string" ? JSON.parse(init.body) : null
			})
			const a = answer()
			return {
				ok: a.status >= 200 && a.status < 300,
				status: a.status,
				json: async () => a.body,
				text: async () => JSON.stringify(a.body ?? {}),
				arrayBuffer: async () => {
					const z = a.zip ?? new Uint8Array()
					return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength)
				}
			} as unknown as Response
		})
	)
	return calls
}

afterEach(() => vi.unstubAllGlobals())

const adapter = (over: Record<string, unknown> = {}) => new novelai.Adapter(conn(over) as any) as any

describe("the ZIP answer", () => {
	test("stored and deflated entries unpack, in image_N order", () => {
		const pics = novelAIPictures(
			makeZip([
				{ name: "image_1.png", data: PNG_B },
				{ name: "image_0.png", data: PNG_A, deflate: true }
			])
		)
		expect(pics).toHaveLength(2)
		expect(Buffer.from(pics[0].base64, "base64")).toEqual(Buffer.from(PNG_A))
		expect(Buffer.from(pics[1].base64, "base64")).toEqual(Buffer.from(PNG_B))
		expect(pics[0].mime).toBe("image/png")
	})

	test("a JSON body is not mistaken for an empty archive", () => {
		expect(() => unzip(new TextEncoder().encode('{"message":"x"}'))).toThrow(/not a ZIP/)
	})

	test("the PNG header gives the size", () => {
		expect(imagePixelSize(PNG_A)).toEqual({ width: 832, height: 1216 })
	})
})

describe("generate-image", () => {
	test("bearer, model, v4_prompt and v4_negative_prompt on V4+, SD knobs", async () => {
		const calls = stub()
		const r = await adapter().generateImage({
			prompt: "1girl, lighthouse",
			negativePrompt: "lowres",
			width: 832,
			height: 1216,
			steps: 28,
			cfg: 5.5,
			seed: 1234,
			sampler: "Euler a",
			batch: 2
		})
		expect(calls[0]!.url).toBe("https://image.novelai.net/ai/generate-image")
		expect(calls[0]!.headers.Authorization).toBe("Bearer pst-abc")
		const body = calls[0]!.json
		expect(body).toMatchObject({ input: "1girl, lighthouse", model: "nai-diffusion-5-full", action: "generate" })
		expect(body.parameters).toMatchObject({
			width: 832,
			height: 1216,
			steps: 28,
			scale: 5.5,
			seed: 1234,
			sampler: "k_euler_ancestral",
			n_samples: 2,
			negative_prompt: "lowres",
			v4_prompt: { caption: { base_caption: "1girl, lighthouse", char_captions: [] }, use_coords: false, use_order: true },
			v4_negative_prompt: { caption: { base_caption: "lowres", char_captions: [] } }
		})
		expect(body.parameters).not.toHaveProperty("sm")
		expect(r.media).toHaveLength(2)
		expect(r.media.map((m: any) => m.seed)).toEqual([1234, 1235])
	})

	test("v4_prompt is always present on V4.5, even with no negative", async () => {
		const calls = stub()
		await adapter({ model: "nai-diffusion-4-5-curated" }).generateImage({ prompt: "x" })
		expect(calls[0]!.json.parameters.v4_prompt.caption.base_caption).toBe("x")
		expect(calls[0]!.json.parameters.v4_negative_prompt.caption.base_caption).toBe("")
	})

	test("SMEA set on a V4+ model is reported, never sent", async () => {
		const calls = stub()
		const r = await adapter({ extraJson: { apiKey: "k", profile: { sm: true } } }).generateImage({ prompt: "x" })
		expect(calls[0]!.json.parameters).not.toHaveProperty("sm")
		expect(r.ignored).toContain("sm")
	})

	test("references become director references, capped at four", async () => {
		const calls = stub()
		const r = await adapter().generateImage(
			{ prompt: "x", references: ["a", "b", "c", "d", "e"].map(ref) },
			{ loadMedia }
		)
		const p = calls[0]!.json.parameters
		expect(p.director_reference_images).toEqual(["a", "b", "c", "d"].map(b64))
		expect(p.director_reference_descriptions[0]).toEqual({
			caption: { base_caption: "character", char_captions: [] },
			legacy_uc: false
		})
		expect(p.director_reference_strength_values).toEqual([1, 1, 1, 1])
		expect(p.director_reference_information_extracted).toHaveLength(4)
		expect(p.director_reference_secondary_strength_values).toHaveLength(4)
		expect(r.ignored).toContain("references")
	})

	test("a canvas is img2img; a canvas and mask is infill on the inpainting model", async () => {
		const calls = stub()
		await adapter().generateImage({ prompt: "x", init: ref("c"), denoise: 0.5 }, { loadMedia })
		expect(calls[0]!.json).toMatchObject({ action: "img2img", model: "nai-diffusion-5-full", parameters: { image: b64("c"), strength: 0.5 } })
		await adapter().generateImage({ prompt: "x", init: ref("c"), mask: ref("m") }, { loadMedia })
		expect(calls[1]!.json).toMatchObject({
			action: "infill",
			model: "nai-diffusion-5-full-inpainting",
			parameters: { image: b64("c"), mask: b64("m") }
		})
	})

	test("transparency and clip skip are reported ignored", async () => {
		stub()
		const r = await adapter().generateImage({ prompt: "x", transparent: true, clipSkip: 2 })
		expect(r.ignored).toEqual(expect.arrayContaining(["transparent", "clipSkip"]))
	})

	test("an HTTP failure throws with the service's words", async () => {
		stub(() => ({ status: 500, body: { statusCode: 500, message: "Internal error" } }))
		await expect(adapter().generateImage({ prompt: "x" })).rejects.toThrow(/Internal error/)
	})
})

describe("expressions", () => {
	test("augment-image emotion with the picture's own size", async () => {
		const calls = stub(() => ({ status: 200, zip: makeZip([{ name: "image_0.png", data: PNG_B }]) }))
		const r = await adapter().expressImage(ref("sprite"), "Happy", {
			loadMedia: async () => ({ bytes: PNG_A, mime: "image/png" })
		})
		expect(calls[0]!.url).toBe("https://image.novelai.net/ai/augment-image")
		expect(calls[0]!.json).toMatchObject({
			req_type: "emotion",
			width: 832,
			height: 1216,
			prompt: "happy;;",
			defry: 0,
			image: Buffer.from(PNG_A).toString("base64")
		})
		expect(r.media).toHaveLength(1)
		expect(r.media[0].meta).toMatchObject({ tool: "emotion", expression: "happy" })
	})

	test("an expression NovelAI does not know is refused before anything is sent", async () => {
		const calls = stub()
		await expect(
			adapter().expressImage(ref("s"), "melancholic", { loadMedia: async () => ({ bytes: PNG_A, mime: "image/png" }) })
		).rejects.toThrow(/cannot draw the expression/)
		expect(calls).toHaveLength(0)
	})

	test("a standard sprite label is sent as the nearest expression NovelAI knows", async () => {
		const calls = stub(() => ({ status: 200, zip: makeZip([{ name: "image_0.png", data: PNG_B }]) }))
		await adapter().expressImage(ref("sprite"), "joy", {
			loadMedia: async () => ({ bytes: PNG_A, mime: "image/png" })
		})
		expect(calls[0]!.json).toMatchObject({ prompt: "happy;;" })
		expect(novelAIExpressionFor("Embarrassment")).toBe("embarrassed")
		expect(novelAIExpressionFor("smug")).toBe("smug")
		expect(novelAIExpressionFor("melancholic")).toBeNull()
	})

	test("the sheet says expressions exist", () => {
		expect(NOVELAI_SHEET.expressions).toBe(true)
	})
})

describe("sheet, samplers, listing", () => {
	test("the sheet", () => {
		expect(NOVELAI_SHEET).toMatchObject({
			negative: true,
			seed: true,
			steps: true,
			cfg: true,
			sampler: true,
			size: { kind: "free", step: 64 },
			references: { max: 4 },
			transparent: "none"
		})
	})

	test("sampler names", () => {
		expect(novelAISampler("DPM++ 2M")).toBe("k_dpmpp_2m")
		expect(novelAISampler("k_euler")).toBe("k_euler")
		expect(novelAISampler("DDIM")).toBeNull()
	})

	test("a static list of image models", async () => {
		const { models } = await novelai.listModels(conn())
		expect(models.map((m: any) => m.id)).toEqual(NOVELAI_IMAGE_MODELS.map((m) => m.id))
		expect(models[0]).toMatchObject({ modality: "image-gen" })
	})
})
