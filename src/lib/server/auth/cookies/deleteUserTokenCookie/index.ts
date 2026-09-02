import type { RequestEvent } from "@sveltejs/kit"
import { cookieSecurity } from "$lib/server/auth/cookies/cookieSecurity"

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
