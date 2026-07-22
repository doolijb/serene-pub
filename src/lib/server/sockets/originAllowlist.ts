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
