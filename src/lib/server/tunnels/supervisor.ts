import { spawn, type ChildProcess } from "child_process"
import { eq } from "drizzle-orm"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { isAndroidWrapper } from "$lib/server/utils"
import { TunnelProviders, TunnelStatuses } from "$lib/shared/constants/Tunnels"
import {
	decryptToken,
	TUNNEL_CREDENTIAL_KEY_INFO
} from "$lib/server/utils/tokenCrypto"
import { ensureBinary } from "./binaryManager"

/**
 * Cloudflare tunnel supervisor (plan 26 §7, phases B and C).
 *
 * One process, one hostname. This briefly needed two of each — Socket.IO used
 * to run its own listener on `SOCKETS_PORT`, and a quick tunnel fronts exactly
 * one local port, so exposing the app alone produced a page that loaded and
 * then couldn't open a socket. Socket.IO now shares the app's HTTP server, so
 * there is one port to expose and the tunnel is a single hop again.
 *
 * A single module-level state is correct rather than a per-row map: §3's
 * partial unique index already guarantees at most one enabled tunnel per
 * server, and there is exactly one server.
 */

const URL_WAIT_MS = 60_000
/**
 * Backstop cadence for the TTL (26 §4.3). The in-process timer is the primary
 * mechanism; this catches the cases a timer cannot — a clock jump, a timer that
 * never fired, a row expired by something other than this process.
 */
const TTL_SWEEP_MS = 60_000
/** Escalating, then give up — a tunnel that cannot hold is not one to retry forever. */
const RESTART_DELAYS_MS = [1_000, 2_000, 5_000, 15_000, 30_000]

interface SupervisorState {
	tunnelId: number | null
	proc: ChildProcess | null
	hostname: string | null
	/** Fires at expiresAt; cleared on stop. See TTL enforcement below. */
	ttlTimer: ReturnType<typeof setTimeout> | null
	/** Set while stop() is tearing down, so exit handlers don't treat it as a crash. */
	stopping: boolean
	restartAttempt: number
	restartTimer: ReturnType<typeof setTimeout> | null
}

const state: SupervisorState = {
	tunnelId: null,
	proc: null,
	hostname: null,
	ttlTimer: null,
	stopping: false,
	restartAttempt: 0,
	restartTimer: null
}

/**
 * The app server's own port. Mirrors @sveltejs/adapter-node's default, with the
 * Vite dev port as the fallback when not built — a tunnel opened from `npm run
 * dev` should point at the server actually serving pages, not at a closed 3000.
 */
function getAppPort(): string {
	const configured = process.env.PORT?.trim()
	if (configured) return configured
	return process.env.NODE_ENV === "production" ? "3000" : "5173"
}

/**
 * cloudflared announces a quick tunnel by printing its URL inside an ASCII box,
 * on stderr rather than stdout, interleaved with ordinary log lines — so this
 * scans every line of both streams rather than parsing a known position.
 */
export function extractQuickTunnelHostname(line: string): string | null {
	const match = line.match(
		/https:\/\/([a-z0-9][a-z0-9-]*\.trycloudflare\.com)/i
	)
	return match ? match[1].toLowerCase() : null
}

/**
 * A named tunnel has no URL to announce — the hostname is the one the admin
 * configured, and what we are waiting for is proof that the connector actually
 * reached Cloudflare's edge. That proof is a registered connection.
 *
 * Deliberately a *heuristic over log text*, and treated as one: cloudflared's
 * wording is not a stable API, so a miss degrades to the launch timeout (an
 * honest "didn't come up") rather than a wrong answer. Matching two phrasings
 * because both have been in use across versions.
 */
export function indicatesNamedTunnelReady(line: string): boolean {
	return /registered tunnel connection|connection [0-9a-f-]{8,} registered/i.test(
		line
	)
}

/**
 * Fail fast on the one failure an admin will actually hit — a bad or revoked
 * connector token. Without this the launch sits for the full timeout and then
 * reports "didn't report readiness", which tells them nothing about the cause.
 */
export function extractFatalLaunchError(line: string): string | null {
	if (
		/unauthorized|401|invalid tunnel (secret|token)|token is invalid/i.test(
			line
		)
	)
		return "Cloudflare rejected the connector token — check that it is correct and has not been revoked."
	if (/tunnel not found|404/i.test(line))
		return "Cloudflare could not find that tunnel — it may have been deleted."
	return null
}

/**
 * What to run, and how to know it worked. One per provider, so `startProcess`
 * stays a process supervisor rather than a place providers accumulate branches.
 */
interface LaunchPlan {
	args: string[]
	/** Resolved hostname when the line proves the tunnel is up, else null. */
	ready: (line: string) => string | null
	timeoutMessage: string
	/** Applied to every line before it is logged. */
	redact: (line: string) => string
}

function launchPlan(tunnel: SelectTunnel, port: string): LaunchPlan {
	if (tunnel.provider === TunnelProviders.CLOUDFLARE_QUICK) {
		return {
			args: [
				"tunnel",
				"--no-autoupdate",
				"--url",
				`http://127.0.0.1:${port}`
			],
			ready: extractQuickTunnelHostname,
			timeoutMessage: `cloudflared did not report a URL within ${URL_WAIT_MS / 1000}s`,
			redact: (line) => line
		}
	}

	// cloudflare_named. The connector token carries the tunnel identity; which
	// public hostname routes to it, and to which local port, is configured in
	// the Cloudflare dashboard rather than here — that is what a
	// remotely-managed tunnel means. SP's `hostname` column is the admin's
	// record of that decision, used for display and for the allowed-hosts tie-in.
	const token = requireCredential(tunnel)
	const hostname = tunnel.hostname!.trim().toLowerCase()
	return {
		args: ["tunnel", "--no-autoupdate", "run", "--token", token],
		ready: (line) => (indicatesNamedTunnelReady(line) ? hostname : null),
		timeoutMessage: `cloudflared did not register a connection within ${URL_WAIT_MS / 1000}s — check that the tunnel's public hostname points at http://localhost:${port} in the Cloudflare dashboard`,
		// The token appears in argv, so it can surface in a crash dump or an
		// error line that echoes the command. It must never reach the log.
		redact: (line) => line.split(token).join("«token»")
	}
}

function requireCredential(tunnel: SelectTunnel): string {
	if (!tunnel.credential) {
		throw new Error(
			"This tunnel has no connector token saved — add one before starting it."
		)
	}
	try {
		return decryptToken(tunnel.credential, TUNNEL_CREDENTIAL_KEY_INFO)
	} catch {
		// Decrypt fails when the app's crypto secret changed (restored backup,
		// wiped meta.json). Saying so beats "unauthorized" from Cloudflare.
		throw new Error(
			"The saved connector token could not be decrypted — re-enter it."
		)
	}
}

async function writeRow(id: number, patch: Partial<InsertTunnel>) {
	await db.update(schema.tunnels).set(patch).where(eq(schema.tunnels.id, id))
}

function killProc(proc: ChildProcess | null) {
	if (!proc) return
	const pid = proc.pid
	try {
		// Negative PID kills the whole group — cloudflared is spawned detached
		// for exactly this reason.
		if (pid) process.kill(-pid, "SIGTERM")
		else proc.kill("SIGTERM")
	} catch {
		try {
			proc.kill("SIGKILL")
		} catch {}
	}
}

function clearRestartTimer() {
	if (state.restartTimer) {
		clearTimeout(state.restartTimer)
		state.restartTimer = null
	}
}

function clearTtlTimer() {
	if (state.ttlTimer) {
		clearTimeout(state.ttlTimer)
		state.ttlTimer = null
	}
}

function resetState() {
	clearRestartTimer()
	clearTtlTimer()
	state.tunnelId = null
	state.proc = null
	state.hostname = null
	state.stopping = false
	state.restartAttempt = 0
}

/**
 * Spawn cloudflared and resolve once it has announced its hostname.
 *
 * Rejects rather than resolving null on timeout: a tunnel with no hostname is
 * not a degraded tunnel, it is a failed one, and letting start() continue would
 * leave a row claiming `running` against a URL nobody can reach.
 */
function startProcess(
	binaryPath: string,
	plan: LaunchPlan,
	onUnexpectedExit: (reason: string) => void
): Promise<{ proc: ChildProcess; hostname: string }> {
	return new Promise((resolve, reject) => {
		const proc = spawn(binaryPath, plan.args, {
			stdio: ["ignore", "pipe", "pipe"],
			detached: true
		})

		let settled = false

		function fail(err: Error) {
			settled = true
			clearTimeout(timer)
			killProc(proc)
			reject(err)
		}

		const timer = setTimeout(() => {
			if (settled) return
			fail(new Error(plan.timeoutMessage))
		}, URL_WAIT_MS)

		function scan(chunk: Buffer) {
			const text = chunk.toString()
			for (const line of text.split("\n")) {
				if (!line.trim()) continue
				console.log("[tunnel]", plan.redact(line.trimEnd()))
				if (settled) continue
				const fatal = extractFatalLaunchError(line)
				if (fatal) {
					fail(new Error(fatal))
					return
				}
				const host = plan.ready(line)
				if (host) {
					settled = true
					clearTimeout(timer)
					resolve({ proc, hostname: host })
				}
			}
		}

		proc.stdout?.on("data", scan)
		proc.stderr?.on("data", scan)

		proc.on("error", (err) => {
			if (settled) {
				onUnexpectedExit(err.message)
				return
			}
			settled = true
			clearTimeout(timer)
			reject(err)
		})

		proc.on("exit", (code, signal) => {
			const reason = `cloudflared exited${
				code !== null ? ` with code ${code}` : ""
			}${signal ? ` on ${signal}` : ""}`
			if (!settled) {
				settled = true
				clearTimeout(timer)
				reject(new Error(reason))
				return
			}
			onUnexpectedExit(reason)
		})
	})
}

function onUnexpectedExit(reason: string) {
	// A deliberate teardown also fires exit; treating that as a crash would
	// schedule a restart of a tunnel the admin just stopped.
	if (state.stopping || state.tunnelId === null) return

	const id = state.tunnelId
	console.error(`[tunnel] ${reason} — scheduling a restart`)

	state.proc = null
	state.hostname = null

	const delay = RESTART_DELAYS_MS[state.restartAttempt]
	if (delay === undefined) {
		state.tunnelId = null
		state.restartAttempt = 0
		void writeRow(id, {
			enabled: false,
			status: TunnelStatuses.ERROR,
			lastError: `${reason}. Gave up after ${RESTART_DELAYS_MS.length} restart attempts.`,
			stoppedAt: new Date()
		}).catch(() => {})
		return
	}

	state.restartAttempt++
	void writeRow(id, {
		status: TunnelStatuses.STARTING,
		lastError: reason
	}).catch(() => {})

	clearRestartTimer()
	state.restartTimer = setTimeout(() => {
		state.restartTimer = null
		start(id).catch((err) => {
			console.error("[tunnel] restart failed:", err)
		})
	}, delay)
	// Don't hold the event loop open for a restart nobody is waiting on.
	state.restartTimer.unref?.()
}

export function isRunning(): boolean {
	return state.tunnelId !== null && state.proc !== null
}

/**
 * The hostname this instance is currently reachable at through the tunnel, if
 * one is up. Read by the allowed-hosts surface so a live tunnel host is
 * attributed rather than appearing from nowhere.
 */
export function getActiveTunnelHostname(): string | null {
	return state.proc ? state.hostname : null
}

export function getSupervisedTunnelId(): number | null {
	return state.tunnelId
}

/**
 * Bring a configured tunnel up.
 *
 * Callers are expected to have run the socket-layer gates already; the Android
 * check is repeated here because this is also the entry point phase D's
 * auto-start will use, and that path must not be a way around it.
 */
export async function start(tunnelId: number): Promise<SelectTunnel> {
	if (isAndroidWrapper()) {
		throw new Error("Tunnels are not available in the Android app")
	}
	// Enforced here as well as in the socket handler. The handler's version has
	// the friendlier message and is what an admin normally sees; this one is
	// what makes the state unreachable, because auto-start never goes through a
	// handler.
	if (!(await accountsEnabled())) {
		throw new Error(
			"User accounts must be enabled before a tunnel can be started."
		)
	}

	const tunnel = await db.query.tunnels.findFirst({
		where: eq(schema.tunnels.id, tunnelId)
	})
	if (!tunnel) throw new Error("No tunnel is configured.")
	if (
		tunnel.provider !== TunnelProviders.CLOUDFLARE_QUICK &&
		tunnel.provider !== TunnelProviders.CLOUDFLARE_NAMED
	) {
		// tailscale_funnel and custom are deferred (26 §7). `custom` in
		// particular is a different shape — SP manages no process for it.
		throw new Error(
			`${TunnelProviders.getLabel(tunnel.provider)} is not implemented yet.`
		)
	}

	if (state.tunnelId !== null && state.tunnelId !== tunnelId) {
		throw new Error("Another tunnel is already running.")
	}

	clearRestartTimer()
	state.tunnelId = tunnelId
	state.stopping = false
	await writeRow(tunnelId, {
		status: TunnelStatuses.STARTING,
		lastError: null
	})

	try {
		// Built before the binary is fetched: a missing token or hostname is
		// the admin's mistake and should be reported immediately, not after a
		// download.
		const plan = launchPlan(tunnel, getAppPort())
		const binaryPath = await ensureBinary()
		const { proc, hostname } = await startProcess(
			binaryPath,
			plan,
			onUnexpectedExit
		)
		state.proc = proc
		state.hostname = hostname
		state.restartAttempt = 0

		// Recomputed on every off -> on transition, never inherited (26 §4):
		// a run that reused a stale deadline would either die seconds later or
		// never expire, depending on which way the clock fell.
		const expiresAt = tunnel.ttlSeconds
			? new Date(Date.now() + tunnel.ttlSeconds * 1000)
			: null

		const [row] = await db
			.update(schema.tunnels)
			.set({
				enabled: true,
				status: TunnelStatuses.RUNNING,
				hostname,
				lastError: null,
				startedAt: new Date(),
				expiresAt,
				stoppedAt: null
			})
			.where(eq(schema.tunnels.id, tunnelId))
			.returning()
		armTtlTimer(tunnelId, expiresAt)
		console.log(`[tunnel] running at https://${hostname}`)
		return row
	} catch (err: any) {
		// Torn down before the row is marked, so a failed start never leaves a
		// live cloudflared behind an `error` row.
		state.stopping = true
		killProc(state.proc)
		resetState()
		const [row] = await db
			.update(schema.tunnels)
			.set({
				enabled: false,
				status: TunnelStatuses.ERROR,
				lastError: err?.message ?? String(err),
				stoppedAt: new Date()
			})
			.where(eq(schema.tunnels.id, tunnelId))
			.returning()
		void row
		throw err
	}
}

/**
 * Take the tunnel down. Safe to call when nothing is running — the socket
 * handler's `disable` is deliberately ungated, so this is reachable in states
 * where there is no process to kill, and must not throw for that.
 */
export async function stop(tunnelId?: number): Promise<void> {
	const id = tunnelId ?? state.tunnelId
	state.stopping = true
	clearRestartTimer()
	killProc(state.proc)
	resetState()
	if (id !== null && id !== undefined) {
		await writeRow(id, {
			enabled: false,
			status: TunnelStatuses.STOPPED,
			expiresAt: null,
			stoppedAt: new Date()
		})
	}
}

/**
 * TTL enforcement, layer 1 of 3 (26 §4): the in-process timer.
 *
 * Layers 2 and 3 — boot reconciliation and the periodic sweep — exist because
 * this one cannot be trusted alone. A timer does not survive a restart, and it
 * does not fire correctly across a suspend or a clock jump. A deadline nobody
 * actively checks is not a TTL.
 */
function armTtlTimer(tunnelId: number, expiresAt: Date | null) {
	clearTtlTimer()
	if (!expiresAt) return
	const ms = expiresAt.getTime() - Date.now()
	if (ms <= 0) {
		void expire(tunnelId)
		return
	}
	state.ttlTimer = setTimeout(() => {
		state.ttlTimer = null
		void expire(tunnelId)
	}, ms)
	// A tunnel expiring is not a reason to hold the event loop open.
	state.ttlTimer.unref?.()
}

async function expire(tunnelId: number) {
	console.log("[tunnel] TTL reached — stopping")
	await stop(tunnelId).catch((err) =>
		console.error("[tunnel] failed to stop at TTL:", err)
	)
}

/**
 * TTL enforcement, layer 3: a cheap periodic backstop.
 *
 * Reads the row rather than trusting in-memory state, so it also catches a row
 * this process never armed a timer for.
 */
let sweepTimer: ReturnType<typeof setInterval> | null = null

export async function sweepExpiredTunnels(now = new Date()): Promise<void> {
	const rows = await db.query.tunnels.findMany()
	for (const row of rows) {
		if (!row.enabled || !row.expiresAt) continue
		if (row.expiresAt.getTime() > now.getTime()) continue
		console.log(`[tunnel] sweep found tunnel ${row.id} past its deadline`)
		await stop(row.id).catch((err) =>
			console.error("[tunnel] sweep failed to stop:", err)
		)
	}
}

export function startTtlSweep() {
	if (sweepTimer) return
	sweepTimer = setInterval(() => {
		void sweepExpiredTunnels().catch(() => {})
	}, TTL_SWEEP_MS)
	sweepTimer.unref?.()
}

export function stopTtlSweep() {
	if (!sweepTimer) return
	clearInterval(sweepTimer)
	sweepTimer = null
}

/**
 * Accounts must be on for a tunnel to be live (26 §5), checked here and not
 * only in the socket handler.
 *
 * The socket layer has its own check with a friendlier message, and that is
 * the one an admin normally sees. This one is the enforcement: auto-start does
 * not go through a socket handler at all, so a gate that lived only there would
 * be bypassed by exactly the path with no human watching.
 */
async function accountsEnabled(): Promise<boolean> {
	const settings = await db.query.systemSettings.findFirst({
		columns: { isAccountsEnabled: true }
	})
	return settings?.isAccountsEnabled ?? false
}

/**
 * Boot reconciliation and auto-start (26 §4), in that order.
 *
 * The order is the whole point. Reconciling first means a row that expired
 * while the process was down is stopped before anything considers restarting
 * it; doing it the other way round silently resurrects an expired tunnel, which
 * is the exact bug the TTL exists to prevent.
 */
export async function reconcileOnBoot(): Promise<void> {
	const now = new Date()

	// 1. Anything already past its deadline goes down, whatever else is true.
	await sweepExpiredTunnels(now)

	// 2. Then, and only then, auto-start.
	if (isAndroidWrapper()) return
	const rows = await db.query.tunnels.findMany()
	for (const row of rows) {
		if (!row.autoStart) continue

		// A row still marked enabled here was left that way by an ungraceful
		// shutdown — the process is gone regardless, so this is a fresh start
		// rather than an adoption.
		if (!(await accountsEnabled())) {
			await writeRow(row.id, {
				enabled: false,
				status: TunnelStatuses.STOPPED,
				lastError:
					"Auto-start skipped: user accounts are disabled on this instance."
			}).catch(() => {})
			console.warn(
				"[tunnel] auto-start skipped — user accounts are disabled"
			)
			continue
		}

		try {
			await start(row.id)
		} catch (err) {
			// Never fatal: an instance that cannot restore its tunnel must
			// still serve sessions locally. start() has already written the
			// error to the row, so it is visible on next login.
			console.warn("[tunnel] auto-start failed:", err)
		}
	}

	startTtlSweep()
}

// Best-effort teardown, mirroring subprocessManager.ts. 'exit' handlers must be
// synchronous, so this signals the process groups directly and leaves the DB
// row alone; a row left claiming `running` after a hard kill is what phase D's
// boot reconciliation is for.
process.on("exit", () => {
	const pid = state.proc?.pid
	if (!pid) return
	try {
		process.kill(-pid, "SIGKILL")
	} catch {}
})
