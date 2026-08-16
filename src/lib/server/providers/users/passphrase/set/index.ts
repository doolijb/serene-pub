import { schema, db } from "$lib/server/db"
import crypto from "crypto"
import { encrypt } from "../encrypt"
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
	// Use PBKDF2, salt is randomly generated string + env var
	// Hash is 256 bits
	// Iterations is a random number within 1000 + or - of 100,000
	// Store hash, salt, and iterations in database
	const saltLength = 32
	const salt = crypto.randomBytes(256 - saltLength).toString("hex")
	const iterations: number = Math.floor(Math.random() * 2000) + 100000

	const hashedPassphrase = await encrypt({
		passphrase,
		salt,
		iterations
	})

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
