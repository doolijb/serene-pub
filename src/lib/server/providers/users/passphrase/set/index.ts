import { schema, db } from "$lib/server/db"
import crypto from "crypto"
import { hashPassphrase } from "../kdf"
import type { QueryResult } from "pg"
import { eq } from "drizzle-orm"

/**
 * Create a new passphrase for a user and store it in the database
 *
 * @param tx
 * @param userId
 * @param passphrase
 * @param createOnly - If true, will not delete any existing passphrases for this user, i.e. user was just created
 */
export async function set({
	tx = db,
	userId,
	passphrase,
	createOnly = false
}: {
	tx?: typeof db
	userId: string
	passphrase: string
	createOnly?: boolean
}): Promise<void> {
	// Argon2id where the runtime supports it, scrypt otherwise (see ../kdf).
	// The digest is a self-describing PHC-style string, so the algorithm and
	// its cost parameters travel with the row rather than living in columns
	// that only ever described PBKDF2.
	const hashedPassphrase = hashPassphrase(passphrase)

	// `salt` and `iterations` are NOT NULL and only ever meant PBKDF2. The salt
	// is inside the digest now, so these are written as inert placeholders to
	// satisfy the constraint — nothing reads them for a modern row.
	const salt = ""
	const iterations = 0

	// Delete any existing passphrases for this user if createOnly is false
	!createOnly &&
		(await tx
			.delete(schema.passphrases)
			.where(eq(schema.passphrases.userId, parseInt(userId))))

	// Store hash, salt, and iterations in database
	await tx.insert(schema.passphrases).values({
		userId: parseInt(userId),
		hash: hashedPassphrase,
		salt: salt,
		iterations: String(iterations)
	})
}
