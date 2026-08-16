import { expire } from "../tokens"
import { db } from "$lib/server/db"
import type { RequestEvent } from "@sveltejs/kit"
import { cookies } from "$lib/server/auth"
import { decryptLocalToken } from "$lib/server/auth/tokens/decryptLocalToken"

export async function logout({
	tx = db,
	event
}: {
	tx?: typeof db
	event: RequestEvent
}) {
	// event.locals.userTokenId is never populated by any middleware in this
	// app (hooks.server.ts's middleware chain is empty), so resolve the
	// token id directly from the cookie instead — otherwise logout only ever
	// cleared the cookie and the server-side session row stayed valid until
	// its natural ~7-day expiry regardless of "logging out".
	const rawToken = event.cookies.get("userToken")
	if (rawToken) {
		try {
			const payload = await decryptLocalToken({ token: rawToken })
			if (typeof payload?.id === "string") {
				await expire({ tx, userTokenId: payload.id })
			}
		} catch {
			// Token already invalid/undecryptable — nothing server-side to revoke.
		}
	}
	cookies.deleteUserTokenCookie({ event })
}
