/**
 * The control routes — `/api/launcher/*` (CONTRACT §C3).
 *
 * Two routes the launcher uses to watch and stop this server:
 * `GET /api/launcher/health` and `POST /api/launcher/shutdown`. Answered at
 * the very top of `handle()` in `hooks.server.ts`, before `appReady`, so they
 * work during a long migration and in the database-recovery state.
 *
 * Every request must pass every check in `isControlRequestAllowed`, or it gets
 * a bare 404 — never 401/403, so nothing about the routes is advertised to a
 * caller who could not use them. The Host check is not redundant with the
 * loopback check: a cloudflared tunnel connects from 127.0.0.1
 * (`tunnels/supervisor.ts`) and forwards the public Host, so loopback alone
 * would admit the internet.
 *
 * Statically imported by hooks, so this module imports nothing that opens a
 * database; startup and the services registry are reached dynamically.
 */
import crypto from "node:crypto"
import type { RequestEvent } from "@sveltejs/kit"
import { getDirectPeerAddress } from "$lib/server/sockets/originAllowlist"
import { processIdentity } from "./runtimeFile"
import { noteStartupRequested, stopAfterStartup } from "./stop"

export const CONTROL_ROUTE_PREFIX = "/api/launcher"

export type ControlRoute = "health" | "shutdown"

/** Whether a path belongs to the control routes at all (any method). */
export function isControlPath(pathname: string): boolean {
	return (
		pathname === CONTROL_ROUTE_PREFIX ||
		pathname.startsWith(CONTROL_ROUTE_PREFIX + "/")
	)
}

/** Exact method + path; anything else is no route. */
export function controlRouteFor(
	method: string,
	pathname: string
): ControlRoute | null {
	if (method === "GET" && pathname === `${CONTROL_ROUTE_PREFIX}/health`)
		return "health"
	if (method === "POST" && pathname === `${CONTROL_ROUTE_PREFIX}/shutdown`)
		return "shutdown"
	return null
}

/** 127.0.0.0/8, ::1, or the IPv4-mapped form of 127.0.0.0/8. */
export function isLoopbackPeer(address: string | null): boolean {
	if (!address) return false
	const a = address.trim().toLowerCase()
	if (a === "::1") return true
	const v4 = a.startsWith("::ffff:") ? a.slice("::ffff:".length) : a
	return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(v4)
}

const CONTROL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"])

/** The hostname of a Host header, port stripped; null when malformed. */
export function hostHeaderHostname(host: string | null): string | null {
	if (!host) return null
	const h = host.trim().toLowerCase()
	if (h.startsWith("[")) {
		const end = h.indexOf("]")
		if (end === -1) return null
		const rest = h.slice(end + 1)
		if (rest && !/^:\d+$/.test(rest)) return null
		return h.slice(0, end + 1)
	}
	const parts = h.split(":")
	if (parts.length > 2) return null
	if (parts.length === 2 && !/^\d+$/.test(parts[1])) return null
	return parts[0]
}

/** Any of these means a proxy or tunnel handled the request (§C3 rule 3). */
export const PROXY_HEADERS = [
	"forwarded",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-proto",
	"x-real-ip",
	"cf-connecting-ip",
	"cf-ray",
	"cdn-loop",
	"via"
] as const

/** Constant-time compare of a presented bearer token against this process's. */
export function tokenMatches(
	authorization: string | null,
	expected: string
): boolean {
	if (!authorization || !expected) return false
	const match = /^Bearer ([^\s]+)$/.exec(authorization.trim())
	if (!match) return false
	const presented = Buffer.from(match[1], "utf8")
	const wanted = Buffer.from(expected, "utf8")
	// timingSafeEqual needs equal lengths; comparing against itself keeps the
	// time spent independent of where a wrong token differs.
	if (presented.length !== wanted.length) {
		crypto.timingSafeEqual(wanted, wanted)
		return false
	}
	return crypto.timingSafeEqual(presented, wanted)
}

export interface ControlRequest {
	method: string
	pathname: string
	/** The raw TCP peer — never a forwarded-for claim. */
	peer: string | null
	headers: Headers
}

/** Every §C3 check, as one pure predicate. */
export function isControlRequestAllowed(
	req: ControlRequest,
	expectedToken: string
): ControlRoute | null {
	const route = controlRouteFor(req.method, req.pathname)
	if (!route) return null
	if (!isLoopbackPeer(req.peer)) return null
	const host = hostHeaderHostname(req.headers.get("host"))
	if (!host || !CONTROL_HOSTS.has(host)) return null
	if (PROXY_HEADERS.some((h) => req.headers.has(h))) return null
	if (req.headers.has("origin")) return null
	if (!tokenMatches(req.headers.get("authorization"), expectedToken))
		return null
	return route
}

export type HealthState = "starting" | "ready" | "recovery" | "failed"

export interface HealthBody {
	version: string
	ready: boolean
	state: HealthState
	pid: number
	startedAt: string
	/**
	 * The startup tasks whose failure made this instance `failed`, by name
	 * (`startup/index.ts`); empty otherwise.
	 */
	failedTasks: string[]
	/**
	 * Browser tabs and windows connected to this server right now (Socket.IO
	 * sockets), or null before the socket server is attached. The launcher
	 * opens no client while one is connected.
	 */
	clients: number | null
}

type StartupModule = {
	appReady: Promise<void>
	getDatabaseState: () => { ok: boolean }
	getStartupFailures: () => readonly string[]
}

/** How each `appReady` promise ended, learned without awaiting it. */
const outcomes = new WeakMap<Promise<void>, "ok" | "failed">()
const watched = new WeakSet<Promise<void>>()

function watch(p: Promise<void>): void {
	if (watched.has(p)) return
	watched.add(p)
	p.then(
		() => outcomes.set(p, "ok"),
		() => outcomes.set(p, "failed")
	)
}

/**
 * `recovery` when the database would not open; `failed` when startup threw (a
 * `critical` task) or a `failsHealth` task failed — the app may still serve,
 * but it is not an instance an update may be committed on; `ready` once
 * startup finished clean; else `starting`, including while the startup module
 * itself is still loading.
 */
export function healthStateOf(startup: StartupModule | null): HealthState {
	if (!startup) return "starting"
	watch(startup.appReady)
	const outcome = outcomes.get(startup.appReady)
	if (outcome === undefined) return "starting"
	if (outcome === "failed") return "failed"
	if (!startup.getDatabaseState().ok) return "recovery"
	return startup.getStartupFailures().length ? "failed" : "ready"
}

/**
 * Sockets connected to the one Socket.IO server, read from the state
 * `sockets/loadSockets.server.ts` keeps on `globalThis` — never by importing
 * that module, which this one must not (it is statically imported by hooks).
 */
function connectedClients(): number | null {
	const io = (
		globalThis as {
			__SERENE_PUB_SOCKET_STATE__?: {
				io?: { of(nsp: string): { sockets: { size: number } } } | null
			}
		}
	).__SERENE_PUB_SOCKET_STATE__?.io
	return io ? io.of("/").sockets.size : null
}

export interface ControlDeps {
	token: string
	version: string
	pid: number
	startedAt: string
	/** The startup module, or null while it is still loading. Never awaits it. */
	startup: () => StartupModule | null
	/** Called once the shutdown reply is on its way. */
	shutdown: () => void
	/** Connected clients, or null when the socket server is not attached. */
	clients: () => number | null
}

let startupModule: StartupModule | null = null
let startupLoading: Promise<unknown> | null = null

/**
 * Begin loading startup (which begins the boot) and return it if it is here.
 * A launcher-spawned server has no browser request to start it otherwise.
 */
function kickStartup(): StartupModule | null {
	if (!startupLoading) {
		noteStartupRequested()
		startupLoading = import("$lib/server/startup")
			.then((m) => {
				startupModule = m
				watch(m.appReady)
			})
			.catch((err) => {
				console.error("[launcher] Startup could not be loaded:", err)
			})
	}
	return startupModule
}

function defaultDeps(version: string): ControlDeps {
	const identity = processIdentity()
	return {
		token: identity.token,
		version,
		pid: process.pid,
		startedAt: identity.startedAt,
		startup: kickStartup,
		clients: connectedClients,
		shutdown: () => {
			// After the 202 has had a moment to leave: the reply is tiny, and
			// the teardown that follows takes far longer than its flush.
			setTimeout(() => {
				void stopAfterStartup({ reason: "launcher", exitCode: 0 })
			}, 100)
		}
	}
}

function notFound(): Response {
	return new Response(null, {
		status: 404,
		headers: { "Cache-Control": "no-store" }
	})
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json",
			"Cache-Control": "no-store"
		}
	})
}

/**
 * Answer one request under `/api/launcher`. The caller adds the normal
 * security headers. `deps` is a test seam.
 */
export function handleControlRequest(
	event: Pick<RequestEvent, "request" | "url" | "platform">,
	version: string,
	deps: ControlDeps = defaultDeps(version)
): Response {
	const route = isControlRequestAllowed(
		{
			method: event.request.method,
			pathname: event.url.pathname,
			peer: getDirectPeerAddress(event),
			headers: event.request.headers
		},
		deps.token
	)
	if (!route) return notFound()

	if (route === "health") {
		const startup = deps.startup()
		const state = healthStateOf(startup)
		const body: HealthBody = {
			version: deps.version,
			ready: state === "ready",
			state,
			pid: deps.pid,
			startedAt: deps.startedAt,
			failedTasks:
				state === "failed" && startup
					? [...startup.getStartupFailures()]
					: [],
			clients: deps.clients()
		}
		return json(200, body)
	}

	console.log("[launcher] Shutdown requested by the launcher.")
	deps.shutdown()
	return json(202, { ok: true })
}
