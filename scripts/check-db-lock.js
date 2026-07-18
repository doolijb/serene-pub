#!/usr/bin/env node

import fs from "fs"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { spawn } from "child_process"

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

// Lock configuration
const DEFAULT_LOCK_LENGTH = 5000 // 5 seconds in milliseconds
let lockUpdateInterval = null
let metaPath = null
let lockReleased = false

// Get data directory with the same logic as the utility function
function getDataDirectory() {
	// Check for custom data directory from environment
	const envDataDir = process.env.SERENE_PUB_DATA_DIR
	if (envDataDir) {
		return path.join(envDataDir, "data")
	}

	// Check for CI environment
	const isCI = process.env.CI === "true"
	if (isCI) {
		return path.join(os.homedir(), "SerenePubData")
	}

	// Fallback to envPaths logic - we need to import it dynamically
	try {
		// Simple fallback calculation without importing envPaths
		// This mimics what envPaths would return for most systems
		const os = process.platform
		const home =
			process.env.HOME || process.env.USERPROFILE || process.env.HOMEPATH

		let dataPath
		if (os === "darwin") {
			dataPath = path.join(
				home,
				"Library",
				"Application Support",
				"SerenePub"
			)
		} else if (os === "win32") {
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

function updateDatabaseLock() {
	try {
		// Read current meta.json
		let meta = { version: "0.0.0" }
		if (fs.existsSync(metaPath)) {
			meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
		}

		// Update lock
		meta.lock = {
			timestamp: Date.now(),
			lockLength: DEFAULT_LOCK_LENGTH
		}

		fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
	} catch (error) {
		console.error("Failed to update database lock:", error.message)
	}
}

function startLockUpdates() {
	// Update lock immediately
	updateDatabaseLock()
	console.log("Database locked for db operation.")

	// Set up interval to update lock every few seconds
	lockUpdateInterval = setInterval(() => {
		updateDatabaseLock()
	}, DEFAULT_LOCK_LENGTH - 1000) // Update 1 second before lock expires
}

function stopLockUpdates() {
	if (lockReleased) {
		return // Already cleaned up
	}
	lockReleased = true

	if (lockUpdateInterval) {
		clearInterval(lockUpdateInterval)
		lockUpdateInterval = null
	}

	// Clear the lock
	try {
		if (fs.existsSync(metaPath)) {
			const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
			delete meta.lock
			fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))
			console.log("\nDatabase lock released.")
		}
	} catch (error) {
		console.error("Failed to clear database lock:", error.message)
	}
}

async function checkDatabaseLock() {
	try {
		const dataDir = getDataDirectory()
		metaPath = path.join(dataDir, "meta.json")

		// Check if meta.json exists
		if (!fs.existsSync(metaPath)) {
			console.log("meta.json does not exist. Continuing...")
			return
		}

		// Read meta.json
		let meta
		try {
			meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
		} catch (error) {
			console.error("Failed to read meta.json:", error.message)
			process.exit(1)
		}

		// Check if lock exists
		if (!meta.lock) {
			console.log("No database lock found. Continuing...")
			return
		}

		const currentTime = Date.now()
		const lockExpiry = meta.lock.timestamp + meta.lock.lockLength

		if (currentTime < lockExpiry) {
			// Lock is still active
			const remainingTime = Math.ceil((lockExpiry - currentTime) / 1000)
			console.error(
				`Database is currently locked. Lock expires in ${remainingTime} seconds.`
			)
			console.error(
				"Please wait for the lock to expire or stop the running application."
			)
			process.exit(1)
		} else {
			// Lock is stale
			console.log("Found stale database lock. Continuing...")
		}
	} catch (error) {
		console.error("Error checking database lock:", error.message)
		process.exit(1)
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
		// Check for existing lock first
		await checkDatabaseLock()

		// Start maintaining our lock
		startLockUpdates()

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
