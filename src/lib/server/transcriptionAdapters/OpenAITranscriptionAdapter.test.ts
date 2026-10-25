/**
 * 🚧 OpenAI-compatible `/audio/transcriptions` (O9) — the request mapping and
 * the answer, against a recorded response shape. No real provider is called.
 */
import { afterEach, describe, expect, test, vi } from "vitest"

vi.mock("$lib/server/utils/tokenCrypto", () => ({
	decryptApiKeyField: (v: unknown) => (typeof v === "string" ? v : null)
}))

const mod = await import("./OpenAITranscriptionAdapter")
const { OpenAITranscriptionAdapter, openAITranscriptionsUrl, transcriptionForm } = mod

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)
afterEach(() => fetchMock.mockReset())

const connection = (over: Record<string, unknown> = {}) =>
	({
		id: 1,
		type: "openai",
		baseUrl: "https://api.example.com/v1/",
		model: "whisper-1",
		extraJson: { apiKey: "sk-test" },
		...over
	}) as any

const req = {
	audio: { bytes: Buffer.from("RIFF fake wav"), mime: "audio/wav", filename: "note.wav" },
	language: "en"
}

describe("OpenAITranscriptionAdapter", () => {
	test("the route goes after the base URL, as the chat client's does", () => {
		expect(openAITranscriptionsUrl("https://api.example.com/v1/")).toBe(
			"https://api.example.com/v1/audio/transcriptions"
		)
	})

	test("the form carries the file under its name, the model, json, and the hints", async () => {
		const form = transcriptionForm(req, "whisper-1")
		const file = form.get("file") as File
		expect(file.name).toBe("note.wav")
		expect(file.type).toBe("audio/wav")
		expect(Buffer.from(await file.arrayBuffer()).toString()).toBe("RIFF fake wav")
		expect(form.get("model")).toBe("whisper-1")
		expect(form.get("response_format")).toBe("json")
		expect(form.get("language")).toBe("en")
		expect(form.get("prompt")).toBeNull()
		// A file with no usable name is named by its format's extension.
		const unnamed = transcriptionForm({ audio: { bytes: Buffer.from("x"), mime: "audio/mpeg" } }, "m")
		expect((unnamed.get("file") as File).name).toBe("audio.mp3")
	})

	test("posts with the bearer key and reads the words back", async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: "  Meet me at noon. " }), { status: 200 }))
		const out = await new OpenAITranscriptionAdapter(connection()).transcribeAudio(req)
		expect(out).toMatchObject({ text: "Meet me at noon.", isAborted: false })
		const [url, init] = fetchMock.mock.calls[0]!
		expect(url).toBe("https://api.example.com/v1/audio/transcriptions")
		expect(init.method).toBe("POST")
		expect(init.headers).toEqual({ Authorization: "Bearer sk-test" })
		expect(init.body).toBeInstanceOf(FormData)
	})

	test("a connection naming no model hears with whisper-1; no key sends no header", async () => {
		fetchMock.mockResolvedValue(new Response(JSON.stringify({ text: "hi" }), { status: 200 }))
		await new OpenAITranscriptionAdapter(connection({ model: null, extraJson: {} })).transcribeAudio(req)
		const [, init] = fetchMock.mock.calls[0]!
		expect(init.headers).toEqual({})
		expect((init.body as FormData).get("model")).toBe("whisper-1")
	})

	test("a refusal is an error carrying the service's own words", async () => {
		fetchMock.mockResolvedValue(new Response("model not found", { status: 404 }))
		await expect(new OpenAITranscriptionAdapter(connection()).transcribeAudio(req)).rejects.toThrow(
			/failed \(404\): model not found/
		)
	})
})
