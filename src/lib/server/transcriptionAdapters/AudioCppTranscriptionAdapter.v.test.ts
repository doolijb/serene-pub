// Lane V (W3) — audio.cpp's `server_busy` answer to a transcription call.
import { afterAll, describe, expect, test, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"

vi.mock("$lib/server/connectionAdapters/audioCppReady", () => ({
	ensureAudioCppReadyUrl: async () => ({ baseUrl: "" })
}))
const { AudioCppTranscriptionAdapter } = await import("./AudioCppTranscriptionAdapter")

let hits = 0
const server = http.createServer((req, res) => {
	hits++
	req.resume()
	req.on("end", () => {
		// Busy once, then free: the adapter retries with backoff (V-5 fixed by
		// the lead, 2026-10-29) instead of surfacing the first 503.
		if (hits === 1) {
			res.writeHead(503, { "content-type": "application/json" })
			res.end(
				JSON.stringify({
					error: {
						message:
							"cannot load model 'parakeet_tdt_q8_0': max_loaded_models=1 and every loaded model is busy; retry later",
						type: "server_busy"
					}
				})
			)
			return
		}
		res.writeHead(200, { "content-type": "application/json" })
		res.end(JSON.stringify({ text: "after the wait", timing: { wall_ms: 1 } }))
	})
})
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
afterAll(() => new Promise<void>((r) => server.close(() => r())))

describe("server_busy", () => {
	test("503 server_busy is retried with backoff; the second answer is returned", async () => {
		const a = new AudioCppTranscriptionAdapter({ id: 1, type: "audiocpp", baseUrl: root, model: "parakeet_tdt_q8_0" } as any)
		const r = await a.transcribeAudio({ audio: { bytes: Buffer.from("RIFF"), mime: "audio/wav", filename: "n.wav" } } as any)
		expect(r.text).toBe("after the wait")
		expect(hits).toBe(2)
	}, 15_000)
})
