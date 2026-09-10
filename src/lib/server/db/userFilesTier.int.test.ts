/**
 * The optional second half of a backup: `<archive>.users.tgz` (ruled
 * 2026-09-10).
 *
 * Three properties, and each one is a way the tier could be quietly useless
 * rather than obviously broken.
 *
 * 1. **`cache/` is excluded at any depth.** The card-import cache is derived
 *    bytes (ruled 2026-09-09) and it is the largest thing under `users/` on an
 *    install that imports much. A tier that carried it would still restore
 *    correctly, so nothing would ever fail — it would just cost an owner
 *    gigabytes a day, forever, for files one import rebuilds.
 * 2. **The listing reports it.** A tier nobody can see is a tier nobody knows
 *    to restore, and a `.tgz` beside a dump is close enough to a backup that
 *    the naive listing would offer it as one — a restore that would refuse
 *    (no `PG_VERSION`) and a delete that would orphan the dump it belongs to.
 * 3. **Restore MOVES the tree it replaces.** This is the same rule the
 *    database restore keeps and it matters more here, not less: `users/` holds
 *    every image added since the backup was taken, and nothing else has a copy
 *    of those.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { backupDatabase } from "./backup"
import {
	BACKUP_USERS_SUFFIX,
	BROKEN_USERS_PREFIX,
	listBackups,
	packUserFiles,
	recoveryPaths,
	restoreBackup
} from "./recovery"

vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 })

let root: string

beforeAll(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-users-tier-"))
})

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true })
})

/**
 * A data directory with a `users/` tree that has media at two depths and a
 * `cache/` at two depths — one directly under a user, one buried further down,
 * because "excluded at any depth" is exactly the claim a top-level-only filter
 * would pass.
 */
function makeDataDir(name: string): string {
	const dataDir = path.join(root, name)
	fs.mkdirSync(dataDir, { recursive: true })
	fs.writeFileSync(
		path.join(dataDir, "meta.json"),
		JSON.stringify({ version: "0.6.0", cryptoSecretKey: "k" }, null, 2)
	)

	const users = path.join(dataDir, "users")
	fs.mkdirSync(path.join(users, "1", "media"), { recursive: true })
	fs.writeFileSync(path.join(users, "1", "media", "avatar.png"), "AVATAR")
	fs.mkdirSync(path.join(users, "1", "cache", "cards"), { recursive: true })
	fs.writeFileSync(
		path.join(users, "1", "cache", "cards", "import.png"),
		"REBUILDABLE"
	)
	fs.mkdirSync(path.join(users, "2", "media", "nested", "cache"), {
		recursive: true
	})
	fs.writeFileSync(
		path.join(users, "2", "media", "nested", "keep.webp"),
		"KEEP"
	)
	fs.writeFileSync(
		path.join(users, "2", "media", "nested", "cache", "deep.bin"),
		"ALSO REBUILDABLE"
	)
	return dataDir
}

/** Entry names inside a `.tgz`, via the system `tar`. */
async function listArchive(file: string): Promise<string[]> {
	const { execFileSync } = await import("node:child_process")
	return execFileSync("tar", ["-tzf", file], { encoding: "utf-8" })
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
}

describe("what the user-file tier carries", () => {
	test("everything under users/, except a cache/ at any depth", async () => {
		const dataDir = makeDataDir("pack")
		const out = path.join(dataDir, "dump.tgz")
		const packed = await packUserFiles(dataDir, out)

		expect(packed).not.toBeNull()
		expect(packed!.path).toBe(out + BACKUP_USERS_SUFFIX)
		expect(packed!.bytes).toBeGreaterThan(0)

		const names = await listArchive(packed!.path)
		expect(names).toContain("users/1/media/avatar.png")
		expect(names).toContain("users/2/media/nested/keep.webp")
		// Not one entry from either cache — not the files, and not the
		// directories that would have made a reader expect them.
		expect(names.filter((n) => n.includes("cache"))).toEqual([])
	})

	test("nothing at all when the install has no users/ directory", async () => {
		const dataDir = path.join(root, "no-users")
		fs.mkdirSync(dataDir, { recursive: true })
		const out = path.join(dataDir, "dump.tgz")

		expect(await packUserFiles(dataDir, out)).toBeNull()
		// An empty tier file would be a promise of media where there is none.
		expect(fs.existsSync(out + BACKUP_USERS_SUFFIX)).toBe(false)
	})
})

describe("what the listing says about it", () => {
	test("reports the tier beside a dump, and never lists it as a backup", async () => {
		const dataDir = makeDataDir("listing")
		const client = new PGlite()
		await client.waitReady
		const made = await backupDatabase(drizzle(client), {
			dataDir,
			label: "0.6.0",
			includeUserFiles: true
		})
		await client.close()

		expect(made.usersPath).toBe(made.path + BACKUP_USERS_SUFFIX)
		expect(made.usersBytes).toBeGreaterThan(0)

		const listed = listBackups(recoveryPaths(dataDir))
		// One row, not two: the tier is a `.tgz` in `backups/` too.
		expect(listed).toHaveLength(1)
		expect(listed[0].name).toBe(path.basename(made.path))
		expect(listed[0].hasUsers).toBe(true)
		expect(listed[0].usersBytes).toBe(made.usersBytes)
	})

	test("reports no tier when the backup was taken without one", async () => {
		const dataDir = makeDataDir("listing-plain")
		const client = new PGlite()
		await client.waitReady
		await backupDatabase(drizzle(client), { dataDir, label: "0.6.0" })
		await client.close()

		const listed = listBackups(recoveryPaths(dataDir))
		expect(listed).toHaveLength(1)
		expect(listed[0].hasUsers).toBe(false)
		expect(listed[0].usersBytes).toBe(0)
	})
})

describe("restoring a backup that carries user files", () => {
	test("moves the current users/ aside, then unpacks the archived one", async () => {
		const dataDir = makeDataDir("restore")
		const client = new PGlite(path.join(dataDir, "serene-pub.db"))
		await client.waitReady
		await client.exec(
			`CREATE TABLE keeper (id int, note text); INSERT INTO keeper VALUES (1, 'survives');`
		)
		const made = await backupDatabase(drizzle(client), {
			dataDir,
			label: "0.6.0",
			includeUserFiles: true
		})
		await client.close()

		// Everything about `users/` changes after the backup was taken: a file
		// is edited, and a file is added that the archive has never seen.
		const users = path.join(dataDir, "users")
		fs.writeFileSync(path.join(users, "1", "media", "avatar.png"), "NEWER")
		fs.writeFileSync(path.join(users, "1", "media", "added.png"), "AFTER")

		const paths = recoveryPaths(dataDir)
		const result = await restoreBackup(path.basename(made.path), paths)

		expect(result.usersRestored).toBe(true)
		expect(result.usersMovedTo).toMatch(
			new RegExp(`^${BROKEN_USERS_PREFIX.replace(/\./g, "\\.")}`)
		)

		// Moved, not deleted (ruling 4) — including the file that exists in no
		// backup anywhere, which is the whole reason it is a move.
		const aside = path.join(dataDir, result.usersMovedTo!)
		expect(
			fs.readFileSync(
				path.join(aside, "1", "media", "avatar.png"),
				"utf8"
			)
		).toBe("NEWER")
		expect(
			fs.readFileSync(path.join(aside, "1", "media", "added.png"), "utf8")
		).toBe("AFTER")

		// And the tree that is there now is the archived one, byte for byte.
		expect(
			fs.readFileSync(
				path.join(users, "1", "media", "avatar.png"),
				"utf8"
			)
		).toBe("AVATAR")
		expect(
			fs.readFileSync(
				path.join(users, "2", "media", "nested", "keep.webp"),
				"utf8"
			)
		).toBe("KEEP")
		// The cache was never archived, so a restore cannot bring it back.
		expect(fs.existsSync(path.join(users, "1", "cache"))).toBe(false)
		// No staging left lying around.
		expect(
			fs
				.readdirSync(dataDir)
				.filter((n) => n.startsWith("users.restoring-"))
		).toEqual([])
	})

	test("leaves users/ exactly as it is when the restore declines the tier", async () => {
		const dataDir = makeDataDir("restore-declined")
		const client = new PGlite(path.join(dataDir, "serene-pub.db"))
		await client.waitReady
		await client.exec(`CREATE TABLE keeper (id int)`)
		const made = await backupDatabase(drizzle(client), {
			dataDir,
			label: "0.6.0",
			includeUserFiles: true
		})
		await client.close()

		const users = path.join(dataDir, "users")
		fs.writeFileSync(path.join(users, "1", "media", "avatar.png"), "NEWER")

		const result = await restoreBackup(
			path.basename(made.path),
			recoveryPaths(dataDir),
			{ restoreUsers: false }
		)

		expect(result.usersRestored).toBe(false)
		expect(result.usersMovedTo).toBeNull()
		expect(
			fs.readFileSync(
				path.join(users, "1", "media", "avatar.png"),
				"utf8"
			)
		).toBe("NEWER")
		expect(
			fs
				.readdirSync(dataDir)
				.filter((n) => n.startsWith(BROKEN_USERS_PREFIX))
		).toEqual([])
	})
})
