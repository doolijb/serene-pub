/**
 * The PRODUCTION migration gate in `./index.ts`, exercised in its production
 * shape.
 *
 * `0.5.3-beta-rc-1` shipped dead on arrival. Its compound suffix is unreadable
 * to `parseVersion`, which degrades to `{0, 0, 0}` — byte-identical to the
 * "0.0.0" sentinel a freshly created `meta.json` carries. The old gate compared
 * the two, found them EQUAL, logged "No migration needed, versions match." and
 * skipped every migration. Every fresh install came up with no tables at all:
 * `GET /` returned 500, every query failed 42P01, and restarting never healed
 * it because `meta.json` stayed on the sentinel forever.
 *
 * `$lib/shared/utils/releaseChannel`'s own tests cover the version helpers, but
 * the helpers can be perfect while the gate still throws the migration away —
 * so they would not have caught this, and reverting the gate would leave them
 * all green. The gate itself had no test because it is unreachable in a normal
 * run: it is top-level module code inside the `dev === false` branch, and
 * vitest reports `dev: true`. That is exactly why a full suite passed while the
 * shipped bundle was broken. The `$app/environment` mock below is what makes
 * the shipped code path executable here at all — same technique, and same
 * reason, as `src/lib/server/config/bootstrapEnv.test.ts`.
 *
 * Consequently these assert on TABLES EXISTING, never on "it didn't throw".
 * The original failure threw nothing whatsoever; it silently left an empty
 * database behind.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import crypto from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
// The same functions the global names refer to, but bound here so the stub
// installed below cannot shadow them — a bare `setInterval` inside that stub
// would resolve to the stub itself and recurse forever.
import { clearInterval, setInterval } from "node:timers"
import { sql } from "drizzle-orm"
import { compareVersions } from "$lib/shared/utils/releaseChannel"

vi.mock("$app/environment", () => ({ dev: false, building: false }))

/** The version string that actually shipped broken. */
const UNPARSEABLE_VERSION = "0.5.3-beta-rc-1"
/** A version `parseVersion` reads fine, for the control cases. */
const PARSEABLE_VERSION = "0.6.0-beta"
/** What `./index.ts` writes into a brand-new `meta.json`. */
const FRESH_INSTALL_SENTINEL = "0.0.0"

/**
 * `./index.ts` heartbeats `meta.json`'s lock on a `DEFAULT_LOCK_LENGTH - 1000`
 * interval and only clears it when the process exits; nothing exports a stop
 * handle. Left running, the second boot of the restart case below waits the
 * lock out, finds it still live, and calls `process.exit(1)` — killing the
 * vitest worker outright. So the heartbeat is captured here by its interval and
 * cleared on teardown, which is what process exit would have done.
 */
const HEARTBEAT_MS = 4000
// Both the Node and DOM timer declarations are in scope for this tsconfig, and
// they disagree about the handle type; `clearInterval` accepts either.
const heartbeats = new Set<number | NodeJS.Timeout>()
vi.stubGlobal("setInterval", ((
	handler: () => void,
	ms?: number,
	...args: unknown[]
) => {
	const timer = setInterval(handler, ms, ...args)
	if (ms === HEARTBEAT_MS) heartbeats.add(timer)
	return timer
}) as typeof globalThis.setInterval)

/** `./index.ts` cleans up its lock from these; a "restart" must detach them. */
const EXIT_EVENTS = ["exit", "SIGINT", "SIGTERM"] as const

/**
 * `process`'s own overloads reject a union of event names, and nothing here
 * needs the per-signal argument types — only "which listeners appeared".
 */
const processEvents = process as NodeJS.EventEmitter

const originalDataDir = process.env.SERENE_PUB_DATA_DIR
const originalCi = process.env.CI
const dataDirs: string[] = []

beforeAll(() => {
	// `drizzle.config.ts` IGNORES SERENE_PUB_DATA_DIR when CI === "true" and
	// uses ~/SerenePubData instead. Under CI that would point all three cases
	// at one shared directory in the developer's home — no fresh sentinel, no
	// isolation. Cleared for this file only, and restored in afterAll.
	delete process.env.CI
})

afterAll(async () => {
	if (originalDataDir === undefined) delete process.env.SERENE_PUB_DATA_DIR
	else process.env.SERENE_PUB_DATA_DIR = originalDataDir
	if (originalCi === undefined) delete process.env.CI
	else process.env.CI = originalCi
	vi.unstubAllGlobals()
	for (const dir of dataDirs) {
		await fs.promises.rm(dir, { recursive: true, force: true })
	}
})

const metaPathFor = (dataDir: string) => path.join(dataDir, "data", "meta.json")

/**
 * A throwaway data directory in the state a fresh install is in: the data dir
 * exists and `meta.json` carries the "0.0.0" sentinel, exactly as `./index.ts`
 * bootstraps it. Written here rather than left to `./index.ts` so the premise
 * of these tests is explicit in the test, not inherited from the code under
 * test.
 */
function freshInstallDataDir(): string {
	const dir = fs.mkdtempSync(
		path.join(os.tmpdir(), "serene-pub-migration-gate-")
	)
	dataDirs.push(dir)
	fs.mkdirSync(path.join(dir, "data"), { recursive: true })
	fs.writeFileSync(
		metaPathFor(dir),
		JSON.stringify(
			{
				version: FRESH_INSTALL_SENTINEL,
				cryptoSecretKey: crypto.randomUUID()
			},
			null,
			2
		)
	)
	return dir
}

/**
 * Start the server's database module the way a production boot does, against
 * `dataDir` and reporting `appVersion`.
 *
 * `__APP_VERSION__` is a vite `define` in `vite.config.ts`, and `vitest.config.ts`
 * has no `define` block of its own, so under vitest the identifier resolves as
 * a plain global — which is undefined, and the gate throws "App version is not
 * defined". Stubbing the global is the equivalent seam.
 */
async function bootDb(appVersion: string, dataDir: string) {
	process.env.SERENE_PUB_DATA_DIR = dataDir
	vi.stubGlobal("__APP_VERSION__", appVersion)

	// Both `./index.ts` and `./drizzle.config.ts` resolve their state at module
	// scope — the data directory included — so a boot has to be a genuinely
	// fresh module evaluation, not a cached import.
	vi.resetModules()

	const listenersBefore = new Map(
		EXIT_EVENTS.map((event) => [
			event,
			new Set<unknown>(processEvents.listeners(event))
		])
	)

	// `migrationsDir` is the cwd-relative "./drizzle"; vitest runs with the
	// project root as cwd, so the real 95-file migration set is what gets
	// applied here.
	const mod = await import("./index")

	return {
		db: mod.db,
		/** Everything real process exit does, so the dir can be booted again. */
		async stop() {
			for (const timer of heartbeats) clearInterval(timer)
			heartbeats.clear()
			for (const event of EXIT_EVENTS) {
				for (const listener of processEvents.listeners(event)) {
					if (!listenersBefore.get(event)!.has(listener)) {
						processEvents.off(
							event,
							listener as (...args: unknown[]) => void
						)
					}
				}
			}
			const meta = JSON.parse(
				fs.readFileSync(metaPathFor(dataDir), "utf-8")
			)
			delete meta.lock
			fs.writeFileSync(
				metaPathFor(dataDir),
				JSON.stringify(meta, null, 2)
			)
			// PGlite holds the directory open; a second instance must not be
			// pointed at it while the first is still live.
			await mod.db.$client.close()
		}
	}
}

type BootedDb = Awaited<ReturnType<typeof bootDb>>["db"]

/** Table names actually present in the database. */
async function publicTables(db: BootedDb): Promise<string[]> {
	const result = await db.execute<{ table_name: string }>(sql`
		SELECT table_name
		FROM information_schema.tables
		WHERE table_schema = 'public'
	`)
	return result.rows.map((row) => row.table_name)
}

/** How many migrations the database believes it has applied. */
async function appliedMigrationCount(db: BootedDb): Promise<number> {
	const result = await db.execute<{ count: string }>(
		sql`SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`
	)
	return Number(result.rows[0].count)
}

/**
 * The assertion the incident is about: real tables, and real queries against
 * them succeeding. `SELECT` on these two is what returned 42P01 for every user
 * of the broken build.
 */
async function expectPopulatedSchema(db: BootedDb) {
	const tables = await publicTables(db)
	expect(tables).toContain("sampling_configs")
	expect(tables).toContain("chat_messages")
	expect(tables).toContain("users")
	// A partial apply would satisfy the three above; the real schema is large.
	expect(tables.length).toBeGreaterThan(30)

	await expect(
		db.execute(sql`SELECT id FROM sampling_configs LIMIT 1`)
	).resolves.toBeDefined()
	await expect(
		db.execute(sql`SELECT id FROM chat_messages LIMIT 1`)
	).resolves.toBeDefined()
}

describe("production migration gate", () => {
	test("an app version parseVersion cannot read still migrates a fresh install", async () => {
		const dataDir = freshInstallDataDir()

		// The trap, stated as an assertion: the gate's own comparison still
		// reports the sentinel and this app version EQUAL, because both parse
		// to {0,0,0}. That equality must no longer be able to suppress a
		// migration.
		expect(
			compareVersions(FRESH_INSTALL_SENTINEL, UNPARSEABLE_VERSION)
		).toBe(0)

		const booted = await bootDb(UNPARSEABLE_VERSION, dataDir)
		try {
			await expectPopulatedSchema(booted.db)

			// And the stamp is still the sentinel, because an unreadable app
			// version is not comparable to anything — which is precisely why
			// the broken build never self-healed on restart, and why the
			// migration can no longer be conditional on this file.
			const meta = JSON.parse(
				fs.readFileSync(metaPathFor(dataDir), "utf-8")
			)
			expect(meta.version).toBe(FRESH_INSTALL_SENTINEL)
		} finally {
			await booted.stop()
		}
	}, 60_000)

	test("a readable app version also migrates a fresh install", async () => {
		// The opposite bug: "always skip" and "always migrate" both pass the
		// case above if you only ever test the broken version string.
		const dataDir = freshInstallDataDir()
		const booted = await bootDb(PARSEABLE_VERSION, dataDir)
		try {
			await expectPopulatedSchema(booted.db)

			const meta = JSON.parse(
				fs.readFileSync(metaPathFor(dataDir), "utf-8")
			)
			expect(meta.version).toBe(PARSEABLE_VERSION)
		} finally {
			await booted.stop()
		}
	}, 60_000)

	test("restarting on the same version keeps the schema and does not throw", async () => {
		// The path that changed most: a matching version used to take the
		// `case 0` early-out and skip migrate() entirely. It now calls
		// migrate() on every boot, so the second boot has to be a no-op rather
		// than an error or a double-apply.
		const dataDir = freshInstallDataDir()

		const first = await bootDb(PARSEABLE_VERSION, dataDir)
		let migrationsAfterFirstBoot: number
		try {
			migrationsAfterFirstBoot = await appliedMigrationCount(first.db)
			expect(migrationsAfterFirstBoot).toBeGreaterThan(0)
		} finally {
			await first.stop()
		}

		const second = await bootDb(PARSEABLE_VERSION, dataDir)
		try {
			await expectPopulatedSchema(second.db)
			expect(await appliedMigrationCount(second.db)).toBe(
				migrationsAfterFirstBoot
			)
		} finally {
			await second.stop()
		}
	}, 120_000)
})
