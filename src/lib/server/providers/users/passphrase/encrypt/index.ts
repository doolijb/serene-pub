import crypto from "crypto"
import { getCryptoSecretKey } from "$lib/server/db"

/**
 * Encrypts a passphrase using PBKDF2
 *
 * @param passphrase The passphrase to encrypt
 * @param salt The salt to use
 * @param iterations The number of iterations to use
 */
export function encrypt({
	passphrase,
	salt,
	iterations
}: {
	passphrase: string
	salt: string
	iterations: number
}): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		crypto.pbkdf2(
			passphrase,
			// Use the crypto secret key from meta.json as additional salt
			salt + getCryptoSecretKey(),
			iterations,
			256,
			"sha256",
			(err, derivedKey) => {
				if (err) {
					reject(err)
				} else {
					resolve(derivedKey.toString("hex"))
				}
			}
		)
	})
}

/**
 * Synchronous form of the same PBKDF2 derivation.
 *
 * Needed because verification now dispatches on the stored digest's scheme
 * (see ../kdf), and that dispatch is synchronous. Retired for *writing* — this
 * exists solely to verify rows created before the move to Argon2id/scrypt, so
 * that those users can sign in once and be upgraded in place.
 */
export function encryptSync({
	passphrase,
	salt,
	iterations
}: {
	passphrase: string
	salt: string
	iterations: number
}): string {
	return crypto
		.pbkdf2Sync(
			passphrase,
			salt + getCryptoSecretKey(),
			iterations,
			256,
			"sha256"
		)
		.toString("hex")
}
