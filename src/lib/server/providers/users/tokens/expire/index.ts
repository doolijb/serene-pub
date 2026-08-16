import { db, schema } from "$lib/server/db"
import { eq } from "drizzle-orm"

/**
 * Revoke a user token
 */
export async function expire({
	tx = db,
	userTokenId: tokenId,
	returning
}: {
	tx?: DbTransaction | typeof db
	userTokenId: string
	returning?: ReturningSelect
}) {
	const where = eq(schema.userTokens.id, tokenId)

	// Returning?
	if (returning) {
		return await tx
			.update(schema.userTokens)
			.set({ expiresAt: new Date() })
			.where(where)
			.returning(returning)
			.execute()
	}

	// Return result
	return await tx
		.update(schema.userTokens)
		.set({ expiresAt: new Date() })
		.where(where)
		.execute()
}
