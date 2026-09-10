/**
 * The database lock against real processes and a real `meta.json`.
 *
 * The bug these exist for was a timing bug that no amount of reasoning about
 * the file contents would have caught: the check slept for the expiry of the
 * lock it first saw and rechecked exactly once, while the process it was
 * waiting on refreshed that lock every few seconds. The recheck therefore
 * landed on a freshly renewed lock and the incoming process exited — "it waits
 * the correct amount of time but still thinks the db is locked".
 *
 * So the holder here is a genuine second process, heartbeating on a timer, and
 * the assertions are about what a *timestamp-only* reader would still have
 * concluded at the moment we were let through.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { spawn, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
	DEFAULT_LOCK_LENGTH,
	LOCK_UNREADABLE_GRACE,
	checkDatabaseLock,
	createLockHeartbeat,
	evaluateLock,
	getIdentity
} from "./lock.js"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const lockModule = fileURLToPath(new URL("./lock.js", import.meta.url))

let root: string
let dataDir: string
let metaPath: string
let holderPath: string

/** Everything spawned by a test, so a failure cannot leak a live process. */
let holders: Holder[] = []

interface Holder {
	pid: number
	child: ChildProcess
	/** Exit cleanly, releasing the lock the way a graceful shutdown does. */
	release(): Promise<void>
	/** Exit without releasing, the way a crash or a `kill -9` leaves it. */
	abandon(): Promise<void>
	exited: Promise<void>
}

/**
 * A second process that takes the lock and keeps refreshing it.
 *
 * Scaled down from the shipped 10s/9s so a test does not spend minutes waiting,
 * but the shape is the same: refresh comfortably before expiry, so a reader
 * that sleeps once for the expiry it first saw always wakes to a renewed lock.
 */
async function startHolder(lockLength = 2000, interval = 600): Promise<Holder> {
	const child = spawn(
		process.execPath,
		[holderPath, metaPath, dataDir, String(lockLength), String(interval)],
		{ stdio: ["pipe", "pipe", "inherit"] }
	)
	const exited = new Promise<void>((resolve) =>
		child.once("exit", () => resolve())
	)
	await new Promise<void>((resolve, reject) => {
		child.stdout!.setEncoding("utf-8")
		child.stdout!.on("data", (chunk: string) => {
			if (chunk.includes("ready")) resolve()
		})
		child.once("error", reject)
		child.once("exit", () =>
			reject(new Error("holder exited before ready"))
		)
	})

	const say = async (command: string) => {
		child.stdin!.write(`${command}\n`)
		await exited
	}

	const holder: Holder = {
		pid: child.pid!,
		child,
		exited,
		release: () => say("release"),
		abandon: () => say("abandon")
	}
	holders.push(holder)
	return holder
}

/** What a reader with no notion of ownership would have decided, right now. */
function timestampOnlyVerdict() {
	const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
	return evaluateLock(meta.lock, {
		identity: { ...getIdentity(), hostId: "some-other-machine" }
	})
}

function writeMeta(lock: unknown) {
	fs.writeFileSync(
		metaPath,
		JSON.stringify(
			{ version: "0.0.0", cryptoSecretKey: "keep-me", lock },
			null,
			2
		)
	)
}

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), "serene-pub-lock-test-"))
	dataDir = path.join(root, "data")
	fs.mkdirSync(dataDir)
	metaPath = path.join(dataDir, "meta.json")
	holderPath = path.join(root, "holder.mjs")
	fs.writeFileSync(
		holderPath,
		`import { createLockHeartbeat } from ${JSON.stringify(lockModule)}
const [metaPath, dataDir, lockLength, interval] = process.argv.slice(2)
const heartbeat = createLockHeartbeat({
	metaPath,
	dataDir,
	label: "test-holder",
	lockLength: Number(lockLength),
	interval: Number(interval)
})
heartbeat.start()
process.stdin.setEncoding("utf-8")
process.stdin.on("data", (chunk) => {
	const command = chunk.trim()
	// "release" is a graceful shutdown; "abandon" leaves the lock behind, the
	// way a crash does.
	if (command === "release") heartbeat.stop()
	if (command === "release" || command === "abandon") process.exit(0)
})
process.stdout.write("ready\\n")
`
	)
	writeMeta(undefined)
})

afterEach(async () => {
	for (const holder of holders) {
		if (
			holder.child.exitCode === null &&
			holder.child.signalCode === null
		) {
			// SIGTERM only — these hold nothing but a JSON file, and the habit
			// of reaching for SIGKILL is what corrupts a PGlite WAL elsewhere.
			holder.child.kill("SIGTERM")
			await holder.exited
		}
	}
	holders = []
	fs.rmSync(root, { recursive: true, force: true })
})

describe("a holder that goes away mid-wait", () => {
	test("the reported bug: the wait ends when the owner does, not when its lock expires", async () => {
		const holder = await startHolder()

		// Let it refresh at least once, so the lock we are about to wait on is
		// not the one it took at startup.
		await new Promise((resolve) => setTimeout(resolve, 700))

		const check = checkDatabaseLock({
			metaPath,
			waitTimeout: 20_000,
			pollInterval: 50
		})

		// Two more refreshes land inside the wait — this is the part the old
		// single recheck could not survive — and only then does it exit,
		// leaving its lock in the file.
		await new Promise((resolve) => setTimeout(resolve, 1300))
		await holder.abandon()

		const result = await check

		expect(result.ok).toBe(true)
		// Released because the owner is gone, not because the clock ran out.
		expect(result.evaluation.reason).toBe("owner-gone")
		expect(result.polls).toBeGreaterThan(1)

		// The claim, stated as the old implementation would have seen it: the
		// lock is still sitting in meta.json, still inside its window. Anything
		// reading only the timestamp is still blocked right now.
		expect(timestampOnlyVerdict().state).toBe("held")
	})

	test("a holder that shuts down gracefully releases immediately too", async () => {
		const holder = await startHolder()
		const check = checkDatabaseLock({
			metaPath,
			waitTimeout: 20_000,
			pollInterval: 50
		})
		await new Promise((resolve) => setTimeout(resolve, 700))
		await holder.release()

		const result = await check
		expect(result.ok).toBe(true)
		expect(result.evaluation.state).toBe("free")
		// It cleared its own lock on the way out.
		expect(
			JSON.parse(fs.readFileSync(metaPath, "utf-8")).lock
		).toBeUndefined()
	})
})

describe("a holder that is already gone", () => {
	test("is stale on the first read, with no wait at all", async () => {
		const holder = await startHolder()
		await holder.abandon()

		const result = await checkDatabaseLock({
			metaPath,
			waitTimeout: 20_000,
			pollInterval: 50
		})

		expect(result.ok).toBe(true)
		expect(result.evaluation.reason).toBe("owner-gone")
		expect(result.polls).toBe(1)
		expect(result.waitedMs).toBeLessThan(250)
		// Still inside its timestamp window: the old code would have waited it
		// out in full.
		expect(timestampOnlyVerdict().state).toBe("held")
	})

	test("the lock it left behind names it", async () => {
		const holder = await startHolder()
		await holder.abandon()

		const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
		expect(meta.lock.owner.pid).toBe(holder.pid)
		expect(meta.lock.owner.label).toBe("test-holder")
		expect(meta.lock.owner.hostId).toBe(getIdentity().hostId)
		expect(meta.lock.owner.instanceId).toEqual(expect.any(String))
		// The fields an older build reads are still there, and still mean what
		// they meant.
		expect(meta.lock.timestamp).toEqual(expect.any(Number))
		expect(meta.lock.lockLength).toBe(2000)
		// And nothing else in the file was disturbed.
		expect(meta.cryptoSecretKey).toBe("keep-me")
	})
})

describe("a holder that is alive", () => {
	test("still blocks, and the protection survives", async () => {
		const holder = await startHolder()

		const result = await checkDatabaseLock({
			metaPath,
			waitTimeout: 1200,
			pollInterval: 50
		})

		expect(result.ok).toBe(false)
		expect(result.evaluation.state).toBe("held")
		expect(result.evaluation.reason).toBe("owner-alive")
		expect(result.waitedMs).toBeGreaterThanOrEqual(1200)
		expect(result.polls).toBeGreaterThan(5)
		// Fails loudly and usefully: who, and what to do about it.
		expect(result.message).toContain(`pid ${holder.pid}`)
		expect(result.message).toContain("this machine")
		expect(result.message).toContain(metaPath)
		expect(result.message).toContain("Stop the other Serene Pub instance")
	})

	test("keeps blocking well past the lock length it first saw", async () => {
		// The old failure in one line: a holder refreshing on a timer means the
		// lock never expires, so waiting for the first-seen expiry proves
		// nothing either way.
		await startHolder(800, 300)
		const result = await checkDatabaseLock({
			metaPath,
			waitTimeout: 2400,
			pollInterval: 50
		})
		expect(result.ok).toBe(false)
		expect(result.evaluation.reason).toBe("owner-alive")
	})

	test("a process that never took a lock does not clear one", async () => {
		const holder = await startHolder()
		const before = JSON.parse(fs.readFileSync(metaPath, "utf-8")).lock

		// The loser of the race, shutting down. Every process that imported the
		// db module used to run this on `exit` whether it held anything or not
		// — including one exiting *because* it lost — so losing the race is how
		// the winner's lock got deleted out from under it.
		const loser = createLockHeartbeat({ metaPath, dataDir, label: "loser" })
		loser.stop()

		const after = JSON.parse(fs.readFileSync(metaPath, "utf-8")).lock
		expect(after.owner.pid).toBe(holder.pid)
		expect(after.owner.instanceId).toBe(before.owner.instanceId)
	})

	test("a process that did take a lock only clears its own", async () => {
		// The other half: we held it, somebody else has it now (ours expired
		// and was taken over), and we are shutting down. Releasing here would
		// advertise a live holder's database as free.
		const mine = createLockHeartbeat({
			metaPath,
			dataDir,
			label: "app",
			interval: 60_000
		})
		mine.start()
		expect(mine.isHolding()).toBe(true)

		const holder = await startHolder()
		expect(
			JSON.parse(fs.readFileSync(metaPath, "utf-8")).lock.owner.pid
		).toBe(holder.pid)

		mine.stop()

		const after = JSON.parse(fs.readFileSync(metaPath, "utf-8")).lock
		expect(after).toBeDefined()
		expect(after.owner.pid).toBe(holder.pid)
	})
})

describe("a lock with no ownership fields", () => {
	// Written by an older build, or by anything that could not identify itself.
	// The timestamp is all there is, and it still decides.
	const legacy = (ageMs: number, lockLength = DEFAULT_LOCK_LENGTH) => ({
		timestamp: Date.now() - ageMs,
		lockLength
	})

	test("is honoured until it expires, then released", async () => {
		writeMeta(legacy(0, 800))

		const result = await checkDatabaseLock({
			metaPath,
			waitTimeout: 20_000,
			pollInterval: 50
		})

		expect(result.ok).toBe(true)
		expect(result.evaluation.reason).toBe("expired")
		expect(result.waitedMs).toBeGreaterThanOrEqual(700)
		expect(result.polls).toBeGreaterThan(1)
	})

	test("is stale immediately once its window has passed", async () => {
		writeMeta(legacy(DEFAULT_LOCK_LENGTH + 1))
		const result = await checkDatabaseLock({
			metaPath,
			waitTimeout: 20_000
		})
		expect(result.ok).toBe(true)
		expect(result.evaluation.reason).toBe("expired")
		expect(result.polls).toBe(1)
	})

	test("blocks a caller that will not wait", async () => {
		writeMeta(legacy(0))
		const result = await checkDatabaseLock({ metaPath, waitTimeout: 0 })
		expect(result.ok).toBe(false)
		expect(result.evaluation.reason).toBe("unexpired")
		expect(result.message).toContain("an unidentified process")
	})
})

describe("locks this machine cannot vouch for", () => {
	test("a dead pid from another machine is not our evidence", async () => {
		// The dangerous direction, end to end: the pid genuinely is not running
		// here, and that must count for nothing, because "here" is not where
		// the lock was written. Only the timestamp may release it.
		const holder = await startHolder()
		await holder.abandon()
		const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"))
		meta.lock.owner.hostId = "a-different-machine"
		fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2))

		const result = await checkDatabaseLock({ metaPath, waitTimeout: 0 })
		expect(result.ok).toBe(false)
		expect(result.evaluation.reason).toBe("unexpired")
		expect(result.message).toContain("a different machine or container")
	})
})

describe("meta.json under a live writer", () => {
	test("a lock is never read as absent while it is being rewritten", async () => {
		// The heartbeat rewrites this file on a timer while the wait re-reads it
		// several times a second. A torn read looks exactly like "no lock",
		// which is the one misreading that lets two processes in — so the write
		// is atomic and this hammers it.
		await startHolder(60_000, 1)
		const started = Date.now()
		let reads = 0
		while (Date.now() - started < 1500) {
			const raw = fs.readFileSync(metaPath, "utf-8")
			const meta = JSON.parse(raw)
			expect(meta.lock).toBeDefined()
			expect(meta.cryptoSecretKey).toBe("keep-me")
			reads += 1
		}
		expect(reads).toBeGreaterThan(100)
	})
})

describe("an unreadable meta.json", () => {
	test("is retried before it is believed, and the lock behind it is honoured", async () => {
		// A build that does not write atomically can be caught mid-file. Parsing
		// nothing must not be read as "no lock" — so the read is retried, and
		// the live lock that reappears a moment later still keeps us out.
		const holder = await startHolder(2000, 100)
		const intact = fs.readFileSync(metaPath, "utf-8")

		// Truncated, then checked before anything can yield, so the first read
		// is guaranteed to land mid-write.
		fs.writeFileSync(metaPath, intact.slice(0, 40))
		const check = checkDatabaseLock({
			metaPath,
			waitTimeout: 2000,
			pollInterval: 25
		})
		// ...and the writer finishes its write.
		setTimeout(() => fs.writeFileSync(metaPath, intact), 100)

		const result = await check
		expect(result.polls).toBeGreaterThan(1)
		expect(result.ok).toBe(false)
		expect(result.evaluation.reason).toBe("owner-alive")
		expect(result.message).toContain(`pid ${holder.pid}`)
	})

	test("is reported once the grace has passed, not repaired", async () => {
		fs.writeFileSync(metaPath, "not json at all")
		const result = await checkDatabaseLock({
			metaPath,
			waitTimeout: 20_000,
			pollInterval: 50
		})
		expect(result.evaluation.state).toBe("unreadable")
		expect(result.waitedMs).toBeGreaterThanOrEqual(LOCK_UNREADABLE_GRACE)
		expect(result.polls).toBeGreaterThan(1)
		// The file is left exactly as it was found. Rewriting it here is how
		// the crypto secret key would get silently replaced.
		expect(fs.readFileSync(metaPath, "utf-8")).toBe("not json at all")
	})

	test("is never rebuilt by the lock heartbeat", async () => {
		// The old heartbeat, on failing to parse this file, replaced it with
		// `{ version: "0.0.0", cryptoSecretKey: <a fresh uuid> }` and wrote its
		// lock into that — silently discarding the real key, and with it every
		// secret in the database that was encrypted under it. Skipping the beat
		// is the only safe answer: the file's owner repairs it, not the lock.
		const damaged = '{"version":"0.6.0","cryptoSecretKey":"the-real-key"'
		fs.writeFileSync(metaPath, damaged)

		const heartbeat = createLockHeartbeat({
			metaPath,
			dataDir,
			label: "app",
			interval: 50
		})
		heartbeat.start()
		try {
			await new Promise((resolve) => setTimeout(resolve, 250))
			expect(fs.readFileSync(metaPath, "utf-8")).toBe(damaged)
			// Nothing was taken, so nothing is held.
			expect(heartbeat.isHolding()).toBe(false)
		} finally {
			heartbeat.stop()
		}
		// ...and stopping does not repair it either.
		expect(fs.readFileSync(metaPath, "utf-8")).toBe(damaged)
	})

	test("is reported at once to a caller that will not wait", async () => {
		fs.writeFileSync(metaPath, "not json at all")
		const result = await checkDatabaseLock({ metaPath, waitTimeout: 0 })
		expect(result.evaluation.state).toBe("unreadable")
		expect(result.polls).toBe(1)
	})

	test("a missing meta.json is simply a fresh data directory", async () => {
		fs.rmSync(metaPath)
		const result = await checkDatabaseLock({
			metaPath,
			waitTimeout: 20_000
		})
		expect(result.ok).toBe(true)
		expect(result.evaluation.state).toBe("free")
	})
})

describe("this process's own lock", () => {
	test("does not block this process", async () => {
		const mine = createLockHeartbeat({ metaPath, dataDir, label: "app" })
		mine.start()
		try {
			const result = await checkDatabaseLock({
				metaPath,
				waitTimeout: 20_000
			})
			expect(result.ok).toBe(true)
			expect(result.evaluation.state).toBe("self")
			expect(result.waitedMs).toBeLessThan(250)
		} finally {
			mine.stop()
		}
	})
})
