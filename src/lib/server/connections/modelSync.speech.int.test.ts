/**
 * Lane V2: the model sync and speech — `facts.speech` survives a facts replace,
 * and `adapterIO` routes a `tts` type to its speech module. (Companion to
 * `modelSync.int.test.ts`, which is not edited.)
 */
import { beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

// DB setup under load is slow: every `it` that touches the database gets 60 s.
vi.setConfig({ testTimeout: 60_000 })

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

let db: TestDb
beforeAll(async () => {
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
}, 120_000)

async function endpoint(type: string, modality: string) {
	const [row] = await db
		.insert(schema.connections)
		.values({ name: `s ${Math.random()}`, type, baseUrl: "http://a:8080", modality, capabilities: {} } as any)
		.returning()
	return row
}
const rowsOf = (id: number) =>
	db.select().from(schema.connectionModels).where(eq(schema.connectionModels.connectionId, id))

const SPEECH = {
	voices: [{ id: "v", name: "V", kind: "preset" }],
	voicesFrom: "discovered", controls: {}, streams: false, formats: ["wav"]
}

describe("syncConnectionModels keeps facts.speech", () => {
	it("a facts replace carries the stored speech record across and replaces the rest", async () => {
		const { syncConnectionModels } = await import("$lib/server/connections/modelSync")
		const c = await endpoint(CONNECTION_TYPE.OPENAI, "text-gen")
		await syncConnectionModels(db, c.id, { models: [{ model: "gpt-4o-mini-tts", modality: "tts", facts: { contextWindow: 1000 } }] })
		const [r0] = await rowsOf(c.id)
		await db.update(schema.connectionModels)
			.set({ facts: { contextWindow: 1000, speech: SPEECH } })
			.where(eq(schema.connectionModels.id, r0.id))
		// The host now states a different window and nothing about speech.
		await syncConnectionModels(db, c.id, { models: [{ model: "gpt-4o-mini-tts", modality: "tts", facts: { contextWindow: 2000 } }] })
		const [r1] = await rowsOf(c.id)
		expect((r1.facts as any).contextWindow).toBe(2000)
		expect((r1.facts as any).speech).toEqual(SPEECH)
	})

	it("a host that states no facts at all still keeps the speech record", async () => {
		const { syncConnectionModels } = await import("$lib/server/connections/modelSync")
		const c = await endpoint(CONNECTION_TYPE.OLLAMA, "text-gen")
		await syncConnectionModels(db, c.id, { models: [{ model: "phonon", modality: "tts" }] })
		const [r0] = await rowsOf(c.id)
		await db.update(schema.connectionModels).set({ facts: { speech: SPEECH } }).where(eq(schema.connectionModels.id, r0.id))
		await syncConnectionModels(db, c.id, { models: [{ model: "phonon", modality: "tts", facts: { contextWindow: 5 } }] })
		expect(((await rowsOf(c.id))[0].facts as any)).toMatchObject({ contextWindow: 5, speech: SPEECH })
		// Same listing again: no churn, still there.
		await syncConnectionModels(db, c.id, { models: [{ model: "phonon", modality: "tts", facts: { contextWindow: 5 } }] })
		expect(((await rowsOf(c.id))[0].facts as any).speech).toEqual(SPEECH)
	})

	it("a row with no speech record gets none invented", async () => {
		const { syncConnectionModels } = await import("$lib/server/connections/modelSync")
		const c = await endpoint(CONNECTION_TYPE.OLLAMA, "text-gen")
		await syncConnectionModels(db, c.id, { models: [{ model: "llama", facts: { contextWindow: 5 } }] })
		expect("speech" in ((await rowsOf(c.id))[0].facts as any)).toBe(false)
	})
})

describe("adapterIO routes tts types to the speech module", () => {
	it.each([CONNECTION_TYPE.AUDIOCPP, CONNECTION_TYPE.ELEVENLABS])("%s lists and tests through its speech module", async (type) => {
		const { adapterIO } = await import("$lib/server/connections/modelSync")
		const { getSpeechAdapter } = await import("$lib/server/connectionAdapters/speech/getSpeechAdapter")
		const io = await adapterIO(type, db as any)
		const mod = (await getSpeechAdapter(type))!
		expect(io.listModels).toBe(mod.listModels)
		expect(io.testConnection).toBe(mod.testConnection)
	})
	it("a type that is text-gen still gets the text family", async () => {
		const { adapterIO } = await import("$lib/server/connections/modelSync")
		const io = await adapterIO(CONNECTION_TYPE.OPENAI, db as any)
		expect(typeof io.listModels).toBe("function")
		const { getSpeechAdapter } = await import("$lib/server/connectionAdapters/speech/getSpeechAdapter")
		expect(io.listModels).not.toBe((await getSpeechAdapter(CONNECTION_TYPE.OPENAI))!.listModels)
	})
})
