/**
 * `voicebank:preview` (the voice try-out) and the `controls` on
 * `voicebank:pickable`. Handlers are driven directly with a fake socket, as
 * `voicebank.int.test.ts` does; the speech adapter is faked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve(), getCryptoSecretKey: () => "preview-sockets-test-secret" }
})
const pair = vi.hoisted(() => ({ modelId: null as number | null }))
vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/connections/capabilityTarget")>()
	return {
		...real,
		resolveCapabilityTarget: async (_db: unknown, i: any) =>
			i.pipelineConfig.connectionModelId == null
				? { ok: false, problem: { message: "The Narration loadout has no model yet.", connection: null } }
				: {
						ok: true,
						connection: { id: 1, name: "Fake TTS", type: "openai-compatible", model: "m", connectionModelId: pair.modelId },
						sampling: null
					}
	}
})
vi.mock("$lib/server/connectionAdapters/speech/getSpeechAdapter", () => ({
	getSpeechAdapter: async () => ({
		Adapter: class {
			async synthesizeSpeech(req: any) {
				return {
					isAborted: false,
					applied: [],
					ignored: [],
					spokenAs: { voice: req.voice ?? "v", model: "m", connection: 1 },
					media: [{ kind: "audio", mime: "audio/wav", base64: "UklGRg==" }]
				}
			}
		}
	})
}))

let db: TestDb
let dataDir: string
const MEMBER = { id: 2, username: "reader", isAdmin: false }

async function narration(controls: Record<string, unknown>) {
	const [c] = await db
		.insert(schema.connections)
		.values({ name: "tts", type: CONNECTION_TYPE.OLLAMA, baseUrl: "http://localhost:1", modality: "text-gen" })
		.returning()
	const [m] = await db
		.insert(schema.connectionModels)
		.values({
			connectionId: c!.id,
			model: "m",
			name: "m",
			facts: {
				speech: {
					voices: [{ id: "af_a", name: "af_a", kind: "preset" }],
					voicesFrom: "catalogue",
					controls,
					streams: false,
					formats: ["wav"]
				}
			} as never
		})
		.returning()
	await db.insert(schema.loadouts).values({
		seedKey: "core:loadout/tts@1",
		slug: "tts",
		name: "Narration",
		owner: "core",
		transform: "text->audio",
		connectionId: c!.id,
		connectionModelId: m!.id
	} as never)
	pair.modelId = m!.id
}

async function call(name: "voicebankPreview" | "voicebankPickable", user: any, params: any = {}) {
	const mod = await import("./voicebank")
	const h = mod[name] as { event: string; handler: (s: any, p: any, e: any) => Promise<any> }
	const out: Array<{ event: string; data: any }> = []
	const socket = { user, once: vi.fn(), off: vi.fn() }
	try {
		const res = await h.handler(socket, params, (event: string, data: any) => out.push({ event, data }))
		return { res, out, socket, error: null as string | null }
	} catch (e) {
		const refusal = out.find((o) => o.event === `${h.event}:error`)
		return { res: null, out, socket, error: (refusal?.data?.error ?? (e as Error).message) as string, refusal }
	}
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-preview-sockets-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)
afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})
beforeEach(async () => {
	await db.delete(schema.loadouts)
})

describe("voicebank:preview", () => {
	test("echoes the requestId on the reply and detaches its disconnect listener", async () => {
		await narration({})
		const { res, out, socket } = await call("voicebankPreview", MEMBER, { requestId: "r1", text: "Hi." })
		expect(res.requestId).toBe("r1")
		expect(res.mime).toBe("audio/wav")
		expect(out.find((o) => o.event === "voicebank:preview")?.data.requestId).toBe("r1")
		const on = socket.once.mock.calls[0]
		expect(on[0]).toBe("disconnect")
		expect(socket.off).toHaveBeenCalledWith("disconnect", on[1])
	})

	test("a refusal carries the requestId and the sentence", async () => {
		await narration({})
		const { refusal, error } = await call("voicebankPreview", MEMBER, { requestId: "r2", voiceId: "af_a" })
		expect(refusal!.data.requestId).toBe("r2")
		expect(error).toMatch(/Only an administrator/)
	})

	test("no pair is refused with the request id echoed", async () => {
		const { refusal } = await call("voicebankPreview", MEMBER, { requestId: "r3" })
		expect(refusal!.data.requestId).toBe("r3")
		expect(refusal!.data.error).toBeTruthy()
	})

	test("a missing requestId is refused", async () => {
		await narration({})
		const { error } = await call("voicebankPreview", MEMBER, {})
		expect(error).toBe("The voice try-out needs a request id.")
	})
})

describe("voicebank:pickable controls", () => {
	test("null with no pair", async () => {
		const { res } = await call("voicebankPickable", MEMBER)
		expect(res.controls).toBeNull()
	})

	test("only the keys that are set", async () => {
		await narration({ instruction: "prose", designsVoice: true, speed: { min: 0.5, max: 2 } })
		const { res } = await call("voicebankPickable", MEMBER)
		expect(res.controls).toEqual({ designsVoice: true, instruction: "prose" })
	})
})
