import type { RequestEvent } from "@sveltejs/kit"

// Must mirror setUserTokenCookie's secure/sameSite EXACTLY — a Secure-flagged
// Set-Cookie (deletion included) is silently rejected by the browser over plain
// HTTP, so a mismatch here means logout never actually clears the cookie and
// the old session stays live. Same scheme-based rule, same reasoning.
// `secure` follows the ACTUAL request scheme, not the build mode.
//
// It used to be `!dev`, which meant every production build set Secure — and a
// Secure cookie is silently discarded by the browser over plain HTTP. That is
// exactly how the desktop app serves itself (http:// on loopback or a LAN
// address), so in a packaged build the userToken cookie was never stored:
// /api/socket-token then found no cookie, returned {token: null}, and login
// appeared to do nothing at all.
//
// Keying off the scheme keeps the protection where it is meaningful (a hosted
// or reverse-proxied HTTPS deployment still gets Secure) without breaking the
// plain-HTTP case the desktop build actually runs in. sameSite stays "strict"
// on HTTPS and relaxes to "lax" on HTTP for the same reason.
function cookieSecurity(event: RequestEvent) {
	// Does NOT consult event.url.protocol. Measured, not assumed: in a
	// production adapter-node build that property reports "https:" even for a
	// request that arrived over plain HTTP on localhost — SvelteKit derives the
	// URL from ORIGIN/PROTOCOL_HEADER rather than the socket, and with neither
	// configured it does not reflect reality. A previous fix keyed on it and
	// was a silent no-op for exactly that reason.
	//
	// So the default is OFF and HTTPS must announce itself:
	//   - behind a TLS-terminating proxy, via x-forwarded-proto
	//   - serving TLS directly, via SERENE_PUB_SECURE_COOKIES=true
	//
	// The desktop app sets neither and therefore always gets a storable cookie,
	// which is the case that has now broken twice. Trusting the header is safe
	// in this direction only: it can only ADD Secure, never remove it.
	const forwarded = event.request?.headers
		?.get("x-forwarded-proto")
		?.split(",")[0]
		?.trim()
		.toLowerCase()
	const isHttps =
		forwarded === "https" ||
		process.env.SERENE_PUB_SECURE_COOKIES === "true"
	return { secure: isHttps, sameSite: isHttps ? "strict" : "lax" } as const
}

/**
 * Deletes the userToken cookie from the incoming request
 *
 * @param args.event The incoming request
 */
export function deleteUserTokenCookie({ event }: { event: RequestEvent }) {
	const { secure, sameSite } = cookieSecurity(event)
	event.cookies.delete("userToken", {
		path: "/",
		httpOnly: true,
		secure,
		sameSite
	})
}
