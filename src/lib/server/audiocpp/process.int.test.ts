import { chmodSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs"
import { createServer } from "net"
import { tmpdir } from "os"
import { join } from "path"
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { eq } from "drizzle-orm"
import { audiocppSettings } from "$lib/server/db/schema"

// process.ts reads settings through the app db at the edges; point that at a
// throwaway PGlite. (Chosen over an injectable db: it mirrors subprocessManager.)
vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	return { db: await createTestDb() }
})

// The enabled-package list is W3's; here it is a plain variable.
const enabled = vi.hoisted(() => ({
	// One made-up package from the start: the gate refuses with nothing
	// enabled and prepare refuses an empty config (audio.cpp rejects an
	// empty `models` array); the fake binary never reads the path.
	list: [{ id: "fake-package", family: "kokoro_tts", task: "tts", path: "/nowhere/fake.gguf" }] as {
		id: string
		family: string
		task: string
		path: string
	}[]
}))
vi.mock("./packages", async (importOriginal) => ({
	...(await importOriginal<typeof import("./packages")>()),
	enabledPackagesForConfig: async () => enabled.list
}))

const FAKE = `#!/usr/bin/env node
const fs = require("fs"), http = require("http")
const a = process.argv
const cfg = JSON.parse(fs.readFileSync(a[a.indexOf("--config") + 1], "utf8"))
http.createServer((req, res) => {
  res.setHeader("content-type", "application/json")
  if (req.url === "/health") return res.end(JSON.stringify({ status: "ok", backend: "cpu", version: "0.0.0-fake" }))
  if (req.url === "/v1/models") return res.end(JSON.stringify({ object: "list", data: cfg.models.map((m) => ({ id: m.id })) }))
  res.statusCode = 404; res.end("{}")
}).listen(cfg.port, "127.0.0.1")
process.on("SIGTERM", () => process.exit(0))
`

let dir: string
let db: Db
let port: number
let mod: typeof import("./process")

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const s = createServer()
		s.listen(0, "127.0.0.1", () => {
			const p = (s.address() as { port: number }).port
			s.close(() => resolve(p))
		})
		s.on("error", reject)
	})
}

const patch = (v: Partial<typeof audiocppSettings.$inferInsert>) =>
	db.update(audiocppSettings).set(v).where(eq(audiocppSettings.id, rowId))
let rowId: number

beforeAll(async () => {
	dir = mkdtempSync(join(tmpdir(), "audiocpp-fake-"))
	const bin = join(dir, "audiocpp_server")
	writeFileSync(bin, FAKE)
	chmodSync(bin, 0o755)
	db = (await import("$lib/server/db")).db as unknown as Db
	mod = await import("./process")
	const { ensureAudioCppSettings } = await import("./settings")
	port = await freePort()
	rowId = (await ensureAudioCppSettings(db)).id
	await patch({
		binaryDir: dir,
		port,
		enabled: false,
		subprocessTimeoutMinutes: 0,
		// The start gate checks the enabled ids; the package list above is
		// what the config is built from.
		enabledPackageIds: ["fake-package"]
	})
}, 60_000)

afterAll(async () => {
	await mod?.stopAudioCpp().catch(() => {})
	rmSync(dir, { recursive: true, force: true })
	await (db as unknown as { $client: { close(): Promise<void> } }).$client
		.close()
		.catch(() => {})
}, 60_000)

describe("audio.cpp process", () => {
	test("gate refuses while switched off", async () => {
		await expect(mod.ensureAudioCppReady()).rejects.toThrow(/switched off/)
	}, 60_000)

	test("ensureAudioCppReady starts it; a second call reuses it", async () => {
		await patch({ enabled: true })
		const a = await mod.ensureAudioCppReady()
		expect(a.baseUrl).toBe(`http://127.0.0.1:${port}`)
		const first = mod.getStatus()
		expect(first.status).toBe("running")
		const b = await mod.ensureAudioCppReady()
		expect(b.baseUrl).toBe(a.baseUrl)
		expect(mod.getStatus().pid).toBe(first.pid)

		const view = await mod.getAudioCppStatusView(db, { probe: true })
		expect(view.status).toBe("running")
		expect(view.version).toBe("0.0.0-fake")
		expect(view.backend).toBe("cpu")
		expect(view.configApplied).toBe(true)
		expect(view.loaded).toEqual([])
		const cfg = JSON.parse(readFileSync(join(dir, "serene-pub.server.json"), "utf8"))
		expect(cfg.port).toBe(port)
	}, 60_000)

	test("a config change restarts it (pid changes); no change does not", async () => {
		const before = mod.getStatus().pid
		expect((await mod.applyAudioCppConfig(db)).restarted).toBe(false)
		expect(mod.getStatus().pid).toBe(before)

		const gguf = join(dir, "fake.gguf")
		writeFileSync(gguf, "x")
		enabled.list = [{ id: "kokoro_82m_q8_0", family: "kokoro_tts", task: "tts", path: gguf }]
		expect((await mod.applyAudioCppConfig(db)).restarted).toBe(true)
		const after = mod.getStatus()
		expect(after.status).toBe("running")
		expect(after.pid).not.toBe(before)
		expect((await mod.getAudioCppStatusView(db)).configApplied).toBe(true)

		// idle_unload_ms is part of the config too.
		const pid2 = after.pid
		await patch({ idleUnloadMs: 60000 })
		await mod.ensureAudioCppReady()
		expect(mod.getStatus().pid).not.toBe(pid2)
		const cfg = JSON.parse(readFileSync(join(dir, "serene-pub.server.json"), "utf8"))
		expect(cfg.idle_unload_ms).toBe(60000)
		expect(cfg.models.map((m: { id: string }) => m.id)).toEqual(["kokoro_82m_q8_0"])
	}, 60_000)

	test("stopAudioCpp stops it", async () => {
		await mod.stopAudioCpp()
		expect(mod.getStatus().status).toBe("stopped")
		const view = await mod.getAudioCppStatusView(db, { probe: true })
		expect(view.loaded).toEqual([])
		expect(view.configApplied).toBe(false)
	}, 60_000)
})
