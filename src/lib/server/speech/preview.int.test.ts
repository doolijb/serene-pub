/**
 * The voice try-out seam (`previewVoice`): one call per line, the speak path's
 * seed / direction / note rules, member limits, one try per person, timeout.
 * Real DB, real loadout + model rows and real `resolveVoice`; only the speech
 * adapter is faked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"
import { VOICE_TRYOUT_SAMPLE_LINE } from "$lib/shared/speech/voiceTryout"
import { stableVoiceSeed } from "./voiceSeed"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve(), getCryptoSecretKey: () => "preview-test-secret" }
})

const fake = vi.hoisted(() => ({
	synth: undefined as undefined | ((req: any, opts: any) => Promise<any>),
	calls: [] as any[],
	targets: [] as any[]
}))
const pair = vi.hoisted(() => ({ modelId: null as number | null }))
vi.mock("$lib/server/connections/capabilityTarget", async (importOriginal) => {
	const real = await importOriginal<typeof import("$lib/server/connections/capabilityTarget")>()
	return {
		...real,
		resolveCapabilityTarget: async (_db: unknown, i: any) =>
			(fake.targets.push(i.pipelineConfig), i.pipelineConfig.connectionModelId == null)
				? { ok: false, problem: { message: "The Narration loadout has no model yet.", connection: null } }
				: {
						ok: true,
						connection: { id: 1, name: "Fake TTS", type: "openai-compatible", model: "m", connectionModelId: i.pipelineConfig.connectionModelId },
						sampling: null
					}
	}
})
vi.mock("$lib/server/connectionAdapters/speech/getSpeechAdapter", () => ({
	getSpeechAdapter: async () => ({
		Adapter: class {
			async synthesizeSpeech(req: any, opts: any) {
				fake.calls.push(req)
				if (fake.synth) return fake.synth(req, opts)
				return {
					isAborted: false,
					applied: ["voice"],
					ignored: [],
					spokenAs: { voice: req.voice ?? "v", model: "m", connection: 1 },
					media: [{ kind: "audio", mime: "audio/wav", base64: "UklGRg==", durationMs: 100 }]
				}
			}
		}
	})
}))

let db: TestDb
let dataDir: string
let n = 0

const ADMIN = { id: 1, isAdmin: true }
const MEMBER = { id: 2, isAdmin: false }

const facts = (controls: Record<string, unknown>) => ({
	speech: {
		voices: [{ id: "af_a", name: "af_a", kind: "preset" }],
		voicesFrom: "catalogue",
		controls,
		streams: false,
		formats: ["wav"]
	}
})

async function narration(controls: Record<string, unknown>) {
	const [c] = await db
		.insert(schema.connections)
		.values({ name: `tts ${++n}`, type: CONNECTION_TYPE.OLLAMA, baseUrl: "http://localhost:1", modality: "text-gen" })
		.returning()
	const [m] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: c!.id, model: `m-${n}`, name: `m-${n}`, facts: facts(controls) as never })
		.returning()
	await db.insert(schema.loadouts).values({
		seedKey: "core:loadout/tts@1",
		slug: `tts-${n}`,
		name: "Narration",
		owner: "core",
		transform: "text->audio",
		connectionId: c!.id,
		connectionModelId: m!.id
	} as never)
	pair.modelId = m!.id
	return m!
}

/** A second, non-default speech loadout on its own model. */
async function otherLoadout(transform = "text->audio", filled = true) {
	const [c] = await db
		.insert(schema.connections)
		.values({ name: `tts ${++n}`, type: CONNECTION_TYPE.OLLAMA, baseUrl: "http://localhost:2", modality: "text-gen" })
		.returning()
	const [m] = await db
		.insert(schema.connectionModels)
		.values({ connectionId: c!.id, model: `m-${n}`, name: `m-${n}`, facts: facts({}) as never })
		.returning()
	const [l] = await db
		.insert(schema.loadouts)
		.values({
			slug: `other-${n}`,
			name: `Other ${n}`,
			owner: "user",
			transform,
			...(filled ? { connectionId: c!.id, connectionModelId: m!.id } : {})
		} as never)
		.returning()
	return { loadout: l!, model: m! }
}

const preview = async (user: any, input: unknown, opts?: any) => {
	const { previewVoice } = await import("./preview")
	return previewVoice(db as never, user, input, opts)
}
const refusal = async (p: Promise<unknown>) => {
	try {
		await p
	} catch (e) {
		return (e as Error).message
	}
	return null
}

beforeAll(async () => {
	dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "serene-pub-vitest-preview-"))
	process.env.SERENE_PUB_DATA_DIR = dataDir
	db = (await import("$lib/server/db")).db as unknown as TestDb
}, 60_000)
afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})
beforeEach(async () => {
	fake.calls.length = 0
	fake.targets.length = 0
	fake.synth = undefined
	await db.delete(schema.loadouts)
	const { _resetPreviewInFlightForTests } = await import("./preview")
	_resetPreviewInFlightForTests()
})

describe("previewVoice", () => {
	test("no speaking pair is a sentence, and nothing is called", async () => {
		const m = await refusal(preview(ADMIN, {}))
		expect(m).toBeTruthy()
		expect(fake.calls).toHaveLength(0)
	})

	test("signed out is refused", async () => {
		expect(await refusal(preview(null, {}))).toBe("Sign in to try a voice.")
	})

	test("one call for a line; the clip comes back inline", async () => {
		await narration({})
		const res = await preview(ADMIN, { text: "  Hello there.  " })
		expect(fake.calls).toHaveLength(1)
		expect(fake.calls[0].text).toBe("Hello there.")
		expect(res.mime).toBe("audio/wav")
		expect(res.bytes).toBe("UklGRg==")
		expect(res.durationMs).toBe(100)
		expect(res.spokenAs).toEqual({ voice: "af_a", model: "m" })
	})

	test("blank text speaks the sample line; over 300 is refused", async () => {
		await narration({})
		await preview(ADMIN, { text: "   " })
		expect(fake.calls[0].text).toBe(VOICE_TRYOUT_SAMPLE_LINE)
		expect(await refusal(preview(ADMIN, { text: "x".repeat(301) }))).toBe(
			"A try-out line is at most 300 characters."
		)
		expect(fake.calls).toHaveLength(1)
	})

	test("a pinned seed is sent as-is", async () => {
		await narration({})
		const res = await preview(ADMIN, { settings: { seed: 42 } })
		expect(fake.calls[0].seed).toBe(42)
		expect(res.seed).toBe(42)
	})

	test("a designing model derives the seed and drops the inflection, with a note", async () => {
		await narration({ instruction: "prose", designsVoice: true })
		const res = await preview(ADMIN, { description: "a warm low alto", inflection: "joy", voiceId: "af_a" })
		expect(fake.calls[0].seed).toBe(stableVoiceSeed(["a warm low alto", "af_a"]))
		expect(res.seed).toBe(fake.calls[0].seed)
		expect(res.notes).toContain(
			"inflection 'joy' not sent: this model designs its voice from the description"
		)
		expect(String(fake.calls[0].direction ?? "")).not.toMatch(/joy/i)
	})

	test("a prose model that does not design takes the inflection in the direction", async () => {
		await narration({ instruction: "prose" })
		await preview(ADMIN, { inflection: "anger" })
		expect(String(fake.calls[0].direction ?? "")).toMatch(/anger/i)
		expect(fake.calls[0].seed).toBeUndefined()
	})

	test("an unknown mood and a bad language are refused", async () => {
		await narration({})
		expect(await refusal(preview(ADMIN, { inflection: "zzz" }))).toBe("That is not a mood this pub knows.")
		expect(await refusal(preview(ADMIN, { language: "english" }))).toBe(
			"Language must be a two-letter code, like en or ja."
		)
	})

	test("a member cannot send a voice, a voice id or a loadout", async () => {
		await narration({})
		const sentence =
			"Only an administrator can try a particular voice; your try uses the pub's default voice."
		expect(await refusal(preview(MEMBER, { voice: "x" }))).toBe(sentence)
		expect(await refusal(preview(MEMBER, { voiceId: "af_a" }))).toBe(sentence)
		expect(await refusal(preview(MEMBER, { loadoutId: 1 }))).toBe(sentence)
		expect(fake.calls).toHaveLength(0)
	})

	test("a member's settings are reduced to the seed", async () => {
		await narration({})
		await preview(MEMBER, { settings: { seed: 7, speed: 2 } })
		expect(fake.calls[0].seed).toBe(7)
		expect(fake.calls[0].speed).toBeUndefined()
	})

	test("an administrator's loadoutId speaks on that loadout's model", async () => {
		await narration({})
		const o = await otherLoadout()
		await preview(ADMIN, { loadoutId: o.loadout.id, voiceId: "af_a" })
		expect(fake.calls).toHaveLength(1)
		expect(fake.targets.at(-1).connectionModelId).toBe(o.model.id)
	})

	test("an administrator's loadoutId must be a filled text->audio loadout", async () => {
		await narration({})
		const unfilled = await otherLoadout("text->audio", false)
		expect(await refusal(preview(ADMIN, { loadoutId: unfilled.loadout.id }))).toMatch(/has no model yet/)
		const text = await otherLoadout("text->text")
		expect(await refusal(preview(ADMIN, { loadoutId: text.loadout.id }))).toMatch(/does not speak/)
		expect(await refusal(preview(ADMIN, { loadoutId: 999999 }))).toMatch(/no longer exists/)
		expect(fake.calls).toHaveLength(0)
	})

	test("a second try while one is pending is refused", async () => {
		await narration({})
		let release!: () => void
		const gate = new Promise<void>((r) => (release = r))
		fake.synth = async () => {
			await gate
			return {
				isAborted: false,
				applied: [],
				ignored: [],
				spokenAs: { voice: "v", model: "m", connection: 1 },
				media: [{ kind: "audio", mime: "audio/wav", base64: "UklGRg==" }]
			}
		}
		const first = preview(ADMIN, {})
		await vi.waitFor(() => expect(fake.calls).toHaveLength(1))
		expect(await refusal(preview(ADMIN, {}))).toBe("A voice is already being tried.")
		release()
		await first
		await preview(ADMIN, {})
		expect(fake.calls).toHaveLength(2)
	})

	test("a hanging model times out with a sentence", async () => {
		await narration({})
		fake.synth = (_req, opts) =>
			new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(opts.signal.reason)))
		expect(await refusal(preview(ADMIN, {}, { timeoutMs: 20 }))).toBe(
			"The voice model did not answer within a minute."
		)
	})

	test("an adapter error never names the connection", async () => {
		await narration({})
		const spy = vi.spyOn(console, "error").mockImplementation(() => {})
		fake.synth = async () => {
			throw new Error("connect ECONNREFUSED http://localhost:1")
		}
		expect(await refusal(preview(ADMIN, {}))).toBe("The voice model could not speak this line.")
		spy.mockRestore()
	})

	test("the caller's own abort is rethrown, not a refusal", async () => {
		await narration({})
		const ac = new AbortController()
		fake.synth = (_req, opts) =>
			new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(opts.signal.reason)))
		const p = preview(ADMIN, {}, { signal: ac.signal })
		await vi.waitFor(() => expect(fake.calls).toHaveLength(1))
		ac.abort()
		const { VoicePreviewRefusal } = await import("./preview")
		await expect(p).rejects.not.toBeInstanceOf(VoicePreviewRefusal)
	})
})
