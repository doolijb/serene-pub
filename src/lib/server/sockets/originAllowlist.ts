// Shared by loadSockets.server.ts (Socket.IO's own `cors` option — mostly
// relevant to the polling transport) and auth.ts (the actual enforcement
// point, since a raw WebSocket upgrade is NOT blocked by browsers based on
// CORS/ACAO headers the way XHR/polling is — only server-side rejection of
// the handshake actually stops a malicious page's WebSocket from connecting).
//
// Matches by HOSTNAME rather than full origin (scheme+port), since the
// Socket.IO server always runs on a different port than the main app
// (SOCKETS_PORT vs PORT) — a legitimate same-site browser tab's Origin
// header is therefore always "cross-port" from the socket server's point of
// view. Hostname-only matching lets every already-documented hosting recipe
// (direct, reverse-proxy-same-host, Cloudflare Tunnel) keep working without
// new required config, while still closing the "any website gets a socket
// connection" gap.
// Hostnames that are always reached over HTTPS (eg. a tunnel/reverse-proxy
// domain) — single source of truth, also used by loadSockets.server.ts for
// getPublicSocketsEndpoint()'s protocol auto-detection.
export function getHttpsHosts(): string[] {
	return (process.env.SOCKETS_HTTPS_HOSTS || "")
		.split(",")
		.map((h) => h.trim().toLowerCase())
		.filter(Boolean)
}

function getAllowedOriginHosts(): Set<string> {
	const hosts = new Set<string>(["localhost", "127.0.0.1", "::1"])
	for (const h of getHttpsHosts()) hosts.add(h)
	for (const h of (process.env.SOCKETS_ALLOWED_ORIGINS || "")
		.split(",")
		.map((h) => h.trim().toLowerCase())
		.filter(Boolean)) {
		hosts.add(h)
	}
	return hosts
}

/** `SOCKETS_ALLOWED_ORIGINS=*` opts out of the allowlist entirely — meant
 * for deployments (Docker Compose's shipped default) that have already made
 * their own network-exposure decision via port mapping/reverse proxy, where
 * an additional check inside the app is redundant friction. Exported so
 * loadSockets.server.ts can warn at startup when this is combined with
 * disabled-accounts mode (see the round-12 remediation plan's §9) —
 * reused rather than re-implementing the same env-var check there. */
export function isWildcardAllowed(): boolean {
	return (process.env.SOCKETS_ALLOWED_ORIGINS || "")
		.split(",")
		.map((h) => h.trim())
		.includes("*")
}

/** RFC1918 private ranges + loopback + link-local. Handles IPv4-mapped IPv6
 * (`::ffff:x.x.x.x`) explicitly — a dual-stack listener (the default for
 * `HOST=0.0.0.0` on most systems) reports IPv4 clients' remote addresses in
 * that mapped form, not bare dotted-quad. A naive check against the raw
 * value would misclassify every real LAN client as non-local. */
export function isLocalNetworkAddress(
	address: string | undefined | null
): boolean {
	if (!address) return false
	let ip = address
	if (ip.startsWith("::ffff:")) ip = ip.slice("::ffff:".length)
	if (ip === "::1" || ip === "localhost") return true
	if (ip.toLowerCase().startsWith("fe80:")) return true // IPv6 link-local
	const parts = ip.split(".").map(Number)
	if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return false
	const [a, b] = parts
	if (a === 127) return true // loopback (127.0.0.0/8)
	if (a === 10) return true // 10.0.0.0/8
	if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
	if (a === 192 && b === 168) return true // 192.168.0.0/16
	if (a === 169 && b === 254) return true // link-local (169.254.0.0/16)
	return false
}

/**
 * Whether a connection with NO Origin header at all (a non-browser client —
 * CLI tools, the Android WebView wrapper, server-to-server — which isn't
 * subject to the browser-mediated attack the origin allowlist defends
 * against) should still be trusted. Scoped to the local network by default:
 * an internet-reachable instance with accounts disabled (both defaults)
 * would otherwise auto-attach any such connection to the first admin user
 * with no token at all — see the comment in auth.ts. Set
 * `SOCKETS_ALLOWED_ORIGINS=*` to trust these from anywhere (the Docker
 * Compose default, since that deployment already made its own
 * network-exposure decision).
 */
export function isMissingOriginAllowed(
	remoteAddress: string | undefined | null
): boolean {
	if (isWildcardAllowed()) return true
	return isLocalNetworkAddress(remoteAddress)
}

/**
 * Whether this connection is local, transitively — the direct peer AND
 * every hop the configured ADDRESS_HEADER reports must be local. Depth-
 * independent by construction (checks "all local," not "the Nth one"), so
 * it's correct whether there's one reverse-proxy hop or several (e.g.
 * Cloudflare Tunnel -> nginx -> app) without needing to know or configure
 * how many hops there are. A rightmost-only/fixed-depth read would fail
 * open under a hop-count mismatch: nginx's own recipe
 * (`$proxy_add_x_forwarded_for`) appends its observed peer to whatever the
 * client sent, so under a two-hop chain like Cloudflare Tunnel -> nginx,
 * the header becomes `<real-client>, 127.0.0.1` — a rightmost-only read
 * would resolve to the intermediate hop, which is itself local, and pass
 * every tunneled connection.
 *
 * Delegates to isMissingOriginAllowed() per hop rather than re-deriving its
 * wildcard-opt-out/local-address logic by hand — that keeps this function
 * correct if isMissingOriginAllowed's own conditions ever change, and keeps
 * isMissingOriginAllowed itself a live, exercised function rather than a
 * dead export sitting next to a passing test file. With ADDRESS_HEADER
 * unset, this is exactly isMissingOriginAllowed(socket.handshake.address) —
 * byte-identical to today's behavior. If SOCKETS_ALLOWED_ORIGINS=* is set,
 * isMissingOriginAllowed returns true unconditionally for every address, so
 * every hop (including a completely absent header) passes and this
 * correctly goes vacuously true — the right behavior for an explicit
 * opt-out.
 */
export function isLocalThroughProxy(socket: {
	handshake: { address: string; headers: Record<string, any> }
}): boolean {
	if (!isMissingOriginAllowed(socket.handshake.address)) return false
	const headerName = process.env.ADDRESS_HEADER?.trim().toLowerCase()
	if (!headerName) return true
	const raw = socket.handshake.headers[headerName]
	if (!raw) return true
	// Join multi-instance headers rather than taking only the last instance
	// — dropping any instance would drop the hops inside it, and a chain
	// check that silently ignores some claimed hops can return true even
	// when the full chain contains a non-local one. Node normally coalesces
	// repeated X-Forwarded-For instances into one string before this ever
	// sees an array, so this mostly matters for defensiveness, not the
	// common case.
	const parts = String(Array.isArray(raw) ? raw.join(",") : raw)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
	return parts.every(isMissingOriginAllowed)
}

/**
 * A single effective address for the rate-limit key — rightmost
 * X-Forwarded-For entry (the trusted proxy's own observation, un-spoofable
 * by the client, unlike the leftmost/client-claimed entry — nginx's
 * `$proxy_add_x_forwarded_for` appends rather than replaces, so a client
 * that sends a spoofed value puts it at the LEFT), only honored when the
 * direct peer is itself local. Depth-dependent: correct for the single-hop
 * nginx recipe; under a multi-hop setup (e.g. Cloudflare Tunnel + nginx)
 * this resolves to an intermediate hop, not the true client, collapsing
 * rate-limit buckets the same way as before this function existed. Accepted
 * residual — a wrong value here costs bucket collapse, not a security
 * bypass, unlike the gate above, which is why the gate uses the
 * depth-independent chain check (isLocalThroughProxy) instead of this.
 *
 * Deliberately gates on isLocalNetworkAddress here, NOT isMissingOriginAllowed
 * (unlike isLocalThroughProxy above) — this is not an oversight. Do not
 * "harmonize" the two: isMissingOriginAllowed returns true unconditionally
 * for every address once SOCKETS_ALLOWED_ORIGINS=* is set. If this function
 * delegated to it too, a wildcard deployment would trust ANY remote peer's
 * claimed X-Forwarded-For value, letting rotating spoofed headers evade the
 * handshake rate limiter entirely for free. The wildcard is an *origin*
 * check opt-out; it must not also imply "trust arbitrary clients' address
 * claims."
 */
export function getSocketClientAddress(socket: {
	handshake: { address: string; headers: Record<string, any> }
}): string {
	const headerName = process.env.ADDRESS_HEADER?.trim().toLowerCase()
	if (!headerName) return socket.handshake.address
	if (!isLocalNetworkAddress(socket.handshake.address)) {
		return socket.handshake.address
	}
	const raw = socket.handshake.headers[headerName]
	const value = Array.isArray(raw) ? raw[raw.length - 1] : raw
	if (!value) return socket.handshake.address
	const parts = String(value).split(",").map((s) => s.trim())
	const last = parts[parts.length - 1]
	return last || socket.handshake.address
}

let hasWarnedAboutSocketAddressHeader = false

/** One-time warning (mirrors hooks.server.ts's HTTP-side equivalent) if a
 * forwarded-for-shaped header arrives on a socket handshake while
 * ADDRESS_HEADER is unset — the local-network gate and rate-limit key are
 * then keying on the proxy's own address instead of the real client's. */
export function warnIfSocketAddressHeaderUnset(headers: Record<string, any>) {
	if (hasWarnedAboutSocketAddressHeader) return
	if (process.env.ADDRESS_HEADER) return
	if (!headers["x-forwarded-for"]) return
	hasWarnedAboutSocketAddressHeader = true
	console.warn(
		"[Security] A socket handshake arrived with an X-Forwarded-For header, but ADDRESS_HEADER is not set — " +
			"the local-network-only gate and handshake rate limiting are keying on the wrong address (likely your reverse proxy's). " +
			"See HOSTING.md's reverse-proxy section: set ADDRESS_HEADER=x-forwarded-for, but only if you're actually behind a trusted proxy."
	)
}

/** Human-readable summary of the active configuration, logged once at
 * startup so an admin can see what's actually in effect without reading
 * docs. */
export function describeOriginAllowlistConfig(): string {
	if (isWildcardAllowed()) {
		return "Socket allowed origins: * (all origins and non-browser clients allowed — SOCKETS_ALLOWED_ORIGINS=*)"
	}
	const explicitHosts = (process.env.SOCKETS_ALLOWED_ORIGINS || "")
		.split(",")
		.map((h) => h.trim())
		.filter(Boolean)
	const extra =
		explicitHosts.length > 0 ? ` + ${explicitHosts.join(", ")}` : ""
	return `Socket allowed origins: same-hostname (zero-config) + local network for non-browser clients${extra}`
}

/**
 * Non-browser clients (no Origin header at all — CLI tools, the Android
 * wrapper's WebView in some configurations, server-to-server) aren't subject
 * to the browser-mediated cross-origin attack this allowlist defends
 * against, so only a present Origin header is actually checked.
 *
 * @param requestHost The incoming connection's own `Host` header (eg.
 * `socket.handshake.headers.host`), when available. A same-site browser tab
 * always has an Origin hostname equal to whatever hostname it used to reach
 * this server in the first place (the socket connection is same-hostname,
 * different-port from the page that opened it) — comparing against the
 * request's own Host header is therefore a correct, zero-config default
 * that Just Works for localhost, LAN IPs, and any custom domain without the
 * admin needing to enumerate hosts anywhere. A genuinely cross-origin page's
 * Origin is the *attacker's* hostname, which never matches the Host header
 * of a request aimed at this server, so this doesn't weaken the check.
 * SOCKETS_HTTPS_HOSTS / SOCKETS_ALLOWED_ORIGINS remain as an explicit
 * allowlist on top, for setups where Host genuinely doesn't match (eg. a
 * PUBLIC_SOCKETS_ENDPOINT override pointing at a different hostname).
 */
export function isOriginAllowed(
	origin: string | null | undefined,
	requestHost?: string | null
): boolean {
	if (isWildcardAllowed()) return true
	if (!origin) return true
	try {
		const originHostname = new URL(origin).hostname.toLowerCase()
		if (requestHost) {
			const requestHostname = requestHost
				.split(":")[0]
				.trim()
				.toLowerCase()
			if (originHostname === requestHostname) return true
		}
		return getAllowedOriginHosts().has(originHostname)
	} catch {
		return false
	}
}
