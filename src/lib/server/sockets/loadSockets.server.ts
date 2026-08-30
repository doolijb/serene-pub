import dotenv from "dotenv"
import os from "os"
import { Server as SocketIOServer } from "socket.io"
import type { Server as HttpServer } from "http"
import { connectSockets } from "$lib/server/sockets/index"
import { authMiddleware } from "$lib/server/sockets/auth"
import {
	describeOriginAllowlistConfig,
	isOriginAllowed,
	isWildcardAllowed
} from "$lib/server/sockets/originAllowlist"
import { startPeriodicVectorizationScan } from "$lib/server/embedding/vectorizationQueue"

dotenv.config()

/**
 * Round-12 audit fix (MEDIUM): the compose files' own comment already
 * documents the tradeoff of ALLOWED_ORIGINS=* (the Docker Compose
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
	if (!isWildcardAllowed()) return

	const { db } = await import("$lib/server/db")
	const systemSettings = await db.query.systemSettings.findFirst({
		columns: { isAccountsEnabled: true }
	})
	if (systemSettings?.isAccountsEnabled) return

	console.warn(
		"WARNING: user accounts are disabled and ALLOWED_ORIGINS=* is set — " +
			"every connection that can reach this port is auto-attached as an unauthenticated admin. " +
			"If this instance isn't behind a reverse proxy or otherwise network-isolated, see HOSTING.md's " +
			'"Running behind a reverse proxy" section, or enable user accounts (Settings > System) to require login.'
	)
}

let attached = false

/**
 * Attach Socket.IO to the HTTP server that already serves the app.
 *
 * There is no second listener, no second port, and no socket-specific host or
 * protocol configuration — `HOST`/`PORT` bind the one server, and a socket
 * handshake is same-origin with the page that opened it. Everything a separate
 * listener used to need (`SOCKETS_PORT`, `SOCKETS_HTTP_MODE`,
 * `SOCKETS_HTTPS_HOSTS`, `PUBLIC_SOCKETS_ENDPOINT`, and the
 * `/api/sockets-endpoint` discovery round-trip) existed only to tell a browser
 * where the *other* server was. Same-origin answers that question by
 * construction.
 *
 * Called once, by the dev Vite plugin and by the production entry — both of
 * which own a real `http.Server`. Idempotent, because both paths can plausibly
 * fire during an HMR reload.
 */
export async function attachSocketServer(httpServer: HttpServer) {
	if (attached) return
	attached = true

	// Handlers query the database the moment a client connects, so startup has
	// to be finished before any of them are registered — this is the explicit
	// form of what importing `db` used to do implicitly.
	const { appReady } = await import("$lib/server/startup")
	await appReady

	const io = new SocketIOServer(httpServer, {
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
		// ALLOWED_ORIGINS to be configured at all.
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

	// `io` is a real Socket.IO `Server` now. It used to be `Server | Socket` —
	// sveltekit-io's setup() returned the same union on client and server — so
	// this was guarded with `"use" in io` and a `.to` shim for the branch that
	// could never actually happen here. Both are gone with the union.
	io.use(authMiddleware as any)

	connectSockets(io as any)
	if (process.env.NODE_ENV !== "production") {
		console.log("Socket server attached to the app server")
	}
	// Always printed (including production) — this is exactly the
	// information an admin needs to confirm their deployment's actual
	// exposure without reading docs, not just a dev convenience.
	console.log(describeOriginAllowlistConfig())
	await warnIfOpenAdminExposure()

	// Periodically (re-)start the vectorization queue if enabled — first
	// tick runs immediately, so this is also the boot-time trigger. Does NOT
	// eagerly load the embedding model itself; the queue only loads it (via
	// loadConfiguredEmbeddingModel(), mode-aware) once it actually finds
	// something to embed. See vectorizationQueue.ts's own doc comment.
	startPeriodicVectorizationScan()

	// Fire-and-forget: warms the local-embedding support probe (a cached,
	// one-time dynamic import attempt — see embedding/index.ts) so it's
	// usually already resolved by the time a client's first
	// systemSettings:get request needs the localEmbeddingsSupported flag,
	// instead of that request paying the one-time import cost.
	warmLocalEmbeddingSupportProbe()
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
