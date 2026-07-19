import { schema, db } from "$lib/server/db"
import { eq } from "drizzle-orm"

/**
 * Invalidate a user's passphrase
 */
export async function invalidate({
	tx = db,
	userId
}: {
	tx?: DbTransaction | typeof db
	userId: string
}): Promise<void> {
	// Set invalidatedAt to current timestamp
	await tx
		.update(schema.passphrases)
		.set({ invalidatedAt: new Date() })
		.where(eq(schema.passphrases.userId, parseInt(userId)))
}
