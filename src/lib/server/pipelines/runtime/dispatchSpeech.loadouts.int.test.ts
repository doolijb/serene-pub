/**
 * Voice loadouts: `dispatchSpeech` resolves the target PER GROUP. A line whose
 * narration and dialogue voices live on two loadouts (two fake models at two
 * sample rates) is spoken on each, joined into one 24 kHz WAV, and the receipt
 * says so. Connections, adapters and voice resolution are stubbed; the DB,
 * grouping, rendering and joining are real.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import * as schema from "$lib/server/db/schema"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const fake = vi.hoisted(() => ({
	calls: [] as Array<{ model: string; req: any }>,
	built: [] as string[],
	/** model name -> format listing */
	formats: {} as Record<string, string[] | null>
}))

/** 1 s of silence at `rate`, mono int16. */
function wav(rate: number): Buffer {
	const data = Buffer.alloc(rate * 2)
	const h = Buffer.alloc(44)
	h.write("RIFF", 0)
	h.writeUInt32LE(36 + data.length, 4)
	h.write("WAVEfmt ", 8)
	h.writeUInt32LE(16, 16)
	h.writeUInt16LE(1, 20)
	h.writeUInt16LE(1, 22)
	h.writeUInt32LE(rate, 24)
	h.writeUInt32LE(rate * 2, 28)
	h.writeUInt16LE(2, 32)
	h.writeUInt16LE(16, 34)
	h.write("data", 36)
	h.writeUInt32LE(data.length, 40)
	return Buffer.concat([h, data])
}
const RATES: Record<string, number> = { "model-a": 24000, "model-b": 22050 }

vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/connections/capabilityTarget")>()
	return {
		...real,
		resolveCapabilityTarget: async (_db: unknown, i: any) => {
			const id = i.pipelineConfig.connectionModelId as number
			return {
				ok: true,
				connection: { id, name: `Conn ${id}`, type: "openai-compatible", model: id === 100 ? "model-a" : "model-b", connectionModelId: null },
				sampling: null
			}
		}
	}
})
vi.mock("$lib/server/speech/voicebank", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/speech/voicebank")>()
	const row = (loadoutId: number, modelId: number) => ({
		loadoutId,
		name: `Loadout ${loadoutId}`,
		connectionId: modelId,
		connectionModelId: modelId,
		samplingConfigId: null,
		filled: true
	})
	return {
		...real,
		speakingLoadout: async () => row(1, 100),
		entryLoadout: async (_db: unknown, id: number) => (id === 1 ? row(1, 100) : id === 2 ? row(2, 200) : null),
		voicebankBySlug: async () => null
	}
})
vi.mock("$lib/server/connectionAdapters/speech/getSpeechAdapter", () => ({
	getSpeechAdapter: async () => ({
		Adapter: class {
			constructor(private c: any) {
				fake.built.push(c.model)
			}
			async synthesizeSpeech(req: any) {
				fake.calls.push({ model: this.c.model, req })
				return {
					isAborted: false,
					applied: [],
					ignored: [],
					spokenAs: { voice: req.voice ?? "v", model: this.c.model },
					media: [{ kind: "audio", mime: "audio/wav", base64: wav(RATES[this.c.model]!).toString("base64"), durationMs: 1000 }]
				}
			}
		}
	})
}))
vi.mock("$lib/server/speech/resolveVoice", () => ({
	speakerSilent: async () => false,
	resolveVoice: async (input: any) => ({
		ok: true,
		connectionModelId: 1,
		loadoutId: input.cueVoice === "narrator" ? 2 : null,
		voiceId: input.cueVoice === "narrator" ? "nar" : "spk",
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

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-speakloadouts-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = await createTestDb()
	const { bootstrapPipelines } = await import("$lib/server/pipelines/boot/bootstrap")
	await bootstrapPipelines(db)
}, 120_000)
afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

describe("dispatchSpeech: a target per group", () => {
	it("speaks each group on its voice's loadout and joins the rates into one WAV", async () => {
		fake.calls.length = 0
		fake.built.length = 0
		const { dispatchSpeech } = await import("./dispatchSpeech")
		const res = await dispatchSpeech(db, {
			cues: [
				{ text: "Hello there", kind: "dialogue", voice: "speaker" },
				{ text: "she said", kind: "narration", voice: "narrator" }
			]
		} as any)
		expect(fake.calls.map((c) => [c.model, c.req.voice, c.req.format])).toEqual([
			["model-a", "spk", "wav"],
			["model-b", "nar", "wav"]
		])
		// one adapter per target
		expect(fake.built.sort()).toEqual(["model-a", "model-b"])
		expect(res.plan!.groups.map((g) => g.connection!.model)).toEqual(["model-a", "model-b"])
		expect(res.plan!.connection!.model).toBe("model-a")
		expect(res.notes).toContain("spoken on two models: model-a, then model-b")
		expect(res.notes).toContain("resampled 1 part to 24000 Hz")
		expect(res.plan!.joined).toBe("concatenated")
		expect(res.cueMap.source).toBe("concatenated")
		const spans = res.cueMap.spans
		expect(spans[0]!.endMs).toBeLessThanOrEqual(1001)
		expect(spans[1]!.startMs).toBe(1200)
		expect(res.audio).toBeTruthy()
	})

	it("one model for every group builds one target and says nothing about models", async () => {
		fake.calls.length = 0
		fake.built.length = 0
		const { dispatchSpeech } = await import("./dispatchSpeech")
		const res = await dispatchSpeech(db, {
			cues: [
				{ text: "One.", kind: "dialogue", voice: "speaker" },
				{ text: "Two.", kind: "dialogue", voice: "speaker", inflection: "calm" }
			]
		} as any)
		expect(fake.built).toEqual(["model-a"])
		expect(res.notes.some((n) => n.startsWith("spoken on"))).toBe(false)
	})
})
