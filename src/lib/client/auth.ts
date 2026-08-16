/**
 * Client-side authentication utilities for sockets
 */

/**
 * Get authentication token from the server endpoint (for socket authentication)
 * This bypasses the HttpOnly cookie limitation
 */
export async function getAuthTokenFromServer(): Promise<string | null> {
	try {
		const response = await fetch("/api/socket-token", {
			method: "GET",
			credentials: "include" // Include cookies in request
		})

		if (!response.ok) {
			return null
		}

		const data = await response.json()
		return data.token
	} catch (error) {
		console.error("Failed to get auth token from server:", error)
		return null
	}
}

/**
 * Get authentication token from browser cookies (limited due to HttpOnly)
 * This will only work if the cookie is not HttpOnly
 */
export function getAuthTokenFromCookie(): string | null {
	if (typeof document === "undefined") return null

	// Look for the userToken cookie specifically
	const cookieValue = document.cookie
		.split("; ")
		.find((row) => row.startsWith("userToken="))
		?.split("=")[1]

	return cookieValue || null
}

/**
 * Get authentication token from localStorage (fallback)
 */
export function getAuthTokenFromStorage(): string | null {
	if (typeof localStorage === "undefined") return null

	return localStorage.getItem("userToken")
}

/**
 * Set authentication token in cookie (userToken)
 * Note: This is usually handled by the server via setUserTokenCookie
 */
export function setAuthTokenCookie(token: string, expires?: Date): void {
	if (typeof document === "undefined") return

	const expiresStr = expires ? `; expires=${expires.toUTCString()}` : ""
	document.cookie = `userToken=${token}; path=/${expiresStr}; SameSite=Strict`
}

/**
 * Set authentication token in localStorage (fallback)
 */
export function setAuthTokenStorage(token: string): void {
	if (typeof localStorage === "undefined") return

	localStorage.setItem("userToken", token)
}

/**
 * Remove authentication token from both cookie and localStorage
 */
export function removeAuthToken(): void {
	// Remove from cookie
	if (typeof document !== "undefined") {
		document.cookie =
			"userToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT"
	}

	// Remove from localStorage
	if (typeof localStorage !== "undefined") {
		localStorage.removeItem("userToken")
	}
}

/**
 * Get authentication token with fallback priority: server endpoint -> cookie -> localStorage
 */
export async function getAuthToken(): Promise<string | null> {
	// First try to get from server (works around HttpOnly limitation)
	const serverToken = await getAuthTokenFromServer()
	if (serverToken) return serverToken

	// Fallback to cookie and localStorage (if available)
	return getAuthTokenFromCookie() || getAuthTokenFromStorage()
}
