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
