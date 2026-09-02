import type { RequestEvent } from "@sveltejs/kit"
import { cookieSecurity } from "$lib/server/auth/cookies/cookieSecurity"

// Convert hours:string to number and calculate the max age for the cookie.
// Falls back to 168h (7 days) to match the default used when the token
// itself is created (see providers/users/tokens/create) — without this,
// an unset env var made Number(undefined) => NaN here, silently breaking
// the cookie's maxAge.
//
// Read per call, NOT at module scope. At module scope this was frozen at first
// import, which happens before .env is loaded on some startup paths — so a
// USER_TOKEN_EXPIRATION_HOURS set only in .env silently did nothing here while
// still applying to the token itself, giving a cookie and a token with
// different lifetimes.
function getCookieMaxAge() {
	const maxHours = process.env.USER_TOKEN_EXPIRATION_HOURS || "168"
	return 60 * 60 * Number(maxHours)
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
		maxAge: getCookieMaxAge()
	})
}
