import * as schema from "./schema"
import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/pglite/migrator"
import * as dbConfig from "./drizzle.config"
import type { MigrationConfig } from "drizzle-orm/migrator"
import fs from "fs"
import crypto from "crypto"
import { building, dev } from "$app/environment"
import { drizzle } from "drizzle-orm/pglite"

// Database lock interface
interface DbLock {
	timestamp: number
	lockLength: number // in milliseconds
}

interface MetaFile {
	version: string
	lock?: DbLock
	cryptoSecretKey?: string
}

// Move meta.json handling to the beginning
const metaPath = dbConfig.dataDir + "/meta.json"

/**
 * True when this process created meta.json, i.e. there was no prior Serene Pub
 * install here.
 *
 * Load-bearing for data upgrades: a fresh database is created at the current
 * schema with no legacy content, so every upgrade would be a no-op at best and
 * a misfire at worst. Cannot be inferred from the version afterwards — a fresh
 * file is written as "0.0.0", which is indistinguishable from a genuine old
 * install once written.
 */
const isFreshInstall = !fs.existsSync(metaPath)

// Ensure meta.json exists
if (isFreshInstall) {
	fs.writeFileSync(
		metaPath,
		JSON.stringify(
			{
				version: "0.0.0",
				cryptoSecretKey: crypto.randomUUID()
			},
			null,
			2
		)
	)
}

// Read meta.json with error handling
let meta: MetaFile
try {
	meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
	// Ensure cryptoSecretKey exists in existing meta.json
	if (!meta.cryptoSecretKey) {
		meta.cryptoSecretKey = crypto.randomUUID()
		fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
	}
} catch (error) {
	console.warn(
		`Warning: Invalid meta.json detected, recreating. Error: ${error}`
	)
	// Recreate meta.json if it's corrupted
	meta = {
		version: "0.0.0",
		cryptoSecretKey: crypto.randomUUID()
	}
	fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
}

// Database lock functions
const DEFAULT_LOCK_LENGTH = 10000 // 10 seconds in milliseconds

async function checkDatabaseLock(): Promise<void> {
	// Refresh meta from file with error handling
	try {
		meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
	} catch (error) {
		console.warn(
			`Warning: Error reading meta.json during lock check. Error: ${error}`
		)
		meta = { version: "0.0.0", cryptoSecretKey: crypto.randomUUID() }
		fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
	}

	if (!meta.lock) {
		// No lock exists, continue
		return
	}

	const currentTime = Date.now()
	const lockExpiry = meta.lock.timestamp + meta.lock.lockLength

	if (currentTime < lockExpiry) {
		// Lock is still active, wait for it to expire
		const waitTime = lockExpiry - currentTime
		console.log(
			`Database locked, waiting ${waitTime}ms for lock to expire...`
		)

		await new Promise((resolve) => setTimeout(resolve, waitTime))

		// Check again after waiting
		try {
			meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
		} catch (error) {
			console.warn(
				`Warning: Error reading meta.json during lock recheck. Error: ${error}`
			)
			meta = { version: "0.0.0", cryptoSecretKey: crypto.randomUUID() }
			fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
		}

		if (
			meta.lock &&
			Date.now() < meta.lock.timestamp + meta.lock.lockLength
		) {
			// Still locked after waiting, exit application
			console.error(
				"Database remains locked after waiting. Exiting application."
			)
			process.exit(1)
		}
	}

	// Lock is stale or doesn't exist, continue
}

function updateDatabaseLock(): void {
	try {
		// Refresh meta from file with error handling
		try {
			meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
		} catch (error) {
			console.warn(
				`Warning: Error reading meta.json during lock update. Error: ${error}`
			)
			meta = { version: "0.0.0", cryptoSecretKey: crypto.randomUUID() }
		}

		meta.lock = {
			timestamp: Date.now(),
			lockLength: DEFAULT_LOCK_LENGTH
		}

		fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
	} catch (error) {
		console.error("Failed to update database lock:", error)
	}
}

// Background lock update function
let lockUpdateInterval: NodeJS.Timeout | null = null

function startLockUpdates(): void {
	// Update lock immediately
	updateDatabaseLock()

	// Set up interval to update lock every few seconds
	lockUpdateInterval = setInterval(() => {
		if (!dataDirPresent()) {
			stopLockUpdates()
			return
		}
		updateDatabaseLock()
	}, DEFAULT_LOCK_LENGTH - 1000) // Update 1 second before lock expires
}

/**
 * Whether the data directory is still there.
 *
 * The lock heartbeat writes `meta.json` on a timer, and `writeFileSync`
 * recreates a file whose directory was just removed. That is wrong in
 * production — a server whose data directory has been deleted out from under it
 * should stop writing, not resurrect a lone lock file — and in the test suite
 * it was an intermittent failure: a temp data directory being torn down would
 * have `meta.json` written back into it mid-walk, so the final `rmdir` hit
 * `ENOTEMPTY`. Different file each run, roughly one run in three.
 */
function dataDirPresent(): boolean {
	return fs.existsSync(dbConfig.dataDir)
}

function stopLockUpdates(): void {
	if (lockUpdateInterval) {
		clearInterval(lockUpdateInterval)
		lockUpdateInterval = null
	}

	// Nothing to clear, and nothing to write it into.
	if (!dataDirPresent()) return

	// Clear the lock when stopping
	try {
		try {
			meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
		} catch (error) {
			console.warn(
				`Warning: Error reading meta.json during lock clear. Error: ${error}`
			)
			meta = { version: "0.0.0", cryptoSecretKey: crypto.randomUUID() }
		}
		delete meta.lock
		fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
	} catch (error) {
		console.error("Failed to clear database lock:", error)
	}
}

/**
 * Let go of the data directory: stop the heartbeat, drop the lock, close PGlite.
 *
 * Exported for the integration suites, which point `SERENE_PUB_DATA_DIR` at a
 * temp directory, load this module for real, and then delete that directory.
 * Without this they were deleting it out from under a live database and a
 * running timer — see `dataDirPresent`. Stopping the writer first is the
 * deterministic fix; the guard above is what keeps a stray tick harmless.
 *
 * Safe to call twice, and safe to call on a database that never opened.
 */
export async function closeDatabase(): Promise<void> {
	stopLockUpdates()
	const client = (
		db as unknown as { $client?: { close?: () => Promise<void> } }
	).$client
	try {
		await client?.close?.()
	} catch {
		// Already closed, or never opened. Either way there is nothing to hold.
	}
}

// Last-resort, synchronous: 'exit' handlers cannot await, so this only stops
// the lock-refresh timer. The real teardown is `closeDatabase()`, registered as
// the "database" managed service (see $lib/server/services/register).
process.on("exit", stopLockUpdates)

// This module used to own SIGINT/SIGTERM handlers that called
// `process.exit(0)` immediately. Node runs every listener for a signal, and
// this module is imported before almost anything else — so that exit fired
// first and cut short every other listener's cleanup. The managed KoboldCPP
// subprocess had a graceful-shutdown path that, in production, almost certainly
// never got to run. The services registry now owns signal handling and waits
// for each service in turn.

// Everything below is skipped while BUILDING.
//
// This module opens PGlite, takes a lock, migrates and seeds at module scope —
// and SSR compilation imports it, so `npm run build` was doing all of that
// against the developer's REAL data directory. If their dev server happened to
// be running, the build died outright:
//
//     Using PGlite database at: ~/.local/share/SerenePub/data/serene-pub.db
//     Database remains locked after waiting. Exiting application.
//
// A build must never touch user data. It only needs this module to TYPE-CHECK
// and bundle; nothing evaluates a query at build time. `building` is
// SvelteKit's own signal for exactly this, and is false at runtime, so the
// server still initialises normally when it actually starts.
if (!building) {
	// Check database lock before proceeding
	await checkDatabaseLock()

	// Start lock updates
	startLockUpdates()
}

// During a build this points at a throwaway in-memory database rather than the
// user's data directory. Keeps the exact same type (so nothing downstream
// changes) while guaranteeing the build cannot open, lock or migrate real data.
export let db = drizzle(building ? "memory://" : dbConfig.dbPath, { schema })
export { schema }

// Compare two version strings in '0.0.0' format, handling pre-release identifiers
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
	// Parse version string into components
	// Format: X.Y.Z or X.Y.Z-type or X.Y.Z-type-N
	const parseVersion = (version: string) => {
		const match = version.match(
			/^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)(?:-(\d+))?)?$/
		)
		if (!match) {
			return { major: 0, minor: 0, patch: 0, type: null, num: 0 }
		}

		const [, major, minor, patch, type, num] = match
		return {
			major: parseInt(major, 10),
			minor: parseInt(minor, 10),
			patch: parseInt(patch, 10),
			type: type || null,
			num: num ? parseInt(num, 10) : 0
		}
	}

	const vA = parseVersion(a)
	const vB = parseVersion(b)

	// 1. Compare base version numbers (major.minor.patch)
	// Base version is king - e.g., 0.4.2-pr-1 > 0.4.1-alpha
	if (vA.major !== vB.major) return vA.major < vB.major ? -1 : 1
	if (vA.minor !== vB.minor) return vA.minor < vB.minor ? -1 : 1
	if (vA.patch !== vB.patch) return vA.patch < vB.patch ? -1 : 1

	// 2. If base versions match, compare release types
	// Release type hierarchy: pr < rc < alpha < (no suffix/release)
	// e.g., 0.4.1-pr-2 < 0.4.1-rc-1 < 0.4.1-alpha < 0.4.1
	const getReleaseTypePriority = (type: string | null): number => {
		if (!type) return 4 // Formal release (highest priority)
		if (type === "alpha") return 3
		if (type === "rc") return 2
		if (type === "pr") return 1
		return 0 // Unknown types get lowest priority
	}

	const priorityA = getReleaseTypePriority(vA.type)
	const priorityB = getReleaseTypePriority(vB.type)

	if (priorityA !== priorityB) {
		return priorityA < priorityB ? -1 : 1
	}

	// 3. If release types match, compare release numbers
	// e.g., 0.4.1-pr-1 < 0.4.1-pr-2
	if (vA.num !== vB.num) {
		return vA.num < vB.num ? -1 : 1
	}

	// Versions are identical
	return 0
}

/**
 * Get the crypto secret key from meta.json, creating one if it doesn't exist
 */
export function getCryptoSecretKey(): string {
	try {
		const currentMeta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
		if (!currentMeta.cryptoSecretKey) {
			currentMeta.cryptoSecretKey = crypto.randomUUID()
			fs.writeFileSync(metaPath, JSON.stringify(currentMeta, null, 2))
		}
		return currentMeta.cryptoSecretKey
	} catch (error) {
		console.warn(
			`Warning: Error reading meta.json for crypto key. Error: ${error}`
		)
		// Recreate meta.json if it's corrupted
		const newMeta = {
			version: "0.0.0",
			cryptoSecretKey: crypto.randomUUID()
		}
		fs.writeFileSync(metaPath, JSON.stringify(newMeta, null, 2))
		return newMeta.cryptoSecretKey
	}
}

/**
 * The Serene Pub version this data directory was last opened by, captured
 * before anything writes to meta.json.
 */
const previousVersion: string | null = isFreshInstall
	? null
	: (meta.version ?? null)

async function runMigrations() {
	// A backup first, and a failed one aborts the upgrade rather than warning.
	// This data directory is the only copy the user has — no managed Postgres
	// behind it, no PITR — so migrating unprotected is the exact situation the
	// backup exists to prevent. Skipped entirely on a fresh install and when
	// nothing is actually pending, so it costs an unchanged instance nothing.
	const { backupBeforeMigrations } = await import("./backup")
	await backupBeforeMigrations(db, {
		dataDir: dbConfig.dataDir,
		migrationsFolder: dbConfig.migrationsDir,
		label: previousVersion ?? "unknown",
		isFreshInstall
	})

	const { runMigrationsWithUpgrades } = await import("./dataUpgrades")
	const { upgradesRun } = await runMigrationsWithUpgrades(db, {
		migrationsFolder: dbConfig.migrationsDir,
		// Data upgrades transform content an older version left behind. There
		// is none on a fresh install, so they are skipped outright rather than
		// each being asked to detect emptiness.
		skipUpgrades: isFreshInstall
	})
	console.log(
		`Migrations applied.` +
			(upgradesRun.length
				? ` Data upgrades run: ${upgradesRun.join(", ")}.`
				: "")
	)
}

/**
 * Everything this module used to do at top level, moved into a function.
 *
 * **Why this is not a style change.** Awaiting these at module scope made this
 * an async ESM module whose own evaluation dynamically imported modules that
 * import `db` right back — `./defaults`, `messages/store`,
 * `pipelines/boot/bootstrap`, `plugins`. That is a cycle through a top-level
 * await, and in the production Rollup bundle it deadlocks: whether it happens
 * depends on which chunk each of those modules lands in, so it was invisible
 * until a chunk boundary moved. When it does happen nothing throws and nothing
 * rejects — every `await import()` of anything reaching `db` simply never
 * settles, so the request that triggered it hangs forever and any
 * fire-and-forget caller silently does nothing. Neither vitest nor `vite dev`
 * reproduces it; both skip Rollup's chunking entirely.
 *
 * Starting the promise here without awaiting it keeps this module's evaluation
 * synchronous, which breaks the cycle. The work still begins the instant the
 * module loads — what changes is that "the database is ready" is now something
 * callers state explicitly by awaiting `dbReady`, instead of a side effect they
 * inherited by importing `db`.
 */
async function initialiseDatabase(): Promise<void> {
	// In dev, always run migrations unconditionally — never gated by the
	// meta.json/app version comparison below. Dev iteration adds new migration
	// files constantly without bumping the app version for each one (that
	// mismatch is exactly what silently skipped a real migration for an entire
	// debugging session once already), so version-gating in dev just means
	// "sometimes skip a migration that actually needs to run." drizzle's own
	// migrate() is idempotent — safe to call every startup regardless of the
	// stored meta.json version, it only applies what isn't already applied.
	// Did this boot move the stored version? Decides the seed pass below.
	let versionChanged = false

	if (building) {
		// no-op: see the `building` guard above
	} else if (dev) {
		await runMigrations()
	} else {
		// @ts-ignore
		const appVersion = __APP_VERSION__
		if (!appVersion) {
			throw new Error(
				"App version is not defined. Please set __APP_VERSION__."
			)
		}
		const versionCompare = compareVersions(meta.version, appVersion)

		switch (versionCompare) {
			case 0: {
				// Matching versions are not proof that the schema is current.
				// A rebuild that adds a migration without bumping the version,
				// a version stamped by an earlier boot that then found more
				// work, or a restored data directory all produce "versions
				// match" with migrations still outstanding — and skipping on
				// the version alone silently never applies them. This is the
				// same failure the dev branch above refuses to risk; the only
				// difference here is that the check is cheap enough to make
				// rather than assume.
				const { hasPendingMigrations } = await import("./backup")
				if (await hasPendingMigrations(db, dbConfig.migrationsDir)) {
					console.log(
						"Versions match but migrations are pending — running them."
					)
					await runMigrations()
				} else {
					console.log("No migration needed, versions match.")
				}
				break
			}
			case -1:
				console.log("Running migrations to update database schema...")
				await runMigrations()
				break
			case 1:
				console.warn(
					`Warning: Database version (${meta.version}) is newer than app version (${appVersion}).`
				)
				// This could happen if the app version is rolled back or if the database was manually updated
				// Handle this case as needed, e.g., notify the user or log an error
				throw new Error(
					`Database version (${meta.version}) is newer than app version (${appVersion}). Please check your database integrity.`
				)
			default:
				console.error(
					"Unexpected version comparison result:",
					versionCompare
				)
				throw new Error("Unexpected version comparison result")
		}
	}

	// Stamp the version only after migrations and their data upgrades have
	// succeeded. Writing it earlier would mark the upgrade done on a boot that
	// threw halfway through it.
	if (!building) {
		// `__APP_VERSION__` is a Vite build-time define. It genuinely does not
		// exist under vitest, so this has to be a `typeof` guard rather than a
		// truthiness check — referencing an undeclared identifier throws.
		// @ts-ignore
		const appVersion: string | null =
			// @ts-ignore
			typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : null
		if (appVersion && meta.version !== appVersion) {
			meta.version = appVersion
			fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
			versionChanged = true
			console.log(`Updated meta.json to version ${appVersion}.`)
		}
	}

	// Keep immutable seed rows (default prompt configs, etc.) in sync with the
	// current code.
	//
	// **In dev, every boot.** Editing seed *text* in defaults.ts without
	// bumping the app version would otherwise never take effect on restart,
	// which is the whole reason this is not version-gated there.
	//
	// **In production, only when the version actually moved.** A released build
	// cannot have its seed text edited underneath it, so re-running the sync on
	// every boot of an unchanged version is pure startup cost — and this runs
	// before the app serves its first request. sync() stays fully idempotent
	// either way; this is about not paying for it needlessly.
	if (!building && (dev || versionChanged || isFreshInstall)) {
		// Imported here rather than at module scope, and the difference is a real
		// cycle rather than style: `defaults.ts` imports `db` from this module, so
		// a static import makes the two initialise in a loop. It happened to work
		// only because some *other* module in the graph pulled `db` in first;
		// deleting the legacy prompt builder removed that module and the parity
		// suite started failing with `Cannot access '__vite_ssr_import_1__' before
		// initialization` — `db` still in its temporal dead zone while `sync()`
		// ran. Deferring the import to here means this module's body has finished
		// and `db` is a real value by the time `defaults.ts` reads it.
		const { sync } = await import("./defaults")
		await sync()

		// Seed core widgets' shipped style presets and prune any that were
		// dropped (PLAN 25). Deferred-imported for the same db-cycle reason as
		// `sync` above. Plugin widgets seed their own on install/update.
		const { syncWidgetStyles } = await import("./widgetStyles")
		const { CORE_WIDGETS } = await import("@serene-pub/core-catalog")
		await syncWidgetStyles(CORE_WIDGETS, meta.version || "0.0.0")
	}
}

/**
 * Resolves once the database itself is ready: schema migrations applied and
 * seed rows synced. Nothing beyond the database is in scope here — subsystem
 * bootstraps live in `$lib/server/startup`, which awaits this first.
 *
 * Await this before the first query on any path that can run at startup.
 */
export const dbReady: Promise<void> = initialiseDatabase()

// In dev and under test, keep the original contract: importing this module
// means the database is ready. Only the *production* bundle has the Rollup
// chunking that turns this top-level await into a deadlock — `vite dev` and
// vitest both run modules unbundled, where it is exactly as safe as it always
// was.
//
// The asymmetry is deliberate but worth naming, because "behaves differently in
// the production bundle" is the same property that hid the original bug: what
// changes between the two is only *when* this is awaited, never whether it
// runs. Production awaits `appReady` per request (`hooks.server.ts`) and before
// the socket handlers register (`attachSocketServer`), which covers every entry
// point.
//
// Dev and test additionally await here so migrations and seed sync can never
// run concurrently with a test. Without this line, a test file that merely
// touches this module leaves PGlite churning in the background for the rest of
// the run, and 5s int-test budgets that used to pass start failing several
// files away from the cause — confirmed by A/B, not guessed at. Do not delete
// it as redundant.
if (dev) await dbReady
