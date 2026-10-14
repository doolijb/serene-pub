import { afterEach, describe, expect, test, vi } from "vitest"
import gemini, {
	GEMINI_FLASH_LITE_SHEET,
	GEMINI_FLASH_SHEET,
	GEMINI_LEGACY_SHEET,
	GEMINI_PRO_SHEET,
	geminiImageSheetFor,
	geminiNativeBase,
	isGeminiImageService,
	withGeminiImages
} from "./GeminiImageAdapter"
import openaiImages from "./OpenAIImagesAdapter"
import type { MediaRef } from "@serene-pub/sdk"

vi.mock("$lib/server/db", () => ({ db: { query: {} } }))

/**
 * The Gemini image dialect (DESIGN-image-generation §4.4): `generateContent`
 * with `inlineData` parts and an `imageConfig`, per-model sheets, the honest
 * report of the knobs Gemini lacks, and safety stops as refusals.
 */

const conn = (over: Record<string, unknown> = {}) =>
	({
		id: 1,
		name: "gemini",
		type: "openai",
		modality: "text-gen",
		baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
		preset: "google-gemini",
		model: "gemini-nano-banana-2.1",
		extraJson: { apiKey: "g-key" },
		...over
	}) as unknown as SelectConnection

const ref = (uuid: string): MediaRef => ({ uuid, kind: "image", mime: "image/png", bytes: 3 })
const loadMedia = async (r: MediaRef) => ({
	bytes: new TextEncoder().encode(`bytes-of-${r.uuid}`),
	mime: "image/png"
})
const b64 = (s: string) => Buffer.from(`bytes-of-${s}`).toString("base64")

interface Call {
	url: string
	headers: Record<string, string>
	json: any
}

const PICTURE = {
	candidates: [
		{
			finishReason: "STOP",
			content: { parts: [{ text: "Here you go." }, { inlineData: { mimeType: "image/png", data: "iVBORw0KGgo=" } }] }
		}
	]
}

function stub(answer: (url: string) => { status: number; body: unknown } = () => ({ status: 200, body: PICTURE })): Call[] {
	const calls: Call[] = []
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({
				url,
				headers: (init?.headers ?? {}) as Record<string, string>,
				json: typeof init?.body === "string" ? JSON.parse(init.body) : null
			})
			const { status, body } = answer(url)
			return {
				ok: status >= 200 && status < 300,
				status,
				json: async () => body,
				text: async () => JSON.stringify(body)
			} as unknown as Response
		})
	)
	return calls
}

afterEach(() => vi.unstubAllGlobals())

const adapter = (over: Record<string, unknown> = {}) => new gemini.Adapter(conn(over) as any) as any

describe("generateContent", () => {
	test("native route, key header, aspect and tier; no SD knobs", async () => {
		const calls = stub()
		const r = await adapter().generateImage({
			prompt: "a lighthouse",
			aspect: "16:9",
			width: 1824,
			height: 1024,
			seed: 4,
			steps: 20,
			cfg: 7,
			negativePrompt: "blur",
			transparent: true
		})
		expect(calls[0]!.url).toBe(
			"https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent"
		)
		expect(calls[0]!.headers["x-goog-api-key"]).toBe("g-key")
		expect(calls[0]!.json.generationConfig).toEqual({
			responseModalities: ["TEXT", "IMAGE"],
			imageConfig: { aspectRatio: "16:9", imageSize: "2K" }
		})
		expect(calls[0]!.json.contents[0].parts).toEqual([{ text: "a lighthouse" }])
		expect(r.ignored).toEqual(
			expect.arrayContaining(["seed", "steps", "cfg", "negativePrompt", "transparent"])
		)
		expect(r.applied).toEqual(expect.arrayContaining(["aspect", "width", "height"]))
		expect(r.media).toHaveLength(1)
		expect(r.media[0]).toMatchObject({ mime: "image/png", base64: "iVBORw0KGgo=" })
		expect(r.media[0].meta.text).toBe("Here you go.")
	})

	test("canvas and references ride as inlineData parts before the prompt, capped by the sheet", async () => {
		const calls = stub()
		const r = await adapter().generateImage(
			{
				prompt: "same girl, waving",
				init: ref("canvas"),
				references: ["a", "b", "c", "d", "e"].map(ref)
			},
			{ loadMedia }
		)
		const parts = calls[0]!.json.contents[0].parts
		expect(parts).toHaveLength(6)
		expect(parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: b64("canvas") } })
		expect(parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: b64("a") } })
		expect(parts[5]).toEqual({ text: "same girl, waving" })
		// Four character references on Flash; the fifth is reported.
		expect(r.ignored).toContain("references")
	})

	test("an unknown aspect is reported, never sent; a pinned tier wins", async () => {
		const calls = stub()
		const r = await adapter({
			extraJson: { apiKey: "k", profile: { imageSize: "4K" } }
		}).generateImage({ prompt: "x", aspect: "7:3", width: 700, height: 300 })
		expect(calls[0]!.json.generationConfig.imageConfig).toEqual({ imageSize: "4K" })
		expect(r.ignored).toEqual(expect.arrayContaining(["aspect", "width", "height"]))
	})

	test("the safety profile becomes safetySettings", async () => {
		const calls = stub()
		await adapter({ extraJson: { apiKey: "k", profile: { safety: "relaxed" } } }).generateImage({ prompt: "x" })
		expect(calls[0]!.json.safetySettings).toHaveLength(4)
		expect(calls[0]!.json.safetySettings[0].threshold).toBe("BLOCK_ONLY_HIGH")
	})
})

describe("refusals", () => {
	test("a blocked prompt is a refusal with noRetry", async () => {
		stub(() => ({ status: 200, body: { promptFeedback: { blockReason: "SAFETY" } } }))
		const r = await adapter().generateImage({ prompt: "x" })
		expect(r.media).toEqual([])
		expect(r.refusal).toMatchObject({ code: "SAFETY", noRetry: true })
	})

	test("an IMAGE_SAFETY stop is a refusal with noRetry", async () => {
		stub(() => ({ status: 200, body: { candidates: [{ finishReason: "IMAGE_SAFETY", content: { parts: [] } }] } }))
		const r = await adapter().generateImage({ prompt: "x" })
		expect(r.refusal).toMatchObject({ code: "IMAGE_SAFETY", noRetry: true })
	})

	test("words without a picture may be retried", async () => {
		stub(() => ({ status: 200, body: { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "I can't draw that." }] } }] } }))
		const r = await adapter().generateImage({ prompt: "x" })
		expect(r.refusal).toMatchObject({ noRetry: false })
		expect(r.refusal.message).toContain("I can't draw that.")
	})
})

describe("sheets", () => {
	test("per model", () => {
		expect(geminiImageSheetFor({ model: "gemini-nano-banana-2.1" })).toBe(GEMINI_FLASH_SHEET)
		expect(geminiImageSheetFor({ model: "gemini-3.1-flash-image" })).toBe(GEMINI_FLASH_SHEET)
		expect(geminiImageSheetFor({ model: "gemini-3.1-flash-lite-image" })).toBe(GEMINI_FLASH_LITE_SHEET)
		expect(geminiImageSheetFor({ model: "models/gemini-3-pro-image" })).toBe(GEMINI_PRO_SHEET)
		expect(geminiImageSheetFor({ model: "gemini-2.5-flash-image" })).toBe(GEMINI_LEGACY_SHEET)
		expect(GEMINI_FLASH_SHEET).toMatchObject({ seed: false, negative: false, perCall: 1, transparent: "none", references: { max: 4 } })
		expect(GEMINI_PRO_SHEET.references).toEqual({ max: 5 })
		expect(GEMINI_FLASH_LITE_SHEET.size).toMatchObject({ tiers: ["1K"] })
	})

	test("which connections are Gemini, and its native address", () => {
		expect(isGeminiImageService({ preset: "google-gemini" })).toBe(true)
		expect(isGeminiImageService({ baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/" })).toBe(true)
		expect(isGeminiImageService({ preset: "openai-official", baseUrl: "https://api.openai.com/v1" })).toBe(false)
		expect(geminiNativeBase({ baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/" })).toBe(
			"https://generativelanguage.googleapis.com/v1beta"
		)
	})
})

describe("folded into the OPENAI type", () => {
	const routed = withGeminiImages(openaiImages)

	test("routes by preset: Gemini's wire for Gemini, OpenAI's for the rest", async () => {
		const calls = stub((url) =>
			url.includes(":generateContent")
				? { status: 200, body: PICTURE }
				: { status: 200, body: { data: [{ b64_json: "iVBORw0KGgo=" }] } }
		)
		await new routed.Adapter(conn() as any).generateImage({ prompt: "a" })
		await new routed.Adapter(
			conn({ preset: "openai-official", baseUrl: "https://api.openai.com/v1", model: "gpt-image-2" }) as any
		).generateImage({ prompt: "b" })
		expect(calls[0]!.url).toContain(":generateContent")
		expect(calls[1]!.url).toBe("https://api.openai.com/v1/images/generations")
		expect(routed.sheetFor!(conn() as any)).toBe(GEMINI_FLASH_SHEET)
		expect(routed.sheetFor!(conn({ preset: "openai-official", baseUrl: "", model: "gpt-image-2" }) as any)).not.toBe(GEMINI_FLASH_SHEET)
	})

	test("the class still carries both actions for the conformance walk", () => {
		const proto = routed.Adapter.prototype
		expect(Object.prototype.hasOwnProperty.call(proto, "generateImage")).toBe(true)
		expect(Object.prototype.hasOwnProperty.call(proto, "editImage")).toBe(true)
	})
})

describe("listing", () => {
	test("only image models, ids without the models/ prefix", async () => {
		const calls = stub(() => ({
			status: 200,
			body: {
				models: [
					{ name: "models/gemini-3-flash", supportedGenerationMethods: ["generateContent"] },
					{ name: "models/gemini-nano-banana-2.1", displayName: "Nano Banana 2.1", supportedGenerationMethods: ["generateContent"] },
					{ name: "models/gemini-3-pro-image", supportedGenerationMethods: ["generateContent"] },
					{ name: "models/text-embedding-005", supportedGenerationMethods: ["embedContent"] }
				]
			}
		}))
		const { models } = await gemini.listModels(conn())
		expect(calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000")
		expect(models).toEqual([
			{ id: "gemini-nano-banana-2.1", name: "Nano Banana 2.1", modality: "image-gen" },
			{ id: "gemini-3-pro-image", name: "gemini-3-pro-image", modality: "image-gen" }
		])
	})
})
