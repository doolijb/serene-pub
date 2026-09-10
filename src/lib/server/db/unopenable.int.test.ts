/**
 * A data directory that will not open.
 *
 * A force-quit or an OOM kill can leave the PGlite directory in a state its
 * WASM Postgres refuses to start on. The failure is a raw WASM trap —
 * `RuntimeError: Aborted()` raised from `_pg_initdb` — with no error code, no
 * SQLSTATE, and nothing else to test, so the signature *is* the assertion here.
 * Four of five real data directories collected on 2026-09-07 fail this way; the
 * corruption below reproduces the identical name, message and frame in about
 * three seconds, which is why the suite does not carry a 34 MB fixture.
 *
 * The distinction these exist to protect: an unopenable directory is a state
 * the app boots into and explains, while a directory another live process is
 * holding is still an immediate refusal to start. Merging the two would either
 * turn a double-open into "your database is broken" or turn a broken database
 * into a silent exit.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi
} from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { checkDatabaseLock, getIdentity, writeMetaFile } from "./lock.js"
import { summariseBackups } from "./backup"
import {
	DatabaseUnopenableError,
	classifyDatabaseOpenFailure,
	describeDatabaseUnopenable,
	isDatabaseUnopenableError,
	isPgliteOpenAbort
} from "./errors"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

let root: string
let dataDir: string
let dbPath: string
/** The real trap, captured once — every assertion below is about this object. */
let abortError: unknown

/**
 * Build a real database, then take `global/pg_control` away from it.
 *
 * Chosen out of four corruptions tried against a freshly built directory
 * because it is the only one that reproduces the *exact* message the real
 * broken directories carry. Zeroing the same file, or writing a bad
 * `PG_VERSION`, traps in `_pg_initdb` too but says "unreachable" instead — the
 * second case below, so the classifier is not fitted to one string.
 */
beforeAll(async () => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-unopenable-"))
	dataDir = path.join(root, "data")
	fs.mkdirSync(dataDir, { recursive: true })
	dbPath = path.join(dataDir, "serene-pub.db")

	const pg = new PGlite(dbPath)
	await pg.waitReady
	await pg.exec(
		`CREATE TABLE keepsake (id int); INSERT INTO keepsake VALUES (1);`
	)
	await pg.close()

	fs.writeFileSync(path.join(dbPath, "global", "pg_control"), "")

	// Backups to be found, so the error's summary has something to report.
	// Stamped explicitly: written back to back they share a millisecond, and
	// "newest" then depends on directory order rather than on age.
	const backups = path.join(dataDir, "backups")
	fs.mkdirSync(backups, { recursive: true })
	for (const [name, when] of [
		["serene-pub-0.5.0-2026-01-01T00-00-00.tgz", "2026-01-01T00:00:00Z"],
		["serene-pub-0.5.9-2026-02-02T00-00-00.tgz", "2026-02-02T00:00:00Z"],
		// Not a dump, so not counted — a stray file in the folder must not be
		// offered to somebody about to restore from it.
		["notes.txt", "2026-03-03T00:00:00Z"]
	]) {
		const file = path.join(backups, name)
		fs.writeFileSync(file, name)
		const at = new Date(when)
		fs.utimesSync(file, at, at)
	}

	abortError = await captureOpenFailure(dbPath)
})

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true })
})

async function captureOpenFailure(dir: string): Promise<unknown> {
	const db = drizzle(dir, {})
	try {
		await (db as unknown as { $client: { waitReady: Promise<unknown> } })
			.$client.waitReady
	} catch (error) {
		return error
	}
	throw new Error(`expected ${dir} to refuse to open, but it opened`)
}

function context(overrides: Record<string, unknown> = {}) {
	return {
		dataDir,
		dbPath,
		lockState: "free" as const,
		lastShutdown: "unclean" as const,
		backups: summariseBackups(dataDir),
		...overrides
	}
}

describe("the failure signature", () => {
	test("is a RuntimeError raised from _pg_initdb", () => {
		const error = abortError as Error
		expect(error.name).toBe("RuntimeError")
		expect(error.message).toContain("Aborted(")
		expect(error.stack).toContain("_pg_initdb")
		expect(isPgliteOpenAbort(error)).toBe(true)
	})

	test("also covers the 'unreachable' trap the same call raises", async () => {
		const shell = path.join(root, "not-a-database")
		fs.mkdirSync(shell, { recursive: true })
		fs.writeFileSync(path.join(shell, "PG_VERSION"), "16\n")

		const error = (await captureOpenFailure(shell)) as Error
		expect(error.message).toContain("unreachable")
		expect(error.stack).toContain("_pg_initdb")
		expect(isPgliteOpenAbort(error)).toBe(true)
	})

	test("does not match an ordinary query error", () => {
		expect(
			isPgliteOpenAbort(new Error(`relation "x" does not exist`))
		).toBe(false)
	})

	test("does not match a trap raised somewhere other than the open", () => {
		const later = new Error(
			"Aborted(). Build with -sASSERTIONS for more info."
		)
		later.name = "RuntimeError"
		later.stack = "RuntimeError: Aborted()\n    at Module._pg_exec (pglite)"
		expect(isPgliteOpenAbort(later)).toBe(false)
	})
})

describe("classifying an open failure", () => {
	test("carries the data directory, the database and the backups", () => {
		const classified = classifyDatabaseOpenFailure(abortError, context())

		expect(classified).toBeInstanceOf(DatabaseUnopenableError)
		expect(isDatabaseUnopenableError(classified)).toBe(true)
		expect(classified!.dataDir).toBe(dataDir)
		expect(classified!.dbPath).toBe(dbPath)
		expect(classified!.backupsDir).toBe(path.join(dataDir, "backups"))
		expect(classified!.backupCount).toBe(2)
		expect(classified!.newestBackup).toBe(
			"serene-pub-0.5.9-2026-02-02T00-00-00.tgz"
		)
		expect(classified!.lastShutdown).toBe("unclean")
		expect(classified!.cause).toBe(abortError)
	})

	test("says all of that in plain language", () => {
		const text = describeDatabaseUnopenable(
			classifyDatabaseOpenFailure(abortError, context())!
		)
		expect(text).toContain(dataDir)
		expect(text).toContain(path.join(dataDir, "backups"))
		expect(text).toContain("serene-pub-0.5.9-2026-02-02T00-00-00.tgz")
		expect(text).toContain("docs/troubleshooting.md#database-wont-open")
		expect(text.toLowerCase()).toContain("nothing has been changed")
		expect(text.split("\n").length).toBeGreaterThan(3)
	})

	test("leaves any other error alone", () => {
		expect(
			classifyDatabaseOpenFailure(
				new Error("connection refused"),
				context()
			)
		).toBeNull()
	})

	test("declines when there is no database directory to blame", () => {
		const empty = fs.mkdtempSync(
			path.join(os.tmpdir(), "sp-unopenable-none-")
		)
		try {
			expect(
				classifyDatabaseOpenFailure(
					abortError,
					context({
						dataDir: empty,
						dbPath: path.join(empty, "serene-pub.db"),
						backups: summariseBackups(empty)
					})
				)
			).toBeNull()
		} finally {
			fs.rmSync(empty, { recursive: true, force: true })
		}
	})

	test("declines while another process holds the lock", () => {
		expect(
			classifyDatabaseOpenFailure(
				abortError,
				context({ lockState: "held" })
			)
		).toBeNull()
	})

	test("declines on this process's own lock (a dev module re-execution)", () => {
		// PGlite refuses a second open of one directory in one process with the
		// same trap. That is the dev-reload problem named in db/index.ts, not a
		// damaged directory, and calling it one would send the developer to a
		// restore page over a dev-server restart.
		expect(
			classifyDatabaseOpenFailure(
				abortError,
				context({ lockState: "self" })
			)
		).toBeNull()
	})
})

describe("a lock somebody else holds", () => {
	let holder: ChildProcess | null = null

	afterEach(async () => {
		if (!holder) return
		const child = holder
		holder = null
		const exited = new Promise<void>((resolve) =>
			child.once("exit", () => resolve())
		)
		child.kill("SIGKILL")
		await exited
	})

	test("still refuses to start, rather than reporting a broken database", async () => {
		// A genuinely live process on this host: `evaluateLock` asks the OS
		// whether this pid is running, so a fabricated number would be read as
		// stale and prove nothing.
		holder = spawn(
			process.execPath,
			["-e", "setTimeout(() => {}, 60000)"],
			{
				stdio: "ignore"
			}
		)
		const me = getIdentity()
		const metaPath = path.join(dataDir, "meta.json")
		writeMetaFile(metaPath, {
			version: "0.6.0",
			cryptoSecretKey: "keep-me",
			lock: {
				timestamp: Date.now(),
				lockLength: 10_000,
				owner: {
					pid: holder.pid,
					hostId: me.hostId,
					hostname: me.hostname,
					instanceId: "someone-else",
					label: "app"
				}
			}
		})

		const result = await checkDatabaseLock({
			metaPath,
			waitTimeout: 0,
			log: { log: () => {}, warn: () => {} }
		})

		// `acquireDatabaseLock()` prints this and exits(1); the database is
		// never opened, so the classifier is never reached at all.
		expect(result.ok).toBe(false)
		expect(result.evaluation.state).toBe("held")
		expect(result.message).toContain("locked by another process")

		fs.rmSync(metaPath, { force: true })
	})
})
