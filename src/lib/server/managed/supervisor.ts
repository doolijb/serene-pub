/**
 * The process supervisor behind every service run by Serene Pub (KoboldCPP
 * today, audio.cpp next).
 *
 * `createSupervisor(spec)` returns one service's whole lifecycle: spawn,
 * reap a process of ours left over from a previous session, health check,
 * idle auto-stop, Stop, and the status events the admin UI renders. A service
 * supplies only what differs (which binary, which arguments, which port, how
 * to ping it); the rest is here once.
 *
 * ## Two rules every part of this file serves
 *
 * 1. **State lives on `globalThis`, per service id.** Vite's SSR HMR
 *    re-evaluates this module (and the service module that calls
 *    `createSupervisor`) whenever anything they import changes. Module-scope
 *    state would then split in two: the OLD evaluation keeps the child-process
 *    handle, its `exit` handlers, its health-check interval and the emitters
 *    that reach the browser, while the NEW evaluation — the one every fresh
 *    request, preflight and socket handler now calls — starts from
 *    `status: "stopped"` with no handle at all. The live process becomes
 *    invisible to the code asking about it: the status card shows _Stopped_ or
 *    a _Starting_ that never resolves, the next generation takes the
 *    process as a stranger (resetting `startedAt`), and the old evaluation's
 *    health check keeps firing against a suspended-flag the new one does not share,
 *    free to declare a crash mid-load. Seen live on 2026-09-18: uptime 4m59s
 *    on a process 8 minutes old. One shared bag means every evaluation reads
 *    and writes the same process, timers and emitters. Production evaluates
 *    once and never notices.
 * 2. **A service is a process tree, and it never outlives us.** Children are
 *    spawned `detached: true` (their own session leader), so Stop and the exit
 *    hook can take the whole tree down (`processTree.ts`; `taskkill /T` on
 *    Windows) and leave no helper process behind (a PyInstaller bootstrap
 *    forks the real worker, for one). A watchdog sidecar (`watchdog.ts`) does
 *    the same when this process dies in a way no hook sees.
 * 3. **Nothing is adopted** (owner ruling, 2026-11-10). A process answering on
 *    the port that we did not start is a stranger: the start fails and says
 *    so. Our own orphan — the pid file names it and it still runs our binary —
 *    is killed and replaced. Someone running their own KoboldCPP points a
 *    plain API connection at it; the managed card is only ever ours.
 *
 * Signal handling (SIGINT/SIGTERM) lives in `$lib/server/services`, never
 * here: a module-owned handler that calls `process.exit(0)` when done
 * stopping cuts short any other cleanup in flight (Node runs every listener
 * for a signal). The registry calls `stop()` and exits once.
 */
import { spawn, type ChildProcess } from "child_process"
import * as fs from "fs"
import * as fsPromises from "fs/promises"
import * as path from "path"
import { createUserEmitters, type UserEmitterSlot } from "./emitters"
import { isPidAlive, killTree, killTreeSync, pidRunsBinary } from "./processTree"
import { spawnWatchdog } from "./watchdog"
import { pollUntilReady } from "../koboldcpp/pollUntilReady"

export type SupervisorStatus =
	| "stopped"
	| "starting"
	| "running"
	| "crashed"
	| "stopping"

export interface SupervisorStatusEvent {
	status: SupervisorStatus
	pid: number | null
	startedAt: string | null
	lastError: string | null
	restartCount: number
}

export interface SupervisorSpec {
	/** Service id, e.g. "koboldcpp", "audiocpp". Keys the shared state. */
	id: string
	/** Log prefix and human name, e.g. "KoboldCPP". */
	label: string
	/**
	 * Absolute path of the executable, or null when none is configured. The
	 * pid file and the watchdog script live in this path's directory;
	 * `pidRunsBinary` matches on its basename.
	 */
	binaryPath(): Promise<string | null>
	/** Arguments for a fresh spawn. Called after `prepare()`. */
	args(): Promise<string[]>
	/** Working directory for the child. Omitted: inherit ours. */
	cwd?(): Promise<string>
	/** Port the service listens on (loopback). */
	port(): Promise<number>
	/**
	 * Is the service answering at `baseUrl`? `timeoutMs` is the longest the
	 * caller will wait (the supervisor picks 2000 for readiness and port
	 * probes, 5000 for the health check) — a ping must honour it. (Brief
	 * said `signal`; services like KoboldCPP already take a timeout.)
	 */
	ping(baseUrl: string, timeoutMs: number): Promise<boolean>
	/** Called with the child's pid right after it spawns. */
	onSpawn?(pid: number): void
	/** Called when the child exits (any reason, including our own Stop). */
	onExit?(code: number | null, signal: NodeJS.Signals | null): void
	/**
	 * Idle auto-stop window in ms; null/undefined keeps the current one
	 * (default 30 min), 0 or less disables it. Read on every start.
	 */
	idleTimeoutMs?(): Promise<number | null>
	/** Pid file name, written beside the binary. */
	pidFileName: string

	// ---- additions beyond the original brief (all optional) ----

	/**
	 * Shared-state key on `globalThis`. Default
	 * `__SERENE_PUB_SUPERVISOR_<ID>__`. KoboldCPP keeps its historic
	 * `__SERENE_PUB_KCPP_SUBPROCESS__` so a live dev process stays tracked
	 * across the HMR that shipped the extraction.
	 */
	globalKey?: string
	/**
	 * Is the service allowed to run at all? Returns a refusal message (the
	 * start fails as `crashed` with it as `lastError`) or null to go ahead.
	 * Called first on `start()` and on the boot sweep (which then does
	 * nothing). May throw for real errors.
	 */
	gate?(): Promise<string | null>
	/**
	 * Last-moment work before the spawn, once the binary is known to
	 * exist (e.g. create a missing admin password). Throwing ends the start.
	 */
	prepare?(): Promise<void>
	/**
	 * Called wherever the process the service held is gone or about to be
	 * replaced (crash, exit, failed start, Stop, fresh spawn) — drop anything
	 * that lived in that process, such as which model it had loaded.
	 */
	onProcessGone?(): void
	/** Extra environment for the child, merged over ours. */
	env?(): Promise<Record<string, string>>
	/** Grace between SIGTERM and SIGKILL in `stop()`. Default 10_000. */
	stopGraceMs?: number
}

export interface Supervisor {
	start(): Promise<void>
	stop(): Promise<void>
	/** `stop()` then `start()`. (Added.) */
	restart(): Promise<void>
	getStatus(): SupervisorStatusEvent
	isRunning(): boolean
	/** Restart the idle auto-stop countdown. Call on every use. */
	pingActivity(): void
	/** Change the idle window in seconds (<= 0 disables). (Added.) */
	setIdleTimeoutSecs(secs: number): void
	suspendHealthCheck(): void
	resumeHealthCheck(): void
	registerEmitter(userId: number, fn: (s: SupervisorStatusEvent) => void): void
	unregisterEmitter(userId: number): void
	/**
	 * Kill a process of ours left over from a previous session (the pid file
	 * names it and it still runs our binary). For server boot; never throws,
	 * never spawns, never adopts.
	 */
	checkForOrphanOnBoot(): Promise<void>
}

interface SupervisorState {
	process: ChildProcess | null
	status: SupervisorStatus
	pid: number | null
	startedAt: Date | null
	lastError: string | null
	restartCount: number
}

/** The shared bag. Field names are the historic KoboldCPP ones (HMR compat). */
interface ManagerState {
	state: SupervisorState
	// Map<userId, {emit, connections}> — see emitters.ts for the rationale.
	statusEmitters: Map<number, UserEmitterSlot<SupervisorStatusEvent>>
	healthInterval: ReturnType<typeof setInterval> | null
	idleTimer: ReturnType<typeof setTimeout> | null
	subprocessTimeoutSecs: number
	lastBinaryDir: string | null
	healthCheckFailures: number
	// A count, not a flag: concurrent preflights each suspend around their own
	// model load, and the first to finish must not resume it under the others.
	healthCheckSuspends: number
	startingPromise: Promise<void> | null
	/**
	 * A person pressed Stop. Set by `stop()`, cleared when the next start
	 * begins. While it is set, the process ending is the stop's doing: an
	 * in-flight start that sees its child die ends as `stopped` with no
	 * error, rather than reporting the kill it asked for as a crash.
	 * Optional because a bag made by an older evaluation (dev HMR) lacks it.
	 */
	stopRequested?: boolean
}

// Consecutive health-check failures before declaring a crash. Loading a real
// model can leave a service unresponsive for well over 30s on a large file /
// slow disk — long enough to miss a single ping while genuinely healthy.
// Requiring a few consecutive failures (~90s) avoids acting on one slow tick
// and orphaning a process that's still fine. Callers that know a load is in
// flight should also bracket it with suspendHealthCheck()/resumeHealthCheck().
const HEALTH_CHECK_FAILURE_THRESHOLD = 3

// ETXTBSY is "the file is still open for writing": a binary exec'ed the moment
// its download finished. The download waits for its file to close, so this is
// a backstop for whatever else holds the file a moment longer (a virus
// scanner, a slow filesystem) — a few short tries, never a long wait.
const SPAWN_TEXT_BUSY_RETRIES = 3
const SPAWN_RETRY_DELAY_MS = 250

const exitHookGlobal = globalThis as unknown as {
	__SERENE_PUB_SUPERVISOR_EXIT_HOOKS__?: Set<string>
}

export function createSupervisor(spec: SupervisorSpec): Supervisor {
	const { label } = spec
	const globalKey =
		spec.globalKey ??
		`__SERENE_PUB_SUPERVISOR_${spec.id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}__`
	const globalScope = globalThis as unknown as Record<
		string,
		ManagerState | undefined
	>

	const shared: ManagerState = (globalScope[globalKey] ??= {
		state: {
			process: null,
			status: "stopped",
			pid: null,
			startedAt: null,
			lastError: null,
			restartCount: 0
		},
		statusEmitters: new Map(),
		healthInterval: null,
		idleTimer: null,
		subprocessTimeoutSecs: 1800,
		lastBinaryDir: null,
		healthCheckFailures: 0,
		healthCheckSuspends: 0,
		startingPromise: null,
		stopRequested: false
	})

	const state = shared.state
	const emitters = createUserEmitters<SupervisorStatusEvent>(
		shared.statusEmitters
	)
	const stopGraceMs = spec.stopGraceMs ?? 10_000

	// Best-effort: if this Node process dies (normal exit, uncaught exception,
	// or a caught signal that leads to exit), take the service's process group
	// down with it rather than leaving it orphaned. This can't catch SIGKILL or
	// a suspend (SIGSTOP) — nothing running in-process can — but it covers the
	// common "dev server restarted/crashed" case. 'exit' handlers must be
	// synchronous, so this only handles the "we hold a live process handle from
	// this session" case with a direct signal — the fuller, async-capable
	// cleanup lives in stop(). Registered once per service id for the life of the Node
	// process (the flag is on globalThis, so HMR re-evaluation does not stack
	// handlers); it reads the shared bag, so it always sees the live handle.
	const hooks = (exitHookGlobal.__SERENE_PUB_SUPERVISOR_EXIT_HOOKS__ ??=
		new Set())
	if (!hooks.has(globalKey)) {
		hooks.add(globalKey)
		process.on("exit", () => {
			if (state.process?.pid) killTreeSync(state.process.pid)
		})
	}

	function gone() {
		spec.onProcessGone?.()
	}

	function pidFilePath(binaryDir: string): string {
		return path.join(binaryDir, spec.pidFileName)
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

	/**
	 * If a previous run of this app left the service's process behind (the
	 * watchdog missed it, or a crash took both down out of order) and it is
	 * still alive, it holds the port a fresh spawn needs. The pid file names
	 * it; `pidRunsBinary` confirms the pid was not recycled (fails closed, so a
	 * stranger on a recycled pid is never killed on a guess). Kill the tree and
	 * wait for it to go.
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
		if (!recordedPid || !isPidAlive(recordedPid)) {
			await clearPidFile(binaryDir)
			return
		}
		// The pid we hold is never an orphan, whatever the file says.
		if (recordedPid === state.pid || recordedPid === state.process?.pid) return
		if (!(await pidRunsBinary(recordedPid, binaryPath))) return

		console.warn(
			`[${label}] Found our own process (pid ${recordedPid}) left over from a previous session — terminating it.`
		)
		await killTree(recordedPid, "SIGTERM")
		const deadline = Date.now() + 5000
		while (Date.now() < deadline && isPidAlive(recordedPid)) {
			await new Promise((r) => setTimeout(r, 250))
		}
		if (isPidAlive(recordedPid)) {
			await killTree(recordedPid, "SIGKILL")
			const hardDeadline = Date.now() + 3000
			while (Date.now() < hardDeadline && isPidAlive(recordedPid)) {
				await new Promise((r) => setTimeout(r, 250))
			}
		}
		await clearPidFile(binaryDir)
	}

	function snapshot(): SupervisorStatusEvent {
		return {
			status: state.status,
			pid: state.pid,
			startedAt: state.startedAt?.toISOString() ?? null,
			lastError: state.lastError,
			restartCount: state.restartCount
		}
	}

	function emitStatus() {
		emitters.emit(snapshot())
	}

	function clearIdleTimer() {
		if (shared.idleTimer) {
			clearTimeout(shared.idleTimer)
			shared.idleTimer = null
		}
	}

	function pingActivity() {
		clearIdleTimer()
		if (state.status !== "running" || shared.subprocessTimeoutSecs <= 0)
			return
		shared.idleTimer = setTimeout(() => {
			console.log(`[${label}] Subprocess idle timeout reached, shutting down…`)
			stop().catch((err) =>
				console.error(`[${label}] Auto-stop failed:`, err)
			)
		}, shared.subprocessTimeoutSecs * 1000)
	}

	function baseUrl(port: number) {
		return `http://localhost:${port}`
	}

	function startHealthCheck(port: number) {
		stopHealthCheck()
		shared.healthInterval = setInterval(async () => {
			if (state.status !== "running" || shared.healthCheckSuspends > 0)
				return
			const ok = await spec.ping(baseUrl(port), 5000)
			if (ok) {
				shared.healthCheckFailures = 0
				return
			}
			shared.healthCheckFailures++
			if (
				shared.healthCheckFailures >= HEALTH_CHECK_FAILURE_THRESHOLD &&
				state.status === "running"
			) {
				clearIdleTimer()
				state.status = "crashed"
				state.lastError = "Health check failed — process may have crashed"
				state.process = null
				state.pid = null
				gone()
				emitStatus()
			}
		}, 30_000)
	}

	function stopHealthCheck() {
		shared.healthCheckFailures = 0
		if (shared.healthInterval) {
			clearInterval(shared.healthInterval)
			shared.healthInterval = null
		}
	}

	// Early-exit failures happen before a real process ever spawns, so there's
	// nothing for the normal proc.on("error"/"exit") handlers to report.
	// Without this, callers that only console.error() a rejected start() (the
	// manual "start" button, and the auto-start after a binary download) leave
	// the client with no feedback at all — the UI keeps showing "stopped" while
	// the real reason only ever reaches the server log.
	function failStart(message: string): never {
		state.status = "crashed"
		state.lastError = message
		state.process = null
		state.pid = null
		gone()
		emitStatus()
		throw new Error(message)
	}

	async function waitForReady(
		port: number,
		isAlive: () => boolean
	): Promise<void> {
		await pollUntilReady(
			async () =>
				(await spec.ping(baseUrl(port), 2000)) ? "ready" : "not-ready",
			{
				// A bare bootstrap should come up quickly on any machine — but as
				// long as the process we just spawned hasn't actually exited (or
				// failed to spawn at all — see doStart's spawnError), keep waiting
				// rather than guessing a fixed timeout for how slow "quickly" can
				// be on a loaded/slow disk system.
				isAlive,
				hardTimeoutMs: 10 * 60_000,
				label: `${label} startup`,
				onTick: (elapsed) =>
					console.log(
						`[${label}] still waiting for the subprocess to open its port… (${Math.round(elapsed / 1000)}s)`
					)
			}
		)
	}

	/**
	 * What a start says when something else already holds the port. Nothing
	 * is adopted: the managed card only ever shows a process we started.
	 */
	function portInUseMessage(port: number): string {
		return `Port ${port} is already in use by a program Serene Pub didn't start. Stop it, or change the port in ${label}'s settings.`
	}

	/**
	 * Run once at server boot, independent of doStart()'s own sweep, which
	 * only runs lazily on the first request. Without this, a process orphaned
	 * by an ungraceful shutdown the watchdog also missed sits on the port and
	 * the graphics memory until someone happens to trigger a start.
	 */
	async function checkForOrphanOnBoot(): Promise<void> {
		try {
			// The startup module re-runs on every dev re-evaluation; the pid
			// file then names the process this bag is supervising, or the one a
			// start in flight is about to write — not an orphan.
			if (state.process || shared.startingPromise) return
			if (await spec.gate?.()) return
			const binaryPath = await spec.binaryPath()
			if (!binaryPath) return
			if (state.process || shared.startingPromise) return
			await killStaleOrphan(path.dirname(binaryPath), binaryPath)
		} catch (err) {
			console.error(`[${label}] Boot-time orphan sweep failed:`, err)
		}
	}

	// Guards the whole body of start() against concurrent invocation — e.g. a
	// group session where several characters each trigger their own preflight()
	// at nearly the same moment right as the process is discovered dead.
	// Without this, two calls can both slip past the state checks (there are
	// several `await`s — a DB query, a port ping, a binary-existence check —
	// before state.status ever flips to "starting") and both proceed to spawn,
	// leaving two processes racing for the same port. Concurrent callers now
	// await the same in-flight attempt instead.
	async function start(): Promise<void> {
		if (shared.startingPromise) return shared.startingPromise
		shared.startingPromise = doStart()
		try {
			await shared.startingPromise
		} finally {
			shared.startingPromise = null
		}
	}

	async function doStart(): Promise<void> {
		// A new attempt: any earlier Stop has been honoured. Cleared here, on the
		// synchronous entry, so a Stop pressed during the awaits below is seen.
		shared.stopRequested = false
		if (state.status === "starting") {
			// start() has already handed any in-flight attempt to its caller, so a
			// "starting" that reaches here is in flight only if it holds a
			// process. Without one it is a leftover from an attempt that died
			// between setting it and spawning — returning on it made every later
			// start() a silent no-op, and preflight then "started" a process that
			// did not exist. Respawn instead.
			if (state.process) return
			state.status = "stopped"
		}
		if (state.status === "running") {
			// "Running" always holds the live handle of a process we spawned (a
			// real crash reaches its own proc.on("exit"), or the health check).
			// A "running" without one is a bag an older evaluation left behind:
			// nothing to trust, so start over.
			if (state.process) return
			stopHealthCheck()
			clearIdleTimer()
			state.status = "stopped"
			state.pid = null
		}

		const refusal = await spec.gate?.()
		if (refusal) {
			// Nothing was tried, so nothing crashed (lane V finding V-2,
			// 2026-10-29): the service stays "stopped" and the reason rides on
			// `lastError` so the card can say it.
			state.status = "stopped"
			state.lastError = refusal
			state.process = null
			state.pid = null
			emitStatus()
			throw new Error(refusal)
		}

		const binaryPath = await spec.binaryPath()
		if (!binaryPath) failStart("Binary not configured")

		const binaryDir = path.dirname(binaryPath)
		shared.lastBinaryDir = binaryDir

		try {
			await fsPromises.access(binaryPath, fs.constants.F_OK)
		} catch {
			failStart(`Binary not found at ${binaryPath}`)
		}

		if (process.platform !== "win32") {
			await fsPromises.chmod(binaryPath, 0o755)
		}

		await spec.prepare?.()
		const port = await spec.port()
		const idleMs = await spec.idleTimeoutMs?.()
		if (idleMs != null) shared.subprocessTimeoutSecs = idleMs / 1000

		// Our own leftover from a previous session goes first; whatever still
		// answers on the port after that is a stranger, and the start fails in
		// words rather than adopting it.
		await killStaleOrphan(binaryDir, binaryPath)
		if (await spec.ping(baseUrl(port), 2000)) {
			failStart(portInUseMessage(port))
		}

		// Stopped during the awaits above (settings, binary check, port
		// probe): stop() found nothing to kill and settled "stopped" — spawning
		// now would start the process it was asked to stop.
		if (shared.stopRequested) throw new Error(`${label} start was cancelled`)

		state.status = "starting"
		state.lastError = null
		// A fresh process holds nothing until something says otherwise.
		gone()
		emitStatus()

		const args = await spec.args()
		const cwd = await spec.cwd?.()
		const extraEnv = await spec.env?.()

		// Node THROWS most spawn failures synchronously; only EACCES, EAGAIN,
		// EMFILE, ENFILE and ENOENT arrive as the child's async "error" event
		// instead. Uncaught, a throw here (ETXTBSY, seen live 2026-10-05) left
		// the status at "starting" with no process and no lastError — for good,
		// see the stale-"starting" check above. Every way out of this loop is a
		// child, failStart(), or a Stop pressed during a retry.
		let spawned: ChildProcess | null = null
		for (let retry = 0; spawned === null; retry++) {
			try {
				// detached: true makes the service the leader of its own process
				// group (setsid), so we can reliably kill it AND any children it
				// spawns (a PyInstaller bootstrap process forks a real worker)
				// with a single group-kill via a negative PID, instead of leaving
				// pieces behind.
				spawned = spawn(binaryPath, args, {
					stdio: ["ignore", "pipe", "pipe"],
					detached: true,
					...(cwd ? { cwd } : {}),
					...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {})
				})
			} catch (err: any) {
				if (err?.code !== "ETXTBSY" || retry >= SPAWN_TEXT_BUSY_RETRIES) {
					failStart(err?.message || String(err))
				}
				console.warn(
					`[${label}] spawn ETXTBSY — the binary is still open for writing; retrying in ${SPAWN_RETRY_DELAY_MS}ms (${retry + 1}/${SPAWN_TEXT_BUSY_RETRIES})`
				)
				await new Promise((r) => setTimeout(r, SPAWN_RETRY_DELAY_MS))
				// Stopped while waiting: stop() has already settled the status.
				if (state.status !== "starting") {
					throw new Error(`${label} start was cancelled`)
				}
			}
		}
		const proc = spawned

		state.process = proc
		state.pid = proc.pid ?? null
		state.startedAt = new Date()
		state.restartCount++
		if (proc.pid) spec.onSpawn?.(proc.pid)

		// Set by the async "error" event, which is how Node reports the spawn
		// failures it doesn't throw (ENOENT, EACCES, …). Such a child never gets
		// an exitCode, so without this the wait below took it for alive for its
		// whole ten-minute timeout.
		let spawnError = null as Error | null

		proc.stdout?.on("data", (chunk: Buffer) => {
			console.log(`[${label}]`, chunk.toString().trimEnd())
		})
		proc.stderr?.on("data", (chunk: Buffer) => {
			console.error(`[${label} stderr]`, chunk.toString().trimEnd())
		})

		proc.on("error", (err) => {
			spawnError = err
			clearIdleTimer()
			// A late error from a child a Stop already took down is not news.
			if (shared.stopRequested) {
				state.status = "stopped"
				state.lastError = null
			} else {
				state.status = "crashed"
				state.lastError = err.message
			}
			state.process = null
			state.pid = null
			gone()
			stopHealthCheck()
			clearPidFile(binaryDir).catch(() => {})
			emitStatus()
		})

		proc.on("exit", (code, signal) => {
			clearIdleTimer()
			stopHealthCheck()
			// `stopRequested`, not only "stopping": stop()'s force-kill timeout
			// settles "stopped" before the child's exit lands, and that exit
			// read as a crash — a Stop that "failed" with an exit-code error.
			if (state.status !== "stopping" && !shared.stopRequested) {
				state.status = "crashed"
				state.lastError = `Exited — code ${code ?? "?"} signal ${signal ?? "none"}`
			} else {
				state.status = "stopped"
				state.lastError = null
			}
			state.process = null
			state.pid = null
			gone()
			spec.onExit?.(code, signal)
			clearPidFile(binaryDir).catch(() => {})
			emitStatus()
		})

		// After the listeners, not before: this await is a window in which the
		// child's "error"/"exit" could otherwise fire with nobody listening.
		if (proc.pid) {
			await writePidFile(binaryDir, proc.pid)
			// The guarantee layer: ends the child when this process dies in a
			// way no hook here sees (kill -9, OOM, a hard crash).
			const watchdog = await spawnWatchdog(binaryDir, proc.pid, label)
			if (watchdog.pid)
				console.log(
					`[${label}] watchdog pid ${watchdog.pid} guards pid ${proc.pid}`
				)
		}

		try {
			await waitForReady(
				port,
				() => spawnError === null && proc.exitCode === null && !proc.killed
			)
		} catch (err: any) {
			// Process may still be starting — kill the whole tree and propagate
			if (proc.pid) await killTree(proc.pid, "SIGKILL")
			else proc.kill("SIGKILL")
			state.process = null
			state.pid = null
			gone()
			// Stopped mid-start: the wait failed BECAUSE stop() killed the child.
			// That is the outcome somebody asked for, so it ends as "stopped"
			// with no lastError — stop() itself settles and emits the status;
			// this only must not overwrite it with a crash. The caller still
			// hears that its start did not produce a process.
			if (shared.stopRequested) {
				throw new Error(`${label} start was cancelled`)
			}
			// The child's own error says why ("spawn … EACCES"); the wait's only
			// says that it stopped.
			const failure = spawnError ?? err
			state.status = "crashed"
			state.lastError = failure.message
			await clearPidFile(binaryDir)
			emitStatus()
			throw failure
		}

		// Ready just as a Stop landed: stop() owns the status from here.
		if (shared.stopRequested) throw new Error(`${label} start was cancelled`)

		state.status = "running"
		emitStatus()
		startHealthCheck(port)
		pingActivity()
	}

	async function stop(): Promise<void> {
		clearIdleTimer()
		// Before any await: an in-flight start reads it to tell this stop's kill
		// from a crash.
		shared.stopRequested = true

		// Nothing we're tracking as running at all — plain no-op.
		if (!state.process && state.status !== "running") {
			state.status = "stopped"
			state.lastError = null
			state.pid = null
			gone()
			emitStatus()
			return
		}

		state.status = "stopping"
		emitStatus()
		stopHealthCheck()

		if (state.process) {
			// "Running" always holds the live handle of a process we spawned.
			const proc = state.process
			const pid = proc.pid
			state.process = null

			await new Promise<void>((resolve) => {
				const forceKill = setTimeout(() => {
					if (pid) void killTree(pid, "SIGKILL")
					else proc.kill("SIGKILL")
					resolve()
				}, stopGraceMs)

				proc.once("exit", () => {
					clearTimeout(forceKill)
					resolve()
				})

				if (pid) void killTree(pid, "SIGTERM")
				else proc.kill("SIGTERM")
			})
		}

		state.status = "stopped"
		state.lastError = null
		state.pid = null
		gone()
		emitStatus()

		if (shared.lastBinaryDir) await clearPidFile(shared.lastBinaryDir)
	}

	return {
		start,
		stop,
		async restart() {
			await stop()
			await start()
		},
		getStatus: snapshot,
		isRunning: () => state.status === "running",
		pingActivity,
		setIdleTimeoutSecs(secs: number) {
			shared.subprocessTimeoutSecs = secs
			if (state.status === "running") pingActivity()
		},
		// `?? 0`: a bag made by an older evaluation (dev HMR) has no counter yet.
		suspendHealthCheck() {
			shared.healthCheckSuspends = (shared.healthCheckSuspends ?? 0) + 1
		},
		resumeHealthCheck() {
			shared.healthCheckSuspends = Math.max(
				0,
				(shared.healthCheckSuspends ?? 0) - 1
			)
			if (shared.healthCheckSuspends === 0) shared.healthCheckFailures = 0
		},
		registerEmitter: emitters.register,
		unregisterEmitter: emitters.unregister,
		checkForOrphanOnBoot
	}
}
