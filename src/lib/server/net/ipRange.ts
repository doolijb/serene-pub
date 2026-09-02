/**
 * Pure IP address parsing and CIDR matching. No environment access, no imports
 * — everything here is a total function over its arguments, so it can be
 * unit-tested exhaustively and reused by both the socket and HTTP trust paths.
 *
 * This exists to back `TRUSTED_PROXIES`, which lets an admin declare which
 * peers are actually their reverse proxy. Before it, "is this peer trusted"
 * was hardcoded to "is it in a private range" — correct for the common
 * same-host nginx / cloudflared case, but unable to express a cloud load
 * balancer on a public address, or to *narrow* trust to one specific proxy.
 */

/** A single parsed entry from a TRUSTED_PROXIES-style list. */
export type IpRule =
	| { kind: "v4"; net: number; bits: number }
	| { kind: "v6"; net: bigint; bits: number }
	/** The `private` keyword — delegates to isPrivateAddress(). */
	| { kind: "private" }
	/** The `*` / `all` keyword — matches any address. */
	| { kind: "any" }

/**
 * Reduce an address as reported by Node to a bare, comparable IP string.
 *
 * Handles, in order: bracketed IPv6 with an optional port (`[::1]:443`, the
 * form a Host/Forwarded header uses), IPv6 zone indices (`fe80::1%eth0`),
 * IPv4-mapped IPv6 (`::ffff:192.168.1.50`), and an IPv4 address with a port
 * (`1.2.3.4:5678`).
 *
 * The IPv4-mapped case is the one most likely to be silently broken by a naive
 * implementation and the most consequential: a dual-stack listener — the
 * default under `HOST=0.0.0.0` on most systems — reports every IPv4 client in
 * that mapped form, so an implementation that doesn't unwrap it misclassifies
 * every real LAN peer as non-private.
 *
 * Returns null for input that isn't usefully an address.
 */
export function normalizeIp(raw: string | undefined | null): string | null {
	if (!raw) return null
	let ip = String(raw).trim()
	if (!ip) return null

	// `[::1]:443` / `[::1]` — the brackets delimit the address, so anything
	// after the closing bracket is a port and can be dropped wholesale.
	if (ip.startsWith("[")) {
		const close = ip.indexOf("]")
		if (close === -1) return null
		ip = ip.slice(1, close)
	}

	// Zone index (`fe80::1%eth0`) is a local interface selector, never part of
	// the address's identity.
	const zone = ip.indexOf("%")
	if (zone !== -1) ip = ip.slice(0, zone)

	if (ip.toLowerCase() === "localhost") return "127.0.0.1"

	// IPv4-mapped IPv6. Only unwrap when what follows is genuinely a dotted
	// quad — `::ffff:1:2` is a legitimate IPv6 address, not a mapped v4.
	const lower = ip.toLowerCase()
	if (lower.startsWith("::ffff:")) {
		const tail = ip.slice("::ffff:".length)
		if (isIpv4(tail)) return tail
	}

	// `1.2.3.4:5678` — exactly one colon, and dots before it, means a v4 with a
	// port. A bare IPv6 always has two or more colons, so this cannot misfire
	// on one.
	if (!isIpv4(ip) && ip.split(":").length === 2 && ip.includes(".")) {
		const head = ip.slice(0, ip.indexOf(":"))
		if (isIpv4(head)) return head
	}

	return ip
}

function isIpv4(s: string): boolean {
	const parts = s.split(".")
	if (parts.length !== 4) return false
	return parts.every((p) => {
		if (!/^\d{1,3}$/.test(p)) return false
		const n = Number(p)
		return n >= 0 && n <= 255
	})
}

function ipv4ToInt(s: string): number | null {
	if (!isIpv4(s)) return null
	const [a, b, c, d] = s.split(".").map(Number)
	// >>> 0 keeps this an unsigned 32-bit value; without it, any address with
	// the high bit set (128.0.0.0 and up — i.e. half the address space) comes
	// out negative and compares wrongly.
	return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
}

/**
 * Expand an IPv6 literal to its 128-bit value, supporting `::` elision and a
 * trailing embedded IPv4 (`::ffff:1.2.3.4`, which reaches here only when the
 * caller wants the true v6 value rather than the unwrapped v4).
 */
function ipv6ToBigInt(s: string): bigint | null {
	let str = s
	// Trailing embedded IPv4 — rewrite it as the two hex groups it represents.
	const lastColon = str.lastIndexOf(":")
	const tail = lastColon === -1 ? "" : str.slice(lastColon + 1)
	if (tail && isIpv4(tail)) {
		const v = ipv4ToInt(tail)
		if (v === null) return null
		const hi = (v >>> 16).toString(16)
		const lo = (v & 0xffff).toString(16)
		str = `${str.slice(0, lastColon + 1)}${hi}:${lo}`
	}

	const halves = str.split("::")
	if (halves.length > 2) return null

	const parse = (part: string): string[] | null => {
		if (!part) return []
		const groups = part.split(":")
		for (const g of groups) {
			if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
		}
		return groups
	}

	let groups: string[]
	if (halves.length === 2) {
		const head = parse(halves[0])
		const rest = parse(halves[1])
		if (head === null || rest === null) return null
		const fill = 8 - head.length - rest.length
		if (fill < 0) return null
		groups = [...head, ...Array(fill).fill("0"), ...rest]
	} else {
		const all = parse(halves[0])
		if (all === null || all.length !== 8) return null
		groups = all
	}

	let out = 0n
	for (const g of groups) out = (out << 16n) | BigInt(parseInt(g, 16))
	return out
}

/**
 * Exactly the address set that was hardcoded before TRUSTED_PROXIES existed:
 * loopback, the RFC1918 private ranges, IPv4/IPv6 link-local, and IPv6
 * loopback. `TRUSTED_PROXIES` unset resolves to this, which is what makes the
 * new configuration surface a pure superset of the old behavior.
 */
export function isPrivateAddress(address: string | undefined | null): boolean {
	const ip = normalizeIp(address)
	if (!ip) return false
	if (ip === "::1") return true
	if (ip.toLowerCase().startsWith("fe80:")) return true // IPv6 link-local
	const n = ipv4ToInt(ip)
	if (n === null) return false
	const a = n >>> 24
	const b = (n >>> 16) & 0xff
	if (a === 127) return true // loopback 127.0.0.0/8
	if (a === 10) return true // 10.0.0.0/8
	if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
	if (a === 192 && b === 168) return true // 192.168.0.0/16
	if (a === 169 && b === 254) return true // link-local 169.254.0.0/16
	return false
}

export interface ParsedIpRules {
	rules: IpRule[]
	/** Entries that could not be parsed, verbatim, for a startup warning. */
	invalid: string[]
}

/**
 * Parse a comma-separated TRUSTED_PROXIES-style list.
 *
 * Accepted tokens: a CIDR (`10.0.0.0/8`, `2001:db8::/32`), a bare address
 * (implicit /32 or /128), `private`, `none`, and `*` / `all`.
 *
 * Unparseable entries are collected rather than thrown — a single typo must
 * not take the server down, and the caller warns about them at startup. `none`
 * yields an empty rule list, which is distinct from "variable unset" because
 * only a set variable reaches this function at all.
 */
export function parseIpRuleList(raw: string | undefined | null): ParsedIpRules {
	const rules: IpRule[] = []
	const invalid: string[] = []
	if (!raw) return { rules, invalid }

	for (const entry of String(raw).split(",")) {
		const token = entry.trim()
		if (!token) continue
		const lower = token.toLowerCase()

		if (lower === "none") continue // contributes nothing, by definition
		if (lower === "*" || lower === "all") {
			rules.push({ kind: "any" })
			continue
		}
		if (lower === "private" || lower === "local") {
			rules.push({ kind: "private" })
			continue
		}

		const slash = token.indexOf("/")
		const addrPart = slash === -1 ? token : token.slice(0, slash)
		const bitsPart = slash === -1 ? null : token.slice(slash + 1)

		const addr = normalizeIp(addrPart)
		if (!addr) {
			invalid.push(token)
			continue
		}

		const v4 = ipv4ToInt(addr)
		if (v4 !== null) {
			const bits = bitsPart === null ? 32 : Number(bitsPart)
			if (!Number.isInteger(bits) || bits < 0 || bits > 32) {
				invalid.push(token)
				continue
			}
			rules.push({ kind: "v4", net: maskV4(v4, bits), bits })
			continue
		}

		const v6 = ipv6ToBigInt(addr)
		if (v6 !== null) {
			const bits = bitsPart === null ? 128 : Number(bitsPart)
			if (!Number.isInteger(bits) || bits < 0 || bits > 128) {
				invalid.push(token)
				continue
			}
			rules.push({ kind: "v6", net: maskV6(v6, bits), bits })
			continue
		}

		invalid.push(token)
	}

	return { rules, invalid }
}

function maskV4(value: number, bits: number): number {
	if (bits === 0) return 0
	return (value & (bits === 32 ? -1 : ~((1 << (32 - bits)) - 1))) >>> 0
}

function maskV6(value: bigint, bits: number): bigint {
	if (bits === 0) return 0n
	const host = 128n - BigInt(bits)
	return (value >> host) << host
}

/** Whether an address matches any rule in the list. Empty list matches nothing. */
export function ipMatchesAny(
	address: string | undefined | null,
	rules: IpRule[]
): boolean {
	if (rules.length === 0) return false
	// `any` short-circuits before normalization so it also covers addresses we
	// could not parse — an explicit "trust everything" must not be defeated by
	// an address format this module doesn't recognize.
	if (rules.some((r) => r.kind === "any")) return true

	const ip = normalizeIp(address)
	if (!ip) return false

	const v4 = ipv4ToInt(ip)
	const v6 = v4 === null ? ipv6ToBigInt(ip) : null

	for (const rule of rules) {
		if (rule.kind === "private") {
			if (isPrivateAddress(ip)) return true
		} else if (rule.kind === "v4") {
			if (v4 !== null && maskV4(v4, rule.bits) === rule.net) return true
		} else if (rule.kind === "v6") {
			if (v6 !== null && maskV6(v6, rule.bits) === rule.net) return true
		}
	}
	return false
}
