/**
 * The single answer to "what is this server's public address, and is this
 * request HTTPS?"
 *
 * Before this module those two questions had four independent implementations
 * — the socket endpoint's protocol guess, the cookie Secure flag, SvelteKit's
 * own event.url, and the HSTS header — each reading different environment
 * variables and disagreeing in different deployments. `PUBLIC_URL` replaced
 * the pile of fragments (SOCKETS_HTTPS_HOSTS + SOCKETS_HTTP_MODE + HOST_HEADER
 * + PROTOCOL_HEADER + PUBLIC_SOCKETS_ENDPOINT) an admin previously had to
 * assemble by hand; the SOCKETS_-prefixed ones are retired outright now, so
 * `PUBLIC_URL` and `TRUSTED_PROXIES` are the whole surface.
 *
 * The key design property: the configured URL is parsed ONCE but applied
 * PER REQUEST, keyed on hostname. That is what lets a single variable serve a
 * tunnel and direct localhost access simultaneously — the thing the old
 * PUBLIC_SOCKETS_ENDPOINT (a global override) structurally could not do.
 *
 * The socket-endpoint half of that history is now moot: Socket.IO shares the
 * app's own HTTP server, so the real-time endpoint IS this origin and there is
 * nothing separate to advertise. What remains here is the public origin and
 * the HTTPS question, which the cookie Secure flag, HSTS and CSRF still need.
 */
import {
	getDirectPeerAddress,
	isTrustedProxyAddress
} from "$lib/server/sockets/originAllowlist"

/**
 * Minimal shape of what these functions need from a SvelteKit RequestEvent, so
 * tests can construct one without a full framework event.
 *
 * `request` and `url` are optional and every access below is guarded. A real
 * RequestEvent always has both, but these functions sit on the login and
 * cookie paths, where throwing on an unexpected shape turns a missing header
 * into a 500 — the previous inline implementations used optional chaining for
 * exactly this reason, and dropping it silently broke callers that pass a
 * partial event.
 */
export interface PublicUrlRequestLike {
	request?: Request
	url?: URL
	platform?: unknown
}

/** Parsed PUBLIC_URL, cached against the exact raw string it came from rather
 * than in a bare `let` — the startup bootstrap and the test suite both mutate
 * process.env, and a cache that ignores that silently serves a stale answer. */
let configuredCache: { raw: string; url: URL | null } | null = null

let hasWarnedAboutPublicUrl = false

/**
 * The admin's declared public base URL, or null if none is usable.
 *
 * `ORIGIN` is accepted as the last fallback because it already *means* exactly
 * this — it is adapter-node's canonical public origin for CSRF — so every
 * install that already set it gets the improved behavior without touching
 * their configuration.
 */
export function getConfiguredPublicUrl(): URL | null {
	const raw = (
		process.env.PUBLIC_URL ||
		process.env.SERENE_PUB_PUBLIC_URL ||
		process.env.ORIGIN ||
		""
	).trim()

	if (configuredCache?.raw === raw) return configuredCache.url

	let parsed: URL | null = null
	if (raw) {
		try {
			const candidate = new URL(raw)
			if (
				candidate.protocol === "http:" ||
				candidate.protocol === "https:"
			) {
				// Keep scheme/host/port; a path is meaningless for an origin
				// and silently ignoring it beats half-honoring it.
				parsed = candidate
			}
		} catch {
			parsed = null
		}
		if (!parsed && !hasWarnedAboutPublicUrl) {
			hasWarnedAboutPublicUrl = true
			console.warn(
				`[Config] PUBLIC_URL="${raw}" is not a usable absolute URL and ` +
					"was ignored. It must be a full origin including the scheme, " +
					'e.g. "https://serene.example.com" — not a base path like ' +
					'"/serene" and not a bare hostname.'
			)
		}
	}

	configuredCache = { raw, url: parsed }
	return parsed
}

/** The header naming the client-facing host, honoring a custom HOST_HEADER. */
function forwardedHostHeaderName(): string {
	return process.env.HOST_HEADER?.trim().toLowerCase() || "x-forwarded-host"
}

/** The header naming the client-facing protocol, honoring PROTOCOL_HEADER. */
function forwardedProtoHeaderName(): string {
	return (
		process.env.PROTOCOL_HEADER?.trim().toLowerCase() || "x-forwarded-proto"
	)
}

/** First entry of a possibly-comma-joined forwarded header — the value the
 * ORIGINAL client saw, which for host/proto is the one that matters (unlike
 * an address chain, where the leftmost entry is the spoofable one). */
function firstForwardedValue(
	event: PublicUrlRequestLike,
	headerName: string
): string | null {
	const raw = event.request?.headers?.get(headerName)
	if (!raw) return null
	const first = raw.split(",")[0]?.trim()
	return first || null
}

function hostnameOf(hostValue: string): string {
	let h = hostValue.trim().toLowerCase()
	if (h.startsWith("[")) {
		const close = h.indexOf("]")
		return close === -1 ? h : h.slice(0, close + 1)
	}
	const colon = h.indexOf(":")
	return colon === -1 ? h : h.slice(0, colon)
}

/**
 * The hostname the *client* used, as opposed to whatever this process is bound
 * to. A forwarded host is honored only from a trusted proxy.
 *
 * Resolved here in app code rather than relying on adapter-node's HOST_HEADER
 * so it works identically under Docker and bare `node build/index.js`, where
 * .env values may never reach the adapter at all. When HOST_HEADER *is* set,
 * the adapter has already folded it into event.url and the two paths converge.
 */
export function resolveRequestPublicHost(event: PublicUrlRequestLike): string {
	const peer = getDirectPeerAddress(event)
	if (peer === null || isTrustedProxyAddress(peer)) {
		const forwarded = firstForwardedValue(event, forwardedHostHeaderName())
		if (forwarded) return hostnameOf(forwarded)
	}
	const host = event.request?.headers?.get("host")
	if (host) return hostnameOf(host)
	return (event.url?.hostname ?? "localhost").toLowerCase()
}

export type PublicOriginSource = "public-url" | "detected"

/**
 * The origin a browser on the other end of this request actually sees.
 *
 * `PUBLIC_URL` applies only when the request arrived on ITS hostname. A
 * request to http://localhost:3000 while PUBLIC_URL names a tunnel domain is
 * genuinely not that public URL, and treating it as one is precisely the bug
 * that made the old global override unusable on any install reachable both
 * ways.
 */
export function resolveRequestPublicOrigin(event: PublicUrlRequestLike): {
	origin: string
	source: PublicOriginSource
} {
	const host = resolveRequestPublicHost(event)
	const configured = getConfiguredPublicUrl()
	if (configured && configured.hostname.toLowerCase() === host) {
		return { origin: configured.origin, source: "public-url" }
	}
	const scheme = isRequestHttps(event) ? "https" : "http"
	const hostWithPort =
		event.request?.headers?.get("host") || event.url?.host || host
	return { origin: `${scheme}://${hostWithPort}`, source: "detected" }
}

/**
 * Whether this request reached the client over HTTPS.
 *
 * DELIBERATELY never consults `event.url.protocol`. Measured, not assumed: in
 * a production adapter-node build that property reports "https:" even for a
 * request that arrived over plain HTTP on localhost — SvelteKit derives the
 * URL from ORIGIN/PROTOCOL_HEADER rather than from the socket, and with
 * neither configured it does not reflect reality. Two separate fixes in this
 * codebase were previously written against it and were silent no-ops for
 * exactly that reason, and the HSTS header was being advertised over plain
 * HTTP on every desktop and Docker install because of it. HTTPS must announce
 * itself; the default is off.
 */
export function isRequestHttps(event: PublicUrlRequestLike): boolean {
	const configured = getConfiguredPublicUrl()
	if (configured) {
		const host = resolveRequestPublicHost(event)
		if (configured.hostname.toLowerCase() === host) {
			return configured.protocol === "https:"
		}
	}

	// "This deployment terminates TLS itself" — no proxy header will ever
	// arrive in that setup, so it has to be declared.
	if (process.env.SERENE_PUB_SECURE_COOKIES === "true") return true

	// A forwarded protocol, believed only from a proxy we trust. `peer === null`
	// means we could not read the socket at all (non-node adapter, dev server),
	// where refusing would break every proxied dev setup for no security gain —
	// there is no attacker model in which an unreadable peer is more dangerous
	// than an unreadable one that we also ignore.
	const peer = getDirectPeerAddress(event)
	if (peer === null || isTrustedProxyAddress(peer)) {
		const proto = firstForwardedValue(event, forwardedProtoHeaderName())
		if (proto?.toLowerCase() === "https") return true
	}

	return false
}

// getSocketsHttpMode(), getSocketsPort() and getPublicSocketsEndpoint() lived
// here until Socket.IO started sharing the app's HTTP server. All three existed
// to answer "where is the OTHER server?" — the bind protocol of a second
// listener, its port, and the URL to hand a browser so it could find it. With
// one listener the browser opens its socket against the page's own origin with
// no URL at all, so the questions are gone rather than answered differently.
//
// SOCKETS_HTTP_MODE and SOCKETS_HTTPS_HOSTS lingered afterwards as deprecated
// fallbacks inside isRequestHttps(), and are now gone too: both were
// socket-prefixed variables answering a question that is not socket-specific,
// and PUBLIC_URL says scheme and host together per request, which is what
// neither of them could do.

/** One-line summary for the startup banner. */
export function describePublicUrlConfig(): string {
	const url = getConfiguredPublicUrl()
	if (!url) {
		return "not set — resolved per request from the Host header"
	}
	const source = process.env.PUBLIC_URL
		? "PUBLIC_URL"
		: process.env.SERENE_PUB_PUBLIC_URL
			? "SERENE_PUB_PUBLIC_URL"
			: "ORIGIN"
	return `${url.origin}   (from ${source})`
}
