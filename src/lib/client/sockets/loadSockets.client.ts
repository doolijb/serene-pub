import { dev } from "$app/environment"
import axios, { type AxiosResponse } from "axios"
import * as skio from "sveltekit-io"

interface SocketsEndpointResponse {
	endpoint: string
}

interface SocketOptions {
	cors: { origin: string; credentials: boolean }
	maxHttpBufferSize: number
}

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
		const res: AxiosResponse<SocketsEndpointResponse> = await axios.get(
			"/api/sockets-endpoint"
		)
		const endpoint = res.data.endpoint?.trim()
		let host: string
		if (endpoint) {
			const serverUrl = new URL(endpoint, window.location.origin)
			host = serverUrl.origin
		} else {
			host = window.location.origin
		}

		if (dev) {
			console.log("Connecting to socket server at:", host)
		}

		// Get auth token for socket authentication (async)
		const authToken = await getAuthToken()

		const socketOptions: SocketOptions = {
			cors: { origin: "*", credentials: false },
			maxHttpBufferSize: 1e8
		}

		// Add auth token to connection if available
		const connectionOptions = authToken
			? {
					...socketOptions,
					auth: { token: authToken }
				}
			: socketOptions

		const io = await skio.setup(host, connectionOptions)

		// Type guard to ensure io.to function exists
		// @ts-ignore
		if (typeof io.to !== "function") {
			// @ts-ignore
			io.to = () => ({ emit: () => {} })
		}

		// Wait for connection to be established
		return new Promise((resolve, reject) => {
			// Set a timeout to prevent indefinite waiting
			const connectionTimeout = setTimeout(() => {
				reject(new Error("Socket connection timeout"))
			}, 10000) // 10 second timeout

			// Listen for successful connection
			// @ts-ignore
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
			// @ts-ignore
			io.on("connect_error", (error: any) => {
				clearTimeout(connectionTimeout)
				console.error("Socket connection error:", error)
				reject(error)
			})

			// @ts-ignore
			io.on("disconnect", (reason: string) => {
				if (dev) {
					console.log("Socket disconnected:", reason)
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
			console.warn("No auth token found after login")
		}
	} catch (error) {
		console.error("Failed to refresh auth:", error)
		// Fallback: reload page anyway
		setTimeout(() => {
			window.location.reload()
		}, 1000)
	}
}
