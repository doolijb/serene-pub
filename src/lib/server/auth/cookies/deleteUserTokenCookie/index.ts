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
	// Trust x-forwarded-proto as well as the direct scheme.
	//
	// This is adapter-node, so behind a TLS-terminating reverse proxy (the
	// Docker/hosted path) the app itself only ever sees the plain-HTTP hop from
	// the proxy — event.url.protocol is "http:" even though the BROWSER is on
	// HTTPS. Without this the cookie would quietly lose Secure on exactly the
	// deployments that need it most.
	//
	// Trusting a client-controllable header is safe in this direction and only
	// this direction: the header can only ever cause the cookie to be MORE
	// restrictive. A spoofed "https" adds Secure/strict, which at worst stops
	// the attacker's own cookie being stored. It can never strip protection.
	const forwarded = event.request?.headers
		?.get("x-forwarded-proto")
		?.split(",")[0]
		?.trim()
		.toLowerCase()
	const isHttps = event.url.protocol === "https:" || forwarded === "https"
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
