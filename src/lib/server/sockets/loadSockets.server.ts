import * as skio from "sveltekit-io"
import { connectSockets } from "$lib/server/sockets/index"
import { authMiddleware } from "$lib/server/sockets/auth"
import { isOriginAllowed } from "$lib/server/sockets/originAllowlist"
import {
	getSocketsHttpMode,
	getSocketsPort
} from "$lib/server/net/publicUrl"

// .env loading moved to $lib/server/config/preloadEnv, which runs before the
// server framework reads its own configuration. It used to be a dotenv.config()
// right here — but this module is imported only by /api/sockets-endpoint, so
// .env was not read until the first request to that route, long after
// adapter-node had already snapshotted ORIGIN/PROTOCOL_HEADER/HOST_HEADER and
// after $env/dynamic/public was frozen.

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
			"If this instance isn't behind a reverse proxy or otherwise network-isolated, see docs/hosting.md's " +
			'"Running behind a reverse proxy" section, or enable user accounts (Settings > System) to require login.'
	)
}

// Moved to $lib/server/net/publicUrl, which resolves the socket endpoint as
// one case of the deployment's public URL rather than as its own parallel
// scheme. Re-exported here so existing importers keep working.
export {
	getPublicSocketsEndpoint,
	getSocketsHttpMode,
	getSocketsPort
} from "$lib/server/net/publicUrl"

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
	// The origin-allowlist summary that used to print here is now part of the
	// startup banner (config/bootstrapEnv), so it appears once at boot with the
	// rest of the hosting configuration rather than on the first request to
	// /api/sockets-endpoint. warnIfOpenAdminExposure stays here because it
	// needs the database, which is not available that early.
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

