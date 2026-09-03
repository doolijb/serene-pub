import { dev } from "$app/environment"
import { io as connect } from "socket.io-client"
import { setSocket } from "./socketInstance"

/**
 * Get authentication token from cookies via API endpoint
 * Uses server-side endpoint to access HttpOnly cookies
 */
async function getAuthToken(): Promise<string | null> {
	try {
		const response = await fetch("/api/socket-token", {
			credentials: "include" // Include cookies in request
		})

		if (!response.ok) {
			return null
		}

		const data = await response.json()
		return data.token || null
	} catch (error) {
		console.warn("Failed to get auth token:", error)
		return null
	}
}

export async function loadSocketsClient({
	domain
}: {
	domain: string
}): Promise<void> {
	try {
		// Get auth token for socket authentication (async)
		const authToken = await getAuthToken()

		// No URL argument: Socket.IO is attached to the very server that served
		// this page, so the connection is same-origin by construction. This
		// used to fetch /api/sockets-endpoint first to find out which host and
		// port the *other* server was listening on — a round-trip whose only
		// possible answer now is "here".
		const io = connect({
			...(authToken ? { auth: { token: authToken } } : {})
		})
		setSocket(io)

		if (dev) {
			console.log(
				"Connecting to socket server at:",
				window.location.origin
			)
		}

		// Wait for connection to be established
		return new Promise((resolve, reject) => {
			// Set a timeout to prevent indefinite waiting
			const connectionTimeout = setTimeout(() => {
				reject(new Error("Socket connection timeout"))
			}, 10000) // 10 second timeout

			// Listen for successful connection
			io.on("connect", () => {
				clearTimeout(connectionTimeout)
				if (dev) {
					console.log(
						"Socket client connected successfully",
						authToken ? "with auth token" : "without auth token"
					)
				}
				resolve()
			})

			// Listen for connection errors
			io.on("connect_error", (error: any) => {
				clearTimeout(connectionTimeout)
				console.error("Socket connection error:", error)
				reject(error)
			})

			io.on("disconnect", (reason: string) => {
				if (dev) {
					console.log("Socket disconnected:", reason)
				}
				// A server-initiated disconnect (eg. after a passphrase
				// change/admin demotion revokes this session — see
				// disconnectSockets() call sites server-side) reports this
				// exact reason, and unlike other disconnect reasons
				// (network blips, etc.), Socket.IO does NOT auto-reconnect
				// after it. Without this, the tab would sit permanently
				// inert with no visible error. Reloading re-runs
				// +layout.svelte's checkAuthentication() from scratch,
				// which will correctly show the login form once the token
				// is invalid.
				if (reason === "io server disconnect") {
					window.location.reload()
				}
			})
		})
	} catch (error) {
		console.error("Failed to load socket client:", error)
		throw error
	}
}

// Re-export typed socket utilities for convenience
export {
	createTypedSocket,
	useTypedSocket,
	type TypedSocket
} from "./typedSocket"

/**
 * Refresh authentication after login
 * First tries to refresh socket auth, falls back to page reload if needed
 */
export async function refreshAuthAfterLogin(): Promise<void> {
	try {
		// Get fresh auth token
		const authToken = await getAuthToken()

		if (authToken) {
			// Simple solution: reload the page to reinitialize everything with new auth
			// This ensures the socket connection is properly reestablished with the new token
			setTimeout(() => {
				window.location.reload()
			}, 1000) // Small delay to show the success toast
		} else {
			// Reload regardless. A null token here does NOT mean login failed —
			// /api/socket-token legitimately returns {token: null} when accounts
			// are disabled — and previously this branch only warned to the
			// console, so the UI simply froze with no error and no navigation.
			// That silence is what made a Secure-cookie bug in the packaged
			// build present as "clicking login does nothing".
			console.warn(
				"No auth token returned after login; reloading to let the server re-resolve the session"
			)
			setTimeout(() => {
				window.location.reload()
			}, 1000)
		}
	} catch (error) {
		console.error("Failed to refresh auth:", error)
		// Fallback: reload page anyway
		setTimeout(() => {
			window.location.reload()
		}, 1000)
	}
}
