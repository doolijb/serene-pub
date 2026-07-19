import { db, schema } from "$lib/server/db"
import { eq } from "drizzle-orm"

/**
 * Revoke all user tokens
 */
export async function expireAll({
	tx = db,
	userId,
	returning
}: {
	tx?: DbTransaction | typeof db
	userId: string
	returning?: ReturningSelect
}) {
	const where = eq(schema.userTokens.userId, parseInt(userId))

	// Returning?
	if (returning) {
		return await tx
			.update(schema.userTokens)
			.set({ expiresAt: new Date() })
			.where(where)
			.returning(returning)
	}

	// Return result
	return await tx
		.update(schema.userTokens)
		.set({ expiresAt: new Date() })
		.where(where)
}
