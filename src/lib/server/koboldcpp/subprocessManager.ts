import { spawn, type ChildProcess } from "child_process"
import * as fs from "fs"
import * as fsPromises from "fs/promises"
import * as path from "path"
import { randomUUID } from "crypto"
import { eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { pingKoboldCPP } from "./kcppHttp"
import { pollUntilReady } from "./pollUntilReady"

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

// Map<userId, {emit, connections}>, not a single nullable slot or a
// Set<EmitFn> — see binaryManager.ts's registerEmitter for the full
// rationale (same anti-pattern: a Set overcorrects the old single-slot bug
// into an N² broadcast when the same admin has multiple tabs open, since
// registration happens once per connection but emitToUser already
// broadcasts to every one of that user's connections).
const statusEmitters = new Map<
	number,
	{ emit: (s: SubprocessStatusEvent) => void; connections: number }
>()
let healthInterval: ReturnType<typeof setInterval> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
let subprocessTimeoutSecs = 1800
let lastBinaryDir: string | null = null

// Best-effort: if this Node process dies (normal exit, uncaught exception,
// or a caught signal that leads to exit), take the managed koboldcpp
// process group down with it rather than leaving it orphaned. This can't
// catch SIGKILL or a suspend (SIGSTOP) — nothing running in-process can —
// but it covers the common "dev server restarted/crashed" case. 'exit'
// handlers must be synchronous, so this only handles the "we hold a live
// process handle from this session" case with a direct signal — the fuller,
// async-capable cleanup (which also covers an adopted-from-a-previous-
// session process) lives in stop(), which the services registry calls on
// SIGINT/SIGTERM.
process.on("exit", () => {
	if (state.process?.pid) {
		try {
			process.kill(-state.process.pid, "SIGKILL")
		} catch {}
	}
})

// Covers the common graceful-shutdown paths this app's own process actually
// receives — Ctrl+C in a dev terminal, `kill` (no -9), a process manager or
// container runtime stopping the service normally — so a managed koboldcpp
// subprocess doesn't outlive a shutdown that had every opportunity to clean
// up after itself. Still can't do anything about SIGKILL/power loss; that
// residue is what checkForOrphanOnBoot() exists to sweep up on next start.
// Signal handling moved to $lib/server/services: this module used to install
// its own SIGINT/SIGTERM handler that called process.exit(0) when it was done
// stopping. Node runs every listener for a signal, so that exit cut short any
// other cleanup still in flight — the db module's lock release, and now the
// tunnel teardown. The registry waits for all of them, then exits once.
//
// `stop()` is what it calls; nothing else about this module's shutdown changed.

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

/**
 * Shared by doStart() and the boot-time orphan check below: if something is
 * already answering on the configured port, adopt it into our state
 * tracking (own or external) instead of spawning a second instance on top
 * of it; otherwise clean up anything stale left behind by a previous,
 * ungracefully-terminated session. Returns true if an already-running
 * instance was adopted (caller has nothing further to do), false if the
 * port was free (after any stale cleanup) and a fresh spawn is up to the
 * caller.
 */
async function adoptIfAlreadyRunning(
	binaryDir: string,
	binaryPath: string,
	port: number
): Promise<boolean> {
	if (await pingKoboldCPP(`http://localhost:${port}`, 2000)) {
		const ownedPid = await findVerifiedOwnedPid(binaryDir, binaryPath)
		console.log(
			ownedPid
				? `[KoboldCPP] Port ${port} already active — adopting our own process (pid ${ownedPid}) from a previous session`
				: `[KoboldCPP] Port ${port} already active — adopting external instance we didn't start; Stop/Unload won't be available for it`
		)
		state.status = "running"
		state.pid = ownedPid
		state.isExternal = !ownedPid
		state.startedAt = new Date()
		state.lastError = null
		emitStatus()
		startHealthCheck(port)
		pingActivity()
		return true
	}
	// Port is free (or the process behind it is unresponsive) — check for
	// and clean up a stale process left behind by a previous session before
	// anything tries to spawn on top of it.
	await killStaleOrphan(binaryDir, binaryPath)
	return false
}

/**
 * Best-effort adopt-or-clean-up pass, run once at server boot — independent
 * of doStart()'s own copy of this logic, which only ever runs lazily on the
 * first actual generation request. Without this, a process orphaned by an
 * ungraceful shutdown (kill -9, a crash, anything the SIGINT/SIGTERM
 * handlers below can't catch) sits around indefinitely: nothing reaps it
 * until someone happens to trigger a generation, however long that takes.
 * Running the same adopt/clean-up check immediately on boot means a stale
 * orphan gets terminated (or a still-healthy one gets adopted into state
 * tracking, so status UI is accurate right away) without waiting on that.
 */
export async function checkForOrphanOnBoot(): Promise<void> {
	try {
		const settings = await db.query.koboldCppSettings.findFirst()
		if (
			!settings?.koboldCppManagerEnabled ||
			settings?.koboldCppManagedMode !== "managed"
		)
			return
		const {
			koboldCppManagedBinaryDir: binaryDir,
			koboldCppManagedBinaryVariant: binaryVariant
		} = settings
		if (!binaryDir || !binaryVariant) return
		const binaryPath = path.join(binaryDir, binaryVariant)
		const port = settings.koboldCppManagedPort ?? 5001
		await adoptIfAlreadyRunning(binaryDir, binaryPath, port)
	} catch (err) {
		console.error("[KoboldCPP] Boot-time orphan check failed:", err)
	}
}

export function registerEmitter(
	userId: number,
	fn: (s: SubprocessStatusEvent) => void
) {
	const existing = statusEmitters.get(userId)
	if (existing) {
		existing.connections++
		return
	}
	statusEmitters.set(userId, { emit: fn, connections: 1 })
}

export function unregisterEmitter(userId: number) {
	const existing = statusEmitters.get(userId)
	if (!existing) return
	existing.connections--
	if (existing.connections <= 0) statusEmitters.delete(userId)
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
	const payload = snapshot()
	for (const { emit } of statusEmitters.values()) {
		try {
			emit(payload)
		} catch {}
	}
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

async function waitForReady(port: number, proc: ChildProcess): Promise<void> {
	await pollUntilReady(
		async () =>
			(await pingKoboldCPP(`http://localhost:${port}`, 2000))
				? "ready"
				: "not-ready",
		{
			// The bare --nomodel bootstrap has no model to load, so it should
			// come up quickly on any machine — but as long as the process we
			// just spawned hasn't actually exited, keep waiting rather than
			// guessing a fixed timeout for how slow "quickly" can be on a
			// loaded/slow disk system.
			isAlive: () => proc.exitCode === null && !proc.killed,
			hardTimeoutMs: 10 * 60_000,
			label: "KoboldCPP startup",
			onTick: (elapsed) =>
				console.log(
					`[KoboldCPP] still waiting for the subprocess to open its port… (${Math.round(elapsed / 1000)}s)`
				)
		}
	)
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
// e.g. a group session where several characters each trigger their own
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
	let password = settings.koboldCppManagedAdminPassword
	if (!password) {
		// Mirrors koboldCppSetManagedMode's generation — a missing password
		// here (e.g. cleared while already in managed mode) must not silently
		// fall back to a shared, predictable literal on the next spawn.
		password = randomUUID().replace(/-/g, "")
		await db
			.update(schema.koboldCppSettings)
			.set({ koboldCppManagedAdminPassword: password })
			.where(eq(schema.koboldCppSettings.id, 1))
	}
	subprocessTimeoutSecs =
		settings.koboldCppManagedSubprocessTimeoutSecs ?? 1800

	// If KoboldCPP is already reachable (e.g. left over from a previous server
	// session) adopt it rather than spawning a second instance on the same
	// port; otherwise clean up anything stale before spawning on top of it.
	if (await adoptIfAlreadyRunning(binaryDir, binaryPath, port)) {
		return
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
		"--nomodel",
		// Without this, koboldcpp renders /v1/chat/completions through its
		// own generic built-in formatter instead of the loaded model's real
		// chat template — which it already auto-extracts from the GGUF on
		// every model load (handle.get_chat_template(), unconditional, no
		// extra config needed) but silently never uses without this flag.
		// Scoped to the session-completions endpoint only (koboldcpp's own
		// docs: "Other endpoints are unaffected. Tool calls are done
		// without jinja."), so this only matters for connections with "Use
		// Session Mode" on — which is this app's own default. Model-specific
		// template behavior (eg. Gemma 4's <|think|> enable_thinking
		// token) is otherwise completely inert regardless of what this app
		// sends in the request body.
		"--jinja"
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
		await waitForReady(port, proc)
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
