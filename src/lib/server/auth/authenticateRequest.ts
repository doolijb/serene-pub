import type { RequestEvent } from "@sveltejs/kit"
import { db } from "$lib/server/db"
import { tokens } from "$lib/server/auth"
import { authenticate } from "$lib/server/providers/users/authenticate"

export interface RequestUser {
	id: number
	username: string
	isAdmin: boolean
}

/**
 * HTTP-route equivalent of sockets/auth.ts's authMiddleware — same
 * accounts-disabled/enabled branching, same cookie/PASETO token, so a plain
 * SvelteKit +server.ts route can enforce the same auth the socket layer
 * already does. Nothing in hooks.server.ts currently runs auth on HTTP
 * routes (the userAuthentication/routeGuard middleware referenced there was
 * never built), so any route serving per-user data needs to call this
 * itself rather than relying on global middleware.
 */
export async function authenticateRequest(
	event: RequestEvent
): Promise<RequestUser | null> {
	const systemSettings = await db.query.systemSettings.findFirst()
	const isAccountsEnabled = systemSettings?.isAccountsEnabled ?? false

	if (!isAccountsEnabled) {
		const fallbackUser = await db.query.users.findFirst({
			where: (u, { eq }) => eq(u.isAdmin, true),
			orderBy: (u, { asc }) => [asc(u.id)],
			columns: { id: true, username: true, isAdmin: true }
		})
		return fallbackUser
			? {
					id: fallbackUser.id,
					username: fallbackUser.username,
					isAdmin: fallbackUser.isAdmin || false
				}
			: null
	}

	const token = event.cookies.get("userToken")
	if (!token) return null

	try {
		const payload = await tokens.decryptLocalToken({ token })
		if (!payload.id) return null

		// validate: false skips authenticate()'s browser/OS CSRF-style match —
		// that check only guards against a stolen-token-replayed-from-a-
		// different-browser scenario, which matters for the socket handshake
		// (a live session) but not for authorizing a single read-only file
		// fetch; a non-expired token row for a non-deleted user is enough here.
		const authResult = await authenticate({
			tokenId: payload.id as string,
			token: null,
			userAgent: null,
			validate: false
		})
		if (!authResult?.user) return null

		// A session that has not cleared its second factor is not authenticated
		// for anything (26 §10). HTTP routes have no way to prompt for a code,
		// so the correct answer here is simply "no user" — the socket layer is
		// where verification happens.
		const { isMfaPending } = await import("$lib/server/auth/totp/service")
		if (await isMfaPending(authResult.user.id, payload.id as string)) {
			return null
		}

		return {
			id: authResult.user.id,
			username: authResult.user.username,
			isAdmin: authResult.user.isAdmin || false
		}
	} catch {
		return null
	}
}
