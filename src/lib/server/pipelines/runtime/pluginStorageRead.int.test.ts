/**
 * `core:query/plugin-storage@1` (M2a): one file out of the running plugin's own
 * storage, read-only and capped — through the host's `plugin_storage` read
 * (`readPluginStorage`) against a real database and a real data folder.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { declaredPermissions, reviewMarks } from "$lib/server/plugins/permissions"
import { storageSegment, userStorageDir } from "$lib/server/plugins/SandboxManager"
import { PLUGIN_STORAGE_QUERY_MAX_BYTES, readPluginStorage } from "./pluginStorageRead"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const BOTH = "acme.worlds"
const PUB_ONLY = "acme.pubonly"
let db: TestDb
let dir: string

const read = (over: Partial<Parameters<typeof readPluginStorage>[1]>) =>
	readPluginStorage(db as never, {
		ownerPluginId: BOTH,
		userId: 7,
		path: "world.json",
		dataDir: dir,
		...over
	})

function put(root: string | undefined, rel: string, body: string | Buffer) {
	const full = path.join(root!, rel)
	fs.mkdirSync(path.dirname(full), { recursive: true })
	fs.writeFileSync(full, body)
}

beforeAll(async () => {
	db = await createTestDb()
	dir = fs.mkdtempSync(path.join(os.tmpdir(), "sp-psq-"))
	for (const [id, permissions] of [
		[BOTH, { storage: { quotaBytes: 1_000_000, perUser: { quotaBytes: 100_000 } } }],
		[PUB_ONLY, { storage: { quotaBytes: 1_000_000 } }]
	] as const) {
		const manifest = { permissions }
		await db.insert(schema.plugins).values({
			pluginId: id,
			name: id,
			version: "1.0.0",
			bundleSource: "",
			bundleHash: "h",
			enabled: true,
			manifest,
			adminDenied: reviewMarks(declaredPermissions(manifest as never))
		} as never)
	}
	const pub = path.join(dir, "extensions_data", storageSegment(BOTH))
	put(pub, "world.json", JSON.stringify({ name: "Pub world" }))
	put(pub, "notes.txt", "plain words")
	put(pub, "big.json", Buffer.alloc(PLUGIN_STORAGE_QUERY_MAX_BYTES + 1, 32))
	put(path.join(dir, "extensions_data", storageSegment(PUB_ONLY)), "world.json", "{}")
	put(userStorageDir(dir, BOTH, 7), "world.json", JSON.stringify({ name: "Seven's" }))
	put(userStorageDir(dir, BOTH, 8), "secret.json", JSON.stringify({ name: "Eight's" }))
}, 60_000)
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe("core:query/plugin-storage@1", () => {
	it("reads a pub file as JSON by default", async () => {
		expect(await read({})).toEqual({ main: { name: "Pub world" }, found: true })
	})
	it("reads the run's person's own file for scope 'me'", async () => {
		expect(await read({ scope: "me" })).toEqual({ main: { name: "Seven's" }, found: true })
	})
	it("cannot reach another person's folder", async () => {
		expect(await read({ scope: "me", path: "secret.json" })).toEqual({ main: null, found: false })
		await expect(read({ scope: "me", path: "../8/secret.json" })).rejects.toThrow(/escapes/)
	})
	it("refuses a spec with no plugin owner (core or person-authored)", async () => {
		await expect(read({ ownerPluginId: undefined })).rejects.toThrow(
			"plugin-storage reads only a plugin's own pipeline's storage"
		)
	})
	it("refuses '..' and absolute paths", async () => {
		await expect(read({ path: "../acme.pubonly/world.json" })).rejects.toThrow(/escapes/)
		await expect(read({ path: "/etc/passwd" })).rejects.toThrow(/escapes/)
	})
	it("refuses a file over the cap, naming both sizes", async () => {
		await expect(read({ path: "big.json" })).rejects.toThrow(/4\.00 MiB.*4\.00 MiB|MiB.*MiB/)
	})
	it("answers found: false for a missing file", async () => {
		expect(await read({ path: "nope.json" })).toEqual({ main: null, found: false })
	})
	it("reads text when asked", async () => {
		expect(await read({ path: "notes.txt", as: "text" })).toEqual({ main: "plain words", found: true })
	})
	it("needs storage-per-user for 'me', and a person on the run", async () => {
		await expect(read({ ownerPluginId: PUB_ONLY, scope: "me" })).rejects.toThrow(/per-user storage is not granted/)
		await expect(read({ scope: "me", userId: undefined })).rejects.toThrow(/no person is acting/)
	})
})
