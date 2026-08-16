import dotenv from "dotenv"
import os from "os"
import * as skio from "sveltekit-io"
import { connectSockets } from "$lib/server/sockets/index"
import { authMiddleware } from "$lib/server/sockets/auth"
import {
	getHttpsHosts,
	isOriginAllowed
} from "$lib/server/sockets/originAllowlist"

dotenv.config()

/**
 * Round-12 audit fix (MEDIUM): the compose files' own comment already
 * documents the tradeoff of SOCKETS_ALLOWED_ORIGINS=* (the Docker Compose
 * default), but there was no *runtime* signal of it — only something an
 * admin has to go read. Disabled-accounts mode (the default) auto-attaches
 * every connection to the first admin with no token at all (see auth.ts);
 * combined with the wildcard origin, a self-hoster running this with no
 * reverse proxy in front exposes that unauthenticated admin session to
 * whatever can route to this port. Purely informational — logs a warning,
 * doesn't change behavior; the compose defaults are a deliberate,
 * already-documented choice, not something to override here. Called once
 * at startup (see loadSocketsServer below); factored out as its own
 * function so it's testable without spinning up a real server.
 */
export async function warnIfOpenAdminExposure() {
	const { isWildcardAllowed } = await import(
		"$lib/server/sockets/originAllowlist"
	)
	if (!isWildcardAllowed()) return

	const { db } = await import("$lib/server/db")
	const systemSettings = await db.query.systemSettings.findFirst({
		columns: { isAccountsEnabled: true }
	})
	if (systemSettings?.isAccountsEnabled) return

	console.warn(
		"WARNING: user accounts are disabled and SOCKETS_ALLOWED_ORIGINS=* is set — " +
			"every connection that can reach this port is auto-attached as an unauthenticated admin. " +
			"If this instance isn't behind a reverse proxy or otherwise network-isolated, see HOSTING.md's " +
			'"Running behind a reverse proxy" section, or enable user accounts (Settings > System) to require login.'
	)
}

export function getSocketsHttpMode() {
	const SOCKETS_HTTP_MODE = process.env.SOCKETS_HTTP_MODE
	if (!SOCKETS_HTTP_MODE) return "http"
	const normalized = SOCKETS_HTTP_MODE.trim().toLowerCase()
	if (normalized === "https" || normalized === "http") return normalized
	return "http"
}

export function getSocketsPort() {
	return process.env.SOCKETS_PORT || "3001"
}

export function getPublicSocketsEndpoint(url?: URL) {
	const configured = process.env.PUBLIC_SOCKETS_ENDPOINT?.trim()
	if (configured) return configured

	const hostname = url?.hostname || "localhost"

	// SOCKETS_HTTP_MODE is an explicit admin override — read the raw env var
	// here rather than getSocketsHttpMode() (used for the server's own bind
	// protocol), since that helper always defaults to "http" and would make
	// the auto-detect fallback below dead code, always winning via `||`.
	const explicitMode = process.env.SOCKETS_HTTP_MODE?.trim().toLowerCase()
	const explicitProtocol =
		explicitMode === "http" || explicitMode === "https"
			? explicitMode
			: null

	// Deliberately NOT falling back to `url.protocol` here. Under
	// @sveltejs/adapter-node, `event.url` is built from the adapter's own
	// get_origin(), which — absent an explicit PROTOCOL_HEADER env var that a
	// real reverse proxy is actually setting — hardcodes the protocol to
	// "https" for every request, including plain-http direct/curl requests
	// with zero proxy involved (adapter-node assumes TLS termination happens
	// upstream by default). Trusting it here made this endpoint report
	// "https://...:3001" for genuinely plain-http traffic on unproxied,
	// direct installs — the common case for this app. The only sources of
	// truth for https should be the explicit opt-ins below.
	const protocol = getHttpsHosts().includes(hostname.toLowerCase())
		? "https"
		: (explicitProtocol ?? "http")

	return `${protocol}://${hostname}:${getSocketsPort()}`
}

export async function loadSocketsServer() {
	// Mirrors @sveltejs/adapter-node's own HOST env var (default 0.0.0.0) so a
	// single HOST=127.0.0.1 locks down both the main app server and this socket
	// server together — previously this was hardcoded to 0.0.0.0 with no way to
	// restrict it at all, even for deployments (like the Android wrapper) that
	// only ever need loopback access.
	const bindHost = process.env.HOST || "0.0.0.0"
	const host = `${getSocketsHttpMode()}://${bindHost}:${getSocketsPort()}`

	const io = await skio.setup(host, {
		// Governs the polling transport's CORS headers (Socket.IO tries polling
		// before upgrading to WebSocket by default, so this has to actually
		// work, not just be a formality — WS enforcement itself happens
		// separately in authMiddleware, since browsers don't apply CORS/ACAO
		// restrictions to WS the way they do XHR/polling).
		//
		// Passed as a function rather than a static object — the `cors` package
		// (used internally by engine.io) treats a function as a per-request
		// options delegate `(req, callback)`, which is the only way to get at
		// the request's own Host header here. That's needed for the same
		// zero-config default as isOriginAllowed()'s requestHost param: a
		// same-site tab's Origin hostname equals whatever hostname it used to
		// reach this server, so comparing against the request's own Host header
		// works for localhost/LAN IPs/custom domains without requiring
		// SOCKETS_HTTPS_HOSTS/SOCKETS_ALLOWED_ORIGINS to be configured at all.
		cors: (
			req: any,
			callback: (err: Error | null, options?: any) => void
		) => {
			const origin = req.headers?.origin
			const requestHost = req.headers?.host
			callback(null, {
				origin: isOriginAllowed(origin, requestHost),
				credentials: false
			})
		},
		maxHttpBufferSize: 1e8
	})

	// Add authentication middleware
	if ("use" in io && typeof io.use === "function") {
		io.use(authMiddleware as any)
	}

	if (typeof (io as any).to !== "function") {
		;(io as any).to = () => ({ emit: () => {} })
	}

	connectSockets(io as any)
	if (process.env.NODE_ENV !== "production") {
		console.log("Socket server ready at", host)
	}
	// Always printed (including production) — this is exactly the
	// information an admin needs to confirm their deployment's actual
	// exposure without reading docs, not just a dev convenience.
	const { describeOriginAllowlistConfig } = await import(
		"$lib/server/sockets/originAllowlist"
	)
	console.log(describeOriginAllowlistConfig())
	await warnIfOpenAdminExposure()

	// Periodically (re-)start the vectorization queue if enabled — first
	// tick runs immediately, so this is also the boot-time trigger. Does NOT
	// eagerly load the embedding model itself; the queue only loads it (via
	// loadConfiguredEmbeddingModel(), mode-aware) once it actually finds
	// something to embed. See vectorizationQueue.ts's own doc comment.
	const { startPeriodicVectorizationScan } = await import(
		"$lib/server/embedding/vectorizationQueue"
	)
	startPeriodicVectorizationScan()

	// Fire-and-forget: warms the local-embedding support probe (a cached,
	// one-time dynamic import attempt — see embedding/index.ts) so it's
	// usually already resolved by the time a client's first
	// systemSettings:get request needs the localEmbeddingsSupported flag,
	// instead of that request paying the one-time import cost.
	warmLocalEmbeddingSupportProbe()

	// Sweep for a KoboldCPP managed subprocess orphaned by a previous,
	// ungraceful shutdown (kill -9, a crash) rather than waiting for the
	// next generation attempt to discover and clean it up.
	const { checkForOrphanOnBoot } = await import(
		"$lib/server/koboldcpp/subprocessManager"
	)
	checkForOrphanOnBoot()
}

async function warmLocalEmbeddingSupportProbe() {
	try {
		const { isLocalEmbeddingSupported } = await import(
			"$lib/server/embedding/index"
		)
		await isLocalEmbeddingSupported()
	} catch (err) {
		// The probe itself caches a "not supported" result on a caught
		// import failure — this catch is only for something going wrong
		// around that (e.g. the dynamic import of the module itself), not
		// a case that needs surfacing anywhere.
		console.error("[embedding] Local-embedding support probe failed:", err)
	}
}

