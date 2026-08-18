import * as schema from "./schema"
import { eq } from "drizzle-orm"
import { migrate } from "drizzle-orm/pglite/migrator"
import * as dbConfig from "./drizzle.config"
import { compareVersions } from "$lib/shared/utils/releaseChannel"
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
	const versionCompare = compareVersions(meta.version, appVersion)

	switch (versionCompare) {
		case 0:
			console.log("No migration needed, versions match.")
			break
		case -1:
			console.log("Running migrations to update database schema...")
			await runMigrations()
			meta.version = appVersion
			fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
			console.log(`Updated meta.json to version ${appVersion}.`)
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
