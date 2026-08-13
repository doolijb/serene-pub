import type { RequestEvent } from "@sveltejs/kit"

// Convert hours:string to number and calculate the max age for the cookie.
// Falls back to 168h (7 days) to match the default used when the token
// itself is created (see providers/users/tokens/create) — without this,
// an unset env var made Number(undefined) => NaN here, silently breaking
// the cookie's maxAge.
const maxHours = process.env.USER_TOKEN_EXPIRATION_HOURS || "168"
const maxAge = 60 * 60 * Number(maxHours)

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

export function setUserTokenCookie({
	event,
	token
}: {
	event: RequestEvent
	token: string
}) {
	const { secure, sameSite } = cookieSecurity(event)
	event.cookies.set("userToken", token, {
		path: "/",
		httpOnly: true,
		secure,
		sameSite,
		maxAge
	})
}
