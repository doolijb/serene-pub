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
// Still matched by HOSTNAME rather than full origin: a deployment reached over
// both http (LAN) and https (proxy/tunnel) is one deployment, and requiring the
// scheme to match would break the zero-config default for no security gain —
// the attack this defends against is a *different site* opening a socket, and a
// different site differs by hostname.
import {
	ipMatchesAny,
	isPrivateAddress,
	parseIpRuleList,
	type IpRule
} from "$lib/server/net/ipRange"

/** Always allowed; this instance reached from the machine it runs on. */
const BUILTIN_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "::1"] as const

/**
 * Where an allowed host came from. Provenance is the whole point of surfacing
 * this: "chat.example.com is allowed" is not actionable, "chat.example.com is
 * allowed because ALLOWED_ORIGINS says so" is.
 */
export type AllowedHostSource = "builtin" | "env"

export interface AllowedHostEntry {
	hostname: string
	source: AllowedHostSource
}

/**
 * Hostnames that are always reached over HTTPS (eg. a tunnel/reverse-proxy
 * domain) — read by net/publicUrl.ts for protocol auto-detection.
 *
 * @deprecated Superseded by `PUBLIC_URL`, which declares scheme and host
 * together. Kept as a compatibility shim only: it still feeds the one
 * allowlist below so an install that set it years ago keeps working, but it is
 * no longer documented and nothing new should read it. See docs/hosting.md.
 */
export function getHttpsHosts(): string[] {
	return (process.env.SOCKETS_HTTPS_HOSTS || "")
		.split(",")
		.map((h) => h.trim().toLowerCase())
		.filter(Boolean)
}

function getEnvAllowedHosts(): string[] {
	return (process.env.ALLOWED_ORIGINS || "")
		.split(",")
		.map((h) => h.trim().toLowerCase())
		.filter(Boolean)
		.filter((h) => h !== "*")
}

/**
 * The hostname of a declared public URL, if there is a usable one.
 *
 * Declaring a public URL implicitly allowlists it — an admin who has said "this
 * is where the instance lives" should not also have to repeat that hostname in
 * ALLOWED_ORIGINS. Read directly from the environment rather than through
 * net/publicUrl to avoid an import cycle (publicUrl imports this module); the
 * parsing here is intentionally forgiving, since a malformed value is reported
 * once by getConfiguredPublicUrl's own warning.
 */
function getDeclaredPublicUrlHost(): string | null {
	const declared = (
		process.env.PUBLIC_URL ||
		process.env.SERENE_PUB_PUBLIC_URL ||
		process.env.ORIGIN ||
		""
	).trim()
	if (!declared) return null
	try {
		return normalizeHostname(new URL(declared).hostname)
	} catch {
		// ignored — surfaced once by getConfiguredPublicUrl()
		return null
	}
}

/**
 * Every host on the allowlist, with where it came from.
 *
 * The single source of truth for both the enforcement set below and the admin
 * surface — deriving one from the other is what stops the page from confidently
 * describing an allowlist that isn't the one being consulted. Anything that
 * grants a hostname has to be listed HERE, not bolted onto
 * getAllowedOriginHosts(), or the admin page starts lying again.
 *
 * Note what is deliberately NOT here: the zero-config same-hostname rule. An
 * Origin matching the request's own Host is allowed without appearing on any
 * list, so rendering it as an entry would be a lie about a hostname nobody
 * configured. It is a rule, and the UI states it as one.
 */
export function listAllowedHosts(): AllowedHostEntry[] {
	const seen = new Set<string>()
	const entries: AllowedHostEntry[] = []
	for (const hostname of BUILTIN_ALLOWED_HOSTS) {
		seen.add(hostname)
		entries.push({ hostname, source: "builtin" })
	}
	const declaredPublicHost = getDeclaredPublicUrlHost()
	const envHosts = [
		...(declaredPublicHost ? [declaredPublicHost] : []),
		...getHttpsHosts(),
		...getEnvAllowedHosts()
	]
	for (const hostname of envHosts) {
		if (seen.has(hostname)) continue
		seen.add(hostname)
		entries.push({ hostname, source: "env" })
	}
	return entries
}

function getAllowedOriginHosts(): Set<string> {
	return new Set(listAllowedHosts().map((e) => e.hostname))
}

/** `ALLOWED_ORIGINS=*` opts out of the allowlist entirely — meant
 * for deployments (Docker Compose's shipped default) that have already made
 * their own network-exposure decision via port mapping/reverse proxy, where
 * an additional check inside the app is redundant friction. Exported so
 * loadSockets.server.ts can warn at startup when this is combined with
 * disabled-accounts mode (see the round-12 remediation plan's §9) —
 * reused rather than re-implementing the same env-var check there. */
export function isWildcardAllowed(): boolean {
	return (process.env.ALLOWED_ORIGINS || "")
		.split(",")
		.map((h) => h.trim())
		.includes("*")
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
 * against) should still be trusted. Scoped to the local network by default:
 * an internet-reachable instance with accounts disabled (both defaults)
 * would otherwise auto-attach any such connection to the first admin user
 * with no token at all — see the comment in auth.ts. Set
 * `ALLOWED_ORIGINS=*` to trust these from anywhere (the Docker
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
 * The wildcard opt-out is checked first and short-circuits the whole thing:
 * ALLOWED_ORIGINS=* means the admin has declared this deployment's exposure
 * decision belongs to their network layer, so every address passes — including
 * a completely absent header.
 *
 * Now expressed via resolveEffectiveClientAddress(): "every hop is local" and
 * "peeling trusted hops lands on a local address" are the same predicate when
 * trusted == local, which is the default. They stay the same question when
 * TRUSTED_PROXIES narrows or widens what counts as ours, which is the point.
 */
export function isLocalThroughProxy(socket: {
	handshake: { address: string; headers: Record<string, any> }
}): boolean {
	if (isWildcardAllowed()) return true
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
 * Deliberately does NOT short-circuit on isWildcardAllowed the way
 * isLocalThroughProxy does — this is not an oversight. Do not "harmonize" the
 * two: the wildcard is an *origin* check opt-out, and if it also implied
 * address trust, a wildcard deployment would believe ANY remote peer's claimed
 * X-Forwarded-For, letting rotating spoofed headers evade the handshake rate
 * limiter entirely for free.
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
 * predicate rather than isMissingOriginAllowed.
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

/** Human-readable summary of the active configuration, logged once at
 * startup so an admin can see what's actually in effect without reading
 * docs. */
export function describeOriginAllowlistConfig(): string {
	if (isWildcardAllowed()) {
		return "Allowed origins: * (all origins and non-browser clients allowed — ALLOWED_ORIGINS=*)"
	}
	// Built from listAllowedHosts() rather than re-reading the env, so this log
	// line and the admin page can never disagree about what is in effect.
	const explicitHosts = listAllowedHosts()
		.filter((e) => e.source === "env")
		.map((e) => e.hostname)
	const extra =
		explicitHosts.length > 0 ? ` + ${explicitHosts.join(", ")}` : ""
	return `Allowed origins: same-hostname (zero-config) + local network for non-browser clients${extra}`
}

/**
 * Strip the brackets WHATWG URL puts around an IPv6 hostname.
 *
 * `new URL("https://[::1]:3000").hostname` is `"[::1]"`, but every place this
 * app writes an IPv6 host — the built-in list, ALLOWED_ORIGINS, a Host header
 * once its port is removed — uses the bare form. Without this the `::1` entry
 * could never match anything, which is exactly what it was doing.
 */
function normalizeHostname(hostname: string): string {
	return hostname
		.trim()
		.toLowerCase()
		.replace(/^\[|\]$/g, "")
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
 * this server in the first place — comparing against the request's own Host
 * header is therefore a correct, zero-config default that Just Works for
 * localhost, LAN IPs, tunnels, and any custom domain without the admin needing
 * to enumerate hosts anywhere. A genuinely cross-origin page's Origin is the
 * *attacker's* hostname, which never matches the Host header of a request
 * aimed at this server, so this doesn't weaken the check.
 * ALLOWED_ORIGINS remains as an explicit allowlist on top, for the rare setup
 * where Origin and Host genuinely differ — a proxy rewriting Host, say. With
 * Socket.IO attached to the app's own server, an ordinary tab never needs it.
 */
export function isOriginAllowed(
	origin: string | null | undefined,
	requestHost?: string | null
): boolean {
	if (isWildcardAllowed()) return true
	if (!origin) return true
	try {
		const originHostname = normalizeHostname(new URL(origin).hostname)
		if (requestHost) {
			// A Host header for IPv6 is "[::1]:3000" — splitting on the first
			// colon would leave "[" — so the port is stripped from the right.
			const requestHostname = normalizeHostname(
				requestHost.trim().replace(/:\d+$/, "")
			)
			if (originHostname === requestHostname) return true
		}
		return getAllowedOriginHosts().has(originHostname)
	} catch {
		return false
	}
}
