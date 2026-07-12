import { spawn, type ChildProcess } from "child_process"
import * as fs from "fs"
import * as fsPromises from "fs/promises"
import * as path from "path"
import { db } from "$lib/server/db"
import { pingKoboldCpp } from "./kcppHttp"

export type SubprocessStatus = "stopped" | "starting" | "running" | "crashed" | "stopping"

export interface SubprocessStatusEvent {
	status: SubprocessStatus
	pid: number | null
	startedAt: string | null
	lastError: string | null
	restartCount: number
}

interface SubprocessState {
	process: ChildProcess | null
	status: SubprocessStatus
	pid: number | null
	startedAt: Date | null
	lastError: string | null
	restartCount: number
}

const state: SubprocessState = {
	process: null,
	status: "stopped",
	pid: null,
	startedAt: null,
	lastError: null,
	restartCount: 0
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
async function killStaleOrphan(binaryDir: string, binaryPath: string): Promise<void> {
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

export function setEmitter(fn: (s: SubprocessStatusEvent) => void) {
	emitStatusFn = fn
}

function snapshot(): SubprocessStatusEvent {
	return {
		status: state.status,
		pid: state.pid,
		startedAt: state.startedAt?.toISOString() ?? null,
		lastError: state.lastError,
		restartCount: state.restartCount
	}
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
		console.log("[KoboldCPP] Subprocess idle timeout reached, shutting down…")
		stop().catch((err) => console.error("[KoboldCPP] Auto-stop failed:", err))
	}, subprocessTimeoutSecs * 1000)
}

export function setSubprocessTimeout(secs: number) {
	subprocessTimeoutSecs = secs
	if (state.status === "running") pingActivity()
}

async function waitForReady(port: number, timeoutMs = 120_000): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (Date.now() < deadline) {
		if (await pingKoboldCpp(`http://localhost:${port}`, 2000)) return
		await new Promise((r) => setTimeout(r, 1500))
	}
	throw new Error("KoboldCPP did not become ready within 2 minutes")
}

function startHealthCheck(port: number) {
	stopHealthCheck()
	healthInterval = setInterval(async () => {
		if (state.status !== "running") return
		const ok = await pingKoboldCpp(`http://localhost:${port}`, 5000)
		if (!ok && state.status === "running") {
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

export async function start(): Promise<void> {
	if (state.status === "running" || state.status === "starting") return

	const settings = await db.query.koboldCppSettings.findFirst()
	if (!settings?.koboldCppManagerEnabled || settings?.koboldCppManagedMode !== "managed") {
		failStart("Managed mode is not enabled")
	}

	const { koboldCppManagedBinaryDir: binaryDir, koboldCppManagedBinaryVariant: binaryVariant } =
		settings
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
	subprocessTimeoutSecs = settings.koboldCppManagedSubprocessTimeoutSecs ?? 1800

	// If KoboldCPP is already reachable (e.g. left over from a previous server session),
	// adopt it rather than spawning a second instance on the same port.
	if (await pingKoboldCpp(`http://localhost:${port}`, 2000)) {
		console.log(`[KoboldCPP] Port ${port} already active — adopting existing instance`)
		state.status = "running"
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
	emitStatus()

	// --admindir must be explicit: koboldcpp's admin reload/list-options endpoints jail
	// requests to this directory, and ensureModelLoaded() writes its .kcpps files here.
	const args = [
		"--host", "0.0.0.0",
		"--port", String(port),
		"--admin", "--adminpassword", password, "--admindir", binaryDir,
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

	if (!state.process) {
		state.status = "stopped"
		state.pid = null
		emitStatus()
		return
	}

	state.status = "stopping"
	emitStatus()
	stopHealthCheck()

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
			state.status = "stopped"
			state.pid = null
			emitStatus()
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

	if (lastBinaryDir) await clearPidFile(lastBinaryDir)
}
