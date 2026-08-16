import crypto from "crypto"
import { getCryptoSecretKey } from "$lib/server/db"

/**
 * AES-256-GCM encryption for secrets stored at rest (eg. the CharaVault
 * App Password, connection API keys, the vectorization API key).
 *
 * The key is derived via HKDF from the app's existing crypto secret
 * (getCryptoSecretKey(), also used to derive the PASETO session-token key)
 * with a `keyInfo` string distinct per secret class, so eg. a connection
 * API key is cryptographically independent of the CharaVault token and of
 * the vectorization API key, despite all three sharing the same root
 * secret. `keyInfo` is required, not defaulted — a defaulted param would
 * let a call site that forgets to pass its own `keyInfo` silently fall
 * back to another secret class's key. Both encrypt and decrypt would then
 * consistently use the wrong-but-consistent key, so nothing would even
 * throw — the two secret classes would just silently share a key,
 * quietly defeating the entire point of the separation. Requiring it
 * turns that failure mode into a compile error at the call site instead.
 *
 * Threat model this actually buys: the derived key ultimately traces back
 * to a secret persisted in meta.json in the app's data directory, right
 * next to the database. This protects against a DB-only compromise (a
 * stolen/leaked DB backup, a read-access bug scoped to the database) — it
 * does NOT protect against a combined DB + data-dir compromise, since
 * meta.json is sitting right there too. Same guarantee the CharaVault
 * token encryption already had.
 */

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 12

export const CHARAVAULT_KEY_INFO = "serene-pub:cardSourceToken:v1"
export const CONNECTION_API_KEY_INFO = "serene-pub:connectionApiKey:v1"
export const VECTORIZATION_API_KEY_INFO = "serene-pub:vectorizationApiKey:v1"

function deriveKey(keyInfo: string): Buffer {
	const secret = getCryptoSecretKey()
	return Buffer.from(crypto.hkdfSync("sha256", secret, "", keyInfo, 32))
}

export interface EncryptedToken {
	ciphertext: string
	iv: string
	authTag: string
}

export function encryptToken(
	plaintext: string,
	keyInfo: string
): EncryptedToken {
	const key = deriveKey(keyInfo)
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

export function decryptToken(token: EncryptedToken, keyInfo: string): string {
	const key = deriveKey(keyInfo)
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

/**
 * connections.extraJson.apiKey is a JSON sub-field, not a dedicated
 * column — encrypted in place as a small envelope so old (plaintext-
 * string) rows keep working without a forced data migration; each
 * connection transparently upgrades to encrypted form the next time it's
 * saved through connectionsUpdate.
 */
export function isEncryptedApiKey(
	v: unknown
): v is EncryptedToken & { __enc: true } {
	return (
		typeof v === "object" &&
		v !== null &&
		(v as any).__enc === true &&
		typeof (v as any).ciphertext === "string" &&
		typeof (v as any).iv === "string" &&
		typeof (v as any).authTag === "string"
	)
}

export function encryptApiKeyField(plaintext: string) {
	return {
		__enc: true as const,
		...encryptToken(plaintext, CONNECTION_API_KEY_INFO)
	}
}

export function decryptApiKeyField(value: unknown): string | undefined {
	if (!value) return undefined
	if (typeof value === "string") return value // legacy plaintext row, not yet re-saved
	if (isEncryptedApiKey(value)) {
		return decryptToken(value, CONNECTION_API_KEY_INFO)
	}
	return undefined
}
