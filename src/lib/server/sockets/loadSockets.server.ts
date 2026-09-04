import { Server as SocketIOServer } from "socket.io"
import type { Server as HttpServer } from "http"
import { connectSockets } from "$lib/server/sockets/index"
import { authMiddleware } from "$lib/server/sockets/auth"
import { isOriginAllowed } from "$lib/server/sockets/originAllowlist"

// .env loading moved to $lib/server/config/preloadEnv, which runs before the
// server framework reads its own configuration. It used to be a dotenv.config()
// right here — but this module is only reached from a route load, so .env was
// not read until the first page render, long after adapter-node had already
// snapshotted ORIGIN/PROTOCOL_HEADER/HOST_HEADER and after $env/dynamic/public
// was frozen.

// warnIfOpenAdminExposure() lived here: it warned when ALLOWED_ORIGINS=* was
// combined with the accounts-disabled default, because the wildcard switched
// off BOTH the origin check and the local-network requirement for no-Origin
// clients, leaving a tokenless admin session reachable by anything that could
// route to this port. It is gone because its condition became unreachable, not
// because the concern stopped mattering: there is no longer any variable that
// can switch either check off. A cross-origin page must now match the request's
// own Host (a different site differs by hostname) or the declared PUBLIC_URL,
// and a no-Origin client must resolve to a local-network address
// unconditionally.
//
// Do not resurrect it keyed on something else, such as accounts-disabled plus
// HOST=0.0.0.0. That is the default configuration of a normal LAN install, so
// the warning would fire for nearly every user and be trained away. The
// original was gated on an explicitly-set variable precisely because that is an
// operator *declaration*, whereas network topology is not. The residual case it
// does not cover — someone deliberately port-forwarding an accounts-disabled
// instance and browsing to it directly, where Origin equals Host by
// construction — was never what this warned about, and is covered by the
// accounts-mode note in docs/hosting.md's security section.

let attached = false

/**
 * Attach Socket.IO to the HTTP server that already serves the app.
 *
 * There is no second listener, no second port, and no socket-specific host or
 * protocol configuration — `HOST`/`PORT` bind the one server, and a socket
 * handshake is same-origin with the page that opened it. Everything a separate
 * listener used to need (`SOCKETS_PORT`, `SOCKETS_HTTP_MODE`,
 * `SOCKETS_ENDPOINT`, and the `/api/sockets-endpoint` discovery round-trip)
 * existed only to tell a browser where the *other* server was. Same-origin
 * answers that question by construction.
 *
 * Called from the root layout's server load (see src/routes/+layout.server.ts
 * for why there and not from hooks.server.ts), which owns nothing itself — the
 * `http.Server` is published on `globalThis` by whichever thing created it:
 * the Vite plugin in dev, the generated `build/index.js` wrapper in production.
 * Idempotent, because that load runs on every page render.
 *
 * Deliberately does NOT wait on any explicit startup/readiness signal: this
 * module statically imports `connectSockets`, whose handler modules statically
 * import `$lib/server/db`, and that module has top-level `await`s (migrations
 * and seed sync). ESM therefore finishes database startup before this
 * function's body can run at all. That is the same guarantee the old
 * `/api/sockets-endpoint` route relied on.
 */
export async function attachSocketServer(httpServer: HttpServer) {
	if (attached) return
	attached = true

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
		// works for localhost/LAN IPs/custom domains with no configuration
		// at all — which is now the only way it works, there being no
		// variable to widen or disable it.
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
	// rest of the hosting configuration rather than when the first page render
	// happens to attach the socket server.

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
