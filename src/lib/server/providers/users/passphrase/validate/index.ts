import { schema, db } from "$lib/server/db"
import { encryptSync } from "../encrypt"
import { verifyPassphrase } from "../kdf"
import { set } from "../set"
import { eq, and, isNull } from "drizzle-orm"

/**
 * The retired PBKDF2 scheme, kept only to verify rows written before the move
 * to Argon2id/scrypt. Synchronous by necessity — `verifyPassphrase` picks the
 * scheme from the stored digest, so this has to be callable inline.
 */
function legacyPbkdf2(
	passphrase: string,
	salt: string,
	iterations: number
): string {
	return encryptSync({ passphrase, salt, iterations })
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

	const result = verifyPassphrase(passphrase, res.hash, {
		salt: res.salt,
		iterations: parseInt(res.iterations),
		// Only computed when the stored row is a legacy PBKDF2 digest.
		verify: () =>
			legacyPbkdf2(passphrase, res.salt, parseInt(res.iterations))
	})

	if (!result.valid) return false

	// Transparent upgrade: a correct passphrase is the one moment the plaintext
	// is available, so a legacy PBKDF2 row is rewritten with the current scheme
	// here. Deliberately not fatal — a failed rehash must not turn a valid
	// sign-in into a rejected one; it will simply be retried next time.
	if (result.needsRehash) {
		try {
			await set({ tx, userId, passphrase })
			console.log(
				`[auth] upgraded passphrase hashing for user ${userId} from pbkdf2`
			)
		} catch (err) {
			console.warn("[auth] passphrase rehash failed:", err)
		}
	}

	return true
}
