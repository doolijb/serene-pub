/**
 * Lane V2: `refreshSpeechFacts` against a real (PGlite) database, with the
 * speech module swapped for a scripted one so each case states exactly what
 * discovery said. `db` is passed explicitly (a dynamic `defaultDb()` import
 * would bypass the mock).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import type { SpeechFacts } from "$lib/shared/connectionAdapters/speechFacts"

// DB setup under load is slow: every `it` that touches the database gets 60 s.
vi.setConfig({ testTimeout: 60_000 })

const discover = vi.fn()
let moduleFor: Record<string, unknown> = {}
vi.mock("./getSpeechAdapter", () => ({
	getSpeechAdapter: async (type: string) => moduleFor[type] ?? null
}))

const { refreshSpeechFacts } = await import("./speechFactsStore")

let db: TestDb
beforeAll(async () => {
	db = await createTestDb()
}, 60_000)

const facts = (voice: string): SpeechFacts => ({
	voices: [{ id: voice, name: voice, kind: "preset" }],
	voicesFrom: "discovered",
	controls: {},
	streams: false,
	formats: ["wav"]
})

beforeEach(() => {
	discover.mockReset()
	moduleFor = { audiocpp: { Adapter: class {}, discoverSpeechFacts: (...a: unknown[]) => discover(...a) } }
})

async function conn(type = "audiocpp") {
	const [c] = await db
		.insert(schema.connections)
		.values({ name: `c ${Math.random()}`, type, baseUrl: "http://a:8080", extraJson: {}, capabilities: {} } as any)
		.returning()
	return c
}
async function model(connectionId: number, m: string, over: Record<string, unknown> = {}) {
	const [r] = await db
		.insert(schema.connectionModels)
		.values({ connectionId, model: m, name: m, enabled: true, modality: "tts", ...over } as any)
		.returning()
	return r
}
const factsOf = async (id: number) =>
	(await db.select().from(schema.connectionModels).where(eq(schema.connectionModels.id, id)))[0].facts as any

describe("refreshSpeechFacts", () => {
	it("refreshes only tts rows by default; the name hint is passed through", async () => {
		const c = await conn()
		const tts = await model(c.id, "kitten_tts2_q8", { name: "Kitten TTS 2" })
		const text = await model(c.id, "llama", { modality: "text-gen" })
		const none = await model(c.id, "unknown-modality", { modality: null })
		discover.mockResolvedValue(facts("a"))
		const res = await refreshSpeechFacts(db, c.id)
		expect(res.map((r) => r.model)).toEqual(["kitten_tts2_q8"])
		expect(discover).toHaveBeenCalledTimes(1)
		expect(discover.mock.calls[0][1]).toBe("kitten_tts2_q8")
		expect(discover.mock.calls[0][2]).toEqual({ name: "Kitten TTS 2" })
		expect(discover.mock.calls[0][0].id).toBe(c.id)
		expect((await factsOf(tts.id)).speech.voices[0].id).toBe("a")
		expect((await factsOf(text.id)).speech).toBeUndefined()
		expect((await factsOf(none.id)).speech).toBeUndefined()
		expect(res[0]).toMatchObject({ connectionModelId: tts.id, speech: facts("a") })
		expect(res[0].error).toBeUndefined()
	})

	it("opts.model refreshes that model whatever its modality, and only it", async () => {
		const c = await conn()
		const text = await model(c.id, "llama", { modality: "text-gen" })
		await model(c.id, "other-tts")
		discover.mockResolvedValue(facts("b"))
		const res = await refreshSpeechFacts(db, c.id, { model: "llama" })
		expect(res.map((r) => r.model)).toEqual(["llama"])
		expect((await factsOf(text.id)).speech.voices[0].id).toBe("b")
	})

	it("other facts keys survive the write", async () => {
		const c = await conn()
		const m = await model(c.id, "m", { facts: { contextWindow: 4096, price: { in: 1 } } })
		discover.mockResolvedValue(facts("c"))
		await refreshSpeechFacts(db, c.id)
		const f = await factsOf(m.id)
		expect(f.contextWindow).toBe(4096)
		expect(f.price).toEqual({ in: 1 })
		expect(f.speech.voices[0].id).toBe("c")
	})

	it("a null discovery keeps the stored record and reports it", async () => {
		const c = await conn()
		const m = await model(c.id, "m", { facts: { speech: facts("kept"), x: 1 } })
		discover.mockResolvedValue(null)
		const res = await refreshSpeechFacts(db, c.id)
		expect(res[0].speech).toEqual(facts("kept"))
		expect((await factsOf(m.id)).speech.voices[0].id).toBe("kept")
	})

	it("a null discovery with clearOnNull removes only the speech key", async () => {
		const c = await conn()
		const m = await model(c.id, "m", { facts: { speech: facts("gone"), x: 1 } })
		discover.mockResolvedValue(null)
		const res = await refreshSpeechFacts(db, c.id, { clearOnNull: true })
		expect(res[0].speech).toBeNull()
		expect(await factsOf(m.id)).toEqual({ x: 1 })
	})

	it("a thrown probe becomes `error` on its row, keeps the stored record, and the next row still runs", async () => {
		const c = await conn()
		const bad = await model(c.id, "a-bad", { facts: { speech: facts("old") } })
		const good = await model(c.id, "b-good")
		discover.mockImplementation(async (_c: unknown, m: string) => {
			if (m === "a-bad") throw new Error("voices request failed")
			return facts("new")
		})
		const res = await refreshSpeechFacts(db, c.id)
		const byModel = Object.fromEntries(res.map((r) => [r.model, r]))
		expect(byModel["a-bad"].error).toBe("voices request failed")
		expect(byModel["a-bad"].speech).toEqual(facts("old"))
		expect(byModel["b-good"].error).toBeUndefined()
		expect((await factsOf(bad.id)).speech.voices[0].id).toBe("old")
		expect((await factsOf(good.id)).speech.voices[0].id).toBe("new")
	})

	it("a thrown non-Error still gets a sentence", async () => {
		const c = await conn()
		await model(c.id, "m")
		discover.mockRejectedValue("nope")
		const res = await refreshSpeechFacts(db, c.id)
		expect(res[0].error).toBe("Speech discovery failed.")
	})

	it("a type with no speech module reports it per row and writes nothing", async () => {
		const c = await conn("anthropic")
		const m = await model(c.id, "m", { facts: { speech: facts("kept") } })
		const res = await refreshSpeechFacts(db, c.id)
		expect(res[0].error).toMatch(/cannot list speech facts/)
		expect(res[0].speech).toEqual(facts("kept"))
		expect((await factsOf(m.id)).speech.voices[0].id).toBe("kept")
	})

	it("a module without discoverSpeechFacts reports the same", async () => {
		moduleFor = { audiocpp: { Adapter: class {} } }
		const c = await conn()
		await model(c.id, "m")
		expect((await refreshSpeechFacts(db, c.id))[0].error).toMatch(/cannot list speech facts/)
	})

	it("a missing connection, and a connection with no matching rows, give []", async () => {
		expect(await refreshSpeechFacts(db, 987654)).toEqual([])
		const c = await conn()
		expect(await refreshSpeechFacts(db, c.id)).toEqual([])
		expect(await refreshSpeechFacts(db, c.id, { model: "nope" })).toEqual([])
	})

	it("rows of another connection are never touched", async () => {
		const a = await conn()
		const b = await conn()
		await model(a.id, "m")
		const other = await model(b.id, "m")
		discover.mockResolvedValue(facts("z"))
		await refreshSpeechFacts(db, a.id)
		expect((await factsOf(other.id))?.speech).toBeUndefined()
	})
})
