/**
 * A production boot of a build made with a different `drizzle/` than the one
 * beside it refuses before ANY write to the database — no ledger repair, no
 * pre-migration backup, no migration (`migrationSet.ts`). A stale `build/`
 * once ran a newer 0095 over live 0.5.3 data without the upgrade that belongs
 * with it.
 *
 * Booted through the real module, as a production build (`dev: false`),
 * with `__MIGRATION_SET__` — normally Vite's build-time define — stubbed.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
vi.mock("$app/environment", () => ({ dev: false, building: false, browser: false }))

/** `getDbDataDir()` answers the real `~/SerenePubData` under CI=true — never booted here. */
const underCI = process.env.CI === "true"

let root: string
const originalDataDir = process.env.SERENE_PUB_DATA_DIR

beforeAll(async () => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-stale-build-"))
	// Somebody's existing data: a database with a table of theirs in it.
	const data = path.join(root, "data")
	fs.mkdirSync(data, { recursive: true })
	const pg = new PGlite(path.join(data, "serene-pub.db"))
	await pg.waitReady
	await pg.exec(`CREATE TABLE keepsake (id int)`)
	await pg.close()
})

afterEach(() => {
	vi.unstubAllGlobals()
	vi.resetModules()
	if (originalDataDir === undefined) delete process.env.SERENE_PUB_DATA_DIR
	else process.env.SERENE_PUB_DATA_DIR = originalDataDir
})

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true })
})

describe.skipIf(underCI)("a build whose migration set is not the one on disk", () => {
	test("refuses dbReady before any write", async () => {
		process.env.SERENE_PUB_DATA_DIR = root
		vi.stubGlobal("__APP_VERSION__", "0.6.0")
		vi.stubGlobal("__MIGRATION_SET__", {
			fingerprint: "0".repeat(64),
			count: 1,
			latestTag: "0000_older_build"
		})
		vi.resetModules()
		vi.spyOn(console, "error").mockImplementation(() => {})

		const mod = await import("./index")
		const error = await mod.dbReady.then(
			() => null,
			(err: unknown) => err
		)
		const { StaleBuildError, STALE_BUILD_MESSAGE } = await import("./migrationSet")
		expect(error).toBeInstanceOf(StaleBuildError)
		expect((error as Error).message).toContain(STALE_BUILD_MESSAGE)

		const client = (mod.db as unknown as { $client: PGlite }).$client
		const tables = await client.query<{ name: string }>(
			`SELECT table_schema || '.' || table_name AS name
			   FROM information_schema.tables
			  WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`
		)
		expect(tables.rows.map((r) => r.name)).toEqual(["public.keepsake"])
		expect(fs.existsSync(path.join(root, "data", "backups"))).toBe(false)
		await mod.closeDatabase()
	})
})
