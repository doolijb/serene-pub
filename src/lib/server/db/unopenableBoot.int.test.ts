/**
 * Booting on a data directory that will not open — through the real module.
 *
 * The classifier is asserted in ./unopenable.int.test.ts; what is asserted here
 * is the wiring around it, because the wiring is where P0 actually lives. Two
 * outcomes have to stay apart, and both used to be the same crash:
 *
 * - a **damaged** directory now rejects `dbReady` with a `DatabaseUnopenableError`
 *   and lets module evaluation finish, so `$lib/server/startup` can come up and
 *   serve an explanation;
 * - a directory a **live process already holds** still refuses to start, before
 *   PGlite is opened at all.
 *
 * `SERENE_PUB_DATA_DIR` is redirected per test rather than a fixture being
 * planted in the suite's own data directory: nothing here may write a broken
 * database into a directory it did not create.
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
import { getIdentity, writeMetaFile } from "./lock.js"
import { isDatabaseUnopenableError } from "./errors"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

/**
 * `getDbDataDir()` ignores `SERENE_PUB_DATA_DIR` when `CI=true` and answers
 * `~/SerenePubData` instead — which is somebody's real data directory, not this
 * test's to damage. There is no way to redirect the module there, so it is not
 * exercised there.
 */
const underCI = process.env.CI === "true"

let root: string
let brokenRoot: string
let heldRoot: string
const originalDataDir = process.env.SERENE_PUB_DATA_DIR

/** Everything spawned, so a failure cannot leak a live process. */
const holders: ChildProcess[] = []

beforeAll(async () => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "sp-boot-"))

	// A real database, then `global/pg_control` emptied: the same
	// `RuntimeError: Aborted()` out of `_pg_initdb` that four real data
	// directories collected on 2026-09-07 raise.
	brokenRoot = path.join(root, "broken")
	const brokenData = path.join(brokenRoot, "data")
	fs.mkdirSync(brokenData, { recursive: true })
	const pg = new PGlite(path.join(brokenData, "serene-pub.db"))
	await pg.waitReady
	await pg.exec(`CREATE TABLE keepsake (id int)`)
	await pg.close()
	fs.writeFileSync(
		path.join(brokenData, "serene-pub.db", "global", "pg_control"),
		""
	)

	heldRoot = path.join(root, "held")
	fs.mkdirSync(path.join(heldRoot, "data"), { recursive: true })
})

afterEach(async () => {
	vi.restoreAllMocks()
	vi.resetModules()
	if (originalDataDir === undefined) delete process.env.SERENE_PUB_DATA_DIR
	else process.env.SERENE_PUB_DATA_DIR = originalDataDir

	while (holders.length) {
		const child = holders.pop()!
		const exited = new Promise<void>((resolve) =>
			child.once("exit", () => resolve())
		)
		child.kill("SIGKILL")
		await exited
	}
})

afterAll(() => {
	fs.rmSync(root, { recursive: true, force: true })
})

describe.skipIf(underCI)("a damaged data directory", () => {
	test("rejects dbReady without taking the process down with it", async () => {
		process.env.SERENE_PUB_DATA_DIR = brokenRoot
		vi.resetModules()

		// Evaluating the module must SUCCEED — that is the whole change. It
		// used to reject an unheld promise (which Node terminates the process
		// over) and, in dev, throw out of module evaluation, taking
		// `$lib/server/startup` with it and leaving nothing to explain itself.
		const mod = await import("./index")

		const error = await mod.dbReady.then(
			() => null,
			(err: unknown) => err
		)

		expect(isDatabaseUnopenableError(error)).toBe(true)
		expect(error).toMatchObject({
			dataDir: path.join(brokenRoot, "data"),
			dbPath: path.join(brokenRoot, "data", "serene-pub.db"),
			// Fresh meta.json written by this very boot, so there is genuinely
			// no marker from a previous run to read.
			lastShutdown: "unknown"
		})

		// The lock heartbeat is running even though nothing opened; releasing
		// it is what a boot into the placeholder page would do.
		await mod.closeDatabase()

		// A failed open never claimed the run, so it must not claim to have
		// ended one cleanly either — that would erase the evidence next boot.
		const meta = JSON.parse(
			fs.readFileSync(path.join(brokenRoot, "data", "meta.json"), "utf-8")
		)
		expect(meta.lastShutdown).toBeUndefined()
	})

	test("lets startup finish, and says so once in plain language", async () => {
		process.env.SERENE_PUB_DATA_DIR = brokenRoot
		vi.resetModules()

		const errors: string[] = []
		vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
			errors.push(args.map(String).join(" "))
		})

		const startup = await import("$lib/server/startup")

		// Resolves. It used to reject with the raw WASM trap, which every entry
		// point awaits — so the app answered every request with `RuntimeError:
		// Aborted()`, or from a desktop shortcut with nothing at all.
		await expect(startup.appReady).resolves.toBeUndefined()

		const state = startup.getDatabaseState()
		expect(state.ok).toBe(false)
		if (state.ok) throw new Error("unreachable")

		const report = errors.find((line) =>
			line.includes("The database could not be opened")
		)
		expect(report).toBeDefined()
		expect(report).toContain(path.join(brokenRoot, "data"))
		expect(report).toContain("docs/troubleshooting.md#database-wont-open")
		expect(report!.split("\n").length).toBeGreaterThan(5)

		// And the placeholder the HTTP layer serves for every route.
		const { renderDatabaseUnopenablePage } = await import(
			"./unopenablePage"
		)
		const response = renderDatabaseUnopenablePage(state.error)
		expect(response.status).toBe(503)
		expect(await response.text()).toContain(path.join(brokenRoot, "data"))

		const { closeDatabase } = await import("./index")
		await closeDatabase()
	})
})

describe.skipIf(underCI)("a data directory another process holds", () => {
	test("still exits rather than reporting a broken database", async () => {
		// A genuinely live process on this host: `evaluateLock` asks the OS
		// whether the pid is running, so a fabricated one reads as stale.
		const holder = spawn(
			process.execPath,
			["-e", "setTimeout(() => {}, 60000)"],
			{ stdio: "ignore" }
		)
		holders.push(holder)
		const me = getIdentity()
		writeMetaFile(path.join(heldRoot, "data", "meta.json"), {
			version: "0.6.0",
			cryptoSecretKey: "keep-me",
			lock: {
				timestamp: Date.now(),
				// Long enough that it cannot expire mid-test. Expiry is
				// checked before ownership (see ./lock.js), so a lock nobody
				// refreshes goes stale on its own and the wait ends early —
				// which is a real behaviour, but not the one under test here.
				// This test therefore costs the shipped 20s wait: the deadline
				// is `DEFAULT_LOCK_WAIT_TIMEOUT`, and there is no seam to
				// shorten it from outside without changing what ships.
				lockLength: 300_000,
				owner: {
					pid: holder.pid,
					hostId: me.hostId,
					hostname: me.hostname,
					instanceId: "someone-else",
					label: "app"
				}
			}
		})

		process.env.SERENE_PUB_DATA_DIR = heldRoot
		vi.resetModules()

		const exit = vi.spyOn(process, "exit").mockImplementation(((
			code?: number
		) => {
			throw new Error(`process.exit(${code})`)
		}) as never)
		vi.spyOn(console, "error").mockImplementation(() => {})
		vi.spyOn(console, "log").mockImplementation(() => {})

		const error = await import("./index").then(
			() => null,
			(err: unknown) => err
		)

		// Waited out its bounded deadline, then refused — the pre-existing
		// behaviour, unchanged. Notably NOT a DatabaseUnopenableError: nothing
		// was ever opened, so there is nothing to call damaged.
		expect(exit).toHaveBeenCalledWith(1)
		expect((error as Error).message).toBe("process.exit(1)")
		expect(isDatabaseUnopenableError(error)).toBe(false)

		// And the lock's own meta.json is untouched, key included.
		const meta = JSON.parse(
			fs.readFileSync(path.join(heldRoot, "data", "meta.json"), "utf-8")
		)
		expect(meta.cryptoSecretKey).toBe("keep-me")
		expect(meta.lastShutdown).toBeUndefined()
	})
})
