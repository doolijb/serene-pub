import { db } from "$lib/server/db"
import { tokens } from "$lib/server/auth"
import { authenticate } from "$lib/server/providers/users/authenticate"
import {
	isOriginAllowed,
	isLocalThroughProxy,
	getSocketClientAddress,
	warnIfSocketAddressHeaderUnset
} from "$lib/server/sockets/originAllowlist"
import { loginRateLimit } from "$lib/server/services/loginRateLimit"
import type { Socket } from "socket.io"

// Round-12 audit fix (MEDIUM): no cap on concurrent connections per
// account — one token (or the disabled-accounts auto-admin fallback) could
// open unlimited concurrent sockets. Generous on purpose — well above any
// realistic multi-tab/multi-device usage, purely a runaway/DoS backstop,
// not a UX-facing limit.
const MAX_CONCURRENT_SOCKETS_PER_USER = 50

function joinUserRoomWithCap(socket: AuthenticatedSocket, userId: number) {
	const room = `user_${userId}`
	const currentSize = socket.nsp?.adapter?.rooms?.get(room)?.size ?? 0
	if (currentSize >= MAX_CONCURRENT_SOCKETS_PER_USER) {
		console.log(
			`Socket connection rejected: user ${userId} already has ${currentSize} concurrent connections (cap ${MAX_CONCURRENT_SOCKETS_PER_USER})`
		)
		socket.disconnect()
		return false
	}
	socket.join(room)
	return true
}

export interface AuthenticatedSocket extends Socket {
	user?: {
		id: number
		username: string
		isAdmin: boolean
		// Add other user fields as needed
	}
	isAuthenticated: boolean
	/**
	 * The `user_tokens` row backing this connection, or null when accounts are
	 * disabled. Needed to record that this specific session cleared its second
	 * factor (26 §10) — the fact lives on the row, not in the cookie.
	 */
	tokenId: string | null
	/**
	 * This session owes a second factor. While true, sockets/index.ts refuses
	 * every handler outside MFA_PENDING_ALLOWED_EVENTS.
	 */
	mfaPending: boolean
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
	// Round-12 audit fix (MEDIUM): authMiddleware never touched
	// loginRateLimit at all — unlike the HTTP login route's 5-attempts/60s
	// limiter, nothing throttled repeated failed handshake attempts
	// (bad/expired/forged tokens, disallowed origins) from the same
	// address. Reuses the same shared, generic loginRateLimit service —
	// round 13 established the "prefix the key by purpose" convention (eg.
	// `changePassphrase:${userId}`) so this doesn't share a budget with
	// IP-based HTTP login limiting. Records immediately, before any
	// origin/token/DB work below — round 13's TOCTOU fix established this
	// exact pattern (recording only on a late failure branch, after an
	// expensive await, let concurrent bursts all pass the isRateLimited
	// check before any of them recorded an attempt). clearRateLimit() on
	// every success path below (both the disabled-accounts auto-attach and
	// the authenticated path) unconditionally resets the bucket, so normal
	// successful connections — including a legitimate burst of multi-tab/
	// reconnect traffic — are unaffected; only a sustained run of actual
	// failures from one address trips this.
	//
	// Round-14 audit fix: previously keyed on socket.handshake.address
	// directly, which behind a reverse proxy is always the proxy's own
	// address — every real client shared one bucket. getSocketClientAddress()
	// only honors a forwarded-for header when ADDRESS_HEADER is explicitly
	// set and the direct peer is itself local; see originAllowlist.ts for
	// why this deliberately doesn't delegate to isMissingOriginAllowed the
	// way the gate below does.
	warnIfSocketAddressHeaderUnset(socket.handshake.headers)
	const clientAddress = getSocketClientAddress(socket)
	const handshakeRateLimitKey = `socketHandshake:${clientAddress}`
	if (loginRateLimit.isRateLimited(handshakeRateLimitKey)) {
		console.log(
			`Socket handshake rate limited for "${clientAddress}" — rejecting`
		)
		socket.disconnect()
		return next(new Error("Too many connection attempts"))
	}
	loginRateLimit.recordFailedAttempt(handshakeRateLimitKey)

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
		if (!origin) {
			// No Origin header at all — a non-browser client (CLI tool, the
			// Android wrapper, server-to-server), not subject to the
			// browser-mediated attack the check below defends against. Still
			// scoped to the local network by default: an internet-reachable
			// instance with accounts disabled (both defaults) would otherwise
			// auto-attach ANY such connection to the first admin user with no
			// token at all. See originAllowlist.ts's isLocalThroughProxy() —
			// depth-independent chain check (not just the raw peer address),
			// so a reverse proxy in front of this server can't make every
			// connection look local.
			if (!isLocalThroughProxy(socket)) {
				console.log(
					`Socket connection with no Origin header from "${clientAddress}" — rejecting (not a local-network address; set ALLOWED_ORIGINS=* to allow non-browser clients from anywhere)`
				)
				socket.disconnect()
				return next(new Error("Origin not allowed"))
			}
		} else if (!isOriginAllowed(origin, requestHost)) {
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
				// No second factor when there are no accounts to attach one
				// to. Set explicitly rather than left undefined so the gate in
				// sockets/index.ts reads a real value on every path.
				socket.tokenId = null
				socket.mfaPending = false
				if (!joinUserRoomWithCap(socket, fallbackUser.id)) {
					return next(new Error("Too many concurrent connections"))
				}
			}

			loginRateLimit.clearRateLimit(handshakeRateLimitKey)
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

		// Second factor (26 §10). The connection is allowed either way — the
		// client has to be able to submit a code over this same socket — but
		// while this is true, sockets/index.ts refuses every handler outside a
		// small allowlist. Rejecting the handshake instead would leave the user
		// with no transport to verify over.
		//
		// For a user without 2FA enabled this is false, which is what keeps the
		// whole mechanism invisible on the overwhelming majority of instances.
		socket.tokenId = payload.id as string
		const { isMfaPending } = await import("$lib/server/auth/totp/service")
		socket.mfaPending = await isMfaPending(
			authResult.user.id,
			socket.tokenId
		)

		// Join user-specific room
		if (!joinUserRoomWithCap(socket, authResult.user.id)) {
			return next(new Error("Too many concurrent connections"))
		}

		loginRateLimit.clearRateLimit(handshakeRateLimitKey)
		next()
	} catch (error: any) {
		console.error("Socket authentication error:", error)

		// Reject connection on authentication errors when accounts are enabled
		socket.disconnect()
		return next(new Error("Authentication error"))
	}
}
