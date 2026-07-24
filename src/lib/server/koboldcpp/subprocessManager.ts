import { spawn, type ChildProcess } from "child_process"
import * as fs from "fs"
import * as fsPromises from "fs/promises"
import * as path from "path"
import { db } from "$lib/server/db"
import { pingKoboldCPP } from "./kcppHttp"

export type SubprocessStatus =
	| "stopped"
	| "starting"
	| "running"
	| "crashed"
	| "stopping"

export interface SubprocessStatusEvent {
	status: SubprocessStatus
	pid: number | null
	startedAt: string | null
	lastError: string | null
	restartCount: number
	isExternal: boolean
}

interface SubprocessState {
	process: ChildProcess | null
	status: SubprocessStatus
	pid: number | null
	startedAt: Date | null
	lastError: string | null
	restartCount: number
	// See SubprocessStatusEvent.isExternal.
	isExternal: boolean
}

const state: SubprocessState = {
	process: null,
	status: "stopped",
	pid: null,
	startedAt: null,
	lastError: null,
	restartCount: 0,
	isExternal: false
}

let emitStatusFn: ((s: SubprocessStatusEvent) => void) | null = null
let healthInterval: ReturnType<typeof setInterval> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let subprocessTimeoutSecs = 1800
let lastBinaryDir: string | null = null

// Best-effort: if this Node process dies (normal exit, uncaught exception,
// or a caught signal that leads to exit), take the managed koboldcpp
// process group down with it rather than leaving it orphaned. This can't
// catch SIGKILL or a suspend (SIGSTOP) — nothing running in-process can —
// but it covers the common "dev server restarted/crashed" case.
process.on("exit", () => {
	if (state.process?.pid) {
		try {
			process.kill(-state.process.pid, "SIGKILL")
		} catch {}
	}
})

function pidFilePath(binaryDir: string): string {
	return path.join(binaryDir, ".managed-subprocess.pid")
}

async function writePidFile(binaryDir: string, pid: number) {
	try {
		await fsPromises.writeFile(pidFilePath(binaryDir), String(pid))
	} catch {}
}

async function clearPidFile(binaryDir: string) {
	try {
		await fsPromises.unlink(pidFilePath(binaryDir))
	} catch {}
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch {
		return false
	}
}

// Best-effort sanity check so we don't kill an unrelated process that
// happens to have inherited a recycled PID — only meaningful on Linux.
// Off Linux there's no /proc to verify against, so fail closed (skip the
// kill) rather than trust an unverified PID; the subsequent spawn will just
// fail with a normal port-in-use error if a stale orphan is still around.
function pidLooksLikeOurBinary(pid: number, binaryPath: string): boolean {
	if (process.platform !== "linux") return false
	try {
		const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8")
		return cmdline.includes(path.basename(binaryPath))
	} catch {
		return false
	}
}

/**
 * If a previous run of this app left a koboldcpp process behind (e.g. the
 * dev server was killed/crashed without a clean shutdown) and it's still
 * alive but not responding to the port ping in start() — suspended, hung,
 * or otherwise stuck — it'll block a fresh spawn from binding the port.
 * Detect and clear that out before spawning.
 */
async function killStaleOrphan(
	binaryDir: string,
	binaryPath: string
): Promise<void> {
	let recordedPid: number | null = null
	try {
		const raw = await fsPromises.readFile(pidFilePath(binaryDir), "utf8")
		recordedPid = parseInt(raw.trim(), 10) || null
	} catch {
		return
	}
	if (!recordedPid || !isPidAlive(recordedPid)) return
	if (!pidLooksLikeOurBinary(recordedPid, binaryPath)) return

	console.warn(
		`[KoboldCPP] Found a stale managed process (pid ${recordedPid}) from a previous session that isn't responding — terminating it.`
	)
	try {
		process.kill(-recordedPid, "SIGTERM")
	} catch {
		try {
			process.kill(recordedPid, "SIGTERM")
		} catch {}
	}
	const deadline = Date.now() + 5000
	while (Date.now() < deadline && isPidAlive(recordedPid)) {
		await new Promise((r) => setTimeout(r, 250))
	}
	if (isPidAlive(recordedPid)) {
		try {
			process.kill(-recordedPid, "SIGKILL")
		} catch {
			try {
				process.kill(recordedPid, "SIGKILL")
			} catch {}
		}
	}
	await clearPidFile(binaryDir)
}

/**
 * Non-destructive counterpart to killStaleOrphan(): is there a live process
 * matching our own recorded PID file, verified (on Linux) to actually be
 * our binary? If so, an already-active port is a process we genuinely
 * launched in a past session (e.g. this Node process restarted without a
 * clean shutdown) — safe to treat as fully ours, including for Stop.
 * Returns null for a genuinely external process we have no ownership record
 * for, or when running off-Linux where the match can't be verified.
 */
async function findVerifiedOwnedPid(
	binaryDir: string,
	binaryPath: string
): Promise<number | null> {
	let recordedPid: number | null = null
	try {
		const raw = await fsPromises.readFile(pidFilePath(binaryDir), "utf8")
		recordedPid = parseInt(raw.trim(), 10) || null
	} catch {
		return null
	}
	if (!recordedPid || !isPidAlive(recordedPid)) return null
	if (!pidLooksLikeOurBinary(recordedPid, binaryPath)) return null
	return recordedPid
}

export function setEmitter(fn: (s: SubprocessStatusEvent) => void) {
	emitStatusFn = fn
}

function snapshot(): SubprocessStatusEvent {
	return {
		status: state.status,
		pid: state.pid,
		startedAt: state.startedAt?.toISOString() ?? null,
		lastError: state.lastError,
		restartCount: state.restartCount,
		isExternal: state.isExternal
	}
}

export function isExternal(): boolean {
	return state.isExternal
}

function emitStatus() {
	emitStatusFn?.(snapshot())
}

export function getStatus(): SubprocessStatusEvent {
	return snapshot()
}

export function isRunning(): boolean {
	return state.status === "running"
}

function clearIdleTimer() {
	if (idleTimer) {
		clearTimeout(idleTimer)
		idleTimer = null
	}
}

export function pingActivity() {
	clearIdleTimer()
	if (state.status !== "running" || subprocessTimeoutSecs <= 0) return
	idleTimer = setTimeout(() => {
		console.log(
			"[KoboldCPP] Subprocess idle timeout reached, shutting down…"
		)
		stop().catch((err) =>
			console.error("[KoboldCPP] Auto-stop failed:", err)
		)
	}, subprocessTimeoutSecs * 1000)
}

export function setSubprocessTimeout(secs: number) {
	subprocessTimeoutSecs = secs
	if (state.status === "running") pingActivity()
}

async function waitForReady(port: number, timeoutMs = 120_000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await pingKoboldCPP(`http://localhost:${port}`, 2000)) return
		await new Promise((r) => setTimeout(r, 1500))
	}
	throw new Error("KoboldCPP did not become ready within 2 minutes")
}

// Loading a real model via the admin API (ensureModelLoaded's reload_config
// call) can leave koboldcpp unresponsive to other requests for well over 30s
// on a large GGUF/slow disk — long enough to miss a single health-check ping
// while genuinely healthy. Require a few consecutive failures (~90s of total
// unresponsiveness) before declaring it crashed, rather than acting on one
// slow tick and orphaning a process that's still fine. This alone isn't
// always enough for a large/slow-to-load model, so callers that know a load
// is in flight (KoboldCppManagedAdapter.preflight) should also bracket it
// with suspendHealthCheck()/resumeHealthCheck() below — belt and suspenders.
const HEALTH_CHECK_FAILURE_THRESHOLD = 3
let healthCheckFailures = 0
let healthCheckSuspended = false

/** Pause health checking entirely for the duration of a known-slow operation
 * (a model load). Unlike the failure-threshold tolerance above, this has no
 * time limit — a model that takes several minutes to load on slow hardware
 * still won't get its process torn out from under it. Always pair with
 * resumeHealthCheck() in a finally block. */
export function suspendHealthCheck() {
	healthCheckSuspended = true
}

export function resumeHealthCheck() {
	healthCheckSuspended = false
	healthCheckFailures = 0
}

function startHealthCheck(port: number) {
	stopHealthCheck()
	healthInterval = setInterval(async () => {
		if (state.status !== "running" || healthCheckSuspended) return
		const ok = await pingKoboldCPP(`http://localhost:${port}`, 5000)
		if (ok) {
			healthCheckFailures = 0
			return
		}
		healthCheckFailures++
		if (
			healthCheckFailures >= HEALTH_CHECK_FAILURE_THRESHOLD &&
			state.status === "running"
		) {
			clearIdleTimer()
			state.status = "crashed"
			state.lastError = "Health check failed — process may have crashed"
			state.process = null
			state.pid = null
			emitStatus()
		}
	}, 30_000)
}

function stopHealthCheck() {
	healthCheckFailures = 0
	if (healthInterval) {
		clearInterval(healthInterval)
		healthInterval = null
	}
}

// Early-exit failures below happen before a real process ever spawns, so
// there's nothing for the normal proc.on("error"/"exit") handlers to report.
// Without this, callers that only console.error() a rejected start() (the
// manual "start" button, and the auto-start after a binary download) leave
// the client with no feedback at all — the UI keeps showing "stopped" while
// the real reason only ever reaches the server log.
function failStart(message: string): never {
	state.status = "crashed"
	state.lastError = message
	state.process = null
	state.pid = null
	emitStatus()
	throw new Error(message)
}

// Guards the whole body of start() below against concurrent invocation —
// e.g. a group chat where several characters each trigger their own
// preflight() at nearly the same moment right as the process is discovered
// dead. Without this, two calls can both slip past the state checks (there
// are several `await`s — a DB query, a port ping, a binary-existence check —
// before state.status ever flips to "starting") and both proceed to spawn,
// leaving two koboldcpp processes racing for the same port. Concurrent
// callers now await the same in-flight attempt instead, same pattern as
// modelManager.ts's loadingPromise for concurrent model loads.
let startingPromise: Promise<void> | null = null

export async function start(): Promise<void> {
	if (startingPromise) return startingPromise
	startingPromise = doStart()
	try {
		await startingPromise
	} finally {
		startingPromise = null
	}
}

async function doStart(): Promise<void> {
	if (state.status === "starting") return
	if (state.status === "running") {
		// Only a process we spawned ourselves (a live state.process handle) is
		// trustworthy without re-pinging — a real crash gets caught by its
		// own proc.on("exit") handler, or by the health check within its
		// tolerance window. Any *adopted* process — whether "owned" (a
		// verified-but-unhandled PID from a previous session) or fully
		// external — has neither: no live handle, and it can disappear at
		// any moment outside our control or the health check's ~90s-tolerant
		// cadence (which is itself suspended for the whole duration of a
		// model load — see suspendHealthCheck()/resumeHealthCheck() — so a
		// crash mid-load goes completely unnoticed until something re-pings).
		// Trusting stale "running" state for either adopted case left start()
		// silently no-op'ing after the process vanished, which then made
		// preflight blame the resulting ECONNREFUSED on a bogus "credentials
		// mismatch" (see KoboldCppManagedAdapter) instead of just restarting
		// our own instance like it should — this is also why a manual
		// Stop/Start "always works": Stop unconditionally clears state,
		// removing the stale trust this check was granting.
		if (state.process) return
		const settingsForPing = await db.query.koboldCppSettings.findFirst()
		const port = settingsForPing?.koboldCppManagedPort ?? 5001
		if (await pingKoboldCPP(`http://localhost:${port}`, 2000)) return
		stopHealthCheck()
		clearIdleTimer()
		state.status = "stopped"
		state.isExternal = false
		state.pid = null
	}

	const settings = await db.query.koboldCppSettings.findFirst()
	if (
		!settings?.koboldCppManagerEnabled ||
		settings?.koboldCppManagedMode !== "managed"
	) {
		failStart("Managed mode is not enabled")
	}

	const {
		koboldCppManagedBinaryDir: binaryDir,
		koboldCppManagedBinaryVariant: binaryVariant
	} = settings
	if (!binaryDir || !binaryVariant) failStart("Binary not configured")

	lastBinaryDir = binaryDir
	const binaryPath = path.join(binaryDir, binaryVariant)

	try {
		await fsPromises.access(binaryPath, fs.constants.F_OK)
	} catch {
		failStart(`Binary not found at ${binaryPath}`)
	}

	if (process.platform !== "win32") {
		await fsPromises.chmod(binaryPath, 0o755)
	}

	const port = settings.koboldCppManagedPort ?? 5001
	const password = settings.koboldCppManagedAdminPassword ?? "serene"
	subprocessTimeoutSecs =
		settings.koboldCppManagedSubprocessTimeoutSecs ?? 1800

	// If KoboldCPP is already reachable (e.g. left over from a previous server session),
	// adopt it rather than spawning a second instance on the same port.
	if (await pingKoboldCPP(`http://localhost:${port}`, 2000)) {
		const ownedPid = await findVerifiedOwnedPid(binaryDir, binaryPath)
		if (ownedPid) {
			console.log(
				`[KoboldCPP] Port ${port} already active — adopting our own process (pid ${ownedPid}) from a previous session`
			)
		} else {
			console.log(
				`[KoboldCPP] Port ${port} already active — adopting external instance we didn't start; Stop/Unload won't be available for it`
			)
		}
		state.status = "running"
		state.pid = ownedPid
		state.isExternal = !ownedPid
		state.startedAt = new Date()
		state.lastError = null
		emitStatus()
		startHealthCheck(port)
		pingActivity()
		return
	} else {
		// Port is free (or the process behind it is unresponsive) — check for
		// and clean up a stale process left behind by a previous session
		// before we try to spawn on top of it.
		await killStaleOrphan(binaryDir, binaryPath)
	}

	state.status = "starting"
	state.lastError = null
	state.isExternal = false
	emitStatus()

	// --admindir must be explicit: koboldcpp's admin reload/list-options endpoints jail
	// requests to this directory, and ensureModelLoaded() writes its .kcpps files here.
	// --host is bound to loopback only: the app always reaches this subprocess via
	// localhost (see pingKoboldCPP calls below), and koboldcpp's own generation/completion
	// endpoints (e.g. /lcpp/) aren't gated by --adminpassword, so binding 0.0.0.0 would
	// expose an unauthenticated inference API to the whole LAN on non-Docker deployments.
	const args = [
		"--host",
		"127.0.0.1",
		"--port",
		String(port),
		"--admin",
		"--adminpassword",
		password,
		"--admindir",
		binaryDir,
		"--nomodel"
	]

	// detached: true makes koboldcpp the leader of its own process group (setsid),
	// so we can reliably kill it AND any children it spawns (its PyInstaller
	// bootstrap process forks a real worker process) with a single group-kill
	// via a negative PID, instead of leaving pieces behind.
	const proc = spawn(binaryPath, args, {
		stdio: ["ignore", "pipe", "pipe"],
		detached: true
	})

	state.process = proc
	state.pid = proc.pid ?? null
	state.startedAt = new Date()
	state.restartCount++
	if (proc.pid) await writePidFile(binaryDir, proc.pid)

	proc.stdout?.on("data", (chunk: Buffer) => {
		console.log("[KoboldCPP]", chunk.toString().trimEnd())
	})
	proc.stderr?.on("data", (chunk: Buffer) => {
		console.error("[KoboldCPP stderr]", chunk.toString().trimEnd())
	})

	proc.on("error", (err) => {
		clearIdleTimer()
		state.status = "crashed"
		state.lastError = err.message
		state.process = null
		state.pid = null
		stopHealthCheck()
		clearPidFile(binaryDir).catch(() => {})
		emitStatus()
	})

	proc.on("exit", (code, signal) => {
		clearIdleTimer()
		stopHealthCheck()
		if (state.status !== "stopping") {
			state.status = "crashed"
			state.lastError = `Exited — code ${code ?? "?"} signal ${signal ?? "none"}`
		} else {
			state.status = "stopped"
		}
		state.process = null
		state.pid = null
		clearPidFile(binaryDir).catch(() => {})
		emitStatus()
	})

	try {
		await waitForReady(port)
	} catch (err: any) {
		// Process may still be starting — kill the whole group and propagate
		if (proc.pid) {
			try {
				process.kill(-proc.pid, "SIGKILL")
			} catch {
				proc.kill("SIGKILL")
			}
		}
		state.status = "crashed"
		state.lastError = err.message
		state.process = null
		state.pid = null
		await clearPidFile(binaryDir)
		emitStatus()
		throw err
	}

	state.status = "running"
	emitStatus()
	startHealthCheck(port)
	pingActivity()
}

export async function stop(): Promise<void> {
	clearIdleTimer()

	// Nothing we're tracking as running at all — plain no-op.
	if (!state.process && state.status !== "running") {
		state.status = "stopped"
		state.pid = null
		state.isExternal = false
		emitStatus()
		return
	}

	// Adopted a process we can't verify we own (no matching PID-file record)
	// — refuse rather than silently flipping our own bookkeeping to
	// "stopped" while the real process keeps running untouched. That
	// silent-no-op is exactly the bug this branch exists to prevent: Stop
	// (and a subsequent Start) would otherwise look like they worked —
	// fresh "Started" timestamp and all — without ever touching the actual
	// process, which is precisely what generation preflight then fails
	// against.
	if (!state.process && state.isExternal) {
		throw new Error(
			"This KoboldCPP instance is running externally and wasn't started by Serene Pub's Manager, so it can't be stopped from here. Stop it manually, or point the Manager at a different port."
		)
	}

	state.status = "stopping"
	emitStatus()
	stopHealthCheck()

	if (state.process) {
		// We hold a live handle from spawning it this session.
		const proc = state.process
		const pid = proc.pid
		state.process = null

		await new Promise<void>((resolve) => {
			const forceKill = setTimeout(() => {
				if (pid) {
					try {
						process.kill(-pid, "SIGKILL")
					} catch {
						proc.kill("SIGKILL")
					}
				} else {
					proc.kill("SIGKILL")
				}
				resolve()
			}, 10_000)

			proc.once("exit", () => {
				clearTimeout(forceKill)
				resolve()
			})

			if (pid) {
				try {
					process.kill(-pid, "SIGTERM")
				} catch {
					proc.kill("SIGTERM")
				}
			} else {
				proc.kill("SIGTERM")
			}
		})
	} else if (state.pid) {
		// Adopted from a previous session, verified ours via the PID file —
		// no live ChildProcess handle in this process, but a real, verified
		// PID we can signal directly (same approach as killStaleOrphan).
		const pid = state.pid
		await new Promise<void>((resolve) => {
			try {
				process.kill(-pid, "SIGTERM")
			} catch {
				try {
					process.kill(pid, "SIGTERM")
				} catch {}
			}
			const deadline = Date.now() + 10_000
			const poll = setInterval(() => {
				if (!isPidAlive(pid) || Date.now() > deadline) {
					clearInterval(poll)
					if (isPidAlive(pid)) {
						try {
							process.kill(-pid, "SIGKILL")
						} catch {
							try {
								process.kill(pid, "SIGKILL")
							} catch {}
						}
					}
					resolve()
				}
			}, 250)
		})
	}

	state.status = "stopped"
	state.pid = null
	state.isExternal = false
	emitStatus()

	if (lastBinaryDir) await clearPidFile(lastBinaryDir)
}
