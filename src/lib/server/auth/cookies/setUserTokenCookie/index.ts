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
