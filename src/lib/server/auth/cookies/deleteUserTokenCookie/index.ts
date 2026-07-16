import type { RequestEvent } from "@sveltejs/kit"

// Must mirror setUserTokenCookie's secure/sameSite exactly — a Secure-flagged
// Set-Cookie (deletion included) is silently rejected by the browser over
// plain HTTP, so hardcoding secure:true here previously meant logout never
// actually cleared the cookie in dev (plain HTTP), leaving the old session
// live.
const dev = process.env.NODE_ENV === "development"
const secure = !dev
const sameSite = dev ? "lax" : "strict"

/**
 * Deletes the userToken cookie from the incoming request
 *
 * @param args.event The incoming request
 */
export function deleteUserTokenCookie({ event }: { event: RequestEvent }) {
	event.cookies.delete("userToken", {
		path: "/",
		httpOnly: true,
		secure,
		sameSite
	})
}
