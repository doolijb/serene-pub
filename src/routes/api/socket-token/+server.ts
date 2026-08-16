import { tokens } from "$lib/server/auth"
import { authenticate } from "$lib/server/providers/users/authenticate"
import { db } from "$lib/server/db"

export async function GET({
	cookies,
	request
}: {
	cookies: any
	request: Request
}) {
	try {
		// When accounts are disabled the socket middleware uses the default user
		// regardless of any token — no need to validate, and avoids noisy decrypt
		// errors from stale cookies left over from a previous accounts-enabled session.
		const systemSettings = await db.query.systemSettings.findFirst()
		if (!systemSettings?.isAccountsEnabled) {
			return new Response(JSON.stringify({ token: null }), {
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"Cache-Control": "no-store"
				}
			})
		}

		// Get the userToken cookie
		const userToken = cookies.get("userToken")

		if (!userToken) {
			return new Response(JSON.stringify({ token: null }), {
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"Cache-Control": "no-store"
				}
			})
		}

		// Decrypt the token to get the token ID
		const payload = await tokens.decryptLocalToken({ token: userToken })

		if (!payload.id) {
			return new Response(JSON.stringify({ token: null }), {
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"Cache-Control": "no-store"
				}
			})
		}

		// Get user agent for validation
		const userAgentString = request.headers.get("user-agent") || ""
		const browser = userAgentString.includes("Chrome")
			? "Chrome"
			: userAgentString.includes("Firefox")
				? "Firefox"
				: userAgentString.includes("Safari")
					? "Safari"
					: "Unknown"

		const os = userAgentString.includes("Windows")
			? "Windows"
			: userAgentString.includes("Macintosh")
				? "macOS"
				: userAgentString.includes("Linux")
					? "Linux"
					: "Unknown"

		const userAgent = {
			browser: { name: browser },
			os: { name: os }
		}

		// Validate the token with proper user agent checking
		const authResult = await authenticate({
			tokenId: payload.id as string,
			token: userToken,
			userAgent,
			validate: true // ✅ Proper validation
		})

		if (!authResult) {
			return new Response(JSON.stringify({ token: null }), {
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"Cache-Control": "no-store"
				}
			})
		}

		// Return the token for socket authentication
		return new Response(JSON.stringify({ token: userToken }), {
			status: 200,
			headers: {
				"Content-Type": "application/json",
				"Cache-Control": "no-store"
			}
		})
	} catch (error) {
		console.error("Socket token endpoint error:", error)
		return new Response(JSON.stringify({ token: null }), {
			status: 200,
			headers: {
				"Content-Type": "application/json",
				"Cache-Control": "no-store"
			}
		})
	}
}
