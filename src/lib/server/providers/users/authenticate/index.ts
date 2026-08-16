import { asc, desc, eq } from "drizzle-orm"
import { db, schema } from "$lib/server/db"

interface AuthenticateAndValidate {
	tx?: typeof db
	tokenId: string
	token: string
	userAgent: {
		browser: {
			name: string
		}
		os: {
			name: string
		}
	}
	validate: true
}

interface AuthenticateWithoutValidation {
	tx?: typeof db
	tokenId: string
	token: null
	userAgent: null
	validate: false
}

const adminPermissionColumns = {
	name: true,
	action: true,
	resource: true
}

/**
 * Takes a userTokenId and returns a user if it's valid
 * Use UAParser for userAgent
 */
export async function authenticate({
	tx = db,
	tokenId,
	token = null,
	userAgent = null,
	validate = true
}: AuthenticateAndValidate | AuthenticateWithoutValidation): Promise<{
	user: SelectUser
} | null> {
	////
	// GET USER TOKEN
	////

	const userToken = await tx.query.userTokens.findFirst({
		where: (t, { and, eq, gt }) =>
			and(eq(t.id, tokenId), gt(t.expiresAt, new Date())),
		orderBy: (t, { desc }) => desc(t.createdAt),
		with: {
			user: true
		}
	})

	////
	// NO USER TOKEN
	////

	if (!userToken) {
		return null
	}

	/////
	// VALIDATE TOKEN
	////

	if (validate && userAgent) {
		const browser = userAgent.browser.name || "Unknown"
		const os = userAgent.os.name || "Unknown"

		if (
			userToken.token !== token ||
			userToken.browser !== browser ||
			userToken.os !== os
		) {
			// If failure, expire the token and delete it from the client
			await tx
				.update(schema.userTokens)
				.set({
					expiresAt: new Date()
				})
				.where(eq(schema.userTokens.id, tokenId))
			throw new Error("Invalid token")
		}
	}

	////
	// RETURN USER
	////

	if (!userToken.user) {
		return null
	}

	// A soft-deleted user's existing tokens are revoked immediately at delete
	// time (see usersDelete), but check here too as a second line of defense
	// — e.g. a token created in a race just before the delete committed.
	if ((userToken.user as SelectUser).isDeleted) {
		await tx
			.update(schema.userTokens)
			.set({ expiresAt: new Date() })
			.where(eq(schema.userTokens.id, tokenId))
		return null
	}

	return {
		user: userToken.user as SelectUser
	}
}
