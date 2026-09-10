#!/usr/bin/env node

import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { spawn } from "child_process"

/**
 * The lock protocol itself is shared with the app, not restated here.
 *
 * This script and `src/lib/server/db/index.ts` write the same `meta.lock` and
 * read each other's, and they used to describe it differently: 5 seconds here,
 * 10 there. A drizzle-kit run therefore advertised a lock with half the life
 * the app assumed, and neither side recorded who was holding it. One module,
 * imported by both, is what stops that recurring.
 *
 * `../src/lib/server/db/lock.js` is deliberately plain JavaScript with no
 * dependencies beyond node builtins, so this stays runnable by bare `node`,
 * outside any build.
 */
import {
	checkDatabaseLock,
	createLockHeartbeat,
	describeLockHolder
} from "../src/lib/server/db/lock.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Get the project root directory
const projectRoot = path.resolve(__dirname, "..")

// Load environment variables from .env file if it exists
function loadEnvFile() {
	const envPath = path.join(projectRoot, ".env")
	if (fs.existsSync(envPath)) {
		const envContent = fs.readFileSync(envPath, "utf-8")
		const envLines = envContent.split("\n")

		for (const line of envLines) {
			const trimmedLine = line.trim()
			if (trimmedLine && !trimmedLine.startsWith("#")) {
				const [key, ...valueParts] = trimmedLine.split("=")
				if (key && valueParts.length > 0) {
					const value = valueParts
						.join("=")
						.replace(/^["']|["']$/g, "")
					process.env[key.trim()] = value
				}
			}
		}
	}
}

// Load .env before doing anything else
loadEnvFile()

let lockHeartbeat = null

// Get data directory with the same logic as the utility function
function getDataDirectory() {
	// CI first, then the override, matching getDbDataDir() in
	// src/lib/server/db/drizzle.config.ts exactly. This used to check the
	// override first, so with both CI=true and SERENE_PUB_DATA_DIR set the two
	// locked different meta.json files — the one case where the lock protected
	// nothing at all.
	const isCI = process.env.CI === "true"
	if (isCI) {
		return path.join(os.homedir(), "SerenePubData")
	}

	// Check for custom data directory from environment
	const envDataDir = process.env.SERENE_PUB_DATA_DIR
	if (envDataDir) {
		return path.join(envDataDir, "data")
	}

	// Fallback to envPaths logic - we need to import it dynamically
	try {
		// Simple fallback calculation without importing envPaths
		// This mimics what envPaths would return for most systems
		const platform = process.platform
		const home =
			process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH

		let dataPath
		if (platform === "darwin") {
			dataPath = path.join(
				home,
				"Library",
				"Application Support",
				"SerenePub"
			)
		} else if (platform === "win32") {
			dataPath = path.join(
				process.env.APPDATA || path.join(home, "AppData", "Roaming"),
				"SerenePub"
			)
		} else {
			// Linux and others
			const xdgDataHome =
				process.env.XDG_DATA_HOME || path.join(home, ".local", "share")
			dataPath = path.join(xdgDataHome, "SerenePub")
		}

		return path.join(dataPath, "data")
	} catch (error) {
		console.error("Failed to determine data directory:", error.message)
		process.exit(1)
	}
}

function startLockUpdates(dataDir) {
	lockHeartbeat = createLockHeartbeat({
		metaPath: path.join(dataDir, "meta.json"),
		dataDir,
		// Recorded in the lock so the app can say who is holding it.
		label: "db-cli"
	})
	lockHeartbeat.start()
	console.log("Database locked for db operation.")
}

function stopLockUpdates() {
	if (!lockHeartbeat) return
	const heartbeat = lockHeartbeat
	lockHeartbeat = null
	heartbeat.stop()
	console.log("\nDatabase lock released.")
}

/**
 * Refuse to run against a directory somebody else has open.
 *
 * Deliberately does not wait: this is a developer command, and a lock held by a
 * running app is not going to clear on its own. What ownership adds is the
 * other half — a lock left behind by a process that has since died is now
 * recognised as stale on the spot, instead of blocking `db:generate` for the
 * rest of the lock's life after a crash.
 */
async function checkForExistingLock(dataDir) {
	const metaPath = path.join(dataDir, "meta.json")
	const result = await checkDatabaseLock({ metaPath, waitTimeout: 0 })

	if (!result.ok) {
		console.error(result.message)
		process.exit(1)
	}

	switch (result.evaluation.state) {
		case "unreadable":
			console.error(
				`Failed to read ${metaPath}: ${result.evaluation.reason}`
			)
			process.exit(1)
			break
		case "stale":
			console.log(
				`Found stale database lock (${describeLockHolder(result.evaluation)}). Continuing...`
			)
			break
		case "self":
			console.log("Database lock belongs to this process. Continuing...")
			break
		default:
			console.log("No database lock found. Continuing...")
	}
}

async function runWithLock() {
	// Get command line arguments (everything after the script name)
	const args = process.argv.slice(2)

	if (args.length === 0) {
		console.error("No command provided to run with lock")
		process.exit(1)
	}

	try {
		const dataDir = getDataDirectory()

		// Check for existing lock first
		await checkForExistingLock(dataDir)

		// Start maintaining our lock
		startLockUpdates(dataDir)

		// Set up cleanup handlers
		process.on("exit", stopLockUpdates)
		process.on("SIGINT", () => {
			stopLockUpdates()
			process.exit(0)
		})
		process.on("SIGTERM", () => {
			stopLockUpdates()
			process.exit(0)
		})

		// Run the actual command
		const command = args[0]
		const commandArgs = args.slice(1)

		console.log(`Running: ${command} ${commandArgs.join(" ")}`)

		const child = spawn(command, commandArgs, {
			stdio: "inherit",
			shell: true
		})

		child.on("close", (code) => {
			stopLockUpdates()
			process.exit(code)
		})

		child.on("error", (error) => {
			console.error("Failed to start command:", error.message)
			stopLockUpdates()
			process.exit(1)
		})
	} catch (error) {
		console.error("Error running command with lock:", error.message)
		stopLockUpdates()
		process.exit(1)
	}
}

// Run the command with lock
runWithLock()
