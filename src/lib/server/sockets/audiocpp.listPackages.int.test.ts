/**
 * audiocpp:listPackages through the real handler: `families` present, a
 * `runtime: koboldcpp` family present, Qwen3-TTS 1.7B Base and 0.6B Base are
 * separate families, and no koboldcpp row is in the flat `packages`.
 */
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb(), getCryptoSecretKey: () => "test-crypto-secret-key" }
})
vi.mock("$lib/server/audio/audioList", async () => {
	const real = await vi.importActual<typeof import("$lib/server/audio/audioList")>(
		"$lib/server/audio/audioList"
	)
	const audio = (await import("$lib/server/audio/snapshot/audio.yaml?raw")).default
	const fam = (await import("$lib/server/audio/snapshot/audio-families.yaml?raw")).default
	return {
		...real,
		getAudioLists: async () => ({
			entries: real.parseAudioYaml(audio),
			families: real.parseAudioFamiliesYaml(fam),
			source: "snapshot"
		})
	}
})

let db: TestDb
let tmp: string

beforeAll(async () => {
	tmp = mkdtempSync(join(tmpdir(), "acpp-listpkgs-"))
	db = (await import("$lib/server/db")).db as unknown as TestDb
	await db.insert(schema.systemSettings).values({ id: 1 }).onConflictDoNothing()
	const { ensureAudioCppSettings } = await import("$lib/server/audiocpp/settings")
	const s = await ensureAudioCppSettings(db as never)
	await db.update(schema.audiocppSettings).set({ modelsDir: tmp }).where(eq(schema.audiocppSettings.id, s.id))
}, 120_000)

afterAll(async () => {
	await (db as unknown as { $client: { close(): Promise<void> } }).$client.close().catch(() => {})
	rmSync(tmp, { recursive: true, force: true })
})

describe("audiocpp:listPackages", () => {
	it("returns families (koboldcpp included, 1.7B and 0.6B Base separate) and no koboldcpp row in packages", async () => {
		const [admin] = await db.insert(schema.users).values({ username: "acpp-lp-admin", isAdmin: true }).returning()
		const { audioCppListPackages } = await import("./audiocpp")
		const res = (await audioCppListPackages.handler(
			{ user: { id: admin.id, isAdmin: true } } as any,
			undefined as any,
			(async () => {}) as any
		)) as any
		expect(Array.isArray(res.families)).toBe(true)
		expect(res.families.length).toBeGreaterThan(0)
		expect(res.families.some((f: any) => f.runtime === "koboldcpp")).toBe(true)
		expect(res.packages.some((p: any) => (p.runtime ?? "audiocpp") === "koboldcpp")).toBe(false)

		const bases = res.families.filter(
			(f: any) => f.runtime === "audiocpp" && f.family === "qwen3_tts" && f.variant === "base"
		)
		const names = bases.map((f: any) => f.displayName).sort()
		expect(names).toEqual(["Qwen3-TTS 0.6B Base", "Qwen3-TTS 1.7B Base"])
		expect(new Set(bases.map((f: any) => f.key)).size).toBe(2)
		for (const f of bases) expect(f.key.startsWith("audiocpp:qwen3_tts:base:")).toBe(true)
		const keys = res.families.map((f: any) => f.key)
		expect(new Set(keys).size).toBe(keys.length)
	})
})
