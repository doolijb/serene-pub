/**
 * Check system settings to determine if accounts are enabled
 */
export async function checkSystemSettings(): Promise<{
	isAccountsEnabled: boolean
}> {
	try {
		const response = await fetch("/api/system-settings")
		if (!response.ok) {
			throw new Error("Failed to fetch system settings")
		}
		return await response.json()
	} catch (error) {
		console.error("Error checking system settings:", error)
		// Default to accounts disabled on error
		return { isAccountsEnabled: false }
	}
}

/**
 * Check if user has valid authentication token
 */
export async function checkAuthentication(): Promise<boolean> {
	try {
		const response = await fetch("/api/socket-token", {
			credentials: "include"
		})
		if (!response.ok) {
			return false
		}
		const data = await response.json()
		return !!data.token
	} catch (error) {
		console.error("Error checking authentication:", error)
		return false
	}
}
