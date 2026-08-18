import type { RequestEvent } from "@sveltejs/kit"
import { isRequestHttps } from "$lib/server/net/publicUrl"

/**
 * The `secure` / `sameSite` pair for the userToken cookie.
 *
 * Shared by setUserTokenCookie and deleteUserTokenCookie because the two MUST
 * agree exactly: a Secure-flagged Set-Cookie (deletion included) is silently
 * rejected by the browser over plain HTTP, so a mismatch means logout never
 * actually clears the cookie and the old session stays live. This used to be
 * two byte-identical copies whose comments said "must mirror ... EXACTLY",
 * which is a divergence-on-next-edit bug waiting to happen.
 *
 * `secure` follows the ACTUAL request scheme, not the build mode. It used to
 * be `!dev`, which meant every production build set Secure — and a Secure
 * cookie is discarded over plain HTTP, which is exactly how the desktop app
 * serves itself (http:// on loopback or a LAN address). In a packaged build
 * the cookie was therefore never stored: /api/socket-token found no cookie,
 * returned {token: null}, and login appeared to do nothing at all.
 *
 * The HTTPS determination itself now lives in isRequestHttps(), which is
 * shared with the socket endpoint and the HSTS header so all three can no
 * longer disagree. Note it is strictly broader than the old local check: it
 * also honors a matching PUBLIC_URL, and it gates the forwarded protocol
 * header on the peer actually being a trusted proxy.
 */
export function cookieSecurity(event: RequestEvent) {
	const isHttps = isRequestHttps(event)
	return { secure: isHttps, sameSite: isHttps ? "strict" : "lax" } as const
}
