import { json } from "@sveltejs/kit"
import { db } from "$lib/server/db"

export async function GET() {
	try {
		const systemSettings = await db.query.systemSettings.findFirst({
			where: (s, { eq }) => eq(s.id, 1),
			columns: {
				isAccountsEnabled: true
			}
		})

		return json({
			isAccountsEnabled: systemSettings?.isAccountsEnabled ?? false
		})
	} catch (error) {
		console.error("Error fetching system settings:", error)
		return json(
			{ error: "Failed to fetch system settings" },
			{ status: 500 }
		)
	}
}
