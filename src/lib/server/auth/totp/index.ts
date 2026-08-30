import crypto from "crypto"

/**
 * TOTP (RFC 6238) and single-use recovery codes — plan 26 §10.
 *
 * Implemented here rather than pulled in as a dependency: the algorithm is
 * ~40 lines of HMAC and a modulo, it has not changed since 2011, and every
 * authenticator app on the planet is the interop test. What a library would
 * actually add is a supply-chain edge on the code path that guards admin
 * accounts.
 *
 * Deliberately pure — no database, no clock of its own beyond a `now` you can
 * pass in. That is what makes the drift window and the replay guard testable
 * against the RFC's own vectors instead of against wall-clock luck.
 */

/** RFC 6238's default, and what every authenticator app assumes. */
export const TOTP_STEP_SECONDS = 30

/**
 * How many steps either side of "now" are accepted.
 *
 * One step (±30s) is the standard tolerance for clock drift between a phone and
 * a server. Widening it trades security for convenience linearly: every extra
 * step is another 30 seconds an intercepted code stays usable.
 */
export const TOTP_DRIFT_STEPS = 1

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function base32Encode(buf: Buffer): string {
	let bits = 0
	let value = 0
	let output = ""
	for (const byte of buf) {
		value = (value << 8) | byte
		bits += 8
		while (bits >= 5) {
			output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
			bits -= 5
		}
	}
	if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
	// No padding: authenticator apps and otpauth:// URIs use the unpadded form.
	return output
}

export function base32Decode(input: string): Buffer {
	// Users retype secrets by hand when a QR scan fails, so spacing and case
	// are noise, and "=" padding may or may not be present.
	const cleaned = input.replace(/[\s=]/g, "").toUpperCase()
	let bits = 0
	let value = 0
	const bytes: number[] = []
	for (const char of cleaned) {
		const index = BASE32_ALPHABET.indexOf(char)
		if (index === -1) throw new Error("Invalid base32 character in secret")
		value = (value << 5) | index
		bits += 5
		if (bits >= 8) {
			bytes.push((value >>> (bits - 8)) & 0xff)
			bits -= 8
		}
	}
	return Buffer.from(bytes)
}

/**
 * 20 bytes = 160 bits, matching HMAC-SHA1's block behaviour and the size every
 * authenticator app expects. Larger is not stronger here.
 */
export function generateSecret(): string {
	return base32Encode(crypto.randomBytes(20))
}

export function timeStep(now: Date = new Date()): number {
	return Math.floor(now.getTime() / 1000 / TOTP_STEP_SECONDS)
}

/**
 * The RFC 6238 / RFC 4226 code for one counter value.
 *
 * `digits` is a parameter only so the RFC's own 8-digit test vectors can be
 * asserted directly; everything in this app uses the default 6.
 */
export function computeCode(
	secretBase32: string,
	step: number,
	digits = 6
): string {
	const key = base32Decode(secretBase32)
	const counter = Buffer.alloc(8)
	// 64-bit big-endian counter. writeBigUInt64BE rather than a 32-bit write:
	// the top half is zero today but will not be forever, and a truncated
	// counter silently produces wrong codes rather than failing.
	counter.writeBigUInt64BE(BigInt(step))

	const hmac = crypto.createHmac("sha1", key).update(counter).digest()
	// Dynamic truncation (RFC 4226 §5.3): the low nibble of the last byte
	// picks the offset, masking the high bit to stay positive.
	const offset = hmac[hmac.length - 1] & 0x0f
	const binary =
		((hmac[offset] & 0x7f) << 24) |
		((hmac[offset + 1] & 0xff) << 16) |
		((hmac[offset + 2] & 0xff) << 8) |
		(hmac[offset + 3] & 0xff)

	return (binary % 10 ** digits).toString().padStart(digits, "0")
}

export interface TotpVerification {
	valid: boolean
	/** The step the code belonged to — record it to burn that step. */
	step?: number
	reason?: "malformed" | "mismatch" | "replayed"
}

/**
 * Verify a submitted code against the drift window, refusing replays.
 *
 * `lastUsedStep` is what closes the replay window. Without it a code stays
 * usable for its whole step plus the drift either side — up to ~90 seconds in
 * which an intercepted code can be presented a second time. Rejecting any step
 * at or below the last one used means a code works exactly once.
 */
export function verifyTotp({
	secret,
	code,
	now = new Date(),
	lastUsedStep = null,
	driftSteps = TOTP_DRIFT_STEPS
}: {
	secret: string
	code: string
	now?: Date
	lastUsedStep?: number | null
	driftSteps?: number
}): TotpVerification {
	const submitted = code.replace(/\s/g, "")
	if (!/^\d{6}$/.test(submitted)) return { valid: false, reason: "malformed" }

	const current = timeStep(now)
	for (let offset = -driftSteps; offset <= driftSteps; offset++) {
		const step = current + offset
		if (step < 0) continue
		const expected = computeCode(secret, step)
		// Constant-time: the comparison is against a secret-derived value, and
		// both sides are the same fixed length by construction.
		const match = crypto.timingSafeEqual(
			Buffer.from(expected),
			Buffer.from(submitted)
		)
		if (!match) continue
		if (lastUsedStep !== null && step <= lastUsedStep) {
			return { valid: false, step, reason: "replayed" }
		}
		return { valid: true, step }
	}
	return { valid: false, reason: "mismatch" }
}

/**
 * The URI an authenticator app scans.
 *
 * The label is `issuer:account` *and* the issuer is repeated as a parameter —
 * apps disagree about which they read, and getting it wrong shows the user an
 * unlabelled six digits with no idea which account it belongs to.
 */
export function buildOtpauthUri({
	username,
	secret,
	issuer = "Serene Pub"
}: {
	username: string
	secret: string
	issuer?: string
}): string {
	const label = encodeURIComponent(`${issuer}:${username}`)
	const params = new URLSearchParams({
		secret,
		issuer,
		algorithm: "SHA1",
		digits: "6",
		period: String(TOTP_STEP_SECONDS)
	})
	return `otpauth://totp/${label}?${params.toString()}`
}

// ─── Recovery codes ─────────────────────────────────────────────────────────

/** Excludes the characters people misread when copying by hand. */
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const RECOVERY_CODE_LENGTH = 10
export const RECOVERY_CODE_COUNT = 10

/**
 * Ten codes of ten characters from a 32-symbol alphabet — ~50 bits each.
 *
 * Formatted in two groups for transcription; `normalizeRecoveryCode` strips the
 * separator back out, so what the user types never has to match the display.
 */
export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
	const codes: string[] = []
	for (let i = 0; i < count; i++) {
		let code = ""
		// randomInt is rejection-sampled, so no modulo bias across the alphabet.
		for (let c = 0; c < RECOVERY_CODE_LENGTH; c++) {
			code +=
				RECOVERY_ALPHABET[crypto.randomInt(RECOVERY_ALPHABET.length)]
		}
		codes.push(`${code.slice(0, 5)}-${code.slice(5)}`)
	}
	return codes
}

export function normalizeRecoveryCode(code: string): string {
	return code.replace(/[\s-]/g, "").toUpperCase()
}

/**
 * SHA-256, not a slow KDF — and that is a deliberate difference from how
 * passphrases are stored.
 *
 * A KDF's cost exists to make guessing a *human-chosen* secret expensive. These
 * are 50 bits of machine-generated randomness, where brute force is infeasible
 * regardless of hash speed. Verification also has to check a submitted code
 * against every unused row, so a per-row PBKDF2 would put a real cost on the
 * login path to defend against an attack the entropy already rules out.
 */
export function hashRecoveryCode(code: string): string {
	return crypto
		.createHash("sha256")
		.update(normalizeRecoveryCode(code))
		.digest("hex")
}
