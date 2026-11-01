/**
 * audio.cpp, run by Serene Pub — the start gate: with nothing to serve, no
 * process is spawned and the refusal is prompt and says why. A fake binary
 * drops a marker file if it is ever run; real test DB for the settings.
 */
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import { audiocppSettings } from "$lib/server/db/schema"

// DB setup under load.
vi.setConfig({ testTimeout: 60_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

const GGUF_ENTRY = {
	id: "kokoro_82m_q8_0",
	displayName: "Kokoro 82M (q8)",
	family: "kokoro_tts",
	task: "tts",
	revision: "main",
	name: "audio-cpp/audio.cpp-gguf",
	tags: [],
	recommendedVram: 0,
	details: { description: "" },
	files: ["Kokoro-82M-GGUF/kokoro-82m-q8_0.gguf"],
	targetDirectory: "Kokoro-82M-GGUF",
	stripPrefix: "Kokoro-82M-GGUF",
	sizeBytes: 1000
}
vi.mock("$lib/server/audio/audioList", async (orig) => ({
	...(await orig<typeof import("$lib/server/audio/audioList")>()),
	getAudioLists: async () => ({ entries: [GGUF_ENTRY], families: [] })
}))
vi.mock("$lib/server/audio/familyOf", () => ({ familyOf: () => null }))

let dir: string
let models: string
let marker: string
let db: Db
let rowId: number
let mod: typeof import("./process")

const FAKE = (markerPath: string) => `#!/usr/bin/env node
require("fs").writeFileSync(${JSON.stringify(markerPath)}, "spawned")
process.on("SIGTERM", () => process.exit(0))
setInterval(() => {}, 1000)
`
const patch = (v: Partial<typeof audiocppSettings.$inferInsert>) =>
	db.update(audiocppSettings).set(v).where(eq(audiocppSettings.id, rowId))

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), "acpp-gate-"))
	models = join(dir, "models")
	marker = join(dir, "spawned.marker")
	const bin = join(dir, "audiocpp_server")
	writeFileSync(bin, FAKE(marker))
	chmodSync(bin, 0o755)
	db = (await import("$lib/server/db")).db as unknown as Db
	mod = await import("./process")
	const { ensureAudioCppSettings } = await import("./settings")
	rowId = (await ensureAudioCppSettings(db)).id
	await patch({ binaryDir: dir, modelsDir: models, port: 5077, enabled: true, enabledPackageIds: [], subprocessTimeoutMinutes: 0 })
}, 60_000)

afterAll(async () => {
	await mod?.stopAudioCpp().catch(() => {})
	await (db as unknown as { $client: { close(): Promise<void> } }).$client.close().catch(() => {})
	rmSync(dir, { recursive: true, force: true })
}, 60_000)

describe("audio.cpp start gate", () => {
	test("enabled with no enabled packages: refuses promptly with NO_PACKAGE_MESSAGE, spawns nothing", async () => {
		const t0 = Date.now()
		await expect(mod.ensureAudioCppReady()).rejects.toThrow(mod.NO_PACKAGE_MESSAGE)
		expect(Date.now() - t0).toBeLessThan(5000)
		expect(existsSync(marker)).toBe(false)
		// A refusal tried nothing, so the supervisor stays "stopped" with the
		// sentence as lastError (V-2 fixed by the lead, 2026-10-29).
		const st = mod.getStatus()
		expect(st.status).toBe("stopped")
		expect(st.lastError).toBe(mod.NO_PACKAGE_MESSAGE)
		expect(st.pid).toBeNull()
	})

	test("enabled ids whose files are not on disk: refuses with NO_PACKAGE_ON_DISK_MESSAGE, spawns nothing", async () => {
		await patch({ enabledPackageIds: [GGUF_ENTRY.id] })
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
		try {
			const t0 = Date.now()
			await expect(mod.ensureAudioCppReady()).rejects.toThrow(mod.NO_PACKAGE_ON_DISK_MESSAGE)
			expect(Date.now() - t0).toBeLessThan(5000)
		} finally {
			warn.mockRestore()
		}
		expect(existsSync(marker)).toBe(false)
		expect(mod.getStatus().status).toBe("stopped")
	})

	test("adoptIfAlreadyRunning is false when the gate refuses; boot orphan check with zero packages spawns nothing", async () => {
		await patch({ enabledPackageIds: [] })
		expect(await mod.audioCppSupervisor.adoptIfAlreadyRunning()).toBe(false)
		await mod.checkForOrphanOnBoot()
		expect(existsSync(marker)).toBe(false)
	})

	test("switched off: refuses with the 'switched off' sentence, spawns nothing", async () => {
		await patch({ enabled: false, enabledPackageIds: [GGUF_ENTRY.id] })
		await expect(mod.ensureAudioCppReady()).rejects.toThrow(/switched off/)
		expect(existsSync(marker)).toBe(false)
	})
})
