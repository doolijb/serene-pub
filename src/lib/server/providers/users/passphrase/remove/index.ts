import { db, schema } from "$lib/server/db"
import { eq } from "drizzle-orm"

export async function remove({
	tx = db,
	userId,
	returning
}: {
	tx?: DbTransaction | typeof db
	userId: string
	returning?: ReturningSelect
}) {
	const where = eq(schema.passphrases.userId, parseInt(userId))

	// Returning?
	if (returning) {
		return await tx
			.delete(schema.passphrases)
			.where(where)
			.returning(returning)
	}

	// Return result
	return await tx.delete(schema.passphrases).where(where)
}
