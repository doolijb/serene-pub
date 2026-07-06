import * as schema from "./schema"
import { migrate } from "drizzle-orm/pglite/migrator"
import * as dbConfig from "./drizzle.config"
import type { MigrationConfig } from "drizzle-orm/migrator"
import fs from "fs"
import crypto from "crypto"
import { dev } from "$app/environment"
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

// Check database lock before proceeding
await checkDatabaseLock()

// Start lock updates
startLockUpdates()

export let db = drizzle(dbConfig.dbPath, { schema })
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

async function runMigrations() {
	// TODO: Update this in 0.4.1 to perform pg backups. Not needed for 0.3.0

	await migrate(db, {
		migrationsFolder: dbConfig.migrationsDir
	} as MigrationConfig)
	console.log("Migrations applied.")
	await sync()
}

// Check if database has been initialized by looking for a specific table
let hasTables = false
try {
	// Try to query a table that should exist after migrations
	await db.execute("SELECT 1 FROM users LIMIT 1")
	hasTables = true
} catch (error) {
	// Table doesn't exist, database needs initialization
	hasTables = false
}

// Run migrations if in production environment
if (!dev || !hasTables) {
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
} else {
	await runMigrations()
}

// Auto-start managed KoboldCPP subprocess if configured
import("$lib/server/koboldcpp/subprocessManager").then(async (mgr) => {
	try {
		const settings = await db.query.koboldCppSettings.findFirst()
		if (settings?.koboldCppManagerEnabled && settings?.koboldCppManagedMode === "managed") {
			await mgr.start()
			console.log("KoboldCPP managed subprocess started.")
		}
	} catch (err: any) {
		console.warn("KoboldCPP auto-start failed:", err.message)
	}
})
