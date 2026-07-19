import crypto from "crypto"
import { getCryptoSecretKey } from "$lib/server/db"

/**
 * AES-256-GCM encryption for secrets stored at rest (eg. the CharaVault
 * App Password). Nothing else in this app encrypts stored secrets today —
 * connections.extraJson and vectorizationConfigs.apiKey are plain text —
 * so this is the first real encryption-at-rest utility.
 *
 * The key is derived via HKDF from the app's existing crypto secret
 * (getCryptoSecretKey(), also used to derive the PASETO session-token key)
 * with a distinct `info` string, so this key is cryptographically
 * independent of the PASETO key despite sharing the same root secret.
 */

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12
const KEY_INFO = "serene-pub:cardSourceToken:v1"

function deriveKey(): Buffer {
	const secret = getCryptoSecretKey()
	return Buffer.from(
		crypto.hkdfSync("sha256", secret, "", KEY_INFO, 32)
	)
}

export interface EncryptedToken {
	ciphertext: string
	iv: string
	authTag: string
}

export function encryptToken(plaintext: string): EncryptedToken {
	const key = deriveKey()
	const iv = crypto.randomBytes(IV_LENGTH)
	const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final()
	])
	const authTag = cipher.getAuthTag()

	return {
		ciphertext: ciphertext.toString("base64"),
		iv: iv.toString("base64"),
		authTag: authTag.toString("base64")
	}
}

export function decryptToken(token: EncryptedToken): string {
	const key = deriveKey()
	const decipher = crypto.createDecipheriv(
		ALGORITHM,
		key,
		Buffer.from(token.iv, "base64")
	)
	decipher.setAuthTag(Buffer.from(token.authTag, "base64"))
	const plaintext = Buffer.concat([
		decipher.update(Buffer.from(token.ciphertext, "base64")),
		decipher.final()
	])
	return plaintext.toString("utf8")
}
