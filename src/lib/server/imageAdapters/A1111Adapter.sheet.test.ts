import { afterEach, describe, expect, test, vi } from "vitest"
import a1111, {
	A1111_SHEET,
	KOBOLDCPP_EDIT_SHEET,
	KOBOLDCPP_SHEET,
	a1111SheetFor,
	looksLikeEditModel
} from "./A1111Adapter"
import kcppManaged from "./KoboldCppManagedImageAdapter"
import type { MediaRef } from "@serene-pub/sdk"

vi.mock("$lib/server/db", () => ({ db: { query: {} } }))

/**
 * The drawing sheet the A1111 wire declares (DESIGN-image-generation §4.3–4.4),
 * and the request fields it now carries: a starting canvas on the img2img
 * route, reference images as KoboldCPP's `extra_images`, and an honest report
 * of every new field it cannot honour.
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
const b64 = (uuid: string) => Buffer.from(`bytes-of-${uuid}`).toString("base64")

function stub(): Array<{ url: string; body: any }> {
	const calls: Array<{ url: string; body: any }> = []
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			calls.push({
				url,
				body: init?.body ? JSON.parse(init.body as string) : null
			})
			return {
				ok: true,
				status: 200,
				json: async () => ({ images: ["iVBORw0KGgo="] }),
				text: async () => ""
			} as unknown as Response
		})
	)
	return calls
}

afterEach(() => vi.unstubAllGlobals())

describe("the drawing sheet", () => {
	test("A1111 draws free sizes, several per call, and takes no references", () => {
		expect(a1111.sheet).toBe(A1111_SHEET)
		expect(A1111_SHEET.size).toEqual({ kind: "free", step: 8, min: 64, max: 2048 })
		expect(A1111_SHEET.references).toBeNull()
		expect(A1111_SHEET.perCall).toBeGreaterThan(1)
		expect(A1111_SHEET.transparent).toBe("none")
	})

	test("KoboldCPP is one picture per call, references only with an edit model", () => {
		for (const type of ["koboldcpp", "koboldcpp_managed", "koboldcpp_managed_image"]) {
			expect(a1111SheetFor({ type, model: "sdxl.safetensors" })).toBe(KOBOLDCPP_SHEET)
			expect(a1111SheetFor({ type, model: "flux1-kontext-dev-Q4.gguf" })).toBe(
				KOBOLDCPP_EDIT_SHEET
			)
		}
		expect(KOBOLDCPP_SHEET.perCall).toBe(1)
		expect(KOBOLDCPP_SHEET.references).toBeNull()
		expect(KOBOLDCPP_EDIT_SHEET.references).toEqual({ max: 4 })
		// A1111 itself never takes references, whatever the model is called.
		expect(a1111SheetFor({ type: "a1111", model: "kontext" })).toBe(A1111_SHEET)
		// The managed module serves the same rule.
		expect(kcppManaged.sheet).toBe(KOBOLDCPP_SHEET)
		expect(kcppManaged.sheetFor).toBe(a1111SheetFor)
	})

	test("edit models are read off the name", () => {
		expect(looksLikeEditModel("Qwen-Image-Edit-2509-Q4_K_M.gguf")).toBe(true)
		expect(looksLikeEditModel("qwen_image_edit.safetensors")).toBe(true)
		expect(looksLikeEditModel("FLUX.1-Kontext-dev")).toBe(true)
		expect(looksLikeEditModel("my-edit-model")).toBe(true)
		expect(looksLikeEditModel("credits-sdxl")).toBe(false)
		expect(looksLikeEditModel("sdxl-base")).toBe(false)
		expect(looksLikeEditModel(null)).toBe(false)
	})
})

describe("the new request fields", () => {
	test("a starting canvas goes to img2img, with its mask and denoise", async () => {
		const calls = stub()
		const out = await new a1111.Adapter(conn()).generateImage(
			{ prompt: "p", init: ref("canvas"), mask: ref("mask"), denoise: 0.6 },
			{ loadMedia }
		)
		const render = calls.find((c) => c.url.includes("img2img"))!
		expect(render).toBeTruthy()
		expect(calls.some((c) => c.url.includes("txt2img"))).toBe(false)
		expect(render.body.init_images).toEqual([b64("canvas")])
		expect(render.body.mask).toBe(b64("mask"))
		expect(render.body.denoising_strength).toBe(0.6)
		expect(out.applied).toEqual(expect.arrayContaining(["init", "mask", "denoise"]))
		expect(out.ignored).not.toContain("denoise")
	})

	test("without a loader the canvas is reported, and the render stays txt2img", async () => {
		const calls = stub()
		const out = await new a1111.Adapter(conn()).generateImage({
			prompt: "p",
			init: ref("canvas")
		})
		expect(calls.some((c) => c.url.includes("txt2img"))).toBe(true)
		expect(out.ignored).toContain("init")
	})

	test("references reach KoboldCPP as extra_images, capped at the sheet's max", async () => {
		const calls = stub()
		const out = await new a1111.Adapter(
			conn({ type: "koboldcpp", model: "flux1-kontext.gguf" })
		).generateImage(
			{ prompt: "p", references: ["a", "b", "c", "d", "e"].map(ref) },
			{ loadMedia }
		)
		const body = calls.find((c) => c.url.includes("txt2img"))!.body
		expect(body.extra_images).toEqual(["a", "b", "c", "d"].map(b64))
		// Four sent, one dropped: both are true, and both are said.
		expect(out.applied).toContain("references")
		expect(out.ignored).toContain("references")
	})

	test("references on a pair whose sheet takes none are reported, not sent", async () => {
		const calls = stub()
		const out = await new a1111.Adapter(conn()).generateImage(
			{ prompt: "p", references: [ref("a")] },
			{ loadMedia }
		)
		const body = calls.find((c) => c.url.includes("txt2img"))!.body
		expect(body.extra_images).toBeUndefined()
		expect(out.ignored).toContain("references")
	})

	test("transparency, a non-PNG format and a bare aspect are reported", async () => {
		stub()
		const out = await new a1111.Adapter(conn()).generateImage({
			prompt: "p",
			transparent: true,
			outputFormat: "webp",
			aspect: "2:3"
		})
		expect(out.ignored).toEqual(
			expect.arrayContaining(["transparent", "outputFormat", "aspect"])
		)
	})

	test("always-on scripts come from the profile, never the request", async () => {
		const calls = stub()
		await new a1111.Adapter(
			conn({
				extraJson: {
					profile: { alwaysonScripts: { controlnet: { args: [] } } }
				}
			})
		).generateImage({ prompt: "p" })
		const body = calls.find((c) => c.url.includes("txt2img"))!.body
		expect(body.alwayson_scripts).toEqual({ controlnet: { args: [] } })
	})
})
