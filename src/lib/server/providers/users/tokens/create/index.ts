import { db, schema } from "$lib/server/db"
import type { RequestEvent } from "@sveltejs/kit"
import { v4 as uuid } from "uuid"
import { generateLocalToken } from "$lib/server/auth/tokens"
import { eq } from "drizzle-orm"

/**
 * Creates a user token
 *
 * @tx - Database transaction
 * @event - SvelteKit request event
 * @userId - User ID
 */
export async function create({
	tx = db,
	userId,
	event,
	returning
}: {
	tx?: typeof db
	userId: string
	event?: RequestEvent
	returning?: any
}): Promise<any> {
	const expiresAt = new Date(
		Date.now() +
			parseInt(process.env.USER_TOKEN_EXPIRATION_HOURS || "168") *
				60 *
				60 *
				1000
	)

	let browser: string = "Unknown"
	let os: string = "Unknown"

	// Try to extract user agent info if event is provided
	if (event) {
		try {
			const userAgentHeader =
				event.request.headers.get("user-agent") || ""
			browser = userAgentHeader.includes("Chrome")
				? "Chrome"
				: userAgentHeader.includes("Firefox")
					? "Firefox"
					: userAgentHeader.includes("Safari")
						? "Safari"
						: "Unknown"

			os = userAgentHeader.includes("Windows")
				? "Windows"
				: userAgentHeader.includes("Macintosh")
					? "macOS"
					: userAgentHeader.includes("Linux")
						? "Linux"
						: "Unknown"
		} catch (e) {
			// Use defaults if parsing fails
		}
	}

	const tokenData = {
		userId: parseInt(userId),
		token: await generateLocalToken({
			payload: {
				sub: "user"
			},
			expiresIn: `${process.env.USER_TOKEN_EXPIRATION_HOURS || "168"}h`
		}),
		browser,
		os,
		expiresAt
	}

	// First insert the record to get the auto-generated ID
	const [inserted] = await tx
		.insert(schema.userTokens)
		.values({
			userId: parseInt(userId),
			token: "temp", // Temporary token
			browser,
			os,
			expiresAt
		})
		.returning({ id: schema.userTokens.id })

	// Now generate the proper token with the ID and update
	const finalToken = await generateLocalToken({
		payload: {
			sub: "user",
			id: inserted.id
		},
		expiresIn: `${process.env.USER_TOKEN_EXPIRATION_HOURS || "168"}h`
	})

	const query = tx
		.update(schema.userTokens)
		.set({ token: finalToken })
		.where(eq(schema.userTokens.id, inserted.id))

	// Returning?
	if (returning) {
		return await query.returning(returning)
	}

	// Return result - just run the update and return the token info
	await query
	return [{ id: inserted.id, token: finalToken }]
}
