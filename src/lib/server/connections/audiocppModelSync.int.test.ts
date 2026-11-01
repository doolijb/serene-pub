/**
 * audio.cpp, run by Serene Pub: the managed connection's rows follow its
 * enabled packages and carry speech facts (S6). Real test DB; the package list
 * is mocked and starting the process fails the test.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

vi.setConfig({ testTimeout: 60_000 })

const state = vi.hoisted(() => ({
	packages: [] as any[],
	listError: null as string | null
}))

vi.mock("$lib/server/connectionAdapters/audioCppReady", () => ({
	ensureAudioCppReadyUrl: async () => {
		throw new Error("ensureAudioCppReadyUrl must never be called by a sync.")
	},
	listEnabledAudioCppPackages: async () => {
		if (state.listError) throw new Error(state.listError)
		return state.packages
	}
}))
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => [],
	isLocalEmbeddingSupported: async () => false
}))
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, getCryptoSecretKey: () => "test-crypto-secret-key" }
})

const KOKORO = { id: "kokoro_82m_q8_0", name: "Kokoro 82M", task: "tts", family: "kokoro_tts" }
const PARAKEET = { id: "parakeet_tdt_0_6b_v3_q8_0", name: "Parakeet TDT 0.6B v3", task: "asr", family: "parakeet_tdt" }
const VDES = {
	id: "qwen3_tts_1_7b_voicedesign_q8_0",
	name: "Qwen3 TTS 1.7B VoiceDesign",
	task: "vdes",
	family: "qwen3_tts",
	variant: "voicedesign"
}

let db: TestDb
let connId: number
let fake: http.Server
let fakePort: number

beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
	fake = http.createServer((req, res) => {
		const url = req.url ?? ""
		res.writeHead(200, { "content-type": "application/json" })
		if (url.startsWith("/health")) res.end(JSON.stringify({ status: "ok" }))
		else if (url.startsWith("/v1/audio/voices"))
			res.end(JSON.stringify({ voices: ["my_clone", "af_heart"] }))
		else res.end("{}")
	})
	await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r))
	fakePort = (fake.address() as AddressInfo).port
	const [c] = await db
		.insert(schema.connections)
		.values({
			name: "audio.cpp",
			type: CONNECTION_TYPE.AUDIOCPP_MANAGED,
			baseUrl: "http://127.0.0.1:1",
			modality: "tts",
			capabilities: {}
		} as any)
		.returning()
	connId = c.id
}, 120_000)
afterAll(() => new Promise<void>((r) => fake.close(() => r())))

async function setPort(port: number) {
	const { ensureAudioCppSettings } = await import("$lib/server/audiocpp/settings")
	const s = await ensureAudioCppSettings(db as any)
	await db.update(schema.audiocppSettings).set({ port }).where(eq(schema.audiocppSettings.id, s.id))
}
const rows = async () =>
	Object.fromEntries(
		(
			await db
				.select()
				.from(schema.connectionModels)
				.where(eq(schema.connectionModels.connectionId, connId))
		).map((r) => [r.model, r])
	)
const sync = async () => {
	const { syncAudioCppManagedModels } = await import("$lib/server/connections/audioCppManagedModels")
	return syncAudioCppManagedModels(db as any)
}

describe("audio.cpp managed model rows", () => {
	it("enabled packages become rows with the right modality; down gives catalogue speech facts", async () => {
		await setPort(1)
		state.packages = [KOKORO, PARAKEET]
		await sync()
		const r = await rows()
		expect(Object.keys(r).sort()).toEqual([KOKORO.id, PARAKEET.id].sort())
		expect(r[KOKORO.id].modality).toBe("tts")
		expect(r[PARAKEET.id].modality).toBe("asr")
		expect(r[PARAKEET.id].reads).toEqual(["audio"])
		expect(r[PARAKEET.id].writes).toEqual(["text"])
		const sp = (r[KOKORO.id].facts as any).speech
		expect(sp.voices.length).toBeGreaterThan(0)
		expect(sp.voicesFrom).toBe("catalogue")
		expect(typeof sp.controls).toBe("object")
		expect(typeof sp.streams).toBe("boolean")
		expect(sp.formats).toEqual(["wav"])
		expect(r[PARAKEET.id].facts ?? {}).not.toHaveProperty("speech")
	})

	it("disabling marks the row missing; re-enabling restores it with its speech facts", async () => {
		state.packages = [PARAKEET]
		await sync()
		let r = await rows()
		expect(r[KOKORO.id].missingSince).not.toBeNull()
		expect(r[PARAKEET.id].missingSince).toBeNull()
		state.packages = [KOKORO, PARAKEET]
		await sync()
		r = await rows()
		expect(r[KOKORO.id].missingSince).toBeNull()
		expect((r[KOKORO.id].facts as any).speech.voicesFrom).toBe("catalogue")
	})

	it("a VoiceDesign package is a tts row", async () => {
		state.packages = [KOKORO, PARAKEET, VDES]
		await sync()
		expect((await rows())[VDES.id].modality).toBe("tts")
	})

	it("process up: refreshSpeechFacts merges the discovered voices", async () => {
		await setPort(fakePort)
		const { refreshSpeechFacts } = await import("$lib/server/connectionAdapters/speech/speechFactsStore")
		await refreshSpeechFacts(db as any, connId)
		const sp = ((await rows())[KOKORO.id].facts as any).speech
		expect(sp.voicesFrom).toBe("discovered")
		const names = sp.voices.map((v: any) => v.id ?? v.name)
		expect(names.slice(0, 2)).toEqual(["my_clone", "af_heart"])
		await setPort(1)
	})

	it("a package list that throws records the error and touches no row", async () => {
		const before = await rows()
		state.listError = "audio.cpp, run by Serene Pub is not set up yet."
		await sync()
		state.listError = null
		const [c] = await db.select().from(schema.connections).where(eq(schema.connections.id, connId))
		expect((c as any).modelsSyncError).toBe("audio.cpp, run by Serene Pub is not set up yet.")
		const after = await rows()
		expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
		for (const k of Object.keys(before)) expect(after[k].missingSince).toEqual(before[k].missingSince)
	})
})
