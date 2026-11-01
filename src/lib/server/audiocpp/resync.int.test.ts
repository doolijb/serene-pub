/**
 * audio.cpp, run by Serene Pub — `resyncManagedAudioCpp(db)`: the managed row
 * exists once, its model rows follow the enabled packages, and it never throws.
 * Real test DB, a real (fake) package tree on disk; the process is never
 * started (the ready door throws if anything asks).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

// DB setup under load.
vi.setConfig({ testTimeout: 60_000 })

const state = vi.hoisted(() => ({ failSync: false }))

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb(), getCryptoSecretKey: () => "test-crypto-secret-key" }
})
vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => [],
	isLocalEmbeddingSupported: async () => false
}))
vi.mock("$lib/server/connectionAdapters/audioCppReady", async (orig) => ({
	...(await orig<typeof import("$lib/server/connectionAdapters/audioCppReady")>()),
	ensureAudioCppReadyUrl: async () => {
		throw new Error("resync must never start audio.cpp")
	}
}))
const entry = <T extends Record<string, unknown>>(o: T) => ({
	revision: "main",
	name: "audio-cpp/audio.cpp-gguf",
	tags: [],
	recommendedVram: 0,
	details: { description: "" },
	...o
})
const KOKORO = entry({
	id: "kokoro_82m_q8_0",
	displayName: "Kokoro 82M (q8)",
	family: "kokoro_tts",
	task: "tts",
	files: ["Kokoro-82M-GGUF/kokoro-82m-q8_0.gguf"],
	targetDirectory: "Kokoro-82M-GGUF",
	stripPrefix: "Kokoro-82M-GGUF",
	sizeBytes: 1000
})
const PARAKEET = entry({
	id: "parakeet_tdt_0_6b_v3_q8_0",
	displayName: "Parakeet TDT 0.6B v3 (q8)",
	family: "parakeet_tdt",
	task: "asr",
	files: ["Parakeet-GGUF/parakeet-q8_0.gguf"],
	targetDirectory: "Parakeet-GGUF",
	stripPrefix: "Parakeet-GGUF"
})
vi.mock("$lib/server/audio/audioList", async (orig) => ({
	...(await orig<typeof import("$lib/server/audio/audioList")>()),
	getAudioLists: async () => ({ entries: [KOKORO, PARAKEET], families: [] })
}))
vi.mock("$lib/server/audio/familyOf", () => ({ familyOf: () => null }))
vi.mock("$lib/server/connections/audioCppManagedModels", async (orig) => {
	const actual = await orig<typeof import("$lib/server/connections/audioCppManagedModels")>()
	return {
		...actual,
		syncAudioCppManagedModels: (...a: Parameters<typeof actual.syncAudioCppManagedModels>) => {
			if (state.failSync) throw new Error("sync exploded")
			return actual.syncAudioCppManagedModels(...a)
		}
	}
})

let db: TestDb
let tmp: string
let settingsId: number
let mod: typeof import("./resync")

const touch = (rel: string) => {
	const p = join(tmp, rel)
	mkdirSync(dirname(p), { recursive: true })
	writeFileSync(p, "x")
}
const managedRows = () =>
	db.select().from(schema.connections).where(eq(schema.connections.type, CONNECTION_TYPE.AUDIOCPP_MANAGED))
const modelRows = async (connectionId: number) =>
	Object.fromEntries(
		(
			await db.select().from(schema.connectionModels).where(eq(schema.connectionModels.connectionId, connectionId))
		).map((r) => [r.model, r])
	)
const patch = (v: Partial<typeof schema.audiocppSettings.$inferInsert>) =>
	db.update(schema.audiocppSettings).set(v).where(eq(schema.audiocppSettings.id, settingsId))

beforeAll(async () => {
	tmp = mkdtempSync(join(tmpdir(), "acpp-resync-"))
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
	const { ensureAudioCppSettings } = await import("./settings")
	settingsId = (await ensureAudioCppSettings(db as never)).id
	touch("tts/kokoro_tts/Kokoro-82M-GGUF/kokoro-82m-q8_0.gguf")
	touch("asr/parakeet_tdt/Parakeet-GGUF/parakeet-q8_0.gguf")
	await patch({ modelsDir: tmp, port: 5051, enabledPackageIds: [KOKORO.id as string, PARAKEET.id as string] })
	mod = await import("./resync")
}, 120_000)

afterAll(async () => {
	await (db as unknown as { $client: { close(): Promise<void> } }).$client.close().catch(() => {})
	rmSync(tmp, { recursive: true, force: true })
})

describe("resyncManagedAudioCpp", () => {
	it("creates exactly one managed row, named audio.cpp, with resolved capabilities and one model row per enabled package", async () => {
		expect(await managedRows()).toHaveLength(0)
		await mod.resyncManagedAudioCpp(db as never)
		const rows = await managedRows()
		expect(rows).toHaveLength(1)
		expect(rows[0].name).toBe("audio.cpp")
		expect(rows[0].baseUrl).toBe("http://127.0.0.1:5051")
		expect(Object.keys((rows[0].capabilities as any)?.resolved ?? {}).length).toBeGreaterThan(0)
		const m = await modelRows(rows[0].id)
		expect(Object.keys(m).sort()).toEqual([KOKORO.id, PARAKEET.id].sort())
		expect(m[KOKORO.id as string].modality).toBe("tts")
		expect(m[PARAKEET.id as string].modality).toBe("asr")
		expect(m[PARAKEET.id as string].reads).toEqual(["audio"])
		expect(m[PARAKEET.id as string].writes).toEqual(["text"])
	})

	it("a second call is idempotent: no second managed row, model rows unchanged", async () => {
		const [before] = await managedRows()
		const mBefore = await modelRows(before.id)
		await mod.resyncManagedAudioCpp(db as never)
		const rows = await managedRows()
		expect(rows).toHaveLength(1)
		expect(rows[0].id).toBe(before.id)
		const mAfter = await modelRows(before.id)
		expect(Object.keys(mAfter).sort()).toEqual(Object.keys(mBefore).sort())
		for (const k of Object.keys(mBefore)) expect(mAfter[k].id).toBe(mBefore[k].id)
	})

	it("disabling a package marks its row missing (kept, missingSince set); the other stays live", async () => {
		await patch({ enabledPackageIds: [PARAKEET.id as string] })
		await mod.resyncManagedAudioCpp(db as never)
		const [row] = await managedRows()
		const m = await modelRows(row.id)
		expect(m[KOKORO.id as string].missingSince).not.toBeNull()
		expect(m[PARAKEET.id as string].missingSince).toBeNull()
		// Disabling all: both marked.
		await patch({ enabledPackageIds: [] })
		await mod.resyncManagedAudioCpp(db as never)
		const m2 = await modelRows(row.id)
		expect(m2[PARAKEET.id as string].missingSince).not.toBeNull()
	})

	it("never throws: a failing sync resolves and logs a console.warn", async () => {
		state.failSync = true
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			await expect(mod.resyncManagedAudioCpp(db as never)).resolves.toBeUndefined()
			expect(warn).toHaveBeenCalled()
			expect(String(warn.mock.calls[0][0])).toContain("did not re-sync")
		} finally {
			state.failSync = false
			warn.mockRestore()
		}
	})

	it("a name clash: an existing non-managed 'audio.cpp' makes the managed row 'audio.cpp on this machine'", async () => {
		await db.delete(schema.connectionModels)
		await db.delete(schema.connections).where(eq(schema.connections.type, CONNECTION_TYPE.AUDIOCPP_MANAGED))
		await db.insert(schema.connections).values({
			name: "audio.cpp",
			type: CONNECTION_TYPE.AUDIOCPP,
			baseUrl: "http://127.0.0.1:9999",
			capabilities: {}
		} as any)
		await mod.resyncManagedAudioCpp(db as never)
		const rows = await managedRows()
		expect(rows).toHaveLength(1)
		expect(rows[0].name).toBe("audio.cpp on this machine")
	})
})
