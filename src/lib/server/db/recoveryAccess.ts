/**
 * Who is allowed to see, and act on, the recovery surface (ruling 2, 2026-09-09).
 *
 * The recovery page is the least protected surface this app has and the most
 * dangerous: it runs with no database, therefore with no accounts, no sessions
 * and no passphrases to check against, and it can move a user's only copy of
 * their data. There is nothing to authenticate *with*, so the only credential
 * available is where the request came from — and that has to be the real
 * answer, not a claimed one.
 *
 * **The raw TCP peer, never a forwarded header.** This app does have a
 * trusted-proxy notion: `TRUSTED_PROXIES` derives `ADDRESS_HEADER`, and
 * `sockets/originAllowlist.ts`'s `getHttpClientAddress()` peels that chain for
 * rate limiting and the local-network gate. This module deliberately does not
 * use it. Behind a trusted proxy, believing the chain would let anyone on the
 * internet send `X-Forwarded-For: 127.0.0.1` and reach a page that can wipe the
 * database — and unlike the rate limiter, there is no second factor behind it.
 * The residual cost is that an owner who reaches their instance only through a
 * tunnel cannot use the recovery page; they use `npm run db:recover` on the
 * machine, which is where the data is anyway.
 *
 * **When locality cannot be established, refuse.** `getDirectPeerAddress()`
 * returns null under an adapter that exposes no Node request. Falling back to
 * `event.getClientAddress()` there is only safe while `ADDRESS_HEADER` is
 * unset, because that is the configuration in which the adapter's answer *is*
 * the peer address; with it set, the adapter would hand back the claimed
 * header. So the fallback is conditioned on exactly that.
 */
import { getDirectPeerAddress } from "$lib/server/sockets/originAllowlist"
import { ipMatchesAny, parseIpRuleList } from "$lib/server/net/ipRange"

/**
 * The address set ruling 2 names, plus IPv6 link-local.
 *
 * `fe80::/10` is the IPv6 half of the `169.254.0.0/16` the ruling lists — a
 * peer on the same physical link, strictly narrower than the `fc00::/7` unique
 * local addresses already allowed — and it is what the rest of the app already
 * treats as private (`net/ipRange.ts`'s `isPrivateAddress`). Left out, a
 * link-local-only LAN would have no recovery page at all.
 *
 * Written as a rule list rather than hand-rolled comparisons so it goes through
 * the same parser and matcher as `TRUSTED_PROXIES` — including the IPv4-mapped
 * IPv6 unwrapping (`::ffff:192.168.1.50`) that a dual-stack listener reports
 * every IPv4 client in, and which a naive check silently gets wrong.
 */
const RECOVERY_PEER_RANGES = [
	"127.0.0.0/8",
	"::1/128",
	"10.0.0.0/8",
	"172.16.0.0/12",
	"192.168.0.0/16",
	"169.254.0.0/16",
	"fc00::/7",
	"fe80::/10"
].join(",")

const RECOVERY_PEER_RULES = parseIpRuleList(RECOVERY_PEER_RANGES).rules

/** Exposed for the CLI and tests; the rules are a constant, not configuration. */
export function isRecoveryPeerAddress(address: string | null | undefined) {
	return ipMatchesAny(address, RECOVERY_PEER_RULES)
}

/**
 * May this request see the recovery surface at all?
 *
 * Everyone else gets a bare 503 — no paths, no backup names, no actions, and
 * nothing that distinguishes "this instance has a broken database and three
 * backups called <these names>" from "this instance is not available".
 */
export function isRecoveryRequestAllowed(event: {
	platform?: unknown
	getClientAddress: () => string
}): boolean {
	const peer = getDirectPeerAddress(event)
	if (peer !== null) return isRecoveryPeerAddress(peer)

	// No Node request to read. The adapter's own answer is the peer address
	// only while no address header is configured; with one set it is a value
	// the client sent, which is exactly what this module refuses to trust.
	if (process.env.ADDRESS_HEADER?.trim()) return false
	try {
		return isRecoveryPeerAddress(event.getClientAddress())
	} catch {
		return false
	}
}
