/**
 * A 0.5.3 database restored through 0.6's own recovery enters the same
 * upgrade a first boot over a 0.5.3 folder does (plan E4.7, E4.13).
 *
 * The install here is a real 0.6 one — every migration applied, `meta.json`
 * at the app's version — and the archives are the tiny fixture's dump, which
 * is byte for byte what PGlite's `dumpDataDir()` writes:
 *
 *   · **raw** — no companion `.meta.json` (0.5.3 had no backup feature, so a
 *     hand-made archive never has one). The live `meta.json` is kept, so the
 *     versions compare equal and the version gate alone would skip the
 *     upgrade; the pending-migrations check is what must catch it.
 *   · **with its companion** — `version: "0.5.3-beta"` and the 0.5.3 key cross
 *     over, the gate sees an older version, and the boot migrates.
 *
 * The second archive is then booted through the app's database module, which
 * stashes the attic; a backup taken in that state (an interrupted upgrade, the
 * one way an attic reaches `backups/`) must still pass `inspectArchive`, and
 * the upgrade must then finish.
 */
import { beforeAll, describe, expect, test } from "vitest"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { sql } from "drizzle-orm"
import { rawRows } from "$lib/server/db/rawRows"
import { hasPendingMigrations } from "$lib/server/db/backup"
import {
	BACKUP_META_SUFFIX,
	inspectArchive,
	listBackups,
	recoveryPaths,
	restoreBackup
} from "$lib/server/db/recovery"
import { compareVersions } from "$lib/shared/utils/releaseChannel"
import { FIXTURES, fixtureManifest, runUpgradeTasks } from "./testFixture"
import { ATTIC_SCHEMA, atticExists } from "./index"

const TINY = path.join(FIXTURES, "tiny")
const MIGRATIONS = path.resolve(process.cwd(), "drizzle")
const APP_VERSION: string = JSON.parse(
	fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")
).version
const LIVE_KEY = "0-6-install-key"
const manifest = fixtureManifest("tiny")

let dataDir: string
let paths: ReturnType<typeof recoveryPaths>

const readMeta = () => JSON.parse(fs.readFileSync(paths.metaPath, "utf8"))

async function withDatabase<T>(fn: (db: any) => Promise<T>): Promise<T> {
	const client = new PGlite(paths.dbPath)
	try {
		return await fn(drizzle(client))
	} finally {
		await client.close()
	}
}

/** Copy the tiny fixture's dump into `backups/` under `name`. */
function stageArchive(name: string, meta?: Record<string, unknown>): string {
	const target = path.join(paths.backupsDir, name)
	fs.copyFileSync(path.join(TINY, "serene-pub.db.tgz"), target)
	if (meta) fs.writeFileSync(target + BACKUP_META_SUFFIX, JSON.stringify(meta))
	return target
}

beforeAll(async () => {
	const appDataDir = process.env.SERENE_PUB_DATA_DIR
	if (!appDataDir) throw new Error("vitest.setup.ts did not set SERENE_PUB_DATA_DIR")
	dataDir = path.join(appDataDir, "data")
	paths = recoveryPaths(dataDir)
	fs.mkdirSync(paths.backupsDir, { recursive: true })

	// A 0.6 install: the whole chain applied, meta.json at this version.
	await withDatabase((db) => migrate(db, { migrationsFolder: MIGRATIONS }))
	fs.writeFileSync(
		paths.metaPath,
		JSON.stringify({ version: APP_VERSION, cryptoSecretKey: LIVE_KEY }, null, 2)
	)
	await withDatabase(async (db) => {
		expect(await hasPendingMigrations(db, MIGRATIONS)).toBe(false)
	})
}, 300_000)

describe("restoring a raw 0.5.3 archive (no companion meta.json)", () => {
	test("is a usable archive, and the restore keeps the live meta.json", async () => {
		const name = "serene-pub-0.5.3-raw.tgz"
		expect(await inspectArchive(stageArchive(name))).toEqual({ ok: true })

		const result = await restoreBackup(name, paths, { restoreUsers: false })
		expect(result.metaRestored).toBe(false)
		expect(result.movedTo).not.toBeNull()
		expect(readMeta()).toMatchObject({ version: APP_VERSION, cryptoSecretKey: LIVE_KEY })
	}, 300_000)

	test("the version gate says 'equal', and the pending-migrations check catches it", async () => {
		expect(compareVersions(readMeta().version, APP_VERSION)).toBe(0)
		await withDatabase(async (db) => {
			const tables = rawRows<{ table_name: string }>(
				await db.execute(
					sql.raw(`SELECT table_name FROM information_schema.tables
						WHERE table_schema = 'public' AND table_name IN ('chats', 'sessions')`)
				)
			).map((r) => r.table_name)
			expect(tables).toEqual(["chats"])
			expect(await hasPendingMigrations(db, MIGRATIONS)).toBe(true)
		})
	}, 300_000)
})

describe("restoring a 0.5.3 archive with its companion meta.json", () => {
	test("carries 0.5.3's version and key, so the gate sees an older install", async () => {
		const secret = JSON.parse(fs.readFileSync(path.join(TINY, "meta.json"), "utf8"))
			.cryptoSecretKey
		const name = "serene-pub-0.5.3-beta-companion.tgz"
		stageArchive(name, { version: "0.5.3-beta", cryptoSecretKey: secret })

		const result = await restoreBackup(name, paths, { restoreUsers: false })
		expect(result.metaRestored).toBe(true)
		expect(readMeta()).toMatchObject({ version: "0.5.3-beta", cryptoSecretKey: secret })
		expect(compareVersions("0.5.3-beta", APP_VERSION)).toBe(-1)
		await withDatabase(async (db) => {
			expect(await hasPendingMigrations(db, MIGRATIONS)).toBe(true)
		})
	}, 300_000)
})

describe("booting the restored database", () => {
	let db: Db

	beforeAll(async () => {
		// The user files a 0.5.3 owner copies across beside the database.
		execFileSync("tar", ["xzf", path.join(TINY, "users.tgz"), "-C", dataDir])
		const mod = await import("$lib/server/db")
		await mod.dbReady
		db = mod.db as unknown as Db
	}, 300_000)

	test("stashes the attic, and a backup taken in that state is a usable archive", async () => {
		expect(await atticExists(db)).toBe(true)

		const { backupNow } = await import("$lib/server/db/recovery")
		const made = await backupNow({
			label: "attic-pending",
			paths,
			db: db as any,
			includeUserFiles: false
		})
		expect(await inspectArchive(made.path)).toEqual({ ok: true })
		expect(listBackups(paths).map((b) => b.name)).toContain(path.basename(made.path))
	}, 300_000)

	test("then finishes the upgrade: the chat is a session and the attic is gone", async () => {
		const run = await runUpgradeTasks(db)
		expect(run.restore?.alreadyRestored).toBe(false)
		expect(await atticExists(db)).toBe(false)
		const [{ n }] = rawRows<{ n: number }>(
			await db.execute(sql.raw(`SELECT count(*)::int AS n FROM sessions`))
		)
		expect(n).toBe(manifest.counts.chats)
		const schemas = rawRows<{ schema_name: string }>(
			await db.execute(
				sql`SELECT schema_name FROM information_schema.schemata WHERE schema_name = ${ATTIC_SCHEMA}`
			)
		)
		expect(schemas).toEqual([])
	}, 300_000)
})
