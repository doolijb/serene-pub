/**
 * 🚧 audio.cpp transcription — the multipart request and the answer, against a
 * real fake server on 127.0.0.1. The managed type's ready call is mocked.
 */
import { afterAll, beforeEach, describe, expect, test, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"

const ensureMock = vi.fn()
vi.mock("$lib/server/connectionAdapters/audioCppReady", () => ({
	ensureAudioCppReadyUrl: (...a: unknown[]) => ensureMock(...a)
}))

const { AudioCppTranscriptionAdapter, AudioCppManagedTranscriptionAdapter, AUDIOCPP_MAX_UPLOAD_BYTES } =
	await import("./AudioCppTranscriptionAdapter")

type Seen = { url: string; method: string; form: FormData }
let seen: Seen[] = []
let reply: { status: number; body: string } = { status: 200, body: "{}" }

const server = http.createServer((req, res) => {
	const chunks: Buffer[] = []
	req.on("data", (c) => chunks.push(c))
	req.on("end", async () => {
		const form = await new Response(Buffer.concat(chunks), {
			headers: { "content-type": req.headers["content-type"] ?? "" }
		}).formData()
		seen.push({ url: req.url ?? "", method: req.method ?? "", form })
		res.statusCode = reply.status
		res.setHeader("content-type", "application/json")
		res.end(reply.body)
	})
})
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
afterAll(() => new Promise<void>((r) => server.close(() => r())))

beforeEach(() => {
	seen = []
	reply = { status: 200, body: JSON.stringify({ text: "  Meet me at noon. ", timing: { total: 1 } }) }
	ensureMock.mockReset()
	ensureMock.mockResolvedValue({ baseUrl: root })
})

const conn = (over: Record<string, unknown> = {}) =>
	({ id: 1, type: "audiocpp", baseUrl: root, model: "whisper-small", ...over }) as any
const req = (over: Record<string, unknown> = {}) => ({
	audio: { bytes: Buffer.from("RIFF fake wav"), mime: "audio/wav", filename: "note.wav" },
	...over
})

describe("AudioCppTranscriptionAdapter", () => {
	test("posts multipart file + model to /v1/audio/transcriptions and maps the reply", async () => {
		const out = await new AudioCppTranscriptionAdapter(conn()).transcribeAudio(req())
		expect(out).toMatchObject({ text: "Meet me at noon.", isAborted: false })
		expect((out.raw as any).timing).toEqual({ total: 1 })
		expect(seen).toHaveLength(1)
		expect(seen[0]!.method).toBe("POST")
		expect(seen[0]!.url).toBe("/v1/audio/transcriptions")
		const file = seen[0]!.form.get("file") as File
		expect(file.name).toBe("note.wav")
		expect(file.type).toBe("audio/wav")
		expect(Buffer.from(await file.arrayBuffer()).toString()).toBe("RIFF fake wav")
		expect(seen[0]!.form.get("model")).toBe("whisper-small")
		expect([...seen[0]!.form.keys()].sort()).toEqual(["file", "model"])
	})

	test("language is sent only when given; unnamed files get an extension", async () => {
		await new AudioCppTranscriptionAdapter(conn()).transcribeAudio(
			req({ language: "en", audio: { bytes: Buffer.from("x"), mime: "audio/mpeg" } })
		)
		expect(seen[0]!.form.get("language")).toBe("en")
		expect((seen[0]!.form.get("file") as File).name).toBe("audio.mp3")
	})

	test("a /v1 suffix on the row's base URL is tolerated", async () => {
		await new AudioCppTranscriptionAdapter(conn({ baseUrl: `${root}/v1/` })).transcribeAudio(req())
		expect(seen[0]!.url).toBe("/v1/audio/transcriptions")
	})

	test("an error reply becomes a sentence with the status and the server's words", async () => {
		reply = { status: 400, body: JSON.stringify({ error: { message: "unknown model 'x'" } }) }
		await expect(new AudioCppTranscriptionAdapter(conn()).transcribeAudio(req())).rejects.toThrow(
			"audio.cpp could not transcribe the recording (HTTP 400): unknown model 'x'"
		)
	})

	test("no model: a sentence, and no request", async () => {
		await expect(
			new AudioCppTranscriptionAdapter(conn({ model: " " })).transcribeAudio(req())
		).rejects.toThrow(/No transcription model is chosen on this audio\.cpp connection/)
		expect(seen).toHaveLength(0)
	})

	test("over 25 MB: a sentence, and no request", async () => {
		const big = { audio: { bytes: Buffer.alloc(AUDIOCPP_MAX_UPLOAD_BYTES + 1), mime: "audio/wav" } }
		await expect(new AudioCppTranscriptionAdapter(conn()).transcribeAudio(big)).rejects.toThrow(/25 MB/)
		expect(seen).toHaveLength(0)
	})

	test("an already-aborted signal answers aborted without a request", async () => {
		const ac = new AbortController()
		ac.abort()
		const out = await new AudioCppTranscriptionAdapter(conn()).transcribeAudio(req(), { signal: ac.signal })
		expect(out).toEqual({ text: "", isAborted: true })
		expect(seen).toHaveLength(0)
	})

	test("a server that is not there is a sentence", async () => {
		await expect(
			new AudioCppTranscriptionAdapter(conn({ baseUrl: "http://127.0.0.1:1" })).transcribeAudio(req())
		).rejects.toThrow(/did not reach audio\.cpp/)
	})
})

describe("AudioCppManagedTranscriptionAdapter", () => {
	test("asks the ready call once, with the signal, and uses its address", async () => {
		const ac = new AbortController()
		const out = await new AudioCppManagedTranscriptionAdapter(
			conn({ type: "audiocpp_managed", baseUrl: "http://ignored.invalid" })
		).transcribeAudio(req(), { signal: ac.signal })
		expect(out.text).toBe("Meet me at noon.")
		expect(ensureMock).toHaveBeenCalledTimes(1)
		expect(ensureMock).toHaveBeenCalledWith({ signal: ac.signal })
		expect(seen).toHaveLength(1)
	})

	test("refusals never start the process", async () => {
		await expect(
			new AudioCppManagedTranscriptionAdapter(conn({ model: null })).transcribeAudio(req())
		).rejects.toThrow("No transcription model is chosen on audio.cpp, run by Serene Pub.")
		const big = { audio: { bytes: Buffer.alloc(AUDIOCPP_MAX_UPLOAD_BYTES + 1), mime: "audio/wav" } }
		await expect(new AudioCppManagedTranscriptionAdapter(conn()).transcribeAudio(big)).rejects.toThrow(/25 MB/)
		expect(ensureMock).not.toHaveBeenCalled()
	})
})
