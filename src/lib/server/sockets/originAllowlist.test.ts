/**
 * E1: the missing-Origin path (non-browser clients — CLI tools, the Android
 * wrapper, server-to-server) used to be allowed unconditionally, which,
 * combined with accounts-disabled-by-default and HOST=0.0.0.0-by-default,
 * meant any internet-reachable non-browser client got a tokenless admin
 * session. Fixed by scoping it to the local network by default, with
 * SOCKETS_ALLOWED_ORIGINS=* as an explicit opt-out.
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
	delete process.env.SOCKETS_ALLOWED_ORIGINS
})

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

	test("allows any address when SOCKETS_ALLOWED_ORIGINS=* is set", async () => {
		process.env.SOCKETS_ALLOWED_ORIGINS = "*"
		const { isMissingOriginAllowed } = await import("./originAllowlist")
		expect(isMissingOriginAllowed("203.0.113.7")).toBe(true)
		expect(isMissingOriginAllowed(undefined)).toBe(true)
	})
})

describe("isOriginAllowed — wildcard", () => {
	test("allows a genuinely cross-origin request when SOCKETS_ALLOWED_ORIGINS=* is set", async () => {
		process.env.SOCKETS_ALLOWED_ORIGINS = "*"
		const { isOriginAllowed } = await import("./originAllowlist")
		expect(
			isOriginAllowed("https://evil.example.com", "my-server.local")
		).toBe(true)
	})

	test("* can be combined with other comma-separated values", async () => {
		process.env.SOCKETS_ALLOWED_ORIGINS = "serene.example.com,*"
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
		process.env.SOCKETS_ALLOWED_ORIGINS = "*"
		const { describeOriginAllowlistConfig } = await import(
			"./originAllowlist"
		)
		expect(describeOriginAllowlistConfig()).toMatch(/\*/)
	})

	test("lists explicit extra hosts when configured", async () => {
		process.env.SOCKETS_ALLOWED_ORIGINS = "serene.example.com"
		const { describeOriginAllowlistConfig } = await import(
			"./originAllowlist"
		)
		expect(describeOriginAllowlistConfig()).toContain(
			"serene.example.com"
		)
	})
})
