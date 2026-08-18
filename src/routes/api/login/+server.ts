import { json, type RequestEvent } from "@sveltejs/kit"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { users } from "$lib/server/providers"
import { cookies as authCookies } from "$lib/server/auth"
import { loginRateLimit } from "$lib/server/services/loginRateLimit"
import { getHttpClientAddress } from "$lib/server/sockets/originAllowlist"

export async function POST(event: RequestEvent) {
	const { request } = event
	try {
		let username: unknown
		let passphrase: unknown
		try {
			;({ username, passphrase } = await request.json())
		} catch {
			// A malformed body is the caller's error, not ours — letting it
			// fall through to the catch-all below reported it as a 500
			// "Authentication failed", which reads as "the server's auth is
			// broken" to both users and anyone reading the logs.
			return json({ error: "Invalid request body" }, { status: 400 })
		}

		// typeof checks (rather than the previous bare falsiness test) narrow
		// these from unknown for the calls below, and reject non-string JSON
		// values that would otherwise reach the query/validate layer.
		if (
			typeof username !== "string" ||
			typeof passphrase !== "string" ||
			!username ||
			!passphrase
		) {
			return json(
				{ error: "Username and passphrase are required" },
				{ status: 400 }
			)
		}

		// NOT event.getClientAddress() — that throws outright on any request
		// lacking the ADDRESS_HEADER header once ADDRESS_HEADER is set, which
		// is every direct (non-proxied) request on a mixed-access install.
		// See getHttpClientAddress's own comment for the full story.
		const ip = getHttpClientAddress(event)
		if (loginRateLimit.isRateLimited(ip)) {
			return json(
				{ error: "Too many attempts. Please try again later." },
				{ status: 429 }
			)
		}
		// Recorded immediately, before the expensive DB lookup + PBKDF2
		// validate below — recording only after that await let concurrent
		// requests all pass the isRateLimited check above before any of
		// them recorded an attempt, letting a burst through with no
		// effective cap. clearRateLimit() on success (below) still resets
		// the bucket, so a normal single successful login is unaffected.
		loginRateLimit.recordFailedAttempt(ip)

		// Find user by username
		const user = await db.query.users.findFirst({
			where: eq(schema.users.username, username),
			columns: {
				id: true,
				username: true,
				isAdmin: true
			}
		})

		// Always run the same PBKDF2-cost passphrase validation whether or not
		// the username exists — validating against some other real user's
		// passphrase row when it doesn't, rather than short-circuiting — so
		// response timing can't be used to enumerate valid usernames. The
		// dummy target's own passphrase never matches the submitted one
		// (attacker doesn't know it), so this never grants access.
		const dummyTarget = user
			? null
			: await db.query.users.findFirst({ columns: { id: true } })
		const validateTargetId = user?.id ?? dummyTarget?.id
		const isValidPassphrase = validateTargetId
			? await users.passphrase.validate({
					userId: validateTargetId.toString(),
					passphrase
				})
			: false

		if (!user || !isValidPassphrase) {
			return json({ error: "Invalid credentials" }, { status: 401 })
		}

		loginRateLimit.clearRateLimit(ip)

		// Create authentication token using the proper token creation flow
		const tokenResult = await users.tokens.create({
			userId: user.id.toString(),
			event,
			returning: {
				token: schema.userTokens.token
			}
		})

		const token = tokenResult[0].token

		authCookies.setUserTokenCookie({ event, token })

		return json({
			success: true,
			user: {
				id: user.id,
				username: user.username,
				isAdmin: user.isAdmin || false
			}
		})
	} catch (error) {
		// Reaching here means the server broke, not that the credentials were
		// wrong — every genuine credential outcome returns 401 above. The old
		// "Authentication failed" wording conflated the two, which is how a
		// thrown getClientAddress() spent its life disguised as a rejected
		// login. No client matches on this string.
		console.error("Login API error:", error)
		return json(
			{ error: "Login failed due to a server error" },
			{ status: 500 }
		)
	}
}
