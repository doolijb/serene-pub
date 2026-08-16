import { schema, db } from "$lib/server/db"
import { encrypt } from "../encrypt"
import { eq, and, isNull } from "drizzle-orm"
import { timingSafeEqual } from "crypto"

// Both hashes are hex-encoded PBKDF2 digests of equal length, so a plain
// string comparison would still be constant-time in practice — but using
// timingSafeEqual removes any doubt/dependency on that always holding.
function hashesMatch(a: string, b: string): boolean {
	const bufA = Buffer.from(a)
	const bufB = Buffer.from(b)
	if (bufA.length !== bufB.length) return false
	return timingSafeEqual(bufA, bufB)
}

/**
 * Create a new passphrase for a user and store it in the database
 *
 * @param tx
 * @param userId
 * @param passphrase
 */
export async function validate({
	tx = db,
	userId,
	passphrase
}: {
	tx?: typeof db
	userId: string
	passphrase: string
}): Promise<boolean> {
	// Query database for user's passphrase
	const res = await tx.query.passphrases.findFirst({
		where: (p, { eq, and, isNull }) =>
			and(eq(p.userId, parseInt(userId)), isNull(p.invalidatedAt))
	})

	if (!res) return false

	// Encrypt passphrase with salt and iterations from database
	const hash = await encrypt({
		passphrase,
		salt: res.salt,
		iterations: parseInt(res.iterations)
	})

	// Compare encrypted passphrase with hash from database
	return hashesMatch(hash, res.hash)
}
