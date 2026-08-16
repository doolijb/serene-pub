import { json, type RequestEvent } from "@sveltejs/kit"
import { logout } from "$lib/server/providers/users/logout"

export async function POST({ request, cookies, locals }: RequestEvent) {
	try {
		// Use the logout provider to properly clean up tokens and cookies
		await logout({
			event: { request, cookies, locals } as RequestEvent
		})

		return json({
			success: true,
			message: "Logged out successfully"
		})
	} catch (error) {
		console.error("Logout API error:", error)
		return json({ error: "Logout failed" }, { status: 500 })
	}
}
