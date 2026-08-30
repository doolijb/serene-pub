import crypto from "crypto"
import { getCryptoSecretKey } from "$lib/server/db"

/**
 * Passphrase hashing.
 *
 * Replaces the original PBKDF2-SHA256 scheme. PBKDF2 is memory-*cheap*, so a
 * GPU or ASIC gets enormous leverage over a defender's CPU; Argon2id and scrypt
 * are memory-hard, which is the property that removes that leverage. The old
 * scheme is still read (see `verify`) so existing installs keep working, and
 * upgraded in place the next time a user signs in.
 *
 * **Two algorithms, on purpose.** `crypto.argon2` landed in modern Node, but
 * the Android build embeds nodejs-mobile 18.20.4 where it does not exist — so
 * an Argon2id-only implementation would mean nobody could sign in on mobile.
 * scrypt has been in core since Node 10 and is OWASP's stated alternative, so
 * it is the fallback. The algorithm is recorded per row, which means a data
 * directory moved between a phone and a desktop still verifies correctly.
 */

/** OWASP's Argon2id minimum: 19 MiB, 2 passes, 1 lane. ~40ms here. */
const ARGON2 = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 }

/**
 * scrypt at N=2^16, r=8, p=1 (~64 MiB). One notch below OWASP's N=2^17
 * headline figure, deliberately: this path exists for phones, and Node's
 * default `maxmem` refuses anything larger without being raised. ~130ms here.
 */
const SCRYPT = { N: 65536, r: 8, p: 1, keylen: 32, maxmem: 96 * 1024 * 1024 }

const SALT_BYTES = 16

export type KdfAlgorithm = "argon2id" | "scrypt" | "pbkdf2"

/** Whether this runtime can do Argon2id at all. */
export function argon2Available(): boolean {
	return typeof (crypto as any).argon2Sync === "function"
}

/** The strongest algorithm this runtime supports. */
export function preferredAlgorithm(): Exclude<KdfAlgorithm, "pbkdf2"> {
	return argon2Available() ? "argon2id" : "scrypt"
}

/**
 * The instance secret, used as a true Argon2 `secret` (and mixed into the
 * scrypt input). Keeping this is deliberate — it is what makes a stolen
 * database alone useless, since the key lives in meta.json beside it rather
 * than inside it. Same threat model the original scheme had, and the same one
 * tokenCrypto.ts targets.
 */
function pepper(): Buffer {
	return Buffer.from(getCryptoSecretKey())
}

/**
 * Encode as a PHC-style string: `$alg$params$salt$hash`.
 *
 * Self-describing on purpose. Storing the parameters beside the digest is what
 * lets the cost be raised later without invalidating existing passphrases, and
 * what lets two algorithms coexist without a schema column to disambiguate
 * them.
 */
function encode(
	algorithm: string,
	params: string,
	salt: Buffer,
	hash: Buffer
): string {
	return `$${algorithm}$${params}$${salt.toString("base64")}$${hash.toString("base64")}`
}

interface Decoded {
	algorithm: string
	params: Record<string, number>
	salt: Buffer
	hash: Buffer
}

function decode(stored: string): Decoded | null {
	if (!stored.startsWith("$")) return null // legacy PBKDF2 hex digest
	const parts = stored.split("$")
	if (parts.length !== 5) return null
	const [, algorithm, rawParams, salt, hash] = parts
	const params: Record<string, number> = {}
	for (const pair of rawParams.split(",")) {
		const [k, v] = pair.split("=")
		params[k] = Number(v)
	}
	return {
		algorithm,
		params,
		salt: Buffer.from(salt, "base64"),
		hash: Buffer.from(hash, "base64")
	}
}

function argon2id(passphrase: string, salt: Buffer, p = ARGON2): Buffer {
	return (crypto as any).argon2Sync("argon2id", {
		message: passphrase,
		nonce: salt,
		secret: pepper(),
		parallelism: p.parallelism,
		tagLength: p.tagLength,
		memory: p.memory,
		passes: p.passes
	})
}

function scrypt(passphrase: string, salt: Buffer, p = SCRYPT): Buffer {
	// scrypt has no `secret` parameter, so the pepper is mixed into the input.
	return crypto.scryptSync(
		passphrase + pepper().toString("utf8"),
		salt,
		p.keylen,
		{
			N: p.N,
			r: p.r,
			p: p.p,
			maxmem: SCRYPT.maxmem
		}
	)
}

/** Hash a passphrase with the strongest algorithm this runtime supports. */
export function hashPassphrase(passphrase: string): string {
	const salt = crypto.randomBytes(SALT_BYTES)
	if (argon2Available()) {
		return encode(
			"argon2id",
			`m=${ARGON2.memory},t=${ARGON2.passes},p=${ARGON2.parallelism}`,
			salt,
			argon2id(passphrase, salt)
		)
	}
	return encode(
		"scrypt",
		`N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}`,
		salt,
		scrypt(passphrase, salt)
	)
}

export interface VerifyResult {
	valid: boolean
	/** True when the stored hash uses a scheme weaker than what is available. */
	needsRehash: boolean
	algorithm: KdfAlgorithm
}

/**
 * Verify against whatever scheme the row was written with.
 *
 * `legacy` carries the old PBKDF2 row's salt/iterations, which live in their
 * own columns rather than in the digest.
 */
export function verifyPassphrase(
	passphrase: string,
	stored: string,
	legacy?: { salt: string; iterations: number; verify: () => string }
): VerifyResult {
	const decoded = decode(stored)

	if (!decoded) {
		// Legacy PBKDF2: hex digest, parameters in sibling columns. Always
		// flagged for rehash — this is the scheme being retired.
		const computed = legacy?.verify() ?? ""
		return {
			valid: constantTimeEqual(
				Buffer.from(computed, "utf8"),
				Buffer.from(stored, "utf8")
			),
			needsRehash: true,
			algorithm: "pbkdf2"
		}
	}

	let computed: Buffer
	if (decoded.algorithm === "argon2id") {
		if (!argon2Available()) {
			// A data directory written on a desktop, opened on Android. There
			// is no way to verify, and silently failing the passphrase would
			// look like a wrong password rather than a platform limitation.
			throw new Error(
				"This account's passphrase was created with Argon2id, which this build cannot verify. " +
					"Sign in on the platform it was created on, or reset the passphrase via the recovery environment variables."
			)
		}
		computed = argon2id(passphrase, decoded.salt, {
			memory: decoded.params.m,
			passes: decoded.params.t,
			parallelism: decoded.params.p,
			tagLength: decoded.hash.length
		})
	} else if (decoded.algorithm === "scrypt") {
		computed = scrypt(passphrase, decoded.salt, {
			N: decoded.params.N,
			r: decoded.params.r,
			p: decoded.params.p,
			keylen: decoded.hash.length,
			maxmem: SCRYPT.maxmem
		})
	} else {
		return { valid: false, needsRehash: false, algorithm: "pbkdf2" }
	}

	return {
		valid: constantTimeEqual(computed, decoded.hash),
		// Never flip between argon2id and scrypt — a data directory used on
		// both a phone and a desktop would otherwise rehash on every sign-in,
		// and both are strong. Only the retired scheme is upgraded.
		needsRehash: false,
		algorithm: decoded.algorithm as KdfAlgorithm
	}
}

function constantTimeEqual(a: Buffer, b: Buffer): boolean {
	if (a.length !== b.length) return false
	return crypto.timingSafeEqual(a, b)
}
