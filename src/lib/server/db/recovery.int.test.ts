/**
 * Moving a real, really-broken data directory around.
 *
 * The fixture is not synthesised here: `probe-sp-data` is one of the data
 * directories collected on 2026-09-07 that a force-quit left unopenable, it is
 * 36 MB, and it fails with exactly the `RuntimeError: Aborted()` out of
 * `_pg_initdb` that `db/errors.ts` classifies. Every test copies it and works
 * on the copy — the original is somebody's evidence and this suite does not get
 * to spend it. Where it is absent (another machine, CI), these skip rather than
 * fabricate: a fabricated broken directory is already covered by
 * `unopenable.int.test.ts`, and what is under test here is the file moving, not
 * the classification.
 *
 * The property that matters most and is easiest to get wrong is the failing
 * restore. `PGlite.create({ loadDataDir })` handed something that is not an
 * archive does not fail — it runs `initdb` and hands back an empty database
 * that opens and answers queries. A restore that trusted "it opened" would
 * therefore replace a damaged database, which is still the owner's only copy of
 * everything since the last backup, with a blank one and call it a success.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { backupDatabase } from "./backup"
import {
	BACKUP_META_SUFFIX,
	BROKEN_DIR_PREFIX,
	RESTORE_FAILED_PREFIX,
	backupNow,
	deleteBackup,
	deleteBrokenDir,
	inspectArchive,
	listBackups,
	listBrokenDirs,
	packBrokenDir,
	readRecoveryLog,
	recoveryPaths,
	restoreBackup,
	startFresh
} from "./recovery"

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

/**
 * The real broken directory, kept outside the repo. Read-only to this file: it
 * is only ever the source of a `cp -a`.
 */
const FIXTURE =
	"/tmp/claude-1000/-home-jody-github-serene-pub/0ca0ac39-5cf4-4b38-9582-97b908f4ced5/scratchpad/probe-sp-data/data"

const haveFixture = fs.existsSync(path.join(FIXTURE, "serene-pub.db"))

let root: string
/** A good archive, made once from a database built for this file. */
let goodArchive: string
let goodArchiveMeta: string

beforeAll(async () => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-recovery-"))

	// A real dump, produced by the shipped backup path so the archive under
	// test is byte-for-byte the kind an install actually has.
	const sourceDir = path.join(root, "source")
	fs.mkdirSync(sourceDir, { recursive: true })
	fs.writeFileSync(
		path.join(sourceDir, "meta.json"),
		JSON.stringify(
			{
				version: "0.5.9",
				cryptoSecretKey: "archived-key",
				lock: { pid: 1 }
			},
			null,
			2
		)
	)
	const client = new PGlite(path.join(sourceDir, "serene-pub.db"))
	await client.waitReady
	await client.exec(
		`CREATE TABLE keeper (id int, note text); INSERT INTO keeper VALUES (1, 'survives');`
	)
	const db = drizzle(client)
	const made = await backupDatabase(db, {
		dataDir: sourceDir,
		label: "0.5.9"
	})
	await client.close()

	goodArchive = made.path
	goodArchiveMeta = made.path + BACKUP_META_SUFFIX
}, 120_000)

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true })
})

/** A fresh copy of the real broken data directory, with `backups/` populated. */
function brokenCopy(withBackup = true): string {
	const dir = fs.mkdtempSync(path.join(root, "case-"))
	fs.cpSync(FIXTURE, path.join(dir, "data"), { recursive: true })
	const dataDir = path.join(dir, "data")
	if (withBackup) {
		const backups = path.join(dataDir, "backups")
		fs.mkdirSync(backups, { recursive: true })
		fs.copyFileSync(
			goodArchive,
			path.join(backups, path.basename(goodArchive))
		)
		fs.copyFileSync(
			goodArchiveMeta,
			path.join(backups, path.basename(goodArchiveMeta))
		)
	}
	return dataDir
}

function names(dataDir: string): string[] {
	return fs.readdirSync(dataDir).sort()
}

describe("what a backup carries", () => {
	test("a companion meta.json beside the dump, without the live lock", () => {
		expect(fs.existsSync(goodArchiveMeta)).toBe(true)
		const meta = JSON.parse(fs.readFileSync(goodArchiveMeta, "utf-8"))
		expect(meta.cryptoSecretKey).toBe("archived-key")
		expect(meta.version).toBe("0.5.9")
		// A months-old lock in front of a future restore would be a lock nobody
		// holds and nothing can clear.
		expect(meta.lock).toBeUndefined()
	})

	test("and the archive itself is unchanged — still what PGlite produced", async () => {
		expect(fs.readFileSync(goodArchive).subarray(0, 2)).toEqual(
			Buffer.from([0x1f, 0x8b])
		)
		expect(await inspectArchive(goodArchive)).toEqual({ ok: true })
	})
})

describe("recognising an archive", () => {
	test("refuses a file that is not gzip at all", async () => {
		const junk = path.join(root, "not-gzip.tgz")
		fs.writeFileSync(junk, "this is a text file wearing a .tgz")
		const check = await inspectArchive(junk)
		expect(check.ok).toBe(false)
		expect(check.reason).toMatch(/gzip/)
	})

	test("refuses a gzip that is not a PostgreSQL data directory", async () => {
		const zlib = require("node:zlib")
		const wrong = path.join(root, "wrong-contents.tgz")
		fs.writeFileSync(wrong, zlib.gzipSync(Buffer.alloc(4096, 0x41)))
		const check = await inspectArchive(wrong)
		expect(check.ok).toBe(false)
		expect(check.reason).toMatch(/PG_VERSION|decompress/)
	})
})

describe.skipIf(!haveFixture)("restoring onto a real broken database", () => {
	test("moves the broken one aside, keeps meta.json, and opens", async () => {
		const dataDir = brokenCopy()
		const paths = recoveryPaths(dataDir)
		const before = JSON.parse(fs.readFileSync(paths.metaPath, "utf-8"))

		const result = await restoreBackup(path.basename(goodArchive), paths)

		// Moved, never deleted (ruling 4).
		expect(result.movedTo).toMatch(
			new RegExp(`^${BROKEN_DIR_PREFIX.replace(/\./g, "\\.")}`)
		)
		expect(fs.existsSync(path.join(dataDir, result.movedTo!))).toBe(true)
		expect(
			fs.existsSync(path.join(dataDir, result.movedTo!, "PG_VERSION"))
		).toBe(true)

		// And the restored one is genuinely the backup's content.
		const restored = new PGlite(paths.dbPath)
		await restored.waitReady
		const rows = await restored.query<{ note: string }>(
			"select note from keeper"
		)
		expect(rows.rows[0].note).toBe("survives")
		await restored.close()

		// meta.json is still there, still readable, and the key came across from
		// the companion — the passphrases inside the restored database were
		// encrypted with it.
		const after = JSON.parse(fs.readFileSync(paths.metaPath, "utf-8"))
		expect(result.metaRestored).toBe(true)
		expect(after.cryptoSecretKey).toBe("archived-key")
		// The one it replaced is kept, never overwritten.
		expect(result.previousMetaAt).not.toBeNull()
		const kept = JSON.parse(
			fs.readFileSync(path.join(dataDir, result.previousMetaAt!), "utf-8")
		)
		expect(kept.cryptoSecretKey).toBe(before.cryptoSecretKey)

		const log = readRecoveryLog(paths)
		expect(log.at(-1)).toMatchObject({
			action: "restore",
			from: path.basename(goodArchive),
			ok: true
		})
	})

	test("a garbage archive changes nothing, and leaves the attempt behind", async () => {
		const dataDir = brokenCopy(false)
		const paths = recoveryPaths(dataDir)
		fs.mkdirSync(paths.backupsDir, { recursive: true })
		const bad = path.join(paths.backupsDir, "serene-pub-garbage.tgz")
		fs.writeFileSync(bad, "not an archive, not even gzip")

		const beforeNames = names(dataDir)
		const beforeMeta = fs.readFileSync(paths.metaPath, "utf-8")

		await expect(
			restoreBackup("serene-pub-garbage.tgz", paths)
		).rejects.toThrow(/not a usable backup/)

		// The live database is exactly where it was — not moved aside, not
		// replaced by the empty database PGlite would have made from that blob.
		expect(fs.existsSync(paths.dbPath)).toBe(true)
		expect(fs.readdirSync(paths.dbPath)).toContain("PG_VERSION")
		expect(
			beforeNames.filter((n) => n.startsWith(BROKEN_DIR_PREFIX))
		).toHaveLength(0)
		expect(
			names(dataDir).filter((n) => n.startsWith(BROKEN_DIR_PREFIX))
		).toHaveLength(0)

		// The evidence of the attempt is kept.
		const failed = names(dataDir).filter((n) =>
			n.startsWith(RESTORE_FAILED_PREFIX)
		)
		expect(failed).toHaveLength(1)

		// meta.json's key survived untouched, and the failure is on the record.
		const after = JSON.parse(fs.readFileSync(paths.metaPath, "utf-8"))
		expect(after.cryptoSecretKey).toBe(
			JSON.parse(beforeMeta).cryptoSecretKey
		)
		expect(readRecoveryLog(paths).at(-1)).toMatchObject({
			action: "restore",
			ok: false
		})
	})

	test("refuses a name that points outside backups/", async () => {
		const dataDir = brokenCopy(false)
		const paths = recoveryPaths(dataDir)
		for (const name of [
			"../meta.json.tgz",
			"../../etc/passwd.tgz",
			"sub/dir.tgz"
		]) {
			await expect(restoreBackup(name, paths)).rejects.toThrow(
				/plain filename|outside/
			)
		}
		// Nothing was created on the way to refusing.
		expect(names(dataDir).filter((n) => n.includes("restor"))).toHaveLength(
			0
		)
	})
})

describe.skipIf(!haveFixture)("starting fresh", () => {
	test("moves the database aside and leaves the next open to create one", async () => {
		const dataDir = brokenCopy(false)
		const paths = recoveryPaths(dataDir)

		const { movedTo } = startFresh(paths)

		expect(movedTo).toMatch(
			new RegExp(`^${BROKEN_DIR_PREFIX.replace(/\./g, "\\.")}`)
		)
		expect(fs.existsSync(paths.dbPath)).toBe(false)
		expect(fs.existsSync(path.join(dataDir, movedTo!))).toBe(true)
		// meta.json is deliberately untouched: it is what keeps a login and
		// every stored passphrase working across a start-fresh.
		expect(fs.existsSync(paths.metaPath)).toBe(true)

		// "The next open creates one" is the whole design — nothing here runs
		// initdb, `db/index.ts` does, by opening a path that is not there.
		const created = new PGlite(paths.dbPath)
		await created.waitReady
		const rows = await created.query<{ ok: number }>("select 1 as ok")
		expect(rows.rows[0].ok).toBe(1)
		await created.close()

		expect(readRecoveryLog(paths).at(-1)).toMatchObject({
			action: "start-fresh",
			ok: true
		})
	})
})

describe.skipIf(!haveFixture)("listing and deleting", () => {
	test("lists backups newest first, with sizes and whether meta came along", () => {
		const dataDir = brokenCopy()
		const paths = recoveryPaths(dataDir)
		// A stray file in the folder must not be offered as something to
		// restore from.
		fs.writeFileSync(path.join(paths.backupsDir, "notes.txt"), "hello")

		const list = listBackups(paths)
		expect(list).toHaveLength(1)
		expect(list[0].name).toBe(path.basename(goodArchive))
		expect(list[0].hasMeta).toBe(true)
		expect(list[0].bytes).toBeGreaterThan(1024)
	})

	test("delete removes only the named file and its companion", () => {
		const dataDir = brokenCopy()
		const paths = recoveryPaths(dataDir)
		const other = path.join(paths.backupsDir, "serene-pub-other.tgz")
		fs.copyFileSync(goodArchive, other)

		deleteBackup(path.basename(goodArchive), paths)

		expect(fs.existsSync(other)).toBe(true)
		expect(
			fs.existsSync(
				path.join(paths.backupsDir, path.basename(goodArchive))
			)
		).toBe(false)
		expect(
			fs.existsSync(
				path.join(paths.backupsDir, path.basename(goodArchiveMeta))
			)
		).toBe(false)
		expect(readRecoveryLog(paths).at(-1)).toMatchObject({
			action: "delete-backup",
			ok: true
		})
	})

	test("a name with .. or a separator is refused", () => {
		const dataDir = brokenCopy()
		const paths = recoveryPaths(dataDir)
		for (const name of ["../meta.json.tgz", "a/b.tgz", "..", "."]) {
			expect(() => deleteBackup(name, paths)).toThrow()
		}
		expect(fs.existsSync(paths.metaPath)).toBe(true)
		expect(listBackups(paths)).toHaveLength(1)
	})

	test("set-aside directories are listed, downloadable and deletable", async () => {
		const dataDir = brokenCopy(false)
		const paths = recoveryPaths(dataDir)
		const { movedTo } = startFresh(paths)

		const dirs = listBrokenDirs(paths)
		expect(dirs.map((d) => d.name)).toEqual([movedTo])
		expect(dirs[0].kind).toBe("broken")
		expect(dirs[0].bytes).toBeGreaterThan(1024 * 1024)

		// The download is a real gzip stream of that directory.
		const packed = packBrokenDir(movedTo!, paths)
		expect(packed.filename).toBe(`${movedTo}.tgz`)
		const chunks: Buffer[] = []
		for await (const chunk of packed.stream) chunks.push(chunk as Buffer)
		const tgz = Buffer.concat(chunks)
		expect(tgz.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]))
		const zlib = require("node:zlib")
		const unpacked: Buffer = zlib.gunzipSync(tgz)
		expect(unpacked.subarray(0, 512).toString("latin1")).toContain(movedTo)
		expect(unpacked.subarray(257, 263).toString("latin1")).toBe("ustar\0")

		deleteBrokenDir(movedTo!, paths)
		expect(fs.existsSync(path.join(dataDir, movedTo!))).toBe(false)
		expect(listBrokenDirs(paths)).toHaveLength(0)
	})

	test("only a set-aside directory can be deleted or downloaded", () => {
		const dataDir = brokenCopy(false)
		const paths = recoveryPaths(dataDir)
		for (const name of ["serene-pub.db", "backups", "..", "../data"]) {
			expect(() => deleteBrokenDir(name, paths)).toThrow()
			expect(() => packBrokenDir(name, paths)).toThrow()
		}
		expect(fs.existsSync(paths.dbPath)).toBe(true)
	})
})

describe("backing up on demand", () => {
	test("writes an archive with its meta.json companion, and logs it", async () => {
		const dataDir = fs.mkdtempSync(path.join(root, "manual-"))
		fs.writeFileSync(
			path.join(dataDir, "meta.json"),
			JSON.stringify({ version: "0.6.0", cryptoSecretKey: "live-key" })
		)
		const client = new PGlite()
		await client.waitReady
		const db = drizzle(client)

		const entry = await backupNow({
			label: "manual",
			paths: recoveryPaths(dataDir),
			db
		})
		await client.close()

		expect(entry.name).toMatch(/^serene-pub-manual-.*\.tgz$/)
		expect(entry.hasMeta).toBe(true)
		expect(entry.bytes).toBeGreaterThan(1024)
		expect(
			JSON.parse(
				fs.readFileSync(entry.path + BACKUP_META_SUFFIX, "utf-8")
			).cryptoSecretKey
		).toBe("live-key")
		expect(listBackups(recoveryPaths(dataDir))).toHaveLength(1)
		expect(readRecoveryLog(recoveryPaths(dataDir)).at(-1)).toMatchObject({
			action: "backup",
			ok: true
		})
	}, 120_000)
})

/**
 * Whether `tar` is on this machine. The archive has to be readable by the tool
 * the troubleshooting guide tells people to use, and asserting that against a
 * hand-rolled reader would only prove the reader agrees with the writer.
 */
const haveTar = (() => {
	try {
		execFileSync("tar", ["--version"], { stdio: "ignore" })
		return true
	} catch {
		return false
	}
})()

describe.skipIf(!haveTar)("the download of a set-aside database", () => {
	test("is a tgz system tar reads, and extracts byte for byte", async () => {
		const name = "serene-pub.db.broken-2026-01-01T00-00-00"
		const dataDir = fs.mkdtempSync(path.join(root, "pack-"))
		const src = path.join(dataDir, name)
		fs.mkdirSync(path.join(src, "base", "16384"), { recursive: true })
		fs.writeFileSync(path.join(src, "PG_VERSION"), "16\n")
		fs.writeFileSync(
			path.join(src, "base", "16384", "1259"),
			Buffer.alloc(8192, 7)
		)
		fs.writeFileSync(
			path.join(src, "postgresql.conf"),
			"# hello\n".repeat(300)
		)
		// Empty directories have to survive: PostgreSQL will not start without
		// pg_wal/archive_status and its siblings, whether or not they hold
		// anything.
		fs.mkdirSync(path.join(src, "pg_wal", "archive_status"), {
			recursive: true
		})
		// Long enough that ustar has to split the path across its prefix field,
		// and split it somewhere other than the last separator.
		const deep = path.join(src, "a".repeat(60), "b".repeat(60))
		fs.mkdirSync(deep, { recursive: true })
		fs.writeFileSync(path.join(deep, "c".repeat(30)), "deep")

		const out = path.join(dataDir, "out.tgz")
		const write = fs.createWriteStream(out)
		packBrokenDir(name, recoveryPaths(dataDir)).stream.pipe(write)
		await new Promise<void>((resolve) => write.on("close", () => resolve()))

		const listed = execFileSync("tar", ["-tzf", out], { encoding: "utf-8" })
		expect(listed).toContain(`${name}/PG_VERSION`)
		expect(listed).toContain(`${name}/base/16384/1259`)
		expect(listed).toContain(`${name}/pg_wal/archive_status/`)

		const dest = path.join(dataDir, "extracted")
		fs.mkdirSync(dest)
		execFileSync("tar", ["-xzf", out, "-C", dest])
		expect(
			fs.readFileSync(path.join(dest, name, "PG_VERSION"), "utf-8")
		).toBe("16\n")
		expect(
			fs.readFileSync(path.join(dest, name, "base/16384/1259"))
		).toEqual(Buffer.alloc(8192, 7))
		expect(
			fs.readFileSync(path.join(dest, name, "postgresql.conf"), "utf-8")
		).toBe("# hello\n".repeat(300))
		expect(
			fs.readFileSync(
				path.join(
					dest,
					name,
					"a".repeat(60),
					"b".repeat(60),
					"c".repeat(30)
				),
				"utf-8"
			)
		).toBe("deep")
	})
})
