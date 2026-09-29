import { z } from "zod"

/**
 * The one passphrase rule.
 *
 * Extracted from `sockets/users.ts` so the environment-driven recovery reset
 * (26 §10, tier 3) enforces exactly what the socket layer does. Without a
 * shared definition, `.env` becomes a route to a password the app's own UI
 * would have refused — which is how a break-glass quietly becomes a way to
 * weaken an account rather than recover it.
 */
export const PASSPHRASE_MIN_LENGTH = 10
/** Bounds the key-derivation cost an attacker-supplied passphrase can force. */
export const PASSPHRASE_MAX_LENGTH = 128

/** The rule in one sentence, for the hint under a passphrase field. */
export const PASSPHRASE_RULE_HINT = `At least ${PASSPHRASE_MIN_LENGTH} characters, with an uppercase letter, a lowercase letter and a special character.`

export const passphraseSchema = z
	.string()
	.min(
		PASSPHRASE_MIN_LENGTH,
		`Passphrase must be at least ${PASSPHRASE_MIN_LENGTH} characters long`
	)
	.max(
		PASSPHRASE_MAX_LENGTH,
		`Passphrase must be at most ${PASSPHRASE_MAX_LENGTH} characters long`
	)
	.regex(/[a-z]/, "Passphrase must contain at least one lowercase letter")
	.regex(/[A-Z]/, "Passphrase must contain at least one uppercase letter")
	.regex(
		/[^a-zA-Z0-9]/,
		"Passphrase must contain at least one special character"
	)
