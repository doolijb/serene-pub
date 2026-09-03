/**
 * E1: the missing-Origin path (non-browser clients — CLI tools, the Android
 * wrapper, server-to-server) used to be allowed unconditionally, which,
 * combined with accounts-disabled-by-default and HOST=0.0.0.0-by-default,
 * meant any internet-reachable non-browser client got a tokenless admin
 * session. Fixed by scoping it to the local network — now unconditionally, the
 * opt-out variable having been retired along with the rest of the
 * socket-specific origin configuration.
 *
 * The `::ffff:`-mapped test cases are the one most likely to be silently
 * broken by a naive implementation: a dual-stack listener (the default for
 * HOST=0.0.0.0 on most systems) reports IPv4 clients' remote addresses in
 * that mapped form, not bare dotted-quad — a check that doesn't unwrap the
 * prefix first misclassifies every real LAN client as non-local.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest"

const ORIGINAL_ENV = { ...process.env }

beforeEach(() => {
	delete process.env.ADDRESS_HEADER
	delete process.env.TRUSTED_PROXIES
	// All three feed the implicit allowlist (same fallback chain as
	// getConfiguredPublicUrl), so a developer's real shell env must not leak
	// into the cases that assert an origin is NOT allowed.
	delete process.env.PUBLIC_URL
	delete process.env.SERENE_PUB_PUBLIC_URL
	delete process.env.ORIGIN
})

function socketWith(address: string, headers: Record<string, any> = {}) {
	return { handshake: { address, headers } }
}

afterEach(() => {
	process.env = { ...ORIGINAL_ENV }
})

describe("isLocalNetworkAddress", () => {
	test("accepts bare loopback and private-range IPv4 addresses", async () => {
		const { isLocalNetworkAddress } = await import("./originAllowlist")
		expect(isLocalNetworkAddress("127.0.0.1")).toBe(true)
		expect(isLocalNetworkAddress("10.0.0.5")).toBe(true)
		expect(isLocalNetworkAddress("172.16.0.1")).toBe(true)
		expect(isLocalNetworkAddress("172.31.255.255")).toBe(true)
		expect(isLocalNetworkAddress("192.168.1.50")).toBe(true)
		expect(isLocalNetworkAddress("169.254.1.1")).toBe(true)
	})

	test("accepts IPv4-mapped IPv6 forms of the same addresses (the dual-stack-listener case)", async () => {
		const { isLocalNetworkAddress } = await import("./originAllowlist")
		expect(isLocalNetworkAddress("::ffff:10.0.0.5")).toBe(true)
		expect(isLocalNetworkAddress("::ffff:192.168.1.50")).toBe(true)
		expect(isLocalNetworkAddress("::ffff:127.0.0.1")).toBe(true)
	})

	test("accepts IPv6 loopback and link-local", async () => {
		const { isLocalNetworkAddress } = await import("./originAllowlist")
		expect(isLocalNetworkAddress("::1")).toBe(true)
		expect(isLocalNetworkAddress("fe80::1")).toBe(true)
	})

	test("rejects public addresses, bare and IPv4-mapped", async () => {
		const { isLocalNetworkAddress } = await import("./originAllowlist")
		expect(isLocalNetworkAddress("203.0.113.7")).toBe(false)
		expect(isLocalNetworkAddress("::ffff:203.0.113.7")).toBe(false)
		expect(isLocalNetworkAddress("8.8.8.8")).toBe(false)
	})

	test("rejects 172.x outside the 16-31 second octet range (not actually 172.16.0.0/12)", async () => {
		const { isLocalNetworkAddress } = await import("./originAllowlist")
		expect(isLocalNetworkAddress("172.15.0.1")).toBe(false)
		expect(isLocalNetworkAddress("172.32.0.1")).toBe(false)
	})

	test("rejects null/undefined/empty/malformed addresses", async () => {
		const { isLocalNetworkAddress } = await import("./originAllowlist")
		expect(isLocalNetworkAddress(undefined)).toBe(false)
		expect(isLocalNetworkAddress(null)).toBe(false)
		expect(isLocalNetworkAddress("")).toBe(false)
		expect(isLocalNetworkAddress("not-an-ip")).toBe(false)
	})
})

describe("isMissingOriginAllowed", () => {
	test("mirrors isLocalNetworkAddress, with nothing able to widen it", async () => {
		const { isMissingOriginAllowed } = await import("./originAllowlist")
		expect(isMissingOriginAllowed("192.168.1.50")).toBe(true)
		expect(isMissingOriginAllowed("203.0.113.7")).toBe(false)
		expect(isMissingOriginAllowed(undefined)).toBe(false)
	})
})

describe("isLocalThroughProxy", () => {
	test("ADDRESS_HEADER unset, local peer — true (baseline unaffected)", async () => {
		const { isLocalThroughProxy } = await import("./originAllowlist")
		expect(
			isLocalThroughProxy(
				socketWith("192.168.1.50", { "x-forwarded-for": "203.0.113.7" })
			)
		).toBe(true)
	})

	test("peer non-local, no ADDRESS_HEADER — false regardless of header", async () => {
		const { isLocalThroughProxy } = await import("./originAllowlist")
		expect(
			isLocalThroughProxy(
				socketWith("203.0.113.7", { "x-forwarded-for": "192.168.1.50" })
			)
		).toBe(false)
	})

	test("spoofed leftmost entry claiming local, real remote peer appended by a genuine proxy — rejected", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		const { isLocalThroughProxy } = await import("./originAllowlist")
		expect(
			isLocalThroughProxy(
				socketWith("127.0.0.1", {
					"x-forwarded-for": "127.0.0.1, 203.0.113.5"
				})
			)
		).toBe(false)
	})

	test("Cloudflare-Tunnel-shaped two-hop chain (real client, then a local intermediate hop) — rejected", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		const { isLocalThroughProxy } = await import("./originAllowlist")
		expect(
			isLocalThroughProxy(
				socketWith("127.0.0.1", {
					"x-forwarded-for": "203.0.113.5, 127.0.0.1"
				})
			)
		).toBe(false)
	})

	test("genuine LAN client through one local hop — accepted", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		const { isLocalThroughProxy } = await import("./originAllowlist")
		expect(
			isLocalThroughProxy(
				socketWith("127.0.0.1", { "x-forwarded-for": "192.168.1.50" })
			)
		).toBe(true)
	})

	test("peer non-local, no forwarded-for header — rejected, with no way to opt in", async () => {
		// The knowingly-accepted capability loss: a non-browser client (no
		// Origin header) reaching this deployment from outside the local
		// network used to be allowed by setting the origin wildcard, which is
		// retired. Nothing widens this now — asserted here so a future
		// "convenience" escape hatch has to delete a test that says why.
		const { isLocalThroughProxy } = await import("./originAllowlist")
		expect(isLocalThroughProxy(socketWith("203.0.113.7"))).toBe(false)
		// ...including with a public PUBLIC_URL declared, which allowlists an
		// ORIGIN hostname and must not be mistaken for address trust.
		process.env.PUBLIC_URL = "https://serene.example.com"
		expect(isLocalThroughProxy(socketWith("203.0.113.7"))).toBe(false)
	})

	test("multi-instance header (array) — joins all instances rather than dropping earlier ones", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		const { isLocalThroughProxy } = await import("./originAllowlist")
		// A non-local entry hiding in the first array instance must still be
		// caught even though the array branch only inspects raw[raw.length-1]
		// naively — joining first is what makes this correctly false.
		expect(
			isLocalThroughProxy(
				socketWith("127.0.0.1", {
					"x-forwarded-for": ["203.0.113.5", "127.0.0.1"]
				})
			)
		).toBe(false)
	})
})

describe("getSocketClientAddress", () => {
	test("ADDRESS_HEADER unset — returns the raw peer address unchanged", async () => {
		const { getSocketClientAddress } = await import("./originAllowlist")
		expect(
			getSocketClientAddress(
				socketWith("203.0.113.7", { "x-forwarded-for": "192.168.1.50" })
			)
		).toBe("203.0.113.7")
	})

	test("ADDRESS_HEADER set, local peer, single-hop header — returns the header value", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		const { getSocketClientAddress } = await import("./originAllowlist")
		expect(
			getSocketClientAddress(
				socketWith("127.0.0.1", { "x-forwarded-for": "203.0.113.5" })
			)
		).toBe("203.0.113.5")
	})

	test("ADDRESS_HEADER set, non-local peer, spoofed header — ignores the header (gated on proxy trust, not on a locality verdict)", async () => {
		// Whether to believe a claimed X-Forwarded-For is a question about the
		// hop that sent it. Deciding it from an origin/locality verdict would
		// mean believing a stranger's claimed address, and rotating spoofed
		// headers would then evade the handshake rate limiter for free.
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		const { getSocketClientAddress } = await import("./originAllowlist")
		expect(
			getSocketClientAddress(
				socketWith("203.0.113.7", {
					"x-forwarded-for": "192.168.1.50"
				})
			)
		).toBe("203.0.113.7")
	})
})

/**
 * The HTTP twin. The throwing-adapter cases are the point of this whole
 * function: adapter-node's getClientAddress() throws outright when
 * ADDRESS_HEADER names a header the request doesn't carry, so every direct
 * (unproxied) request on a mixed-access install used to blow up inside the
 * login route and surface as a 500. `getClientAddress` is stubbed to throw
 * exactly the way adapter-node does, so these lock in that a missing header
 * is a non-event rather than a crash.
 */
function httpEventWith(
	peer: string | null,
	headers: Record<string, string> = {},
	opts: { adapterThrows?: boolean; adapterAddress?: string } = {}
) {
	return {
		request: new Request("http://localhost/api/login", { headers }),
		platform:
			peer === null
				? undefined
				: { req: { socket: { remoteAddress: peer } } },
		getClientAddress: () => {
			if (opts.adapterThrows) {
				throw new Error(
					"Address header was specified with ADDRESS_HEADER=x-forwarded-for but is absent from request"
				)
			}
			return opts.adapterAddress ?? peer ?? ""
		}
	}
}

describe("getHttpClientAddress", () => {
	test("ADDRESS_HEADER unset — returns the peer address, header ignored", async () => {
		const { getHttpClientAddress } = await import("./originAllowlist")
		expect(
			getHttpClientAddress(
				httpEventWith("203.0.113.7", {
					"x-forwarded-for": "192.168.1.50"
				})
			)
		).toBe("203.0.113.7")
	})

	test("ADDRESS_HEADER set, local peer, single-hop header — returns the header value", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		const { getHttpClientAddress } = await import("./originAllowlist")
		expect(
			getHttpClientAddress(
				httpEventWith("127.0.0.1", { "x-forwarded-for": "203.0.113.5" })
			)
		).toBe("203.0.113.5")
	})

	test("ADDRESS_HEADER set, local peer, multi-hop header — takes the rightmost (un-spoofable) entry", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		const { getHttpClientAddress } = await import("./originAllowlist")
		expect(
			getHttpClientAddress(
				httpEventWith("127.0.0.1", {
					"x-forwarded-for": "1.2.3.4, 203.0.113.5"
				})
			)
		).toBe("203.0.113.5")
	})

	test("ADDRESS_HEADER set, non-local peer — ignores the claimed header", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		const { getHttpClientAddress } = await import("./originAllowlist")
		expect(
			getHttpClientAddress(
				httpEventWith("203.0.113.7", {
					"x-forwarded-for": "192.168.1.50"
				})
			)
		).toBe("203.0.113.7")
	})

	test("ADDRESS_HEADER set but header absent — returns the peer instead of throwing (the 500-on-local-login regression)", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		const { getHttpClientAddress } = await import("./originAllowlist")
		expect(() =>
			getHttpClientAddress(
				httpEventWith("127.0.0.1", {}, { adapterThrows: true })
			)
		).not.toThrow()
		expect(
			getHttpClientAddress(
				httpEventWith("127.0.0.1", {}, { adapterThrows: true })
			)
		).toBe("127.0.0.1")
	})

	test("ADDRESS_HEADER set, header absent, no reachable peer — degrades to a shared bucket rather than throwing", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		const { getHttpClientAddress } = await import("./originAllowlist")
		expect(
			getHttpClientAddress(
				httpEventWith(null, {}, { adapterThrows: true })
			)
		).toBe("unresolved")
	})

	test("no reachable peer, ADDRESS_HEADER set — does NOT trust the claimed header (locality unverifiable)", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		const { getHttpClientAddress } = await import("./originAllowlist")
		expect(
			getHttpClientAddress(
				httpEventWith(
					null,
					{ "x-forwarded-for": "192.168.1.50" },
					{ adapterThrows: true }
				)
			)
		).toBe("unresolved")
	})

	test("no platform (dev server), ADDRESS_HEADER unset — falls back to the adapter's own answer", async () => {
		const { getHttpClientAddress } = await import("./originAllowlist")
		expect(
			getHttpClientAddress(
				httpEventWith(null, {}, { adapterAddress: "198.51.100.9" })
			)
		).toBe("198.51.100.9")
	})
})

/**
 * TRUSTED_PROXIES exists because "is the peer trusted" was previously
 * hardcoded to "is the peer in a private range" — which cannot express a cloud
 * load balancer on a public address, and cannot NARROW trust below "the entire
 * local network" (a broad grant, given the app binds 0.0.0.0 by default).
 *
 * The first test here is the backward-compatibility contract: unset must be
 * indistinguishable from the old hardcoded rule.
 */
describe("TRUSTED_PROXIES", () => {
	test("unset — identical to the previous hardcoded private-range rule", async () => {
		const { isTrustedProxyAddress, isLocalNetworkAddress } = await import(
			"./originAllowlist"
		)
		for (const ip of [
			"127.0.0.1",
			"10.0.0.5",
			"172.16.0.1",
			"192.168.1.50",
			"169.254.1.1",
			"::1",
			"fe80::1",
			"::ffff:192.168.1.50",
			"203.0.113.7",
			"8.8.8.8",
			"172.32.0.1"
		]) {
			expect(isTrustedProxyAddress(ip), ip).toBe(
				isLocalNetworkAddress(ip)
			)
		}
	})

	test("an explicit CIDR trusts a public-address proxy that `private` rejects", async () => {
		process.env.TRUSTED_PROXIES = "203.0.113.0/24"
		const { isTrustedProxyAddress } = await import("./originAllowlist")
		expect(isTrustedProxyAddress("203.0.113.7")).toBe(true)
		// ...and narrows: the LAN is no longer blanket-trusted.
		expect(isTrustedProxyAddress("192.168.1.50")).toBe(false)
	})

	test("`none` trusts nothing, including loopback", async () => {
		process.env.TRUSTED_PROXIES = "none"
		const { isTrustedProxyAddress } = await import("./originAllowlist")
		expect(isTrustedProxyAddress("127.0.0.1")).toBe(false)
		expect(isTrustedProxyAddress("203.0.113.7")).toBe(false)
	})

	test("`*` trusts any peer", async () => {
		process.env.TRUSTED_PROXIES = "*"
		const { isTrustedProxyAddress } = await import("./originAllowlist")
		expect(isTrustedProxyAddress("203.0.113.7")).toBe(true)
	})

	test("an all-invalid list falls back to private, not to trusting nothing", async () => {
		// Failing closed here would silently collapse login rate limiting into
		// one bucket and lock out non-browser clients; the startup warning is
		// the signal, and falling back to the previous behavior is the least
		// surprising direction.
		process.env.TRUSTED_PROXIES = "not-an-ip, also-garbage"
		const { isTrustedProxyAddress } = await import("./originAllowlist")
		expect(isTrustedProxyAddress("127.0.0.1")).toBe(true)
		expect(isTrustedProxyAddress("203.0.113.7")).toBe(false)
	})

	test("multi-hop chain resolves the real client, where a rightmost-only read stopped at the intermediate hop", async () => {
		// Cloudflare Tunnel -> nginx -> app. nginx appends its own observed
		// peer, so the header is "<real client>, <tunnel>" and the direct peer
		// is nginx. The old rightmost-only read returned the tunnel's address
		// and collapsed every tunneled user into one rate-limit bucket.
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		process.env.TRUSTED_PROXIES = "127.0.0.1, 10.0.0.0/8"
		const { getSocketClientAddress } = await import("./originAllowlist")
		expect(
			getSocketClientAddress(
				socketWith("127.0.0.1", {
					"x-forwarded-for": "203.0.113.5, 10.1.2.3"
				})
			)
		).toBe("203.0.113.5")
	})

	test("peeling stops at the first untrusted hop — a spoofed left-hand entry is never reached", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		process.env.TRUSTED_PROXIES = "127.0.0.1"
		const { getSocketClientAddress } = await import("./originAllowlist")
		expect(
			getSocketClientAddress(
				socketWith("127.0.0.1", {
					"x-forwarded-for": "1.1.1.1, 203.0.113.5"
				})
			)
		).toBe("203.0.113.5")
	})

	test("the HTTP twin peels identically", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		process.env.TRUSTED_PROXIES = "127.0.0.1, 10.0.0.0/8"
		const { getHttpClientAddress } = await import("./originAllowlist")
		expect(
			getHttpClientAddress(
				httpEventWith("127.0.0.1", {
					"x-forwarded-for": "203.0.113.5, 10.1.2.3"
				})
			)
		).toBe("203.0.113.5")
	})

	test("an untrusted direct peer's claimed chain is still ignored", async () => {
		process.env.ADDRESS_HEADER = "x-forwarded-for"
		process.env.TRUSTED_PROXIES = "10.0.0.0/8"
		const { getHttpClientAddress } = await import("./originAllowlist")
		expect(
			getHttpClientAddress(
				httpEventWith("203.0.113.7", {
					"x-forwarded-for": "192.168.1.50"
				})
			)
		).toBe("203.0.113.7")
	})
})

describe("isOriginAllowed", () => {
	test("a genuinely cross-origin page is rejected", async () => {
		const { isOriginAllowed } = await import("./originAllowlist")
		expect(
			isOriginAllowed("https://evil.example.com", "my-server.local")
		).toBe(false)
	})

	test("an Origin matching the request's own Host is allowed — the zero-config default", async () => {
		// The whole reason no configuration is needed: a same-site tab's Origin
		// hostname IS whatever hostname it used to reach this server, because
		// the handshake goes to the very server that served the page.
		const { isOriginAllowed } = await import("./originAllowlist")
		expect(
			isOriginAllowed("https://serene.example.com", "serene.example.com")
		).toBe(true)
		expect(
			isOriginAllowed("http://192.168.1.50:3000", "192.168.1.50")
		).toBe(true)
		// The Host header carries a port; the Origin comparison is by hostname.
		expect(
			isOriginAllowed("http://192.168.1.50", "192.168.1.50:3000")
		).toBe(true)
		// Scheme deliberately does not have to match: one deployment reached
		// over http on the LAN and https through a proxy is one deployment.
		expect(
			isOriginAllowed("http://serene.example.com", "serene.example.com")
		).toBe(true)
	})

	test("loopback names are allowed regardless of the request's Host", async () => {
		const { isOriginAllowed } = await import("./originAllowlist")
		for (const origin of [
			"http://localhost:5173",
			"http://127.0.0.1:3000"
		]) {
			expect(isOriginAllowed(origin, "internal.local"), origin).toBe(true)
		}
	})

	test("PUBLIC_URL's hostname is implicitly allowlisted — the Host-rewriting-proxy case", async () => {
		// The one setup same-Host matching cannot serve: a proxy that rewrites
		// Host to an internal name, so the browser's Origin and the Host this
		// server sees genuinely differ. Declaring the public URL covers it, and
		// it is now the ONLY way to add a hostname.
		process.env.PUBLIC_URL = "https://serene.example.com"
		const { isOriginAllowed } = await import("./originAllowlist")
		expect(
			isOriginAllowed("https://serene.example.com", "app-internal")
		).toBe(true)
		// ...and only that hostname; declaring one does not widen anything else.
		expect(
			isOriginAllowed("https://evil.example.com", "app-internal")
		).toBe(false)
	})

	test("SERENE_PUB_PUBLIC_URL and ORIGIN allowlist their hostname too", async () => {
		// Same three-way fallback getConfiguredPublicUrl() uses, so an install
		// that only ever set ORIGIN is not silently narrower.
		process.env.SERENE_PUB_PUBLIC_URL = "https://alias.example.com"
		let mod = await import("./originAllowlist")
		expect(
			mod.isOriginAllowed("https://alias.example.com", "app-internal")
		).toBe(true)

		delete process.env.SERENE_PUB_PUBLIC_URL
		process.env.ORIGIN = "https://legacy-origin.example.com"
		mod = await import("./originAllowlist")
		expect(
			mod.isOriginAllowed(
				"https://legacy-origin.example.com",
				"app-internal"
			)
		).toBe(true)
	})

	test("a malformed PUBLIC_URL allowlists nothing rather than throwing", async () => {
		process.env.PUBLIC_URL = "/serene"
		const { isOriginAllowed } = await import("./originAllowlist")
		expect(
			isOriginAllowed("https://serene.example.com", "app-internal")
		).toBe(false)
		// The same-Host path still works, so a typo cannot lock a tab out.
		expect(
			isOriginAllowed("https://serene.example.com", "serene.example.com")
		).toBe(true)
	})

	test("no Origin header at all is not this function's decision", async () => {
		// Non-browser clients are gated by isLocalThroughProxy in auth.ts, not
		// here — see that describe block for the local-network requirement.
		const { isOriginAllowed } = await import("./originAllowlist")
		expect(isOriginAllowed(undefined, "serene.example.com")).toBe(true)
		expect(isOriginAllowed(null, "serene.example.com")).toBe(true)
		expect(isOriginAllowed("", "serene.example.com")).toBe(true)
	})

	test("an unparseable Origin is rejected, not treated as absent", async () => {
		const { isOriginAllowed } = await import("./originAllowlist")
		expect(isOriginAllowed("not-a-url", "serene.example.com")).toBe(false)
	})

	test("a missing Host header falls through to the allowlist rather than matching anything", async () => {
		const { isOriginAllowed } = await import("./originAllowlist")
		expect(isOriginAllowed("https://evil.example.com", undefined)).toBe(
			false
		)
		expect(isOriginAllowed("http://localhost", undefined)).toBe(true)
	})
})

describe("describeOriginAllowlistConfig", () => {
	test("reports the derived default when nothing is declared", async () => {
		const { describeOriginAllowlistConfig } = await import(
			"./originAllowlist"
		)
		const described = describeOriginAllowlistConfig()
		expect(described).toContain("same-hostname")
		expect(described).toContain("local network")
	})

	test("names the PUBLIC_URL host it picked up, so an admin can confirm it applied", async () => {
		process.env.PUBLIC_URL = "https://serene.example.com"
		const { describeOriginAllowlistConfig } = await import(
			"./originAllowlist"
		)
		const described = describeOriginAllowlistConfig()
		expect(described).toContain("serene.example.com")
		expect(described).toContain("PUBLIC_URL")
	})

	test("does not list the built-in loopback hosts as if they were configuration", async () => {
		const { describeOriginAllowlistConfig } = await import(
			"./originAllowlist"
		)
		expect(describeOriginAllowlistConfig()).not.toContain("127.0.0.1")
	})
})
