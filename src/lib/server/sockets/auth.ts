import { db } from "$lib/server/db"
import { tokens } from "$lib/server/auth"
import { authenticate } from "$lib/server/providers/users/authenticate"
import { isOriginAllowed } from "$lib/server/sockets/originAllowlist"
import type { Socket } from "socket.io"

export interface AuthenticatedSocket extends Socket {
	user?: {
		id: number
		username: string
		isAdmin: boolean
		// Add other user fields as needed
	}
	isAuthenticated: boolean
	io?: any // Add io property for socket server reference
}

/**
 * Authentication middleware for Socket.IO using PASETO tokens
 * Extracts userToken from client handshake and validates it
 */
export async function authMiddleware(
	socket: AuthenticatedSocket,
	next: (err?: Error) => void
) {
	try {
		// Real enforcement point for the origin allowlist — Socket.IO's own
		// `cors` option (loadSockets.server.ts) only governs the polling
		// transport; browsers don't apply CORS restrictions to WebSocket
		// upgrades, so without this check any web page could open a socket
		// straight to this server and — when accounts are disabled, the
		// default — get auto-attached to the first admin user below with no
		// token at all.
		const origin = socket.handshake.headers.origin as string | undefined
		const requestHost = socket.handshake.headers.host as string | undefined
		if (!isOriginAllowed(origin, requestHost)) {
			console.log(
				`Socket connection from disallowed origin "${origin}" — rejecting`
			)
			socket.disconnect()
			return next(new Error("Origin not allowed"))
		}

		// Check if accounts are enabled in system settings
		const systemSettings = await db.query.systemSettings.findFirst()

		const isAccountsEnabled = systemSettings?.isAccountsEnabled ?? false

		// A) Accounts not enabled: Always grab user 1
		if (!isAccountsEnabled) {
			socket.isAuthenticated = true // Set to true when accounts are disabled

			// Fetch the first admin user when accounts are disabled
			const fallbackUser = await db.query.users.findFirst({
				where: (u, { eq }) => eq(u.isAdmin, true),
				orderBy: (u, { asc }) => [asc(u.id)],
				columns: {
					id: true,
					username: true,
					isAdmin: true
				}
			})

			if (fallbackUser) {
				socket.user = fallbackUser
				socket.join(`user_${fallbackUser.id}`)
			}

			console.log("Accounts disabled, using default user")
			return next()
		}

		// B) Accounts enabled: Require authentication, reject if not provided
		const token = socket.handshake.auth?.token

		if (!token) {
			console.log(
				"No token provided, accounts are enabled - rejecting connection"
			)
			socket.disconnect()
			return next(new Error("Authentication required"))
		}

		// Decrypt the PASETO token to get the payload
		const payload = await tokens.decryptLocalToken({ token })

		if (!payload.id) {
			console.log("Invalid token payload - rejecting connection")
			socket.disconnect()
			return next(new Error("Invalid authentication token"))
		}

		// Get user agent for validation (simplified for sockets)
		const userAgentString = socket.handshake.headers["user-agent"] || ""

		// Parse user agent manually for basic browser/os detection
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

		// Authenticate the user using the existing provider
		const authResult = await authenticate({
			tokenId: payload.id as string,
			token,
			userAgent,
			validate: true
		})

		if (!authResult || !authResult.user) {
			console.log("Authentication failed - rejecting connection")
			socket.disconnect()
			return next(new Error("Authentication failed"))
		}

		// Attach user to socket
		socket.user = {
			id: authResult.user.id,
			username: authResult.user.username,
			isAdmin: authResult.user.isAdmin || false
		}
		socket.isAuthenticated = true

		// Join user-specific room
		socket.join(`user_${authResult.user.id}`)

		next()
	} catch (error: any) {
		console.error("Socket authentication error:", error)

		// Reject connection on authentication errors when accounts are enabled
		socket.disconnect()
		return next(new Error("Authentication error"))
	}
}
