/**
 * The daily backup's one decision: is a backup due?
 *
 * Everything else about this service — the timer, the registration, the log
 * line — is machinery around that question, and the question is where it can be
 * wrong in a way nobody notices for months. Wrong in one direction and an
 * install quietly stops backing up; wrong in the other and every hourly tick
 * writes another multi-megabyte dump of a database that has not changed.
 *
 * The database is a real one built from the real migrations, deliberately: the
 * settings this reads are two columns 0112 adds, and a test that stubbed them
 * would pass just as happily against a migration that never ran.
 */
import {
	beforeAll,
	afterAll,
	afterEach,
	describe,
	expect,
	it,
	vi
} from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { sql } from "drizzle-orm"
import { createTestDb, type TestDb } from "$lib/server/utils/testDb"
import { listBackups, recoveryPaths } from "$lib/server/db/recovery"
import { BACKUP_AGE_MS, maybeTakeDailyBackup } from "./dailyBackup"

vi.mock("$lib/server/embedding", () => ({
	isModelReady: () => false,
	getLoadedModelId: () => null,
	embed: async () => [],
	batchEmbed: async () => []
}))

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

let db: TestDb
let root: string

beforeAll(async () => {
	db = await createTestDb()
	root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-daily-backup-"))
	// `system_settings` is seeded at boot, not by a migration, so the row this
	// reads is written here the way `defaults.ts` would write it.
	await db.execute(sql.raw(`insert into system_settings (id) values (1)`))
}, 120_000)

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true })
})

afterEach(async () => {
	await db.execute(
		sql.raw(
			`update system_settings set backup_daily = true, backup_include_user_files = false`
		)
	)
})

/** A data directory with a `meta.json` and an empty `backups/`. */
function makeDataDir(name: string): string {
	const dataDir = path.join(root, name)
	fs.mkdirSync(path.join(dataDir, "backups"), { recursive: true })
	fs.writeFileSync(
		path.join(dataDir, "meta.json"),
		JSON.stringify({ version: "0.6.0", cryptoSecretKey: "k" }, null, 2)
	)
	return dataDir
}

/** A file in `backups/` that is `ageMs` old, without taking a real backup. */
function plantBackup(dataDir: string, ageMs: number): string {
	const name = "serene-pub-0.6.0-planted.tgz"
	const file = path.join(dataDir, "backups", name)
	fs.writeFileSync(file, "not a real dump, and never opened by this test")
	const at = new Date(Date.now() - ageMs)
	fs.utimesSync(file, at, at)
	return name
}

describe("the migration that carries the settings", () => {
	it("gives a seeded row the ruled defaults: daily on, user files off", async () => {
		const row = await db.query.systemSettings.findFirst({
			columns: { backupDaily: true, backupIncludeUserFiles: true }
		})
		expect(row?.backupDaily).toBe(true)
		expect(row?.backupIncludeUserFiles).toBe(false)
	})
})

describe("when the daily check takes a backup", () => {
	it("takes one when there is no backup at all", async () => {
		const dataDir = makeDataDir("none")
		const outcome = await maybeTakeDailyBackup({
			db,
			paths: recoveryPaths(dataDir),
			activeRuns: () => 0
		})

		expect(outcome).toBe("taken")
		const listed = listBackups(recoveryPaths(dataDir))
		expect(listed).toHaveLength(1)
		expect(listed[0].name).toContain("daily")
		// Off by default, so the dump travels alone.
		expect(listed[0].hasUsers).toBe(false)
	})

	it("takes one when the newest backup is older than a day", async () => {
		const dataDir = makeDataDir("stale")
		const planted = plantBackup(dataDir, BACKUP_AGE_MS + 60_000)

		const outcome = await maybeTakeDailyBackup({
			db,
			paths: recoveryPaths(dataDir),
			activeRuns: () => 0
		})

		expect(outcome).toBe("taken")
		const listed = listBackups(recoveryPaths(dataDir))
		// The stale one is still there — nothing is ever culled (ruling 4).
		expect(listed.map((b) => b.name)).toContain(planted)
		expect(listed).toHaveLength(2)
	})

	it("takes none when the newest backup is younger than a day", async () => {
		const dataDir = makeDataDir("fresh")
		plantBackup(dataDir, BACKUP_AGE_MS - 60_000)

		const outcome = await maybeTakeDailyBackup({
			db,
			paths: recoveryPaths(dataDir),
			activeRuns: () => 0
		})

		expect(outcome).toBe("fresh")
		expect(listBackups(recoveryPaths(dataDir))).toHaveLength(1)
	})

	it("takes none when daily backups are switched off", async () => {
		const dataDir = makeDataDir("disabled")
		await db.execute(
			sql.raw(`update system_settings set backup_daily = false`)
		)

		const outcome = await maybeTakeDailyBackup({
			db,
			paths: recoveryPaths(dataDir),
			activeRuns: () => 0
		})

		expect(outcome).toBe("disabled")
		expect(listBackups(recoveryPaths(dataDir))).toHaveLength(0)
	})

	it("waits out an hour rather than stalling a run in flight", async () => {
		const dataDir = makeDataDir("busy")

		const outcome = await maybeTakeDailyBackup({
			db,
			paths: recoveryPaths(dataDir),
			activeRuns: () => 1
		})

		expect(outcome).toBe("busy")
		expect(listBackups(recoveryPaths(dataDir))).toHaveLength(0)
	})

	it("leaves meta.json's recoveryLog alone", async () => {
		// The log is capped at 200 entries and holds the times something moved
		// a data directory around. A line a day would evict every real recovery
		// action inside seven months — and it did: this is what broke
		// `startup/recoveryRestart.int.test.ts`, whose last log entry stopped
		// being the start-fresh it had just performed.
		const dataDir = makeDataDir("quiet-log")
		const before = fs.readFileSync(path.join(dataDir, "meta.json"), "utf-8")

		expect(
			await maybeTakeDailyBackup({
				db,
				paths: recoveryPaths(dataDir),
				activeRuns: () => 0
			})
		).toBe("taken")

		expect(fs.readFileSync(path.join(dataDir, "meta.json"), "utf-8")).toBe(
			before
		)
	})

	it("carries the user-file tier when the setting asks for it", async () => {
		const dataDir = makeDataDir("with-users")
		fs.mkdirSync(path.join(dataDir, "users", "1", "media"), {
			recursive: true
		})
		fs.writeFileSync(
			path.join(dataDir, "users", "1", "media", "avatar.png"),
			"AVATAR"
		)
		await db.execute(
			sql.raw(
				`update system_settings set backup_include_user_files = true`
			)
		)

		const outcome = await maybeTakeDailyBackup({
			db,
			paths: recoveryPaths(dataDir),
			activeRuns: () => 0
		})

		expect(outcome).toBe("taken")
		const [backup] = listBackups(recoveryPaths(dataDir))
		expect(backup.hasUsers).toBe(true)
		expect(backup.usersBytes).toBeGreaterThan(0)
	})

	it("answers an outcome rather than throwing when the backup fails", async () => {
		// A data directory that cannot be written to is the shape of every
		// real failure here — a full disk, a read-only mount, a container
		// volume that went away. None of them may cost a boot.
		//
		// A regular FILE standing where the data directory should be is the
		// portable way to produce one: `mkdir` under it is ENOTDIR on every
		// platform, and unlike a permission bit it is not waived for a
		// root-running CI container.
		const notADir = path.join(root, "a-file-not-a-directory")
		fs.writeFileSync(notADir, "not a directory")
		const outcome = await maybeTakeDailyBackup({
			db,
			paths: recoveryPaths(notADir),
			activeRuns: () => 0
		})

		expect(outcome).toBe("failed")
	})
})
