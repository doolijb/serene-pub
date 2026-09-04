import * as schema from "./schema"
import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/pglite/migrator"
import * as dbConfig from "./drizzle.config"
import {
	compareVersions,
	isParseableVersion
} from "$lib/shared/utils/releaseChannel"
import type { MigrationConfig } from "drizzle-orm/migrator"
import fs from "fs"
import crypto from "crypto"
import { building, dev } from "$app/environment"
import { drizzle } from "drizzle-orm/pglite"
import { sync } from "./defaults"

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

// Ensure meta.json exists
if (!fs.existsSync(metaPath)) {
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
const DEFAULT_LOCK_LENGTH = 5000 // 5 seconds in milliseconds

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
		updateDatabaseLock()
	}, DEFAULT_LOCK_LENGTH - 1000) // Update 1 second before lock expires
}

function stopLockUpdates(): void {
	if (lockUpdateInterval) {
		clearInterval(lockUpdateInterval)
		lockUpdateInterval = null
	}

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

// Clean up lock on process exit
process.on("exit", stopLockUpdates)
process.on("SIGINT", () => {
	stopLockUpdates()
	process.exit(0)
})
process.on("SIGTERM", () => {
	stopLockUpdates()
	process.exit(0)
})

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

// Re-exported from the shared module so the migration gate and the update
// notifier can never disagree about what "newer" means. They previously had
// separate implementations, and the other one ignored pre-release suffixes
// entirely — see $lib/shared/utils/releaseChannel.
export { compareVersions }

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

async function runMigrations() {
	// TODO: Update this in 0.4.1 to perform pg backups. Not needed for 0.3.0

	await migrate(db, {
		migrationsFolder: dbConfig.migrationsDir
	} as MigrationConfig)
	console.log("Migrations applied.")
}

// In dev, always run migrations unconditionally — never gated by the
// meta.json/app version comparison below. Dev iteration adds new migration
// files constantly without bumping the app version for each one (that
// mismatch is exactly what silently skipped a real migration for an entire
// debugging session once already), so version-gating in dev just means
// "sometimes skip a migration that actually needs to run." drizzle's own
// migrate() is idempotent — safe to call every startup regardless of the
// stored meta.json version, it only applies what isn't already applied.
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
	// `meta.version` is an unchecked cast over whatever JSON.parse produced, so
	// a hand-edited meta.json can carry a missing or non-string value. Without
	// the typeof, isParseableVersion() throws on `.trim()` and startup dies on
	// a file the reader above accepted as valid JSON.
	const storedVersionUsable =
		typeof meta.version === "string" && isParseableVersion(meta.version)
	const appVersionUsable = isParseableVersion(appVersion)

	// The rollback guard runs BEFORE any migration, so that refusing leaves the
	// database exactly as it was found. Ordering matters across divergent
	// branches: a hotfix line whose migration was authored later than the newer
	// release's would otherwise apply that migration onto the newer schema and
	// only then refuse to start.
	//
	// It requires BOTH versions to be readable. An unparseable app version used
	// to arrive here as 0.0.0, which made compareVersions() report "database is
	// newer" for any healthy install upgrading onto a badly-tagged build, and
	// hard-failed startup on a database that was perfectly fine.
	if (storedVersionUsable && appVersionUsable) {
		if (compareVersions(meta.version, appVersion) === 1) {
			console.warn(
				`Warning: Database version (${meta.version}) is newer than app version (${appVersion}).`
			)
			throw new Error(
				`Database version (${meta.version}) is newer than app version (${appVersion}). Please check your database integrity.`
			)
		}
	}

	// KNOWN GAP, deliberately left: a downgrade onto a build whose OWN version
	// is unparseable slips past that guard, so older code can run against a
	// newer schema. The version string is simply the wrong signal here — the
	// exact answer already sits in the database, as max(created_at) in
	// drizzle.__drizzle_migrations against max(folderMillis) of the bundled
	// migration set. That is the follow-up. Failing closed on an unreadable app
	// version instead would block the legitimate upgrade AWAY from the
	// badly-tagged 0.5.3 release candidate, which is the case real users are in.

	// Migrations run UNCONDITIONALLY here, exactly as they do in dev above and
	// for the same stated reason: drizzle's migrate() is idempotent and applies
	// only what is missing, so gating it on a version comparison can never save
	// meaningful work — it can only ever SKIP a migration that needed to run.
	//
	// It did exactly that, in a shipped build. `0.5.3-beta-rc-1` has a compound
	// suffix that parseVersion() cannot read, so it degraded silently to 0.0.0
	// — the same sentinel a freshly created meta.json carries. The two compared
	// equal, the gate logged "No migration needed, versions match", and every
	// fresh install started with an empty database: no tables, every query
	// failing 42P01, and no self-healing on restart because meta.json stayed on
	// the sentinel forever. No test caught it because the dev branch above
	// bypasses this gate entirely, so the failure existed only in a production
	// bundle.
	await runMigrations()

	// Bookkeeping only, now that it can no longer suppress a migration.
	if (!appVersionUsable) {
		// Loud, because it means a release was tagged in a shape this project
		// does not use (`-beta`, `-rc-N`, `-pr-N`, `-dev`, `-alpha`), and the
		// same string also falls through .github/workflows/release.yml's
		// classifier to its "Unknown suffix" branch, which turns CI tests OFF.
		console.warn(
			`Warning: app version "${appVersion}" is not a recognized version format, so the database version stamp cannot be compared. Migrations were applied regardless. Expected X.Y.Z, X.Y.Z-type, or X.Y.Z-type-N.`
		)
	} else if (storedVersionUsable) {
		if (compareVersions(meta.version, appVersion) === -1) {
			meta.version = appVersion
			fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
			console.log(`Updated meta.json to version ${appVersion}.`)
		}
	} else {
		// Stored stamp missing, non-string, or unreadable — a hand-edited or
		// corrupted meta.json. (The "0.0.0" bootstrap sentinel a fresh install
		// carries is a valid version and takes the branch above.) Nothing to
		// compare against, so just record where we are now.
		meta.version = appVersion
		fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
		console.log(`Updated meta.json to version ${appVersion}.`)
	}
}

// Keep immutable seed rows (default prompt configs, etc.) in sync with the
// current code on every startup — deliberately NOT gated by the version
// comparison above, since that only tracks schema migrations. Editing seed
// *text* in defaults.ts without a version bump would otherwise never take
// effect on restart. sync() is fully idempotent (upsert-by-id, isImmutable
// rows only), so running it unconditionally here is safe.
if (!building) await sync()

// Mark any downloads that were in-flight when the server last stopped as errored
db.update(schema.koboldCppModels)
	.set({ status: "error", errorMessage: "Server restarted during download" })
	.where(eq(schema.koboldCppModels.status, "downloading"))
	.catch(() => {})
