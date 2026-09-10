import os from "os"
import { Server as SocketIOServer } from "socket.io"
import type { Server as HttpServer } from "http"
import { connectSockets } from "$lib/server/sockets/index"
import { authMiddleware } from "$lib/server/sockets/auth"
import {
	isOriginAllowed,
	isWildcardAllowed
} from "$lib/server/sockets/originAllowlist"
import { startPeriodicVectorizationScan } from "$lib/server/embedding/vectorizationQueue"
import { startPeriodicAnnotationScan } from "$lib/server/annotations/queue"

// .env loading lives in $lib/server/config/preloadEnv, which runs before the
// server framework reads its own configuration. It used to be a dotenv.config()
// right here — far too late to matter, since adapter-node snapshots
// ORIGIN/PROTOCOL_HEADER/HOST_HEADER at its own module scope and
// $env/dynamic/public is frozen by then.

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
			"If this instance isn't behind a reverse proxy or otherwise network-isolated, see docs/hosting.md's " +
			'"Running behind a reverse proxy" section, or enable user accounts (Settings > System) to require login.'
	)
}

let attached = false

/**
 * The HTTP server a database-less boot could not attach sockets to.
 *
 * Kept because the recovery path has no other way back to it: the server object
 * is created outside the SvelteKit bundle and reaches app code exactly once, in
 * the root layout's load (see `src/routes/+layout.server.ts`) — and in recovery
 * mode no page renders, so no layout load runs, so nothing hands it over a
 * second time. See `attachSocketServerAfterRecovery` below.
 */
let deferredHttpServer: HttpServer | null = null

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
	const { appReady, getDatabaseState } = await import("$lib/server/startup")
	await appReady

	// A database that would not open leaves every handler below with nothing to
	// query. Attaching them anyway would trade one clear page for a socket that
	// connects and then fails on each message, so the sockets simply never
	// attach — the HTTP side explains the situation (see hooks.server.ts).
	if (!getDatabaseState().ok) {
		// Not a permanent refusal: a recovery can put a working database in
		// place inside this same process, and the handlers have to be able to
		// come up then. Releasing the idempotence latch is what makes that
		// possible — the alternative is a recovered instance that serves pages
		// and answers no socket message until it is restarted.
		attached = false
		deferredHttpServer = httpServer
		console.warn(
			"[db] Socket server not attached: the database could not be opened."
		)
		return
	}
	deferredHttpServer = null

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
	// The origin-allowlist summary that used to print here is now part of the
	// startup banner (config/bootstrapEnv), so it appears once at boot with the
	// rest of the hosting configuration rather than when the first request
	// happens to attach the socket server. warnIfOpenAdminExposure stays here
	// because it needs the database, which is not available that early.
	await warnIfOpenAdminExposure()

	// Periodically (re-)start the vectorization queue if enabled — first
	// tick runs immediately, so this is also the boot-time trigger. Does NOT
	// eagerly load the embedding model itself; the queue only loads it (via
	// loadConfiguredEmbeddingModel(), mode-aware) once it actually finds
	// something to embed. See vectorizationQueue.ts's own doc comment.
	startPeriodicVectorizationScan()

	// The second lane's sweep. Same shape, its own model (none), its own TTL
	// and its own autostart — see `indexing/lane.ts`. The annotation lane is
	// model-free and unconditional, so this is what keeps a lorebook's names
	// indexed on an install that has configured nothing at all.
	startPeriodicAnnotationScan()

	// Fire-and-forget: warms the local-embedding support probe (a cached,
	// one-time dynamic import attempt — see embedding/index.ts) so it's
	// usually already resolved by the time a client's first
	// systemSettings:get request needs the localEmbeddingsSupported flag,
	// instead of that request paying the one-time import cost.
	warmLocalEmbeddingSupportProbe()
}

/**
 * Attach the sockets that a database-less boot skipped.
 *
 * Called by `$lib/server/startup`'s `restartAfterRecovery()`, after the
 * database is open and the startup tasks have run. A no-op on an instance that
 * never deferred, which is every instance that booted normally.
 */
export async function attachSocketServerAfterRecovery(): Promise<void> {
	// The deferred reference first, and `globalThis` as the fallback: in
	// recovery mode `hooks.server.ts` answers before SvelteKit resolves a
	// route, so the root layout load that normally hands the server over may
	// never have run and nothing would have been deferred. Both the dev Vite
	// plugin and the production entry publish it there (see vite.config.ts and
	// scripts/customize-build.js), which is where the layout load gets it from
	// too.
	const httpServer =
		deferredHttpServer ??
		((globalThis as any).__SERENE_PUB_HTTP_SERVER__ as HttpServer | null)
	if (!httpServer) return
	deferredHttpServer = null
	await attachSocketServer(httpServer)
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
