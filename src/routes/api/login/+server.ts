import { json, type RequestEvent } from "@sveltejs/kit"
import { db } from "$lib/server/db"
import * as schema from "$lib/server/db/schema"
import { eq } from "drizzle-orm"
import { users } from "$lib/server/providers"
import { cookies as authCookies } from "$lib/server/auth"
import { loginRateLimit } from "$lib/server/services/loginRateLimit"

export async function POST(event: RequestEvent) {
	const { request, cookies, getClientAddress } = event
	try {
		const { username, passphrase } = await request.json()

		if (!username || !passphrase) {
			return json(
				{ error: "Username and passphrase are required" },
				{ status: 400 }
			)
		}

		const ip = getClientAddress()
		if (loginRateLimit.isRateLimited(ip)) {
			return json(
				{ error: "Too many attempts. Please try again later." },
				{ status: 429 }
			)
		}

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
			loginRateLimit.recordFailedAttempt(ip)
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
		console.error("Login API error:", error)
		return json({ error: "Authentication failed" }, { status: 500 })
	}
}
