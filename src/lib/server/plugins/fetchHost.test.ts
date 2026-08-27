import { describe, it, expect } from "vitest"
import { HOST_ALLOW_SOURCE } from "./fetchHost"

/**
 * The host-allow decision is embedded as a source string (the worker cannot
 * import modules), so evaluate it exactly as a worker would and exercise the
 * wildcard + port-scoping rules directly — the end-to-end path is covered by
 * fetch.int.test.ts, but that can only reach 127.0.0.1, so the DNS-domain and
 * wildcard-suffix cases are pinned here.
 */
function loadMatchAllow() {
	const shim: { exports: any } = { exports: null }
	new Function(
		"module",
		HOST_ALLOW_SOURCE + "\nmodule.exports = matchAllow;"
	)(shim)
	return shim.exports as (
		allow: string[],
		reqHost: string,
		reqPort: number
	) => string | null
}

const matchAllow = loadMatchAllow()

describe("fetch host allowlist matcher", () => {
	it("matches an exact host on the default web ports only", () => {
		expect(matchAllow(["api.example.com"], "api.example.com", 443)).toBe(
			"api.example.com"
		)
		expect(matchAllow(["api.example.com"], "api.example.com", 80)).toBe(
			"api.example.com"
		)
		// a bare host grant does NOT open a co-located non-web port
		expect(matchAllow(["api.example.com"], "api.example.com", 6379)).toBeNull()
		expect(matchAllow(["api.example.com"], "other.example.com", 443)).toBeNull()
	})

	it("honours an explicit host:port entry exactly", () => {
		expect(matchAllow(["intranet.corp:8080"], "intranet.corp", 8080)).toBe(
			"intranet.corp"
		)
		expect(matchAllow(["intranet.corp:8080"], "intranet.corp", 443)).toBeNull()
		expect(matchAllow(["intranet.corp:8080"], "intranet.corp", 6379)).toBeNull()
	})

	it("wildcard *.suffix matches sub-domains but not the apex", () => {
		expect(matchAllow(["*.example.com"], "a.example.com", 443)).toBe("*.example.com")
		expect(matchAllow(["*.example.com"], "a.b.example.com", 80)).toBe("*.example.com")
		expect(matchAllow(["*.example.com"], "example.com", 443)).toBeNull() // apex excluded
		expect(matchAllow(["*.example.com"], "notexample.com", 443)).toBeNull()
		expect(matchAllow(["*.example.com"], "a.example.com", 6379)).toBeNull() // still web-port only
		// the classic wildcard-confusion bypass: an attacker host that merely
		// *contains* the suffix must not match (suffix is anchored at the end)
		expect(matchAllow(["*.example.com"], "example.com.evil.com", 443)).toBeNull()
		expect(matchAllow(["*.example.com"], "aexample.com", 443)).toBeNull()
	})

	it("bare * matches any host, still on web ports only", () => {
		expect(matchAllow(["*"], "anything.tld", 443)).toBe("*")
		expect(matchAllow(["*"], "anything.tld", 80)).toBe("*")
		expect(matchAllow(["*"], "anything.tld", 6379)).toBeNull()
	})

	it("a bare IP-literal or localhost entry is a deliberate internal grant on any port", () => {
		expect(matchAllow(["127.0.0.1"], "127.0.0.1", 6379)).toBe("127.0.0.1")
		expect(matchAllow(["localhost"], "localhost", 5432)).toBe("localhost")
		// but a domain/wildcard is never an internal grant
		expect(matchAllow(["*"], "127.0.0.1", 6379)).toBeNull()
	})

	it("returns null for an empty or non-matching allowlist", () => {
		expect(matchAllow([], "api.example.com", 443)).toBeNull()
		expect(matchAllow([""], "api.example.com", 443)).toBeNull()
	})
})
