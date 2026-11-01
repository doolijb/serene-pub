// Lane V (W3) — the external audio.cpp listing files an ASR id as asr, and the
// managed speech wrapper's answer to audio.cpp's `server_busy`.
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"

const state = vi.hoisted(() => ({ port: 0, ready: vi.fn() }))
vi.mock("$lib/server/connectionAdapters/audioCppReady", () => ({
	ensureAudioCppReadyUrl: (...a: unknown[]) => state.ready(...a),
	listEnabledAudioCppPackages: async () => []
}))
vi.mock("$lib/server/db", () => ({ db: {} }))
vi.mock("$lib/server/utils/tokenCrypto", () => ({
	decryptApiKeyField: (v: unknown) => (typeof v === "string" ? v : null)
}))

import { audiocppProfile, audiocppManagedSpeech } from "./profiles/audiocpp"

const BUSY = JSON.stringify({
	error: {
		message:
			"cannot load model 'parakeet_tdt_q8_0': max_loaded_models=1 and every loaded model is busy; retry later",
		type: "server_busy"
	}
})

let server: http.Server
let speechHits = 0
beforeAll(async () => {
	server = http.createServer((req, res) => {
		const url = req.url ?? ""
		if (url.startsWith("/v1/models")) {
			res.writeHead(200, { "content-type": "application/json" })
			res.end(
				JSON.stringify({
					object: "list",
					data: [{ id: "kokoro_82m_q8_0" }, { id: "parakeet_tdt_q8_0" }]
				})
			)
		} else if (url.startsWith("/v1/audio/speech")) {
			speechHits++
			req.resume()
			req.on("end", () => {
				// Busy once, then audio: the dialect retries (V-5, lead 2026-10-29).
				if (speechHits === 1) {
					res.writeHead(503, { "content-type": "application/json" })
					res.end(BUSY)
					return
				}
				res.writeHead(200, { "content-type": "audio/wav" })
				res.end(Buffer.from("RIFF\0\0\0\0WAVEfmt "))
			})
		} else {
			res.writeHead(404)
			res.end()
		}
	})
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
	state.port = (server.address() as AddressInfo).port
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))
beforeEach(() => {
	speechHits = 0
	state.ready.mockReset()
	state.ready.mockImplementation(async () => ({ baseUrl: `http://127.0.0.1:${state.port}/` }))
})

describe("external audio.cpp listModels", () => {
	test("a parakeet id is filed asr (reads audio, writes text); kokoro is tts", async () => {
		const r = await audiocppProfile.listModels!({
			id: 1,
			type: "audiocpp",
			baseUrl: `http://127.0.0.1:${state.port}`
		} as any)
		expect(r.error).toBeUndefined()
		const by = (id: string) => r.models.find((m: any) => m.id === id) as any
		expect(by("parakeet_tdt_q8_0")).toMatchObject({ modality: "asr", reads: ["audio"], writes: ["text"] })
		expect(by("kokoro_82m_q8_0")).toMatchObject({ modality: "tts" })
		expect(by("kokoro_82m_q8_0").reads).toBeUndefined()
	})
})

describe("managed speech and server_busy", () => {
	test("503 server_busy is retried with backoff; the second answer is the audio", async () => {
		const a = new audiocppManagedSpeech.Adapter({
			id: 1,
			type: "audiocpp_managed",
			baseUrl: "http://127.0.0.1:1",
			model: "kokoro_82m_q8_0"
		} as any)
		const r = await a.synthesizeSpeech({ text: "Hi.", voice: "af_heart" } as any)
		expect(r.media.length).toBe(1)
		expect(speechHits).toBe(2)
	}, 15_000)
})
