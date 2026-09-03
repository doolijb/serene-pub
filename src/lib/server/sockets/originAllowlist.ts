// Shared by loadSockets.server.ts (Socket.IO's own `cors` option — mostly
// relevant to the polling transport) and auth.ts (the actual enforcement
// point, since a raw WebSocket upgrade is NOT blocked by browsers based on
// CORS/ACAO headers the way XHR/polling is — only server-side rejection of
// the handshake actually stops a malicious page's WebSocket from connecting).
//
// NOTE ON LOCATION: this module is no longer socket-specific — the HTTP login
// path uses getHttpClientAddress() and net/publicUrl.ts uses
// isTrustedProxyAddress(), so `sockets/` is now a misnomer. Moving it is a
// mechanical rename deliberately left to its own commit: it has several
// importers and a test file that imports it by relative path in every one of
// its cases, so folding that churn into a behavioral change would bury the
// behavioral diff.
//
// ONE allowlist governs the whole app. Socket.IO is attached to the same HTTP
// server that serves the pages, so a legitimate browser tab's socket handshake
// is genuinely same-origin — there is no longer a second port, a second
// hostname, or a separate socket-only allowlist to keep in sync with this one.
//
// And it takes NO configuration of its own. Origin trust is derived entirely
// from the ordinary HTTP facts — the request's own `Host` header, `PUBLIC_URL`,
// and `TRUSTED_PROXIES` — rather than from a socket-specific variable an admin
// has to keep in sync with the rest of their hosting config. There is
// deliberately no way to widen it: a variable whose only purpose was to switch
// this check off was, in the accounts-disabled default, a switch that handed a
// tokenless admin session to anything that could reach the port.
//
// Still matched by HOSTNAME rather than full origin (scheme+port): a deployment
// reached over both http (LAN) and https (proxy/tunnel) is one deployment, and
// requiring the scheme to match would break the zero-config default for no
// security gain — the attack this defends against is a *different site* opening
// a socket, and a different site differs by hostname. Hostname-only matching
// also lets every already-documented hosting recipe (direct,
// reverse-proxy-same-host, Cloudflare Tunnel) keep working without new required
// config, while still closing the "any website gets a socket connection" gap.
import {
	ipMatchesAny,
	isPrivateAddress,
	parseIpRuleList,
	type IpRule
} from "$lib/server/net/ipRange"

/** Hostnames that always mean "this very server", whatever it is reached as.
 * A page served from any of these is the app's own UI by construction, so it
 * is allowed even when the request's `Host` says something else (a proxy
 * rewriting `Host` to an internal name). */
const BUILTIN_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "::1"] as const

/** The built-ins plus whatever `PUBLIC_URL` declares — the whole allowlist,
 * and the whole of it is derived rather than configured. */
function getAllowedOriginHosts(): Set<string> {
	const hosts = new Set<string>(BUILTIN_ALLOWED_HOSTS)
	// Declaring a public URL implicitly allowlists it. This is the one hook an
	// admin has, and it is the right one: a proxy that rewrites `Host` to an
	// internal name is exactly the setup where same-`Host` matching cannot
	// work, and such a deployment has a public URL to declare anyway. Read
	// directly rather than via net/publicUrl to avoid an import cycle
	// (publicUrl imports this module); the parsing here is intentionally
	// forgiving since a malformed value is reported by getConfiguredPublicUrl's
	// own warning.
	const declared = (
		process.env.PUBLIC_URL ||
		process.env.SERENE_PUB_PUBLIC_URL ||
		process.env.ORIGIN ||
		""
	).trim()
	if (declared) {
		try {
			hosts.add(new URL(declared).hostname.toLowerCase())
		} catch {
			// ignored — surfaced once by getConfiguredPublicUrl()
		}
	}
	return hosts
}

/** RFC1918 private ranges + loopback + link-local. Handles IPv4-mapped IPv6
 * (`::ffff:x.x.x.x`) explicitly — a dual-stack listener (the default for
 * `HOST=0.0.0.0` on most systems) reports IPv4 clients' remote addresses in
 * that mapped form, not bare dotted-quad. A naive check against the raw
 * value would misclassify every real LAN client as non-local.
 *
 * Now a thin alias over net/ipRange's isPrivateAddress so the `private`
 * keyword in TRUSTED_PROXIES and this predicate can never drift apart — they
 * have to mean the same thing for "TRUSTED_PROXIES unset behaves exactly as
 * before" to hold. */
export const isLocalNetworkAddress = isPrivateAddress

/**
 * Whether an address is one of *this deployment's* reverse proxies, and may
 * therefore be believed when it claims (via a forwarded header) who the real
 * client is or what protocol they used.
 *
 * `TRUSTED_PROXIES` when set; otherwise exactly isLocalNetworkAddress, which
 * is the rule that was hardcoded before this variable existed. That default is
 * what makes every pre-existing install behave identically.
 *
 * Declaring proxies explicitly buys two things the old rule could not express:
 * a proxy on a genuinely public address (a cloud load balancer) can be
 * trusted, and trust can be *narrowed* to one host rather than the whole local
 * network — which matters because the app binds 0.0.0.0 by default, so
 * "anything on the LAN" is a broad grant.
 */
export function isTrustedProxyAddress(
	address: string | undefined | null
): boolean {
	const raw = process.env.TRUSTED_PROXIES?.trim()
	if (!raw) return isPrivateAddress(address)
	return ipMatchesAny(address, getTrustedProxyRules(raw))
}

/** Parsed TRUSTED_PROXIES, cached against the raw string it came from rather
 * than in a bare `let` — tests (and the startup bootstrap) mutate process.env,
 * and a cache that ignores that silently serves a stale ruleset. */
let trustedProxyCache: { raw: string; rules: IpRule[] } | null = null

function getTrustedProxyRules(raw: string): IpRule[] {
	if (trustedProxyCache?.raw === raw) return trustedProxyCache.rules
	const { rules, invalid } = parseIpRuleList(raw)
	if (invalid.length > 0) {
		console.warn(
			`[Config] TRUSTED_PROXIES contains ${invalid.length} unparseable ` +
				`entr${invalid.length === 1 ? "y" : "ies"}, ignored: ` +
				invalid.join(", ")
		)
	}
	// Every entry was garbage — fall back to the built-in private-range rule
	// rather than to "trust nothing". A typo must not silently collapse login
	// rate limiting into one bucket or lock out every non-browser client; the
	// warning above is the signal, and failing to the previous behavior is the
	// least surprising direction to fail in.
	const effective =
		rules.length === 0 && invalid.length > 0
			? ([{ kind: "private" }] as IpRule[])
			: rules
	trustedProxyCache = { raw, rules: effective }
	return effective
}

/**
 * Walk a forwarded-for chain and return the first address that is NOT one of
 * our own proxies — i.e. the closest thing to the real client we can actually
 * justify believing.
 *
 * Peels from the right (nearest hop first) off `[...chain, peer]`, because
 * append-style proxies put the value a client *claimed* at the LEFT: nginx's
 * `$proxy_add_x_forwarded_for` appends its own observed peer to whatever
 * arrived, so a spoofed entry can only ever be pushed further left, never
 * closer to us. Stopping at the first untrusted hop is therefore the exact
 * boundary between "observed by infrastructure we control" and "asserted by a
 * stranger".
 *
 * Depth-independent by construction, which is why this supersedes adapter-node's
 * XFF_DEPTH for every decision this app makes: it is correct for one proxy hop
 * or three without anyone having to count them. A fixed-depth read fails open
 * under a hop-count mismatch — under Cloudflare Tunnel -> nginx the header
 * becomes `<real-client>, 127.0.0.1`, and a rightmost-only read resolves to the
 * intermediate hop, which is itself local, and so passes every tunneled
 * connection.
 *
 * Returns null only when there is nothing to report at all.
 */
export function resolveEffectiveClientAddress(
	peer: string | null | undefined,
	chain: string[]
): string | null {
	const hops = [...chain, peer ?? ""].map((h) => h.trim()).filter(Boolean)
	if (hops.length === 0) return null
	for (let i = hops.length - 1; i >= 0; i--) {
		if (!isTrustedProxyAddress(hops[i])) return hops[i]
	}
	// Every hop is one of ours; the leftmost is the best claim available.
	return hops[0]
}

/** Read a forwarded chain out of whatever ADDRESS_HEADER names. Returns [] when
 * no header is configured or none arrived. Multi-instance headers are joined
 * rather than reduced to the last instance — dropping an instance drops the
 * hops inside it, and a chain check that ignores some claimed hops can pass
 * even when the full chain contains an untrusted one. */
function readForwardedChain(lookup: (name: string) => unknown): string[] {
	const headerName = process.env.ADDRESS_HEADER?.trim().toLowerCase()
	if (!headerName) return []
	const raw = lookup(headerName)
	if (!raw) return []
	return String(Array.isArray(raw) ? raw.join(",") : raw)
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
}

/**
 * Whether a connection with NO Origin header at all (a non-browser client —
 * CLI tools, the Android WebView wrapper, server-to-server — which isn't
 * subject to the browser-mediated attack the origin allowlist defends
 * against) should still be trusted. Scoped to the local network, with no way
 * to widen it: an internet-reachable instance with accounts disabled (both
 * defaults) would otherwise auto-attach any such connection to the first admin
 * user with no token at all — see the comment in auth.ts.
 *
 * That scoping is now unconditional. A remote non-browser client (a CLI tool,
 * a server-to-server integration) reaching this deployment from outside the
 * local network has no opt-in and is rejected; the variable that used to widen
 * this also switched the origin check off wholesale, which in the
 * accounts-disabled default meant handing a tokenless admin session to
 * anything that could route to the port. Enable user accounts and connect with
 * a token if you need that reach.
 */
export function isMissingOriginAllowed(
	remoteAddress: string | undefined | null
): boolean {
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
 * There is no opt-out: locality is required unconditionally. See
 * isMissingOriginAllowed above for why the variable that used to widen this
 * was not worth what it also switched off.
 *
 * Now expressed via resolveEffectiveClientAddress(): "every hop is local" and
 * "peeling trusted hops lands on a local address" are the same predicate when
 * trusted == local, which is the default. They stay the same question when
 * TRUSTED_PROXIES narrows or widens what counts as ours, which is the point.
 */
export function isLocalThroughProxy(socket: {
	handshake: { address: string; headers: Record<string, any> }
}): boolean {
	const chain = readForwardedChain((name) => socket.handshake.headers[name])
	return isLocalNetworkAddress(
		resolveEffectiveClientAddress(socket.handshake.address, chain)
	)
}

/**
 * A single effective address for the rate-limit key — the first hop in the
 * forwarded chain that isn't one of our own proxies (see
 * resolveEffectiveClientAddress for why peeling from the right is the
 * un-spoofable direction).
 *
 * This used to be a rightmost-only read, which was depth-DEPENDENT: correct
 * for the single-hop nginx recipe, but under a multi-hop setup (Cloudflare
 * Tunnel + nginx) it resolved to an intermediate hop rather than the true
 * client and collapsed rate-limit buckets. Peeling fixes that outright, and
 * TRUSTED_PROXIES makes it fixable even when the intermediate hop isn't in a
 * private range.
 *
 * Gated on isTrustedProxyAddress rather than on "is this client local" — the
 * two are different questions and must not be "harmonized". Whether to believe
 * a claimed X-Forwarded-For is a question about the HOP that sent it; letting
 * an origin/locality verdict decide it would mean believing a stranger's
 * claimed address, and rotating spoofed headers would then evade the handshake
 * rate limiter for free.
 */
export function getSocketClientAddress(socket: {
	handshake: { address: string; headers: Record<string, any> }
}): string {
	const chain = readForwardedChain((name) => socket.handshake.headers[name])
	return (
		resolveEffectiveClientAddress(socket.handshake.address, chain) ??
		socket.handshake.address
	)
}

/** Last-resort rate-limit key when neither the direct peer nor the adapter
 * can supply an address (non-node adapters, or ADDRESS_HEADER set while the
 * header is absent and no raw socket is reachable). Every such request
 * shares one bucket, which is the safe direction to fail: over-collapsing
 * buckets throttles too eagerly, whereas inventing a unique per-request key
 * would hand out an unlimited-attempt bypass for free. */
const UNRESOLVED_CLIENT_ADDRESS = "unresolved"

/**
 * The raw TCP peer, read straight off the Node request that adapter-node
 * hands through as `platform.req`. Deliberately NOT `event.getClientAddress()`
 * — see getHttpClientAddress below for why that one can't be called
 * unguarded. Returns null under adapters/dev servers that expose no such
 * request object, which callers must treat as "locality unverifiable".
 */
export function getDirectPeerAddress(event: {
	platform?: unknown
}): string | null {
	const req = (
		event.platform as
			| { req?: { socket?: { remoteAddress?: unknown } } }
			| undefined
	)?.req
	const addr = req?.socket?.remoteAddress
	return typeof addr === "string" && addr.length > 0 ? addr : null
}

/**
 * HTTP twin of getSocketClientAddress() above, with identical trust rules:
 * peel trusted-proxy hops off the ADDRESS_HEADER chain from the right and
 * take the first address that isn't one of ours, honored only when the direct
 * peer is itself trusted. Same reasoning for gating on the proxy-trust
 * predicate rather than on a locality verdict.
 *
 * Exists because `event.getClientAddress()` CANNOT be called unguarded once
 * ADDRESS_HEADER is set: adapter-node's implementation *throws* when the
 * named header is absent from a request ("Address header was specified with
 * ADDRESS_HEADER=... but is absent from request"). On any install reachable
 * both through a proxy and directly (the normal case — a tunnel plus
 * localhost/LAN access), every direct request then threw inside the login
 * route and surfaced as a generic 500 "Authentication failed", making
 * ADDRESS_HEADER effectively unsettable without breaking local login. Going
 * through the raw peer + headers ourselves keeps a missing header a
 * non-event, so ADDRESS_HEADER is safe to set on mixed-access deployments.
 *
 * The trust gate is what makes setting ADDRESS_HEADER safe rather than a
 * rate-limit bypass: a client that reaches the app directly is not a trusted
 * proxy (unless it genuinely is one), so its claimed header is ignored.
 * Residual with the default `private` rule: a host that IS on the local
 * network can still spoof the header. Narrow TRUSTED_PROXIES to your actual
 * proxy, or bind HOST=127.0.0.1 when it runs on the same machine, to close it.
 */
export function getHttpClientAddress(event: {
	request: Request
	platform?: unknown
	getClientAddress: () => string
}): string {
	const headerName = process.env.ADDRESS_HEADER?.trim().toLowerCase()
	const peer = getDirectPeerAddress(event)

	// No header configured: the adapter's own answer is already just the peer
	// address and cannot throw, so prefer it (it knows about adapters whose
	// peer we can't reach) and fall back to whatever we could read directly.
	if (!headerName) {
		return adapterAddressOrNull(event) ?? peer ?? UNRESOLVED_CLIENT_ADDRESS
	}

	if (peer === null) {
		// Locality unverifiable — trusting a claimed header here would be
		// trusting an unauthenticated client, so don't.
		return adapterAddressOrNull(event) ?? UNRESOLVED_CLIENT_ADDRESS
	}

	const chain = readForwardedChain((name) => event.request.headers.get(name))
	return resolveEffectiveClientAddress(peer, chain) ?? peer
}

/** event.getClientAddress() behind a guard, since it throws rather than
 * returning anything when ADDRESS_HEADER names a header the request lacks. */
function adapterAddressOrNull(event: {
	getClientAddress: () => string
}): string | null {
	try {
		return event.getClientAddress() || null
	} catch {
		return null
	}
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
			"See docs/hosting.md: setting TRUSTED_PROXIES to your proxy's address derives this and the other forwarded headers for you."
	)
}

/** Human-readable summary of what's actually in effect, logged once at startup
 * so an admin can see it without reading docs. Nothing here is configurable
 * any more, so this reports a derivation rather than a setting — the only line
 * that can vary is the PUBLIC_URL host, and printing it is how an admin
 * confirms the implicit-allowlist half actually picked their value up. */
export function describeOriginAllowlistConfig(): string {
	const base =
		"Allowed origins: same-hostname (automatic) + local network for " +
		"non-browser clients"
	const declared = getAllowedOriginHosts()
	for (const builtin of BUILTIN_ALLOWED_HOSTS) declared.delete(builtin)
	const extra = [...declared]
	if (extra.length === 0) return base
	return `${base} + ${extra.join(", ")} (from PUBLIC_URL)`
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
 * this server in the first place — the socket handshake goes to the very
 * server that served the page — so comparing against the request's own Host
 * header is a correct, zero-config default that Just Works for localhost, LAN
 * IPs, and any custom domain without the admin needing to enumerate hosts
 * anywhere. A genuinely cross-origin page's Origin is the *attacker's*
 * hostname, which never matches the Host header of a request aimed at this
 * server, so this doesn't weaken the check. `PUBLIC_URL` covers the one setup
 * where Host genuinely doesn't match — a proxy that rewrites it to an internal
 * name — by implicitly allowlisting the hostname it declares.
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
