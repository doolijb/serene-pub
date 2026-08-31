import { afterEach, describe, expect, test, vi } from "vitest"
import fooocus from "./FooocusAdapter"

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

/** Stub global fetch; return `body` as JSON with the given ok/status. */
function stubFetch(body: unknown, init: { ok?: boolean; status?: number } = {}) {
	const calls: Array<{ url: string; init?: RequestInit }> = []
	const fn = vi.fn(async (url: string, i?: RequestInit) => {
		calls.push({ url, init: i })
		return {
			ok: init.ok ?? true,
			status: init.status ?? 200,
			json: async () => body,
			text: async () => JSON.stringify(body)
		} as unknown as Response
	})
	vi.stubGlobal("fetch", fn)
	return calls
}

afterEach(() => vi.unstubAllGlobals())

describe("FooocusAdapter.generate", () => {
	test("maps generic params onto Fooocus's native body", async () => {
		const calls = stubFetch([{ base64: "AAAA", seed: "42", finish_reason: "SUCCESS" }])
		const a = new fooocus.Adapter(conn({ model: "juggernautXL.safetensors" }))
		const out = await a.generate({
			prompt: "a knight",
			negativePrompt: "blurry",
			cfg: 7,
			width: 832,
			height: 1216,
			seed: 42,
			batch: 2,
			extra: { performance: "Quality", styles: ["Fooocus V2", "SAI Anime"], sharpness: 3 }
		})

		expect(calls[0].url).toBe(
			"http://localhost:8888/v1/generation/text-to-image"
		)
		const body = JSON.parse((calls[0].init!.body as string) as string)
		expect(body.prompt).toBe("a knight")
		expect(body.negative_prompt).toBe("blurry")
		expect(body.guidance_scale).toBe(7) // cfg → guidance_scale
		expect(body.image_number).toBe(2) // batch → image_number
		expect(body.image_seed).toBe(42)
		expect(body.aspect_ratios_selection).toBe("832*1216") // w/h → "W*H"
		expect(body.performance_selection).toBe("Quality")
		expect(body.style_selections).toEqual(["Fooocus V2", "SAI Anime"])
		expect(body.sharpness).toBe(3)
		expect(body.base_model_name).toBe("juggernautXL.safetensors")
		expect(body.require_base64).toBe(true)
		expect(body.async_process).toBe(false)

		expect(out.isAborted).toBe(false)
		expect(out.images).toHaveLength(1)
		expect(out.images[0]).toMatchObject({ base64: "AAAA", mime: "image/png", seed: "42" })
	})

	test("falls back to Fooocus defaults and omits base_model_name when unset", async () => {
		const calls = stubFetch([{ base64: "BBBB" }])
		await new fooocus.Adapter(conn()).generate({ prompt: "sunset" })
		const body = JSON.parse(calls[0].init!.body as string)
		expect(body.performance_selection).toBe("Speed")
		expect(body.style_selections).toEqual(["Fooocus V2"])
		expect(body.aspect_ratios_selection).toBe("1152*896")
		expect(body.guidance_scale).toBe(4)
		expect(body.image_number).toBe(1)
		expect(body.image_seed).toBe(-1)
		expect("base_model_name" in body).toBe(false)
	})

	test("drops results without a base64 payload", async () => {
		stubFetch([{ base64: "OK" }, { url: "http://x/y.png", base64: null }])
		const out = await new fooocus.Adapter(conn()).generate({ prompt: "x" })
		expect(out.images.map((i) => i.base64)).toEqual(["OK"])
	})

	test("throws with the server's message on a non-2xx", async () => {
		stubFetch({ detail: "no model loaded" }, { ok: false, status: 500 })
		await expect(
			new fooocus.Adapter(conn()).generate({ prompt: "x" })
		).rejects.toThrow(/Fooocus generation failed \(500\)/)
	})

	test("passes the X-API-KEY header when configured", async () => {
		const calls = stubFetch([{ base64: "OK" }])
		await new fooocus.Adapter(conn({ extraJson: { apiKey: "secret" } })).generate({
			prompt: "x"
		})
		expect((calls[0].init!.headers as any)["X-API-KEY"]).toBe("secret")
	})
})

describe("FooocusAdapter.testConnection / listModels", () => {
	test("testConnection ok on 200", async () => {
		stubFetch({ model_filenames: [] })
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
		stubFetch({ model_filenames: ["a.safetensors", "b.gguf"], lora_filenames: [] })
		expect(await fooocus.listModels(conn())).toEqual({
			models: ["a.safetensors", "b.gguf"]
		})
	})
})
