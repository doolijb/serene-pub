/**
 * E1: the missing-Origin path (non-browser clients — CLI tools, the Android
 * wrapper, server-to-server) used to be allowed unconditionally, which,
 * combined with accounts-disabled-by-default and HOST=0.0.0.0-by-default,
 * meant any internet-reachable non-browser client got a tokenless admin
 * session. Fixed by scoping it to the local network by default, with
 * ALLOWED_ORIGINS=* as an explicit opt-out.
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
	delete process.env.ALLOWED_ORIGINS
	delete process.env.ADDRESS_HEADER
	delete process.env.TRUSTED_PROXIES
	delete process.env.PUBLIC_URL
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
	test("mirrors isLocalNetworkAddress when no wildcard is configured", async () => {
		const { isMissingOriginAllowed } = await import("./originAllowlist")
		expect(isMissingOriginAllowed("192.168.1.50")).toBe(true)
		expect(isMissingOriginAllowed("203.0.113.7")).toBe(false)
	})

	test("allows any address when ALLOWED_ORIGINS=* is set", async () => {
		process.env.ALLOWED_ORIGINS = "*"
		const { isMissingOriginAllowed } = await import("./originAllowlist")
		expect(isMissingOriginAllowed("203.0.113.7")).toBe(true)
		expect(isMissingOriginAllowed(undefined)).toBe(true)
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

	test("peer non-local, no ADDRESS_HEADER/wildcard — false regardless of header", async () => {
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

	test("wildcard opt-out set, peer non-local, no forwarded-for header — still accepted", async () => {
		// The case a hand-decomposed (isWildcardAllowed() || isLocalNetworkAddress())
		// predicate could silently break: rejecting a connection an admin
		// deliberately opted in to allowing.
		process.env.ALLOWED_ORIGINS = "*"
		const { isLocalThroughProxy } = await import("./originAllowlist")
		expect(isLocalThroughProxy(socketWith("203.0.113.7"))).toBe(true)
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

	test("ADDRESS_HEADER set, non-local peer, spoofed header — ignores the header (deliberately NOT isMissingOriginAllowed-gated)", async () => {
		// If this delegated to isMissingOriginAllowed the way isLocalThroughProxy
		// does, a wildcard deployment would trust any remote peer's claimed
		// forwarded-for value, letting spoofed headers evade the rate limiter.
		process.env.ALLOWED_ORIGINS = "*"
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
			peer === null ? undefined : { req: { socket: { remoteAddress: peer } } },
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
		process.env.SOCKETS_ALLOWED_ORIGINS = "*"
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
			getHttpClientAddress(httpEventWith(null, {}, { adapterThrows: true }))
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

describe("isOriginAllowed — wildcard", () => {
	test("allows a genuinely cross-origin request when ALLOWED_ORIGINS=* is set", async () => {
		process.env.ALLOWED_ORIGINS = "*"
		const { isOriginAllowed } = await import("./originAllowlist")
		expect(
			isOriginAllowed("https://evil.example.com", "my-server.local")
		).toBe(true)
	})

	test("* can be combined with other comma-separated values", async () => {
		process.env.ALLOWED_ORIGINS = "serene.example.com,*"
		const { isOriginAllowed } = await import("./originAllowlist")
		expect(isOriginAllowed("https://evil.example.com", "host")).toBe(true)
	})

	test("without the wildcard, a genuinely cross-origin request is still rejected", async () => {
		const { isOriginAllowed } = await import("./originAllowlist")
		expect(
			isOriginAllowed("https://evil.example.com", "my-server.local")
		).toBe(false)
	})
})

describe("describeOriginAllowlistConfig", () => {
	test("reports the wildcard state distinctly", async () => {
		process.env.ALLOWED_ORIGINS = "*"
		const { describeOriginAllowlistConfig } = await import(
			"./originAllowlist"
		)
		expect(describeOriginAllowlistConfig()).toMatch(/\*/)
	})

	test("lists explicit extra hosts when configured", async () => {
		process.env.ALLOWED_ORIGINS = "serene.example.com"
		const { describeOriginAllowlistConfig } = await import(
			"./originAllowlist"
		)
		expect(describeOriginAllowlistConfig()).toContain("serene.example.com")
	})
})

describe("listAllowedHosts — provenance", () => {
	test("reports the built-in loopback hosts with no configuration at all", async () => {
		const { listAllowedHosts } = await import("./originAllowlist")
		expect(listAllowedHosts()).toEqual([
			{ hostname: "localhost", source: "builtin" },
			{ hostname: "127.0.0.1", source: "builtin" },
			{ hostname: "::1", source: "builtin" }
		])
	})

	test("attributes configured hosts to the environment, normalised", async () => {
		process.env.ALLOWED_ORIGINS = " Serene.Example.COM , 192.168.1.50 "
		const { listAllowedHosts } = await import("./originAllowlist")
		const env = listAllowedHosts().filter((e) => e.source === "env")
		expect(env).toEqual([
			{ hostname: "serene.example.com", source: "env" },
			{ hostname: "192.168.1.50", source: "env" }
		])
	})

	test("the wildcard is not a hostname and never appears as an entry", async () => {
		process.env.ALLOWED_ORIGINS = "*,serene.example.com"
		const { listAllowedHosts, isWildcardAllowed } = await import(
			"./originAllowlist"
		)
		// It disables the allowlist rather than joining it — rendering "*" as
		// a host would read as an allowed hostname literally named "*".
		expect(isWildcardAllowed()).toBe(true)
		expect(listAllowedHosts().map((e) => e.hostname)).not.toContain("*")
		expect(listAllowedHosts()).toContainEqual({
			hostname: "serene.example.com",
			source: "env"
		})
	})

	test("a host that is already built in is not listed twice under env", async () => {
		process.env.ALLOWED_ORIGINS = "localhost"
		const { listAllowedHosts } = await import("./originAllowlist")
		const localhosts = listAllowedHosts().filter(
			(e) => e.hostname === "localhost"
		)
		expect(localhosts).toEqual([
			{ hostname: "localhost", source: "builtin" }
		])
	})

	test("the startup log line is derived from the same list it describes", async () => {
		process.env.ALLOWED_ORIGINS = "serene.example.com"
		const { describeOriginAllowlistConfig } = await import(
			"./originAllowlist"
		)
		// Two readers of process.env is how a page and a log line end up
		// disagreeing about what is actually enforced.
		expect(describeOriginAllowlistConfig()).toContain("serene.example.com")
	})

	test("enforcement uses exactly the hosts that are listed", async () => {
		process.env.ALLOWED_ORIGINS = "serene.example.com"
		const { listAllowedHosts, isOriginAllowed } = await import(
			"./originAllowlist"
		)
		for (const { hostname } of listAllowedHosts()) {
			// IPv6 has to be bracketed to be a legal URL host; the allowlist
			// stores the bare form, so the lookup normalises brackets away.
			const origin = hostname.includes(":")
				? `https://[${hostname}]`
				: `https://${hostname}`
			expect(isOriginAllowed(origin)).toBe(true)
		}
		expect(isOriginAllowed("https://not-listed.example.com")).toBe(false)
	})
})
