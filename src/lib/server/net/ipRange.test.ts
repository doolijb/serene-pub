/**
 * The `::ffff:`-mapped cases are the ones most likely to be silently broken by
 * a naive implementation, and the most consequential: a dual-stack listener
 * (the default under HOST=0.0.0.0) reports every IPv4 peer in that form, so
 * failing to unwrap it misclassifies every real LAN client as non-private —
 * the same lesson already learned once in originAllowlist's own test file.
 */
import { describe, expect, test } from "vitest"
import {
	ipMatchesAny,
	isPrivateAddress,
	normalizeIp,
	parseIpRuleList
} from "./ipRange"

const rulesOf = (raw: string) => parseIpRuleList(raw).rules

describe("normalizeIp", () => {
	test("passes through bare addresses unchanged", () => {
		expect(normalizeIp("192.168.1.50")).toBe("192.168.1.50")
		expect(normalizeIp("::1")).toBe("::1")
	})

	test("unwraps IPv4-mapped IPv6", () => {
		expect(normalizeIp("::ffff:192.168.1.50")).toBe("192.168.1.50")
		expect(normalizeIp("::FFFF:10.0.0.1")).toBe("10.0.0.1")
	})

	test("leaves a genuine IPv6 that merely starts with ::ffff: alone", () => {
		// ::ffff:1:2 is a real IPv6 address, not a mapped IPv4.
		expect(normalizeIp("::ffff:1:2")).toBe("::ffff:1:2")
	})

	test("strips brackets and the port that follows them", () => {
		expect(normalizeIp("[::1]:443")).toBe("::1")
		expect(normalizeIp("[2001:db8::1]")).toBe("2001:db8::1")
	})

	test("strips a zone index", () => {
		expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1")
	})

	test("strips a port from an IPv4 address", () => {
		expect(normalizeIp("1.2.3.4:5678")).toBe("1.2.3.4")
	})

	test("maps localhost to loopback", () => {
		expect(normalizeIp("localhost")).toBe("127.0.0.1")
	})

	test("returns null for empty/absent input", () => {
		expect(normalizeIp(undefined)).toBeNull()
		expect(normalizeIp(null)).toBeNull()
		expect(normalizeIp("   ")).toBeNull()
	})
})

describe("isPrivateAddress — must match the pre-TRUSTED_PROXIES behavior exactly", () => {
	test("accepts loopback and private-range IPv4", () => {
		for (const ip of [
			"127.0.0.1",
			"10.0.0.5",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.1.50",
			"169.254.1.1"
		]) {
			expect(isPrivateAddress(ip), ip).toBe(true)
		}
	})

	test("accepts IPv6 loopback and link-local", () => {
		expect(isPrivateAddress("::1")).toBe(true)
		expect(isPrivateAddress("fe80::1")).toBe(true)
	})

	test("accepts ::ffff:-mapped private IPv4", () => {
		expect(isPrivateAddress("::ffff:192.168.1.50")).toBe(true)
		expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true)
	})

	test("rejects public addresses", () => {
		for (const ip of [
			"203.0.113.7",
			"8.8.8.8",
			"172.32.0.1",
			"172.15.255.255",
			"2001:db8::1"
		]) {
			expect(isPrivateAddress(ip), ip).toBe(false)
		}
	})

	test("rejects empty input", () => {
		expect(isPrivateAddress(undefined)).toBe(false)
		expect(isPrivateAddress("")).toBe(false)
	})
})

describe("parseIpRuleList", () => {
	test("parses IPv4 CIDRs and bare addresses", () => {
		expect(rulesOf("10.0.0.0/8")).toEqual([
			{ kind: "v4", net: 10 << 24, bits: 8 }
		])
		expect(rulesOf("192.168.1.5")).toHaveLength(1)
		expect(rulesOf("192.168.1.5")[0]).toMatchObject({
			kind: "v4",
			bits: 32
		})
	})

	test("parses IPv6 CIDRs and bare addresses", () => {
		expect(rulesOf("2001:db8::/32")[0]).toMatchObject({
			kind: "v6",
			bits: 32
		})
		expect(rulesOf("::1")[0]).toMatchObject({ kind: "v6", bits: 128 })
	})

	test("recognizes the keywords", () => {
		expect(rulesOf("private")).toEqual([{ kind: "private" }])
		expect(rulesOf("*")).toEqual([{ kind: "any" }])
		expect(rulesOf("all")).toEqual([{ kind: "any" }])
		expect(rulesOf("none")).toEqual([])
	})

	test("is whitespace and case tolerant", () => {
		expect(rulesOf("  PRIVATE , 10.0.0.0/8  ")).toHaveLength(2)
	})

	test("collects invalid entries instead of throwing", () => {
		const { rules, invalid } = parseIpRuleList(
			"10.0.0.0/8, not-an-ip, 1.2.3.4/99, 300.1.1.1"
		)
		expect(rules).toHaveLength(1)
		expect(invalid).toEqual(["not-an-ip", "1.2.3.4/99", "300.1.1.1"])
	})

	test("empty input yields no rules and no errors", () => {
		expect(parseIpRuleList("")).toEqual({ rules: [], invalid: [] })
		expect(parseIpRuleList(undefined)).toEqual({ rules: [], invalid: [] })
	})
})

describe("ipMatchesAny", () => {
	test("an empty rule list matches nothing — including loopback", () => {
		expect(ipMatchesAny("127.0.0.1", [])).toBe(false)
	})

	test("matches inside an IPv4 CIDR and rejects outside it", () => {
		const rules = rulesOf("10.0.0.0/8")
		expect(ipMatchesAny("10.255.255.255", rules)).toBe(true)
		expect(ipMatchesAny("11.0.0.1", rules)).toBe(false)
	})

	test("handles a /32 host route", () => {
		const rules = rulesOf("192.168.68.5/32")
		expect(ipMatchesAny("192.168.68.5", rules)).toBe(true)
		expect(ipMatchesAny("192.168.68.6", rules)).toBe(false)
	})

	test("handles addresses above 127.x, where signed-int math would break", () => {
		// 128.0.0.0 and up have the high bit set; without unsigned coercion
		// these compare as negative numbers and match the wrong ranges.
		const rules = rulesOf("203.0.113.0/24")
		expect(ipMatchesAny("203.0.113.7", rules)).toBe(true)
		expect(ipMatchesAny("203.0.114.7", rules)).toBe(false)
		expect(ipMatchesAny("255.255.255.255", rulesOf("255.0.0.0/8"))).toBe(
			true
		)
	})

	test("matches a ::ffff:-mapped peer against an IPv4 rule", () => {
		expect(ipMatchesAny("::ffff:10.1.2.3", rulesOf("10.0.0.0/8"))).toBe(
			true
		)
	})

	test("matches inside an IPv6 CIDR", () => {
		const rules = rulesOf("2001:db8::/32")
		expect(ipMatchesAny("2001:db8::1", rules)).toBe(true)
		expect(ipMatchesAny("2001:db9::1", rules)).toBe(false)
	})

	test("the private keyword matches exactly isPrivateAddress", () => {
		const rules = rulesOf("private")
		for (const ip of ["127.0.0.1", "192.168.1.50", "::1", "fe80::1"]) {
			expect(ipMatchesAny(ip, rules), ip).toBe(true)
		}
		expect(ipMatchesAny("203.0.113.7", rules)).toBe(false)
	})

	test("the any keyword matches everything, including unparseable input", () => {
		const rules = rulesOf("*")
		expect(ipMatchesAny("203.0.113.7", rules)).toBe(true)
		expect(ipMatchesAny("not-an-ip", rules)).toBe(true)
		expect(ipMatchesAny(undefined, rules)).toBe(true)
	})

	test("a public proxy address can be trusted explicitly — impossible before", () => {
		expect(ipMatchesAny("203.0.113.7", rulesOf("203.0.113.7"))).toBe(true)
		expect(ipMatchesAny("203.0.113.7", rulesOf("private"))).toBe(false)
	})

	test("v4 and v6 rules do not cross-match", () => {
		expect(ipMatchesAny("::1", rulesOf("10.0.0.0/8"))).toBe(false)
		expect(ipMatchesAny("10.0.0.1", rulesOf("2001:db8::/32"))).toBe(false)
	})
})
