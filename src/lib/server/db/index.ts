import * as schema from "./schema"
import { migrate } from "drizzle-orm/pglite/migrator"
import * as dbConfig from "./drizzle.config"
import type { MigrationConfig } from "drizzle-orm/migrator"
import fs from "fs"
import { dev } from "$app/environment"
import { drizzle } from "drizzle-orm/pglite"
import { sync } from "./defaults"

// const { firstInit, pglite } = await startPg()

export let db = drizzle(dbConfig.dbPath, { schema })
export { schema }

// Compare two version strings in '0.0.0' format
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
	const pa = a.split(".").map(Number)
	const pb = b.split(".").map(Number)
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const na = pa[i] || 0
		const nb = pb[i] || 0
		if (na < nb) return -1
		if (na > nb) return 1
	}
	return 0
}

async function runMigrations() {
	// TODO: Update this in 0.4.0 to perform pg backups. Not needed for 0.3.0

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
	// If it doesn't exist, create a meta.json file in the data directory
	const metaPath = dbConfig.dataDir + "/meta.json"
	// Check if the file exists
	if (!fs.existsSync(metaPath)) {
		// Create the file with default content
		fs.writeFileSync(
			metaPath,
			JSON.stringify({ version: "0.0.0" }, null, 2)
		)
	}

	// Check meta.json for version
	const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
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
	await sync()
}
