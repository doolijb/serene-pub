/**
 * audio.cpp, run by Serene Pub — the managed speech module. A real local HTTP
 * server stands in for audio.cpp; the process seam and settings are mocked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"

const state = vi.hoisted(() => ({
	port: 0,
	ready: vi.fn(),
	packages: vi.fn(),
	binary: vi.fn(),
	settings: {
		port: 0,
		enabled: true,
		releaseTag: "v1" as string | null,
		binaryVariant: "cpu" as string | null,
		enabledPackageIds: ["kokoro_82m_q8_0"] as string[]
	}
}))

vi.mock("$lib/server/connectionAdapters/audioCppReady", () => ({
	ensureAudioCppReadyUrl: (...a: unknown[]) => state.ready(...a),
	listEnabledAudioCppPackages: (...a: unknown[]) => state.packages(...a)
}))
vi.mock("$lib/server/audiocpp/settings", () => ({
	ensureAudioCppSettings: async () => state.settings
}))
vi.mock("$lib/server/audiocpp/binary", () => ({
	audioCppBinaryPath: (...a: unknown[]) => state.binary(...a)
}))
vi.mock("$lib/server/db", () => ({ db: {} }))
vi.mock("$lib/server/utils/tokenCrypto", () => ({
	decryptApiKeyField: (v: unknown) => (typeof v === "string" ? v : null)
}))

import { audiocppManagedSpeech } from "./profiles/audiocpp"
import { modelsFromPackages } from "../AudioCppManagedAdapter"

let server: http.Server
let healthy = true
let speechHits = 0
let speechBody = ""

const wav = Buffer.concat([
	Buffer.from("RIFF"),
	Buffer.alloc(4),
	Buffer.from("WAVEfmt "),
	Buffer.alloc(32)
])

beforeAll(async () => {
	server = http.createServer((req, res) => {
		const url = req.url ?? ""
		if (url.startsWith("/health")) {
			res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" })
			res.end(JSON.stringify({ status: "ok", backend: "cpu", version: "0.9.3", models: 1 }))
		} else if (url.startsWith("/v1/audio/voices")) {
			res.writeHead(200, { "content-type": "application/json" })
			res.end(JSON.stringify({ voices: ["my_clone", "af_heart"] }))
		} else if (url.startsWith("/v1/audio/speech")) {
			speechHits++
			let body = ""
			req.on("data", (c) => (body += c))
			req.on("end", () => {
				speechBody = body
				res.writeHead(200, { "content-type": "audio/wav" })
				res.end(wav)
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
	healthy = true
	speechHits = 0
	speechBody = ""
	state.binary.mockReset()
	state.binary.mockResolvedValue("/opt/audiocpp/audio-server")
	state.settings = {
		port: state.port,
		enabled: true,
		releaseTag: "v1",
		binaryVariant: "cpu",
		enabledPackageIds: ["kokoro_82m_q8_0"]
	}
	state.ready.mockReset()
	state.ready.mockImplementation(async () => ({
		baseUrl: `http://127.0.0.1:${state.port}/`
	}))
	state.packages.mockReset()
})

const conn = (over: Record<string, unknown> = {}) =>
	({
		id: 1,
		type: "audiocpp_managed",
		baseUrl: "http://127.0.0.1:1",
		model: "kokoro_82m_q8_0",
		...over
	}) as any

describe("synthesis", () => {
	test("goes to the ready URL, not the row's, and calls ready once with the signal", async () => {
		const c = conn()
		const adapter = new audiocppManagedSpeech.Adapter(c)
		const ac = new AbortController()
		const r = await adapter.synthesizeSpeech(
			{ text: "Hello there.", voice: "af_heart" } as any,
			{ signal: ac.signal }
		)
		expect(speechHits).toBe(1)
		expect(JSON.parse(speechBody).model).toBe("kokoro_82m_q8_0")
		expect(state.ready).toHaveBeenCalledTimes(1)
		expect(state.ready.mock.calls[0][0].signal).toBe(ac.signal)
		expect(r).toBeTruthy()
	})

	test("no model chosen: a sentence, and ready is never called", async () => {
		const adapter = new audiocppManagedSpeech.Adapter(conn({ model: "" }))
		await expect(
			adapter.synthesizeSpeech({ text: "Hi.", voice: "x" } as any)
		).rejects.toThrow(/No speech model is chosen on audio\.cpp, run by Serene Pub/)
		expect(state.ready).not.toHaveBeenCalled()
	})
})

describe("listModels", () => {
	test("maps tts, vdes and asr packages and touches neither ready nor HTTP", async () => {
		state.packages.mockResolvedValue([
			{ id: "kokoro_82m_q8_0", name: "Kokoro", task: "tts", family: "kokoro" },
			{ id: "qwen3_vd", name: "Qwen3 VD", task: "vdes", family: "qwen3-tts" },
			{ id: "whisper_small", name: "Whisper", task: "asr", family: "whisper" }
		])
		const r = await audiocppManagedSpeech.listModels!(conn())
		expect(r.error).toBeUndefined()
		expect(r.models).toEqual([
			{ id: "kokoro_82m_q8_0", name: "Kokoro", modality: "tts", family: "kokoro" },
			{ id: "qwen3_vd", name: "Qwen3 VD", modality: "tts", family: "qwen3-tts" },
			{
				id: "whisper_small",
				name: "Whisper",
				modality: "asr",
				reads: ["audio"],
				writes: ["text"],
				family: "whisper"
			}
		])
		expect(state.ready).not.toHaveBeenCalled()
		expect(modelsFromPackages([])).toEqual([])
	})

	test("a throwing package list becomes an error and no models", async () => {
		state.packages.mockRejectedValue(new Error("Packages could not be read."))
		expect(await audiocppManagedSpeech.listModels!(conn())).toEqual({
			models: [],
			error: "Packages could not be read."
		})
	})
})

describe("testConnection", () => {
	test("switched off", async () => {
		state.settings.enabled = false
		const r = await audiocppManagedSpeech.testConnection!(conn())
		expect(r.ok).toBe(false)
		expect(r.error).toBe(
			"audio.cpp, run by Serene Pub, is switched off. Switch it on in its Settings."
		)
	})

	test("not downloaded", async () => {
		state.binary.mockResolvedValue(null)
		const r = await audiocppManagedSpeech.testConnection!(conn())
		expect(r.ok).toBe(false)
		expect(r.error).toBe(
			"audio.cpp is not downloaded yet. Choose Download audio.cpp on this connection to set it up."
		)
	})

	test("no package enabled", async () => {
		state.settings.enabledPackageIds = []
		const r = await audiocppManagedSpeech.testConnection!(conn())
		expect(r.ok).toBe(false)
		expect(r.error).toMatch(/^No package is enabled yet\./)
	})

	test("up", async () => {
		const r = await audiocppManagedSpeech.testConnection!(conn())
		expect(r.ok).toBe(true)
		expect(r.extra).toMatchObject({ running: true, backend: "cpu", version: "0.9.3", models: 1 })
		expect(state.ready).not.toHaveBeenCalled()
	})

	test("answers but not ok", async () => {
		healthy = false
		const r = await audiocppManagedSpeech.testConnection!(conn())
		expect(r.ok).toBe(false)
		expect(r.error).toMatch(/HTTP 503/)
	})

	test("down is the normal cold state and is never started", async () => {
		state.settings.port = 1
		const r = await audiocppManagedSpeech.testConnection!(conn())
		expect(r.ok).toBe(true)
		expect(r.extra).toMatchObject({ running: false })
		expect(state.ready).not.toHaveBeenCalled()
	})
})

describe("discoverSpeechFacts", () => {
	test("down: catalogue voices, no ready call", async () => {
		state.settings.port = 1
		const f = (await audiocppManagedSpeech.discoverSpeechFacts!(
			conn(),
			"kokoro_82m_q8_0"
		))!
		expect(f.voicesFrom).toBe("catalogue")
		expect(f.voices.length).toBeGreaterThan(0)
		expect(f.voices.some((v) => v.id === "my_clone")).toBe(false)
		expect(state.ready).not.toHaveBeenCalled()
	})

	test("up: the server's voices are merged first", async () => {
		const f = (await audiocppManagedSpeech.discoverSpeechFacts!(
			conn(),
			"kokoro_82m_q8_0"
		))!
		expect(f.voicesFrom).toBe("discovered")
		expect(f.voices[0].id).toBe("my_clone")
		expect(f.voices.filter((v) => v.id === "af_heart")).toHaveLength(1)
		expect(state.ready).not.toHaveBeenCalled()
	})
})
