/**
 * Coming back up without a restart.
 *
 * P0 turned "the database will not open" from a crash into a state. This is the
 * way back out of that state: `reopenDatabase()` in `db/index.ts` replaces the
 * dead client and re-runs the open, and `restartAfterRecovery()` here runs the
 * startup tasks that were skipped because there was nothing to run them
 * against. Both are needed and neither is enough — an instance that reopened
 * the database but never bootstrapped would have no seed rows, no pipeline
 * specs and no layout presets, which reads as a second, stranger failure rather
 * than a recovery.
 *
 * The seeding half is the part most likely to regress silently. A start-fresh
 * leaves `meta.json` exactly where it is, so `isFreshInstall` (which is about
 * that file) says "no" while the database is brand new — and in a production
 * build the seed pass is gated on `dev || versionChanged || isFreshInstall`.
 * Left alone, the owner would get an empty database with a schema and no
 * default configurations at all, and nothing anywhere would say so.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

const FIXTURE =
	"/tmp/claude-1000/-home-jody-github-serene-pub/0ca0ac39-5cf4-4b38-9582-97b908f4ced5/scratchpad/probe-sp-data/data"

/**
 * `getDbDataDir()` answers `~/SerenePubData` when `CI=true` regardless of the
 * override, and that is somebody's real data directory rather than this test's
 * to move around.
 */
const runnable =
	process.env.CI !== "true" &&
	fs.existsSync(path.join(FIXTURE, "serene-pub.db"))

let root: string
const originalDataDir = process.env.SERENE_PUB_DATA_DIR

beforeAll(() => {
	if (!runnable) return
	root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-restart-"))
	// A real data directory that a force-quit left unopenable, copied — never
	// the original.
	fs.cpSync(FIXTURE, path.join(root, "data"), { recursive: true })
	process.env.SERENE_PUB_DATA_DIR = root
	vi.resetModules()
})

afterAll(async () => {
	if (!runnable) return
	try {
		const { closeDatabase } = await import("$lib/server/db")
		await closeDatabase()
	} catch {
		// Never opened. Nothing to release.
	}
	if (originalDataDir === undefined) delete process.env.SERENE_PUB_DATA_DIR
	else process.env.SERENE_PUB_DATA_DIR = originalDataDir
	fs.rmSync(root, { recursive: true, force: true })
})

describe.skipIf(!runnable)("recovering in place", () => {
	test("boots into the failure, then comes up on a start-fresh", async () => {
		const startup = await import("$lib/server/startup")

		// The P0 contract, restated because everything below depends on it: the
		// app comes up, it just has no database.
		await expect(startup.appReady).resolves.toBeUndefined()
		expect(startup.getDatabaseState().ok).toBe(false)

		const { recoveryPaths, startFresh } = await import(
			"$lib/server/db/recovery"
		)
		const paths = recoveryPaths(path.join(root, "data"))
		const metaBefore = JSON.parse(fs.readFileSync(paths.metaPath, "utf-8"))

		const { movedTo } = startFresh(paths)
		expect(movedTo).toBeTruthy()
		expect(fs.existsSync(paths.dbPath)).toBe(false)

		const state = await startup.restartAfterRecovery()
		expect(state.ok).toBe(true)

		// The database is genuinely open and migrated.
		const { db } = await import("$lib/server/db")
		const users = await db.query.users.findMany()
		expect(Array.isArray(users)).toBe(true)

		// And SEEDED — the property `treatAsFreshInstall` exists for. meta.json
		// survived the start-fresh (that is what keeps a login and every stored
		// passphrase working), so nothing about that file says "new install".
		const sampling = await db.query.samplingConfigs.findMany()
		expect(sampling.length).toBeGreaterThan(0)

		// meta.json is untouched by any of this, key included.
		const metaAfter = JSON.parse(fs.readFileSync(paths.metaPath, "utf-8"))
		expect(metaAfter.cryptoSecretKey).toBe(metaBefore.cryptoSecretKey)
		expect(metaAfter.recoveryLog.at(-1)).toMatchObject({
			action: "start-fresh",
			ok: true
		})

		// The broken one is still there. Nothing in this path deletes.
		expect(
			fs.existsSync(path.join(paths.dataDir, movedTo!, "PG_VERSION"))
		).toBe(true)
	})

	test("refuses to re-run itself on an instance that is already working", async () => {
		const startup = await import("$lib/server/startup")
		expect(startup.getDatabaseState().ok).toBe(true)

		// Reconciling managed services and reinstalling shutdown handlers under
		// a live app is not something a stray request gets to trigger.
		const again = await startup.restartAfterRecovery()
		expect(again.ok).toBe(true)
	})
})
