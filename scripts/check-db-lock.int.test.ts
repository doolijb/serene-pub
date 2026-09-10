/**
 * `scripts/check-db-lock.js`, run the way `npm run db:generate` runs it.
 *
 * This script is plain JavaScript that no typechecker or bundler ever sees, and
 * it writes the same `meta.lock` the app reads — which is how the two came to
 * disagree about how long a lock lasts (5s there, 10s in the app) without
 * anything noticing. These run the real file with a real `node`, so a broken
 * import or a drifted constant fails here rather than in someone's `db:generate`.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { DEFAULT_LOCK_LENGTH, getIdentity } from "../src/lib/server/db/lock.js"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const projectRoot = fileURLToPath(new URL("..", import.meta.url))
const script = path.join(projectRoot, "scripts", "check-db-lock.js")
const lockModule = path.join(projectRoot, "src/lib/server/db/lock.js")

/**
 * The script loads the project's own .env over the environment it inherits, so
 * a developer who points one at a real data directory would otherwise get a
 * confusing failure here rather than a skip.
 */
const envOverridesDataDir = (() => {
	const envPath = path.join(projectRoot, ".env")
	if (!fs.existsSync(envPath)) return false
	return /^\s*SERENE_PUB_DATA_DIR\s*=/m.test(
		fs.readFileSync(envPath, "utf-8")
	)
})()

let root: string
let dataDir: string
let metaPath: string
let holder: ChildProcess | null = null

function run(args: string[]) {
	return new Promise<{ code: number; stdout: string; stderr: string }>(
		(resolve) => {
			const child = spawn(process.execPath, [script, ...args], {
				cwd: projectRoot,
				env: {
					...process.env,
					SERENE_PUB_DATA_DIR: root,
					// The script resolves CI before the override, exactly as the
					// app does; under CI it would otherwise ignore `root`.
					CI: ""
				}
			})
			let stdout = ""
			let stderr = ""
			child.stdout.on("data", (c) => (stdout += c))
			child.stderr.on("data", (c) => (stderr += c))
			child.once("exit", (code) =>
				resolve({ code: code ?? -1, stdout, stderr })
			)
		}
	)
}

/** A live process holding the lock, the way a running app does. */
async function startHolder() {
	const holderPath = path.join(root, "holder.mjs")
	fs.writeFileSync(
		holderPath,
		`import { createLockHeartbeat } from ${JSON.stringify(lockModule)}
const heartbeat = createLockHeartbeat({
	metaPath: ${JSON.stringify(metaPath)},
	dataDir: ${JSON.stringify(dataDir)},
	label: "app",
	lockLength: 4000,
	interval: 500
})
heartbeat.start()
process.stdout.write("ready\\n")
setInterval(() => {}, 10_000)
`
	)
	const child = spawn(process.execPath, [holderPath], {
		stdio: ["ignore", "pipe", "inherit"]
	})
	holder = child
	await new Promise<void>((resolve, reject) => {
		child.stdout!.setEncoding("utf-8")
		child.stdout!.on(
			"data",
			(c: string) => c.includes("ready") && resolve()
		)
		child.once("exit", () => reject(new Error("holder exited early")))
	})
	return child.pid!
}

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "serene-pub-cli-lock-"))
	dataDir = path.join(root, "data")
	fs.mkdirSync(dataDir)
	metaPath = path.join(dataDir, "meta.json")
	fs.writeFileSync(
		metaPath,
		JSON.stringify(
			{ version: "0.0.0", cryptoSecretKey: "keep-me" },
			null,
			2
		)
	)
})

afterEach(async () => {
	if (holder && holder.exitCode === null) {
		holder.kill("SIGTERM")
		await new Promise((resolve) => holder!.once("exit", resolve))
	}
	holder = null
	fs.rmSync(root, { recursive: true, force: true })
})

describe.skipIf(envOverridesDataDir)("check-db-lock.js", () => {
	test("holds a lock that the app can read, in the app's own spelling", async () => {
		// The wrapped command snapshots meta.json while the lock is held. It
		// runs through the script's own `shell: true`, so it is kept to bare
		// arguments rather than anything a second shell would re-interpret.
		const snapshot = path.join(root, "held.json")
		const result = await run(["cp", metaPath, snapshot])
		expect(result.code).toBe(0)

		const held = JSON.parse(fs.readFileSync(snapshot, "utf-8"))
		expect(held.lock.lockLength).toBe(DEFAULT_LOCK_LENGTH)
		expect(held.lock.owner.label).toBe("db-cli")
		expect(held.lock.owner.hostId).toBe(getIdentity().hostId)
		expect(held.lock.owner.pid).toEqual(expect.any(Number))
		// It did not trample the rest of the file on the way in.
		expect(held.cryptoSecretKey).toBe("keep-me")

		// And it released the lock when the command finished.
		expect(
			JSON.parse(fs.readFileSync(metaPath, "utf-8")).lock
		).toBeUndefined()
	})

	test("refuses to run while the app holds the lock, and says who", async () => {
		const pid = await startHolder()
		const result = await run(["true"])
		expect(result.code).toBe(1)
		expect(result.stderr).toContain(`pid ${pid}`)
		expect(result.stderr).toContain("Stop the other Serene Pub instance")
	})

	test("runs straight through a lock whose owner is gone", async () => {
		// A crash leaves this behind. It is inside its window, so timestamps
		// alone would have blocked `db:generate` for the rest of the lock's
		// life; the owner being gone settles it immediately.
		const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
		meta.lock = {
			timestamp: Date.now(),
			lockLength: DEFAULT_LOCK_LENGTH,
			owner: {
				// Above every platform's pid_max, so it cannot ever be running.
				pid: 0x7ffffffe,
				hostId: getIdentity().hostId,
				hostname: getIdentity().hostname,
				instanceId: "a-run-that-crashed",
				label: "app"
			}
		}
		fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))

		const result = await run(["true"])
		expect(result.stdout).toContain("Found stale database lock")
		expect(result.code).toBe(0)
	})
})
