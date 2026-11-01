/**
 * What `dispatchSpeech` stores and records (speech build lane D + follow-up ★3;
 * verified by lane V): the spoken file belongs to the SESSION OWNER and carries
 * `meta.spoken` and the transcript; the S6 `template` is the node slot's id when
 * the session's is unset and the session's when explicitly set. The connection,
 * adapter and voice resolver are stubbed; the DB, the media store, grouping,
 * rendering and joining are real.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { eq } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"
import { SPOKEN_LINE_TEMPLATE_IDS } from "@serene-pub/core-catalog"

// DB setup and the first media write are slow under load.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const synth = vi.hoisted(() => vi.fn())
const resolveSpy = vi.hoisted(() => vi.fn())

function wav(seed: number): Buffer {
	const samples = 80
	const data = Buffer.alloc(samples * 2)
	for (let i = 0; i < samples; i++) data.writeInt16LE(((i * 37 + seed * 101) % 2000) - 1000, i * 2)
	const h = Buffer.alloc(44)
	h.write("RIFF", 0)
	h.writeUInt32LE(36 + data.length, 4)
	h.write("WAVEfmt ", 8)
	h.writeUInt32LE(16, 16)
	h.writeUInt16LE(1, 20)
	h.writeUInt16LE(1, 22)
	h.writeUInt32LE(8000, 24)
	h.writeUInt32LE(16000, 28)
	h.writeUInt16LE(2, 32)
	h.writeUInt16LE(16, 34)
	h.write("data", 36)
	h.writeUInt32LE(data.length, 40)
	return Buffer.concat([h, data])
}

vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/connections/capabilityTarget")>()
	return {
		...real,
		resolveCapabilityTarget: async () => ({
			ok: true,
			connection: { id: 1, name: "Fake TTS", type: "openai-compatible", model: "tts-1", connectionModelId: null },
			sampling: null
		})
	}
})
vi.mock("$lib/server/connectionAdapters/speech/getSpeechAdapter", () => ({
	getSpeechAdapter: async () => ({
		Adapter: class {
			async synthesizeSpeech(req: any) {
				synth(req)
				return {
					isAborted: false,
					applied: ["voice"],
					ignored: [],
					spokenAs: { voice: req.voice ?? "v", model: "tts-1" },
					media: [{ kind: "audio", mime: "audio/wav", base64: wav(synth.mock.calls.length).toString("base64") }]
				}
			}
		}
	})
}))
vi.mock("$lib/server/speech/resolveVoice", () => ({
	speakerSilent: async () => false,
	resolveVoice: async (input: unknown) => ({
		...(resolveSpy(input), {}),
		ok: true,
		voiceId: "voice-a",
		language: "en",
		settings: null,
		description: null,
		skipped: [],
		from: "default"
	}),
	sessionSpeechSetting: async () => null
}))

let db: TestDb
let dataDir: string
let ownerId: number
let runnerId: number

async function makeSession(genreFields: Record<string, unknown> | null) {
	const [s] = await db
		.insert(schema.sessions)
		.values({ userId: ownerId, isGroup: false, ...(genreFields ? { genreFields } : {}) } as any)
		.returning()
	return s!.id
}

const speak = async (sessionId: number | null, extra: Record<string, unknown> = {}) => {
	const { dispatchSpeech } = await import("./dispatchSpeech")
	return dispatchSpeech(db, {
		text: 'She said "Hello there".',
		sessionId,
		userId: runnerId,
		...extra
	} as any)
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-speakstore-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = await createTestDb()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
	ownerId = (await db.insert(schema.users).values({ username: "spk-owner", isAdmin: false }).returning())[0]!.id
	// A different person runs the pipeline (e.g. an admin pressing Read aloud).
	runnerId = (await db.insert(schema.users).values({ username: "spk-runner", isAdmin: false }).returning())[0]!.id
}, 120_000)

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("dispatchSpeech cue kind reaches the resolver", () => {
	it("a mixed dialogue + narration line passes cueVoice per group and the line speaker to the narration", async () => {
		resolveSpy.mockClear()
		const sid = await makeSession(null)
		await speak(sid, {
			speaker: "envoy:oracle",
			cues: [
				{ text: "She said", kind: "narration", voice: "narrator" },
				{ text: "Hello there", kind: "dialogue", voice: "speaker" }
			]
		})
		const calls = resolveSpy.mock.calls.map((c) => c[0] as any)
		expect(calls.map((c) => [c.cueVoice, c.speakerRef])).toEqual([
			["narrator", "envoy:oracle"],
			["speaker", "envoy:oracle"]
		])
	})
	it("plain narration passes no speaker", async () => {
		resolveSpy.mockClear()
		const sid = await makeSession(null)
		await speak(sid, { cues: [{ text: "Rain fell.", kind: "narration", voice: "narrator" }] })
		const c = resolveSpy.mock.calls[0]![0] as any
		expect([c.cueVoice, c.speakerRef]).toEqual(["narrator", null])
	})
})

describe("dispatchSpeech storage", () => {
	it("the spoken file carries user_id = the session owner, meta.spoken = true, and the spoken words as transcript", async () => {
		const sid = await makeSession(null)
		const res = await speak(sid)
		expect(res.audio).toBeTruthy()
		const [file] = await db.select().from(schema.files).where(eq(schema.files.uuid, res.audio!.uuid))
		expect(file!.userId).toBe(ownerId)
		expect(file!.userId).not.toBe(runnerId)
		expect((file!.meta as any).spoken).toBe(true)
		expect(file!.sessionId).toBe(sid)
		expect(file!.transcript).toBeTruthy()
		expect(file!.transcript).toContain("Hello there")
	})

	it("with no session the file falls to the running user", async () => {
		const res = await speak(null)
		const [file] = await db.select().from(schema.files).where(eq(schema.files.uuid, res.audio!.uuid))
		expect(file!.userId).toBe(runnerId)
		expect((file!.meta as any).spoken).toBe(true)
	})

	it("S6 meta has spokenAs, cueMap, inflection, template and an ISO `at`", async () => {
		const res = await speak(await makeSession(null))
		expect(res.meta).toMatchObject({
			spokenAs: { voice: "voice-a", model: "tts-1", voiceFrom: expect.any(String) },
			cueMap: { source: expect.any(String) },
			inflection: null
		})
		expect(new Date(res.meta!.at).toISOString()).toBe(res.meta!.at)
	})

	it("template: the node slot's id when the session's is unset", async () => {
		const res = await speak(await makeSession(null), { template: SPOKEN_LINE_TEMPLATE_IDS.dialogue })
		expect(res.meta!.template).toBe(SPOKEN_LINE_TEMPLATE_IDS.dialogue)
	})

	it("template: the session's when explicitly set, over the node slot's", async () => {
		const sid = await makeSession({ speechTemplate: SPOKEN_LINE_TEMPLATE_IDS.dialogue })
		// (the text alias is one dialogue cue, so a dialogue template leaves words to speak)
		const res = await speak(sid, { template: SPOKEN_LINE_TEMPLATE_IDS.whole })
		expect(res.meta!.template).toBe(SPOKEN_LINE_TEMPLATE_IDS.dialogue)
	})

	it("template: unset everywhere records the shipped Whole line", async () => {
		const res = await speak(await makeSession(null))
		expect(res.meta!.template).toBe(SPOKEN_LINE_TEMPLATE_IDS.whole)
	})

	it("identical bytes from two readings are one files row (dedupe) with one owner", async () => {
		const { storeGeneratedMedia } = await import("$lib/server/media/generatedMedia")
		const item = { kind: "audio", mime: "audio/wav", base64: wav(999).toString("base64"), meta: { spoken: true } } as any
		const sid = await makeSession(null)
		const [a] = await storeGeneratedMedia(db, [item], { userId: ownerId, sessionId: sid })
		const [b] = await storeGeneratedMedia(db, [item], { userId: ownerId, sessionId: sid })
		expect(b!.uuid).toBe(a!.uuid)
		const rows = await db.select().from(schema.files).where(eq(schema.files.uuid, a!.uuid))
		expect(rows).toHaveLength(1)
	})
})
