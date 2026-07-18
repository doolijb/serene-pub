import { defineConfig } from "drizzle-kit"
import { mkdirSync } from "fs"
import { existsSync } from "fs"
import os from "os"
import path from "path"
import envPaths from "env-paths"

/**
 * Gets the application data directory with optional override from environment
 * Checks SERENE_PUB_DATA_DIR environment variable first, falls back to envPaths
 */
export function getAppDataDir() {
	const envDataDir = process.env.SERENE_PUB_DATA_DIR
	if (envDataDir) {
		return envDataDir
	}

	const paths = envPaths("SerenePub", { suffix: "" })
	return paths.data
}

/**
 * Gets the database data directory
 * Includes CI environment check for compatibility with existing logic
 */
function getDbDataDir() {
	const isCI = process.env.CI === "true"
	if (isCI) {
		return path.join(os.homedir(), "SerenePubData")
	}

	const appDataDir = getAppDataDir()
	return path.join(appDataDir, "data")
}

export const dataDir = getDbDataDir()
export const dbPath = `${dataDir}/serene-pub.db`
export const baseUrl = process.env.DATABASE_URL || `localhost`
export const port: number = parseInt(process.env.DATABASE_PORT || "3002")
export const migrationsDir = "./drizzle"
export const schemaDir = "./src/lib/server/db/schema.ts"
export const user = process.env.POSTGRES_USER || "postgres"
export const password = process.env.POSTGRES_PASSWORD || "password"
// PGlite uses a file path instead of a connection URL
export const postgresUrl = dbPath

if (!existsSync(dataDir)) {
	mkdirSync(dataDir, { recursive: true })
}

console.log(`Using PGlite database at: ${dbPath}`)

export default defineConfig({
	schema: schemaDir,
	dialect: "postgresql",
	dbCredentials: { url: dbPath },
	verbose: true,
	strict: true,
	out: migrationsDir,
	driver: "pglite"
})
